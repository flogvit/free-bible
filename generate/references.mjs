import dotenv from 'dotenv'
import * as fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config()

import Anthropic from '@anthropic-ai/sdk';
import {books, anthropicModel, normalizeLanguage, getLanguageCode, getBookName} from "./constants.js";
import {getOriginalVerse, getOriginalChapter, getRef} from "./lib.js";

const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
});

const MAX_RETRIES = 3;

function getReferencePrompt(language, bookId, chapterId, verseId, originalText) {
    const bookName = getBookName(bookId, language);
    const ref = `${bookName} ${chapterId}:${verseId}`;
    const langCode = getLanguageCode(language);
    const originalLanguage = bookId <= 39 ? 'hebraisk' : 'gresk';
    const originalLanguageEn = bookId <= 39 ? 'Hebrew' : 'Greek';

    if (langCode === 'nb') {
        return `Skriv kryssreferanser for ${ref} på norsk bokmål.
GT-referanser er fra tanach, og NT er fra SBLGNT.

Den ${originalLanguage}e originalteksten for verset er:
${originalText}

Svar kun med JSON. Hvis du ikke finner kryssreferanser, bruk tom array.
[{
    "bookId": <bookId som tall>,
    "chapterId": <chapterId som tall>,
    "fromVerseId": <verseId som tall>,
    "toVerseId": <verseId som tall>,
    "text": <Forklar hvorfor dette er en kryssreferanse, men ikke start med "Dette er en kryssreferanse fordi">
},
...
]`;
    } else if (langCode === 'nn') {
        return `Skriv kryssreferansar for ${ref} på norsk nynorsk.
GT-referansar er frå tanach, og NT er frå SBLGNT.

Den ${originalLanguage}e originalteksten for verset er:
${originalText}

Svar berre med JSON. Dersom du ikkje finn kryssreferansar, bruk tom array.
[{
    "bookId": <bookId som tal>,
    "chapterId": <chapterId som tal>,
    "fromVerseId": <verseId som tal>,
    "toVerseId": <verseId som tal>,
    "text": <Forklar kvifor dette er ein kryssreferanse, men ikkje start med "Dette er ein kryssreferanse fordi">
},
...
]`;
    } else {
        return `Write cross-references for ${ref} in ${language}.
OT references are from tanach, and NT is from SBLGNT.

The original ${originalLanguageEn} text for the verse is:
${originalText}

Respond with JSON only. If you find no cross-references, use an empty array.
[{
    "bookId": <bookId as number>,
    "chapterId": <chapterId as number>,
    "fromVerseId": <verseId as number>,
    "toVerseId": <verseId as number>,
    "text": <Explain why this is a cross-reference, but do not start with "This is a cross-reference because">
},
...
]`;
    }
}

function getProofreadPrompt(language, bookId, chapterId, verseId, originalText, currentReferences) {
    const bookName = getBookName(bookId, language);
    const ref = `${bookName} ${chapterId}:${verseId}`;
    const langCode = getLanguageCode(language);
    const originalLanguage = bookId <= 39 ? 'hebraisk' : 'gresk';
    const originalLanguageEn = bookId <= 39 ? 'Hebrew' : 'Greek';

    const refsJson = JSON.stringify(currentReferences, null, 2);

    let basePrompt;
    let taskDescription;

    if (langCode === 'nb') {
        basePrompt = `Du er en korrekturleser for bibelske kryssreferanser. Gå gjennom følgende kryssreferanser for ${ref}.
Du får den ${originalLanguage}e originalteksten for å verifisere nøyaktigheten.`;
        taskDescription = `Din oppgave er å verifisere kryssreferansene og identifisere:
- Feil bookId, chapterId, fromVerseId eller toVerseId (sjekk at de refererte versene faktisk finnes)
- Kryssreferanser som ikke er relevante eller har svak kobling til kildeverset
- Viktige kryssreferanser som mangler
- Unøyaktige eller misvisende forklaringstekster
- Selvhenvisninger (referanser tilbake til kildeverset selv)`;
    } else if (langCode === 'nn') {
        basePrompt = `Du er ein korrekturlesar for bibelske kryssreferansar. Gå gjennom følgjande kryssreferansar for ${ref}.
Du får den ${originalLanguage}e originalteksten for å verifisere nøyaktigheita.`;
        taskDescription = `Di oppgåve er å verifisere kryssreferansane og identifisere:
- Feil bookId, chapterId, fromVerseId eller toVerseId (sjekk at dei refererte versa faktisk finst)
- Kryssreferansar som ikkje er relevante eller har svak kopling til kjeldeverset
- Viktige kryssreferansar som manglar
- Unøyaktige eller misvisande forklaringstekstar
- Sjølvhenvisingar (referansar tilbake til kjeldeverset sjølv)`;
    } else {
        basePrompt = `You are a proofreader for biblical cross-references. Review the following cross-references for ${ref}.
You are given the original ${originalLanguageEn} text to verify accuracy.`;
        taskDescription = `Your task is to verify the cross-references and identify:
- Incorrect bookId, chapterId, fromVerseId or toVerseId (check that referenced verses actually exist)
- Cross-references that are not relevant or have weak connection to the source verse
- Important cross-references that are missing
- Inaccurate or misleading explanation texts
- Self-references (references back to the source verse itself)`;
    }

    return `${basePrompt}

${taskDescription}

Return your response as JSON only, in this format:
{
    "issues": [
        {
            "type": "error|missing|irrelevant|text|self-reference",
            "severity": "critical|major|minor",
            "reference": "bookId:chapterId:fromVerseId-toVerseId (if applicable)",
            "explanation": "why this is an issue"
        }
    ],
    "summary": "Overall assessment of the cross-references quality",
    "score": 1-10,
    "revisedReferences": [if there are issues, provide the complete revised references array here, otherwise empty array]
}

IMPORTANT:
- If the current references are good, return an empty issues array and empty revisedReferences array
- The revisedReferences must use the same format: [{bookId, chapterId, fromVerseId, toVerseId, text}]
- bookId values: OT books 1-39, NT books 40-66
- Focus on accuracy: are these real, meaningful cross-references?

Original text:
${originalText}

Current cross-references:
${refsJson}`;
}

async function doAnthropicCall(content) {
    return anthropic.messages.create({
        model: anthropicModel,
        max_tokens: 8192,
        system: "You are a JSON-only assistant. You MUST respond with valid JSON only. Never include explanations, comments, or any text outside the JSON structure. Follow the exact field names specified in the prompt.",
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

    // Try to find array (for generation) or object (for proofread)
    const objectMatch = cleaned.match(/\{[\s\S]*}/);
    const arrayMatch = cleaned.match(/\[[\s\S]*]/);

    // Prefer object match for proofread responses, array for generation
    if (objectMatch && cleaned.trimStart().startsWith('{')) {
        cleaned = objectMatch[0];
    } else if (arrayMatch && cleaned.trimStart().startsWith('[')) {
        cleaned = arrayMatch[0];
    } else if (objectMatch) {
        cleaned = objectMatch[0];
    } else if (arrayMatch) {
        cleaned = arrayMatch[0];
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

function getOutputPath(language, bookId, chapterId, verseId) {
    const langCode = getLanguageCode(language);
    return path.join(__dirname, `references/${langCode}/${bookId}/${chapterId}/${verseId}.json`);
}

function getProofreadPath(language, bookId, chapterId, verseId) {
    const langCode = getLanguageCode(language);
    return path.join(__dirname, `proofread_references/${langCode}/${bookId}/${chapterId}/${verseId}.json`);
}

function fileExists(filepath) {
    return fs.existsSync(filepath) && fs.statSync(filepath).size > 0;
}

function ensureDir(filepath) {
    const dir = path.dirname(filepath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, {recursive: true});
    }
}

function normalizeReferences(refs) {
    return refs.map(ref => {
        // Fix common issue: verseId instead of fromVerseId
        if (ref.verseId !== undefined && ref.fromVerseId === undefined) {
            ref.fromVerseId = ref.verseId;
            delete ref.verseId;
        }
        // Ensure toVerseId defaults to fromVerseId
        if (ref.toVerseId === undefined && ref.fromVerseId !== undefined) {
            ref.toVerseId = ref.fromVerseId;
        }
        return ref;
    });
}

async function generateReferences(language, bookId, chapterId, verseId, filename) {
    const bookName = getBookName(bookId, language);
    const verseOrg = getOriginalVerse(bookId, chapterId, verseId);
    if (!verseOrg) {
        console.log(`Skipping ${bookName} ${chapterId}:${verseId} (no original text found)`);
        return;
    }

    const prompt = getReferencePrompt(language, bookId, chapterId, verseId, verseOrg.text);

    console.log(`Generating references for ${bookName} ${chapterId}:${verseId}...`);
    const responseText = await doAnthropicCallWithRetry(prompt, `${bookId}:${chapterId}:${verseId}`);
    let result = parseJsonResponse(responseText);

    result = normalizeReferences(result);

    const verse = {
        bookId,
        chapterId,
        verseId,
        references: result
    };

    ensureDir(filename);
    fs.writeFileSync(filename, JSON.stringify(verse, null, 2));
    console.log(`  Saved: ${filename} (${result.length} references)`);
}

async function proofreadReferences(language, bookId, chapterId, verseId, refFilename, saveToFile = true) {
    if (!fileExists(refFilename)) {
        console.log(`No reference file found for ${bookId}:${chapterId}:${verseId}`);
        return null;
    }

    const bookName = getBookName(bookId, language);
    const verseOrg = getOriginalVerse(bookId, chapterId, verseId);
    if (!verseOrg) {
        console.log(`Skipping proofread for ${bookName} ${chapterId}:${verseId} (no original text found)`);
        return null;
    }

    const currentData = JSON.parse(fs.readFileSync(refFilename, 'utf-8'));
    const currentReferences = currentData.references || [];

    if (currentReferences.length === 0) {
        console.log(`Skipping proofread for ${bookName} ${chapterId}:${verseId} (no references to proofread)`);
        return null;
    }

    console.log(`Proofreading references for ${bookName} ${chapterId}:${verseId}...`);

    const prompt = getProofreadPrompt(language, bookId, chapterId, verseId, verseOrg.text, currentReferences);
    const responseText = await doAnthropicCallWithRetry(prompt, `proofread ${bookId}:${chapterId}:${verseId}`);
    const result = parseJsonResponse(responseText);

    // Save proofread results if requested
    if (saveToFile) {
        const proofreadFile = getProofreadPath(language, bookId, chapterId, verseId);
        ensureDir(proofreadFile);
        fs.writeFileSync(proofreadFile, JSON.stringify(result, null, 2));
    }

    // Print summary
    if (result.score !== null && result.score !== undefined) {
        process.stdout.write(`  Score: ${result.score}/10`);
    }
    if (result.issues && result.issues.length > 0) {
        console.log(` | Issues: ${result.issues.length}`);
        result.issues.forEach((issue, i) => {
            console.log(`    ${i + 1}. [${issue.severity}] ${issue.type}: ${issue.explanation}`);
        });
    } else {
        console.log(' | No issues');
    }

    return result;
}

function applyProofreadChanges(language, bookId, chapterId, verseId, refFilename, proofreadResult = null) {
    // Load proofread result from file if not provided
    if (!proofreadResult) {
        const proofreadFile = getProofreadPath(language, bookId, chapterId, verseId);
        if (!fileExists(proofreadFile)) {
            console.log(`No proofread file found for ${bookId}:${chapterId}:${verseId}`);
            return;
        }
        proofreadResult = JSON.parse(fs.readFileSync(proofreadFile, 'utf-8'));
    }

    if (!fileExists(refFilename)) {
        console.log(`No reference file found for ${bookId}:${chapterId}:${verseId}`);
        return;
    }

    // Check if there are revised references to apply
    if (!proofreadResult.revisedReferences || proofreadResult.revisedReferences.length === 0) {
        return;
    }

    const currentData = JSON.parse(fs.readFileSync(refFilename, 'utf-8'));
    const revisedRefs = normalizeReferences(proofreadResult.revisedReferences);
    currentData.references = revisedRefs;

    fs.writeFileSync(refFilename, JSON.stringify(currentData, null, 2));
    const bookName = getBookName(bookId, language);
    console.log(`  Applied revisions to ${bookName} ${chapterId}:${verseId} (${revisedRefs.length} references)`);
}

function printUsage() {
    console.log(`
Usage: node references.mjs [options]

Options:
  --language <lang>  Language for reference texts (default: nb)
                     Accepts codes (nb, nn, en, de, es, fr, sv, da) or full names
  --proofread        Run proofreading after generation
  --apply            Apply proofread suggestions (requires prior --proofread run)
  --ot               Process only Old Testament (books 1-39)
  --nt               Process only New Testament (books 40-66)
  --book <range>     Process book(s): single (43) or range (1-20)
  --chapter <range>  Process chapter(s): single (1) or range (1-10)
  --verse <range>    Process verse(s): single (1) or range (1-10)
  --force            Force re-generation even if file exists
  --help             Show this help message

Output structure:
  references/<lang>/<book>/<chapter>/<verse>.json
  e.g., references/nb/43/1/1.json

Examples:
  node references.mjs --nt                                    # Generate NT references (Norwegian bokmål)
  node references.mjs --language nn --ot                      # Generate OT references (Norwegian nynorsk)
  node references.mjs --language en --book 43                 # Generate John references (English)
  node references.mjs --book 43 --chapter 1 --verse 1-14     # Generate John 1:1-14 references
  node references.mjs --nt --proofread --apply                # Generate → proofread → apply
  node references.mjs --book 40 --chapter 1 --force           # Re-generate Matt 1 references

Parallel processing (run in separate terminals):
  node references.mjs --book 1-20 &                           # terminal 1
  node references.mjs --book 21-39 &                          # terminal 2
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
        verseStart: null,
        verseEnd: null,
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
        } else if (arg === '--verse' && i + 1 < args.length) {
            const range = parseRange(args[++i]);
            options.verseStart = range.start;
            options.verseEnd = range.end;
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
    if (options.verseStart !== null) {
        console.log(`Verses: ${options.verseStart}-${options.verseEnd}`);
    }
    console.log('---');

    for (let bookId = startBook; bookId <= endBook; bookId++) {
        const book = books.find(b => b.id === bookId);
        if (!book) continue;

        const maxChapters = book.chapters;
        const startChapter = options.chapterStart || 1;
        const endChapter = Math.min(options.chapterEnd || maxChapters, maxChapters);

        for (let chapterId = startChapter; chapterId <= endChapter; chapterId++) {
            const verses = getOriginalChapter(bookId, chapterId);
            if (!verses || verses.length === 0) continue;

            const startVerse = options.verseStart || 1;
            const endVerse = options.verseEnd || verses[verses.length - 1].verseId;

            for (const verse of verses) {
                const verseId = verse.verseId;
                if (verseId < startVerse || verseId > endVerse) continue;

                const filename = getOutputPath(options.language, bookId, chapterId, verseId);

                // Step 1: Generate (skip if file exists unless --force)
                if (!fileExists(filename) || options.force) {
                    await generateReferences(options.language, bookId, chapterId, verseId, filename);
                } else {
                    const bookName = getBookName(bookId, options.language);
                    console.log(`Skipping ${bookName} ${chapterId}:${verseId} (already exists)`);
                }

                // Step 2: Proofread (if requested)
                let proofreadResult = null;
                if (options.proofread && fileExists(filename)) {
                    const saveToFile = !options.apply;
                    proofreadResult = await proofreadReferences(options.language, bookId, chapterId, verseId, filename, saveToFile);
                }

                // Step 3: Apply (if requested)
                if (options.apply) {
                    applyProofreadChanges(options.language, bookId, chapterId, verseId, filename, proofreadResult);
                }
            }
        }
    }

    console.log('Done!');
}

main().catch(console.error);
