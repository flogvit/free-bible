import dotenv from 'dotenv';
import * as fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config();

import {books, getBookName, bibles, getLanguageCode, ollamaModel, anthropicModel} from './constants.js';
import {callWithRetry} from './llm.js';

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

function loadChapter(bible, bookId, chapterId) {
    const file = path.join(SOURCES_DIR, bible, String(bookId), `${chapterId}.json`);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function formatChapterText(verses) {
    return verses.map(v => `${v.verseId}. ${v.text}`).join('\n');
}

function getOutputPath(language, bookId, chapterId) {
    return path.join(OUTPUT_BASE, language, String(bookId), `${chapterId}.json`);
}

function loadPriorChapterHeadings(language, bookId, currentChapter) {
    const priors = [];
    for (let ch = Math.max(1, currentChapter - PRIOR_CONTEXT_CHAPTERS); ch < currentChapter; ch++) {
        const file = getOutputPath(language, bookId, ch);
        if (!fs.existsSync(file)) continue;
        try {
            const data = JSON.parse(fs.readFileSync(file, 'utf8'));
            if (data.headings && data.headings.length) {
                priors.push({chapter: ch, titles: data.headings.map(h => h.title)});
            }
        } catch {
            // skip malformed
        }
    }
    return priors;
}

function buildPrompt(language, bookName, chapterId, chapterText, verseCount, priorHeadings) {
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

function validateHeadings(headings, verseCount) {
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

async function processChapter(bible, language, bookId, chapterId, options) {
    const bookName = getBookName(bookId, language);
    const outputFile = getOutputPath(language, bookId, chapterId);

    if (!options.force && fs.existsSync(outputFile)) {
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
    const useLocal = !options.remote;
    const modelLabel = useLocal ? ollamaModel : anthropicModel;

    process.stdout.write(`  ${bookName} ${chapterId} (${verses.length} vers, ${useLocal ? 'qwen' : 'claude'})... `);
    const t0 = Date.now();

    let result;
    let validation;
    let attempts = 0;
    let lastReason = null;
    const MAX_VALIDATION_RETRIES = 2;

    while (attempts < MAX_VALIDATION_RETRIES) {
        attempts++;
        let attemptPrompt = prompt;
        if (lastReason) {
            attemptPrompt = `${prompt}\n\nDet forrige forsøket ble forkastet fordi: ${lastReason}. Vennligst rett opp.`;
        }
        try {
            result = await callWithRetry(attemptPrompt, {
                schema: HEADINGS_SCHEMA,
                local: useLocal,
                context: `${bookName} ${chapterId}`
            });
        } catch (err) {
            process.stdout.write(`FEIL (LLM): ${err.message}\n`);
            return;
        }
        validation = validateHeadings(result.headings, verseCount);
        if (validation.ok) break;
        lastReason = validation.reason;
    }

    const dt = ((Date.now() - t0) / 1000).toFixed(1);

    const output = {
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

function printUsage() {
    console.log(`
Usage: node headings.mjs --bible <name> [options]

Generate inline section headings for a Bible translation, chapter by chapter.
Default model: qwen3.5:122b (local Ollama). Pass --remote to use Anthropic Claude.

Options:
  --bible <name>       Bible translation (e.g., osnb, osnn) [required]
  --book <range>       Process book(s): single (43) or range (1-20)
  --chapter <range>    Process chapter(s): single (12) or range (1-10) [requires single --book]
  --ot                 Process only Old Testament (books 1-39)
  --nt                 Process only New Testament (books 40-66)
  --remote             Use Anthropic Claude instead of local qwen
  --force              Re-process even if chapter already has output
  --help               Show this help message

Output:
  generate/headings/<lang>/<bookId>/<chapterId>.json
  Language code is derived from the bible (osnb -> nb, osnn -> nn).

Examples:
  node headings.mjs --bible osnb --book 1 --chapter 1
  node headings.mjs --bible osnb --book 1
  node headings.mjs --bible osnb --nt --remote
  node headings.mjs --bible osnn --force
`);
}

function parseRange(value) {
    if (value.includes('-')) {
        const [start, end] = value.split('-').map(n => parseInt(n, 10));
        return {start, end};
    }
    const n = parseInt(value, 10);
    return {start: n, end: n};
}

async function main() {
    const args = process.argv.slice(2);
    const options = {
        bible: null,
        bookStart: null,
        bookEnd: null,
        chapterStart: null,
        chapterEnd: null,
        force: false,
        remote: false,
        help: false
    };

    let i = 0;
    while (i < args.length) {
        const arg = args[i];
        if (arg === '--bible' && i + 1 < args.length) {
            options.bible = args[++i];
        } else if (arg === '--book' && i + 1 < args.length) {
            const r = parseRange(args[++i]);
            options.bookStart = r.start;
            options.bookEnd = r.end;
        } else if (arg === '--chapter' && i + 1 < args.length) {
            const r = parseRange(args[++i]);
            options.chapterStart = r.start;
            options.chapterEnd = r.end;
        } else if (arg === '--ot') {
            options.bookStart = 1;
            options.bookEnd = 39;
        } else if (arg === '--nt') {
            options.bookStart = 40;
            options.bookEnd = 66;
        } else if (arg === '--force') {
            options.force = true;
        } else if (arg === '--remote') {
            options.remote = true;
        } else if (arg === '--help') {
            options.help = true;
        } else {
            console.error(`Unknown argument: ${arg}`);
            options.help = true;
        }
        i++;
    }

    if (options.help || !options.bible) {
        printUsage();
        process.exit(options.help ? 0 : 1);
    }

    const bibleLanguageName = bibles[options.bible];
    if (!bibleLanguageName) {
        console.error(`Unknown bible "${options.bible}". Known: ${Object.keys(bibles).join(', ')}`);
        process.exit(1);
    }
    const language = getLanguageCode(bibleLanguageName);

    const bibleDir = path.join(SOURCES_DIR, options.bible);
    if (!fs.existsSync(bibleDir)) {
        console.error(`Bible source not found: ${bibleDir}`);
        process.exit(1);
    }

    const bookStart = options.bookStart ?? 1;
    const bookEnd = options.bookEnd ?? 66;

    if ((options.chapterStart || options.chapterEnd) && bookStart !== bookEnd) {
        console.error('--chapter requires a single book (use --book <id>)');
        process.exit(1);
    }

    console.log(`Bible: ${options.bible} (${bibleLanguageName} / ${language})`);
    console.log(`Model: ${options.remote ? `${anthropicModel} (Anthropic)` : `${ollamaModel} (Ollama)`}`);
    console.log(`Books: ${bookStart}-${bookEnd}${options.chapterStart ? `, chapter ${options.chapterStart}-${options.chapterEnd}` : ''}`);

    for (const book of books) {
        if (book.id < bookStart || book.id > bookEnd) continue;
        const bookName = getBookName(book.id, language);
        const startCh = options.chapterStart ?? 1;
        const endCh = Math.min(options.chapterEnd ?? book.chapters, book.chapters);
        console.log(`\n=== ${bookName} (${book.id}), kapittel ${startCh}-${endCh} ===`);
        for (let ch = startCh; ch <= endCh; ch++) {
            await processChapter(options.bible, language, book.id, ch, options);
        }
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
