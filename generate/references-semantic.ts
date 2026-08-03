import "./env.js";
import * as fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';

import {books, getBookName} from './constants.js';
import {getRef} from './lib.js';
import {callWithRetry} from './llm.js';
import {hasEmbeddings, buildEmbeddings, loadEmbeddings, topK, topKByIndex, embedQuery} from './embeddings.js';
import {parseArgs, formatHelp, COMMON_FLAGS} from './cli.js';
import type {FlagSpec, Range} from './cli.js';
import type {EmbeddingItem, EmbeddingState, TopKResult} from './embeddings.js';
import type {Chapter, Verse} from '../kvn/src/bible-types.js';

/** En kryssreferanse slik den lagres i references/nb/<bok>/<kapittel>/<vers>.json. */
interface SemanticReference {
    bookId: number;
    chapterId: number;
    fromVerseId: number;
    toVerseId: number;
    text: string;
}

/** Hele innholdet i en slik referansefil. */
interface ReferencesFile {
    bookId: number;
    chapterId: number;
    verseId: number;
    references: SemanticReference[];
}

/** Ett svar per kandidat, jf. VERIFY_SCHEMA. */
export interface VerifyResult {
    id: number;
    analysis: string;
    accept: boolean;
    note: string;
}

/** Tellerne `verifyVerse` rapporterer for ett vers. */
interface VerifyTotals {
    found: number;
    /** Av `found`: hvor mange kandidater modellen faktisk sa noe om. */
    answered: number;
    kept: number;
    total: number;
    coverage: VerdictCoverage;
}

/**
 * Hva modellen faktisk svarte på, målt mot kandidatlista vi sendte (#122).
 *
 * Prompten ber om «alltid alle N, i samme rekkefølge», men skjemaet kan ikke
 * uttrykke det — arrayen har verken `minItems` eller `maxItems` — så det er en
 * oppfordring, ikke en garanti. Uten denne målingen ser et vers der modellen
 * tidde om tolv kandidater ut nøyaktig som et vers der den avviste tolv.
 */
export interface VerdictCoverage {
    /** Antall kandidater vi ba om svar på. */
    asked: number;
    /** Unike id-er i 0..asked-1 som fikk et svar. */
    answered: number;
    /** Id-ene som aldri ble besvart, stigende. */
    missing: number[];
    /** Id-er utenfor 0..asked-1 — svar på noe vi ikke spurte om. */
    outOfRange: number[];
    /** Id-er besvart mer enn én gang. */
    duplicated: number[];
}

/** Innstillingene for en kjøring, slik `readOptions` leser dem. */
interface SemanticOptions {
    buildOnly: boolean;
    verifyOnly: boolean;
    topK: number;
    threshold: number;
    neighborSkip: number;
    useTheme: boolean;
    useConcepts: boolean;
    resume: boolean;
    retryIncomplete: boolean;
    skipExisting: boolean;
    bookStart: number | null;
    bookEnd: number | null;
    chapterStart: number | null;
    chapterEnd: number | null;
    verseStart: number | null;
    verseEnd: number | null;
    force: boolean;
}

/**
 * Flaggkontrakten for dette skriptet (#51, #52, #53).
 *
 * Ingen `--local`: hele jobben er lokal per konstruksjon — bge-m3 for vektorene
 * og `local: true` i hvert `callWithRetry`-kall her i fila. Det er ikke et valg
 * kommandolinja skal kunne snu.
 *
 * `--threshold` er `string` og ikke `number` fordi kontraktens `number` er
 * `parseInt`: «0.60» ville blitt 0, altså ingen terskel i det hele tatt, uten at
 * noe klaget. Verdien tolkes med `parseFloat` i `readOptions`.
 */
const SPEC: Record<string, FlagSpec> = {
    'build-only': {kind: 'boolean', help: 'bygg bare vektorene, hopp over verifiseringen'},
    // Navnet villeder: flagget hopper BARE over vektorbyggingen. Kandidatene
    // verifiseres og referansene skrives uansett. Og finnes vektorene alt, gjør
    // flagget ingenting — den andre grenen hopper over bygget likevel.
    'verify-only': {kind: 'boolean', help: 'hopp over vektorbyggingen (referanser skrives uansett — vektorene bygges bare når de mangler)'},
    'top-k': {kind: 'number', help: 'antall kandidater per vers', default: 10},
    threshold: {kind: 'string', help: 'minste cosinuslikhet (bge-m3 gir beslektede vers 0.60–0.70)', default: '0.60'},
    'neighbor-skip': {kind: 'number', help: 'hopp over vers i samme kapittel innenfor N', default: 5},
    theme: {kind: 'boolean', help: 'la modellen oppsummere verset og søk også på oppsummeringen'},
    concepts: {kind: 'boolean', help: 'la modellen lage 4 fasettspørsmål og søk på hvert av dem'},
    resume: {kind: 'boolean', help: 'hopp over vers som alt er kjørt (embeddings/<korpus>/semantic_progress.json)'},
    'retry-incomplete': {kind: 'boolean', help: 'ta med de av dem igjen der modellen lot kandidater stå ubesvart (krever --resume)'},
    'skip-existing': {kind: 'boolean', help: 'hopp over vers som alt har en referansefil'},
    book: COMMON_FLAGS.book,
    chapter: COMMON_FLAGS.chapter,
    verse: COMMON_FLAGS.verse,
    force: {kind: 'boolean', help: 'bygg vektorene på nytt (rører ikke referansefilene — fletting bevarer alltid det som finnes)'},
    help: COMMON_FLAGS.help,
};

const HELP_EXAMPLES = [
    'bun generate/references-semantic.ts --build-only',
    'bun generate/references-semantic.ts --verify-only --book 42 --chapter 19',
    'bun generate/references-semantic.ts --verify-only --resume',
    'bun generate/references-semantic.ts --top-k 10 --threshold 0.78',
    '',
    'Verifiserte par flettes inn i references/nb/<bok>/<kapittel>/<vers>.json.',
];

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const EMBED_MODEL = 'bge-m3';
const CORPUS = 'osnb';
/** Språket korpuset er på — boknavn i prompten skal være på det, ikke engelsk. */
const CORPUS_LANGUAGE = 'Norwegian bokmål';
const REFERENCES_LANG_DIR = path.join(__dirname, 'references', 'nb');
const PROGRESS_FILE = path.join(__dirname, 'embeddings', CORPUS, 'semantic_progress.json');

function verseKey(v: Verse): string { return `${v.bookId}-${v.chapterId}-${v.verseId}`; }

/**
 * Framdriften for `--resume`.
 *
 * `incomplete` er delmengden av `processed` der modellen lot kandidater stå
 * ubesvart. Uten den låser `--resume` hullene inne: verset er merket behandlet,
 * og ingenting i dataene antyder at kandidatene fortjener et nytt forsøk (#122).
 */
export interface Progress {
    processed: Set<string>;
    incomplete: Set<string>;
}

/** Tåler både den gamle formen (`{processed}`) og søppel. */
export function parseProgress(raw: unknown): Progress {
    const data = (raw && typeof raw === 'object' ? raw : {}) as {processed?: unknown; incomplete?: unknown};
    const list = (v: unknown): string[] => Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [];
    return {processed: new Set(list(data.processed)), incomplete: new Set(list(data.incomplete))};
}

export function serializeProgress(progress: Progress): {processed: string[]; incomplete: string[]} {
    return {processed: [...progress.processed], incomplete: [...progress.incomplete]};
}

/** Skal verset kjøres i denne `--resume`-kjøringen? */
export function isPending(key: string, progress: Progress, retryIncomplete: boolean): boolean {
    if (!progress.processed.has(key)) return true;
    return retryIncomplete && progress.incomplete.has(key);
}

function loadProgress(): Progress {
    if (!fs.existsSync(PROGRESS_FILE)) return parseProgress(null);
    try {
        return parseProgress(JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8')));
    } catch {
        return parseProgress(null);
    }
}

function saveProgress(progress: Progress): void {
    const dir = path.dirname(PROGRESS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, {recursive: true});
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify(serializeProgress(progress), null, 2));
}

const THEME_SCHEMA = {
    type: 'object',
    properties: {theme: {type: 'string'}},
    required: ['theme'],
    additionalProperties: false
};

const CONCEPTS_SCHEMA = {
    type: 'object',
    properties: {
        queries: {
            type: 'array',
            items: {type: 'string'}
        }
    },
    required: ['queries'],
    additionalProperties: false
};

/**
 * Skjemaet dommeren svarer i.
 *
 * **`results` har med vilje verken `minItems` eller `maxItems`.** Prompten ber om
 * «alltid alle N», og det er alt vi har — skjemaet kan ikke uttrykke kravet, så
 * kallstedet MÅ måle svaret i stedet (`coverageOf`, #122).
 *
 * Grenser ble vurdert og lagt bort inntil noen har målt dem. To ting å vite:
 *
 * - Argumentet om at grenser lukker skjemaet er **feil**. `isClosedSchema` ser
 *   på `items` også, og `analysis` og `note` er fritekst. Målt:
 *   `isClosedSchema` er `false` både med og uten grensene, og blir `true` først
 *   hvis fritekstfeltene fjernes. Grenser endrer altså ingenting for hvilke
 *   modeller `resolveLocalModel` kan adoptere.
 * - Det som gjenstår å måle er genereringen: `minItems` forbyr grammatikken å
 *   avslutte arrayen før N, og feilmodusen her er nettopp trunkering på slutten
 *   («Unterminated string»). Grensen kan derfor gjøre et delvis svar om til et
 *   mislykket kall. Mål med `eval-judges.ts` på begge skjemaene før den innføres.
 */
export const VERIFY_SCHEMA = {
    type: 'object',
    properties: {
        results: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    id: {type: 'integer'},
                    analysis: {type: 'string'},
                    accept: {type: 'boolean'},
                    note: {type: 'string'}
                },
                required: ['id', 'analysis', 'accept', 'note'],
                additionalProperties: false
            }
        }
    },
    required: ['results'],
    additionalProperties: false
};

/**
 * Hvor mye av kandidatlista modellen faktisk svarte på.
 *
 * Uten dette er «avvist» og «aldri vurdert» det samme tallet: begge gir ingen
 * referanse, og `found`/`kept` ser like ut i begge tilfeller. Forskjellen er
 * hele grunnlaget for å sammenlikne dommermodeller — en modell som svarer på 1
 * av 13 og godtar den ene ser ellers ut som den mest presise i feltet.
 */
export function coverageOf(results: Array<{id: number}> | null | undefined, asked: number): VerdictCoverage {
    const seen = new Set<number>();
    const duplicated: number[] = [];
    const outOfRange: number[] = [];

    for (const r of results || []) {
        const id = r?.id;
        if (!Number.isInteger(id) || id < 0 || id >= asked) {
            outOfRange.push(id);
            continue;
        }
        if (seen.has(id)) {
            if (!duplicated.includes(id)) duplicated.push(id);
            continue;
        }
        seen.add(id);
    }

    const missing: number[] = [];
    for (let i = 0; i < asked; i++) if (!seen.has(i)) missing.push(i);

    return {asked, answered: seen.size, missing, outOfRange, duplicated};
}

/**
 * Svarene som skal bli til referanser: godtatt, innenfor lista, én per kandidat.
 *
 * Både skrivestien og eval-judges plukket dem hver for seg med samme
 * `if (!c) continue`. Den fanger en id utenfor lista, men ikke den samme id-en
 * to ganger — og i eval-judges endte den doble opp i tallet vi velger dommer
 * etter, mens den her ble to like poster som `mergeReferences` siden slo sammen.
 */
export function acceptedVerdicts<T, R extends {id: number; accept: boolean}>(
    results: R[] | null | undefined,
    candidates: T[],
): Array<{candidate: T; verdict: R}> {
    const taken = new Set<number>();
    const out: Array<{candidate: T; verdict: R}> = [];
    for (const r of results || []) {
        if (!r?.accept || taken.has(r.id)) continue;
        const candidate = candidates[r.id];
        if (!candidate) continue;
        taken.add(r.id);
        out.push({candidate, verdict: r});
    }
    return out;
}

/**
 * `[1,2,3,7]` → `1-3,7`.
 *
 * Intervaller og ikke en liste, fordi tapet ikke er tilfeldig fordelt:
 * feilmodusen er trunkering på slutten av genereringen, så det er de SISTE
 * id-ene som mangler. En sammenhengende hale i logglinja er selve signaturen.
 */
function formatIdRanges(ids: number[]): string {
    const parts: string[] = [];
    for (let i = 0; i < ids.length;) {
        let j = i;
        while (j + 1 < ids.length && ids[j + 1] === ids[j] + 1) j++;
        parts.push(i === j ? `${ids[i]}` : `${ids[i]}-${ids[j]}`);
        i = j + 1;
    }
    return parts.join(',');
}

/** Én linje til operatøren, eller `null` når modellen svarte på alt. */
export function formatCoverage(cov: VerdictCoverage): string | null {
    const notes: string[] = [];
    if (cov.missing.length) notes.push(`no verdict for id ${formatIdRanges(cov.missing)}`);
    if (cov.outOfRange.length) notes.push(`id outside the list: ${cov.outOfRange.join(',')}`);
    if (cov.duplicated.length) notes.push(`answered twice: ${formatIdRanges(cov.duplicated)}`);
    if (!notes.length) return null;
    return `answered ${cov.answered} of ${cov.asked} — ${notes.join('; ')}`;
}

/** Tallene en kjøring ender med. */
export interface RunTotals {
    verses: number;
    candidates: number;
    answered: number;
    accepted: number;
    incompleteVerses: number;
    outOfRange: number;
    resume: boolean;
}

/**
 * Sluttoppsummeringen.
 *
 * Godtatt-andelen regnes av BESVARTE og ikke av kandidater. Den gamle linja
 * («Total candidates: 13, accepted: 1 (8%)») blandet to helt ulike utsagn om
 * modellen — «den avviste tolv» og «den svarte ikke på tolv» — og det er den
 * linja modellvalget ble tatt på.
 */
export function formatRunSummary(t: RunTotals): string {
    const pct = (n: number, of: number): number => of > 0 ? Math.round(n * 100 / of) : 0;
    const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`;
    const lines = [
        `Done. ${plural(t.verses, 'verse')}, ${plural(t.candidates, 'candidate')}.`,
        `Answered: ${t.answered}${t.answered < t.candidates ? ` (${pct(t.answered, t.candidates)}% of candidates)` : ''}.`,
        `Accepted: ${t.accepted} (${pct(t.accepted, t.answered)}% of answered).`,
    ];
    if (t.answered < t.candidates) {
        lines.push(`${plural(t.candidates - t.answered, 'candidate')} unanswered across ${plural(t.incompleteVerses, 'verse')} — the model said nothing about them, which is not the same as rejecting them.`);
        if (t.resume) lines.push('Re-run with --resume --retry-incomplete to ask again for those verses.');
    }
    if (t.outOfRange) lines.push(`${plural(t.outOfRange, 'verdict')} named a candidate that was not in the list, and ${t.outOfRange === 1 ? 'was' : 'were'} dropped.`);
    return lines.join('\n');
}

function loadAllOsnb2Verses(): Verse[] {
    const all: Verse[] = [];
    for (const book of books) {
        for (let ch = 1; ch <= book.chapters; ch++) {
            const file = path.join(__dirname, 'bibles_raw', 'osnb', `${book.id}`, `${ch}.json`);
            if (!fs.existsSync(file)) continue;
            const verses = JSON.parse(fs.readFileSync(file, 'utf-8')) as Chapter;
            for (const v of verses) {
                all.push({
                    bookId: +v.bookId,
                    chapterId: +v.chapterId,
                    verseId: +v.verseId,
                    text: v.text
                });
            }
        }
    }
    return all;
}

/**
 * Boknavn i PROMPTEN, på korpusets eget språk.
 *
 * `getRef` gir engelske navn — den bygger på `books[].name`, som er
 * identifikatorer og ikke visningstekst. Det var greit i logglinjer, men
 * kandidatlista her går til en modell som blir bedt om å skrive et NORSK notat,
 * og modellen skrev av det den så: «1 Chronicles 6:34 fungerer som en teologisk
 * kontrast …» endte som referansetekst i `references/nb`. 1 047 av 4 112 notater
 * fra kjøringen 2026-08-01 fikk engelsk boknavn i norsk prosa på denne måten.
 *
 * Logglinjene under bruker fortsatt `getRef` med vilje — de leses av en operatør,
 * ikke av en modell.
 */
function promptRef(bookId: number, chapterId: number, verseId: number): string {
    return `${getBookName(bookId, CORPUS_LANGUAGE)} ${chapterId}:${verseId}`;
}

export function buildVerifyPrompt(sourceVerse: Verse, candidates: Verse[]): string {
    const candList = candidates.map((c, i) =>
        `[${i}] ${promptRef(c.bookId, c.chapterId, c.verseId)}: ${c.text}`
    ).join('\n');

    return `Du er en bibelforsker som vurderer kryssreferanser. Ta deg tid til å tenke grundig gjennom hver kandidat.

KILDEVERS:
${promptRef(sourceVerse.bookId, sourceVerse.chapterId, sourceVerse.verseId)}: ${sourceVerse.text}

KANDIDATER (funnet via semantisk likhet — må verifiseres):
${candList}

KONTEKST OG MÅL:
Disse kandidatene kommer fra vektorsøk, ikke fra standard kryssreferansesystem. Målet er å avdekke ekte tematiske, teologiske eller fortellingsmessige parallelle som beriker leserens forståelse — også de som ikke står i tradisjonelle kryssreferanseverk. Vi vil heller ha 1 dyptgripende referanse enn 5 grunne.

For HVER kandidat (alltid alle ${candidates.length}, i samme rekkefølge), returner:
- id: 0-basert indeks
- analysis: 2-3 setninger der du EKSPLISITT vurderer: (a) hva har versene felles på overflaten? (b) hva har de felles teologisk/tematisk? (c) belyser de hverandre, eller er likheten kun ord? Dette er din resonering — vær konkret.
- accept: true KUN hvis analysen viser reell teologisk/tematisk kobling. false hvis kun overflate-likhet.
- note: én kort norsk setning. Ved accept=true: beskriv koblingen konkret (lagres som referanse-tekst — ikke gjengi kandidatens innhold, forklar hvordan versene belyser hverandre). Ved accept=false: kort grunn til avvisning.

KRITERIER FOR ACCEPT=true:
- Samme hendelse fortalt i flere bøker
- Samme person eller motiv på tvers av tekster
- Direkte sitat eller tydelig allusjon
- Oppfyllelse av profeti, eller profetisk forløper
- Tematisk parallell der versene gjensidig belyser hverandre teologisk
- Tydelig kontrast/motsats med teologisk poeng

KRITERIER FOR ACCEPT=false:
- Felles enkeltord eller imperativ (kom, ned, bli, spis, gå, skynd) UTEN tematisk substans
- Ulik kontekst, person, hendelse, eller teologisk poeng
- Bare overflateklang uten reell kobling
- Banale paralleller som "begge handler om Jesus som snakker"

Vær villig til å avvise ALLE kandidater hvis ingen er ekte. En tom referanseliste er bedre enn dårlige referanser.`;
}

function refKey(bookId: number, chapterId: number, fromVerseId: number, toVerseId: number): string {
    return `${bookId}-${chapterId}-${fromVerseId}-${toVerseId}`;
}

function mergeReferences(existing: SemanticReference[], fresh: SemanticReference[]): SemanticReference[] {
    const seen = new Set<string>();
    const merged: SemanticReference[] = [];
    for (const r of existing) {
        const k = refKey(r.bookId, r.chapterId, r.fromVerseId, r.toVerseId);
        if (!seen.has(k)) { seen.add(k); merged.push(r); }
    }
    for (const r of fresh) {
        const k = refKey(r.bookId, r.chapterId, r.fromVerseId, r.toVerseId);
        if (!seen.has(k)) { seen.add(k); merged.push(r); }
    }
    return merged;
}

async function extractConcepts(verse: Verse): Promise<string[]> {
    const prompt = `Du er bibelforsker. Dette verset skal kobles med ekte kryssreferanser. Generer 4 søkespørsmål som hver fanger en *fasett* av verset — f.eks. teologisk hovedtema, narrativ kontekst, person eller motiv, profetisk sammenheng, kontrasterende ide, etc. Hvert spørsmål skal være en kort norsk setning (15-25 ord) som beskriver hva slags vers vi leter etter for å belyse denne fasetten.

VERS: ${verse.text}

Returner 4 søkespørsmål som dekker forskjellige fasetter — ikke parafraser, men *hva slags annet vers ville utdype dette*.`;
    const result = await callWithRetry(prompt, {
        schema: CONCEPTS_SCHEMA,
        local: true,
        task: 'references',
        context: `concepts ${verse.bookId}:${verse.chapterId}:${verse.verseId}`
    }) as {queries?: string[]};
    return result.queries || [];
}

async function extractTheme(verse: Verse): Promise<string> {
    const prompt = `Du er bibelforsker. Skriv en kort tematisk oppsummering (2-3 setninger på norsk) av kjernekonseptene, teologien og de sentrale motivene i dette verset. Tenk: hvilke teologiske begreper, motiver, personer og handlinger gjør verset til det det er? Vær konkret og presis — denne oppsummeringen brukes til å finne tematisk parallelle vers.

VERS: ${verse.text}`;
    const result = await callWithRetry(prompt, {
        schema: THEME_SCHEMA,
        local: true,
        task: 'references',
        context: `theme ${verse.bookId}:${verse.chapterId}:${verse.verseId}`
    }) as {theme: string};
    return result.theme;
}

async function verifyVerse(verse: EmbeddingItem<Verse>, state: EmbeddingState<Verse>, options: SemanticOptions): Promise<VerifyTotals> {
    const outFile = path.join(REFERENCES_LANG_DIR, `${verse.bookId}`, `${verse.chapterId}`, `${verse.verseId}.json`);

    let existing: ReferencesFile | null = null;
    if (fs.existsSync(outFile)) {
        try { existing = JSON.parse(fs.readFileSync(outFile, 'utf-8')) as ReferencesFile; } catch { /* corrupt — ignore */ }
    }

    const skip = options.neighborSkip || 0;
    const filter = (item: EmbeddingItem<Verse>): boolean => {
        if (skip > 0 && item.bookId === verse.bookId && item.chapterId === verse.chapterId
            && Math.abs(item.verseId - verse.verseId) <= skip) {
            return false;
        }
        return true;
    };

    // Text-based candidates
    const textCands = topKByIndex(state, verse.idx, {
        k: options.topK,
        threshold: options.threshold,
        filter
    });

    // Theme-based candidates (if enabled)
    let themeCands: TopKResult[] = [];
    if (options.useTheme) {
        try {
            const theme = await extractTheme(verse);
            const themeQuery = await embedQuery(state, theme);
            themeCands = topK(state, themeQuery, {
                k: options.topK,
                threshold: options.threshold,
                filter: (item) => filter(item) && item.idx !== verse.idx
            });
        } catch (err) {
            console.warn(`\n  Theme extraction failed for ${getRef(verse.bookId, verse.chapterId, verse.verseId)}: ${(err as Error).message}`);
        }
    }

    // Concept-question candidates (if enabled): LLM generates 4 facet-queries, each gets top-K/2
    let conceptCands: TopKResult[] = [];
    if (options.useConcepts) {
        try {
            const queries = await extractConcepts(verse);
            const perQuery = Math.max(3, Math.ceil(options.topK / queries.length));
            for (const q of queries) {
                const qEmb = await embedQuery(state, q);
                const got = topK(state, qEmb, {
                    k: perQuery,
                    threshold: options.threshold,
                    filter: (item) => filter(item) && item.idx !== verse.idx
                });
                conceptCands.push(...got);
            }
        } catch (err) {
            console.warn(`\n  Concepts extraction failed for ${getRef(verse.bookId, verse.chapterId, verse.verseId)}: ${(err as Error).message}`);
        }
    }

    // Merge unique candidates from all sources
    const seenIdx = new Set<number>();
    const candidates: TopKResult[] = [];
    for (const c of [...textCands, ...themeCands, ...conceptCands]) {
        if (!seenIdx.has(c.idx)) { seenIdx.add(c.idx); candidates.push(c); }
    }

    if (candidates.length === 0) {
        return {found: 0, answered: 0, kept: 0, total: existing?.references?.length || 0, coverage: coverageOf([], 0)};
    }

    const candidateItems = candidates.map(c => state.items[c.idx]);
    const prompt = buildVerifyPrompt(verse, candidateItems);

    let result: {results?: VerifyResult[]};
    try {
        result = await callWithRetry(prompt, {
            schema: VERIFY_SCHEMA,
            local: true,
            task: 'references',
            context: `verify ${verse.bookId}:${verse.chapterId}:${verse.verseId}`
        }) as {results?: VerifyResult[]};
    } catch (err) {
        console.warn(`\n  Failed verify ${getRef(verse.bookId, verse.chapterId, verse.verseId)}: ${(err as Error).message}`);
        return {
            found: candidates.length, answered: 0, kept: 0,
            total: existing?.references?.length || 0,
            coverage: coverageOf(null, candidates.length),
        };
    }

    // Et kall som lyktes og en JSON som validerte betyr ikke at alle kandidatene
    // ble vurdert. Måles her, mens vi ennå vet hvor mange vi spurte om (#122).
    const coverage = coverageOf(result.results, candidateItems.length);
    const gap = formatCoverage(coverage);
    if (gap) console.warn(`\n  ${getRef(verse.bookId, verse.chapterId, verse.verseId)}: ${gap}`);

    const fresh: SemanticReference[] = acceptedVerdicts(result.results, candidateItems).map(({candidate, verdict}) => ({
        bookId: candidate.bookId,
        chapterId: candidate.chapterId,
        fromVerseId: candidate.verseId,
        toVerseId: candidate.verseId,
        text: verdict.note,
    }));

    const merged = mergeReferences(existing?.references || [], fresh);

    const outDir = path.dirname(outFile);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, {recursive: true});
    fs.writeFileSync(outFile, JSON.stringify({
        bookId: verse.bookId,
        chapterId: verse.chapterId,
        verseId: verse.verseId,
        references: merged
    }, null, 2));

    return {found: candidates.length, answered: coverage.answered, kept: fresh.length, total: merged.length, coverage};
}

/** Oversetter de tolkede flaggene til `SemanticOptions`. */
function readOptions(flags: ReturnType<typeof parseArgs>['flags']): SemanticOptions {
    const book = flags.book as Range | undefined;
    const chapter = flags.chapter as Range | undefined;
    const verse = flags.verse as Range | undefined;

    const threshold = parseFloat(flags.threshold as string);
    if (Number.isNaN(threshold)) {
        throw new Error(`--threshold: «${flags.threshold}» er ikke et tall`);
    }

    return {
        buildOnly: flags['build-only'] as boolean,
        verifyOnly: flags['verify-only'] as boolean,
        topK: flags['top-k'] as number,
        threshold,
        neighborSkip: flags['neighbor-skip'] as number,
        useTheme: flags.theme as boolean,
        useConcepts: flags.concepts as boolean,
        resume: flags.resume as boolean,
        retryIncomplete: flags['retry-incomplete'] as boolean,
        skipExisting: flags['skip-existing'] as boolean,
        bookStart: book?.start ?? null,
        bookEnd: book?.end ?? null,
        chapterStart: chapter?.start ?? null,
        chapterEnd: chapter?.end ?? null,
        verseStart: verse?.start ?? null,
        verseEnd: verse?.end ?? null,
        force: flags.force as boolean,
    };
}

async function main(): Promise<void> {
    // `-h` var et alias for `--help` i den gamle parseren. Kontrakten kjenner bare
    // lange flagg, så den oversettes her framfor å bli borte.
    const argv = process.argv.slice(2).map(a => a === '-h' ? '--help' : a);

    // Hjelpen skal ut før noe leses fra disk eller sendes til Ollama.
    const {flags} = parseArgs(argv, SPEC);
    if (flags.help) {
        console.log(formatHelp(
            'generate/references-semantic.ts',
            'semantiske kryssreferanser for osnb: bygger vektorer med bge-m3, henter topp-K kandidater per vers og lar en lokal modell verifisere hver enkelt',
            SPEC,
            HELP_EXAMPLES,
        ));
        process.exit(0);
    }

    const opts = readOptions(flags);

    const verses = loadAllOsnb2Verses();
    console.log(`Loaded ${verses.length} osnb verses`);

    if (!opts.verifyOnly) {
        if (opts.force || !hasEmbeddings(CORPUS)) {
            console.log(`Building embeddings (model: ${EMBED_MODEL}, corpus: ${CORPUS})...`);
            await buildEmbeddings({
                corpus: CORPUS,
                items: verses,
                model: EMBED_MODEL,
                getText: v => v.text,
                batchSize: 32,
                force: opts.force
            });
        } else {
            console.log(`Embeddings already exist for "${CORPUS}" (use --force to rebuild)`);
        }
    }

    if (opts.buildOnly) return;

    const state = loadEmbeddings<Verse>(CORPUS);
    console.log(`Loaded ${state.items.length} embeddings (dim ${state.dim}, model ${state.model})`);

    // `!` på ...End: parseRange setter alltid begge, så er den ene ikke-null er den andre det også.
    const inScope = (v: Verse): boolean => {
        if (opts.bookStart !== null && (v.bookId < opts.bookStart || v.bookId > opts.bookEnd!)) return false;
        if (opts.chapterStart !== null && (v.chapterId < opts.chapterStart || v.chapterId > opts.chapterEnd!)) return false;
        if (opts.verseStart !== null && (v.verseId < opts.verseStart || v.verseId > opts.verseEnd!)) return false;
        return true;
    };

    const progress: Progress = opts.resume ? loadProgress() : parseProgress(null);
    const allInScope = state.items.filter(inScope);
    let versesToProcess = allInScope;

    if (opts.resume) {
        versesToProcess = versesToProcess.filter(v => isPending(verseKey(v), progress, opts.retryIncomplete));
    } else if (opts.retryIncomplete) {
        console.warn('--retry-incomplete does nothing without --resume — the incomplete verses are recorded in the progress file.');
    }
    if (opts.skipExisting) {
        versesToProcess = versesToProcess.filter(v => {
            const f = path.join(REFERENCES_LANG_DIR, `${v.bookId}`, `${v.chapterId}`, `${v.verseId}.json`);
            return !fs.existsSync(f);
        });
    }

    const flagInfo = [];
    if (opts.resume) {
        flagInfo.push(`resume: ${progress.processed.size} done`
            + (progress.incomplete.size ? `, ${progress.incomplete.size} incomplete` : ''));
    }
    if (opts.retryIncomplete) flagInfo.push('retry-incomplete');
    if (opts.skipExisting) flagInfo.push('skip-existing');
    if (opts.useTheme) flagInfo.push('+theme');
    if (opts.useConcepts) flagInfo.push('+concepts');
    console.log(`Verifying ${versesToProcess.length}/${allInScope.length} verses (top-${opts.topK}, threshold ${opts.threshold}, neighbor-skip ${opts.neighborSkip}${flagInfo.length ? ', ' + flagInfo.join(', ') : ''})`);

    const totals: RunTotals = {
        verses: 0, candidates: 0, answered: 0, accepted: 0,
        incompleteVerses: 0, outOfRange: 0, resume: opts.resume,
    };
    for (let i = 0; i < versesToProcess.length; i++) {
        const v = versesToProcess[i];
        const {found, answered, kept, total, coverage} = await verifyVerse(v, state, opts);
        totals.verses++;
        totals.candidates += found;
        totals.answered += answered;
        totals.accepted += kept;
        totals.outOfRange += coverage.outOfRange.length;
        const incomplete = coverage.missing.length > 0;
        if (incomplete) totals.incompleteVerses++;
        if (opts.resume) {
            const key = verseKey(v);
            progress.processed.add(key);
            // Merket ryddes når verset omsider ble svart fullt ut, ellers ville
            // et vellykket nytt forsøk aldri kunne stryke seg selv fra lista.
            if (incomplete) progress.incomplete.add(key); else progress.incomplete.delete(key);
            saveProgress(progress);
        }
        process.stdout.write(`\r  ${i + 1}/${versesToProcess.length} ${getRef(v.bookId, v.chapterId, v.verseId)} — found ${found}, answered ${answered}, kept ${kept}, total ${total}${' '.repeat(20)}`);
    }
    process.stdout.write('\n');
    console.log(formatRunSummary(totals));
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
