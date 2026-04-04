import dotenv from 'dotenv'
import * as fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config()

import {books, normalizeLanguage, getLanguageCode, getBookName} from "./constants.js";
import {callWithRetry} from "./llm.js";

let useLocal = false;

// === Load day definitions ===

function loadDays(langCode) {
    const dayDir = path.join(__dirname, 'days', langCode);
    if (!fs.existsSync(dayDir)) {
        console.error(`Day directory not found: ${dayDir}`);
        return [];
    }
    const files = fs.readdirSync(dayDir).filter(f => f.endsWith('.json'));
    return files.map(f => JSON.parse(fs.readFileSync(path.join(dayDir, f), 'utf-8')));
}

// === Schema for LLM response ===

const DAY_TAG_SCHEMA = {
    type: "object",
    properties: {
        days: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    id: {type: "string"},
                    fromVerseId: {type: "integer"},
                    toVerseId: {type: "integer"},
                    relevance: {type: "string", enum: ["primary", "secondary"]},
                    reason: {type: "string"}
                },
                required: ["id", "fromVerseId", "toVerseId", "relevance", "reason"],
                additionalProperties: false
            }
        }
    },
    required: ["days"],
    additionalProperties: false
};

const PROOFREAD_SCHEMA = {
    type: "object",
    properties: {
        issues: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    type: {type: "string", enum: ["false_positive", "missing", "wrong_relevance", "bad_reason"]},
                    dayId: {type: "string"},
                    severity: {type: "string", enum: ["critical", "major", "minor"]},
                    explanation: {type: "string"}
                },
                required: ["type", "dayId", "severity", "explanation"],
                additionalProperties: false
            }
        },
        score: {type: "integer"},
        revised: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    id: {type: "string"},
                    fromVerseId: {type: "integer"},
                    toVerseId: {type: "integer"},
                    relevance: {type: "string", enum: ["primary", "secondary"]},
                    reason: {type: "string"}
                },
                required: ["id", "fromVerseId", "toVerseId", "relevance", "reason"],
                additionalProperties: false
            }
        }
    },
    required: ["issues", "score", "revised"],
    additionalProperties: false
};

// === Read chapter text ===

function readTranslatedChapter(bible, bookId, chapterId) {
    const file = path.join(__dirname, `bibles_raw/${bible}/${bookId}/${chapterId}.json`);
    if (!fs.existsSync(file)) return null;
    const verses = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return verses.map(v => `${v.verseId}: ${v.text}`).join('\n');
}

function readOriginalChapter(bookId, chapterId) {
    const source = bookId <= 39 ? 'tanach' : 'sblgnt';
    const file = path.join(__dirname, `bibles_raw/${source}/${bookId}/${chapterId}.json`);
    if (!fs.existsSync(file)) return null;
    const verses = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return verses.map(v => `${v.verseId}: ${v.text}`).join('\n');
}

// === Prompts ===

function getTagPrompt(langCode, bookName, chapterId, chapterText, days) {
    const dayList = days.map(d => {
        let entry = `### ${d.id}: ${d.name}\n${d.description}`;
        if (d.biblicalBasis) entry += `\nBibelske tekster: ${d.biblicalBasis}`;
        if (d.significance) entry += `\nBetydning: ${d.significance}`;
        if (d.otConnections) entry += `\nGT-forbilder: ${d.otConnections}`;
        return entry;
    }).join('\n\n');

    if (langCode === 'nb') {
        return `Hvilke av disse kirkelige/bibelske dagene er ${bookName} ${chapterId} relevant for?

DAGER:
${dayList}

REGLER:
- Velg kun dager der teksten har DIREKTE relevans — ikke vage tematiske koblinger
- Angi nøyaktig hvilke vers som er relevante med fromVerseId og toVerseId
- Samme dag kan ha flere oppføringer hvis ulike versgrupper er relevante av ulike grunner
- "primary": versene er en sentral tekst for denne dagen (f.eks. korsfestelsesberetningen for Langfredag)
- "secondary": versene har tydelig relevans men er ikke blant hovedtekstene
- Bedre å velge for få enn for mange. Tom liste er helt greit.
- Skriv en kort begrunnelse (reason) for hver kobling

Teksten:
${chapterText}`;
    } else {
        return `Which of these church/biblical days is ${bookName} ${chapterId} relevant for?

DAYS:
${dayList}

RULES:
- Only select days where the text has DIRECT relevance — not vague thematic connections
- Specify exactly which verses are relevant with fromVerseId and toVerseId
- The same day can have multiple entries if different verse groups are relevant for different reasons
- "primary": the verses are a central text for this day (e.g. the crucifixion narrative for Good Friday)
- "secondary": the verses have clear relevance but are not among the main texts
- Better too few than too many. An empty list is fine.
- Write a short reason for each connection

Text:
${chapterText}`;
    }
}

function getProofreadPrompt(langCode, bookName, chapterId, chapterText, currentTags, days) {
    const dayList = days.map(d => `- ${d.id}: ${d.name} — ${d.description}`).join('\n');
    // Proofread uses compact day list (full context already informed the initial tagging)
    const tagsJson = JSON.stringify(currentTags, null, 2);

    // Build version history context
    let versionContext = '';
    if (currentTags._versions && currentTags._versions.length > 0) {
        const history = currentTags._versions.map((v, i) =>
            `  Versjon ${i + 1}: ${v.days.map(d => d.id).join(', ')} (score: ${v.score})`
        ).join('\n');

        if (langCode === 'nb') {
            versionContext = `\n\nTIDLIGERE VERSJONER (ikke foreslå lignende resultat):
${history}\n`;
        } else {
            versionContext = `\n\nPREVIOUS VERSIONS (do not suggest similar result):
${history}\n`;
        }
    }

    if (langCode === 'nb') {
        return `Du er korrekturleser for dag-tagging av bibelkapitler. Gå gjennom taggingen av ${bookName} ${chapterId}.

TILGJENGELIGE DAGER:
${dayList}

NÅVÆRENDE TAGGING:
${tagsJson}

KONTROLLER:
- Er noen dager feilaktig koblet (false_positive)?
- Mangler det åpenbare koblinger (missing)?
- Er versreferansene (fromVerseId/toVerseId) presise — dekker de riktige vers, ikke for bredt?
- Er relevans-nivået riktig (primary vs secondary)?
- Er begrunnelsene (reason) presise og korrekte?

VIKTIG:
- Kun foreslå endringer ved reelle feil. Ikke endre for å endre.
- score: 0-10 (10 = perfekt)
- revised: den korrigerte listen (kan være identisk med nåværende)
- Hvis ${currentTags._versions?.length || 0} tidligere versjoner finnes, vær strengere${versionContext}

Teksten:
${chapterText}`;
    } else {
        return `You are a proofreader for day-tagging of Bible chapters. Review the tagging of ${bookName} ${chapterId}.

AVAILABLE DAYS:
${dayList}

CURRENT TAGGING:
${tagsJson}

CHECK:
- Are any days incorrectly linked (false_positive)?
- Are obvious connections missing (missing)?
- Are the verse references (fromVerseId/toVerseId) precise — covering the right verses, not too broad?
- Is the relevance level correct (primary vs secondary)?
- Are the reasons precise and correct?

IMPORTANT:
- Only suggest changes for real errors. Don't change for the sake of change.
- score: 0-10 (10 = perfect)
- revised: the corrected list (can be identical to current)
- If ${currentTags._versions?.length || 0} previous versions exist, be stricter${versionContext}

Text:
${chapterText}`;
    }
}

// === File I/O ===

function ensureDir(filepath) {
    const dir = path.dirname(filepath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, {recursive: true});
}

function getTagFile(langCode, bookId, chapterId) {
    return path.join(__dirname, `day_tags/${langCode}/${bookId}/${chapterId}.json`);
}

function getProofreadFile(langCode, bookId, chapterId) {
    return path.join(__dirname, `proofread_day_tags/${langCode}/${bookId}/${chapterId}.json`);
}

// === Update day files with references ===

function updateDayReferences(langCode, bookId, chapterId, dayTags) {
    const dayDir = path.join(__dirname, 'days', langCode);

    for (const tag of dayTags) {
        const file = path.join(dayDir, `${tag.id}.json`);
        if (!fs.existsSync(file)) continue;

        const day = JSON.parse(fs.readFileSync(file, 'utf-8'));
        if (!day.references) day.references = [];

        const refKey = `${bookId}:${chapterId}:${tag.fromVerseId}:${tag.toVerseId}`;
        const exists = day.references.some(r =>
            `${r.bookId}:${r.chapterId}:${r.fromVerseId}:${r.toVerseId}` === refKey
        );
        if (exists) continue;

        day.references.push({
            bookId,
            chapterId,
            fromVerseId: tag.fromVerseId,
            toVerseId: tag.toVerseId,
            relevance: tag.relevance,
            reason: tag.reason
        });

        fs.writeFileSync(file, JSON.stringify(day, null, 2));
    }
}

// Remove old references for a chapter before re-tagging
function removeDayReferences(langCode, bookId, chapterId) {
    const dayDir = path.join(__dirname, 'days', langCode);
    if (!fs.existsSync(dayDir)) return;

    const files = fs.readdirSync(dayDir).filter(f => f.endsWith('.json'));
    const refKey = `${bookId}:${chapterId}`;

    for (const f of files) {
        const filePath = path.join(dayDir, f);
        const day = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        if (!day.references) continue;

        const before = day.references.length;
        day.references = day.references.filter(r => `${r.bookId}:${r.chapterId}` !== refKey);
        if (day.references.length < before) {
            fs.writeFileSync(filePath, JSON.stringify(day, null, 2));
        }
    }
}

// === Tag a single chapter ===

async function tagChapter(langCode, bible, bookId, chapterId, days, options = {}) {
    const bookName = getBookName(bookId, options.language || 'Norwegian bokmål');

    let chapterText = readTranslatedChapter(bible, bookId, chapterId);
    if (!chapterText) chapterText = readOriginalChapter(bookId, chapterId);
    if (!chapterText) return null;

    const prompt = getTagPrompt(langCode, bookName, chapterId, chapterText, days);
    const result = await callWithRetry(prompt, {schema: DAY_TAG_SCHEMA, local: useLocal, context: `${bookId}:${chapterId}`});

    // Filter out invalid day ids
    const validIds = new Set(days.map(d => d.id));
    result.days = result.days.filter(d => validIds.has(d.id));

    // Save per-chapter tag file
    const tagFile = getTagFile(langCode, bookId, chapterId);
    ensureDir(tagFile);
    fs.writeFileSync(tagFile, JSON.stringify(result, null, 2));

    // Update day reference files
    if (result.days.length > 0) {
        removeDayReferences(langCode, bookId, chapterId);
        updateDayReferences(langCode, bookId, chapterId, result.days);
    }

    return result;
}

// === Proofread ===

async function proofreadChapter(langCode, bible, bookId, chapterId, days, options = {}) {
    const tagFile = getTagFile(langCode, bookId, chapterId);
    if (!fs.existsSync(tagFile)) return null;

    const currentTags = JSON.parse(fs.readFileSync(tagFile, 'utf-8'));
    if (!currentTags.days || currentTags.days.length === 0) return {score: 10, issues: [], revised: []};

    const bookName = getBookName(bookId, options.language || 'Norwegian bokmål');
    let chapterText = readTranslatedChapter(bible, bookId, chapterId);
    if (!chapterText) chapterText = readOriginalChapter(bookId, chapterId);
    if (!chapterText) return null;

    const prompt = getProofreadPrompt(langCode, bookName, chapterId, chapterText, currentTags, days);
    const result = await callWithRetry(prompt, {schema: PROOFREAD_SCHEMA, local: useLocal, context: `proofread ${bookId}:${chapterId}`});

    if (!options.apply) {
        const proofFile = getProofreadFile(langCode, bookId, chapterId);
        ensureDir(proofFile);
        fs.writeFileSync(proofFile, JSON.stringify(result, null, 2));
    }

    return result;
}

function applyProofreadChanges(langCode, bookId, chapterId, proofreadResult) {
    const tagFile = getTagFile(langCode, bookId, chapterId);
    if (!fs.existsSync(tagFile)) return;

    const currentTags = JSON.parse(fs.readFileSync(tagFile, 'utf-8'));

    // Check if anything changed
    const currentIds = (currentTags.days || []).map(d => d.id).sort().join(',');
    const revisedIds = (proofreadResult.revised || []).map(d => d.id).sort().join(',');

    if (currentIds !== revisedIds || JSON.stringify(currentTags.days) !== JSON.stringify(proofreadResult.revised)) {
        // Save version history
        if (!currentTags._versions) currentTags._versions = [];
        currentTags._versions.push({
            days: currentTags.days,
            score: proofreadResult.score,
            reason: proofreadResult.issues?.map(i => `[${i.severity}] ${i.explanation}`).join('; ') || '',
            date: new Date().toISOString().split('T')[0]
        });

        currentTags.days = proofreadResult.revised;
        fs.writeFileSync(tagFile, JSON.stringify(currentTags, null, 2));

        // Update day files
        removeDayReferences(langCode, bookId, chapterId);
        if (currentTags.days.length > 0) {
            updateDayReferences(langCode, bookId, chapterId, currentTags.days);
        }
    }
}

// === CLI ===

function countChapters(bookStart, bookEnd, chapterStart, chapterEnd) {
    let total = 0;
    for (const book of books) {
        if (book.id < bookStart || book.id > bookEnd) continue;
        const startCh = (book.id === bookStart && chapterStart) ? chapterStart : 1;
        const endCh = (book.id === bookEnd && chapterEnd) ? Math.min(chapterEnd, book.chapters) : book.chapters;
        total += endCh - startCh + 1;
    }
    return total;
}

function printUsage() {
    console.log(`
Usage: node day_tags.mjs [options]

Options:
  --language <lang>    Language (default: nb)
  --bible <name>       Bible translation (e.g., osnb2) [required]
  --book <range>       Process book(s): single (43) or range (1-20)
  --chapter <range>    Process chapter(s): single (1) or range (1-10)
  --ot                 Process only Old Testament (books 1-39)
  --nt                 Process only New Testament (books 40-66)
  --local              Use Ollama instead of Claude
  --force              Re-tag even if chapter already tagged
  --proofread          Run proofreading after tagging
  --apply              Apply proofread suggestions (feedback loop)
  --min-score <n>      Minimum acceptable score (default: 8, range 0-10)
  --max-iter <n>       Max proofread iterations per chapter (default: 3)
  --help               Show this help message

Output structure:
  day_tags/<lang>/<bookId>/<chapterId>.json   (per-chapter tags)
  days/<lang>/<dayId>.json                     (updated with references)

Examples:
  node day_tags.mjs --bible osnb2 --book 43                # Tag John's gospel
  node day_tags.mjs --bible osnb2 --nt --local              # Tag NT with Ollama
  node day_tags.mjs --bible osnb2 --book 40 --chapter 27    # Tag Matt 27
  node day_tags.mjs --bible osnb2 --nt --proofread --apply  # Tag + proofread loop
  node day_tags.mjs --bible osnb2 --force --book 43         # Re-tag John
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

async function main() {
    const args = process.argv.slice(2);
    const options = {
        language: 'Norwegian bokmål',
        bible: null,
        bookStart: null,
        bookEnd: null,
        chapterStart: null,
        chapterEnd: null,
        local: false,
        force: false,
        proofread: false,
        apply: false,
        minScore: 8,
        maxIterations: 3,
        help: false
    };

    let i = 0;
    while (i < args.length) {
        const arg = args[i];
        if (arg === '--language' && i + 1 < args.length) {
            options.language = args[++i];
        } else if (arg === '--bible' && i + 1 < args.length) {
            options.bible = args[++i];
        } else if (arg === '--book' && i + 1 < args.length) {
            const range = parseRange(args[++i]);
            options.bookStart = range.start;
            options.bookEnd = range.end;
        } else if (arg === '--chapter' && i + 1 < args.length) {
            const range = parseRange(args[++i]);
            options.chapterStart = range.start;
            options.chapterEnd = range.end;
        } else if (arg === '--ot') {
            options.bookStart = 1;
            options.bookEnd = 39;
        } else if (arg === '--nt') {
            options.bookStart = 40;
            options.bookEnd = 66;
        } else if (arg === '--local') {
            options.local = true;
        } else if (arg === '--force') {
            options.force = true;
        } else if (arg === '--proofread') {
            options.proofread = true;
        } else if (arg === '--apply') {
            options.apply = true;
        } else if (arg === '--min-score' && i + 1 < args.length) {
            options.minScore = parseInt(args[++i], 10);
        } else if (arg === '--max-iter' && i + 1 < args.length) {
            options.maxIterations = parseInt(args[++i], 10);
        } else if (arg === '--help') {
            options.help = true;
        }
        i++;
    }

    options.language = normalizeLanguage(options.language);
    useLocal = options.local;

    if (options.help) {
        printUsage();
        return;
    }

    if (!options.bible) {
        console.error('--bible <name> is required (e.g., --bible osnb2)');
        return;
    }

    const langCode = getLanguageCode(options.language);
    const days = loadDays(langCode);
    if (days.length === 0) {
        console.error(`No day definitions found for language: ${langCode}`);
        return;
    }

    const bookStart = options.bookStart || 1;
    const bookEnd = options.bookEnd || 66;
    const chapterStart = options.chapterStart || null;
    const chapterEnd = options.chapterEnd || null;

    // Find already-tagged chapters
    const taggedChapters = new Set();
    if (!options.force) {
        const tagDir = path.join(__dirname, 'day_tags', langCode);
        if (fs.existsSync(tagDir)) {
            for (const bookDir of fs.readdirSync(tagDir)) {
                const bookPath = path.join(tagDir, bookDir);
                if (!fs.statSync(bookPath).isDirectory()) continue;
                for (const chFile of fs.readdirSync(bookPath).filter(f => f.endsWith('.json'))) {
                    taggedChapters.add(`${bookDir}:${chFile.replace('.json', '')}`);
                }
            }
        }
    }

    const totalChapters = countChapters(bookStart, bookEnd, chapterStart, chapterEnd);
    const modes = ['Tag'];
    if (options.proofread) modes.push('Proofread');
    if (options.apply) modes.push('Apply');

    console.log(`Day tagging: ${totalChapters} chapters from ${options.bible} (${useLocal ? 'Ollama' : 'Claude'})`);
    console.log(`Mode: ${modes.join(' → ')}`);
    console.log(`Days loaded: ${days.length}`);
    if (bookStart !== 1 || bookEnd !== 66) console.log(`Books: ${bookStart}-${bookEnd}`);
    if (chapterStart) console.log(`Chapters: ${chapterStart}-${chapterEnd}`);
    if (options.proofread && options.apply) {
        console.log(`Feedback loop: min score ${options.minScore}/10, max ${options.maxIterations} iterations`);
    }
    console.log('');

    let processed = 0;
    let tagged = 0;
    let skipped = 0;
    let totalDayTags = 0;
    const startTime = Date.now();

    for (const book of books) {
        if (book.id < bookStart || book.id > bookEnd) continue;

        const bookName = getBookName(book.id, options.language);
        const startCh = (book.id === bookStart && chapterStart) ? chapterStart : 1;
        const endCh = (book.id === bookEnd && chapterEnd) ? Math.min(chapterEnd, book.chapters) : book.chapters;

        for (let chapterId = startCh; chapterId <= endCh; chapterId++) {
            processed++;
            const pct = Math.round((processed / totalChapters) * 100);
            const elapsed = (Date.now() - startTime) / 1000;
            const rate = processed / elapsed || 1;
            const remaining = Math.round((totalChapters - processed) / rate);
            const mins = Math.floor(remaining / 60);
            const secs = remaining % 60;
            process.stdout.write(`\r  [${pct}%] ${processed}/${totalChapters} — ${bookName} ${chapterId} — ${tagged} tagged (${totalDayTags} days) — ~${mins}m${secs}s left${''.padEnd(10)}`);

            // Skip if already tagged
            if (!options.force && taggedChapters.has(`${book.id}:${chapterId}`)) {
                skipped++;
                continue;
            }

            try {
                // Step 1: Tag
                const result = await tagChapter(langCode, options.bible, book.id, chapterId, days, options);
                if (!result) continue;
                tagged++;
                totalDayTags += result.days.length;

                // Step 2: Proofread loop
                if (options.proofread && result.days.length > 0) {
                    let iteration = 0;
                    let lastScore = 0;

                    while (iteration < options.maxIterations) {
                        iteration++;
                        const proofResult = await proofreadChapter(langCode, options.bible, book.id, chapterId, days, options);
                        if (!proofResult) break;

                        lastScore = proofResult.score ?? 10;

                        if (options.apply && proofResult) {
                            applyProofreadChanges(langCode, book.id, chapterId, proofResult);
                        }

                        if (lastScore >= options.minScore) break;

                        if (iteration < options.maxIterations) {
                            process.stdout.write(`\n  Score ${lastScore}/10 < ${options.minScore} — re-proofreading (${iteration + 1}/${options.maxIterations})...`);
                        }
                    }
                }
            } catch (error) {
                process.stdout.write(`\n  Error: ${bookName} ${chapterId}: ${error.message}\n`);
            }
        }
    }

    process.stdout.write('\r' + ''.padEnd(120) + '\r');
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(`\nDone in ${Math.floor(elapsed / 60)}m${elapsed % 60}s — ${tagged} tagged (${totalDayTags} day connections), ${skipped} skipped`);
}

main().catch(console.error);
