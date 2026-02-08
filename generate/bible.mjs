import dotenv from 'dotenv'
import * as fs from 'fs';
import path from 'path';

dotenv.config()

import Anthropic from '@anthropic-ai/sdk';
import {bibles, books, anthropicModel, maxTokens} from "./constants.js";

const anthropic = new Anthropic();

const MAX_VERSES_PER_BATCH = 100;
const MAX_PROOFREAD_CHARS = 20000; // Target max input chars per proofread batch

// --- JSON Schemas for structured outputs ---

const TRANSLATION_SCHEMA = {
    type: "object",
    properties: {
        verses: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    bookId: {type: "integer"},
                    chapterId: {type: "integer"},
                    verseId: {type: "integer"},
                    text: {type: "string"}
                },
                required: ["bookId", "chapterId", "verseId", "text"],
                additionalProperties: false
            }
        }
    },
    required: ["verses"],
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
                    verseId: {type: "integer"},
                    type: {type: "string", enum: ["error", "suggestion", "theological", "grammar"]},
                    severity: {type: "string", enum: ["critical", "major", "minor"]},
                    original: {type: "string"},
                    current: {type: "string"},
                    suggested: {type: "string"},
                    explanation: {type: "string"}
                },
                required: ["verseId", "type", "severity", "original", "current", "suggested", "explanation"],
                additionalProperties: false
            }
        },
        summary: {type: "string"},
        score: {type: "integer"}
    },
    required: ["issues", "summary", "score"],
    additionalProperties: false
};

// Translation style prompts
const TRANSLATION_PROMPTS = {
    standard: (language) => `Translation must be ${language} in a modern, easy to read, language. But you should emphasize translating theologically correct.`,
    oral: (language) => `Translate the text to ${language} in a modern, adult language that flows well for both silent reading and oral reading.
Optimize for natural rhythm, clear flow, and readability. Allow flexibility from literal wording when it improves clarity or flow, but preserve the meaning of the text.
The translation must be theologically correct in line with Lutheran theology.
Do not make the language childish, explanatory, or paraphrased.`
};

// Proof-reading prompt
const PROOFREAD_PROMPT = (language, style) => {
    const styleDescription = style === 'oral'
        ? 'optimized for oral reading with natural rhythm and flow'
        : 'modern and easy to read while being theologically correct';

    return `You are a Bible translation proofreader. You will receive:
1. The original biblical text (Hebrew/Greek)
2. A translation that should be ${language}, ${styleDescription}

Your task is to review the translation and identify:
- Translation errors or inaccuracies
- Awkward phrasing that could be improved
- Theological concerns
- Missing or added content
- Grammar or spelling errors

IMPORTANT:
- The "suggested" field must contain the ENTIRE corrected verse, not just the changed phrase.
- Some verses have VERSION HISTORY showing previous revisions. Read the history carefully.
- NEVER suggest text that matches or is similar to ANY previous version in the history.
- NEVER undo a change that was intentionally made (check the "Reason for change").
- If a verse has 3+ revisions, it has been extensively reviewed - only suggest changes for CRITICAL errors.
- If the current version is acceptable, SKIP that verse entirely - do not include it in issues.
- Focus only on verses WITHOUT version history, or verses with genuine new errors.

If there are no issues (or all issues are in well-reviewed verses), return an empty issues array.`;
};

const MAX_RETRIES = 3;

async function doAnthropicCall(content, schema) {
    return anthropic.messages.create({
        model: anthropicModel,
        max_tokens: maxTokens,
        messages: [
            {
                role: "user",
                content
            }
        ],
        output_config: {
            format: {
                type: "json_schema",
                schema
            }
        }
    });
}

// Detect hallucinated English words that shouldn't appear in Norwegian/other translations
function isEnglishLanguage(language) {
    const lower = language.toLowerCase();
    return lower === 'english' || lower === 'en';
}

const HALLUCINATION_PATTERNS = [
    /\bsatisf\w+/i,
    /\bthe\s+[a-z]+ing\b/i,
    /\bhowever\b/i,
    /\btherefore\b/i,
    /\bmoreover\b/i,
    /\bfurthermore\b/i,
    /\bnevertheless\b/i,
    /\balthough\b/i,
    /\bwhich\s+is\b/i,
    /\bthat\s+is\b/i,
];

function detectHallucinations(text) {
    const found = [];
    for (const pattern of HALLUCINATION_PATTERNS) {
        const match = text.match(pattern);
        if (match) {
            found.push(match[0]);
        }
    }
    return found;
}

function validateTranslationResult(result) {
    const verses = Array.isArray(result) ? result : [result];

    for (const verse of verses) {
        if (verse.text) {
            const hallucinations = detectHallucinations(verse.text);
            if (hallucinations.length > 0) {
                throw new Error(`Hallucinated English detected: "${hallucinations.join('", "')}"`);
            }
        }
        if (verse.issues) {
            const filtered = verse.issues.filter(issue => {
                if (issue.suggested) {
                    const hallucinations = detectHallucinations(issue.suggested);
                    if (hallucinations.length > 0) {
                        console.log(`  Filtered out hallucinated suggestion: "${hallucinations.join('", "')}" in verse ${issue.verseId || '?'}`);
                        return false;
                    }
                }
                return true;
            });
            verse.issues = filtered;
        }
    }

    return true;
}

async function doAnthropicCallWithRetry(content, schema, context = '', validate = true) {
    let lastError;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const completion = await doAnthropicCall(content, schema);
            if (completion.stop_reason === 'max_tokens') {
                throw new Error(`Response truncated (hit max_tokens limit of ${maxTokens})`);
            }
            const responseText = completion.content[0].text;
            const result = JSON.parse(responseText);

            if (validate) {
                validateTranslationResult(result);
            }

            return result;
        } catch (error) {
            lastError = error;
            if (attempt < MAX_RETRIES) {
                console.log(`  Attempt ${attempt} failed (${error.message}), retrying...`);
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
    }

    console.error(`Failed after ${MAX_RETRIES} attempts for ${context}`);
    throw lastError;
}

function getOriginalSource(bookId) {
    return bookId <= 39 ? 'tanach' : 'sblgnt';
}

function readOriginalText(bookId, chapterId, existingVerses = []) {
    const source = getOriginalSource(bookId);
    const sourceFile = `bibles_raw/${source}/${bookId}/${chapterId}.json`;

    if (!fs.existsSync(sourceFile)) {
        console.error(`Original source not found: ${sourceFile}`);
        return [];
    }

    const allVerses = JSON.parse(fs.readFileSync(sourceFile, 'utf-8'));

    return allVerses.filter(verse =>
        !existingVerses.some(v => +v.verseId === +verse.verseId)
    );
}

function getTranslationPrompt(style, language, bookId, chapterId, text) {
    const stylePrompt = TRANSLATION_PROMPTS[style](language);

    return `You will be given a bible text in the original language, and must return the translation.
Return a JSON object with a "verses" array containing each verse.

${stylePrompt}

Book ID: ${bookId}, Chapter: ${chapterId}

Text:
${text}`;
}

function getProofreadPrompt(language, style, bookId, chapterId, originalText, translatedVerses) {
    const formattedTranslation = translatedVerses.map(v => {
        let entry = `${v.verseId}: ${v.text}`;
        if (v.versions && v.versions.length > 0) {
            entry += `\n   VERSION HISTORY (${v.versions.length} previous revisions - DO NOT suggest any of these):`;
            v.versions.forEach((ver, i) => {
                const typeInfo = ver.type ? ` [${ver.type}/${ver.severity || 'unknown'}]` : '';
                entry += `\n   ${i + 1}.${typeInfo} "${ver.text}"`;
                if (ver.explanation) {
                    entry += `\n      Reason for change: ${ver.explanation}`;
                }
            });
        }
        return entry;
    }).join('\n');

    return `${PROOFREAD_PROMPT(language, style)}

Book ID: ${bookId}, Chapter: ${chapterId}

Original text:
${originalText}

Current translation (with version history where available):
${formattedTranslation}`;
}

async function translateChapter(bible, bookId, chapterId, style, existingVerses, filename) {
    const language = bibles[bible];
    const verses = readOriginalText(bookId, chapterId, existingVerses);

    if (verses.length === 0) {
        return;
    }

    const batches = [];
    for (let i = 0; i < verses.length; i += MAX_VERSES_PER_BATCH) {
        batches.push(verses.slice(i, i + MAX_VERSES_PER_BATCH));
    }

    console.log(`Processing ${verses.length} verses in ${batches.length} batch(es)`);

    const allResults = [];

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        const batch = batches[batchIndex];
        console.log(`Processing batch ${batchIndex + 1}/${batches.length} (${batch.length} verses)`);

        const formattedBatch = batch.map(v => `${v.verseId}: ${v.text}`).join("\n");
        const content = getTranslationPrompt(style, language, bookId, chapterId, formattedBatch);
        const shouldValidate = !isEnglishLanguage(language);
        const result = await doAnthropicCallWithRetry(content, TRANSLATION_SCHEMA, `${bookId}:${chapterId} batch ${batchIndex + 1}`, shouldValidate);
        allResults.push(...result.verses);
    }

    const dir = path.dirname(filename);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, {recursive: true});
    }

    const finalResult = [...existingVerses, ...allResults].sort((a, b) => a.verseId - b.verseId);
    console.log("Writing", filename);
    fs.writeFileSync(filename, JSON.stringify(finalResult, null, 2));
}

function estimateVerseSize(verse, originalVerse) {
    let size = 0;

    if (originalVerse) {
        size += `${originalVerse.verseId}: ${originalVerse.text}\n`.length;
    }

    size += `${verse.verseId}: ${verse.text}\n`.length;

    if (verse.versions && verse.versions.length > 0) {
        size += `   VERSION HISTORY (${verse.versions.length} previous revisions - DO NOT suggest any of these):`.length;
        verse.versions.forEach((ver, i) => {
            const typeInfo = ver.type ? ` [${ver.type}/${ver.severity || 'unknown'}]` : '';
            size += `\n   ${i + 1}.${typeInfo} "${ver.text}"`.length;
            if (ver.explanation) {
                size += `\n      Reason for change: ${ver.explanation}`.length;
            }
        });
    }

    return size;
}

function createProofreadBatches(translatedVerses, originalVerses) {
    const batches = [];
    let currentBatch = [];
    let currentSize = 0;

    for (const verse of translatedVerses) {
        const originalVerse = originalVerses.find(v => +v.verseId === +verse.verseId);
        const verseSize = estimateVerseSize(verse, originalVerse);

        if (currentSize + verseSize > MAX_PROOFREAD_CHARS && currentBatch.length > 0) {
            batches.push(currentBatch);
            currentBatch = [];
            currentSize = 0;
        }

        currentBatch.push(verse);
        currentSize += verseSize;
    }

    if (currentBatch.length > 0) {
        batches.push(currentBatch);
    }

    return batches;
}

async function proofreadChapter(bible, bookId, chapterId, style, filename, saveToFile = true) {
    const language = bibles[bible];

    if (!fs.existsSync(filename)) {
        console.log(`No translation file found for ${bookId}:${chapterId}`);
        return null;
    }

    const translatedVerses = JSON.parse(fs.readFileSync(filename, 'utf-8'));
    const originalVerses = readOriginalText(bookId, chapterId, []);

    if (originalVerses.length === 0) {
        console.log(`No original text found for ${bookId}:${chapterId}`);
        return null;
    }

    const batches = createProofreadBatches(translatedVerses, originalVerses);

    console.log(`Proofreading ${bookId}:${chapterId} (${translatedVerses.length} verses in ${batches.length} batch(es))`);

    const allIssues = [];
    const summaries = [];
    const scores = [];

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        const batch = batches[batchIndex];
        const batchVerseIds = batch.map(v => v.verseId);
        const batchOriginal = originalVerses.filter(v => batchVerseIds.includes(+v.verseId));

        if (batches.length > 1) {
            console.log(`  Batch ${batchIndex + 1}/${batches.length}: verses ${batchVerseIds[0]}-${batchVerseIds[batchVerseIds.length - 1]}`);
        }

        const formattedOriginal = batchOriginal.map(v => `${v.verseId}: ${v.text}`).join("\n");
        const content = getProofreadPrompt(language, style, bookId, chapterId, formattedOriginal, batch);
        const shouldValidate = !isEnglishLanguage(language);
        const batchResult = await doAnthropicCallWithRetry(content, PROOFREAD_SCHEMA, `proofread ${bookId}:${chapterId} batch ${batchIndex + 1}`, shouldValidate);

        if (batchResult.issues) {
            allIssues.push(...batchResult.issues);
        }
        if (batchResult.summary) {
            summaries.push(batchResult.summary);
        }
        if (batchResult.score !== null && batchResult.score !== undefined) {
            scores.push(batchResult.score);
        }
    }

    let result = {
        issues: allIssues,
        summary: batches.length > 1
            ? `Combined from ${batches.length} batches: ${summaries.join(' | ')}`
            : (summaries[0] || (allIssues.length === 0 ? "No issues found" : `Found ${allIssues.length} issue(s)`)),
        score: scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null
    };

    if (saveToFile) {
        const proofreadDir = `proofread/${bible}/${bookId}`;
        if (!fs.existsSync(proofreadDir)) {
            fs.mkdirSync(proofreadDir, {recursive: true});
        }
        const proofreadFile = `${proofreadDir}/${chapterId}.json`;
        console.log("Writing proofread results to", proofreadFile);
        fs.writeFileSync(proofreadFile, JSON.stringify(result, null, 2));
    }

    console.log(`\nProofread results for ${bookId}:${chapterId}:`);
    if (result.score !== null) {
        console.log(`Score: ${result.score}/10`);
    }
    console.log(`Summary: ${result.summary}`);
    if (result.issues && result.issues.length > 0) {
        console.log(`Issues found: ${result.issues.length}`);
        result.issues.forEach((issue, i) => {
            console.log(`  ${i + 1}. [${issue.severity}] Verse ${issue.verseId}: ${issue.type}`);
            console.log(`     ${issue.explanation}`);
        });
    }

    return result;
}

function applyProofreadChanges(bible, bookId, chapterId, filename, proofreadResult = null) {
    if (!proofreadResult) {
        const proofreadFile = `proofread/${bible}/${bookId}/${chapterId}.json`;
        if (!fs.existsSync(proofreadFile)) {
            console.log(`No proofread file found for ${bookId}:${chapterId}`);
            return;
        }
        proofreadResult = JSON.parse(fs.readFileSync(proofreadFile, 'utf-8'));
    }

    if (!fs.existsSync(filename)) {
        console.log(`No translation file found for ${bookId}:${chapterId}`);
        return;
    }

    const verses = JSON.parse(fs.readFileSync(filename, 'utf-8'));

    if (!proofreadResult.issues || proofreadResult.issues.length === 0) {
        return;
    }

    let appliedCount = 0;

    for (const issue of proofreadResult.issues) {
        if (!issue.suggested) continue;

        const verse = verses.find(v => +v.verseId === +issue.verseId);
        if (!verse) {
            console.log(`  Verse ${issue.verseId} not found, skipping`);
            continue;
        }

        if (verse.text === issue.suggested) {
            continue;
        }

        if (!verse.versions) {
            verse.versions = [];
        }

        verse.versions.push({
            text: verse.text,
            type: issue.type,
            severity: issue.severity,
            explanation: issue.explanation
        });

        verse.text = issue.suggested;
        appliedCount++;

        console.log(`  Applied: Verse ${issue.verseId} [${issue.type}/${issue.severity}]`);
    }

    if (appliedCount > 0) {
        fs.writeFileSync(filename, JSON.stringify(verses, null, 2));
        console.log(`Applied ${appliedCount} changes to ${bookId}:${chapterId}`);
    }
}

function printUsage() {
    console.log(`
Usage: node bible_test.mjs <bible> [options]

Arguments:
  bible              Bible version to work with (e.g., osnb1, osnb2, osnn1)

Options:
  --style <type>     Translation style: standard, oral (default: standard)
  --proofread        Run proofreading after translation (can combine with translation)
  --apply            Apply proofread suggestions (requires prior --proofread run)
  --ot               Process only Old Testament (books 1-39)
  --nt               Process only New Testament (books 40-66)
  --book <range>     Process book(s): single (43) or range (1-20)
  --chapter <range>  Process chapter(s): single (1) or range (1-10)
  --force            Force re-translation even if file exists
  --help             Show this help message

Examples:
  node bible_test.mjs osnb2 --style oral --nt
  node bible_test.mjs osnb2 --book 43 --chapter 1-11
  node bible_test.mjs osnb2 --nt --proofread --apply
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
    const options = {
        bible: null,
        style: 'standard',
        proofread: false,
        apply: false,
        ot: false,
        nt: false,
        bookStart: null,
        bookEnd: null,
        chapterStart: null,
        chapterEnd: null,
        force: false,
        help: false
    };

    let i = 0;
    while (i < args.length) {
        const arg = args[i];

        if (arg === '--style' && i + 1 < args.length) {
            options.style = args[++i];
        } else if (arg === '--proofread') {
            options.proofread = true;
        } else if (arg === '--apply') {
            options.apply = true;
        } else if (arg === '--ot') {
            options.ot = true;
        } else if (arg === '--nt') {
            options.nt = true;
        } else if (arg === '--book' && i + 1 < args.length) {
            const range = parseRange(args[++i]);
            options.bookStart = range.start;
            options.bookEnd = range.end;
        } else if (arg === '--chapter' && i + 1 < args.length) {
            const range = parseRange(args[++i]);
            options.chapterStart = range.start;
            options.chapterEnd = range.end;
        } else if (arg === '--force') {
            options.force = true;
        } else if (arg === '--help') {
            options.help = true;
        } else if (!arg.startsWith('--') && !options.bible) {
            options.bible = arg;
        }
        i++;
    }

    return options;
}

async function main() {
    const args = process.argv.slice(2);
    const options = parseArgs(args);

    if (options.help) {
        printUsage();
        return;
    }

    if (!options.bible) {
        console.error("Error: Bible version is required");
        printUsage();
        process.exit(1);
    }

    if (!bibles[options.bible]) {
        console.error(`Error: Unknown bible version '${options.bible}'. Known versions: ${Object.keys(bibles).join(', ')}`);
        process.exit(1);
    }

    if (!TRANSLATION_PROMPTS[options.style]) {
        console.error(`Error: Unknown style '${options.style}'. Available styles: ${Object.keys(TRANSLATION_PROMPTS).join(', ')}`);
        process.exit(1);
    }

    let startBook = 1;
    let endBook = 66;

    if (options.bookStart !== null) {
        startBook = options.bookStart;
        endBook = options.bookEnd;
    } else if (options.ot && !options.nt) {
        startBook = 1;
        endBook = 39;
    } else if (options.nt && !options.ot) {
        startBook = 40;
        endBook = 66;
    }

    const modes = ['Translation'];
    if (options.proofread) modes.push('Proofread');
    if (options.apply) modes.push('Apply');

    console.log(`Bible: ${options.bible}`);
    console.log(`Style: ${options.style}`);
    console.log(`Mode: ${modes.join(' → ')}`);
    console.log(`Books: ${startBook}-${endBook}`);
    if (options.chapterStart !== null) {
        console.log(`Chapters: ${options.chapterStart}-${options.chapterEnd}`);
    }
    console.log('---');

    for (let bookId = startBook; bookId <= endBook; bookId++) {
        const book = books.find(b => b.id === bookId);
        if (!book) continue;

        const maxChapters = book.chapters;
        const startChapter = options.chapterStart || 1;
        const endChapter = Math.min(options.chapterEnd || maxChapters, maxChapters);

        for (let chapterId = startChapter; chapterId <= endChapter; chapterId++) {
            const dir = `bibles_raw/${options.bible}/${bookId}`;
            const filename = `${dir}/${chapterId}.json`;

            let existingVerses = [];
            if (fs.existsSync(filename) && !options.force) {
                existingVerses = JSON.parse(fs.readFileSync(filename, 'utf-8'));
            }
            await translateChapter(options.bible, bookId, chapterId, options.style, existingVerses, filename);

            let proofreadResult = null;
            if (options.proofread) {
                const saveToFile = !options.apply;
                proofreadResult = await proofreadChapter(options.bible, bookId, chapterId, options.style, filename, saveToFile);
            }

            if (options.apply) {
                applyProofreadChanges(options.bible, bookId, chapterId, filename, proofreadResult);
            }
        }
    }

    console.log('Done!');
}

main().catch(console.error);
