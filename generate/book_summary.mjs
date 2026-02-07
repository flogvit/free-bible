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

// Read all chapters of a book from bibles_raw
function readOriginalBook(bookId) {
    const source = getOriginalSource(bookId);
    const book = books.find(b => b.id === bookId);
    if (!book) return null;

    const chapters = [];
    for (let chapterId = 1; chapterId <= book.chapters; chapterId++) {
        const sourceFile = path.join(__dirname, `bibles_raw/${source}/${bookId}/${chapterId}.json`);
        if (fs.existsSync(sourceFile)) {
            const verses = JSON.parse(fs.readFileSync(sourceFile, 'utf-8'));
            const chapterText = verses.map(v => `${v.verseId}: ${v.text}`).join('\n');
            chapters.push(`Kapittel ${chapterId}:\n${chapterText}`);
        }
    }
    return chapters.join('\n\n');
}

// Get book summary generation prompt
function getSummaryPrompt(language, bookId, originalText) {
    const bookName = getBookName(bookId, language);
    const book = books.find(b => b.id === bookId);
    const chapterCount = book.chapters;
    const langCode = getLanguageCode(language);
    const originalLanguage = bookId <= 39 ? 'hebraisk' : 'gresk';

    const structureNb = `Bruk følgende struktur:

**Om boken:** Et kort avsnitt (2-3 setninger) som introduserer boken – forfatter (hvis kjent), historisk kontekst, og bokens plass i Bibelen.

**Hovedtema:** Én setning som oppsummerer bokens overordnede budskap eller tema.

**Innholdsoversikt:** En liste med hovedoverskrifter som dekker bokens innhold. Hver overskrift skal ha kapittelnummer i parentes og en kort beskrivelse. Grupper kapitler der det er naturlig.

**Nøkkeltemaer:** 3-5 sentrale temaer i boken med kort forklaring (én setning hver).`;

    const structureNn = `Bruk følgjande struktur:

**Om boka:** Eit kort avsnitt (2-3 setningar) som introduserer boka – forfattar (om kjend), historisk kontekst, og boka sin plass i Bibelen.

**Hovudtema:** Éi setning som oppsummerer boka sitt overordna bodskap eller tema.

**Innhaldsoversikt:** Ei liste med hovudoverskrifter som dekker innhaldet i boka. Kvar overskrift skal ha kapitteltal i parentes og ei kort skildring. Grupper kapittel der det er naturleg.

**Nøkkeltema:** 3-5 sentrale tema i boka med kort forklaring (éi setning kvar).`;

    const structureEn = `Use the following structure:

**About the book:** A short paragraph (2-3 sentences) introducing the book – author (if known), historical context, and the book's place in the Bible.

**Main theme:** One sentence summarizing the book's overarching message or theme.

**Content overview:** A list of main headings covering the book's content. Each heading should have chapter numbers in parentheses and a brief description. Group chapters where natural.

**Key themes:** 3-5 central themes in the book with brief explanation (one sentence each).`;

    if (langCode === 'nb') {
        return `Lag et sammendrag av ${bookName} (${chapterCount} kapitler) på norsk, bokmål.

${structureNb}

Her er den ${originalLanguage}e originalteksten for hele boken:
${originalText}`;
    } else if (langCode === 'nn') {
        return `Lag eit samandrag av ${bookName} (${chapterCount} kapittel) på norsk, nynorsk.

${structureNn}

Her er den ${originalLanguage}e originalteksten for heile boka:
${originalText}`;
    } else {
        return `Write a summary of ${bookName} (${chapterCount} chapters) in ${language}.

${structureEn}

Here is the original ${bookId <= 39 ? 'Hebrew' : 'Greek'} text for the entire book:
${originalText}`;
    }
}

// Token estimation: Hebrew/Greek text tokenizes at ~0.8 chars per token (each character ≈ 1.25 tokens)
const ESTIMATED_CHARS_PER_TOKEN = 0.8;
const MAX_PROMPT_TOKENS = 180000; // Leave room for response within 200K limit
const PROMPT_OVERHEAD_TOKENS = 3000; // Approximate tokens for prompt instructions

// Read condensed version of a book (first verse of each chapter)
function readCondensedBook(bookId) {
    const source = getOriginalSource(bookId);
    const book = books.find(b => b.id === bookId);
    if (!book) return null;

    const chapters = [];
    for (let chapterId = 1; chapterId <= book.chapters; chapterId++) {
        const sourceFile = path.join(__dirname, `bibles_raw/${source}/${bookId}/${chapterId}.json`);
        if (fs.existsSync(sourceFile)) {
            const verses = JSON.parse(fs.readFileSync(sourceFile, 'utf-8'));
            const firstVerse = verses[0] ? `1: ${verses[0].text}` : '';
            const lastVerse = verses.length > 1 ? `${verses[verses.length - 1].verseId}: ${verses[verses.length - 1].text}` : '';
            chapters.push(`Kapittel ${chapterId} (${verses.length} vers):\n${firstVerse}${lastVerse ? '\n...\n' + lastVerse : ''}`);
        }
    }
    return chapters.join('\n\n');
}

// Proofread prompt for book summaries
function getProofreadPrompt(language, bookId, currentSummary, originalText) {
    const bookName = getBookName(bookId, language);
    const langCode = getLanguageCode(language);
    const originalLanguage = bookId <= 39 ? 'hebraisk' : 'gresk';

    // Estimate if full text fits within token limits
    const summaryTokens = Math.ceil(currentSummary.length / ESTIMATED_CHARS_PER_TOKEN);
    const originalTokens = Math.ceil(originalText.length / ESTIMATED_CHARS_PER_TOKEN);
    const totalEstimate = summaryTokens + originalTokens + PROMPT_OVERHEAD_TOKENS;
    const textTooLarge = totalEstimate > MAX_PROMPT_TOKENS;

    let referenceText;
    let referenceNote;
    if (textTooLarge) {
        referenceText = readCondensedBook(bookId);
        if (langCode === 'nb') {
            referenceNote = `(Merk: Originalteksten er forkortet til første og siste vers per kapittel pga. størrelse. Bruk din kunnskap om ${bookName} for å verifisere nøyaktigheten.)`;
        } else if (langCode === 'nn') {
            referenceNote = `(Merk: Originalteksten er forkorta til fyrste og siste vers per kapittel pga. storleik. Bruk kunnskapen din om ${bookName} for å verifisere nøyaktigheita.)`;
        } else {
            referenceNote = `(Note: The original text has been condensed to first and last verse per chapter due to size. Use your knowledge of ${bookName} to verify accuracy.)`;
        }
        console.log(`  Note: Original text too large (~${originalTokens} tokens), using condensed version for proofreading`);
    } else {
        referenceText = originalText;
        referenceNote = '';
    }

    let basePrompt;
    let structureReminder;

    if (langCode === 'nb') {
        basePrompt = `Du er en korrekturleser for bibelsammendrag. Gå gjennom følgende sammendrag av ${bookName}.
Du får også den ${originalLanguage}e originalteksten for å verifisere nøyaktigheten.`;
        structureReminder = `VIKTIG: Sammendraget MÅ beholde følgende struktur:
- **Om boken:** (2-3 setninger)
- **Hovedtema:** (én setning)
- **Innholdsoversikt:** (liste med hovedoverskrifter og kapittelnummer)
- **Nøkkeltemaer:** (3-5 temaer med én setning forklaring hver)

Hvis sammendraget mangler strukturen eller har feil, må revisedSummary korrigere dette.`;
    } else if (langCode === 'nn') {
        basePrompt = `Du er ein korrekturlesar for bibelsamandrag. Gå gjennom følgjande samandrag av ${bookName}.
Du får også den ${originalLanguage}e originalteksten for å verifisere nøyaktigheita.`;
        structureReminder = `VIKTIG: Samandraget MÅ behalde følgjande struktur:
- **Om boka:** (2-3 setningar)
- **Hovudtema:** (éi setning)
- **Innhaldsoversikt:** (liste med hovudoverskrifter og kapitteltal)
- **Nøkkeltema:** (3-5 tema med éi setning forklaring kvar)

Dersom samandraget manglar strukturen eller har feil, må revisedSummary korrigere dette.`;
    } else {
        basePrompt = `You are a proofreader for Bible summaries. Review the following summary of ${bookName}.
You are also given the original ${bookId <= 39 ? 'Hebrew' : 'Greek'} text to verify accuracy.`;
        structureReminder = `IMPORTANT: The summary MUST maintain this structure:
- **About the book:** (2-3 sentences)
- **Main theme:** (one sentence)
- **Content overview:** (list of main headings with chapter numbers)
- **Key themes:** (3-5 themes with one sentence explanation each)

If the summary lacks the structure or has errors, revisedSummary must correct this.`;
    }

    return `${basePrompt}
${referenceNote ? '\n' + referenceNote : ''}

Your task is to review the summary and identify:
- Factual errors or inaccuracies compared to the original text
- Missing important content or themes
- Incorrect chapter groupings
- Awkward phrasing that could be improved
- Grammar or spelling errors
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
- The revisedSummary MUST use the required structure
- Focus on accuracy and faithfulness to the biblical text

Original text:
${referenceText}

Current summary:
${currentSummary}`;
}

async function doAnthropicCall(content) {
    return anthropic.messages.create({
        model: anthropicModel,
        max_tokens: 8192,
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

function getOutputPath(language, bookId) {
    const langCode = getLanguageCode(language);
    return path.join(__dirname, `book_summaries/${langCode}/${bookId}.md`);
}

function getProofreadPath(language, bookId) {
    const langCode = getLanguageCode(language);
    return path.join(__dirname, `proofread_book_summaries/${langCode}/${bookId}.json`);
}

function fileExists(filepath) {
    return fs.existsSync(filepath) && fs.statSync(filepath).size > 0;
}

async function generateBookSummary(language, bookId, filename) {
    const bookName = getBookName(bookId, language);

    // Read the original text
    const originalText = readOriginalBook(bookId);
    if (!originalText) {
        console.log(`Skipping ${bookName} (no original text found)`);
        return;
    }

    const prompt = getSummaryPrompt(language, bookId, originalText);

    console.log(`Generating summary for ${bookName}...`);
    const text = await doAnthropicCallWithRetry(prompt, `book ${bookId}`);

    const dir = path.dirname(filename);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, {recursive: true});
    }

    fs.writeFileSync(filename, text);
    console.log(`Saved: ${filename}`);
}

async function proofreadBookSummary(language, bookId, summaryFilename, saveToFile = true) {
    if (!fileExists(summaryFilename)) {
        console.log(`No summary file found for book ${bookId}`);
        return null;
    }

    const bookName = getBookName(bookId, language);

    // Read the original text for verification
    const originalText = readOriginalBook(bookId);
    if (!originalText) {
        console.log(`Skipping proofread for ${bookName} (no original text found)`);
        return null;
    }

    const currentSummary = fs.readFileSync(summaryFilename, 'utf-8');

    console.log(`Proofreading summary for ${bookName}...`);

    const prompt = getProofreadPrompt(language, bookId, currentSummary, originalText);
    const responseText = await doAnthropicCallWithRetry(prompt, `proofread book ${bookId}`);
    const result = parseJsonResponse(responseText);

    // Save proofread results if requested
    if (saveToFile) {
        const proofreadFile = getProofreadPath(language, bookId);
        const dir = path.dirname(proofreadFile);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, {recursive: true});
        }
        console.log("Writing proofread results to", proofreadFile);
        fs.writeFileSync(proofreadFile, JSON.stringify(result, null, 2));
    }

    // Print summary
    console.log(`\nProofread results for ${bookName}:`);
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

function applyProofreadChanges(language, bookId, summaryFilename, proofreadResult = null) {
    // Load proofread result from file if not provided
    if (!proofreadResult) {
        const proofreadFile = getProofreadPath(language, bookId);
        if (!fileExists(proofreadFile)) {
            console.log(`No proofread file found for book ${bookId}`);
            return;
        }
        proofreadResult = JSON.parse(fs.readFileSync(proofreadFile, 'utf-8'));
    }

    if (!fileExists(summaryFilename)) {
        console.log(`No summary file found for book ${bookId}`);
        return;
    }

    // Check if there's a revised summary to apply
    if (!proofreadResult.revisedSummary || proofreadResult.revisedSummary.trim() === '') {
        console.log(`No revisions needed for book ${bookId}`);
        return;
    }

    // Write the revised summary
    fs.writeFileSync(summaryFilename, proofreadResult.revisedSummary);
    const bookName = getBookName(bookId, language);
    console.log(`Applied revisions to ${bookName}`);
}

function printUsage() {
    console.log(`
Usage: node book_summary.mjs [options]

Options:
  --language <lang>  Language for summaries (default: nb)
                     Accepts codes (nb, nn, en, de, es, fr, sv, da) or full names
  --proofread        Run proofreading after generation
  --apply            Apply proofread suggestions (requires prior --proofread run)
  --ot               Process only Old Testament (books 1-39)
  --nt               Process only New Testament (books 40-66)
  --book <range>     Process book(s): single (43) or range (1-20)
  --force            Force re-generation even if file exists
  --help             Show this help message

Output structure:
  book_summaries/<lang>/<book>.md
  e.g., book_summaries/nb/43.md

Examples:
  node book_summary.mjs --nt                              # Generate NT book summaries (Norwegian bokmål)
  node book_summary.mjs --language nn --ot                # Generate OT summaries (Norwegian nynorsk)
  node book_summary.mjs --language en --book 43           # Generate John summary (English)
  node book_summary.mjs --book 1-5                        # Generate Pentateuch summaries
  node book_summary.mjs --nt --proofread --apply          # Generate → proofread → apply
  node book_summary.mjs --book 1 --force                  # Re-generate Genesis summary

Parallel processing (run in separate terminals):
  node book_summary.mjs --book 1-20 &                     # terminal 1
  node book_summary.mjs --book 21-39 &                    # terminal 2
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

    // Normalize language
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
    console.log('---');

    for (let bookId = startBook; bookId <= endBook; bookId++) {
        const book = books.find(b => b.id === bookId);
        if (!book) continue;

        const filename = getOutputPath(options.language, bookId);

        // Step 1: Generate (skip if file exists unless --force)
        if (!fileExists(filename) || options.force) {
            await generateBookSummary(options.language, bookId, filename);
        } else {
            const bookName = getBookName(bookId, options.language);
            console.log(`Skipping ${bookName} (already exists)`);
        }

        // Step 2: Proofread (if requested)
        let proofreadResult = null;
        if (options.proofread && fileExists(filename)) {
            const saveToFile = !options.apply;
            proofreadResult = await proofreadBookSummary(options.language, bookId, filename, saveToFile);
        }

        // Step 3: Apply (if requested)
        if (options.apply) {
            applyProofreadChanges(options.language, bookId, filename, proofreadResult);
        }
    }

    console.log('Done!');
}

main().catch(console.error);
