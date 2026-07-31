import "./env.js";
/**
 * Local triage pass over a translated bible.
 *
 * Runs qwen (free, local) over every verse and scores the translation. Verses that
 * score below the threshold are marked so the expensive Claude passes only have to
 * look at what actually needs attention.
 *
 * Three layers, cheapest first:
 *   1. mechanical   regex checks with no false negatives (digits, empty text,
 *                   leftover Hebrew/Greek, language-specific register slips)
 *   2. peer length  same-language reference translation; a large length deviation
 *                   means content was added or dropped
 *   3. qwen         judgement, with both a same-language peer and a reviewed
 *                   cross-language reference in the prompt
 *
 * The verse's own history is fed back in on every run:
 *   - versions[]      previous translations and why they were replaced
 *   - triage.history  earlier triage verdicts on this verse
 * so a re-run neither repeats a verdict already acted on nor re-proposes something
 * that was deliberately rejected.
 *
 * Two ways to act on a low score:
 *   (default)   mark only — verse gets triage.flagged, nothing else changes
 *   --drop      retire the text: current text moves into versions[], text is cleared,
 *               and the next `bible.mjs` run re-translates it with the rejected
 *               attempts in the prompt. Re-translating costs ~1/16 of proofreading.
 *
 * Usage:
 *   bun generate/triage.ts osen --book 1
 *   bun generate/triage.ts osen --nt --min-score 6 --drop
 *   bun generate/triage.ts osen --book 1-20 --recheck
 */

import * as fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';


import {bibles, books, getTaskModel, getLanguageCode} from './constants.js';
import {callWithRetry, resolveLocalModel} from './llm.js';
import {loadUkvnMapping, UkvnMapper, CrossMapper, ukvnEncode, ukvnDecode} from '../kvn/src/ukvn.js';
import {parseArgs, formatHelp, COMMON_FLAGS} from './cli.js';
import type {FlagSpec, Range} from './cli.js';
import type {Book} from './constants.js';
import type {Chapter, Verse} from '../kvn/src/bible-types.js';

/** Kategoriene et funn kan ha — samme sett som enum-en i TRIAGE_SCHEMA. */
export type TriageCategory =
    | 'omission'
    | 'addition'
    | 'numerals'
    | 'awkward'
    | 'name'
    | 'grammar'
    | 'meaning'
    | 'other';

/** Ett funn: hva slags problem det er, og hva det består i. */
export interface TriageIssue {
    category: TriageCategory;
    detail: string;
}

/** En språkspesifikk regelsjekk i LANGUAGE_CHECKS. */
interface LanguageCheck {
    pattern: RegExp;
    category: TriageCategory;
    detail: string;
}

/** Svaret modellen gir, jf. TRIAGE_SCHEMA. */
interface TriageModelResult {
    score: number;
    issues: TriageIssue[];
}

/** En tidligere dom på verset, slik den arkiveres i `verdict.history`. */
interface TriageHistoryEntry {
    score: number;
    issues: TriageIssue[];
    model: string;
    at: string;
}

/** Dommen som legges på verset som `triage`. */
interface TriageVerdict {
    score: number;
    issues: TriageIssue[];
    flagged: boolean;
    model: string;
    at: string;
    history?: TriageHistoryEntry[];
}

/**
 * Et vers med triage-feltet påhengt.
 *
 * `triage` står ikke i den delte versdatatypen fordi det bare er dette skriptet
 * som skriver og leser det; resten av verset er den delte formen.
 */
interface TriagedVerse extends Verse {
    triage?: TriageVerdict;
}

/** Et peer-treff: teksten, om mappingen var delvis, og hvor den lå. */
interface PeerHit {
    text: string;
    partial: boolean;
    ref: string;
}

/** Oppslagsfunksjonen `createPeerLookup` gir fra seg. */
type PeerLookup = (bookId: number, chapterId: number, verseId: number) => PeerHit | null;

/** Tellerne en kapittelkjøring rapporterer tilbake. */
interface TriageTotals {
    scanned: number;
    flagged: number;
    dropped: number;
    mechanical: number;
}

/**
 * Innstillingene for en kjøring.
 *
 * De tre siste feltene har ingen flagg — `main()` utleder dem av de andre før
 * første kapittel kjøres.
 */
interface TriageOptions {
    bible: string | null;
    model: string | null;
    minScore: number;
    drop: boolean;
    recheck: boolean;
    peer: string | null;
    noPeer: boolean;
    reference: string;
    ot: boolean;
    nt: boolean;
    bookStart: number | null;
    bookEnd: number | null;
    chapterStart: number | null;
    chapterEnd: number | null;
    verseStart: number | null;
    verseEnd: number | null;
    referenceLanguage: string;
    sourceMapping: string;
    peerLookup: PeerLookup;
}

// Same-language comparison translation, per target language. Chosen for closeness in
// register and length: measured against osen, bsb has a median length ratio of 1.00
// (IQR 0.95-1.04), where a cross-language reference like osnb sits at 1.14.
const PEERS: Record<string, string> = {
    en: 'bsb',
    nb: 'dnb30',
    nn: 'dnb30'
};

/**
 * Flaggkontrakten for dette skriptet (#51, #52, #53).
 *
 * `--model` og `--peer` har ingen statisk standardverdi: null betyr «ikke pinnet»,
 * og hva som faktisk brukes utledes av oppgaven (`getTaskModel`) og av målspråket
 * (`PEERS`). Begge deler står derfor i hjelpeteksten i stedet for i `default`.
 *
 * Skriptet har ingen `--local`: triage kjører alltid mot lokal Ollama.
 */
const SPEC: Record<string, FlagSpec> = {
    book: COMMON_FLAGS.book,
    chapter: COMMON_FLAGS.chapter,
    verse: COMMON_FLAGS.verse,
    ot: COMMON_FLAGS.ot,
    nt: COMMON_FLAGS.nt,
    model: {
        kind: 'string',
        help: `pin den lokale modellen (uten flagget: ${getTaskModel('triage')}, eller en større som alt ligger i minnet; OLLAMA_MODEL overstyrer)`,
    },
    'min-score': {kind: 'number', help: 'flagg vers som scorer under dette (0-10)', default: 8},
    drop: {kind: 'boolean', help: 'pensjoner flagget tekst slik at bible.ts oversetter den på nytt (historikken beholdes)'},
    recheck: {kind: 'boolean', help: 'triager på nytt de versene som alt har en dom'},
    peer: {
        kind: 'string',
        help: `oversettelse på samme språk, for lengde og ordvalg (uten flagget, per språk: ${Object.entries(PEERS).map(([k, v]) => `${k}=${v}`).join(', ')})`,
    },
    'no-peer': {kind: 'boolean', help: 'hopp over sammenlikningen mot samme språk'},
    reference: {kind: 'string', help: 'korrekturlest oversettelse på et annet språk, for mening', default: 'osnb'},
    help: COMMON_FLAGS.help,
};

const HELP_EXAMPLES = [
    'bun generate/triage.ts osen --book 1',
    'bun generate/triage.ts osen --nt --min-score 6 --drop',
    'bun generate/triage.ts osen --book 1-20 --recheck',
    '',
    'Oversettelsen oppgis som posisjonsargument: bun generate/triage.ts <bibel> [flagg].',
];

/** Hjelpeteksten, som både `--help` og «mangler bibel» skriver ut. */
function usage(): string {
    return formatHelp(
        'generate/triage.ts',
        'scorer hvert vers med en lokal modell og flagger dem som er verdt å sende til Claude',
        SPEC,
        HELP_EXAMPLES,
    );
}

// Register and convention checks that only make sense for one language.
const LANGUAGE_CHECKS: Record<string, LanguageCheck[]> = {
    en: [
        {
            pattern: /\b(thee|thou|thy|thine|ye|hath|doth|saith|shalt|wilt|whosoever|wherefore|thence|hither|verily|betwixt)\b/i,
            category: 'awkward',
            detail: 'Archaic English that does not belong in a modern translation'
        },
        {
            pattern: /\b(Jehovah|Yahweh)\b/,
            category: 'name',
            detail: 'Divine name rendered inconsistently with the rest of the translation'
        }
    ]
};

export const TRIAGE_SCHEMA = {
    type: 'object',
    properties: {
        score: {type: 'integer'},
        issues: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    category: {
                        type: 'string',
                        enum: ['omission', 'addition', 'numerals', 'awkward', 'name', 'grammar', 'meaning', 'other']
                    },
                    detail: {type: 'string'}
                },
                required: ['category', 'detail']
            }
        }
    },
    required: ['score', 'issues']
};

// --- layer 1: mechanical. No model, no cost, no false negatives. ---

const HEB_GREEK = /[֐-׿Ͱ-Ͽἀ-῿]/;
const LONG_SENTENCE_WORDS = 45;

export function mechanicalIssues(text: string, langCode: string): TriageIssue[] {
    const found: TriageIssue[] = [];
    if (!text || !text.trim()) {
        found.push({category: 'omission', detail: 'Verse text is empty.'});
        return found;
    }

    const digits = text.match(/(?<![\w:])\d[\d,]*(?![\w])/g);
    if (digits) {
        found.push({
            category: 'numerals',
            detail: `Numbers written as digits (${digits.join(', ')}); spell them out for oral reading.`
        });
    }

    if (HEB_GREEK.test(text)) {
        found.push({category: 'other', detail: 'Untranslated Hebrew or Greek characters left in the text.'});
    }

    const longest = Math.max(...text.split(/[.!?;]\s+/).map(s => s.trim().split(/\s+/).length));
    if (longest > LONG_SENTENCE_WORDS) {
        found.push({
            category: 'awkward',
            detail: `Longest sentence is ${longest} words — hard to deliver in one breath when read aloud.`
        });
    }

    for (const check of LANGUAGE_CHECKS[langCode] || []) {
        const m = text.match(check.pattern);
        if (m) found.push({category: check.category, detail: `${check.detail}: "${m[0]}".`});
    }

    return found;
}

// --- layer 2: length against a same-language peer ---

export function lengthOutlier(text: string, peerText: string | undefined): TriageIssue | null {
    if (!peerText || !text) return null;
    const ratio = text.length / peerText.length;
    // Measured spread against bsb is 0.95-1.04; these bounds only catch real outliers.
    if (ratio > 1.7) {
        return {category: 'addition', detail: `${ratio.toFixed(1)}x the length of the reference — content may have been added.`};
    }
    if (ratio < 0.6) {
        return {category: 'omission', detail: `${ratio.toFixed(1)}x the length of the reference — content may have been dropped.`};
    }
    return null;
}

// --- layer 3: prompt ---

export function buildPrompt(
    language: string,
    original: string,
    verse: TriagedVerse,
    peerText: string | undefined,
    referenceText: string | undefined,
    referenceLanguage: string
): string {
    let history = '';
    if (verse.versions?.length) {
        history += `\nEARLIER TRANSLATIONS OF THIS VERSE, already replaced — do NOT ask for any of them back:\n`;
        verse.versions.forEach((v, i) => {
            history += `  ${i + 1}. "${v.text}"\n`;
            if (v.explanation) history += `     replaced because: ${v.explanation}\n`;
        });
    }
    if (verse.triage?.history?.length) {
        history += `\nEARLIER TRIAGE VERDICTS ON THIS VERSE:\n`;
        verse.triage.history.forEach((h, i) => {
            const issues = (h.issues || []).map(x => x.category).join(', ') || 'none';
            history += `  round ${i + 1}: score ${h.score}, issues: ${issues}\n`;
        });
        history += `  If the current text still has that problem, raise it again. If it was fixed, do not.\n`;
    }

    return `You are triaging a ${language} Bible translation before it goes to an expensive expert reviewer.
Decide how much attention this verse needs. Be strict: a high score means the expert can safely skip it.

The translation should be modern and natural ${language}, faithful to the original, and optimized for reading aloud.

Score 0-10:
  9-10  reads well and faithfully, nothing to improve
  6-8   understandable but has a real weakness worth an expert look
  0-5   likely wrong, unclear, or missing/adding content

Report every issue you find, each with a category:
  omission  something in the original is missing from the translation
  addition  the translation says something the original does not
  numerals  a number is written with digits instead of spelled out
  awkward   stilted, archaic, or hard to read aloud
  name      a proper name or term looks wrong or inconsistent
  grammar   grammar or spelling error
  meaning   the sense differs from the original or from both references
  other     anything else

Return an empty issues array if the verse is fine.

The reference translations show how others rendered this verse. They are a check on
meaning and completeness, NOT a wording target — differences in phrasing are expected
and are not by themselves a problem. Only raise an issue if the translation under
review says something materially different, or is missing something both references have.

Original (Hebrew/Greek):
${original}

${language} translation under review:
${verse.text}
${peerText ? `\nAnother ${language} translation:\n${peerText}\n` : ''}${referenceText ? `\nA reviewed ${referenceLanguage} translation:\n${referenceText}\n` : ''}${history}`;
}

// --- core ---

function getOriginalSource(bookId: number): string {
    return bookId <= 39 ? 'hebrew' : 'sblgnt';
}

/**
 * `T` er formen kalleren vet fila har. Innholdet valideres ikke — funksjonen
 * påstår bare typen, akkurat som det utypede `JSON.parse` gjorde før.
 */
function readJson<T = unknown>(file: string): T | null {
    if (!fs.existsSync(file)) return null;
    try {
        return JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch {
        return null;
    }
}

/**
 * Verse-by-verse lookup into a translation that uses a different versification.
 *
 * osen follows the Hebrew/Greek numbering (same as osnb); the English peers follow
 * the common English numbering. They diverge in Psalms (Hebrew counts the
 * superscription), Joel, Malachi, 1 Samuel 21 and elsewhere, so a naive same-number
 * lookup silently compares two different verses. Everything goes through the KVN
 * mapping instead — and a mapped verse can land in another chapter, so chapters are
 * loaded on demand rather than assumed to match.
 */
export function createPeerLookup(peerBible: string | null, sourceMappingId: string): PeerLookup {
    if (!peerBible) return () => null;

    let cross: CrossMapper;
    try {
        const source = new UkvnMapper(loadUkvnMapping(sourceMappingId));
        const target = new UkvnMapper(loadUkvnMapping(peerBible));
        cross = new CrossMapper(source, target);
    } catch (error) {
        console.warn(`No KVN mapping for ${peerBible} or ${sourceMappingId} (${(error as Error).message}) — peer comparison disabled.`);
        return () => null;
    }

    const cache = new Map<string, Chapter>();
    const chapterOf = (bookId: number, chapterId: number): Chapter => {
        const key = `${bookId}/${chapterId}`;
        if (!cache.has(key)) {
            cache.set(key, readJson<Chapter>(`bibles_raw/${peerBible}/${bookId}/${chapterId}.json`) || []);
        }
        // `!` er ren typepåstand: nøkkelen ble nettopp satt hvis den manglet.
        return cache.get(key)!;
    };

    return (bookId, chapterId, verseId) => {
        const mapped = cross.map(ukvnEncode(bookId, chapterId, +verseId));
        if (!mapped?.tkvn) return null;
        const {book, chapter, verse} = ukvnDecode(mapped.tkvn);
        const hit = chapterOf(book, chapter).find(v => +v.verseId === verse);
        if (!hit) return null;
        // A partial mapping means this verse is only part of the peer's verse, so the
        // texts are not directly comparable in length.
        return {text: hit.text, partial: mapped.partial, ref: `${book}:${chapter}:${verse}`};
    };
}

async function triageChapter(bible: string, bookId: number, chapterId: number, options: TriageOptions): Promise<TriageTotals | null> {
    const language = bibles[bible];
    const langCode = getLanguageCode(language);
    const filename = `bibles_raw/${bible}/${bookId}/${chapterId}.json`;
    const verses = readJson<TriagedVerse[]>(filename);
    if (!verses) return null;

    const originals = readJson<Chapter>(`bibles_raw/${getOriginalSource(bookId)}/${bookId}/${chapterId}.json`) || [];
    // The reference shares this bible's versification, so it needs no mapping.
    const references: Chapter = options.reference ? readJson<Chapter>(`bibles_raw/${options.reference}/${bookId}/${chapterId}.json`) || [] : [];

    const scope = verses.filter(v => {
        // `!` på verseEnd: de to settes alltid sammen av --verse, så er den ene
        // ikke-null er den andre det heller.
        if (options.verseStart !== null && (+v.verseId < options.verseStart || +v.verseId > options.verseEnd!)) return false;
        if (!options.recheck && v.triage) return false;
        return true;
    });
    if (scope.length === 0) return null;

    const label = `${(books.find(b => b.id === bookId) || {} as Partial<Book>).name || bookId} ${chapterId}`;
    process.stdout.write(`${label}: ${scope.length} verses`);

    const totals: TriageTotals = {scanned: 0, flagged: 0, dropped: 0, mechanical: 0};

    for (const verse of scope) {
        const original = originals.find(o => +o.verseId === +verse.verseId);
        if (!original) continue;
        const peer = options.peerLookup(bookId, chapterId, verse.verseId);
        const peerText = peer?.text;
        const referenceText = references.find(r => +r.verseId === +verse.verseId)?.text;

        totals.scanned++;

        const issues = mechanicalIssues(verse.text, langCode);
        // Skip the length check on a partial mapping: the peer verse covers more or
        // less material than this one, so the ratio means nothing.
        const outlier = peer && !peer.partial ? lengthOutlier(verse.text, peerText) : null;
        if (outlier) issues.push(outlier);
        if (issues.length) totals.mechanical++;

        let score: number = 10;
        // Modellen løses opp per vers, ikke én gang: en annen jobb kan starte
        // underveis, og da adopterer vi dens modell framfor å kaste den ut. Verdien
        // havner i verse.triage.model, så det er den faktisk brukte som skal lagres.
        let usedModel: string = options.model || getTaskModel('triage');
        if (verse.text && verse.text.trim()) {
            try {
                const prompt = buildPrompt(language, original.text, verse, peerText, referenceText, options.referenceLanguage);
                // `as string | undefined`: llm.js oppgir `model` som valgfri streng,
                // mens options.model er `string | null`. Verdien går uendret videre.
                usedModel = await resolveLocalModel('triage', {model: options.model as string | undefined, schema: TRIAGE_SCHEMA});
                const result = await callWithRetry(prompt, {
                    schema: TRIAGE_SCHEMA,
                    local: true,
                    model: usedModel,
                    context: `triage ${bookId}:${chapterId}:${verse.verseId}`
                }) as TriageModelResult;
                score = typeof result.score === 'number' ? result.score : 10;
                for (const i of result.issues || []) issues.push(i);
            } catch (error) {
                console.warn(`\n  ${bookId}:${chapterId}:${verse.verseId} failed: ${(error as Error).message}`);
                continue;
            }
        } else {
            score = 0;
        }

        // A mechanical finding is certain, so it caps the score no matter what the model said.
        if (issues.some(i => ['numerals', 'omission'].includes(i.category))) {
            score = Math.min(score, options.minScore - 1);
        }

        const previous = verse.triage;
        const verdict: TriageVerdict = {
            score,
            issues,
            flagged: score < options.minScore,
            model: usedModel,
            at: new Date().toISOString()
        };
        if (previous) {
            verdict.history = [
                ...(previous.history || []),
                {score: previous.score, issues: previous.issues, model: previous.model, at: previous.at}
            ];
        }
        verse.triage = verdict;
        if (verdict.flagged) totals.flagged++;

        // --drop: retire the text so bible.mjs re-translates it, keeping the rejected
        // attempt and its reason so the next attempt does not repeat it.
        if (verdict.flagged && options.drop) {
            if (!verse.versions) verse.versions = [];
            verse.versions.push({
                text: verse.text,
                type: 'triage',
                severity: score <= 3 ? 'critical' : 'major',
                explanation: issues.map(i => `[${i.category}] ${i.detail}`).join(' ') || `Triage score ${score}.`
            });
            verse.text = '';
            delete verse.textChecked;
            totals.dropped++;
        }

        fs.writeFileSync(filename, JSON.stringify(verses, null, 2));
    }

    console.log(` → ${totals.flagged} flagged${options.drop ? `, ${totals.dropped} dropped` : ''}${totals.mechanical ? `, ${totals.mechanical} mechanical` : ''}`);
    return totals;
}

async function main(): Promise<void> {
    // Hjelpen skal ut før noe leses fra disk eller sendes over nettet.
    const {flags, positional} = parseArgs(process.argv.slice(2), SPEC);
    if (flags.help) {
        console.log(usage());
        process.exit(0);
    }

    const book = flags.book as Range | undefined;
    const chapter = flags.chapter as Range | undefined;
    const verse = flags.verse as Range | undefined;

    // `as TriageOptions`: referenceLanguage, sourceMapping og peerLookup har ingen
    // flagg og settes lenger nede, etter at argumentene er lest.
    const options = {
        // Bibelen er posisjonsargumentet, som før: `bun generate/triage.ts osen`.
        bible: positional[0] ?? null,
        // model står null med vilje: bare --model skal pinne modellen. Står den
        // fylt ut på forhånd, ser resolveLocalModel det som et pin og lar være å
        // adoptere en modell som alt ligger i minnet.
        model: (flags.model as string | undefined) ?? null,
        minScore: flags['min-score'] as number,
        drop: flags.drop as boolean,
        recheck: flags.recheck as boolean,
        peer: (flags.peer as string | undefined) ?? null,
        noPeer: flags['no-peer'] as boolean,
        reference: flags.reference as string,
        ot: flags.ot as boolean,
        nt: flags.nt as boolean,
        bookStart: book?.start ?? null,
        bookEnd: book?.end ?? null,
        chapterStart: chapter?.start ?? null,
        chapterEnd: chapter?.end ?? null,
        verseStart: verse?.start ?? null,
        verseEnd: verse?.end ?? null,
    } as TriageOptions;

    if (!options.bible) {
        console.log(usage());
        process.exit(1);
    }
    if (!bibles[options.bible]) {
        console.error(`Unknown bible '${options.bible}'. Known: ${Object.keys(bibles).join(', ')}`);
        process.exit(1);
    }

    const language = bibles[options.bible];
    const langCode = getLanguageCode(language);
    if (options.noPeer) options.peer = null;
    else if (!options.peer) options.peer = PEERS[langCode] || null;
    if (options.peer === options.bible) options.peer = null;
    options.referenceLanguage = bibles[options.reference] || 'reviewed';
    // osen shares osnb's versification (Hebrew/Greek numbering), so osnb's KVN
    // mapping describes this bible too.
    options.sourceMapping = options.sourceMapping || 'osnb';
    options.peerLookup = createPeerLookup(options.peer, options.sourceMapping);

    let startBook = 1, endBook = 66;
    // `!` på bookEnd: parseRange setter alltid begge, så er start ikke-null er end det heller.
    if (options.bookStart !== null) { startBook = options.bookStart; endBook = options.bookEnd!; }
    else if (options.ot && !options.nt) endBook = 39;
    else if (options.nt && !options.ot) startBook = 40;

    console.log(`Bible: ${options.bible} (${language})`);
    console.log(`Model: ${options.model || `${getTaskModel('triage')} (eller en større som alt ligger i minnet)`} (local)`);
    console.log(`Peer: ${options.peer || 'none'} | Reference: ${options.reference || 'none'}`);
    console.log(`Flagging below score ${options.minScore}${options.drop ? ', dropping flagged text for re-translation' : ''}`);
    console.log('---');

    const totals: TriageTotals = {scanned: 0, flagged: 0, dropped: 0, mechanical: 0};
    for (let bookId = startBook; bookId <= endBook; bookId++) {
        const book = books.find(b => b.id === bookId);
        if (!book) continue;
        const first = options.chapterStart || 1;
        const last = Math.min(options.chapterEnd || book.chapters, book.chapters);
        for (let chapterId = first; chapterId <= last; chapterId++) {
            const r = await triageChapter(options.bible, bookId, chapterId, options);
            // `as`: Object.keys gir string[], men nøklene er nettopp TriageTotals'.
            if (r) for (const k of Object.keys(totals) as (keyof TriageTotals)[]) totals[k] += r[k] || 0;
        }
    }

    const pct = totals.scanned ? (totals.flagged / totals.scanned * 100).toFixed(0) : 0;
    console.log('---');
    console.log(`Scanned ${totals.scanned}, flagged ${totals.flagged} (${pct}%), mechanical findings on ${totals.mechanical}${options.drop ? `, dropped ${totals.dropped}` : ''}`);
    if (totals.flagged) {
        console.log(options.drop
            ? `Re-translate with: bun bible.ts ${options.bible} --style oral`
            : `Flagged verses carry triage.flagged — proofread only those.`);
    }
}

// Bare kjør CLI-en når fila startes direkte — de eksporterte funksjonene skal kunne
// importeres (f.eks. av evalueringsskript) uten at main() går i gang.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    // Avslutt med kode 1, ikke 0: et ukjent flagg skal stoppe et køskript, ikke
    // bare skrive en linje det ingen leser. Tidligere var dette
    // `.catch(console.error)`, som ga kode 0. Samme mønster som references.ts.
    main().catch(err => {
        console.error(err);
        process.exit(1);
    });
}
