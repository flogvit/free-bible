import dotenv from 'dotenv'
import * as fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config()

import Anthropic from '@anthropic-ai/sdk';
import {books, anthropicModel, normalizeLanguage, getLanguageCode, getBookName} from "./constants.js";

const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
});

const MAX_RETRIES = 3;

// Get original source based on book ID
function getOriginalSource(bookId) {
    return bookId <= 39 ? 'tanach' : 'sblgnt';
}

// Read original chapter text from bibles_raw
function readOriginalChapter(bookId, chapterId) {
    const source = getOriginalSource(bookId);
    const sourceFile = path.join(__dirname, `bibles_raw/${source}/${bookId}/${chapterId}.json`);

    if (!fs.existsSync(sourceFile)) {
        console.error(`Original source not found: ${sourceFile}`);
        return null;
    }

    const verses = JSON.parse(fs.readFileSync(sourceFile, 'utf-8'));
    return verses.map(v => `${v.verseId}: ${v.text}`).join('\n');
}

// Get summary generation prompt
function getSummaryPrompt(language, bookId, chapter, originalText) {
    const bookName = getBookName(bookId, language);
    const bibleRef = `${bookName} ${chapter}`;
    const langCode = getLanguageCode(language);
    const originalLanguage = bookId <= 39 ? 'hebraisk' : 'gresk';
    const originalLanguageEn = bookId <= 39 ? 'Hebrew' : 'Greek';

    const structureNb = `Bruk følgende struktur:

**Hovedtema:** Én setning som oppsummerer hva kapitlet handler om.

**Innhold:** Ett kort avsnitt (maks 3-5 setninger) som oppsummerer hovedinnholdet. Vær konsis – ikke gjenfortell hele kapitlet vers for vers. Referer til versgrupper i parentes, f.eks. (v. 1-3). Hvis innholdet er naturlig sekvensielt (som skapelsesdagene eller de ti bud), kan du bruke en kort nummerert liste i stedet.

**Nøkkelord/bilder:** 3-5 viktige begreper, symboler eller bilder i teksten med kort forklaring (én setning hver).`;

    const structureNn = `Bruk følgjande struktur:

**Hovudtema:** Éi setning som oppsummerer kva kapitlet handlar om.

**Innhald:** Eitt kort avsnitt (maks 3-5 setningar) som oppsummerer hovudinnhaldet. Ver kortfatta – ikkje gjenfortell heile kapitlet vers for vers. Referer til versgrupper i parentes, t.d. (v. 1-3). Dersom innhaldet er naturleg sekvensielt (som skapingsdagane eller dei ti boda), kan du bruke ei kort nummerert liste i staden.

**Nøkkelord/bilete:** 3-5 viktige omgrep, symbol eller bilete i teksten med kort forklaring (éi setning kvar).`;

    const structureEn = `Use the following structure:

**Main theme:** One sentence summarizing what the chapter is about.

**Content:** One short paragraph (max 3-5 sentences) summarizing the main content. Be concise – do not retell the entire chapter verse by verse. Reference verse groups in parentheses, e.g. (v. 1-3). If the content is naturally sequential (like the days of creation or the ten commandments), you may use a short numbered list instead.

**Key words/images:** 3-5 important concepts, symbols or images in the text with brief explanation (one sentence each).`;

    if (langCode === 'nb') {
        return `Lag et sammendrag av ${bibleRef} på norsk, bokmål.

${structureNb}

Her er den ${originalLanguage}e originalteksten:
${originalText}`;
    } else if (langCode === 'nn') {
        return `Lag eit samandrag av ${bibleRef} på norsk, nynorsk.

${structureNn}

Her er den ${originalLanguage}e originalteksten:
${originalText}`;
    } else {
        return `Write a summary of ${bibleRef} in ${language}.

${structureEn}

Here is the original ${originalLanguageEn} text:
${originalText}`;
    }
}

// Proofread prompt for summaries
function getProofreadPrompt(language, bookId, chapter, currentSummary, originalText) {
    const bookName = getBookName(bookId, language);
    const bibleRef = `${bookName} ${chapter}`;
    const langCode = getLanguageCode(language);
    const originalLanguage = bookId <= 39 ? 'hebraisk' : 'gresk';
    const originalLanguageEn = bookId <= 39 ? 'Hebrew' : 'Greek';

    let basePrompt;
    let structureReminder;

    if (langCode === 'nb') {
        basePrompt = `Du er en korrekturleser for bibelsammendrag. Gå gjennom følgende sammendrag av ${bibleRef}.
Du får også den ${originalLanguage}e originalteksten for å verifisere nøyaktigheten.`;
        structureReminder = `VIKTIG: Sammendraget MÅ beholde følgende struktur og lengde:
- **Hovedtema:** (én setning)
- **Innhold:** (maks 3-5 setninger – vær konsis, ikke gjenfortell vers for vers)
- **Nøkkelord/bilder:** (3-5 begreper med én setning forklaring hver)

Hvis det nåværende sammendraget mangler strukturen eller er for langt, må revisedSummary korrigere dette.`;
    } else if (langCode === 'nn') {
        basePrompt = `Du er ein korrekturlesar for bibelsamandrag. Gå gjennom følgjande samandrag av ${bibleRef}.
Du får også den ${originalLanguage}e originalteksten for å verifisere nøyaktigheita.`;
        structureReminder = `VIKTIG: Samandraget MÅ behalde følgjande struktur og lengd:
- **Hovudtema:** (éi setning)
- **Innhald:** (maks 3-5 setningar – ver kortfatta, ikkje gjenfortell vers for vers)
- **Nøkkelord/bilete:** (3-5 omgrep med éi setning forklaring kvar)

Dersom det noverande samandraget manglar strukturen eller er for langt, må revisedSummary korrigere dette.`;
    } else {
        basePrompt = `You are a proofreader for Bible summaries. Review the following summary of ${bibleRef}.
You are also given the original ${originalLanguageEn} text to verify accuracy.`;
        structureReminder = `IMPORTANT: The summary MUST maintain this structure and length:
- **Main theme:** (one sentence)
- **Content:** (max 3-5 sentences – be concise, do not retell verse by verse)
- **Key words/images:** (3-5 concepts with one sentence explanation each)

If the current summary lacks the structure or is too long, revisedSummary must correct this.`;
    }

    return `${basePrompt}

Your task is to review the summary and identify:
- Factual errors or inaccuracies compared to the original text
- Missing important points that should be included
- Awkward phrasing that could be improved
- Grammar or spelling errors
- Theological concerns
- Missing or incorrect structure

${structureReminder}

Return your response as JSON only, in this format:
{
    "issues": [
        {
            "type": "error|suggestion|theological|grammar|missing|structure",
            "severity": "critical|major|minor",
            "current": "the problematic text or section",
            "suggested": "the corrected or improved text",
            "explanation": "why this change is recommended"
        }
    ],
    "summary": "Overall assessment of the summary quality",
    "score": 1-10,
    "revisedSummary": "If there are issues, provide the complete revised summary here. If no issues, leave empty."
}

IMPORTANT:
- If the current summary is good and has no issues, return an empty issues array and no revisedSummary
- The revisedSummary MUST use the required structure (Hovedtema/Innhold/Nøkkelord)
- Focus on accuracy and faithfulness to the biblical text

Original text:
${originalText}

Current summary:
${currentSummary}`;
}

async function doAnthropicCall(content) {
    return anthropic.messages.create({
        model: anthropicModel,
        max_tokens: 4096,
        messages: [
            {
                role: "user",
                content
            }
        ]
    });
}

function parseJsonResponse(text) {
    let cleaned = text
        .replace(/```json\s*/g, '')
        .replace(/```\s*/g, '')
        .trim();

    const objectMatch = cleaned.match(/\{[\s\S]*}/);
    if (objectMatch) {
        cleaned = objectMatch[0];
    }

    try {
        return JSON.parse(cleaned);
    } catch (e) {
        // Continue to repair attempts
    }

    // Repair attempt: handle unicode quotes
    let repaired = cleaned
        .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"')
        .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'");

    try {
        return JSON.parse(repaired);
    } catch (e) {
        throw new Error(`JSON parse failed. Original text (first 500 chars): ${cleaned.substring(0, 500)}`);
    }
}

async function doAnthropicCallWithRetry(content, context = '') {
    let lastError;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const completion = await doAnthropicCall(content);
            return completion.content[0].text;
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

function getOutputPath(language, bookId, chapterId) {
    const langCode = getLanguageCode(language);
    return path.join(__dirname, `chapter_summaries/${langCode}/${bookId}-${chapterId}.md`);
}

function getProofreadPath(language, bookId, chapterId) {
    const langCode = getLanguageCode(language);
    return path.join(__dirname, `proofread_summaries/${langCode}/${bookId}-${chapterId}.json`);
}

function fileExists(filepath) {
    return fs.existsSync(filepath) && fs.statSync(filepath).size > 0;
}

async function generateChapterSummary(language, bookId, chapter, filename) {
    const bookName = getBookName(bookId, language);

    // Read the original text
    const originalText = readOriginalChapter(bookId, chapter);
    if (!originalText) {
        console.log(`Skipping ${bookName} ${chapter} (no original text found)`);
        return;
    }

    const prompt = getSummaryPrompt(language, bookId, chapter, originalText);

    console.log(`Generating summary for ${bookName} ${chapter}...`);
    const text = await doAnthropicCallWithRetry(prompt, `${bookId}:${chapter}`);

    const dir = path.dirname(filename);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, {recursive: true});
    }

    fs.writeFileSync(filename, text);
    console.log(`Saved: ${filename}`);
}

async function proofreadChapterSummary(language, bookId, chapter, summaryFilename, saveToFile = true) {
    if (!fileExists(summaryFilename)) {
        console.log(`No summary file found for ${bookId}:${chapter}`);
        return null;
    }

    const bookName = getBookName(bookId, language);

    // Read the original text for verification
    const originalText = readOriginalChapter(bookId, chapter);
    if (!originalText) {
        console.log(`Skipping proofread for ${bookName} ${chapter} (no original text found)`);
        return null;
    }

    const currentSummary = fs.readFileSync(summaryFilename, 'utf-8');

    console.log(`Proofreading summary for ${bookName} ${chapter}...`);

    const prompt = getProofreadPrompt(language, bookId, chapter, currentSummary, originalText);
    const responseText = await doAnthropicCallWithRetry(prompt, `proofread ${bookId}:${chapter}`);
    const result = parseJsonResponse(responseText);

    // Save proofread results if requested
    if (saveToFile) {
        const proofreadFile = getProofreadPath(language, bookId, chapter);
        const dir = path.dirname(proofreadFile);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, {recursive: true});
        }
        console.log("Writing proofread results to", proofreadFile);
        fs.writeFileSync(proofreadFile, JSON.stringify(result, null, 2));
    }

    // Print summary
    console.log(`\nProofread results for ${bookName} ${chapter}:`);
    if (result.score !== null && result.score !== undefined) {
        console.log(`Score: ${result.score}/10`);
    }
    console.log(`Summary: ${result.summary}`);
    if (result.issues && result.issues.length > 0) {
        console.log(`Issues found: ${result.issues.length}`);
        result.issues.forEach((issue, i) => {
            console.log(`  ${i + 1}. [${issue.severity}] ${issue.type}`);
            console.log(`     ${issue.explanation}`);
        });
    }

    return result;
}

function applyProofreadChanges(language, bookId, chapter, summaryFilename, proofreadResult = null) {
    // Load proofread result from file if not provided
    if (!proofreadResult) {
        const proofreadFile = getProofreadPath(language, bookId, chapter);
        if (!fileExists(proofreadFile)) {
            console.log(`No proofread file found for ${bookId}:${chapter}`);
            return;
        }
        proofreadResult = JSON.parse(fs.readFileSync(proofreadFile, 'utf-8'));
    }

    if (!fileExists(summaryFilename)) {
        console.log(`No summary file found for ${bookId}:${chapter}`);
        return;
    }

    // Check if there's a revised summary to apply
    if (!proofreadResult.revisedSummary || proofreadResult.revisedSummary.trim() === '') {
        console.log(`No revisions needed for ${bookId}:${chapter}`);
        return;
    }

    // Write the revised summary
    fs.writeFileSync(summaryFilename, proofreadResult.revisedSummary);
    const bookName = getBookName(bookId, language);
    console.log(`Applied revisions to ${bookName} ${chapter}`);
}

function printUsage() {
    console.log(`
Usage: node chapter_summary.mjs [options]

Options:
  --language <lang>  Language for summaries (default: nb)
                     Accepts codes (nb, nn, en, de, es, fr, sv, da) or full names
  --proofread        Run proofreading after generation
  --apply            Apply proofread suggestions (requires prior --proofread run)
  --ot               Process only Old Testament (books 1-39)
  --nt               Process only New Testament (books 40-66)
  --book <range>     Process book(s): single (43) or range (1-20)
  --chapter <range>  Process chapter(s): single (1) or range (1-10)
  --force            Force re-generation even if file exists
  --help             Show this help message

Output structure:
  chapter_summaries/<lang>/<book>-<chapter>.md
  e.g., chapter_summaries/nb/43-1.md

Examples:
  node chapter_summary.mjs --nt                              # Generate NT summaries (Norwegian bokmål)
  node chapter_summary.mjs --language nn --ot                # Generate OT summaries (Norwegian nynorsk)
  node chapter_summary.mjs --language en --book 43           # Generate John summaries (English)
  node chapter_summary.mjs --book 43 --chapter 1-11          # Generate John 1-11 summaries
  node chapter_summary.mjs --nt --proofread --apply          # Generate → proofread → apply
  node chapter_summary.mjs --book 1 --force                  # Re-generate Genesis summaries

Parallel processing (run in separate terminals):
  node chapter_summary.mjs --book 1-20 &                     # terminal 1
  node chapter_summary.mjs --book 21-39 &                    # terminal 2
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
        language: 'Norwegian bokmål',
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

        if (arg === '--language' && i + 1 < args.length) {
            options.language = args[++i];
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
        }
        i++;
    }

    return options;
}

async function main() {
    const args = process.argv.slice(2);
    const options = parseArgs(args);

    // Normalize language (accept both codes like 'nb' and full names like 'Norwegian bokmål')
    options.language = normalizeLanguage(options.language);

    if (options.help) {
        printUsage();
        return;
    }

    // Determine book range
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

    const modes = ['Generate'];
    if (options.proofread) modes.push('Proofread');
    if (options.apply) modes.push('Apply');

    console.log(`Language: ${options.language}`);
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
            const filename = getOutputPath(options.language, bookId, chapterId);

            // Step 1: Generate (skip if file exists unless --force)
            if (!fileExists(filename) || options.force) {
                await generateChapterSummary(options.language, bookId, chapterId, filename);
            } else {
                const bookName = getBookName(bookId, options.language);
                console.log(`Skipping ${bookName} ${chapterId} (already exists)`);
            }

            // Step 2: Proofread (if requested)
            let proofreadResult = null;
            if (options.proofread && fileExists(filename)) {
                const saveToFile = !options.apply;
                proofreadResult = await proofreadChapterSummary(options.language, bookId, chapterId, filename, saveToFile);
            }

            // Step 3: Apply (if requested)
            if (options.apply) {
                applyProofreadChanges(options.language, bookId, chapterId, filename, proofreadResult);
            }
        }
    }

    console.log('Done!');
}

main().catch(console.error);
