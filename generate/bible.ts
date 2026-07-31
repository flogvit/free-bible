import dotenv from 'dotenv'
import * as fs from 'fs';
import path from 'path';

dotenv.config()

import Anthropic from '@anthropic-ai/sdk';
import {bibles, books, anthropicModel, maxTokens, getBibleStyle} from "./constants.js";

// SDK-en prøver selv på nytt ved 429/5xx; hev taket, siden lange kjøringer treffer
// overbelastning som varer lenger enn standardens to forsøk.
const anthropic = new Anthropic({maxRetries: 5});

const MAX_VERSES_PER_BATCH = 100;
// En foreslått tekst som er mye kortere enn den den erstatter har som regel mistet
// innhold: modellen returnerte bare frasen den festet seg ved, ikke hele verset.
// Målt på osen: 97 vers står avkortet slik, verst 325 → 68 tegn der begrunnelsen bare
// gjaldt ett ord. Median for et legitimt bytte er 1.03, 5. persentil 0.91.
const MIN_LENGTH_RATIO = 0.85;

// Et vers modellen har frikjent skal ikke kontrolleres igjen før noe faktisk endrer seg.
// Signaturen fanger begge måtene det kan skje på: en ny versjon legges til, eller teksten
// endres. Modusene har hver sin nøkkel — «mangler det innhold?» og «er oversettelsen
// riktig?» er ulike spørsmål, så en frikjennelse i den ene sier ingenting om den andre.
function reviewSignature(verse) {
    return `${(verse.versions || []).length}:${verse.text.length}`;
}
function alreadyCleared(verse, mode) {
    return verse.checked?.[mode] === reviewSignature(verse);
}
const MAX_PROOFREAD_CHARS = 10000; // Target max input chars per proofread batch (lowered to account for footnotes)

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
                    explanation: {type: "string"},
                    previousWasDefensible: {type: "boolean"}
                },
                required: ["verseId", "type", "severity", "original", "current", "suggested", "explanation", "previousWasDefensible"],
                additionalProperties: false
            }
        },
        footnotes: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    verseId: {type: "integer"},
                    text: {type: "string"},
                    source: {type: "string", enum: ["oversettelse", "lingvistisk", "teologisk", "historisk", "tekstkritisk", "liturgisk", "annet"]}
                },
                required: ["verseId", "text", "source"],
                additionalProperties: false
            }
        },
        summary: {type: "string"},
        score: {type: "integer"}
    },
    required: ["issues", "footnotes", "summary", "score"],
    additionalProperties: false
};

// Batch review without footnotes — same issue shape, footnotes dropped.
const PROOFREAD_TEXT_SCHEMA = {
    type: "object",
    properties: {
        issues: PROOFREAD_SCHEMA.properties.issues,
        summary: {type: "string"},
        score: {type: "integer"}
    },
    required: ["issues", "summary", "score"],
    additionalProperties: false
};

// Phase 1: text-only review schema
const TEXT_REVIEW_SCHEMA = {
    type: "object",
    properties: {
        issue: {
            type: ["object", "null"],
            properties: {
                type: {type: "string", enum: ["error", "suggestion", "theological", "grammar"]},
                severity: {type: "string", enum: ["critical", "major", "minor"]},
                suggested: {type: "string"},
                explanation: {type: "string"},
                previousWasDefensible: {type: "boolean"}
            },
            required: ["type", "severity", "suggested", "explanation", "previousWasDefensible"],
            additionalProperties: false
        },
        done: {type: "boolean"},
        score: {type: "integer"}
    },
    required: ["issue", "done", "score"],
    additionalProperties: false
};

// Phase 2: footnote-only review schema
const FOOTNOTE_REVIEW_SCHEMA = {
    type: "object",
    properties: {
        footnotes: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    text: {type: "string"},
                    source: {type: "string", enum: ["oversettelse", "lingvistisk", "teologisk", "historisk", "tekstkritisk", "liturgisk", "annet"]}
                },
                required: ["text", "source"],
                additionalProperties: false
            }
        },
        done: {type: "boolean"},
        score: {type: "integer"}
    },
    required: ["footnotes", "done", "score"],
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
const PROOFREAD_PROMPT = (language, style, textOnly = false, restoring = false) => {
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

${textOnly ? '' : `You should also suggest FOOTNOTES for verses where there are interesting details that enrich the reader's understanding but don't belong in the translation text itself. The source categories have distinct purposes — do not overlap:
- oversettelse: REQUIRED FOR EVERY VERSE — explain why the current translation reads the way it does. Every verse involves translation choices: word selection, word order, how idioms are rendered, what nuance was prioritized. For example: why «Rabbi» is kept untranslated, why «tegn» rather than «mirakler» for σημεῖα, why a particular sentence structure was chosen. These notes help the reader understand what they are reading and what alternatives exist.
- lingvistisk: About the original language itself — etymology, wordplay, grammar, idioms in Hebrew/Greek that enrich understanding regardless of how it was translated.
- teologisk: Theological discussion — different doctrinal interpretations, how traditions disagree, what theological weight a passage carries.
- historisk: Historical or cultural background — customs, places, events that illuminate the text.
- tekstkritisk: Manuscript variants — differences between textual witnesses, which readings are better attested.
- liturgisk: Liturgical usage — how the passage is used in worship, church calendar, or prayer traditions.
Each footnote has: verseId, text (the footnote content), source (one of: oversettelse, lingvistisk, teologisk, historisk, tekstkritisk, liturgisk, annet).
The footnote text can be multiple sentences — be thorough.
Every verse MUST have at least one «oversettelse» footnote. The other categories are optional and should only be added where they genuinely add value.
Write all footnote text in ${language}, the same language as the translation. The category names themselves are fixed identifiers shared across all translations — use them exactly as given, never translated.

`}Set "previousWasDefensible" for every issue. This decides what the reader is shown:
- true  = the current reading was a legitimate way to render the source. Your suggestion is
          better, but the old one stays visible to the reader as a genuine alternative.
- false = the current reading was inaccurate, ungrammatical, or dropped or added content.
          It gets hidden from the reader rather than offered as a choice.
Judge the previous reading on its own merits, not by how much you prefer yours. A different
but defensible rendering is true; something a careful translator would call wrong is false.

IMPORTANT:
- The "suggested" field must contain the ENTIRE corrected verse, not just the changed phrase.
- Some verses have VERSION HISTORY showing previous revisions. Read the history carefully.
${restoring ? `- These verses are suspected of having LOST CONTENT in an earlier revision: the current
  text is much shorter than a previous version. Compare the current text against the
  original language word by word and restore whatever is missing. Here the version
  history is the resource, not a prohibition — reusing wording from it is expected.
  If nothing is actually missing, report no issue.` : `- NEVER suggest text that matches or is similar to ANY previous version in the history.`}
- NEVER undo a change that was intentionally made (check the "Reason for change").
- If a verse has 3+ revisions, it has been extensively reviewed - only suggest changes for CRITICAL errors.
- If the current version is acceptable, SKIP that verse entirely - do not include it in issues.
- Focus only on verses WITHOUT version history, or verses with genuine new errors.
- Some verses may already have footnotes. Review existing footnotes and only suggest new ones if they add value. Do not duplicate existing footnotes.
- NEVER mention specific Bible editions, Bible societies, or publishers (e.g., "NIV", "ESV", "KJV", "Bibelen 2011", "Bibelselskapet"). Write neutrally without referencing specific translations or organizations.

Score the chapter from 0 to 10, where 10 means the translation is faithful and reads well with nothing left to improve. Use the 0-10 scale only — not a percentage.

If there are no issues (or all issues are in well-reviewed verses), return an empty issues array.`;
};

const MAX_RETRIES = 8;

// Overbelastning og rate limit er forbigående og varer typisk lenger enn sekunder.
// Faste ett-sekunds pauser brant opp forsøkene før tjenesten rakk å komme tilbake.
function isTransient(error) {
    const type = error?.error?.error?.type || error?.error?.type || '';
    return ['overloaded_error', 'rate_limit_error', 'api_error'].includes(type)
        || [429, 500, 502, 503, 529].includes(error?.status)
        || /overloaded|rate.?limit|timeout|ECONNRESET|socket hang up/i.test(error?.message || '');
}

function backoffMs(attempt, transient) {
    if (!transient) return 1000;
    const base = Math.min(60000, 2000 * 2 ** (attempt - 1));   // 2s, 4s, 8s … taket 60s
    return Math.round(base * (0.5 + Math.random()));            // jitter, så parallelle kjøringer ikke synkroniserer
}

// Akkumulert tokenforbruk for hele kjøringen, skrives ut til slutt.
const usageTotals = {input: 0, output: 0, calls: 0};

function formatUsage() {
    const {input, output, calls} = usageTotals;
    // Opus 5: $5 per M input, $25 per M output
    const cost = (input / 1e6) * 5 + (output / 1e6) * 25;
    return `${calls} calls | ${input.toLocaleString()} in / ${output.toLocaleString()} out | ~$${cost.toFixed(2)}`;
}

async function doAnthropicCall(content, schema) {
    // Streaming: max_tokens over ~16k risikerer HTTP-timeout uten strøm.
    const stream = anthropic.messages.stream({
        model: anthropicModel,
        max_tokens: maxTokens,
        thinking: {type: "adaptive"},
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
    return stream.finalMessage();
}

// Med tenkning på ligger tenkeblokker først i content — teksten må hentes ut,
// ikke leses fra content[0].
function extractText(completion) {
    const block = completion.content.find(b => b.type === 'text');
    if (!block) {
        throw new Error(`No text block in response (stop_reason: ${completion.stop_reason})`);
    }
    return block.text;
}

// Detect hallucinated English words that shouldn't appear in Norwegian/other translations
function isEnglishLanguage(language) {
    const lower = language.toLowerCase();
    return lower === 'english' || lower === 'en';
}

// Verse text can carry footnote definitions at the end ("... [^fn]\n\n[^fn]: ...").
// Length comparisons must ignore that block, or every correction to a footnoted
// verse looks like a truncation. Application must keep the block when the
// suggestion drops it - otherwise an accepted fix would silently delete footnotes.
function splitFootnoteDefs(text) {
    const m = (text || '').match(/\n\n\[\^[^\]]+\]:[\s\S]*$/);
    if (!m) return {body: text || '', defs: ''};
    return {body: text.slice(0, m.index), defs: text.slice(m.index)};
}

const FOOTNOTE_MARKER = /\[\^[^\]]+\]/;

// Evaluates a suggested replacement for a verse text:
// - ratio compares only the visible body (footnote defs excluded on both sides)
// - newText re-attaches the original footnote block if the suggestion dropped it
// - dropsMarker is true when the suggestion lost an inline [^fn] marker, which
//   would orphan the definitions - such suggestions must be rejected
function evaluateSuggestion(currentText, suggestedText) {
    const current = splitFootnoteDefs(currentText);
    const suggested = splitFootnoteDefs(suggestedText);
    const ratio = current.body.length ? suggested.body.length / current.body.length : 1;
    const dropsMarker = FOOTNOTE_MARKER.test(current.body) && !FOOTNOTE_MARKER.test(suggested.body);
    const newText = suggested.defs ? suggestedText : suggested.body + current.defs;
    return {ratio, newText, dropsMarker};
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
            if (completion.usage) {
                usageTotals.input += completion.usage.input_tokens || 0;
                usageTotals.output += completion.usage.output_tokens || 0;
                usageTotals.calls++;
            }
            if (completion.stop_reason === 'max_tokens') {
                throw new Error(`Response truncated (hit max_tokens limit of ${maxTokens})`);
            }
            if (completion.stop_reason === 'refusal') {
                throw new Error(`Refused (${completion.stop_details?.category || 'unknown'})`);
            }
            const responseText = extractText(completion);
            const result = JSON.parse(responseText);

            if (validate) {
                validateTranslationResult(result);
            }

            return result;
        } catch (error) {
            lastError = error;
            if (attempt < MAX_RETRIES) {
                const transient = isTransient(error);
                const wait = backoffMs(attempt, transient);
                const reason = (error.message || '').slice(0, 90);
                console.log(`  Attempt ${attempt}/${MAX_RETRIES} failed (${reason}) — waiting ${Math.round(wait / 1000)}s`);
                await new Promise(resolve => setTimeout(resolve, wait));
            }
        }
    }

    console.error(`Failed after ${MAX_RETRIES} attempts for ${context}`);
    throw lastError;
}

// "Genesis 6" — brukes i logglinjer så det går fram hvilket kapittel som kjøres.
function chapterLabel(bookId, chapterId) {
    const book = books.find(b => b.id === bookId);
    return `${book ? book.name : `Book ${bookId}`} ${chapterId}`;
}

function getOriginalSource(bookId) {
    return bookId <= 39 ? 'hebrew' : 'sblgnt';
}

function readOriginalText(bookId, chapterId, existingVerses = []) {
    const source = getOriginalSource(bookId);
    const sourceFile = `bibles_raw/${source}/${bookId}/${chapterId}.json`;

    if (!fs.existsSync(sourceFile)) {
        console.error(`Original source not found: ${sourceFile}`);
        return [];
    }

    const allVerses = JSON.parse(fs.readFileSync(sourceFile, 'utf-8'));

    // Et vers teller som gjort bare hvis det faktisk har tekst. triage.mjs --drop
    // tømmer teksten på vers som skal oversettes på nytt, men beholder posten med
    // historikken, så den må ikke regnes som ferdig her.
    return allVerses.filter(verse =>
        !existingVerses.some(v => +v.verseId === +verse.verseId && v.text && v.text.trim())
    );
}

// Forkastede forsøk på et vers, formatert for oversettelsesprompten.
function rejectedAttempts(existingVerses, verseId) {
    const record = existingVerses.find(v => +v.verseId === +verseId);
    if (!record?.versions?.length) return null;
    return record.versions
        .map((v, i) => `  ${i + 1}. "${v.text}"${v.explanation ? `\n     rejected: ${v.explanation}` : ''}`)
        .join('\n');
}

function getTranslationPrompt(style, language, bookId, chapterId, text, rejected = '') {
    const stylePrompt = TRANSLATION_PROMPTS[style](language);

    return `You will be given a bible text in the original language, and must return the translation.
Return a JSON object with a "verses" array containing each verse.

${stylePrompt}

Book ID: ${bookId}, Chapter: ${chapterId}
${rejected ? `
Some of these verses have been translated before and rejected. Produce a genuinely
different rendering that fixes the stated problem — do not return any of these:
${rejected}
` : ''}
Text:
${text}`;
}

function getProofreadPrompt(language, style, bookId, chapterId, originalText, translatedVerses, textOnly = false, targetIds = null, restoring = false) {
    const formattedTranslation = translatedVerses.map(v => {
        const isContext = targetIds && !targetIds.has(+v.verseId);
        let entry = `${v.verseId}:${isContext ? ' [context only]' : ''} ${v.text}`;
        if (v.footnotes && v.footnotes.length > 0) {
            entry += `\n   EXISTING FOOTNOTES:`;
            v.footnotes.forEach((fn, i) => {
                entry += `\n   [${fn.source}] ${fn.text}`;
            });
        }
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

    return `${PROOFREAD_PROMPT(language, style, textOnly, restoring)}

Book ID: ${bookId}, Chapter: ${chapterId}

Original text:
${originalText}

Current translation (with version history and existing footnotes where available):
${formattedTranslation}${targetIds ? `

This is a follow-up pass. Verses marked [context only] are there so you can judge flow,
connectives and pronoun reference — do NOT report issues on them. Report issues only on
the unmarked verses, which were changed in an earlier round and are being re-examined.` : ''}`;
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

    console.log(`${chapterLabel(bookId, chapterId)} — translating ${verses.length} verses in ${batches.length} batch(es)`);

    const allResults = [];

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        const batch = batches[batchIndex];
        console.log(`  ${chapterLabel(bookId, chapterId)} batch ${batchIndex + 1}/${batches.length} (${batch.length} verses)`);

        const formattedBatch = batch.map(v => `${v.verseId}: ${v.text}`).join("\n");
        const rejected = batch
            .map(v => {
                const attempts = rejectedAttempts(existingVerses, v.verseId);
                return attempts ? `Verse ${v.verseId}:\n${attempts}` : null;
            })
            .filter(Boolean)
            .join('\n');
        const content = getTranslationPrompt(style, language, bookId, chapterId, formattedBatch, rejected);
        const shouldValidate = !isEnglishLanguage(language);
        const result = await doAnthropicCallWithRetry(content, TRANSLATION_SCHEMA, `${bookId}:${chapterId} batch ${batchIndex + 1}`, shouldValidate);
        allResults.push(...result.verses);
    }

    const dir = path.dirname(filename);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, {recursive: true});
    }

    // Slå sammen på verseId: et vers som ble tømt av triage --drop har fortsatt en post
    // med versions/triage-historikk, og den skal beholdes når teksten kommer tilbake.
    const byId = new Map(existingVerses.map(v => [+v.verseId, v]));
    for (const fresh of allResults) {
        const record = byId.get(+fresh.verseId);
        byId.set(+fresh.verseId, record ? {...record, text: fresh.text} : fresh);
    }
    const finalResult = [...byId.values()].sort((a, b) => a.verseId - b.verseId);
    console.log("Writing", filename, `[${formatUsage()}]`);
    fs.writeFileSync(filename, JSON.stringify(finalResult, null, 2));
}

function estimateVerseSize(verse, originalVerse) {
    let size = 0;

    if (originalVerse) {
        size += `${originalVerse.verseId}: ${originalVerse.text}\n`.length;
    }

    size += `${verse.verseId}: ${verse.text}\n`.length;

    if (verse.footnotes && verse.footnotes.length > 0) {
        size += `   EXISTING FOOTNOTES:`.length;
        verse.footnotes.forEach(fn => {
            size += `\n   [${fn.source}] ${fn.text}`.length;
        });
    }

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

function getTextReviewPrompt(language, style, bookId, chapterId, verse, originalVerse, prevVerse, nextVerse, prevOriginal, nextOriginal, attempts) {
    const styleDescription = style === 'oral'
        ? 'optimized for oral reading with natural rhythm and flow'
        : 'modern and easy to read while being theologically correct';

    let context = '';
    if (prevVerse && prevOriginal) {
        context += `Previous verse (${prevVerse.verseId}):\n  Original: ${prevOriginal.text}\n  Translation: ${prevVerse.text}\n\n`;
    }
    context += `THIS VERSE (${verse.verseId}):\n  Original: ${originalVerse.text}\n  Translation: ${verse.text}\n`;
    if (verse.versions && verse.versions.length > 0) {
        context += `  VERSION HISTORY (${verse.versions.length} revisions - DO NOT suggest any of these):\n`;
        verse.versions.forEach((ver, i) => {
            const typeInfo = ver.type ? ` [${ver.type}/${ver.severity || 'unknown'}]` : '';
            context += `    ${i + 1}.${typeInfo} "${ver.text}"\n`;
            if (ver.explanation) context += `      Reason: ${ver.explanation}\n`;
        });
    }
    if (nextVerse && nextOriginal) {
        context += `\nNext verse (${nextVerse.verseId}):\n  Original: ${nextOriginal.text}\n  Translation: ${nextVerse.text}\n`;
    }
    if (attempts && attempts.length > 0) {
        context += `\nPREVIOUS REVIEW ATTEMPTS THIS SESSION (${attempts.length} so far):\n`;
        attempts.forEach((a, i) => {
            const change = a.suggested ? `proposed: "${a.suggested}"` : 'no change proposed';
            context += `  Round ${i + 1}: ${change} (done=${a.done}, score=${a.score})\n`;
            if (a.explanation) context += `    Reason: ${a.explanation}\n`;
        });
        context += `Only iterate further if there is genuine improvement to make. If the text is good, set done=true.\n`;
    }

    return `You are a Bible translation proofreader. Review the TEXT of ONE verse only. Footnotes are handled in a separate phase — do NOT touch them here.
Book ${bookId}, Chapter ${chapterId}, Verse ${verse.verseId}.
The translation should be ${language}, ${styleDescription}.

${context}

Review the TEXT of THIS VERSE and:
1. If there is an error or improvement, return it as "issue" with type, severity, suggested (ENTIRE corrected verse), explanation, and previousWasDefensible. If acceptable, set issue to null.
   previousWasDefensible: true if the current reading was a legitimate rendering of the source
   that a reader could reasonably choose, false if it was inaccurate or dropped/added content.
   Judge the current reading on its own merits, not by how much you prefer yours.
2. Set "done" to true when the text is satisfactory and no further iteration is needed. Set false if you want another round.
3. Score 0-10.

${verse.versions?.length >= 3 ? 'This verse has 3+ revisions — only suggest changes for CRITICAL errors.' : ''}
${verse.versions?.length ? 'NEVER suggest text matching any previous version.' : ''}
NEVER mention specific Bible editions, Bible societies, or publishers (e.g., "NIV", "ESV", "KJV", "Bibelen 2011", "Bibelselskapet"). Write neutrally without referencing specific translations or organizations.`;
}

function getFootnoteReviewPrompt(language, style, bookId, chapterId, verse, originalVerse, prevVerse, nextVerse, prevOriginal, nextOriginal, attempts) {
    const styleDescription = style === 'oral'
        ? 'optimized for oral reading with natural rhythm and flow'
        : 'modern and easy to read while being theologically correct';

    let context = '';
    if (prevVerse && prevOriginal) {
        context += `Previous verse (${prevVerse.verseId}):\n  Original: ${prevOriginal.text}\n  Translation: ${prevVerse.text}\n\n`;
    }
    context += `THIS VERSE (${verse.verseId}):\n  Original: ${originalVerse.text}\n  FINAL Translation (locked): ${verse.text}\n`;
    if (verse.footnotes && verse.footnotes.length > 0) {
        context += `  CURRENT FOOTNOTES:\n`;
        verse.footnotes.forEach(fn => { context += `    [${fn.source}] ${fn.text}\n`; });
    }
    if (nextVerse && nextOriginal) {
        context += `\nNext verse (${nextVerse.verseId}):\n  Original: ${nextOriginal.text}\n  Translation: ${nextVerse.text}\n`;
    }
    if (attempts && attempts.length > 0) {
        context += `\nPREVIOUS FOOTNOTE ATTEMPTS THIS SESSION (${attempts.length} so far):\n`;
        attempts.forEach((a, i) => {
            context += `  Round ${i + 1} (done=${a.done}, score=${a.score}):\n`;
            (a.footnotes || []).forEach(fn => {
                const preview = fn.text.length > 120 ? fn.text.substring(0, 120) + '...' : fn.text;
                context += `    [${fn.source}] ${preview}\n`;
            });
        });
        context += `Refine the footnotes — fix duplications, sharpen explanations, fill genuine gaps. Don't just repeat what you already wrote. If they are good, set done=true.\n`;
    }

    return `You are a Bible translation proofreader. Review the FOOTNOTES for ONE verse. The translation TEXT is FINAL and must NOT be changed — focus only on footnotes.
Book ${bookId}, Chapter ${chapterId}, Verse ${verse.verseId}.
The translation is ${language}, ${styleDescription}.

${context}

Provide footnotes that explain the verse. Source categories — do not overlap:
   - oversettelse: REQUIRED — explain why the translation reads the way it does. What choices were made, what alternatives exist.
   - lingvistisk: About the original language — etymology, wordplay, grammar, idioms.
   - teologisk: Theological discussion — different interpretations, doctrinal weight.
   - historisk: Historical/cultural background.
   - tekstkritisk: Manuscript variants.
   - liturgisk: Liturgical usage.
The footnote text can be multiple sentences — be thorough. Always include at least one «oversettelse» footnote.
Write all footnote text in ${language}, the same language as the translation.
The category names (oversettelse, lingvistisk, teologisk, historisk, tekstkritisk, liturgisk, annet) are fixed identifiers shared across all translations — use them exactly as given, never translated.

Return the FULL final set of footnotes (will replace existing ones entirely). Set "done" to true when satisfied with the footnotes; set false if you want another round to refine. Score 0-10.

NEVER mention specific Bible editions, Bible societies, or publishers (e.g., "NIV", "ESV", "KJV", "Bibelen 2011", "Bibelselskapet"). Write neutrally without referencing specific translations or organizations.`;
}

async function proofreadChapterPerVerse(bible, bookId, chapterId, style, filename, options = {}) {
    const language = bibles[bible];
    const skipExisting = !!options.skipExisting;
    const textOnly = !!options.textOnly;
    const maxIter = options.maxIter || 3;
    const verseStart = options.verseStart ?? null;
    const verseEnd = options.verseEnd ?? null;

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

    const inVerseScope = (vid) => verseStart === null || (+vid >= verseStart && +vid <= verseEnd);

    // Hva som teller som "allerede gjort" avhenger av modus: i --text-only skrives
    // ingen fotnoter, så tekstfasen setter textChecked som gjenopptakelsesmarkør.
    const isDone = (v) => textOnly
        ? !!v.textChecked
        : (v.footnotes && v.footnotes.length > 0);

    let versesToProcess = translatedVerses.filter(v => inVerseScope(v.verseId));
    if (skipExisting) {
        versesToProcess = versesToProcess.filter(v => !isDone(v));
    }

    const scopeLabel = verseStart !== null
        ? (verseStart === verseEnd ? `verse ${verseStart}` : `verses ${verseStart}-${verseEnd}`)
        : `${translatedVerses.length} verses`;
    const skippedNote = skipExisting && versesToProcess.length < translatedVerses.length
        ? `, --skip-existing active`
        : '';
    console.log(`${chapterLabel(bookId, chapterId)} — proofreading (${scopeLabel}, ${textOnly ? 'text only' : 'two-phase'} per-verse, max ${maxIter} iter/phase${skippedNote})`);

    if (versesToProcess.length === 0) {
        console.log(`  Nothing to do — skipping`);
        return { issues: [], footnotes: [], score: 10, appliedCount: 0, footnoteCount: 0 };
    }

    const allIssues = [];
    const allFootnotes = [];
    const scores = [];
    let appliedCount = 0;
    let footnoteCount = 0;
    const shouldValidate = !isEnglishLanguage(language);
    const lastVerseId = translatedVerses[translatedVerses.length - 1].verseId;

    for (let i = 0; i < translatedVerses.length; i++) {
        const verse = translatedVerses[i];
        if (!inVerseScope(verse.verseId)) continue;
        if (skipExisting && isDone(verse)) continue;

        const originalVerse = originalVerses.find(v => +v.verseId === +verse.verseId);
        if (!originalVerse) continue;

        const prevVerse = i > 0 ? translatedVerses[i - 1] : null;
        const nextVerse = i < translatedVerses.length - 1 ? translatedVerses[i + 1] : null;
        const prevOriginal = prevVerse ? originalVerses.find(v => +v.verseId === +prevVerse.verseId) : null;
        const nextOriginal = nextVerse ? originalVerses.find(v => +v.verseId === +nextVerse.verseId) : null;

        let verseScore = null;

        // Phase 1: TEXT iteration
        const textAttempts = [];
        for (let round = 1; round <= maxIter; round++) {
            process.stdout.write(`\r  Verse ${verse.verseId}/${lastVerseId} text r${round}${''.padEnd(20)}`);
            const prompt = getTextReviewPrompt(language, style, bookId, chapterId, verse, originalVerse, prevVerse, nextVerse, prevOriginal, nextOriginal, textAttempts);
            try {
                const result = await doAnthropicCallWithRetry(prompt, TEXT_REVIEW_SCHEMA, `proofread ${bookId}:${chapterId}:${verse.verseId} text r${round}`, shouldValidate);
                textAttempts.push({
                    suggested: result.issue?.suggested || null,
                    explanation: result.issue?.explanation || null,
                    done: !!result.done,
                    score: result.score
                });
                if (result.score !== null && result.score !== undefined) verseScore = result.score;

                const evaluated = result.issue?.suggested
                    ? evaluateSuggestion(verse.text, result.issue.suggested)
                    : {ratio: 1, newText: verse.text, dropsMarker: false};
                if (result.issue?.suggested && evaluated.ratio < MIN_LENGTH_RATIO) {
                    console.warn(`\n  Verse ${verse.verseId}: rejected suggestion at ${Math.round(evaluated.ratio * 100)}% of current body length (footnotes excluded) — likely truncated`);
                } else if (result.issue?.suggested && evaluated.dropsMarker) {
                    console.warn(`\n  Verse ${verse.verseId}: rejected suggestion — dropped inline footnote marker`);
                } else if (result.issue && result.issue.suggested && evaluated.newText !== verse.text) {
                    if (!verse.versions) verse.versions = [];
                    verse.versions.push({
                        text: verse.text,
                        type: result.issue.type,
                        severity: result.issue.severity,
                        explanation: result.issue.explanation,
                        // Begge slags versjoner må bli liggende — de er det som hindrer at
                        // korrekturen svinger tilbake — men bare alternativene vises for leseren.
                        alternative: result.issue.previousWasDefensible === true
                    });
                    verse.text = evaluated.newText;
                    appliedCount++;
                    allIssues.push({ verseId: verse.verseId, ...result.issue });
                }

                if (result.done) break;
            } catch (error) {
                console.warn(`\n  Error on verse ${verse.verseId} text r${round}: ${error.message}`);
                break;
            }
        }

        verse.textChecked = true;

        // Phase 2: FOOTNOTE iteration (against final text from phase 1)
        const footnoteAttempts = [];
        for (let round = 1; !textOnly && round <= maxIter; round++) {
            process.stdout.write(`\r  Verse ${verse.verseId}/${lastVerseId} footnote r${round}${''.padEnd(20)}`);
            const prompt = getFootnoteReviewPrompt(language, style, bookId, chapterId, verse, originalVerse, prevVerse, nextVerse, prevOriginal, nextOriginal, footnoteAttempts);
            try {
                const result = await doAnthropicCallWithRetry(prompt, FOOTNOTE_REVIEW_SCHEMA, `proofread ${bookId}:${chapterId}:${verse.verseId} fn r${round}`, shouldValidate);
                footnoteAttempts.push({
                    footnotes: result.footnotes,
                    done: !!result.done,
                    score: result.score
                });

                if (result.footnotes && result.footnotes.length > 0) {
                    verse.footnotes = result.footnotes;
                }

                if (result.done) break;
            } catch (error) {
                console.warn(`\n  Error on verse ${verse.verseId} footnote r${round}: ${error.message}`);
                break;
            }
        }

        if (verseScore !== null) scores.push(verseScore);
        if (verse.footnotes) {
            footnoteCount += verse.footnotes.length;
            for (const fn of verse.footnotes) allFootnotes.push({ verseId: verse.verseId, ...fn });
        }

        // Save after each verse so progress is preserved on Ctrl+C
        fs.writeFileSync(filename, JSON.stringify(translatedVerses, null, 2));
    }

    process.stdout.write('\r' + ''.padEnd(60) + '\r');
    const avgScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;

    console.log(`  Score: ${avgScore}/10 | Changes: ${appliedCount} | Footnotes: ${footnoteCount}`);
    if (allIssues.length > 0) {
        allIssues.forEach((issue, i) => {
            console.log(`    ${i + 1}. [${issue.severity}] Verse ${issue.verseId}: ${issue.type} — ${issue.explanation}`);
        });
    }

    return {
        issues: allIssues,
        footnotes: allFootnotes,
        score: avgScore,
        appliedCount,
        footnoteCount
    };
}

async function proofreadChapter(bible, bookId, chapterId, style, filename, saveToFile = true, textOnly = false, changedTypes = null, checkLength = null) {
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

    // Andre runde: et vers som ikke ble endret første gang er som regel greit, mens et
    // som ble endret — særlig med type error — er der tvilen ligger. changedTypes
    // begrenser gjennomgangen til dem, og lar resten av kapittelet være.
    let versesToReview = translatedVerses;
    let targetIds = null;
    if (changedTypes || checkLength) {
        const targets = translatedVerses.filter(v => {
            const versions = v.versions || [];
            if (!versions.length) return false;

            if (checkLength) {
                // Gjeldende tekst vesentlig kortere enn det lengste verset har vært:
                // en tidligere runde returnerte trolig bare frasen den festet seg ved.
                const longest = Math.max(...versions.map(x => x.text.length), v.text.length);
                if (!(longest > 0 && v.text.length / longest < checkLength)) return false;
                return !alreadyCleared(v, 'length');
            }

            const last = versions.at(-1);
            if (changedTypes.length !== 0 && !changedTypes.includes(last.type)) return false;
            return !alreadyCleared(v, 'changed');
        });
        if (targets.length === 0) return null;

        // Naboene må være med. Flyt, bindeord og pronomen kan ikke vurderes på et vers
        // som står alene — det var nettopp den feilklassen forrige runde fant.
        targetIds = new Set(targets.map(v => +v.verseId));
        const keep = new Set();
        for (const v of targets) {
            const i = translatedVerses.findIndex(x => +x.verseId === +v.verseId);
            for (const j of [i - 1, i, i + 1]) {
                if (j >= 0 && j < translatedVerses.length) keep.add(+translatedVerses[j].verseId);
            }
        }
        versesToReview = translatedVerses.filter(v => keep.has(+v.verseId));
    }

    let batches = createProofreadBatches(versesToReview, originalVerses);
    // Tegnbudsjettet kan skille et målvers fra naboene sine. En batch som bare inneholder
    // kontekst har ingenting å rapportere — hopp over den i stedet for å betale for kallet.
    if (targetIds) {
        batches = batches.filter(b => b.some(v => targetIds.has(+v.verseId)));
        if (batches.length === 0) return null;
    }

    console.log(`${chapterLabel(bookId, chapterId)} — proofreading ${targetIds ? `${targetIds.size} verses (+${versesToReview.length - targetIds.size} context)` : `${versesToReview.length} verses`} in ${batches.length} batch(es)`);

    const allIssues = [];
    const allFootnotes = [];
    const summaries = [];
    const scores = [];

    // Process batches with automatic splitting on timeout
    const queue = batches.map((batch, i) => ({ batch, label: `${i + 1}/${batches.length}` }));

    while (queue.length > 0) {
        const { batch, label } = queue.shift();
        const batchVerseIds = batch.map(v => v.verseId);
        const batchOriginal = originalVerses.filter(v => batchVerseIds.includes(+v.verseId));

        if (batches.length > 1 || label.includes('/')) {
            console.log(`  Batch ${label}: verses ${batchVerseIds[0]}-${batchVerseIds[batchVerseIds.length - 1]} (${batch.length} verses)`);
        }

        const formattedOriginal = batchOriginal.map(v => `${v.verseId}: ${v.text}`).join("\n");
        const content = getProofreadPrompt(language, style, bookId, chapterId, formattedOriginal, batch, textOnly, targetIds, checkLength);
        const shouldValidate = !isEnglishLanguage(language);

        try {
            const batchResult = await doAnthropicCallWithRetry(content, textOnly ? PROOFREAD_TEXT_SCHEMA : PROOFREAD_SCHEMA, `proofread ${bookId}:${chapterId} batch ${label}`, shouldValidate);

            if (batchResult.issues) {
                allIssues.push(...batchResult.issues);
            }
            if (batchResult.footnotes) {
                allFootnotes.push(...batchResult.footnotes);
            }
            if (batchResult.summary) {
                summaries.push(batchResult.summary);
            }
            if (batchResult.score !== null && batchResult.score !== undefined) {
                // En modell som svarer på en annen skala (89 for 8.9, eller prosent) ville
                // ellers passere terskelen og avslutte tilbakemeldingssløyfen etter én runde.
                const raw = batchResult.score;
                scores.push(raw > 10 ? Math.round(raw / 10) : raw);
            }
        } catch (error) {
            if (error.message.includes('timed out') || error.message.includes('timeout') || error.message.includes('max_tokens')) {
                if (batch.length <= 2) {
                    console.error(`  Batch ${label} failed even with ${batch.length} verses, skipping`);
                    continue;
                }
                const mid = Math.ceil(batch.length / 2);
                console.log(`  Batch ${label} timed out with ${batch.length} verses — splitting into two smaller batches`);
                queue.unshift(
                    { batch: batch.slice(mid), label: `${label}b` },
                    { batch: batch.slice(0, mid), label: `${label}a` }
                );
            } else {
                throw error;
            }
        }
    }

    const flagged = new Set(allIssues.map(i => +i.verseId));
    let result = {
        clearedTargets: targetIds ? [...targetIds].filter(id => !flagged.has(id)) : [],
        issues: allIssues,
        footnotes: allFootnotes,
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
    if (result.footnotes && result.footnotes.length > 0) {
        console.log(`Footnotes: ${result.footnotes.length}`);
        result.footnotes.forEach((fn, i) => {
            console.log(`  ${i + 1}. Verse ${fn.verseId} [${fn.source}]: ${fn.text.substring(0, 80)}${fn.text.length > 80 ? '...' : ''}`);
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
    const hasIssues = proofreadResult.issues && proofreadResult.issues.length > 0;
    const hasFootnotes = proofreadResult.footnotes && proofreadResult.footnotes.length > 0;

    if (!hasIssues && !hasFootnotes) {
        return;
    }

    let appliedCount = 0;
    let footnoteCount = 0;
    let rejected = 0;

    if (hasIssues) {
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

            const {ratio, newText, dropsMarker} = evaluateSuggestion(verse.text, issue.suggested);
            if (ratio < MIN_LENGTH_RATIO) {
                console.log(`  REJECTED: Verse ${issue.verseId} — suggestion body is ${Math.round(ratio * 100)}% of the current body length (footnotes excluded); likely a truncated verse, not a correction`);
                rejected++;
                continue;
            }
            if (dropsMarker) {
                console.log(`  REJECTED: Verse ${issue.verseId} — suggestion dropped the inline footnote marker; applying it would orphan the footnote`);
                rejected++;
                continue;
            }
            if (newText === verse.text) {
                continue;
            }

            if (!verse.versions) {
                verse.versions = [];
            }

            verse.versions.push({
                text: verse.text,
                type: issue.type,
                severity: issue.severity,
                explanation: issue.explanation,
                // Avgjør om leseren får se den forrige lesningen som et gyldig alternativ.
                // type-feltet duger ikke til dette: 72% av «suggestion» viste seg å ha
                // grunntekstargument, så etiketten skiller ikke forsvarlig fra unøyaktig.
                // En tekst som blir erstattet av noe vesentlig lengre er et fragment som
                // mistet innhold — den kan aldri være et gyldig valg, uansett hva modellen sier.
                alternative: issue.previousWasDefensible === true && ratio < (1 / MIN_LENGTH_RATIO)
            });

            verse.text = newText;
            appliedCount++;

            console.log(`  Applied: Verse ${issue.verseId} [${issue.type}/${issue.severity}]`);
        }
    }

    if (hasFootnotes) {
        // Group new footnotes by verseId
        const footnotesByVerse = {};
        for (const fn of proofreadResult.footnotes) {
            if (!footnotesByVerse[fn.verseId]) footnotesByVerse[fn.verseId] = [];
            footnotesByVerse[fn.verseId].push({ text: fn.text, source: fn.source });
        }

        // Replace all footnotes for each verse that has new ones
        for (const [verseId, newFootnotes] of Object.entries(footnotesByVerse)) {
            const verse = verses.find(v => +v.verseId === +verseId);
            if (!verse) continue;

            const oldCount = verse.footnotes?.length || 0;
            verse.footnotes = newFootnotes;
            footnoteCount += newFootnotes.length - oldCount;
        }
    }

    if (rejected > 0 && appliedCount === 0 && footnoteCount === 0) {
        console.log(`Rejected ${rejected} truncated suggestion(s) in ${bookId}:${chapterId}, nothing applied`);
    }
    if (appliedCount > 0 || footnoteCount > 0) {
        fs.writeFileSync(filename, JSON.stringify(verses, null, 2));
        const parts = [];
        if (appliedCount > 0) parts.push(`${appliedCount} changes`);
        if (rejected > 0) parts.push(`${rejected} rejected as truncated`);
        if (footnoteCount > 0) parts.push(`${footnoteCount} footnotes`);
        console.log(`Applied ${parts.join(', ')} to ${bookId}:${chapterId}`);
    }

    return { appliedCount, footnoteCount, rejected };
}

/**
 * Per-chapter proofread state: the score it reached, how many rounds it took, and
 * whether it converged or simply ran out of rounds. Nothing recorded this before, so a
 * run with --max-iter 2 could leave chapters below the threshold with no trace of which.
 *
 * The signature is verse count + total text length, so any later change to the chapter
 * invalidates the record and it gets looked at again.
 */
function stateFile(bible) {
    return `proofread/${bible}/state.json`;
}

function readState(bible) {
    const f = stateFile(bible);
    if (!fs.existsSync(f)) return {};
    try {
        return JSON.parse(fs.readFileSync(f, 'utf-8'));
    } catch {
        return {};
    }
}

function chapterSignature(filename) {
    if (!fs.existsSync(filename)) return null;
    const verses = JSON.parse(fs.readFileSync(filename, 'utf-8'));
    return `${verses.length}:${verses.reduce((n, v) => n + (v.text || '').length, 0)}`;
}

function writeState(bible, key, record) {
    const f = stateFile(bible);
    fs.mkdirSync(path.dirname(f), {recursive: true});
    const state = readState(bible);
    state[key] = record;
    fs.writeFileSync(f, JSON.stringify(state, null, 2));
}

/**
 * Batch proofread with a feedback loop — the method behind osnb.
 *
 * proofreadChapter sends the chapter in a few large batches and gets back only the
 * issues it found; applyProofreadChanges writes them and records the replaced text in
 * versions[]. Repeat until the chapter scores at least minScore or the rounds run out.
 * Keeping versions[] is what stops a later round swinging the text back again.
 */
async function proofreadChapterBatched(bible, bookId, chapterId, style, filename, {minScore = 8, maxIterations = 3, textOnly = false, changedTypes = null, checkLength = null, force = false} = {}) {
    const key = `${bookId}:${chapterId}`;
    const signature = chapterSignature(filename);

    // Et kapittel som allerede har nådd terskelen og er uendret siden, skal ikke kjøres
    // om igjen. Det er dette som gjør en full gjenkjøring billig etter første pass.
    if (!force && !changedTypes && !checkLength) {
        const prior = readState(bible)[key];
        if (prior?.signature === signature && prior.converged && prior.score >= minScore) return null;
    }

    let last = null;
    for (let round = 1; round <= maxIterations; round++) {
        const result = await proofreadChapter(bible, bookId, chapterId, style, filename, false, textOnly, changedTypes, checkLength);
        if (!result) return null;

        const applied = applyProofreadChanges(bible, bookId, chapterId, filename, result);
        const changes = applied?.appliedCount || 0;

        const mode = checkLength ? 'length' : (changedTypes ? 'changed' : null);
        if (mode && result.clearedTargets?.length) {
            const verses = JSON.parse(fs.readFileSync(filename, 'utf-8'));
            let marked = 0;
            for (const id of result.clearedTargets) {
                const verse = verses.find(v => +v.verseId === +id);
                if (verse && !alreadyCleared(verse, mode)) {
                    verse.checked = {...verse.checked, [mode]: reviewSignature(verse)};
                    marked++;
                }
            }
            if (marked) {
                fs.writeFileSync(filename, JSON.stringify(verses, null, 2));
                console.log(`  ${chapterLabel(bookId, chapterId)}: ${marked} verse(s) cleared — won't be re-checked unless the text changes`);
            }
        }

        console.log(`  ${chapterLabel(bookId, chapterId)} round ${round}: score ${result.score ?? '?'}/10, ${changes} changes [${formatUsage()}]`);

        last = result;
        const converged = !changes || (result.score !== null && result.score >= minScore);
        if (converged || round === maxIterations) {
            writeState(bible, key, {
                score: result.score,
                rounds: round,
                converged,
                signature: chapterSignature(filename),
                at: new Date().toISOString()
            });
            if (!converged) {
                console.log(`  ${chapterLabel(bookId, chapterId)}: ran out of rounds at score ${result.score}/10 — not converged`);
            }
            return converged ? result : null;
        }
    }
    return last;
}

function printUsage() {
    console.log(`
Usage: node bible_test.mjs <bible> [options]

Arguments:
  bible              Bible version to work with (e.g., osnb, osnn, osen)

Options:
  --style <type>     Translation style: standard, oral (default: standard)
  --proofread        Run proofreading after translation (can combine with translation)
  --apply            Apply proofread suggestions (enables feedback loop)
  --batch            Proofread the chapter in batches with a feedback loop (osnb's method)
  --check-length [r] Re-check verses whose text is now much shorter than an earlier version
                     (default ratio 0.85) — catches revisions that dropped verse content
  --changed-only [t] Second pass: review only verses already changed. Optional comma list
                     of types to narrow further, e.g. --changed-only error,grammar
  --text-only        Proofread text only, skip the footnote phase (much cheaper)
  --skip-existing    Skip verses already done (footnotes present, or textChecked in --text-only)
  --min-score <n>    Minimum acceptable score (default: 8, range 0-10)
  --max-iter <n>     Max proofread iterations per phase, per verse (default: 3)
  --ot               Process only Old Testament (books 1-39)
  --nt               Process only New Testament (books 40-66)
  --book <range>     Process book(s): single (43) or range (1-20)
  --chapter <range>  Process chapter(s): single (1) or range (1-10)
  --verse <range>    Proofread only verse(s): single (5) or range (5-7) — skips translation
  --force            Force re-translation even if file exists
  --help             Show this help message

Examples:
  node bible_test.mjs osnb --style oral --nt
  node bible_test.mjs osnb --book 43 --chapter 1-11
  node bible_test.mjs osnb --nt --proofread --apply
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
        style: null,          // null = slå opp fra bibelen; --style overstyrer
        proofread: false,
        apply: false,
        skipExisting: false,
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

        if (arg === '--style' && i + 1 < args.length) {
            options.style = args[++i];
        } else if (arg === '--proofread') {
            options.proofread = true;
        } else if (arg === '--apply') {
            options.apply = true;
        } else if (arg === '--skip-existing') {
            options.skipExisting = true;
        } else if (arg === '--changed-only') {
            // valgfri liste: --changed-only error,grammar
            const next = args[i + 1];
            options.changedTypes = next && !next.startsWith('--') ? args[++i].split(',') : [];
        } else if (arg === '--check-length') {
            const next = args[i + 1];
            options.checkLength = next && !next.startsWith('--') ? parseFloat(args[++i]) : 0.85;
        } else if (arg === '--batch') {
            options.batch = true;
        } else if (arg === '--text-only') {
            options.textOnly = true;
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
        } else if (arg === '--min-score' && i + 1 < args.length) {
            options.minScore = parseInt(args[++i], 10);
        } else if (arg === '--max-iter' && i + 1 < args.length) {
            options.maxIterations = parseInt(args[++i], 10);
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

    if (!options.style) {
        options.style = getBibleStyle(options.bible);
        options.styleFromBible = true;
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
    console.log(`Model: ${anthropicModel}`);
    console.log(`Style: ${options.style}${options.styleFromBible ? ' (from bible config)' : ' (from --style)'}`);
    console.log(`Mode: ${modes.join(' → ')}`);
    if (options.proofread && options.apply) {
        console.log(`Feedback loop: min score ${options.minScore || 8}/10, max ${options.maxIterations || 3} iterations`);
    }
    console.log(`Books: ${startBook}-${endBook}`);
    if (options.chapterStart !== null) {
        console.log(`Chapters: ${options.chapterStart}-${options.chapterEnd}`);
    }
    console.log('---');

    const failed = [];

    for (let bookId = startBook; bookId <= endBook; bookId++) {
        const book = books.find(b => b.id === bookId);
        if (!book) continue;

        const maxChapters = book.chapters;
        const startChapter = options.chapterStart || 1;
        const endChapter = Math.min(options.chapterEnd || maxChapters, maxChapters);

        for (let chapterId = startChapter; chapterId <= endChapter; chapterId++) {
            const dir = `bibles_raw/${options.bible}/${bookId}`;
            const filename = `${dir}/${chapterId}.json`;

            const verseScopeActive = options.verseStart !== null;

            if (!verseScopeActive) {
                let existingVerses = [];
                if (fs.existsSync(filename) && !options.force) {
                    existingVerses = JSON.parse(fs.readFileSync(filename, 'utf-8'));
                }
                await translateChapter(options.bible, bookId, chapterId, options.style, existingVerses, filename);
            }

            try {
            if (options.proofread && options.batch) {
                // Batch mode: the whole chapter goes in a few calls, and only the issues
                // come back — not a verdict per verse. This is the method that produced
                // osnb (99% of its chapters predate per-verse mode), run as a feedback
                // loop until the chapter scores well enough or the rounds run out.
                await proofreadChapterBatched(options.bible, bookId, chapterId, options.style, filename, {
                    minScore: options.minScore || 8,
                    maxIterations: options.maxIterations || 3,
                    textOnly: options.textOnly,
                    changedTypes: options.changedTypes,
                    checkLength: options.checkLength,
                    force: options.force
                });
            } else if (options.proofread) {
                // Per-verse mode: proofread each verse individually with neighbor context
                // Two phases: (1) iterate text, (2) iterate footnotes against final text
                // Applies changes and footnotes directly — no separate apply step needed
                await proofreadChapterPerVerse(options.bible, bookId, chapterId, options.style, filename, {
                    skipExisting: options.skipExisting,
                    textOnly: options.textOnly,
                    maxIter: options.maxIterations,
                    verseStart: options.verseStart,
                    verseEnd: options.verseEnd
                });
            }
            } catch (error) {
                // En kjøring over mange kapitler skal ikke gå tapt fordi ett kapittel feilet.
                // Alt som er skrevet så langt ligger på disk, og --skip-existing eller
                // merkene i versdataene gjør at en ny kjøring tar igjen det som mangler.
                failed.push(`${chapterLabel(bookId, chapterId)}`);
                console.error(`\n${chapterLabel(bookId, chapterId)} FAILED: ${(error.message || error).toString().slice(0, 160)}`);
                console.error(`  continuing with the next chapter — re-run to pick this one up\n`);
            }
        }
    }

    console.log(`Done! Usage: ${formatUsage()}`);
    if (failed.length) {
        console.log(`\n${failed.length} chapter(s) failed and were skipped:`);
        for (const f of failed) console.log(`  ${f}`);
        console.log(`Re-run the same command to pick them up.`);
        process.exitCode = 1;
    }
}

main().catch(console.error);
