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

// Get book context generation prompt
function getContextPrompt(language, bookId) {
    const bookName = getBookName(bookId, language);
    const book = books.find(b => b.id === bookId);
    const chapterCount = book.chapters;
    const langCode = getLanguageCode(language);

    const structureNb = `Skriv historisk og kulturell kontekst for hele ${bookName} (${chapterCount} kapitler) på norsk, bokmål.

VIKTIG: Dette er bok-nivå kontekst som gjelder for hele boken. Kapittel-spesifikk kontekst skrives separat. Fokuser på informasjon som er relevant for å forstå boken som helhet.

Bruk følgende struktur:

## Historisk ramme
Beskriv i 2-3 avsnitt:
- Bokens datering og forfatterskap (inkludert kildeteorier der relevant)
- Den historiske perioden boken beskriver vs. når den ble skrevet
- Politisk og religiøs situasjon i perioden

## Litterær kontekst
Beskriv i 1-2 avsnitt:
- Bokens sjanger og litterære stil
- Bokens plass i Bibelen og kanon
- Hvordan boken er strukturert

## Kulturell bakgrunn
Beskriv i 2-3 avsnitt:
- Samfunnsstruktur og dagligliv i perioden
- Religiøs praksis og verdensbilde
- Forholdet til omkringliggende kulturer og religioner

## Arkeologi og historiske kilder
List 3-5 viktige arkeologiske funn eller historiske kilder som belyser bokens periode eller innhold. For hvert funn, gi:
- Navn og datering
- Hvor det ble funnet
- Hvordan det belyser boken`;

    const structureNn = `Skriv historisk og kulturell kontekst for heile ${bookName} (${chapterCount} kapittel) på norsk, nynorsk.

VIKTIG: Dette er bok-nivå kontekst som gjeld for heile boka. Kapittel-spesifikk kontekst blir skrive separat. Fokuser på informasjon som er relevant for å forstå boka som heilskap.

Bruk følgjande struktur:

## Historisk ramme
Beskriv i 2-3 avsnitt:
- Boka si datering og forfattarskap (inkludert kjeldeteoriar der relevant)
- Den historiske perioden boka skildrar vs. når ho vart skriven
- Politisk og religiøs situasjon i perioden

## Litterær kontekst
Beskriv i 1-2 avsnitt:
- Boka sin sjanger og litterære stil
- Boka sin plass i Bibelen og kanon
- Korleis boka er strukturert

## Kulturell bakgrunn
Beskriv i 2-3 avsnitt:
- Samfunnsstruktur og daglegliv i perioden
- Religiøs praksis og verdsbilde
- Forholdet til omkringliggjande kulturar og religionar

## Arkeologi og historiske kjelder
List 3-5 viktige arkeologiske funn eller historiske kjelder som kastar lys over boka sin periode eller innhald. For kvart funn, gi:
- Namn og datering
- Kvar det vart funne
- Korleis det kastar lys over boka`;

    const structureEn = `Write historical and cultural context for the entire book of ${bookName} (${chapterCount} chapters) in English.

IMPORTANT: This is book-level context that applies to the entire book. Chapter-specific context is written separately. Focus on information relevant to understanding the book as a whole.

Use the following structure:

## Historical Framework
Describe in 2-3 paragraphs:
- The book's dating and authorship (including source theories where relevant)
- The historical period the book describes vs. when it was written
- Political and religious situation in the period

## Literary Context
Describe in 1-2 paragraphs:
- The book's genre and literary style
- The book's place in the Bible and canon
- How the book is structured

## Cultural Background
Describe in 2-3 paragraphs:
- Social structure and daily life in the period
- Religious practice and worldview
- Relationship to surrounding cultures and religions

## Archaeology and Historical Sources
List 3-5 important archaeological finds or historical sources that illuminate the book's period or content. For each find, provide:
- Name and dating
- Where it was found
- How it illuminates the book`;

    if (langCode === 'nb') {
        return structureNb;
    } else if (langCode === 'nn') {
        return structureNn;
    } else {
        return structureEn;
    }
}

// Proofread prompt for book context
function getProofreadPrompt(language, bookId, currentContext) {
    const bookName = getBookName(bookId, language);
    const langCode = getLanguageCode(language);

    let basePrompt;
    let structureReminder;

    if (langCode === 'nb') {
        basePrompt = `Du er en korrekturleser for bibelkontekst. Gå gjennom følgende bok-kontekst for ${bookName}.`;
        structureReminder = `VIKTIG: Konteksten MÅ beholde følgende struktur:
- ## Historisk ramme (2-3 avsnitt)
- ## Litterær kontekst (1-2 avsnitt)
- ## Kulturell bakgrunn (2-3 avsnitt)
- ## Arkeologi og historiske kilder (3-5 funn med detaljer)

Hvis konteksten mangler strukturen eller har faktafeil, må revisedContext korrigere dette.`;
    } else if (langCode === 'nn') {
        basePrompt = `Du er ein korrekturlesar for bibelkontekst. Gå gjennom følgjande bok-kontekst for ${bookName}.`;
        structureReminder = `VIKTIG: Konteksten MÅ behalde følgjande struktur:
- ## Historisk ramme (2-3 avsnitt)
- ## Litterær kontekst (1-2 avsnitt)
- ## Kulturell bakgrunn (2-3 avsnitt)
- ## Arkeologi og historiske kjelder (3-5 funn med detaljar)

Dersom konteksten manglar strukturen eller har faktafeil, må revisedContext korrigere dette.`;
    } else {
        basePrompt = `You are a proofreader for Bible context. Review the following book-level context for ${bookName}.`;
        structureReminder = `IMPORTANT: The context MUST maintain this structure:
- ## Historical Framework (2-3 paragraphs)
- ## Literary Context (1-2 paragraphs)
- ## Cultural Background (2-3 paragraphs)
- ## Archaeology and Historical Sources (3-5 finds with details)

If the context lacks the structure or has factual errors, revisedContext must correct this.`;
    }

    return `${basePrompt}

Your task is to review the context and identify:
- Factual errors or inaccuracies (dates, names, archaeological claims)
- Missing important information that should be included at book level
- Information that is too chapter-specific and should be moved to chapter context
- Awkward phrasing that could be improved
- Grammar or spelling errors
- Missing or incorrect structure

${structureReminder}

Return your response as JSON only, in this format:
{
    "issues": [
        {
            "type": "error|suggestion|factual|grammar|structure|scope",
            "severity": "critical|major|minor",
            "current": "the problematic text or section",
            "suggested": "the corrected or improved text",
            "explanation": "why this change is recommended"
        }
    ],
    "summary": "Overall assessment of the context quality",
    "score": 1-10,
    "revisedContext": "If there are issues, provide the complete revised context here. If no issues, leave empty."
}

IMPORTANT:
- If the current context is good and has no issues, return an empty issues array and no revisedContext
- The revisedContext MUST use the required structure
- Focus on accuracy and factual correctness
- Flag any claims that seem dubious or need verification

Current context:
${currentContext}`;
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
    return path.join(__dirname, `book_context/${langCode}/${bookId}.md`);
}

function getProofreadPath(language, bookId) {
    const langCode = getLanguageCode(language);
    return path.join(__dirname, `proofread_book_context/${langCode}/${bookId}.json`);
}

function fileExists(filepath) {
    return fs.existsSync(filepath) && fs.statSync(filepath).size > 0;
}

async function generateBookContext(language, bookId, filename) {
    const bookName = getBookName(bookId, language);
    const prompt = getContextPrompt(language, bookId);

    console.log(`Generating context for ${bookName}...`);
    const text = await doAnthropicCallWithRetry(prompt, `book ${bookId}`);

    const dir = path.dirname(filename);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, {recursive: true});
    }

    fs.writeFileSync(filename, text);
    console.log(`Saved: ${filename}`);
}

async function proofreadBookContext(language, bookId, contextFilename, saveToFile = true) {
    if (!fileExists(contextFilename)) {
        console.log(`No context file found for book ${bookId}`);
        return null;
    }

    const bookName = getBookName(bookId, language);
    const currentContext = fs.readFileSync(contextFilename, 'utf-8');

    console.log(`Proofreading context for ${bookName}...`);

    const prompt = getProofreadPrompt(language, bookId, currentContext);
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

function applyProofreadChanges(language, bookId, contextFilename, proofreadResult = null) {
    // Load proofread result from file if not provided
    if (!proofreadResult) {
        const proofreadFile = getProofreadPath(language, bookId);
        if (!fileExists(proofreadFile)) {
            console.log(`No proofread file found for book ${bookId}`);
            return;
        }
        proofreadResult = JSON.parse(fs.readFileSync(proofreadFile, 'utf-8'));
    }

    if (!fileExists(contextFilename)) {
        console.log(`No context file found for book ${bookId}`);
        return;
    }

    // Check if there's a revised context to apply
    if (!proofreadResult.revisedContext || proofreadResult.revisedContext.trim() === '') {
        console.log(`No revisions needed for book ${bookId}`);
        return;
    }

    // Write the revised context
    fs.writeFileSync(contextFilename, proofreadResult.revisedContext);
    const bookName = getBookName(bookId, language);
    console.log(`Applied revisions to ${bookName}`);
}

function printUsage() {
    console.log(`
Usage: node book_context.mjs [options]

Generates book-level historical and cultural context for Bible books.
This context applies to the entire book. Chapter-specific context is
generated separately using chapter_context.mjs.

Options:
  --language <lang>  Language for context (default: nb)
                     Accepts codes (nb, nn, en, de, es, fr, sv, da) or full names
  --proofread        Run proofreading after generation
  --apply            Apply proofread suggestions (requires prior --proofread run)
  --ot               Process only Old Testament (books 1-39)
  --nt               Process only New Testament (books 40-66)
  --book <range>     Process book(s): single (43) or range (1-20)
  --force            Force re-generation even if file exists
  --help             Show this help message

Output structure:
  book_context/<lang>/<book>.md
  e.g., book_context/nb/1.md (Genesis)

Examples:
  node book_context.mjs --nt                              # Generate NT book context (Norwegian bokmål)
  node book_context.mjs --language nn --ot                # Generate OT context (Norwegian nynorsk)
  node book_context.mjs --language en --book 43           # Generate John context (English)
  node book_context.mjs --book 1-5                        # Generate Pentateuch context
  node book_context.mjs --nt --proofread --apply          # Generate → proofread → apply
  node book_context.mjs --book 1 --force                  # Re-generate Genesis context

Parallel processing (run in separate terminals):
  node book_context.mjs --book 1-20 &                     # terminal 1
  node book_context.mjs --book 21-39 &                    # terminal 2
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
            await generateBookContext(options.language, bookId, filename);
        } else {
            const bookName = getBookName(bookId, options.language);
            console.log(`Skipping ${bookName} (already exists)`);
        }

        // Step 2: Proofread (if requested)
        let proofreadResult = null;
        if (options.proofread && fileExists(filename)) {
            const saveToFile = !options.apply;
            proofreadResult = await proofreadBookContext(options.language, bookId, filename, saveToFile);
        }

        // Step 3: Apply (if requested)
        if (options.apply) {
            applyProofreadChanges(options.language, bookId, filename, proofreadResult);
        }
    }

    console.log('Done!');
}

main().catch(console.error);
