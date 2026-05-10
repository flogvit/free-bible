import dotenv from 'dotenv';
import * as fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';
dotenv.config();

import {books} from './constants.js';
import {getRef} from './lib.js';
import {callWithRetry} from './llm.js';
import {hasEmbeddings, buildEmbeddings, loadEmbeddings, topKByIndex} from './embeddings.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const EMBED_MODEL = 'bge-m3';
const CORPUS = 'osnb2';
const REFERENCES_LANG_DIR = path.join(__dirname, 'references', 'nb');

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

function loadAllOsnb2Verses() {
    const all = [];
    for (const book of books) {
        for (let ch = 1; ch <= book.chapters; ch++) {
            const file = path.join(__dirname, 'bibles_raw', 'osnb2', `${book.id}`, `${ch}.json`);
            if (!fs.existsSync(file)) continue;
            const verses = JSON.parse(fs.readFileSync(file, 'utf-8'));
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

function buildVerifyPrompt(sourceVerse, candidates) {
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

function refKey(bookId, chapterId, fromVerseId, toVerseId) {
    return `${bookId}-${chapterId}-${fromVerseId}-${toVerseId}`;
}

function mergeReferences(existing, fresh) {
    const seen = new Set();
    const merged = [];
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

async function verifyVerse(verse, state, options) {
    const outFile = path.join(REFERENCES_LANG_DIR, `${verse.bookId}`, `${verse.chapterId}`, `${verse.verseId}.json`);

    let existing = null;
    if (fs.existsSync(outFile)) {
        try { existing = JSON.parse(fs.readFileSync(outFile, 'utf-8')); } catch { /* corrupt — ignore */ }
    }

    const skip = options.neighborSkip || 0;
    const candidates = topKByIndex(state, verse.idx, {
        k: options.topK,
        threshold: options.threshold,
        filter: (item) => {
            if (skip > 0 && item.bookId === verse.bookId && item.chapterId === verse.chapterId
                && Math.abs(item.verseId - verse.verseId) <= skip) {
                return false;
            }
            return true;
        }
    });

    if (candidates.length === 0) return {found: 0, kept: 0};

    const candidateItems = candidates.map(c => state.items[c.idx]);
    const prompt = buildVerifyPrompt(verse, candidateItems);

    let result;
    try {
        result = await callWithRetry(prompt, {
            schema: VERIFY_SCHEMA,
            local: true,
            context: `verify ${verse.bookId}:${verse.chapterId}:${verse.verseId}`
        });
    } catch (err) {
        console.warn(`\n  Failed verify ${getRef(verse.bookId, verse.chapterId, verse.verseId)}: ${err.message}`);
        return {found: candidates.length, kept: 0};
    }

    const fresh = [];
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

    return {found: candidates.length, kept: fresh.length};
}

function printUsage() {
    console.log(`
Usage: node references_semantic.mjs [options]

Two-phase semantic cross-reference builder for osnb2:
  1. Build embeddings of all verses (bge-m3 via Ollama)
  2. For each verse, fetch top-K semantic candidates and verify each with a local LLM (qwen3.5:122b).
     Verified pairs are merged into references/nb/<book>/<chapter>/<verse>.json.

Options:
  --build-only         Only build embeddings; skip verification
  --verify-only        Only verify; assumes embeddings exist
  --top-k <n>          Candidate count per verse (default: 10)
  --threshold <x>      Min cosine similarity (default: 0.60 — bge-m3 typically scores related verses 0.60-0.70)
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

function parseRange(value) {
    if (value.includes('-')) {
        const [start, end] = value.split('-').map(n => parseInt(n, 10));
        return {start, end};
    }
    const num = parseInt(value, 10);
    return {start: num, end: num};
}

function parseArgs(args) {
    const opts = {
        buildOnly: false,
        verifyOnly: false,
        topK: 10,
        threshold: 0.60,
        neighborSkip: 5,
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
        else if (a === '--force') opts.force = true;
        else if (a === '--help' || a === '-h') opts.help = true;
        i++;
    }
    return opts;
}

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.help) { printUsage(); return; }

    const verses = loadAllOsnb2Verses();
    console.log(`Loaded ${verses.length} osnb2 verses`);

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

    const state = loadEmbeddings(CORPUS);
    console.log(`Loaded ${state.items.length} embeddings (dim ${state.dim}, model ${state.model})`);

    const inScope = (v) => {
        if (opts.bookStart !== null && (v.bookId < opts.bookStart || v.bookId > opts.bookEnd)) return false;
        if (opts.chapterStart !== null && (v.chapterId < opts.chapterStart || v.chapterId > opts.chapterEnd)) return false;
        if (opts.verseStart !== null && (v.verseId < opts.verseStart || v.verseId > opts.verseEnd)) return false;
        return true;
    };

    const versesToProcess = state.items.filter(inScope);
    console.log(`Verifying ${versesToProcess.length} verses (top-${opts.topK}, threshold ${opts.threshold}, neighbor-skip ${opts.neighborSkip})`);

    let totalFound = 0;
    let totalKept = 0;
    for (let i = 0; i < versesToProcess.length; i++) {
        const v = versesToProcess[i];
        const {found, kept} = await verifyVerse(v, state, opts);
        totalFound += found;
        totalKept += kept;
        process.stdout.write(`\r  ${i + 1}/${versesToProcess.length} ${getRef(v.bookId, v.chapterId, v.verseId)} — found ${found}, kept ${kept}${' '.repeat(20)}`);
    }
    process.stdout.write('\n');
    const pct = totalFound > 0 ? Math.round(totalKept * 100 / totalFound) : 0;
    console.log(`Done. Total candidates: ${totalFound}, accepted: ${totalKept} (${pct}%)`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
