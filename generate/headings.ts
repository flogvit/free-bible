import "./env.js";
import * as fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';

import {books, getBookName, bibles, getLanguageCode, ollamaModel, anthropicModel} from './constants.js';
import {callWithRetry} from './llm.js';
import {parseArgs, formatHelp, COMMON_FLAGS} from './cli.js';
import type {FlagSpec, Range} from './cli.js';
import type {Chapter} from '../kvn/src/bible-types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Flaggene skriptet godtar, i den rekkefølgen `--help` viser dem.
 *
 * Om modellaksen: fram til migreringen het flagget her `--remote`, og
 * standarden UTEN flagg var **lokal Ollama** — motsatt fortegn av de elleve
 * skriptene som bruker `--local`. Kontrakten avviser `--remote` (se `cli.ts`),
 * så aksen heter nå `--local`, men standarden er beholdt: `default: true` gjør
 * at en kommando uten flagg treffer nøyaktig samme modell som før. `--no-local`
 * er den nye måten å be om Claude på, altså det `--remote` gjorde.
 */
const SPEC: Record<string, FlagSpec> = {
    bible: COMMON_FLAGS.bible,
    book: COMMON_FLAGS.book,
    chapter: {...COMMON_FLAGS.chapter, help: 'kapittel eller kapittelintervall (krever én enkelt bok)'},
    ot: COMMON_FLAGS.ot,
    nt: COMMON_FLAGS.nt,
    local: {...COMMON_FLAGS.local, help: 'kjør mot lokal Ollama i stedet for Claude', default: true},
    'no-local': {kind: 'boolean', help: 'kjør mot Claude i stedet for lokal Ollama (het --remote før)'},
    force: COMMON_FLAGS.force,
    help: COMMON_FLAGS.help,
};

const SCRIPT = 'generate/headings.ts';
const PURPOSE = 'lag inline seksjonsoverskrifter kapittel for kapittel → '
    + 'generate/headings/<språk>/<bokId>/<kapittelId>.json (språkkoden utledes av oversettelsen)';
const EXAMPLES = [
    'bun generate/headings.ts --bible osnb --book 1 --chapter 1',
    'bun generate/headings.ts --bible osnb --book 1',
    'bun generate/headings.ts --bible osnb --nt --no-local',
    'bun generate/headings.ts --bible osnn --force',
];

// Hjelpesjekken står først — før .env-lasting og før enhver fil- eller
// nettverksoperasjon. `--help` skal svare på hva skriptet tar, ikke begynne å
// gjøre det.
const {flags} = parseArgs(process.argv.slice(2), SPEC);
if (flags.help) {
    console.log(formatHelp(SCRIPT, PURPOSE, SPEC, EXAMPLES));
    process.exit(0);
}


/** Én seksjonsoverskrift: tittel og versintervallet den dekker. */
interface Heading {
    title: string;
    startVerse: number;
    endVerse: number;
}

/** Svaret fra modellen, dekodet mot `HEADINGS_SCHEMA`. */
interface HeadingsResult {
    headings: Heading[];
}

/**
 * Resultatet av valideringen — en diskriminert union på `ok`, så `sorted`
 * bare finnes der den faktisk er beregnet.
 */
type HeadingValidation =
    | {ok: false; reason: string}
    | {ok: true; sorted: Heading[]};

/** Titlene fra et tidligere kapittel, brukt som konsistenskontekst i prompten. */
interface PriorChapterHeadings {
    chapter: number;
    titles: string[];
}

/**
 * Innholdet i `headings/<lang>/<bookId>/<chapterId>.json`.
 *
 * `validationWarning` settes bare når overskriftene ikke validerte — fila
 * skrives uansett, med advarselen i seg.
 */
interface HeadingsOutput {
    translation: string;
    language: string;
    bookId: number;
    chapterId: number;
    model: string;
    generatedAt: string;
    headings: Heading[];
    validationWarning?: string | null;
}

const SOURCES_DIR = path.join(__dirname, 'bibles_raw');
const OUTPUT_BASE = path.join(__dirname, 'headings');

// Last N chapter heading titles to feed back as context for cross-chapter consistency.
const PRIOR_CONTEXT_CHAPTERS = 3;

const HEADINGS_SCHEMA = {
    type: 'object',
    properties: {
        headings: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    title: {type: 'string'},
                    startVerse: {type: 'integer'},
                    endVerse: {type: 'integer'}
                },
                required: ['title', 'startVerse', 'endVerse'],
                additionalProperties: false
            }
        }
    },
    required: ['headings'],
    additionalProperties: false
};

function loadChapter(bible: string, bookId: number, chapterId: number): Chapter | null {
    const file = path.join(SOURCES_DIR, bible, String(bookId), `${chapterId}.json`);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function formatChapterText(verses: Chapter): string {
    return verses.map(v => `${v.verseId}. ${v.text}`).join('\n');
}

function getOutputPath(language: string, bookId: number, chapterId: number): string {
    return path.join(OUTPUT_BASE, language, String(bookId), `${chapterId}.json`);
}

function loadPriorChapterHeadings(language: string, bookId: number, currentChapter: number): PriorChapterHeadings[] {
    const priors: PriorChapterHeadings[] = [];
    for (let ch = Math.max(1, currentChapter - PRIOR_CONTEXT_CHAPTERS); ch < currentChapter; ch++) {
        const file = getOutputPath(language, bookId, ch);
        if (!fs.existsSync(file)) continue;
        try {
            const data: HeadingsOutput = JSON.parse(fs.readFileSync(file, 'utf8'));
            if (data.headings && data.headings.length) {
                priors.push({chapter: ch, titles: data.headings.map(h => h.title)});
            }
        } catch {
            // skip malformed
        }
    }
    return priors;
}

function buildPrompt(language: string, bookName: string, chapterId: number, chapterText: string, verseCount: number, priorHeadings: PriorChapterHeadings[]): string {
    const langLabel = language === 'nn' ? 'nynorsk' : 'bokmål';
    const priorBlock = priorHeadings.length
        ? `\nForrige kapitler i samme bok (for konsistens i stil og navngivning):\n${priorHeadings.map(p => `  Kapittel ${p.chapter}: ${p.titles.join(' / ')}`).join('\n')}\n`
        : '';

    return `Du skal foreslå inline seksjonsoverskrifter for ${bookName}, kapittel ${chapterId}, på norsk ${langLabel}.

Overskriftene fungerer som strukturmarkører som vises mellom versene i bibelteksten, omtrent slik som i trykte bibelutgaver. Hver overskrift dekker en sammenhengende gruppe vers.

KRAV:
- Hele kapitlet skal dekkes — første overskrift starter ved vers 1, siste overskrift slutter ved vers ${verseCount}.
- Ingen overlapp og ingen gap: hver overskrifts endVerse + 1 må være neste overskrifts startVerse.
- Antall overskrifter: typisk 1–5 per kapittel. Korte fortellende kapitler kan ha bare én. Lange kapitler med tydelige tematiske skift kan ha flere. Sett aldri en overskrift på under 2 vers med mindre det er åpenbart riktig (f.eks. en kort innledende formaning).
- Overskrift skal være kort (vanligvis 2–6 ord), beskrivende og i nøytral kirkelig norsk ${langLabel}-stil. Eksempler: "Skapelsen", "Syndefallet", "Abrahams kall", "Bergprekenen begynner", "Paulus' hilsen".
- Bruk ikke kapittelnummer eller versnummer i selve overskriftstittelen.
- Hold deg til etablert terminologi og stil fra tidligere kapitler (se forrige kapitler under) når det er naturlig.
${priorBlock}
Teksten (${bookName} ${chapterId}, vers 1–${verseCount}):
${chapterText}

Returner JSON med en "headings"-array. Hver oppføring: {"title": "...", "startVerse": N, "endVerse": M}.`;
}

function validateHeadings(headings: Heading[], verseCount: number): HeadingValidation {
    if (!Array.isArray(headings) || headings.length === 0) {
        return {ok: false, reason: 'empty or non-array'};
    }
    const sorted = [...headings].sort((a, b) => a.startVerse - b.startVerse);
    if (sorted[0].startVerse !== 1) {
        return {ok: false, reason: `first heading starts at ${sorted[0].startVerse}, expected 1`};
    }
    if (sorted[sorted.length - 1].endVerse !== verseCount) {
        return {ok: false, reason: `last heading ends at ${sorted[sorted.length - 1].endVerse}, expected ${verseCount}`};
    }
    for (let i = 0; i < sorted.length; i++) {
        const h = sorted[i];
        if (!h.title || typeof h.title !== 'string' || !h.title.trim()) {
            return {ok: false, reason: `heading ${i + 1} has empty title`};
        }
        if (h.endVerse < h.startVerse) {
            return {ok: false, reason: `heading "${h.title}" has endVerse < startVerse`};
        }
        if (h.startVerse < 1 || h.endVerse > verseCount) {
            return {ok: false, reason: `heading "${h.title}" verses out of range (chapter has ${verseCount} verses)`};
        }
        if (i > 0) {
            const prev = sorted[i - 1];
            if (h.startVerse !== prev.endVerse + 1) {
                return {ok: false, reason: `gap or overlap between "${prev.title}" (ends ${prev.endVerse}) and "${h.title}" (starts ${h.startVerse})`};
            }
        }
    }
    return {ok: true, sorted};
}

async function processChapter(bible: string, language: string, bookId: number, chapterId: number, force: boolean, useLocal: boolean): Promise<void> {
    const bookName = getBookName(bookId, language);
    const outputFile = getOutputPath(language, bookId, chapterId);

    if (!force && fs.existsSync(outputFile)) {
        console.log(`  ${bookName} ${chapterId}: already processed, skipping`);
        return;
    }

    const verses = loadChapter(bible, bookId, chapterId);
    if (!verses || verses.length === 0) {
        console.log(`  ${bookName} ${chapterId}: input missing or empty, skipping`);
        return;
    }

    const chapterText = formatChapterText(verses);
    const verseCount = verses[verses.length - 1].verseId;
    const priorHeadings = loadPriorChapterHeadings(language, bookId, chapterId);
    const prompt = buildPrompt(language, bookName, chapterId, chapterText, verseCount, priorHeadings);
    const modelLabel = useLocal ? ollamaModel : anthropicModel;

    process.stdout.write(`  ${bookName} ${chapterId} (${verses.length} vers, ${useLocal ? 'qwen' : 'claude'})... `);
    const t0 = Date.now();

    // `!` er en definite-assignment-påstand: while-løkka kjører alltid minst én
    // runde (`attempts` starter på 0, grensen er 2) og setter begge før de
    // leses, men det ser ikke kompilatoren gjennom try/catch-en.
    let result!: HeadingsResult;
    let validation!: HeadingValidation;
    let attempts = 0;
    let lastReason: string | null = null;
    const MAX_VALIDATION_RETRIES = 2;

    while (attempts < MAX_VALIDATION_RETRIES) {
        attempts++;
        let attemptPrompt = prompt;
        if (lastReason) {
            attemptPrompt = `${prompt}\n\nDet forrige forsøket ble forkastet fordi: ${lastReason}. Vennligst rett opp.`;
        }
        try {
            // `callWithRetry` er typet `object | string`; med skjema er det det
            // dekodede objektet. Påstanden navngir formen skjemaet krever.
            result = await callWithRetry(attemptPrompt, {
                schema: HEADINGS_SCHEMA,
                local: useLocal,
                context: `${bookName} ${chapterId}`
            }) as HeadingsResult;
        } catch (err) {
            process.stdout.write(`FEIL (LLM): ${(err as Error).message}\n`);
            return;
        }
        validation = validateHeadings(result.headings, verseCount);
        if (validation.ok) break;
        lastReason = validation.reason;
    }

    const dt = ((Date.now() - t0) / 1000).toFixed(1);

    const output: HeadingsOutput = {
        translation: bible,
        language,
        bookId,
        chapterId,
        model: modelLabel,
        generatedAt: new Date().toISOString().slice(0, 10),
        headings: validation.ok ? validation.sorted : result.headings
    };

    if (!validation.ok) {
        output.validationWarning = lastReason;
        process.stdout.write(`ADVARSEL: ${lastReason} (lagrer uansett, ${dt}s)\n`);
    } else {
        process.stdout.write(`${output.headings.length} overskrift${output.headings.length === 1 ? '' : 'er'}: ${output.headings.map(h => `${h.title} (${h.startVerse}-${h.endVerse})`).join(' | ')} [${dt}s]\n`);
    }

    fs.mkdirSync(path.dirname(outputFile), {recursive: true});
    fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));
}

async function main(): Promise<void> {
    const bible = flags.bible as string | undefined;
    if (!bible) {
        // Samme som før: manglende --bible skriver bruksteksten og gir exit 1.
        console.error(formatHelp(SCRIPT, PURPOSE, SPEC, EXAMPLES));
        process.exit(1);
    }

    const bibleLanguageName = bibles[bible];
    if (!bibleLanguageName) {
        console.error(`Unknown bible "${bible}". Known: ${Object.keys(bibles).join(', ')}`);
        process.exit(1);
    }
    const language = getLanguageCode(bibleLanguageName);

    const bibleDir = path.join(SOURCES_DIR, bible);
    if (!fs.existsSync(bibleDir)) {
        console.error(`Bible source not found: ${bibleDir}`);
        process.exit(1);
    }

    const bookRange = flags.book as Range | undefined;
    const chapterRange = flags.chapter as Range | undefined;

    // `--ot`/`--nt` er snarveier for `--book`. Den gamle parseren leste
    // argumentene i rekkefølge og lot det siste vinne; kontrakten beholder ikke
    // rekkefølgen, så et eksplisitt `--book` går foran, og `--nt` foran `--ot`.
    // I praksis brukes de hver for seg, så resultatet er det samme.
    let bookStart = 1;
    let bookEnd = 66;
    if (flags.ot) {
        bookStart = 1;
        bookEnd = 39;
    }
    if (flags.nt) {
        bookStart = 40;
        bookEnd = 66;
    }
    if (bookRange) {
        bookStart = bookRange.start;
        bookEnd = bookRange.end;
    }

    if (chapterRange && bookStart !== bookEnd) {
        console.error('--chapter requires a single book (use --book <id>)');
        process.exit(1);
    }

    // Standarden er lokal — se kommentaren over `SPEC`. `--no-local` er
    // arvtakeren etter `--remote` og er den eneste som slår den av.
    const useLocal = (flags.local as boolean) && !(flags['no-local'] as boolean);
    const force = flags.force as boolean;

    console.log(`Bible: ${bible} (${bibleLanguageName} / ${language})`);
    console.log(`Model: ${useLocal ? `${ollamaModel} (Ollama)` : `${anthropicModel} (Anthropic)`}`);
    console.log(`Books: ${bookStart}-${bookEnd}${chapterRange ? `, chapter ${chapterRange.start}-${chapterRange.end}` : ''}`);

    for (const book of books) {
        if (book.id < bookStart || book.id > bookEnd) continue;
        const bookName = getBookName(book.id, language);
        const startCh = chapterRange?.start ?? 1;
        const endCh = Math.min(chapterRange?.end ?? book.chapters, book.chapters);
        console.log(`\n=== ${bookName} (${book.id}), kapittel ${startCh}-${endCh} ===`);
        for (let ch = startCh; ch <= endCh; ch++) {
            await processChapter(bible, language, book.id, ch, force, useLocal);
        }
    }
}

// Kjører bare når fila startes direkte. Uten vakten kjører jobben ved IMPORT —
// det er grunnen til at days.ts slettet data bare man lastet modulen (#108),
// og det gjør skriptene umulige å teste.
if (import.meta.main) {
    main().catch(err => {
    console.error(err);
    process.exit(1);
});
}
