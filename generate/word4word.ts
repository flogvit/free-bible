import dotenv from 'dotenv'
import * as fs from 'fs';
import path from 'path';

dotenv.config()

import Anthropic from '@anthropic-ai/sdk';
import {bibles, books, anthropicModel, maxTokens, normalizeLanguage, getLanguageCode} from "./constants.js";
import type {Chapter} from '../kvn/src/bible-types.js';
import {parseArgs, formatHelp, COMMON_FLAGS} from './cli.js';
import type {FlagSpec, Range} from './cli.js';

const anthropic = new Anthropic();

/** JSON-schema slik SDK-en vil ha det i `output_config.format`. */
type JsonSchema = Record<string, unknown>;

/** En tidligere forklaring av ordet, lagret av `applyProofreadChanges`. */
interface WordVersion {
    explanation: string;
    type: string;
    severity: string;
    reason: string;
    /** Bare i oversettelsesmodus. */
    original?: string;
    /** Bare i originalkildemodus (tanach/sblgnt). */
    pronunciation?: string;
}

/**
 * Ett forklart ord.
 *
 * `original` og `pronunciation` er de to modusene som utelukker hverandre:
 * oversettelser har et originalord, originalkilder har en uttale.
 */
interface Word {
    word: string;
    wordId: number;
    explanation: string;
    pronunciation?: string;
    original?: string;
    versions?: WordVersion[];
}

/** Ett vers i `word4word/`-filene: versadressen pluss ordene. */
interface VerseWords {
    bookId: number;
    chapterId: number;
    verseId: number;
    words: Word[];
}

/** Svaret fra genereringskallet — merk at det pakker versene i et `verses`-felt. */
interface WordExplanationResult {
    verses: VerseWords[];
}

interface ProofreadIssue {
    wordId: number;
    type: string;
    severity: string;
    currentExplanation?: string;
    suggestedExplanation?: string;
    currentPronunciation?: string;
    suggestedPronunciation?: string;
    currentOriginal?: string;
    suggestedOriginal?: string;
    reason: string;
}

interface ProofreadResult {
    issues?: ProofreadIssue[];
    summary?: string;
    /** Skjemaet krever den, men koden sjekker likevel null/undefined før den skrives ut. */
    score?: number | null;
}

const MAX_RETRIES = 3;

// --- JSON Schemas for structured outputs ---

const WORD_EXPLANATION_SCHEMA = {
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
                    words: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                word: {type: "string"},
                                pronunciation: {type: "string"},
                                wordId: {type: "integer"},
                                original: {type: "string"},
                                explanation: {type: "string"}
                            },
                            required: ["word", "wordId", "explanation"],
                            additionalProperties: false
                        }
                    }
                },
                required: ["bookId", "chapterId", "verseId", "words"],
                additionalProperties: false
            }
        }
    },
    required: ["verses"],
    additionalProperties: false
};

const WORD_PROOFREAD_SCHEMA = {
    type: "object",
    properties: {
        issues: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    wordId: {type: "integer"},
                    type: {type: "string", enum: ["error", "suggestion", "theological", "grammar"]},
                    severity: {type: "string", enum: ["critical", "major", "minor"]},
                    currentExplanation: {type: "string"},
                    suggestedExplanation: {type: "string"},
                    currentPronunciation: {type: "string"},
                    suggestedPronunciation: {type: "string"},
                    currentOriginal: {type: "string"},
                    suggestedOriginal: {type: "string"},
                    reason: {type: "string"}
                },
                required: ["wordId", "type", "severity", "reason"],
                additionalProperties: false
            }
        },
        summary: {type: "string"},
        score: {type: "integer"}
    },
    required: ["issues", "summary", "score"],
    additionalProperties: false
};

// Original sources (not translations)
const ORIGINAL_SOURCES = ['hebrew', 'tanach', 'wlc', 'sblgnt'];

// Check if bible is an original source (not a translation)
function isOriginalSource(bible: string): boolean {
    return ORIGINAL_SOURCES.includes(bible);
}

// Get original language based on book ID
function getOriginalLanguage(bookId: number): string {
    return bookId <= 39 ? 'Hebrew' : 'Greek';
}

function getOriginalSource(bookId: number): string {
    return bookId <= 39 ? 'hebrew' : 'sblgnt';
}

// Word explanation prompt for ORIGINAL language texts (tanach/sblgnt)
function getOriginalWordExplanationPrompt(explanationLanguage: string, originalLanguage: string, bookId: number, chapterId: number, verseId: number, originalText: string): string {
    return `You will be given a verse in the original ${originalLanguage} language.
You should explain every word in the text.
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

Return a JSON object with a "verses" array containing each verse with its word explanations.

${originalLanguage} text:
${originalText}`;
}

// Word explanation prompt for TRANSLATED texts (osnb, osnn, etc)
function getTranslationWordExplanationPrompt(language: string, originalLanguage: string, bookId: number, chapterId: number, verseId: number, originalText: string, translatedText: string): string {
    return `You will be given a verse in the original ${originalLanguage} language and a translation.
You should explain every word in the translated text.
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

Return a JSON object with a "verses" array containing each verse with its word explanations.

Original ${originalLanguage} text:
${originalText}

Translation:
${translatedText}`;
}

// Proofread prompt for word explanations
function getProofreadPrompt(language: string, originalLanguage: string, bookId: number, chapterId: number, verseId: number, originalText: string, wordData: VerseWords, isOriginalSource = false): string {
    const formattedWords = wordData.words.map((w: Word) => {
        let entry: string;
        if (isOriginalSource) {
            // Original source mode: word is the original language word
            entry = `${w.wordId}. "${w.word}" (pronunciation: ${w.pronunciation || 'N/A'}): ${w.explanation}`;
        } else {
            // Translation mode: word is translated, original is the source
            entry = `${w.wordId}. "${w.word}" (original: ${w.original || 'N/A'}): ${w.explanation}`;
        }
        if (w.versions && w.versions.length > 0) {
            entry += `\n      VERSION HISTORY (${w.versions.length} previous revisions - DO NOT suggest any of these):`;
            w.versions.forEach((ver: WordVersion, i: number) => {
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

IMPORTANT:
- Some words have VERSION HISTORY showing previous revisions. Read the history carefully.
- NEVER suggest text that matches or is similar to ANY previous version in the history.
- NEVER undo a change that was intentionally made (check the reason).
- If a word has 3+ revisions, it has been extensively reviewed - only suggest changes for CRITICAL errors.
- If the current explanation is acceptable, SKIP that word entirely - do not include it in issues.
- NEVER mention specific Bible editions, Bible societies, or publishers (e.g., "NIV", "ESV", "KJV", "Bibelen 2011", "Bibelselskapet"). Write neutrally without referencing specific translations or organizations.

If there are no issues, return an empty issues array with a summary and score of 10.

Book ID: ${bookId}, Chapter: ${chapterId}, Verse: ${verseId}

${originalLanguage} text:
${originalText}

Current word explanations:
${formattedWords}`;
}

async function doAnthropicCall(content: string, schema: JsonSchema | null | undefined) {
    const options: Anthropic.MessageCreateParamsNonStreaming = {
        model: anthropicModel,
        max_tokens: maxTokens,
        messages: [
            {
                role: "user",
                content
            }
        ]
    };

    if (schema) {
        options.output_config = {
            format: {
                type: "json_schema",
                schema
            }
        };
    }

    return anthropic.messages.create(options);
}

// Detect hallucinated English words that shouldn't appear in Norwegian/other translations
// Check if language is English (hallucination detection should be skipped for English)
function isEnglishLanguage(language: string): boolean {
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

export function detectHallucinations(text: string): string[] {
    const found: string[] = [];
    for (const pattern of HALLUCINATION_PATTERNS) {
        const match = text.match(pattern);
        if (match) {
            found.push(match[0]);
        }
    }
    return found;
}

// `any` her er tilsiktet: funksjonen kalles med begge svarformene (generering
// og korrektur) og plukker ut felter som bare finnes i én av dem.
export function validateWordExplanationResult(result: any): boolean {
    // Genereringssvaret er pakket som `{verses: [...]}`, korrektursvaret har
    // `issues` på toppnivå. Uten utpakkingen ble `[result]` til
    // `[{verses: [...]}]`, der verken `.words` eller `.issues` finnes — så
    // hallusinasjonssjekken var en no-op i HELE genereringsløpet (#109).
    // Korrekturløpet virket, fordi `issues` ligger der funksjonen så etter.
    const unwrapped = result && Array.isArray(result.verses) ? result.verses : result;
    const verses = Array.isArray(unwrapped) ? unwrapped : [unwrapped];

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

// T er formen kallstedet forventer tilbake fra JSON-svaret; skjemaet håndheves
// på API-siden, så den er en påstand og ikke en kontroll.
async function doAnthropicCallWithRetry<T = any>(content: string, schema: JsonSchema | null | undefined, context = '', validate = true): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const completion = await doAnthropicCall(content, schema);
            if (completion.stop_reason === 'max_tokens') {
                throw new Error(`Response truncated (hit max_tokens limit of ${maxTokens})`);
            }
            const responseText = (completion.content[0] as Anthropic.TextBlock).text;
            const result = JSON.parse(responseText) as T;

            // Validate for hallucinations if requested
            if (validate) {
                validateWordExplanationResult(result);
            }

            return result;
        } catch (error) {
            lastError = error;
            if (attempt < MAX_RETRIES) {
                console.log(`  Attempt ${attempt} failed (${(error as Error).message}), retrying...`);
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
    }

    console.error(`Failed after ${MAX_RETRIES} attempts for ${context}`);
    throw lastError;
}

function readOriginalVerse(bookId: number, chapterId: number, verseId: number) {
    const source = getOriginalSource(bookId);
    const sourceFile = `bibles_raw/${source}/${bookId}/${chapterId}.json`;

    if (!fs.existsSync(sourceFile)) {
        console.error(`Original source not found: ${sourceFile}`);
        return null;
    }

    const allVerses = JSON.parse(fs.readFileSync(sourceFile, 'utf-8')) as Chapter;
    return allVerses.find(v => +v.verseId === +verseId);
}

function readTranslatedVerse(bible: string, bookId: number, chapterId: number, verseId: number) {
    const translationFile = `bibles_raw/${bible}/${bookId}/${chapterId}.json`;

    if (!fs.existsSync(translationFile)) {
        return null;
    }

    const allVerses = JSON.parse(fs.readFileSync(translationFile, 'utf-8')) as Chapter;
    return allVerses.find(v => +v.verseId === +verseId);
}

async function generateWordExplanations(bible: string, bookId: number, chapterId: number, verseId: number, filename: string, explanationLanguage = 'Norwegian bokmål') {
    const originalLanguage = getOriginalLanguage(bookId);
    const isOriginal = isOriginalSource(bible);

    let content: string;
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
    const result = await doAnthropicCallWithRetry<WordExplanationResult>(content, WORD_EXPLANATION_SCHEMA, `${bookId}:${chapterId}:${verseId}`, shouldValidate);

    const dir = path.dirname(filename);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, {recursive: true});
    }

    console.log("Writing", filename);
    fs.writeFileSync(filename, JSON.stringify(result.verses, null, 2));
}

async function proofreadVerse(bible: string, bookId: number, chapterId: number, verseId: number, filename: string, saveToFile = true, explanationLanguage = 'Norwegian bokmål'): Promise<ProofreadResult | null> {
    const isOriginal = isOriginalSource(bible);
    const language = isOriginal ? explanationLanguage : bibles[bible];
    const originalLanguage = getOriginalLanguage(bookId);

    if (!fs.existsSync(filename)) {
        console.log(`No word explanation file found for ${bookId}:${chapterId}:${verseId}`);
        return null;
    }

    const wordData = JSON.parse(fs.readFileSync(filename, 'utf-8')) as VerseWords[] | VerseWords;
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
    const result = await doAnthropicCallWithRetry<ProofreadResult>(content, WORD_PROOFREAD_SCHEMA, `proofread ${bookId}:${chapterId}:${verseId}`, shouldValidate);

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
        result.issues.forEach((issue: ProofreadIssue, i: number) => {
            console.log(`  ${i + 1}. [${issue.severity}] Word ${issue.wordId}: ${issue.type}`);
            console.log(`     ${issue.reason}`);
        });
    }

    return result;
}

function applyProofreadChanges(bible: string, bookId: number, chapterId: number, verseId: number, filename: string, proofreadResult: ProofreadResult | null = null, explanationLanguage = 'Norwegian bokmål') {
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
        proofreadResult = JSON.parse(fs.readFileSync(proofreadFile, 'utf-8')) as ProofreadResult;
    }

    if (!fs.existsSync(filename)) {
        console.log(`No word explanation file found for ${bookId}:${chapterId}:${verseId}`);
        return;
    }

    const wordData = JSON.parse(fs.readFileSync(filename, 'utf-8')) as VerseWords[] | VerseWords;
    // Handle both array format and single object format
    const isArray = Array.isArray(wordData);
    const verseData = isArray ? wordData[0] : wordData;

    if (!proofreadResult.issues || proofreadResult.issues.length === 0) {
        return;
    }

    let appliedCount = 0;

    for (const issue of proofreadResult.issues) {
        const word = verseData.words.find((w: Word) => +w.wordId === +issue.wordId);
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
            const versionEntry: WordVersion = {
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
            // `explanationChanging` er sann bare når suggestedExplanation finnes.
            word.explanation = issue.suggestedExplanation as string;
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
        const changes: string[] = [];
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

/**
 * Kommandolinjevalgene, slik `readOptions` setter dem sammen av de tolkede
 * flaggene. `null` betyr «ikke avgrenset» og leses av main som hele området.
 */
interface CliOptions {
    source: string | null;
    language: string;
    proofread: boolean;
    apply: boolean;
    ot: boolean;
    nt: boolean;
    bookStart: number | null;
    bookEnd: number | null;
    chapterStart: number | null;
    chapterEnd: number | null;
    verseStart: number | null;
    verseEnd: number | null;
    force: boolean;
}

/**
 * Flaggkontrakten for dette skriptet (#51, #52, #53).
 *
 * Kilden er fortsatt et posisjonsargument — `bun generate/word4word.ts osnb` —
 * men `--bible osnb` gjør det samme nå, slik at begrepet heter det samme her
 * som i de andre skriptene. Skriptet har aldri hatt `--local`: det går mot
 * Claude, og det finnes ingen lokal vei gjennom det.
 */
const SPEC: Record<string, FlagSpec> = {
    bible: {kind: 'string', help: 'kilden, som posisjonsargumentet: osnb, osnn, osen, tanach, sblgnt'},
    language: COMMON_FLAGS.language,   // 'nb' → normalizeLanguage → 'Norwegian bokmål', som før
    proofread: {kind: 'boolean', help: 'kjør korrektur etter genereringen'},
    apply: {kind: 'boolean', help: 'skriv korrekturens forslag inn i fila'},
    book: COMMON_FLAGS.book,
    chapter: COMMON_FLAGS.chapter,
    verse: COMMON_FLAGS.verse,
    ot: COMMON_FLAGS.ot,
    nt: COMMON_FLAGS.nt,
    force: COMMON_FLAGS.force,
    help: COMMON_FLAGS.help,
};

const HELP_EXAMPLES = [
    '# Oversettelsesmodus — forklarer de oversatte ordene mot originalen',
    'bun generate/word4word.ts osnb --nt                                # → word4word/osnb/...',
    'bun generate/word4word.ts osnb --book 43 --chapter 1 --verse 1-11  # Johannes 1:1-11',
    'bun generate/word4word.ts osnb --nt --proofread --apply            # generer → korrektur → skriv inn',
    '',
    '# Originalkildemodus — forklarer de hebraiske/greske ordene direkte',
    'bun generate/word4word.ts tanach --ot                              # → word4word/tanach/nb/...',
    'bun generate/word4word.ts tanach --language en --book 1            # → word4word/tanach/en/...',
    'bun generate/word4word.ts sblgnt --nt                              # → word4word/sblgnt/nb/...',
    '',
    '# Parallellkjøring i hvert sitt skall',
    'bun generate/word4word.ts osnb --book 1-20 &',
    'bun generate/word4word.ts osnb --book 21-39 &',
    '',
    'Kilden er posisjonsargumentet (eller --bible): oversettelsene osnb, osnn, osen,',
    'eller originalkildene tanach og sblgnt. --language brukes bare av originalkildene.',
    '',
    'Filene havner i word4word/<kilde>/<bok>/<kapittel>/<vers>.json for oversettelser',
    'og word4word/<kilde>/<språkkode>/<bok>/<kapittel>/<vers>.json for originalkilder.',
];

/** Oversetter de tolkede flaggene til `CliOptions`. */
function readOptions(
    flags: ReturnType<typeof parseArgs>['flags'],
    positional: string[],
): CliOptions {
    const book = flags.book as Range | undefined;
    const chapter = flags.chapter as Range | undefined;
    const verse = flags.verse as Range | undefined;

    return {
        // Kilden har alltid vært posisjonsargumentet; `--bible` er det nye,
        // felles navnet på det samme og vinner når begge er gitt.
        source: (flags.bible as string | undefined) ?? positional[0] ?? null,
        language: normalizeLanguage(flags.language as string),
        proofread: flags.proofread as boolean,
        apply: flags.apply as boolean,
        ot: flags.ot as boolean,
        nt: flags.nt as boolean,
        bookStart: book?.start ?? null,
        bookEnd: book?.end ?? null,
        chapterStart: chapter?.start ?? null,
        chapterEnd: chapter?.end ?? null,
        verseStart: verse?.start ?? null,
        verseEnd: verse?.end ?? null,
        force: flags.force as boolean,
    };
}

async function main() {
    // Hjelpen skal ut før noe leses fra disk eller sendes over nettet.
    const {flags, positional} = parseArgs(process.argv.slice(2), SPEC);
    if (flags.help) {
        console.log(formatHelp(
            'generate/word4word.ts',
            'ord-for-ord-forklaringer per vers, generert og korrekturlest av en modell',
            SPEC,
            HELP_EXAMPLES,
        ));
        process.exit(0);
    }

    const options = readOptions(flags, positional);

    if (!options.source) {
        console.error('Feil: kilden mangler (oversettelse eller originalkilde).');
        console.error('Kjør med --help for bruken.');
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
    if (options.source === 'hebrew' || options.source === 'tanach' || options.source === 'wlc') {
        startBook = 1;
        endBook = 39;
    } else if (options.source === 'sblgnt') {
        startBook = 40;
        endBook = 66;
    }

    // Override with user-specified ranges
    if (options.bookStart !== null) {
        // `--book` setter alltid begge endene samtidig, så bookEnd er satt her.
        startBook = Math.max(startBook, options.bookStart);
        endBook = Math.min(endBook, options.bookEnd!);
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

            const verses = JSON.parse(fs.readFileSync(sourceFile, 'utf-8')) as Chapter;
            const startVerse = options.verseStart || 1;
            const maxVerse = Math.max(...verses.map(v => +v.verseId));
            const endVerse = Math.min(options.verseEnd || maxVerse, maxVerse);

            for (let verseId = startVerse; verseId <= endVerse; verseId++) {
                // Check if verse exists
                if (!verses.find(v => +v.verseId === verseId)) {
                    continue;
                }

                // For original sources, include language code in path
                // word4word/tanach/nb/1/1/1.json vs word4word/osnb/43/1/1.json
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

// Avslutt med kode 1, ikke 0: et ukjent flagg skal stoppe et køskript, ikke
// bare skrive en linje det ingen leser. Samme mønster som references.ts.
// Tidligere var dette `.catch(console.error)`.
// Kjører bare når fila startes direkte. Uten vakten kjører jobben ved IMPORT —
// det er grunnen til at days.ts slettet data bare man lastet modulen (#108),
// og det gjør skriptene umulige å teste.
if (import.meta.main) {
    main().catch(err => {
    console.error(err);
    process.exit(1);
});
}
