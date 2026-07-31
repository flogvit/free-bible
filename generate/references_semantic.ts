import dotenv from 'dotenv';
import * as fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';
dotenv.config();

import {books} from './constants.js';
import {getRef} from './lib.js';
import {callWithRetry} from './llm.js';
import {hasEmbeddings, buildEmbeddings, loadEmbeddings, topK, topKByIndex, embedQuery} from './embeddings.js';
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
interface VerifyResult {
    id: number;
    analysis: string;
    accept: boolean;
    note: string;
}

/** Tellerne `verifyVerse` rapporterer for ett vers. */
interface VerifyTotals {
    found: number;
    kept: number;
    total: number;
}

/** Et bok-/kapittel-/versintervall fra kommandolinja, begge ender inklusive. */
interface Range {
    start: number;
    end: number;
}

/** Innstillingene for en kjøring, slik `parseArgs` leser dem. */
interface SemanticOptions {
    buildOnly: boolean;
    verifyOnly: boolean;
    topK: number;
    threshold: number;
    neighborSkip: number;
    useTheme: boolean;
    useConcepts: boolean;
    resume: boolean;
    skipExisting: boolean;
    bookStart: number | null;
    bookEnd: number | null;
    chapterStart: number | null;
    chapterEnd: number | null;
    verseStart: number | null;
    verseEnd: number | null;
    force: boolean;
    help: boolean;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const EMBED_MODEL = 'bge-m3';
const CORPUS = 'osnb';
const REFERENCES_LANG_DIR = path.join(__dirname, 'references', 'nb');
const PROGRESS_FILE = path.join(__dirname, 'embeddings', CORPUS, 'semantic_progress.json');

function verseKey(v: Verse): string { return `${v.bookId}-${v.chapterId}-${v.verseId}`; }

function loadProgress(): Set<string> {
    if (!fs.existsSync(PROGRESS_FILE)) return new Set();
    try {
        const data = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8')) as {processed?: string[]};
        return new Set(data.processed || []);
    } catch {
        return new Set();
    }
}

function saveProgress(progressSet: Set<string>): void {
    const dir = path.dirname(PROGRESS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, {recursive: true});
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify({processed: [...progressSet]}, null, 2));
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

const VERIFY_SCHEMA = {
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

function buildVerifyPrompt(sourceVerse: Verse, candidates: Verse[]): string {
    const candList = candidates.map((c, i) =>
        `[${i}] ${getRef(c.bookId, c.chapterId, c.verseId)}: ${c.text}`
    ).join('\n');

    return `Du er en bibelforsker som vurderer kryssreferanser. Ta deg tid til å tenke grundig gjennom hver kandidat.

KILDEVERS:
${getRef(sourceVerse.bookId, sourceVerse.chapterId, sourceVerse.verseId)}: ${sourceVerse.text}

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

    if (candidates.length === 0) return {found: 0, kept: 0, total: existing?.references?.length || 0};

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
        return {found: candidates.length, kept: 0, total: existing?.references?.length || 0};
    }

    const fresh: SemanticReference[] = [];
    for (const r of result.results || []) {
        if (!r.accept) continue;
        const c = candidateItems[r.id];
        if (!c) continue;
        fresh.push({
            bookId: c.bookId,
            chapterId: c.chapterId,
            fromVerseId: c.verseId,
            toVerseId: c.verseId,
            text: r.note
        });
    }

    const merged = mergeReferences(existing?.references || [], fresh);

    const outDir = path.dirname(outFile);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, {recursive: true});
    fs.writeFileSync(outFile, JSON.stringify({
        bookId: verse.bookId,
        chapterId: verse.chapterId,
        verseId: verse.verseId,
        references: merged
    }, null, 2));

    return {found: candidates.length, kept: fresh.length, total: merged.length};
}

function printUsage(): void {
    console.log(`
Usage: node references_semantic.mjs [options]

Two-phase semantic cross-reference builder for osnb:
  1. Build embeddings of all verses (bge-m3 via Ollama)
  2. For each verse, fetch top-K semantic candidates and verify each with a local LLM (qwen3.5:122b).
     Verified pairs are merged into references/nb/<book>/<chapter>/<verse>.json.

Options:
  --build-only         Only build embeddings; skip verification
  --verify-only        Only verify; assumes embeddings exist
  --top-k <n>          Candidate count per verse (default: 10)
  --threshold <x>      Min cosine similarity (default: 0.60 — bge-m3 typically scores related verses 0.60-0.70)
  --theme              Add theme-extraction step: LLM summarizes verse, embed summary, search for thematic parallels (in addition to text-based)
  --concepts           Add concept-question step: LLM generates 4 facet-queries, each searched separately
  --resume             Skip verses already processed in a prior semantic run (tracked in embeddings/<corpus>/semantic_progress.json)
  --skip-existing      Skip verses that already have a references file (don't augment existing manual refs)
  --neighbor-skip <n>  Skip same-chapter verses within N (default: 5)
  --book <range>       Verify only these books: single (43) or range (1-20)
  --chapter <range>    Verify only these chapters
  --verse <range>      Verify only these verses
  --force              Rebuild embeddings (does NOT overwrite refs; merge always preserves existing)
  --help

Examples:
  node references_semantic.mjs --build-only
  node references_semantic.mjs --verify-only --book 42 --chapter 19
  node references_semantic.mjs --top-k 10 --threshold 0.78
`);
}

function parseRange(value: string): Range {
    if (value.includes('-')) {
        const [start, end] = value.split('-').map(n => parseInt(n, 10));
        return {start, end};
    }
    const num = parseInt(value, 10);
    return {start: num, end: num};
}

function parseArgs(args: string[]): SemanticOptions {
    const opts: SemanticOptions = {
        buildOnly: false,
        verifyOnly: false,
        topK: 10,
        threshold: 0.60,
        neighborSkip: 5,
        useTheme: false,
        useConcepts: false,
        resume: false,
        skipExisting: false,
        bookStart: null, bookEnd: null,
        chapterStart: null, chapterEnd: null,
        verseStart: null, verseEnd: null,
        force: false,
        help: false
    };
    let i = 0;
    while (i < args.length) {
        const a = args[i];
        if (a === '--build-only') opts.buildOnly = true;
        else if (a === '--verify-only') opts.verifyOnly = true;
        else if (a === '--top-k' && i + 1 < args.length) opts.topK = parseInt(args[++i], 10);
        else if (a === '--threshold' && i + 1 < args.length) opts.threshold = parseFloat(args[++i]);
        else if (a === '--neighbor-skip' && i + 1 < args.length) opts.neighborSkip = parseInt(args[++i], 10);
        else if (a === '--book' && i + 1 < args.length) {
            const r = parseRange(args[++i]); opts.bookStart = r.start; opts.bookEnd = r.end;
        }
        else if (a === '--chapter' && i + 1 < args.length) {
            const r = parseRange(args[++i]); opts.chapterStart = r.start; opts.chapterEnd = r.end;
        }
        else if (a === '--verse' && i + 1 < args.length) {
            const r = parseRange(args[++i]); opts.verseStart = r.start; opts.verseEnd = r.end;
        }
        else if (a === '--theme') opts.useTheme = true;
        else if (a === '--concepts') opts.useConcepts = true;
        else if (a === '--resume') opts.resume = true;
        else if (a === '--skip-existing') opts.skipExisting = true;
        else if (a === '--force') opts.force = true;
        else if (a === '--help' || a === '-h') opts.help = true;
        i++;
    }
    return opts;
}

async function main(): Promise<void> {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.help) { printUsage(); return; }

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

    const progress: Set<string> = opts.resume ? loadProgress() : new Set();
    let allInScope = state.items.filter(inScope);
    let versesToProcess = allInScope;

    if (opts.resume) {
        versesToProcess = versesToProcess.filter(v => !progress.has(verseKey(v)));
    }
    if (opts.skipExisting) {
        versesToProcess = versesToProcess.filter(v => {
            const f = path.join(REFERENCES_LANG_DIR, `${v.bookId}`, `${v.chapterId}`, `${v.verseId}.json`);
            return !fs.existsSync(f);
        });
    }

    const skippedResume = opts.resume ? (allInScope.length - versesToProcess.length - (opts.skipExisting ? 0 : 0)) : 0;
    const flagInfo = [];
    if (opts.resume) flagInfo.push(`resume: ${progress.size} done`);
    if (opts.skipExisting) flagInfo.push('skip-existing');
    if (opts.useTheme) flagInfo.push('+theme');
    if (opts.useConcepts) flagInfo.push('+concepts');
    console.log(`Verifying ${versesToProcess.length}/${allInScope.length} verses (top-${opts.topK}, threshold ${opts.threshold}, neighbor-skip ${opts.neighborSkip}${flagInfo.length ? ', ' + flagInfo.join(', ') : ''})`);

    let totalFound = 0;
    let totalKept = 0;
    for (let i = 0; i < versesToProcess.length; i++) {
        const v = versesToProcess[i];
        const {found, kept, total} = await verifyVerse(v, state, opts);
        totalFound += found;
        totalKept += kept;
        if (opts.resume) {
            progress.add(verseKey(v));
            saveProgress(progress);
        }
        process.stdout.write(`\r  ${i + 1}/${versesToProcess.length} ${getRef(v.bookId, v.chapterId, v.verseId)} — found ${found}, kept ${kept}, total ${total}${' '.repeat(20)}`);
    }
    process.stdout.write('\n');
    const pct = totalFound > 0 ? Math.round(totalKept * 100 / totalFound) : 0;
    console.log(`Done. Total candidates: ${totalFound}, accepted: ${totalKept} (${pct}%)`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
