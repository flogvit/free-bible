import dotenv from 'dotenv'
import * as fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config()

import {books, normalizeLanguage, getLanguageCode, getBookName, ollamaBaseUrl, ollamaModel, anthropicModel} from "./constants.js";
import {callWithRetry, callOllamaRaw} from "./llm.js";

// Norwegian number words for scanning bible text
const NUMBER_WORDS_NB = {
    1: ['en', 'ett', 'én', 'étt', 'ene', 'eneste', 'første'],
    2: ['to', 'andre', 'annen', 'annet', 'begge', 'dobbelt', 'par'],
    3: ['tre', 'tredje', 'tretten', 'tredobbelt'],
    4: ['fire', 'fjerde', 'fjorten'],
    5: ['fem', 'femte', 'femten'],
    6: ['seks', 'sjette', 'seksten'],
    7: ['sju', 'syv', 'sjuende', 'syvende', 'sytti'],
    8: ['åtte', 'åttende', 'atten'],
    10: ['ti', 'tiende'],
    12: ['tolv', 'tolvte'],
    13: ['tretten', 'trettende'],
    14: ['fjorten', 'fjortende'],
    18: ['atten', 'attende'],
    24: ['tjuefire', 'tjuefjerde'],
    30: ['tretti', 'trettiende'],
    40: ['førti', 'førtiende'],
    49: ['førtini'],
    50: ['femti', 'femtiende'],
    70: ['sytti', 'syttiende'],
    153: ['hundreogfemtitre'],
    666: ['sekshundreogsekstiseks'],
};

const FOOTNOTE_SCHEMA = {
    type: "object",
    properties: {
        text: {type: "string"},
        source: {type: "string", enum: ["rabbinsk", "kabbalistisk", "historisk", "arkeologisk", "lingvistisk", "liturgisk", "teologisk", "annet"]},
    },
    required: ["text", "source"],
    additionalProperties: false
};

const SYMBOLISM_SCHEMA = {
    type: "object",
    properties: {
        number: {type: "integer"},
        meaning: {type: "string"},
        description: {type: "string"},
        footnotes: {
            type: "array",
            items: FOOTNOTE_SCHEMA
        },
        references: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    bookId: {type: "integer"},
                    chapterId: {type: "integer"},
                    fromVerseId: {type: "integer"},
                    toVerseId: {type: "integer"}
                },
                required: ["bookId", "chapterId", "fromVerseId", "toVerseId"],
                additionalProperties: false
            }
        }
    },
    required: ["number", "meaning", "description", "footnotes", "references"],
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
                    type: {type: "string", enum: ["error", "suggestion", "theological", "grammar", "missing", "irrelevant"]},
                    severity: {type: "string", enum: ["critical", "major", "minor"]},
                    explanation: {type: "string"}
                },
                required: ["type", "severity", "explanation"],
                additionalProperties: false
            }
        },
        summary: {type: "string"},
        score: {type: "integer"},
        revised: {
            type: "object",
            properties: {
                number: {type: "integer"},
                meaning: {type: "string"},
                description: {type: "string"},
                footnotes: {
                    type: "array",
                    items: FOOTNOTE_SCHEMA
                }
            },
            required: ["number", "meaning", "description", "footnotes"],
            additionalProperties: false
        }
    },
    required: ["issues", "summary", "score", "revised"],
    additionalProperties: false
};

// Ask Ollama to verify if a word in context is used as a number
async function ollamaIsNumber(word, sentence) {
    const prompt = `I denne setningen: "${sentence}"

Er ordet "${word}" brukt som et tall/mengde (f.eks. "tre dager" = tallet 3), eller er det et annet ord (f.eks. "et tre" = trevirke/plante)?

Svar kun med "tall" eller "ikke tall". Ikke forklar.`;

    try {
        const answer = await callOllamaRaw(prompt);
        return answer.toLowerCase().includes('tall') && !answer.toLowerCase().includes('ikke');
    } catch (error) {
        console.warn(`  Ollama unavailable, keeping match: ${error.message}`);
        return true;
    }
}

// Words that are ambiguous (same spelling as non-number words)
const AMBIGUOUS_WORDS = new Set(['tre', 'en', 'ett', 'én', 'étt', 'par', 'ti']);

// Scan a bible translation for verses containing a specific number
async function scanBibleForNumber(bible, number) {
    const bibleDir = path.join(__dirname, 'bibles_raw', bible);
    if (!fs.existsSync(bibleDir)) {
        console.error(`Bible translation not found: ${bibleDir}`);
        return [];
    }

    const numStr = String(number);
    const words = NUMBER_WORDS_NB[number] || [];
    const candidates = [];

    for (const book of books) {
        const bookDir = path.join(bibleDir, String(book.id));
        if (!fs.existsSync(bookDir)) continue;

        for (let chapterId = 1; chapterId <= book.chapters; chapterId++) {
            const chapterFile = path.join(bookDir, `${chapterId}.json`);
            if (!fs.existsSync(chapterFile)) continue;

            const verses = JSON.parse(fs.readFileSync(chapterFile, 'utf-8'));
            for (const verse of verses) {
                const text = verse.text.toLowerCase();
                // Check for the number as digits (word boundary)
                const digitRegex = new RegExp(`\\b${numStr}\\b`);
                let found = digitRegex.test(text);
                let matchedWord = found ? numStr : null;

                // Check for number words
                if (!found) {
                    for (const word of words) {
                        const wordRegex = new RegExp(`\\b${word}\\b`, 'i');
                        if (wordRegex.test(text)) {
                            found = true;
                            matchedWord = word;
                            break;
                        }
                    }
                }

                if (found) {
                    candidates.push({
                        bookId: verse.bookId,
                        chapterId: verse.chapterId,
                        verseId: verse.verseId,
                        text: verse.text,
                        matchedWord
                    });
                }
            }
        }
    }

    // Filter ambiguous matches using Ollama
    const needsCheck = candidates.filter(c => AMBIGUOUS_WORDS.has(c.matchedWord));
    const safe = candidates.filter(c => !AMBIGUOUS_WORDS.has(c.matchedWord));

    if (needsCheck.length > 0) {
        const total = needsCheck.length;
        console.log(`  Verifying ${total} ambiguous matches with Ollama (${ollamaModel})...`);
        let kept = 0;
        let removed = 0;
        for (let i = 0; i < needsCheck.length; i++) {
            const candidate = needsCheck[i];
            const pct = Math.round(((i + 1) / total) * 100);
            const bookName = getBookName(candidate.bookId, 'Norwegian bokmål');
            process.stdout.write(`\r  [${pct}%] ${i + 1}/${total} — ${bookName} ${candidate.chapterId}:${candidate.verseId}${''.padEnd(20)}`);
            const isNumber = await ollamaIsNumber(candidate.matchedWord, candidate.text);
            if (isNumber) {
                safe.push(candidate);
                kept++;
            } else {
                removed++;
            }
        }
        process.stdout.write('\r' + ''.padEnd(80) + '\r');
        console.log(`  Ollama filter: kept ${kept}, removed ${removed} false positives`);
    }

    return safe.map(({matchedWord, ...rest}) => rest);
}

function getGeneratePrompt(language, number, scanResults) {
    const langCode = getLanguageCode(language);

    let scanContext = '';
    if (scanResults && scanResults.length > 0) {
        const limited = scanResults.slice(0, 50);
        const verseList = limited.map(v => {
            const bookName = getBookName(v.bookId, language);
            return `  ${bookName} ${v.chapterId}:${v.verseId}: ${v.text}`;
        }).join('\n');
        scanContext = `\n\nHer er noen bibelvers der tallet ${number} forekommer:\n${verseList}`;
        if (scanResults.length > 50) {
            scanContext += `\n  ... og ${scanResults.length - 50} flere treff.`;
        }
    }

    if (langCode === 'nb') {
        return `Skriv om den symbolske betydningen av tallet ${number} i bibelsk og jødisk tradisjon på norsk bokmål.

Inkluder:
- En kort, presis formulering av tallets symbolske betydning (meaning-feltet)
- En utfyllende beskrivelse (2-4 setninger) som forklarer symbolikken med eksempler fra Bibelen og jødisk tradisjon
- Fotnoter (footnotes) for interessante fakta som ikke passer naturlig i hovedteksten, men som er nyttige å vite. For eksempel rabbinske tradisjoner, kabbalistiske tolkninger, historiske kontekster, eller lingvistiske detaljer. Hovedteksten skal flyte godt uten fotnotene.
- Referanser til bibelsteder der tallet har symbolsk betydning (ikke bare steder der tallet nevnes tilfeldig)

Hver fotnote har: text (selve fotnoten) og source (én av: rabbinsk, kabbalistisk, historisk, arkeologisk, lingvistisk, liturgisk, teologisk, annet).

bookId-verdier: GT-bøker 1-39, NT-bøker 40-66.
Velg referanser som virkelig illustrerer den symbolske bruken av tallet, ikke bare tilfeldige forekomster.${scanContext}

Returner et JSON-objekt med: number (tall), meaning (kort symbolsk betydning), description (utfyllende beskrivelse), footnotes (array med {text, source}), references (array med {bookId, chapterId, fromVerseId, toVerseId}).`;
    } else {
        return `Write about the symbolic meaning of the number ${number} in biblical and Jewish tradition in ${language}.

Include:
- A concise formulation of the number's symbolic meaning (meaning field)
- A fuller description (2-4 sentences) explaining the symbolism with examples from the Bible and Jewish tradition
- Footnotes for interesting facts that don't fit naturally in the main text, but are useful to know. For example rabbinic traditions, kabbalistic interpretations, historical contexts, or linguistic details. The main text should flow well without the footnotes.
- References to Bible passages where the number has symbolic significance (not just random mentions)

Each footnote has: text (the footnote itself) and source (one of: rabbinsk, kabbalistisk, historisk, arkeologisk, lingvistisk, liturgisk, teologisk, annet).

bookId values: OT books 1-39, NT books 40-66.
Choose references that truly illustrate the symbolic use of the number, not just random occurrences.${scanContext}

Return a JSON object with: number (integer), meaning (short symbolic meaning), description (fuller description), footnotes (array of {text, source}), references (array of {bookId, chapterId, fromVerseId, toVerseId}).`;
    }
}

function getProofreadPrompt(language, number, currentData) {
    const langCode = getLanguageCode(language);

    // Build version history context
    let versionContext = '';
    if (currentData.versions && currentData.versions.length > 0) {
        const historyEntries = currentData.versions.map((v, i) => {
            const parts = [`  Versjon ${i + 1}: meaning="${v.meaning}"`];
            if (v.description) parts.push(`  description="${v.description.substring(0, 150)}..."`);
            if (v.reason) parts.push(`  Grunn til endring: ${v.reason}`);
            return parts.join('\n');
        }).join('\n\n');

        if (langCode === 'nb') {
            versionContext = `\n\nTIDLIGERE VERSJONER (ikke foreslå tekst som ligner på disse):
${historyEntries}
`;
        } else {
            versionContext = `\n\nPREVIOUS VERSIONS (do not suggest text similar to these):
${historyEntries}
`;
        }
    }

    // Only send meaning, description and footnotes for proofreading — never references
    const proofreadData = {
        number: currentData.number,
        meaning: currentData.meaning,
        description: currentData.description,
        footnotes: currentData.footnotes || []
    };
    const dataJson = JSON.stringify(proofreadData, null, 2);

    if (langCode === 'nb') {
        return `Du er en korrekturleser for bibelsk tallsymbolikk. Gå gjennom meaning, description og footnotes for tallet ${number}.

Din oppgave er å verifisere:
- At meaning-feltet er presist og dekkende
- At description-feltet er teologisk korrekt og godt formulert
- At description flyter godt som sammenhengende tekst
- At fotnoter (footnotes) brukes for interessante fakta som ikke passer i hovedteksten
- At informasjon som bryter flyten i description heller flyttes til fotnoter
- At hver fotnote har riktig source-kategori (rabbinsk, kabbalistisk, historisk, arkeologisk, lingvistisk, liturgisk, teologisk, annet)

VIKTIG:
- Hvis alt er bra, returner tomt issues-array og uendret revised
- revised skal inneholde number, meaning, description og footnotes
- score skal være et heltall fra 0 til 10 (0 = helt feil, 10 = perfekt)
- Hvis det er ${currentData.versions?.length || 0} tidligere versjoner, vær strengere: kun foreslå endringer ved reelle feil
- ALDRI nevn spesifikke bibelutgaver, bibelselskap eller forlag (f.eks. "Bibelen 2011", "Bibelselskapet", "NIV", "ESV"). Skriv nøytralt uten referanse til bestemte oversettelser eller organisasjoner.${versionContext}

Nåværende data:
${dataJson}`;
    } else {
        return `You are a proofreader for biblical number symbolism. Review the meaning, description and footnotes for the number ${number}.

Your task is to verify:
- That the meaning field is precise and accurate
- That the description is theologically correct and well-written
- That the description flows well as coherent text
- That footnotes are used for interesting facts that don't fit in the main text
- That information breaking the flow of description is moved to footnotes instead
- That each footnote has the correct source category (rabbinsk, kabbalistisk, historisk, arkeologisk, lingvistisk, liturgisk, teologisk, annet)

IMPORTANT:
- If everything is good, return empty issues array and unchanged revised
- revised should contain number, meaning, description and footnotes
- score must be an integer from 0 to 10 (0 = completely wrong, 10 = perfect)
- If there are ${currentData.versions?.length || 0} previous versions, be stricter: only suggest changes for real errors
- NEVER mention specific Bible editions, Bible societies, or publishers (e.g., "NIV", "ESV", "KJV", "Bibelen 2011", "Bibelselskapet"). Write neutrally without referencing specific translations or organizations.${versionContext}

Current data:
${dataJson}`;
    }
}

// Shared local flag, set from parseArgs
let useLocal = false;

function getOutputPath(language, number) {
    const langCode = getLanguageCode(language);
    return path.join(__dirname, `number_symbolism/${langCode}/${number}.json`);
}

function getProofreadPath(language, number) {
    const langCode = getLanguageCode(language);
    return path.join(__dirname, `proofread_number_symbolism/${langCode}/${number}.json`);
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

async function generateSymbolism(language, number, filename, bible) {
    let scanResults = [];
    if (bible) {
        console.log(`Scanning ${bible} for number ${number}...`);
        scanResults = await scanBibleForNumber(bible, number);
        console.log(`  Found ${scanResults.length} verses containing ${number}`);
    }

    const prompt = getGeneratePrompt(language, number, scanResults);

    console.log(`Generating symbolism for number ${number}...`);
    const result = await callWithRetry(prompt, {schema: SYMBOLISM_SCHEMA, local: useLocal, context: `number ${number}`});

    ensureDir(filename);
    fs.writeFileSync(filename, JSON.stringify(result, null, 2));
    console.log(`  Saved: ${filename} (${result.references.length} references)`);
}

// Look up verse texts for references from a bible translation
function getVerseTexts(bible, references) {
    if (!bible || !references || references.length === 0) return null;
    const bibleDir = path.join(__dirname, 'bibles_raw', bible);
    if (!fs.existsSync(bibleDir)) return null;

    const texts = [];
    for (const ref of references) {
        const chapterFile = path.join(bibleDir, String(ref.bookId), `${ref.chapterId}.json`);
        if (!fs.existsSync(chapterFile)) continue;
        const verses = JSON.parse(fs.readFileSync(chapterFile, 'utf-8'));
        const matched = verses.filter(v => v.verseId >= ref.fromVerseId && v.verseId <= ref.toVerseId);
        const bookName = getBookName(ref.bookId, 'Norwegian bokmål');
        for (const v of matched) {
            texts.push(`  ${bookName} ${ref.chapterId}:${v.verseId}: ${v.text}`);
        }
    }
    return texts.length > 0 ? texts : null;
}

async function proofreadSymbolism(language, number, filename, saveToFile = true, bible = null) {
    if (!fileExists(filename)) {
        console.log(`No symbolism file found for number ${number}`);
        return null;
    }

    const currentData = JSON.parse(fs.readFileSync(filename, 'utf-8'));

    // Include actual verse texts as context when ≤5 references
    let verseContext = '';
    if (bible && currentData.references && currentData.references.length <= 5) {
        const verseTexts = getVerseTexts(bible, currentData.references);
        if (verseTexts) {
            verseContext = `\n\nNoen vers der tallet ${number} forekommer i Bibelen:\n${verseTexts.join('\n')}`;
        }
    }

    console.log(`Proofreading symbolism for number ${number}...`);

    const prompt = getProofreadPrompt(language, number, currentData) + verseContext;
    const result = await callWithRetry(prompt, {schema: PROOFREAD_SCHEMA, local: useLocal, context: `proofread number ${number}`});

    if (saveToFile) {
        const proofreadFile = getProofreadPath(language, number);
        ensureDir(proofreadFile);
        fs.writeFileSync(proofreadFile, JSON.stringify(result, null, 2));
    }

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

function applyProofreadChanges(language, number, filename, proofreadResult = null) {
    if (!proofreadResult) {
        const proofreadFile = getProofreadPath(language, number);
        if (!fileExists(proofreadFile)) {
            console.log(`No proofread file found for number ${number}`);
            return;
        }
        proofreadResult = JSON.parse(fs.readFileSync(proofreadFile, 'utf-8'));
    }

    if (!fileExists(filename)) {
        console.log(`No symbolism file found for number ${number}`);
        return;
    }

    if (!proofreadResult.revised || !proofreadResult.revised.meaning) {
        return;
    }

    const currentData = JSON.parse(fs.readFileSync(filename, 'utf-8'));

    // Check if anything actually changed
    const meaningChanged = currentData.meaning !== proofreadResult.revised.meaning;
    const descChanged = currentData.description !== proofreadResult.revised.description;
    const footnotesChanged = JSON.stringify(currentData.footnotes || []) !== JSON.stringify(proofreadResult.revised.footnotes || []);

    if (meaningChanged || descChanged || footnotesChanged) {
        // Save current version to history before overwriting
        if (!currentData.versions) {
            currentData.versions = [];
        }
        const version = {
            meaning: currentData.meaning,
            description: currentData.description,
        };
        if (currentData.footnotes && currentData.footnotes.length > 0) {
            version.footnotes = currentData.footnotes;
        }
        // Summarize why it changed from the proofread issues
        if (proofreadResult.issues && proofreadResult.issues.length > 0) {
            version.reason = proofreadResult.issues.map(i => `[${i.severity}] ${i.explanation}`).join('; ');
        }
        version.score = proofreadResult.score;
        version.date = new Date().toISOString().split('T')[0];
        currentData.versions.push(version);
    }

    currentData.meaning = proofreadResult.revised.meaning;
    currentData.description = proofreadResult.revised.description;

    // Update footnotes
    if (proofreadResult.revised.footnotes) {
        currentData.footnotes = proofreadResult.revised.footnotes;
    }

    // References are NEVER modified by proofread — they come from bible indexing

    fs.writeFileSync(filename, JSON.stringify(currentData, null, 2));
    console.log(`  Applied revisions to number ${number} (version ${currentData.versions?.length || 0})`);

    return { changed: meaningChanged || descChanged, footnotesChanged };
}

// Ask Ollama to extract symbolic numbers from a verse
async function ollamaExtractNumbers(verse, bookName) {
    const prompt = `List opp alle numeriske verdier i dette bibelverset. Inkluder både sammensatte tallord ("seks hundre og sekstiseks" = 666), enkle tallord ("tre" = 3), og mengdeangivelser ("ett" = 1, "begge" = 2). Ignorer ord som ikke angir mengde.

"${verse}"

Svar BARE med en kommaseparert liste av heltall, eller "ingen".`;

    try {
        const answer = await callOllamaRaw(prompt);
        if (!answer || answer.toLowerCase() === 'ingen' || answer.toLowerCase() === 'none') return [];

        const numbers = answer.match(/\d+/g);
        return numbers ? [...new Set(numbers.map(n => parseInt(n, 10)).filter(n => n > 0))] : [];
    } catch (error) {
        console.warn(`\n  Ollama error: ${error.message}`);
        return [];
    }
}

// Count total verses in a bible translation (with optional filters)
function countBibleVerses(bible, bookStart, bookEnd, chapterStart, chapterEnd, verseStart, verseEnd) {
    const bibleDir = path.join(__dirname, 'bibles_raw', bible);
    let total = 0;
    for (const book of books) {
        if (book.id < bookStart || book.id > bookEnd) continue;
        const bookDir = path.join(bibleDir, String(book.id));
        if (!fs.existsSync(bookDir)) continue;
        const startCh = (book.id === bookStart && chapterStart) ? chapterStart : 1;
        const endCh = (book.id === bookEnd && chapterEnd) ? Math.min(chapterEnd, book.chapters) : book.chapters;
        for (let chapterId = startCh; chapterId <= endCh; chapterId++) {
            const chapterFile = path.join(bookDir, `${chapterId}.json`);
            if (!fs.existsSync(chapterFile)) continue;
            const verses = JSON.parse(fs.readFileSync(chapterFile, 'utf-8'));
            if (verseStart || verseEnd) {
                total += verses.filter(v => v.verseId >= (verseStart || 1) && v.verseId <= (verseEnd || 999)).length;
            } else {
                total += verses.length;
            }
        }
    }
    return total;
}

// Get meaning and description for a new number from Claude
async function generateMeaningForNumber(language, number) {
    const langCode = getLanguageCode(language);

    let prompt;
    if (langCode === 'nb') {
        prompt = `Hva er den symbolske betydningen av tallet ${number} i bibelsk og jødisk tradisjon?

Svar med et JSON-objekt med:
- meaning: kort symbolsk betydning (én setning)
- description: utfyllende beskrivelse (2-4 setninger)

Hvis tallet ikke har noen kjent symbolsk betydning i bibelsk tradisjon, bruk en tom streng for begge feltene.`;
    } else {
        prompt = `What is the symbolic meaning of the number ${number} in biblical and Jewish tradition?

Reply with a JSON object with:
- meaning: short symbolic meaning (one sentence)
- description: fuller description (2-4 sentences)

If the number has no known symbolic meaning in biblical tradition, use empty strings for both fields.`;
    }

    const MEANING_SCHEMA = {
        type: "object",
        properties: {
            meaning: {type: "string"},
            description: {type: "string"}
        },
        required: ["meaning", "description"],
        additionalProperties: false
    };

    const result = await callWithRetry(prompt, {schema: MEANING_SCHEMA, local: useLocal, context: `meaning for ${number}`});
    return result;
}

// Index entire bible: send every verse to Ollama, update/create JSON files incrementally
async function indexBible(bible, language, options = {}) {
    const bibleDir = path.join(__dirname, 'bibles_raw', bible);
    if (!fs.existsSync(bibleDir)) {
        console.error(`Bible translation not found: ${bibleDir}`);
        return;
    }

    const langCode = getLanguageCode(language);
    const outputDir = path.join(__dirname, `number_symbolism/${langCode}`);
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, {recursive: true});
    }

    const bookStart = options.bookStart || 1;
    const bookEnd = options.bookEnd || 66;
    const chapterStart = options.chapterStart || null;
    const chapterEnd = options.chapterEnd || null;
    const verseStart = options.verseStart || null;
    const verseEnd = options.verseEnd || null;

    const totalVerses = countBibleVerses(bible, bookStart, bookEnd, chapterStart, chapterEnd, verseStart, verseEnd);
    console.log(`\nIndexing ${bible} (${totalVerses} verses) with Ollama (${ollamaModel})...`);
    if (bookStart !== 1 || bookEnd !== 66) console.log(`  Books: ${bookStart}-${bookEnd}`);
    if (chapterStart) console.log(`  Chapters: ${chapterStart}-${chapterEnd}`);
    if (verseStart) console.log(`  Verses: ${verseStart}-${verseEnd}`);
    console.log('');

    // Cache for loaded JSON files to avoid repeated reads/writes
    const fileCache = {};
    let processed = 0;
    let newNumbers = 0;
    let refsAdded = 0;
    const startTime = Date.now();

    for (const book of books) {
        if (book.id < bookStart || book.id > bookEnd) continue;
        const bookDir = path.join(bibleDir, String(book.id));
        if (!fs.existsSync(bookDir)) continue;

        const bookName = getBookName(book.id, language);
        const startCh = (book.id === bookStart && chapterStart) ? chapterStart : 1;
        const endCh = (book.id === bookEnd && chapterEnd) ? Math.min(chapterEnd, book.chapters) : book.chapters;

        for (let chapterId = startCh; chapterId <= endCh; chapterId++) {
            const chapterFile = path.join(bookDir, `${chapterId}.json`);
            if (!fs.existsSync(chapterFile)) continue;

            const verses = JSON.parse(fs.readFileSync(chapterFile, 'utf-8'));
            for (const verse of verses) {
                if (verseStart && verse.verseId < verseStart) continue;
                if (verseEnd && verse.verseId > verseEnd) continue;
                processed++;
                const pct = Math.round((processed / totalVerses) * 100);
                const elapsed = (Date.now() - startTime) / 1000;
                const rate = processed / elapsed;
                const remaining = Math.round((totalVerses - processed) / rate);
                const mins = Math.floor(remaining / 60);
                const secs = remaining % 60;
                process.stdout.write(`\r  [${pct}%] ${processed}/${totalVerses} — ${bookName} ${chapterId}:${verse.verseId} — ${refsAdded} refs, ${newNumbers} new — ~${mins}m${secs}s left${''.padEnd(10)}`);

                const numbers = await ollamaExtractNumbers(verse.text, bookName);

                for (const num of numbers) {
                    const filename = path.join(outputDir, `${num}.json`);
                    const ref = {
                        bookId: verse.bookId,
                        chapterId: verse.chapterId,
                        fromVerseId: verse.verseId,
                        toVerseId: verse.verseId
                    };

                    if (!fileCache[num]) {
                        if (fs.existsSync(filename)) {
                            fileCache[num] = JSON.parse(fs.readFileSync(filename, 'utf-8'));
                        } else {
                            // New number — get meaning from Claude
                            process.stdout.write(`\n  New number ${num} found — getting meaning from Claude...`);
                            const meaning = await generateMeaningForNumber(language, num);
                            fileCache[num] = {
                                number: num,
                                meaning: meaning.meaning,
                                description: meaning.description,
                                references: []
                            };
                            newNumbers++;
                            process.stdout.write(' done\n');
                        }
                    }

                    // Dedup: skip if this reference already exists
                    const refKey = `${ref.bookId}:${ref.chapterId}:${ref.fromVerseId}`;
                    const alreadyExists = fileCache[num].references.some(
                        r => `${r.bookId}:${r.chapterId}:${r.fromVerseId}` === refKey
                    );
                    if (alreadyExists) continue;

                    fileCache[num].references.push(ref);
                    refsAdded++;

                    // Write to disk after each new reference
                    fs.writeFileSync(filename, JSON.stringify(fileCache[num], null, 2));
                }
            }
        }
    }

    // Summary
    process.stdout.write('\r' + ''.padEnd(100) + '\r');
    console.log('\nDone writing files.');
    const numFiles = Object.keys(fileCache).length;
    console.log(`  ${numFiles} number files updated`);
    for (const [numStr, data] of Object.entries(fileCache)) {
        const empty = !data.meaning ? ' (needs --generate)' : '';
        console.log(`  ${numStr}: ${data.references.length} references${empty}`);
    }

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(`\nDone in ${Math.floor(elapsed / 60)}m${elapsed % 60}s — ${processed} verses, ${refsAdded} refs, ${newNumbers} new numbers`);
}

async function scanOnly(bible, number) {
    console.log(`Scanning ${bible} for number ${number}...`);
    const matches = await scanBibleForNumber(bible, number);
    console.log(`Found ${matches.length} verses:\n`);
    for (const m of matches) {
        const bookName = getBookName(m.bookId, 'Norwegian bokmål');
        console.log(`  ${bookName} ${m.chapterId}:${m.verseId}: ${m.text}`);
    }
}

// Known symbolically significant numbers
const SYMBOLIC_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 13, 14, 18, 24, 30, 40, 49, 50, 70, 153, 666];

function printUsage() {
    console.log(`
Usage: node number_symbolism.mjs [options]

Options:
  --language <lang>  Language for texts (default: nb)
                     Accepts codes (nb, nn, en) or full names
  --number <n>       Process a specific number (e.g., 7)
  --number <n-m>     Process a range of numbers (e.g., 1-12)
  --all              Process all known symbolic numbers
  --bible <name>     Bible translation to scan for references (e.g., osnb2)
  --scan             Only scan the bible for number occurrences (no AI generation)
  --index            Index entire bible with Ollama: extract numbers from every verse
                     and update/create JSON files. Requires --bible.
  --proofread        Run proofreading after generation
  --apply            Apply proofread suggestions (enables feedback loop)
  --min-score <n>    Minimum acceptable score (default: 8, range 0-10)
  --max-iter <n>     Max proofread iterations per number (default: 3)
  --force            Force re-generation even if file exists
  --help             Show this help message

Known symbolic numbers: ${SYMBOLIC_NUMBERS.join(', ')}

Output structure:
  number_symbolism/<lang>/<number>.json
  e.g., number_symbolism/nb/7.json

Examples:
  node number_symbolism.mjs --number 7                            # Generate symbolism for 7
  node number_symbolism.mjs --number 7 --bible osnb2              # Generate with bible scan
  node number_symbolism.mjs --number 7 --bible osnb2 --scan       # Only scan, no AI
  node number_symbolism.mjs --all --bible osnb2                   # Generate all with scan
  node number_symbolism.mjs --all --proofread --apply             # Generate → proofread loop → apply
  node number_symbolism.mjs --number 7 --proofread --apply --min-score 9  # Higher quality bar
  node number_symbolism.mjs --number 3 --force                    # Re-generate number 3
  node number_symbolism.mjs --bible osnb2 --index                 # Index entire bible with Ollama
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
        numbers: [],
        all: false,
        bible: null,
        scan: false,
        index: false,
        proofread: false,
        apply: false,
        force: false,
        help: false
    };

    let i = 0;
    while (i < args.length) {
        const arg = args[i];

        if (arg === '--language' && i + 1 < args.length) {
            options.language = args[++i];
        } else if (arg === '--number' && i + 1 < args.length) {
            const range = parseRange(args[++i]);
            for (let n = range.start; n <= range.end; n++) {
                options.numbers.push(n);
            }
        } else if (arg === '--all') {
            options.all = true;
        } else if (arg === '--bible' && i + 1 < args.length) {
            options.bible = args[++i];
        } else if (arg === '--scan') {
            options.scan = true;
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
        } else if (arg === '--ot') {
            options.bookStart = 1;
            options.bookEnd = 39;
        } else if (arg === '--nt') {
            options.bookStart = 40;
            options.bookEnd = 66;
        } else if (arg === '--index') {
            options.index = true;
        } else if (arg === '--proofread') {
            options.proofread = true;
        } else if (arg === '--apply') {
            options.apply = true;
        } else if (arg === '--min-score' && i + 1 < args.length) {
            options.minScore = parseInt(args[++i], 10);
        } else if (arg === '--max-iter' && i + 1 < args.length) {
            options.maxIterations = parseInt(args[++i], 10);
        } else if (arg === '--local') {
            options.local = true;
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
    useLocal = options.local || false;

    if (options.help) {
        printUsage();
        return;
    }

    // Index mode: scan entire bible with Ollama
    if (options.index) {
        if (!options.bible) {
            console.error('--index requires --bible <name>');
            return;
        }
        await indexBible(options.bible, options.language, options);
        return;
    }

    // Determine which numbers to process
    let numbers = options.numbers;
    if (options.all) {
        // Read all existing number files from disk
        const langCode = getLanguageCode(options.language);
        const numDir = path.join(__dirname, `number_symbolism/${langCode}`);
        if (fs.existsSync(numDir)) {
            numbers = fs.readdirSync(numDir)
                .filter(f => f.endsWith('.json'))
                .map(f => parseInt(f.replace('.json', ''), 10))
                .filter(n => !isNaN(n))
                .sort((a, b) => a - b);
        }
        if (numbers.length === 0) {
            numbers = SYMBOLIC_NUMBERS;
        }
    }

    if (numbers.length === 0) {
        console.error('No numbers specified. Use --number <n>, --all, --index, or --help');
        return;
    }

    // Scan-only mode
    if (options.scan) {
        if (!options.bible) {
            console.error('--scan requires --bible <name>');
            return;
        }
        for (const number of numbers) {
            scanOnly(options.bible, number);
            console.log('');
        }
        return;
    }

    const modes = ['Generate'];
    if (options.proofread) modes.push('Proofread');
    if (options.apply) modes.push('Apply');

    console.log(`Language: ${options.language}`);
    console.log(`Model: ${useLocal ? ollamaModel : anthropicModel}`);
    console.log(`Mode: ${modes.join(' → ')}`);
    if (options.proofread && options.apply) {
        console.log(`Feedback loop: min score ${options.minScore || 8}/10, max ${options.maxIterations || 3} iterations`);
    }
    console.log(`Numbers: ${numbers.join(', ')}`);
    if (options.bible) console.log(`Bible scan: ${options.bible}`);
    console.log('---');

    const minScore = options.minScore || 8;
    const maxIterations = options.maxIterations || 3;

    for (const number of numbers) {
        const filename = getOutputPath(options.language, number);

        // Step 1: Generate
        if (!fileExists(filename) || options.force) {
            await generateSymbolism(options.language, number, filename, options.bible);
        } else {
            console.log(`Skipping number ${number} (already exists)`);
        }

        // Step 2: Proofread (with feedback loop if --apply)
        if (options.proofread && fileExists(filename)) {
            let iteration = 0;
            let lastScore = 0;
            let newFootnotes = false;

            while (iteration < maxIterations) {
                iteration++;
                const saveToFile = !options.apply;
                const proofreadResult = await proofreadSymbolism(options.language, number, filename, saveToFile, options.bible);

                lastScore = proofreadResult?.score ?? 10;

                if (options.apply && proofreadResult) {
                    const result = applyProofreadChanges(options.language, number, filename, proofreadResult);
                    newFootnotes = result?.footnotesChanged || false;
                }

                // Re-proofread if score too low OR new footnotes were added (to review them)
                if (lastScore >= minScore && !newFootnotes) {
                    break;
                }

                if (newFootnotes && lastScore >= minScore) {
                    console.log(`  New footnotes added — re-proofreading to review them (iteration ${iteration + 1}/${maxIterations})...`);
                } else if (iteration < maxIterations) {
                    console.log(`  Score ${lastScore}/10 < ${minScore} — re-proofreading (iteration ${iteration + 1}/${maxIterations})...`);
                } else {
                    console.log(`  Score ${lastScore}/10 — max iterations (${maxIterations}) reached`);
                }

                newFootnotes = false; // Only force one extra round for footnotes
            }
        }
    }

    console.log('Done!');
}

main().catch(console.error);
