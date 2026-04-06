import dotenv from 'dotenv'
import * as fs from 'fs';
import path from 'path';

dotenv.config()

import Anthropic from '@anthropic-ai/sdk';
import {bibles, books, anthropicModel, maxTokens} from "./constants.js";

const anthropic = new Anthropic();

const MAX_VERSES_PER_BATCH = 100;
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
                    explanation: {type: "string"}
                },
                required: ["verseId", "type", "severity", "original", "current", "suggested", "explanation"],
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

// Per-verse proofread schema (simpler, no verseId needed)
const VERSE_PROOFREAD_SCHEMA = {
    type: "object",
    properties: {
        issue: {
            type: ["object", "null"],
            properties: {
                type: {type: "string", enum: ["error", "suggestion", "theological", "grammar"]},
                severity: {type: "string", enum: ["critical", "major", "minor"]},
                suggested: {type: "string"},
                explanation: {type: "string"}
            },
            required: ["type", "severity", "suggested", "explanation"],
            additionalProperties: false
        },
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
        score: {type: "integer"}
    },
    required: ["issue", "footnotes", "score"],
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

You should also suggest FOOTNOTES for verses where there are interesting details that enrich the reader's understanding but don't belong in the translation text itself. The source categories have distinct purposes — do not overlap:
- oversettelse: REQUIRED FOR EVERY VERSE — explain why the current translation reads the way it does. Every verse involves translation choices: word selection, word order, how idioms are rendered, what nuance was prioritized. For example: why «Rabbi» is kept untranslated, why «tegn» rather than «mirakler» for σημεῖα, why a particular sentence structure was chosen. These notes help the reader understand what they are reading and what alternatives exist.
- lingvistisk: About the original language itself — etymology, wordplay, grammar, idioms in Hebrew/Greek that enrich understanding regardless of how it was translated.
- teologisk: Theological discussion — different doctrinal interpretations, how traditions disagree, what theological weight a passage carries.
- historisk: Historical or cultural background — customs, places, events that illuminate the text.
- tekstkritisk: Manuscript variants — differences between textual witnesses, which readings are better attested.
- liturgisk: Liturgical usage — how the passage is used in worship, church calendar, or prayer traditions.
Each footnote has: verseId, text (the footnote content), source (one of: oversettelse, lingvistisk, teologisk, historisk, tekstkritisk, liturgisk, annet).
The footnote text can be multiple sentences — be thorough.
Every verse MUST have at least one «oversettelse» footnote. The other categories are optional and should only be added where they genuinely add value.

IMPORTANT:
- The "suggested" field must contain the ENTIRE corrected verse, not just the changed phrase.
- Some verses have VERSION HISTORY showing previous revisions. Read the history carefully.
- NEVER suggest text that matches or is similar to ANY previous version in the history.
- NEVER undo a change that was intentionally made (check the "Reason for change").
- If a verse has 3+ revisions, it has been extensively reviewed - only suggest changes for CRITICAL errors.
- If the current version is acceptable, SKIP that verse entirely - do not include it in issues.
- Focus only on verses WITHOUT version history, or verses with genuine new errors.
- Some verses may already have footnotes. Review existing footnotes and only suggest new ones if they add value. Do not duplicate existing footnotes.
- NEVER mention specific Bible editions, Bible societies, or publishers (e.g., "NIV", "ESV", "KJV", "Bibelen 2011", "Bibelselskapet"). Write neutrally without referencing specific translations or organizations.

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

    return `${PROOFREAD_PROMPT(language, style)}

Book ID: ${bookId}, Chapter: ${chapterId}

Original text:
${originalText}

Current translation (with version history and existing footnotes where available):
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

function getVerseProofreadPrompt(language, style, bookId, chapterId, verse, originalVerse, prevVerse, nextVerse, prevOriginal, nextOriginal) {
    const styleDescription = style === 'oral'
        ? 'optimized for oral reading with natural rhythm and flow'
        : 'modern and easy to read while being theologically correct';

    let context = '';
    if (prevVerse && prevOriginal) {
        context += `Previous verse (${prevVerse.verseId}):\n  Original: ${prevOriginal.text}\n  Translation: ${prevVerse.text}\n\n`;
    }
    context += `THIS VERSE (${verse.verseId}):\n  Original: ${originalVerse.text}\n  Translation: ${verse.text}\n`;
    if (verse.footnotes && verse.footnotes.length > 0) {
        context += `  EXISTING FOOTNOTES:\n`;
        verse.footnotes.forEach(fn => { context += `    [${fn.source}] ${fn.text}\n`; });
    }
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

    return `You are a Bible translation proofreader. Review ONE verse.
Book ${bookId}, Chapter ${chapterId}, Verse ${verse.verseId}.
The translation should be ${language}, ${styleDescription}.

${context}

Review the translation of THIS VERSE and:
1. If there is an error, return it as "issue" with type, severity, suggested (ENTIRE corrected verse), explanation. If acceptable, set issue to null.
2. Provide footnotes. The source categories have distinct purposes — do not overlap:
   - oversettelse: REQUIRED — explain why the translation reads the way it does. What choices were made, what alternatives exist.
   - lingvistisk: About the original language — etymology, wordplay, grammar, idioms.
   - teologisk: Theological discussion — different interpretations, doctrinal weight.
   - historisk: Historical/cultural background.
   - tekstkritisk: Manuscript variants.
   - liturgisk: Liturgical usage.
   The footnote text can be multiple sentences. Always include at least one «oversettelse» footnote.
   ${verse.footnotes?.length ? 'Existing footnotes are shown above. Replace them with improved versions if needed, or keep them as-is by returning them unchanged.' : ''}
3. Score 0-10.

${verse.versions?.length >= 3 ? 'This verse has 3+ revisions — only suggest changes for CRITICAL errors.' : ''}
${verse.versions?.length ? 'NEVER suggest text matching any previous version.' : ''}
NEVER mention specific Bible editions, Bible societies, or publishers (e.g., "NIV", "ESV", "KJV", "Bibelen 2011", "Bibelselskapet"). Write neutrally without referencing specific translations or organizations.`;
}

async function proofreadChapterPerVerse(bible, bookId, chapterId, style, filename) {
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

    // Skip verses that already have footnotes (allows resuming after Ctrl+C)
    const versesNeedingProofread = translatedVerses.filter(v => !v.footnotes || v.footnotes.length === 0);
    const skipped = translatedVerses.length - versesNeedingProofread.length;

    if (skipped > 0) {
        console.log(`Proofreading ${bookId}:${chapterId} (${versesNeedingProofread.length} of ${translatedVerses.length} verses, ${skipped} already done)`);
    } else {
        console.log(`Proofreading ${bookId}:${chapterId} (${translatedVerses.length} verses, per-verse mode)`);
    }

    if (versesNeedingProofread.length === 0) {
        console.log(`  All verses already proofread — skipping`);
        return { issues: [], footnotes: [], score: 10, appliedCount: 0, footnoteCount: 0 };
    }

    const allIssues = [];
    const allFootnotes = [];
    const scores = [];
    let appliedCount = 0;
    let footnoteCount = 0;

    for (let i = 0; i < translatedVerses.length; i++) {
        const verse = translatedVerses[i];

        // Skip already proofread verses
        if (verse.footnotes && verse.footnotes.length > 0) continue;

        const originalVerse = originalVerses.find(v => +v.verseId === +verse.verseId);
        if (!originalVerse) continue;

        const prevVerse = i > 0 ? translatedVerses[i - 1] : null;
        const nextVerse = i < translatedVerses.length - 1 ? translatedVerses[i + 1] : null;
        const prevOriginal = prevVerse ? originalVerses.find(v => +v.verseId === +prevVerse.verseId) : null;
        const nextOriginal = nextVerse ? originalVerses.find(v => +v.verseId === +nextVerse.verseId) : null;

        const prompt = getVerseProofreadPrompt(language, style, bookId, chapterId, verse, originalVerse, prevVerse, nextVerse, prevOriginal, nextOriginal);
        const shouldValidate = !isEnglishLanguage(language);

        process.stdout.write(`\r  Verse ${verse.verseId}/${translatedVerses[translatedVerses.length - 1].verseId}${''.padEnd(20)}`);

        try {
            const result = await doAnthropicCallWithRetry(prompt, VERSE_PROOFREAD_SCHEMA, `proofread ${bookId}:${chapterId}:${verse.verseId}`, shouldValidate);

            if (result.score !== null && result.score !== undefined) {
                scores.push(result.score);
            }

            // Apply issue directly
            if (result.issue && result.issue.suggested && result.issue.suggested !== verse.text) {
                if (!verse.versions) verse.versions = [];
                verse.versions.push({
                    text: verse.text,
                    type: result.issue.type,
                    severity: result.issue.severity,
                    explanation: result.issue.explanation
                });
                verse.text = result.issue.suggested;
                appliedCount++;

                allIssues.push({
                    verseId: verse.verseId,
                    ...result.issue
                });
            }

            // Apply footnotes directly (replace for this verse)
            if (result.footnotes && result.footnotes.length > 0) {
                verse.footnotes = result.footnotes;
                footnoteCount += result.footnotes.length;

                for (const fn of result.footnotes) {
                    allFootnotes.push({ verseId: verse.verseId, ...fn });
                }
            }

            // Save after each verse so progress is preserved on Ctrl+C
            fs.writeFileSync(filename, JSON.stringify(translatedVerses, null, 2));
        } catch (error) {
            console.warn(`\n  Error on verse ${verse.verseId}: ${error.message}`);
        }
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
        const content = getProofreadPrompt(language, style, bookId, chapterId, formattedOriginal, batch);
        const shouldValidate = !isEnglishLanguage(language);

        try {
            const batchResult = await doAnthropicCallWithRetry(content, PROOFREAD_SCHEMA, `proofread ${bookId}:${chapterId} batch ${label}`, shouldValidate);

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
                scores.push(batchResult.score);
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

    let result = {
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

    if (appliedCount > 0 || footnoteCount > 0) {
        fs.writeFileSync(filename, JSON.stringify(verses, null, 2));
        const parts = [];
        if (appliedCount > 0) parts.push(`${appliedCount} changes`);
        if (footnoteCount > 0) parts.push(`${footnoteCount} footnotes`);
        console.log(`Applied ${parts.join(', ')} to ${bookId}:${chapterId}`);
    }

    return { appliedCount, footnoteCount };
}

function printUsage() {
    console.log(`
Usage: node bible_test.mjs <bible> [options]

Arguments:
  bible              Bible version to work with (e.g., osnb1, osnb2, osnn1)

Options:
  --style <type>     Translation style: standard, oral (default: standard)
  --proofread        Run proofreading after translation (can combine with translation)
  --apply            Apply proofread suggestions (enables feedback loop)
  --min-score <n>    Minimum acceptable score (default: 8, range 0-10)
  --max-iter <n>     Max proofread iterations per chapter (default: 3)
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
    console.log(`Style: ${options.style}`);
    console.log(`Mode: ${modes.join(' → ')}`);
    if (options.proofread && options.apply) {
        console.log(`Feedback loop: min score ${options.minScore || 8}/10, max ${options.maxIterations || 3} iterations`);
    }
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

            if (options.proofread) {
                // Per-verse mode: proofread each verse individually with neighbor context
                // Applies changes and footnotes directly — no separate apply step needed
                await proofreadChapterPerVerse(options.bible, bookId, chapterId, options.style, filename);
            }
        }
    }

    console.log('Done!');
}

main().catch(console.error);
