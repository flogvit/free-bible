import dotenv from 'dotenv';
import * as fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config();

import {books, getBookName} from './constants.js';
import {callWithRetry} from './llm.js';

const OSNB2_DIR = path.join(__dirname, 'bibles_raw', 'osnb2');
const STORIES_DIR_BASE = path.join(__dirname, 'stories');
const PROPOSED_DIR_BASE = path.join(__dirname, 'stories_proposed');

const VALID_CATEGORIES = [
    "skapelsen", "patriarkene", "moses", "oerkenvandringen", "landnaam",
    "dommerne", "kongetiden", "profetene", "eksil", "visdomslitteratur",
    "jesus-liv", "jesu-mirakler", "jesu-lignelser", "jesu-lidelse",
    "urkirken", "paulus"
];

// Books with little or no narrative content. Skipped by default.
// 19 Salmene, 20 Ordspråkene, 21 Forkynneren, 22 Høysangen, 25 Klagesangene
// 45-65 NT epistles (Romans through Jude)
const POETIC_BOOK_IDS = new Set([19, 20, 21, 22, 25]);
const EPISTLE_BOOK_IDS = new Set([45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65]);

const STORY_SCHEMA = {
    type: "object",
    properties: {
        slug: {type: "string"},
        title: {type: "string"},
        keywords: {type: "array", items: {type: "string"}},
        description: {type: "string"},
        category: {type: "string"},
        references: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    bookId: {type: "integer"},
                    startChapter: {type: "integer"},
                    startVerse: {type: "integer"},
                    endChapter: {type: "integer"},
                    endVerse: {type: "integer"}
                },
                required: ["bookId", "startChapter", "startVerse", "endChapter", "endVerse"],
                additionalProperties: false
            }
        }
    },
    required: ["slug", "title", "keywords", "description", "category", "references"],
    additionalProperties: false
};

const SCAN_SCHEMA = {
    type: "object",
    properties: {
        stories: {
            type: "array",
            items: STORY_SCHEMA
        }
    },
    required: ["stories"],
    additionalProperties: false
};

// --- File helpers ---

function fileExists(filepath) {
    return fs.existsSync(filepath) && fs.statSync(filepath).size > 0;
}

function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, {recursive: true});
}

function loadChapter(bookId, chapterId) {
    const file = path.join(OSNB2_DIR, String(bookId), `${chapterId}.json`);
    if (!fileExists(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

function loadExistingStories(lang) {
    const dir = path.join(STORIES_DIR_BASE, lang);
    if (!fs.existsSync(dir)) return [];
    const out = [];
    for (const file of fs.readdirSync(dir)) {
        if (!file.endsWith('.json')) continue;
        try {
            out.push(JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8')));
        } catch (e) {
            console.error(`  warn: could not parse ${file}: ${e.message}`);
        }
    }
    return out;
}

function loadProposedStories(lang) {
    const dir = path.join(PROPOSED_DIR_BASE, lang);
    if (!fs.existsSync(dir)) return [];
    const out = [];
    for (const file of fs.readdirSync(dir)) {
        if (!file.endsWith('.json') || file.startsWith('.')) continue;
        try {
            out.push(JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8')));
        } catch {
            // ignore
        }
    }
    return out;
}

// --- Reference utilities ---

// Encode a verse position as a single comparable integer:
// bookId * 1e7 + chapter * 1e4 + verse  (chapters/verses fit comfortably).
function encodePos(bookId, chapter, verse) {
    return bookId * 10_000_000 + chapter * 10_000 + verse;
}

function refToInterval(ref) {
    return {
        start: encodePos(ref.bookId, ref.startChapter, ref.startVerse),
        end: encodePos(ref.bookId, ref.endChapter, ref.endVerse),
        bookId: ref.bookId
    };
}

function intervalsOverlap(a, b) {
    if (a.bookId !== b.bookId) return 0;
    const lo = Math.max(a.start, b.start);
    const hi = Math.min(a.end, b.end);
    if (hi < lo) return 0;
    return hi - lo + 1;
}

function intervalSize(iv) {
    return iv.end - iv.start + 1;
}

// Check if a proposed story's references heavily overlap an existing/proposed story.
// Returns the slug of the overlapping story, or null.
function findReferenceOverlap(candidate, existingStories, threshold = 0.6) {
    const candIntervals = candidate.references.map(refToInterval);
    if (candIntervals.length === 0) return null;
    const candTotal = candIntervals.reduce((s, iv) => s + intervalSize(iv), 0);

    for (const existing of existingStories) {
        if (!existing.references || existing.references.length === 0) continue;
        const exIntervals = existing.references.map(refToInterval);
        let overlap = 0;
        for (const a of candIntervals) {
            for (const b of exIntervals) {
                overlap += intervalsOverlap(a, b);
            }
        }
        if (overlap === 0) continue;
        const exTotal = exIntervals.reduce((s, iv) => s + intervalSize(iv), 0);
        const candCoverage = overlap / candTotal;
        const exCoverage = overlap / exTotal;
        if (candCoverage >= threshold || exCoverage >= threshold) {
            return existing.slug || existing.title;
        }
    }
    return null;
}

// Find existing stories that touch a given chapter (used for context to LLM).
function storiesTouchingChapter(stories, bookId, chapterId) {
    const chapterStart = encodePos(bookId, chapterId, 1);
    const chapterEnd = encodePos(bookId, chapterId, 9999);
    const chapterIv = {start: chapterStart, end: chapterEnd, bookId};
    return stories.filter(s => {
        if (!s.references) return false;
        return s.references.some(r => intervalsOverlap(refToInterval(r), chapterIv) > 0);
    });
}

// --- Slug helpers ---

function slugify(input) {
    return String(input)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/æ/g, 'ae').replace(/ø/g, 'o').replace(/å/g, 'aa')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
}

// --- Prompt ---

function buildChapterText(chapterVerses, bookName, chapterId) {
    const lines = chapterVerses.map(v => `${chapterId}:${v.verseId} ${v.text}`);
    return `${bookName} kapittel ${chapterId}\n` + lines.join('\n');
}

function buildPrompt(bookName, bookId, chapterId, chapterText, existingStoriesForChapter, lastChapterInBook) {
    const categoriesList = VALID_CATEGORIES.join(', ');

    const existingBlock = existingStoriesForChapter.length > 0
        ? existingStoriesForChapter.map(s => {
            const refs = s.references.map(r =>
                `${getBookName(r.bookId, 'Norwegian bokmål')} ${r.startChapter}:${r.startVerse}-${r.endChapter}:${r.endVerse}`
            ).join('; ');
            return `- "${s.title}" (slug: ${s.slug}) — ${refs}`;
        }).join('\n')
        : '(ingen)';

    return `Du er en bibelekspert som skanner Bibelen kapittel for kapittel for å finne avgrensede fortellinger som mangler i en database.

KAPITTELET DU SKAL SKANNE:
${chapterText}

EKSISTERENDE FORTELLINGER SOM ALLEREDE DEKKER DETTE KAPITTELET:
${existingBlock}

BOKKONTEKST:
- Bok: ${bookName} (bookId=${bookId})
- Kapittel som vurderes: ${chapterId}
- Siste kapittel i boka: ${lastChapterInBook}

OPPGAVE:
Identifiser fortellinger som STARTER i dette kapittelet og som IKKE allerede er dekket av listen over.
- En fortelling skal ha tydelig start- og sluttvers (kan strekke seg over flere kapitler).
- Hvis en fortelling spenner over flere kapitler, sett endChapter > startChapter ut fra din bibelkunnskap, men aldri høyere enn ${lastChapterInBook}.
- Hopp over fortellinger hvis hovedinnhold allerede er i listen.
- Hvis kapittelet er rent poetisk/didaktisk uten avgrensede fortellinger, returner en tom stories-array.
- Foreslå normalt 0-3 fortellinger per kapittel. Bare ta med fortellinger som er virkelig viktige eller tydelig avgrensede.

For hver foreslått fortelling, generer:
- slug: URL-vennlig identifikator med bindestreker, på norsk (uten æ/ø/å)
- title: Tittel på norsk bokmål
- keywords: 5-10 relevante søkeord (lowercase, norsk)
- description: 1-2 setningers oppsummering på norsk bokmål
- category: En av: ${categoriesList}
- references: Array med bibelreferanser. bookId må være ${bookId} for fortellinger fra denne boka.

REFERANSEFORMAT i description:
[ref:FORKORTELSE KAPITTEL:VERS|VISNINGSTEKST]
Eksempel: [ref:1 Mos 12:1-9|1. Mosebok 12:1-9]
Bruk KVN-forkortelser og fullt boknavn i visningsteksten.

VIKTIG:
- bookId SKAL være ${bookId}.
- startChapter SKAL være ${chapterId}.
- ALDRI nevn spesifikke bibelutgaver, bibelselskap eller forlag.`;
}

// --- Scan ---

async function scanChapter({bookId, chapterId, lang, existingStories, proposedStories, useLocal, dryRun}) {
    const bookName = getBookName(bookId, 'Norwegian bokmål');
    const verses = loadChapter(bookId, chapterId);
    if (!verses || verses.length === 0) {
        console.log(`  ${bookName} ${chapterId}: skip (no osnb2 text)`);
        return {proposed: 0, skipped: 0};
    }

    const book = books.find(b => b.id === bookId);
    const lastChapter = book ? book.chapters : chapterId;

    const chapterText = buildChapterText(verses, bookName, chapterId);
    const touching = storiesTouchingChapter([...existingStories, ...proposedStories], bookId, chapterId);

    const prompt = buildPrompt(bookName, bookId, chapterId, chapterText, touching, lastChapter);

    const result = await callWithRetry(prompt, {
        schema: SCAN_SCHEMA,
        local: useLocal,
        context: `scan ${bookId}/${chapterId}`
    });

    if (!result || !Array.isArray(result.stories)) {
        console.log(`  ${bookName} ${chapterId}: no result`);
        return {proposed: 0, skipped: 0};
    }

    const outDir = path.join(PROPOSED_DIR_BASE, lang);
    ensureDir(outDir);

    const existingSlugs = new Set(existingStories.map(s => s.slug).filter(Boolean));
    const existingTitles = new Set(existingStories.map(s => s.title?.toLowerCase()).filter(Boolean));
    const proposedSlugs = new Set(proposedStories.map(s => s.slug).filter(Boolean));
    const proposedTitles = new Set(proposedStories.map(s => s.title?.toLowerCase()).filter(Boolean));

    let proposed = 0;
    let skipped = 0;

    for (const story of result.stories) {
        if (!story.slug || !story.title) {
            skipped++;
            continue;
        }
        let slug = slugify(story.slug || story.title);
        if (!slug) {
            skipped++;
            continue;
        }
        story.slug = slug;

        // Validate references
        if (!Array.isArray(story.references) || story.references.length === 0) {
            console.log(`    skip "${story.title}" (no references)`);
            skipped++;
            continue;
        }
        let refsOk = true;
        for (const ref of story.references) {
            const refBook = books.find(b => b.id === ref.bookId);
            if (!refBook) { refsOk = false; break; }
            if (ref.startChapter < 1 || ref.startChapter > refBook.chapters) { refsOk = false; break; }
            if (ref.endChapter < 1 || ref.endChapter > refBook.chapters) { refsOk = false; break; }
            if (ref.endChapter < ref.startChapter) { refsOk = false; break; }
            if (ref.startChapter === ref.endChapter && ref.endVerse < ref.startVerse) { refsOk = false; break; }
        }
        if (!refsOk) {
            console.log(`    skip "${story.title}" (invalid references)`);
            skipped++;
            continue;
        }

        // Category
        if (!VALID_CATEGORIES.includes(story.category)) {
            console.log(`    skip "${story.title}" (invalid category: ${story.category})`);
            skipped++;
            continue;
        }

        // Slug/title duplicates
        if (existingSlugs.has(slug) || proposedSlugs.has(slug)) {
            console.log(`    skip "${story.title}" (slug "${slug}" already exists)`);
            skipped++;
            continue;
        }
        if (existingTitles.has(story.title.toLowerCase()) || proposedTitles.has(story.title.toLowerCase())) {
            console.log(`    skip "${story.title}" (title already exists)`);
            skipped++;
            continue;
        }

        // Reference overlap
        const overlapWith = findReferenceOverlap(story, existingStories) || findReferenceOverlap(story, proposedStories);
        if (overlapWith) {
            console.log(`    skip "${story.title}" (refs overlap with "${overlapWith}")`);
            skipped++;
            continue;
        }

        // Save
        const outFile = path.join(outDir, `${slug}.json`);
        if (fileExists(outFile)) {
            console.log(`    skip "${story.title}" (proposed file exists)`);
            skipped++;
            continue;
        }

        if (dryRun) {
            console.log(`    [dry-run] would propose "${story.title}" (${slug})`);
        } else {
            fs.writeFileSync(outFile, JSON.stringify(story, null, 2));
            console.log(`    proposed: ${slug} — ${story.title}`);
        }
        proposed++;

        // Update tracking sets so later proposals in same run don't duplicate
        proposedSlugs.add(slug);
        proposedTitles.add(story.title.toLowerCase());
        proposedStories.push(story);
    }

    return {proposed, skipped};
}

// --- Skip-list ---

function shouldSkipBook(bookId, opts) {
    if (POETIC_BOOK_IDS.has(bookId) && !opts.includePoetic) return 'poetic';
    if (EPISTLE_BOOK_IDS.has(bookId) && !opts.includeEpistles) return 'epistle';
    return null;
}

// --- CLI ---

function parseArgs(args) {
    const opts = {
        book: null,
        chapter: null,
        lang: 'nb',
        includePoetic: false,
        includeEpistles: false,
        useLocal: true,
        limit: null,
        resume: false,
        dryRun: false,
        help: false
    };
    let i = 0;
    while (i < args.length) {
        const a = args[i];
        if (a === '--book' && i + 1 < args.length) opts.book = parseInt(args[++i], 10);
        else if (a === '--chapter' && i + 1 < args.length) opts.chapter = parseInt(args[++i], 10);
        else if (a === '--lang' && i + 1 < args.length) opts.lang = args[++i];
        else if (a === '--include-poetic') opts.includePoetic = true;
        else if (a === '--include-epistles') opts.includeEpistles = true;
        else if (a === '--remote') opts.useLocal = false;
        else if (a === '--local') opts.useLocal = true;
        else if (a === '--limit' && i + 1 < args.length) opts.limit = parseInt(args[++i], 10);
        else if (a === '--resume') opts.resume = true;
        else if (a === '--dry-run') opts.dryRun = true;
        else if (a === '--help' || a === '-h') opts.help = true;
        i++;
    }
    return opts;
}

function printUsage() {
    console.log(`
Usage: node scan_stories.mjs [options]

Systematically scans the Bible chapter by chapter and proposes new stories
that are not yet covered by existing stories/<lang>/*.json. Proposals land in
stories_proposed/<lang>/ for manual review.

Options:
  --book <id>          Scan only this book (1-66). Default: all eligible books.
  --chapter <n>        Scan only this chapter (requires --book).
  --lang <code>        Language code (default: nb).
  --include-poetic     Also scan Salmer/Ordspråk/Forkynneren/Høysangen/Klagesangene.
  --include-epistles   Also scan NT epistles (Romerne–Judas).
  --remote             Use Anthropic Claude (default: local Ollama).
  --limit <n>          Stop after processing this many chapters.
  --resume             Skip chapters that already have any proposal in stories_proposed.
                       Tracked via .scan_state.json in stories_proposed/<lang>/.
  --dry-run            Run the LLM but do not write proposal files.
  --help               Show this help.

Examples:
  node scan_stories.mjs --book 1 --chapter 12       # Scan Genesis 12
  node scan_stories.mjs --book 1                    # Scan all of Genesis
  node scan_stories.mjs                             # Scan all narrative books
  node scan_stories.mjs --resume --limit 20         # Resume, do 20 more chapters
  node scan_stories.mjs --remote                    # Use Anthropic instead of Ollama
`);
}

function loadState(lang) {
    const file = path.join(PROPOSED_DIR_BASE, lang, '.scan_state.json');
    if (!fileExists(file)) return {processed: {}};
    try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return {processed: {}}; }
}

function saveState(lang, state) {
    const dir = path.join(PROPOSED_DIR_BASE, lang);
    ensureDir(dir);
    fs.writeFileSync(path.join(dir, '.scan_state.json'), JSON.stringify(state, null, 2));
}

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.help) { printUsage(); return; }
    if (opts.chapter !== null && opts.book === null) {
        console.error('--chapter requires --book');
        process.exit(1);
    }

    const lang = opts.lang;
    const existingStories = loadExistingStories(lang);
    const proposedStories = loadProposedStories(lang);
    console.log(`Loaded ${existingStories.length} existing stories, ${proposedStories.length} previous proposals (${lang})`);
    console.log(`LLM: ${opts.useLocal ? 'local (Ollama)' : 'remote (Anthropic)'}`);

    const state = loadState(lang);

    // Build chapter list
    const targets = [];
    const bookList = opts.book ? [books.find(b => b.id === opts.book)].filter(Boolean) : books;
    if (opts.book && bookList.length === 0) {
        console.error(`Unknown book id: ${opts.book}`);
        process.exit(1);
    }
    for (const book of bookList) {
        const skipReason = shouldSkipBook(book.id, opts);
        if (skipReason && !opts.book) {
            // Silent skip for default full-bible run
            continue;
        }
        if (skipReason && opts.book) {
            console.log(`Note: book ${book.id} (${book.name}) is normally skipped (${skipReason}); proceeding because --book was specified.`);
        }
        const chapters = opts.chapter ? [opts.chapter] : Array.from({length: book.chapters}, (_, i) => i + 1);
        for (const ch of chapters) {
            targets.push({bookId: book.id, chapterId: ch});
        }
    }

    let totalProposed = 0;
    let totalSkipped = 0;
    let processed = 0;

    for (const t of targets) {
        const key = `${t.bookId}:${t.chapterId}`;
        if (opts.resume && state.processed[key]) continue;
        if (opts.limit !== null && processed >= opts.limit) break;

        const bookName = getBookName(t.bookId, 'Norwegian bokmål');
        console.log(`\n[${processed + 1}] ${bookName} ${t.chapterId} ...`);

        try {
            const {proposed, skipped} = await scanChapter({
                bookId: t.bookId,
                chapterId: t.chapterId,
                lang,
                existingStories,
                proposedStories,
                useLocal: opts.useLocal,
                dryRun: opts.dryRun
            });
            totalProposed += proposed;
            totalSkipped += skipped;
            console.log(`  -> proposed: ${proposed}, skipped: ${skipped}`);
        } catch (e) {
            console.error(`  ERROR ${bookName} ${t.chapterId}: ${e.message}`);
        }

        state.processed[key] = {at: new Date().toISOString()};
        if (!opts.dryRun) saveState(lang, state);
        processed++;
    }

    console.log(`\nDone. Chapters processed: ${processed}. Proposed: ${totalProposed}. Skipped: ${totalSkipped}.`);
    console.log(`Review proposals in: ${path.relative(__dirname, path.join(PROPOSED_DIR_BASE, lang))}/`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
