import dotenv from 'dotenv';
import * as fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';
import {execSync} from 'child_process';
dotenv.config();

import {callWithRetry} from './llm.js';
import {getRef} from './lib.js';
import {parseArgs, formatHelp, COMMON_FLAGS} from './cli.js';
import type {FlagSpec} from './cli.js';
import type {Chapter} from '../kvn/src/bible-types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Alle flaggene her er innstillinger for rørledningen som evalueres — de sendes
 * ordrett videre til `references_semantic` og lagres i `eval/results.json` som
 * `extraArgs`, slik at en kjøring kan gjenskapes. Speilet av SPEC-en der.
 *
 * `--help` måtte inn fordi den før var bare enda et gjennomstikksargument:
 * `bun generate/eval_references.ts --help` startet en full LLM-evaluering (#109).
 *
 * `--threshold` er `string` av samme grunn som i `references_semantic`:
 * kontraktens `number` er `parseInt`, og «0.60» ville blitt 0.
 */
const SPEC: Record<string, FlagSpec> = {
    'build-only': {kind: 'boolean', help: 'bygg bare vektorene, hopp over verifiseringen'},
    'verify-only': {kind: 'boolean', help: 'verifiser bare (evalueringen sender denne selv)'},
    'top-k': {kind: 'number', help: 'antall kandidater per vers'},
    threshold: {kind: 'string', help: 'minste cosinuslikhet (bge-m3 gir beslektede vers 0.60–0.70)'},
    'neighbor-skip': {kind: 'number', help: 'hopp over vers i samme kapittel innenfor N'},
    theme: {kind: 'boolean', help: 'la modellen oppsummere verset og søk også på oppsummeringen'},
    concepts: {kind: 'boolean', help: 'la modellen lage 4 fasettspørsmål og søk på hvert av dem'},
    resume: {kind: 'boolean', help: 'hopp over vers som alt er kjørt'},
    'skip-existing': {kind: 'boolean', help: 'hopp over vers som alt har en referansefil'},
    // Evalueringen setter selv --book/--chapter/--verse per testvers. Sendes de
    // inn her, havner de BAK og overstyrer testverset — kjøringen måler da noe
    // annet enn den rapporterer. De står her fordi de ble godtatt før.
    book: COMMON_FLAGS.book,
    chapter: COMMON_FLAGS.chapter,
    verse: COMMON_FLAGS.verse,
    force: {kind: 'boolean', help: 'bygg vektorene på nytt'},
    help: COMMON_FLAGS.help,
};

const HELP_EXAMPLES = [
    'bun generate/eval_references.ts',
    'bun generate/eval_references.ts --top-k 10 --threshold 0.78',
    'bun generate/eval_references.ts --concepts --theme',
    'EVAL_VERSES=extra bun generate/eval_references.ts',
    '',
    'EVAL_VERSES=extra bytter testsettet fra 6 til 4 andre vers.',
    'Referansefilene som rørledningen rører, skrives tilbake etterpå;',
    'det eneste som blir liggende er generate/eval/results.json.',
    'Dommeren er Claude, så en kjøring koster API-kall.',
];

/** Ett vers evalueringen kjører rørledningen på. */
interface TestVerse {
    bookId: number;
    chapterId: number;
    verseId: number;
}

/**
 * En kryssreferanse slik den ligger i referansefila.
 *
 * Feltene er påkrevde her, i motsetning til `RawReference` i `references.ts`:
 * det som leses er allerede normalisert og gjennom adressekontrollen.
 */
interface EvalReference {
    bookId: number;
    chapterId: number;
    fromVerseId: number;
    toVerseId: number;
    text: string;
}

/** Fila på disk: `references/<språk>/<bok>/<kapittel>/<vers>.json`. */
interface ReferenceFile {
    references: EvalReference[];
}

/**
 * Feilen `execSync` kaster: den bærer med seg det som ble skrevet før exit.
 * `encoding: 'utf-8'` gjør begge til strenger.
 */
interface ExecError {
    stdout?: string;
    stderr?: string;
}

/** Svaret på JUDGE_SCHEMA. */
interface JudgeResult {
    score: number;
    reason: string;
}

/** En kandidatreferanse med dommerens karakter påført. */
interface JudgedReference extends EvalReference {
    /** `null` når dommeren ikke svarte — se `judgeRef`. */
    score: number | null;
    judgeReason?: string;
}

/** Resultatet for ett testvers. */
interface VerseResult {
    verse: TestVerse;
    label: string;
    elapsed: number;
    newRefs: JudgedReference[];
}

const TEST_VERSES: TestVerse[] = process.env.EVAL_VERSES === 'extra' ? [
    {bookId: 1, chapterId: 3, verseId: 15},     // Gen 3:15 protoevangelium
    {bookId: 23, chapterId: 53, verseId: 5},    // Isa 53:5 by his stripes
    {bookId: 19, chapterId: 23, verseId: 1},    // Ps 23:1 the Lord is shepherd (NB: may need to check)
    {bookId: 44, chapterId: 2, verseId: 38},    // Acts 2:38 repent and be baptized
] : [
    {bookId: 1, chapterId: 1, verseId: 1},      // Gen 1:1 (creation)
    {bookId: 40, chapterId: 5, verseId: 3},     // Mt 5:3 (beatitudes)
    {bookId: 40, chapterId: 28, verseId: 19},   // Great commission
    {bookId: 42, chapterId: 19, verseId: 5},    // Sakkeus
    {bookId: 43, chapterId: 3, verseId: 16},    // John 3:16
    {bookId: 43, chapterId: 14, verseId: 6},    // I am the way
];

const JUDGE_SCHEMA = {
    type: 'object',
    properties: {
        score: {type: 'integer'},
        reason: {type: 'string'}
    },
    required: ['score', 'reason'],
    additionalProperties: false
};

function refKey(r: EvalReference): string {
    return `${r.bookId}-${r.chapterId}-${r.fromVerseId}-${r.toVerseId}`;
}

function getOsnb2Text(bookId: number, chapterId: number, verseId: number): string | null {
    const file = path.join(__dirname, 'bibles_raw', 'osnb', `${bookId}`, `${chapterId}.json`);
    if (!fs.existsSync(file)) return null;
    const verses = JSON.parse(fs.readFileSync(file, 'utf-8')) as Chapter;
    return verses.find(v => +v.verseId === +verseId)?.text || null;
}

async function runPipelineOnVerse(verse: TestVerse, extraArgs = '') {
    const refFile = path.join(__dirname, 'references', 'nb', `${verse.bookId}`, `${verse.chapterId}`, `${verse.verseId}.json`);
    const beforeContent = fs.existsSync(refFile) ? fs.readFileSync(refFile, 'utf-8') : null;
    const beforeKeys = beforeContent ? new Set((JSON.parse(beforeContent) as ReferenceFile).references.map(refKey)) : new Set<string>();

    // Var `node references_semantic.mjs`. Fila har hett `.ts` siden da4e64e08,
    // så `execSync` feilet alltid — og catch-en svelget feilen ned i `output`,
    // hvorpå `readFileSync(refFile)` kastet for testvers uten referansefil.
    // Evalueringen kunne altså ikke kjøre i det hele tatt.
    const cmd = `bun ${path.join(__dirname, 'references_semantic.ts')} --verify-only --book ${verse.bookId} --chapter ${verse.chapterId} --verse ${verse.verseId} ${extraArgs}`;
    const t0 = Date.now();
    let output = '';
    try {
        output = execSync(cmd, {encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe']});
    } catch (e) {
        output = ((e as ExecError).stdout || '') + ((e as ExecError).stderr || '');
    }
    const elapsed = Date.now() - t0;

    const after = JSON.parse(fs.readFileSync(refFile, 'utf-8')) as ReferenceFile;
    const newRefs = after.references.filter(r => !beforeKeys.has(refKey(r)));

    if (beforeContent !== null) {
        fs.writeFileSync(refFile, beforeContent);
    } else if (fs.existsSync(refFile)) {
        fs.unlinkSync(refFile);
    }

    return {newRefs, elapsed, output};
}

async function judgeRef(sourceVerse: TestVerse, ref: EvalReference): Promise<JudgeResult | null> {
    const srcText = getOsnb2Text(sourceVerse.bookId, sourceVerse.chapterId, sourceVerse.verseId);
    const refText = getOsnb2Text(ref.bookId, ref.chapterId, ref.fromVerseId);
    if (!srcText || !refText) return null;

    const prompt = `Vurder om denne foreslåtte bibelske kryssreferansen er en ekte og verdifull referanse for en bibelleser.

KILDEVERS: ${getRef(sourceVerse.bookId, sourceVerse.chapterId, sourceVerse.verseId)}: ${srcText}
KANDIDATVERS: ${getRef(ref.bookId, ref.chapterId, ref.fromVerseId)}: ${refText}
FORESLÅTT BEGRUNNELSE: ${ref.text}

Score 1-5:
- 5: Direkte sitat / samme hendelse / klar oppfyllelse — uomtvistelig referanse
- 4: Sterk teologisk eller tematisk parallell — versene belyser hverandre meningsfullt
- 3: Defensible parallell — svak men reell kobling
- 2: Kun overfladisk likhet (felles ord eller imperativer, men ulikt poeng)
- 1: Ikke relatert; banal eller falsk parallell

Vær streng. En score på 4-5 betyr referansen tilfører reell verdi som ikke er åpenbar fra standard kryssreferanseverk.`;

    try {
        // `callWithRetry` er typet `object | string`; med skjema er det det
        // dekodede JSON-svaret, og skjemaet håndheves på API-siden.
        return await callWithRetry(prompt, {schema: JUDGE_SCHEMA, context: `judge ${ref.bookId}:${ref.chapterId}:${ref.fromVerseId}`}) as JudgeResult;
    } catch (e) {
        console.warn(`  judge failed: ${(e as Error).message}`);
        return null;
    }
}

async function main() {
    const argv = process.argv.slice(2);

    // Hjelpen skal ut før første API-kall og før rørledningen startes.
    const {flags} = parseArgs(argv, SPEC);
    if (flags.help) {
        console.log(formatHelp(
            'generate/eval_references.ts',
            'måler kvaliteten på den semantiske referanserørledningen: kjører references_semantic på et fast testsett, lar Claude gi hver nye referanse 1–5, og skriver oppsummeringen til generate/eval/results.json',
            SPEC,
            HELP_EXAMPLES,
        ));
        process.exit(0);
    }

    // Argumentene sendes ordrett videre, ikke gjenskapt fra `flags`. Parsingen
    // over er der for å avvise skrivefeil før en betalt kjøring starter — en
    // gjenskapt streng ville i tillegg kunne skrive verdien annerledes enn
    // `references_semantic` leser den.
    const extraArgs = argv.join(' ');
    console.log(`Eval over ${TEST_VERSES.length} verses (extra args: "${extraArgs}")`);
    console.log('Judge: Claude (independent of pipeline LLM)\n');

    const results: VerseResult[] = [];
    for (const v of TEST_VERSES) {
        const label = getRef(v.bookId, v.chapterId, v.verseId);
        process.stdout.write(`${label}: running pipeline... `);
        const {newRefs, elapsed} = await runPipelineOnVerse(v, extraArgs);
        process.stdout.write(`${(elapsed/1000).toFixed(0)}s, ${newRefs.length} new refs\n`);

        const judged: JudgedReference[] = [];
        for (const r of newRefs) {
            const j = await judgeRef(v, r);
            if (j) {
                judged.push({...r, score: j.score, judgeReason: j.reason});
                const label2 = getRef(r.bookId, r.chapterId, r.fromVerseId);
                console.log(`  ${j.score}/5 ${label2.padEnd(20)} — ${r.text.slice(0,70)}`);
            } else {
                judged.push({...r, score: null});
            }
        }
        results.push({verse: v, label, elapsed, newRefs: judged});
    }

    console.log('\n=== SUMMARY ===');
    const totalNew = results.reduce((s, r) => s + r.newRefs.length, 0);
    const allScores = results.flatMap(r => r.newRefs.map(x => x.score).filter((s): s is number => s != null));
    const avg = allScores.length ? allScores.reduce((a, b) => a + b, 0) / allScores.length : 0;
    const high = allScores.filter(s => s >= 4).length;
    const totalTime = results.reduce((s, r) => s + r.elapsed, 0);

    console.log(`Verses tested:        ${results.length}`);
    console.log(`Total pipeline time:  ${(totalTime/1000).toFixed(0)}s, avg ${(totalTime/results.length/1000).toFixed(1)}s/verse`);
    console.log(`Total new refs:       ${totalNew}`);
    console.log(`Avg quality (1-5):    ${avg.toFixed(2)}`);
    console.log(`High-quality (≥4):    ${high}/${totalNew} (${(high*100/Math.max(totalNew,1)).toFixed(0)}%)`);

    const keepNet = high;
    const noisePct = totalNew > 0 ? ((totalNew - high) * 100 / totalNew).toFixed(0) : 0;
    console.log(`\nNet value: ${keepNet} good refs added across ${results.length} verses`);
    console.log(`Noise: ${noisePct}% of additions are judged below quality threshold`);

    // Innstillingskjøringene bor i generate/eval/, ikke i skriptrota. Ti av dem
    // lå løst mellom skriptene og gjorde katalogen uleselig (#107).
    const evalDir = path.join(__dirname, 'eval');
    fs.mkdirSync(evalDir, {recursive: true});
    const outFile = path.join(evalDir, 'results.json');
    fs.writeFileSync(outFile, JSON.stringify({
        extraArgs, results,
        summary: {totalNew, avg, high, totalTime, noisePct}
    }, null, 2));
    console.log(`\nFull results written to ${path.relative(process.cwd(), outFile)}`);
}

// Kjører bare når fila startes direkte. Uten vakten kjører jobben ved IMPORT —
// det er grunnen til at days.ts slettet data bare man lastet modulen (#108),
// og det gjør skriptene umulige å teste.
if (import.meta.main) {
    main().catch(err => { console.error(err); process.exit(1); });
}
