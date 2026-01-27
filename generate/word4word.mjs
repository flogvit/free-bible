import dotenv from 'dotenv'
import * as fs from 'fs';
import path from 'path';

dotenv.config()

import Anthropic from '@anthropic-ai/sdk';
import {bibles, books, anthropicModel, normalizeLanguage, getLanguageCode} from "./constants.js";

const anthropic = new Anthropic();

const MAX_RETRIES = 3;

// Original sources (not translations)
const ORIGINAL_SOURCES = ['tanach', 'sblgnt'];

// Check if bible is an original source (not a translation)
function isOriginalSource(bible) {
    return ORIGINAL_SOURCES.includes(bible);
}

// Get original language based on book ID
function getOriginalLanguage(bookId) {
    return bookId <= 39 ? 'Hebrew' : 'Greek';
}

function getOriginalSource(bookId) {
    return bookId <= 39 ? 'tanach' : 'sblgnt';
}

// Word explanation prompt for ORIGINAL language texts (tanach/sblgnt)
function getOriginalWordExplanationPrompt(explanationLanguage, originalLanguage, bookId, chapterId, verseId, originalText) {
    return `You will be given a verse in the original ${originalLanguage} language.
You should explain every word in the text. Your response must be in JSON format, and only JSON.
Do not include punctuation marks as separate words, but include particles and prefixes that carry meaning.

IMPORTANT GUIDELINES FOR EXPLANATIONS:
- Write natural, varied explanations in ${explanationLanguage}
- DO NOT start every explanation with "Det ${originalLanguage.toLowerCase()}e ordet..." - vary your sentence structure
- Focus on the meaning and significance of the word in context
- Include interesting facts: etymology, historical context, wordplay, grammatical forms
- For names: explain the meaning of the name and any significant symbolism
- For verbs: explain the action, tense, and nuances
- For nouns: explain the concept and its biblical/cultural significance
- For particles/prepositions/conjunctions: explain their grammatical function
- Include pronunciation guide where helpful
- Keep explanations concise but informative (1-3 sentences)
- Use different opening phrases like: "Betyr...", "Refererer til...", "Navnet på...", "Et verb som...", "Brukes her for å...", "Uttales...", etc.

JSON format:
[
    {
        "bookId": ${bookId},
        "chapterId": ${chapterId},
        "verseId": ${verseId},
        "words": [
            {
                "word": "<${originalLanguage} word>",
                "pronunciation": "<pronunciation guide>",
                "wordId": <position in verse>,
                "explanation": "<varied, natural explanation in ${explanationLanguage}>"
            }
        ]
    }
]

${originalLanguage} text:
${originalText}`;
}

// Word explanation prompt for TRANSLATED texts (osnb1, osnb2, etc)
function getTranslationWordExplanationPrompt(language, originalLanguage, bookId, chapterId, verseId, originalText, translatedText) {
    return `You will be given a verse in the original ${originalLanguage} language and a translation.
You should explain every word in the translated text. Your response must be in JSON format, and only JSON.
Do not include punctuation, commas etc as words.

IMPORTANT GUIDELINES FOR EXPLANATIONS:
- Write natural, varied ${language} explanations
- DO NOT start every explanation with "Det ${originalLanguage.toLowerCase()}e ordet..." - vary your sentence structure
- Focus on the meaning and significance of the word in context
- Include interesting facts the reader might not know (etymology, historical context, ${originalLanguage} wordplay)
- For names: explain the meaning of the name and any significant symbolism
- For verbs: explain the action and its nuances in ${originalLanguage}
- For nouns: explain the concept and its biblical/cultural significance
- For prepositions/conjunctions: briefly explain their function
- Keep explanations concise but informative (1-2 sentences)
- Use different opening phrases like: "Betyr...", "Refererer til...", "Navnet på...", "Et verb som...", "Brukes her for å...", etc.

JSON format:
[
    {
        "bookId": ${bookId},
        "chapterId": ${chapterId},
        "verseId": ${verseId},
        "words": [
            {
                "word": "<translated word>",
                "wordId": <position in verse>,
                "original": "<original ${originalLanguage} word(s)>",
                "explanation": "<varied, natural explanation>"
            }
        ]
    }
]

Original ${originalLanguage} text:
${originalText}

Translation:
${translatedText}`;
}

// Proofread prompt for word explanations
function getProofreadPrompt(language, originalLanguage, bookId, chapterId, verseId, originalText, wordData, isOriginalSource = false) {
    const formattedWords = wordData.words.map(w => {
        let entry;
        if (isOriginalSource) {
            // Original source mode: word is the original language word
            entry = `${w.wordId}. "${w.word}" (pronunciation: ${w.pronunciation || 'N/A'}): ${w.explanation}`;
        } else {
            // Translation mode: word is translated, original is the source
            entry = `${w.wordId}. "${w.word}" (original: ${w.original || 'N/A'}): ${w.explanation}`;
        }
        if (w.versions && w.versions.length > 0) {
            entry += `\n      VERSION HISTORY (${w.versions.length} previous revisions - DO NOT suggest any of these):`;
            w.versions.forEach((ver, i) => {
                const typeInfo = ver.type ? ` [${ver.type}/${ver.severity || 'unknown'}]` : '';
                entry += `\n      ${i + 1}.${typeInfo} "${ver.explanation}"`;
            });
        }
        return entry;
    }).join('\n');

    const modeDescription = isOriginalSource
        ? `Word-by-word explanations of ${originalLanguage} words, written in ${language}`
        : `Word-by-word explanations of translated words (with ${originalLanguage} originals), written in ${language}`;

    return `You are a Bible word explanation proofreader. You will receive:
1. The original biblical text (${originalLanguage})
2. ${modeDescription}

Your task is to review the explanations and identify:
- Incorrect explanations or inaccuracies about the ${isOriginalSource ? '' : 'original '}word
${isOriginalSource ? '- Missing or wrong pronunciation guides (marked as N/A means missing - please add!)' : '- Wrong original word mappings'}
- Awkward phrasing that could be improved
- Missing important context or etymology
- Grammar or spelling errors in the explanation
- Explanations that are too repetitive in structure
${isOriginalSource ? '- IMPORTANT: If pronunciation is "N/A", always provide the correct pronunciation!' : ''}

Return your response as JSON only, in this format:
{
    "issues": [
        {
            "wordId": 1,
            "type": "error|suggestion|theological|grammar",
            "severity": "critical|major|minor",
            "currentExplanation": "the current explanation",
            "suggestedExplanation": "the improved explanation",
${isOriginalSource
    ? `            "currentPronunciation": "current pronunciation (if changing)",
            "suggestedPronunciation": "corrected pronunciation (if changing)",`
    : `            "currentOriginal": "current original word (if changing)",
            "suggestedOriginal": "corrected original word (if changing)",`}
            "reason": "why this change is recommended"
        }
    ],
    "summary": "Overall assessment of the explanations quality",
    "score": 1-10
}

IMPORTANT:
- Some words have VERSION HISTORY showing previous revisions. Read the history carefully.
- NEVER suggest text that matches or is similar to ANY previous version in the history.
- NEVER undo a change that was intentionally made (check the reason).
- If a word has 3+ revisions, it has been extensively reviewed - only suggest changes for CRITICAL errors.
- If the current explanation is acceptable, SKIP that word entirely - do not include it in issues.

If there are no issues, return: {"issues": [], "summary": "All explanations are accurate and well-written", "score": 10}

Book ID: ${bookId}, Chapter: ${chapterId}, Verse: ${verseId}

${originalLanguage} text:
${originalText}

Current word explanations:
${formattedWords}`;
}

async function doAnthropicCall(content, useSystemPrompt = false) {
    const options = {
        model: anthropicModel,
        max_tokens: 8192,
        messages: [
            {
                role: "user",
                content
            }
        ]
    };

    if (useSystemPrompt) {
        options.system = "You are a JSON-only assistant. You MUST respond with valid JSON only. Never include explanations, comments, or any text outside the JSON structure.";
    }

    return anthropic.messages.create(options);
}

function parseJsonResponse(text) {
    let cleaned = text
        .replace(/```json\s*/g, '')
        .replace(/```\s*/g, '')
        .trim();

    const arrayMatch = cleaned.match(/\[[\s\S]*]/);
    if (arrayMatch) {
        cleaned = arrayMatch[0];
    }

    const objectMatch = cleaned.match(/\{[\s\S]*}/);
    if (!arrayMatch && objectMatch) {
        cleaned = objectMatch[0];
    }

    try {
        return JSON.parse(cleaned);
    } catch (e) {
        // Continue to repair attempts
    }

    // Repair attempt: fix unescaped quotes
    let repaired = cleaned.replace(/"([^"]*?)": "([^"]*?)"/g, (match, key, value) => {
        const fixedValue = value.replace(/(?<!\\)"/g, '\\"');
        return `"${key}": "${fixedValue}"`;
    });

    try {
        return JSON.parse(repaired);
    } catch (e) {
        // Continue
    }

    // Repair attempt: handle unicode quotes
    repaired = cleaned
        .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"')
        .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'");

    try {
        return JSON.parse(repaired);
    } catch (e) {
        // Continue
    }

    // Repair attempt: character-by-character repair
    repaired = repairJsonStrings(cleaned);

    try {
        return JSON.parse(repaired);
    } catch (e) {
        throw new Error(`JSON parse failed. Original text (first 500 chars): ${cleaned.substring(0, 500)}`);
    }
}

function repairJsonStrings(json) {
    let result = '';
    let inString = false;
    let i = 0;

    while (i < json.length) {
        const char = json[i];
        const nextChar = json[i + 1];

        if (!inString) {
            if (char === '"') {
                inString = true;
            }
            result += char;
        } else {
            if (char === '\\') {
                result += char;
                if (nextChar) {
                    result += nextChar;
                    i++;
                }
            } else if (char === '"') {
                const afterQuote = json.substring(i + 1).trimStart();
                if (afterQuote.startsWith(',') ||
                    afterQuote.startsWith('}') ||
                    afterQuote.startsWith(']') ||
                    afterQuote.startsWith(':') ||
                    afterQuote.startsWith('"')) {
                    inString = false;
                    result += char;
                } else {
                    result += '\\"';
                }
            } else if (char === '\n') {
                result += '\\n';
            } else if (char === '\r') {
                result += '\\r';
            } else if (char === '\t') {
                result += '\\t';
            } else {
                result += char;
            }
        }
        i++;
    }

    return result;
}

// Detect hallucinated English words that shouldn't appear in Norwegian/other translations
// Check if language is English (hallucination detection should be skipped for English)
function isEnglishLanguage(language) {
    const lower = language.toLowerCase();
    return lower === 'english' || lower === 'en';
}

const HALLUCINATION_PATTERNS = [
    /\bsatisf\w+/i,           // satisfying, satisfactory, satisfaction, etc.
    /\bthe\s+[a-z]+ing\b/i,   // "the [verb]ing" English patterns
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

function validateWordExplanationResult(result) {
    // Check array of verse data
    const verses = Array.isArray(result) ? result : [result];

    for (const verse of verses) {
        // Check word explanations
        if (verse.words) {
            for (const word of verse.words) {
                if (word.explanation) {
                    const hallucinations = detectHallucinations(word.explanation);
                    if (hallucinations.length > 0) {
                        throw new Error(`Hallucinated English in explanation for "${word.word}": "${hallucinations.join('", "')}"`);
                    }
                }
            }
        }
        // Also check issues/suggestions in proofread results
        if (verse.issues) {
            for (const issue of verse.issues) {
                if (issue.suggestedExplanation) {
                    const hallucinations = detectHallucinations(issue.suggestedExplanation);
                    if (hallucinations.length > 0) {
                        throw new Error(`Hallucinated English in suggested explanation: "${hallucinations.join('", "')}"`);
                    }
                }
            }
        }
    }

    return true;
}

async function doAnthropicCallWithRetry(content, context = '', useSystemPrompt = false, validate = true) {
    let lastError;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const completion = await doAnthropicCall(content, useSystemPrompt);
            const responseText = completion.content[0].text;
            const result = parseJsonResponse(responseText);

            // Validate for hallucinations if requested
            if (validate) {
                validateWordExplanationResult(result);
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

function readOriginalVerse(bookId, chapterId, verseId) {
    const source = getOriginalSource(bookId);
    const sourceFile = `bibles_raw/${source}/${bookId}/${chapterId}.json`;

    if (!fs.existsSync(sourceFile)) {
        console.error(`Original source not found: ${sourceFile}`);
        return null;
    }

    const allVerses = JSON.parse(fs.readFileSync(sourceFile, 'utf-8'));
    return allVerses.find(v => +v.verseId === +verseId);
}

function readTranslatedVerse(bible, bookId, chapterId, verseId) {
    const translationFile = `bibles_raw/${bible}/${bookId}/${chapterId}.json`;

    if (!fs.existsSync(translationFile)) {
        return null;
    }

    const allVerses = JSON.parse(fs.readFileSync(translationFile, 'utf-8'));
    return allVerses.find(v => +v.verseId === +verseId);
}

async function generateWordExplanations(bible, bookId, chapterId, verseId, filename, explanationLanguage = 'Norwegian bokmål') {
    const originalLanguage = getOriginalLanguage(bookId);
    const isOriginal = isOriginalSource(bible);

    let content;
    // For validation: use explanationLanguage for originals, bibles[bible] for translations
    const language = isOriginal ? explanationLanguage : bibles[bible];

    if (isOriginal) {
        // Original source mode (tanach/sblgnt) - explain original language words directly
        const verse = readTranslatedVerse(bible, bookId, chapterId, verseId);
        if (!verse) {
            console.log(`Verse not found: ${bible} ${bookId}:${chapterId}:${verseId}`);
            return;
        }

        content = getOriginalWordExplanationPrompt(
            explanationLanguage,
            originalLanguage,
            bookId,
            chapterId,
            verseId,
            verse.text
        );
    } else {
        // Translation mode - explain translated words with reference to original
        const originalVerse = readOriginalVerse(bookId, chapterId, verseId);
        if (!originalVerse) {
            console.log(`Original verse not found: ${bookId}:${chapterId}:${verseId}`);
            return;
        }

        const translatedVerse = readTranslatedVerse(bible, bookId, chapterId, verseId);
        if (!translatedVerse) {
            console.log(`Translated verse not found: ${bible} ${bookId}:${chapterId}:${verseId}`);
            return;
        }

        content = getTranslationWordExplanationPrompt(
            language,
            originalLanguage,
            bookId,
            chapterId,
            verseId,
            originalVerse.text,
            translatedVerse.text
        );
    }

    const shouldValidate = !isEnglishLanguage(language);
    const result = await doAnthropicCallWithRetry(content, `${bookId}:${chapterId}:${verseId}`, true, shouldValidate);

    const dir = path.dirname(filename);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, {recursive: true});
    }

    console.log("Writing", filename);
    fs.writeFileSync(filename, JSON.stringify(result, null, 2));
}

async function proofreadVerse(bible, bookId, chapterId, verseId, filename, saveToFile = true, explanationLanguage = 'Norwegian bokmål') {
    const isOriginal = isOriginalSource(bible);
    const language = isOriginal ? explanationLanguage : bibles[bible];
    const originalLanguage = getOriginalLanguage(bookId);

    if (!fs.existsSync(filename)) {
        console.log(`No word explanation file found for ${bookId}:${chapterId}:${verseId}`);
        return null;
    }

    const wordData = JSON.parse(fs.readFileSync(filename, 'utf-8'));
    // Handle both array format [{ words: [...] }] and single object format { words: [...] }
    const verseData = Array.isArray(wordData) ? wordData[0] : wordData;

    // For original sources, read from the source itself; for translations, read original
    const sourceVerse = isOriginal
        ? readTranslatedVerse(bible, bookId, chapterId, verseId)
        : readOriginalVerse(bookId, chapterId, verseId);

    if (!sourceVerse) {
        console.log(`Source verse not found: ${bookId}:${chapterId}:${verseId}`);
        return null;
    }

    console.log(`Proofreading word explanations for ${bookId}:${chapterId}:${verseId}`);

    const content = getProofreadPrompt(
        language,
        originalLanguage,
        bookId,
        chapterId,
        verseId,
        sourceVerse.text,
        verseData,
        isOriginal
    );

    const shouldValidate = !isEnglishLanguage(language);
    const result = await doAnthropicCallWithRetry(content, `proofread ${bookId}:${chapterId}:${verseId}`, false, shouldValidate);

    // Save proofread results if requested
    if (saveToFile) {
        // For original sources, include language code in path
        const langCode = isOriginal ? getLanguageCode(explanationLanguage) : null;
        const proofreadDir = isOriginal
            ? `proofread_word4word/${bible}/${langCode}/${bookId}/${chapterId}`
            : `proofread_word4word/${bible}/${bookId}/${chapterId}`;
        if (!fs.existsSync(proofreadDir)) {
            fs.mkdirSync(proofreadDir, {recursive: true});
        }
        const proofreadFile = `${proofreadDir}/${verseId}.json`;
        console.log("Writing proofread results to", proofreadFile);
        fs.writeFileSync(proofreadFile, JSON.stringify(result, null, 2));
    }

    // Print summary
    console.log(`\nProofread results for ${bookId}:${chapterId}:${verseId}:`);
    if (result.score !== null && result.score !== undefined) {
        console.log(`Score: ${result.score}/10`);
    }
    console.log(`Summary: ${result.summary}`);
    if (result.issues && result.issues.length > 0) {
        console.log(`Issues found: ${result.issues.length}`);
        result.issues.forEach((issue, i) => {
            console.log(`  ${i + 1}. [${issue.severity}] Word ${issue.wordId}: ${issue.type}`);
            console.log(`     ${issue.reason}`);
        });
    }

    return result;
}

function applyProofreadChanges(bible, bookId, chapterId, verseId, filename, proofreadResult = null, explanationLanguage = 'Norwegian bokmål') {
    const isOriginal = isOriginalSource(bible);

    // Load proofread result from file if not provided
    if (!proofreadResult) {
        // For original sources, include language code in path
        const langCode = isOriginal ? getLanguageCode(explanationLanguage) : null;
        const proofreadFile = isOriginal
            ? `proofread_word4word/${bible}/${langCode}/${bookId}/${chapterId}/${verseId}.json`
            : `proofread_word4word/${bible}/${bookId}/${chapterId}/${verseId}.json`;
        if (!fs.existsSync(proofreadFile)) {
            console.log(`No proofread file found for ${bookId}:${chapterId}:${verseId}`);
            return;
        }
        proofreadResult = JSON.parse(fs.readFileSync(proofreadFile, 'utf-8'));
    }

    if (!fs.existsSync(filename)) {
        console.log(`No word explanation file found for ${bookId}:${chapterId}:${verseId}`);
        return;
    }

    const wordData = JSON.parse(fs.readFileSync(filename, 'utf-8'));
    // Handle both array format and single object format
    const isArray = Array.isArray(wordData);
    const verseData = isArray ? wordData[0] : wordData;

    if (!proofreadResult.issues || proofreadResult.issues.length === 0) {
        return;
    }

    let appliedCount = 0;

    for (const issue of proofreadResult.issues) {
        const word = verseData.words.find(w => +w.wordId === +issue.wordId);
        if (!word) {
            console.log(`  Word ${issue.wordId} not found, skipping`);
            continue;
        }

        // Check what's actually changing
        const explanationChanging = issue.suggestedExplanation && word.explanation !== issue.suggestedExplanation;
        const pronunciationChanging = issue.suggestedPronunciation && word.pronunciation !== issue.suggestedPronunciation;
        const pronunciationAdding = issue.suggestedPronunciation && !word.pronunciation;
        const originalChanging = issue.suggestedOriginal && word.original !== issue.suggestedOriginal;

        // Skip if nothing is changing
        if (!explanationChanging && !pronunciationChanging && !pronunciationAdding && !originalChanging) {
            continue;
        }

        // Only add to version history if explanation is changing (not just adding pronunciation)
        if (explanationChanging) {
            // Initialize versions array if it doesn't exist
            if (!word.versions) {
                word.versions = [];
            }

            // Add current explanation to versions history with type and severity
            const versionEntry = {
                explanation: word.explanation,
                type: issue.type,
                severity: issue.severity,
                reason: issue.reason
            };
            // Include original or pronunciation depending on what exists
            if (word.original !== undefined) {
                versionEntry.original = word.original;
            }
            if (word.pronunciation !== undefined) {
                versionEntry.pronunciation = word.pronunciation;
            }
            word.versions.push(versionEntry);

            // Update the explanation
            word.explanation = issue.suggestedExplanation;
        }

        // Update original word if changed (translation mode)
        if (originalChanging) {
            word.original = issue.suggestedOriginal;
        }

        // Update pronunciation if changed (original source mode)
        if (issue.suggestedPronunciation && issue.suggestedPronunciation !== word.pronunciation) {
            word.pronunciation = issue.suggestedPronunciation;
        }

        appliedCount++;

        // Build description of what changed
        const changes = [];
        if (explanationChanging) changes.push('explanation');
        if (pronunciationAdding) changes.push('added pronunciation');
        else if (pronunciationChanging) changes.push('pronunciation');
        if (originalChanging) changes.push('original');

        console.log(`  Applied: Word ${issue.wordId} "${word.word}" [${issue.type}/${issue.severity}] (${changes.join(', ')})`);
    }

    if (appliedCount > 0) {
        fs.writeFileSync(filename, JSON.stringify(isArray ? [verseData] : verseData, null, 2));
        console.log(`Applied ${appliedCount} changes to ${bookId}:${chapterId}:${verseId}`);
    }
}

function printUsage() {
    console.log(`
Usage: node word4word.mjs <source> [options]

Arguments:
  source             Bible version or original source to work with
                     Translations: osnb1, osnb2, osnn1 (explains translated words)
                     Originals: tanach, sblgnt (explains original Hebrew/Greek words)

Options:
  --language <lang>  Language for explanations (default: nb)
                     Accepts codes (nb, nn, en, de, es, fr, sv, da) or full names
                     Only used for original sources (tanach/sblgnt)
  --proofread        Run proofreading after generation (can combine with generation)
  --apply            Apply proofread suggestions (requires prior --proofread run)
  --ot               Process only Old Testament (books 1-39)
  --nt               Process only New Testament (books 40-66)
  --book <range>     Process book(s): single (43) or range (1-20)
  --chapter <range>  Process chapter(s): single (1) or range (1-10)
  --verse <range>    Process verse(s): single (1) or range (1-10)
  --force            Force re-generation even if file exists
  --help             Show this help message

Output structure:
  Translations:  word4word/<bible>/<book>/<chapter>/<verse>.json
                 e.g., word4word/osnb2/43/1/1.json

  Originals:     word4word/<source>/<lang>/<book>/<chapter>/<verse>.json
                 e.g., word4word/tanach/nb/1/1/1.json

Examples:
  # Translation mode (explains translated words with reference to original)
  node word4word.mjs osnb2 --nt                                # → word4word/osnb2/...
  node word4word.mjs osnb2 --book 43 --chapter 1 --verse 1-11  # John 1:1-11
  node word4word.mjs osnb2 --nt --proofread --apply            # generate → proofread → apply

  # Original source mode (explains Hebrew/Greek words directly)
  node word4word.mjs tanach --ot                               # → word4word/tanach/nb/...
  node word4word.mjs tanach --language en --book 1             # → word4word/tanach/en/...
  node word4word.mjs tanach --language nn --book 1             # → word4word/tanach/nn/...
  node word4word.mjs sblgnt --nt                               # → word4word/sblgnt/nb/...

Parallel processing (run in separate terminals):
  node word4word.mjs osnb2 --book 1-20 &                       # terminal 1
  node word4word.mjs osnb2 --book 21-39 &                      # terminal 2
`);
}

function parseRange(value) {
    if (value.includes('-')) {
        const [start, end] = value.split('-').map(n => parseInt(n, 10));
        return { start, end };
    }
    const num = parseInt(value, 10);
    return { start: num, end: num };
}

function parseArgs(args) {
    const options = {
        source: null,
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
        } else if (!arg.startsWith('--') && !options.source) {
            options.source = arg;
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

    if (!options.source) {
        console.error("Error: Source is required (bible version or original source)");
        printUsage();
        process.exit(1);
    }

    const isOriginal = isOriginalSource(options.source);
    const validSources = [...Object.keys(bibles), ...ORIGINAL_SOURCES];

    if (!validSources.includes(options.source)) {
        console.error(`Error: Unknown source '${options.source}'. Valid sources: ${validSources.join(', ')}`);
        process.exit(1);
    }

    // Determine book range based on source type
    let startBook = 1;
    let endBook = 66;

    // For original sources, restrict to valid book ranges
    if (options.source === 'tanach') {
        startBook = 1;
        endBook = 39;
    } else if (options.source === 'sblgnt') {
        startBook = 40;
        endBook = 66;
    }

    // Override with user-specified ranges
    if (options.bookStart !== null) {
        startBook = Math.max(startBook, options.bookStart);
        endBook = Math.min(endBook, options.bookEnd);
    } else if (options.ot && !options.nt) {
        startBook = Math.max(startBook, 1);
        endBook = Math.min(endBook, 39);
    } else if (options.nt && !options.ot) {
        startBook = Math.max(startBook, 40);
        endBook = Math.min(endBook, 66);
    }

    const modes = ['Generate'];
    if (options.proofread) modes.push('Proofread');
    if (options.apply) modes.push('Apply');

    console.log(`Source: ${options.source} (${isOriginal ? 'original' : 'translation'})`);
    if (isOriginal) {
        console.log(`Explanation language: ${options.language}`);
    }
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
            // Read source file to get verse list
            const sourceFile = `bibles_raw/${options.source}/${bookId}/${chapterId}.json`;
            if (!fs.existsSync(sourceFile)) {
                console.log(`Source file not found: ${sourceFile}`);
                continue;
            }

            const verses = JSON.parse(fs.readFileSync(sourceFile, 'utf-8'));
            const startVerse = options.verseStart || 1;
            const maxVerse = Math.max(...verses.map(v => +v.verseId));
            const endVerse = Math.min(options.verseEnd || maxVerse, maxVerse);

            for (let verseId = startVerse; verseId <= endVerse; verseId++) {
                // Check if verse exists
                if (!verses.find(v => +v.verseId === verseId)) {
                    continue;
                }

                // For original sources, include language code in path
                // word4word/tanach/nb/1/1/1.json vs word4word/osnb2/43/1/1.json
                const langCode = isOriginal ? getLanguageCode(options.language) : null;
                const outputDir = isOriginal
                    ? `word4word/${options.source}/${langCode}/${bookId}/${chapterId}`
                    : `word4word/${options.source}/${bookId}/${chapterId}`;
                const filename = `${outputDir}/${verseId}.json`;

                // Step 1: Generate (skip if file exists unless --force)
                if (!fs.existsSync(filename) || options.force) {
                    console.log(`Generating word explanations for ${bookId}:${chapterId}:${verseId}`);
                    await generateWordExplanations(options.source, bookId, chapterId, verseId, filename, options.language);
                }

                // Step 2: Proofread (if requested)
                let proofreadResult = null;
                if (options.proofread && fs.existsSync(filename)) {
                    const saveToFile = !options.apply;
                    proofreadResult = await proofreadVerse(options.source, bookId, chapterId, verseId, filename, saveToFile, options.language);
                }

                // Step 3: Apply (if requested)
                if (options.apply) {
                    applyProofreadChanges(options.source, bookId, chapterId, verseId, filename, proofreadResult, options.language);
                }
            }
        }
    }

    console.log('Done!');
}

main().catch(console.error);
