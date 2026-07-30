import dotenv from 'dotenv'
import * as fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config()

import {books, normalizeLanguage, getLanguageCode, getBookName} from "./constants.js";
import {getOriginalVerse, getOriginalChapter, getRef, getOsnb2VerseRange} from "./lib.js";
import {callWithRetry} from "./llm.js";

let useLocal = false;

const REFERENCE_SCHEMA = {
    type: "object",
    properties: {
        references: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    bookId: {type: "integer"},
                    chapterId: {type: "integer"},
                    fromVerseId: {type: "integer"},
                    toVerseId: {type: "integer"},
                    text: {type: "string"}
                },
                required: ["bookId", "chapterId", "fromVerseId", "toVerseId", "text"],
                additionalProperties: false
            }
        }
    },
    required: ["references"],
    additionalProperties: false
};

const REFERENCE_PROOFREAD_SCHEMA = {
    type: "object",
    properties: {
        issues: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    type: {type: "string", enum: ["error", "missing", "irrelevant", "text", "self-reference"]},
                    severity: {type: "string", enum: ["critical", "major", "minor"]},
                    reference: {type: "string"},
                    explanation: {type: "string"}
                },
                required: ["type", "severity", "explanation"],
                additionalProperties: false
            }
        },
        summary: {type: "string"},
        score: {type: "integer"},
        revisedReferences: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    bookId: {type: "integer"},
                    chapterId: {type: "integer"},
                    fromVerseId: {type: "integer"},
                    toVerseId: {type: "integer"},
                    text: {type: "string"}
                },
                required: ["bookId", "chapterId", "fromVerseId", "toVerseId", "text"],
                additionalProperties: false
            }
        }
    },
    required: ["issues", "summary", "score", "revisedReferences"],
    additionalProperties: false
};

function getReferencePrompt(language, bookId, chapterId, verseId, originalText) {
    const bookName = getBookName(bookId, language);
    const ref = `${bookName} ${chapterId}:${verseId}`;
    const langCode = getLanguageCode(language);
    const originalLanguage = bookId <= 39 ? 'hebraisk' : 'gresk';
    const originalLanguageEn = bookId <= 39 ? 'Hebrew' : 'Greek';

    const bookList = books.map(b => `${b.id}=${b.name}`).join(', ');

    const strictNb = useLocal ? `
KVALITETSKRAV:
- Inkluder KUN referanser med sterk, direkte kobling til kildeverset
- Maks 5-8 referanser. Kvalitet over kvantitet.
- Hver referanse må dele et spesifikt tema, nøkkelord eller motiv med kildeverset
- Ikke inkluder generelle tematiske koblinger (f.eks. «handler også om tro»)

BOOK ID-LISTE (bruk ALLTID denne for å finne riktig bookId):
${bookList}
` : '';

    const strictEn = useLocal ? `
QUALITY REQUIREMENTS:
- Include ONLY references with a strong, direct connection to the source verse
- Maximum 5-8 references. Quality over quantity.
- Each reference must share a specific theme, keyword or motif with the source verse
- Do not include generic thematic connections (e.g. "also about faith")

BOOK ID LIST (ALWAYS use this to find the correct bookId):
${bookList}
` : '';

    if (langCode === 'nb') {
        return `Skriv kryssreferanser for ${ref} på norsk bokmål.
GT-referanser er fra tanach, og NT er fra SBLGNT.

Den ${originalLanguage}e originalteksten for verset er:
${originalText}
${strictNb}
REFERANSEFORMAT:
Når du refererer til bibelsteder i text-feltet, bruk formatet: [ref:FORKORTELSE KAPITTEL:VERS|VISNINGSTEKST]
Eksempel: [ref:Joh 3:16|Johannes 3:16], [ref:1 Mos 1:1-3|1. Mosebok 1:1-3]
Bruk KVN-forkortelser (1 Mos, Sal, Joh, Åp osv.) i ref-delen og fullt boknavn i visningsteksten.

Returner et JSON-objekt med en 'references'-array. Hvert element har: bookId (tall), chapterId (tall), fromVerseId (tall), toVerseId (tall), text (forklar hvorfor dette er en kryssreferanse, men ikke start med "Dette er en kryssreferanse fordi"). Hvis du ikke finner kryssreferanser, bruk tom array.`;
    } else if (langCode === 'nn') {
        return `Skriv kryssreferansar for ${ref} på norsk nynorsk.
GT-referansar er frå tanach, og NT er frå SBLGNT.

Den ${originalLanguage}e originalteksten for verset er:
${originalText}

REFERANSEFORMAT:
Når du refererer til bibelstader i text-feltet, bruk formatet: [ref:FORKORTING KAPITTEL:VERS|VISNINGSTEKST]
Eksempel: [ref:Joh 3:16|Johannes 3:16], [ref:1 Mos 1:1-3|1. Mosebok 1:1-3]
Bruk KVN-forkortingar (1 Mos, Sal, Joh, Åp osv.) i ref-delen og fullt boknamn i visningsteksten.

Returner eit JSON-objekt med ein 'references'-array. Kvart element har: bookId (tal), chapterId (tal), fromVerseId (tal), toVerseId (tal), text (forklar kvifor dette er ein kryssreferanse, men ikkje start med "Dette er ein kryssreferanse fordi"). Dersom du ikkje finn kryssreferansar, bruk tom array.`;
    } else {
        return `Write cross-references for ${ref} in ${language}.
OT references are from tanach, and NT is from SBLGNT.

The original ${originalLanguageEn} text for the verse is:
${originalText}
${strictEn}
REFERENCE FORMAT:
When referring to Bible passages in the text field, use the format: [ref:ABBREVIATION CHAPTER:VERSE|DISPLAY TEXT]
Example: [ref:Joh 3:16|John 3:16], [ref:1 Mos 1:1-3|Genesis 1:1-3]
Use KVN abbreviations (1 Mos, Sal, Joh, Åp etc.) in the ref part and full book name in the display text.

Return a JSON object with a 'references' array. Each element has: bookId (number), chapterId (number), fromVerseId (number), toVerseId (number), text (explain why this is a cross-reference, but do not start with "This is a cross-reference because"). If you find no cross-references, use an empty array.`;
    }
}

/**
 * Build context text for each cross-reference by looking up ±2 verses from osnb.
 * Returns a formatted string showing the actual Bible text around each referenced verse.
 */
function buildReferenceContext(currentReferences) {
    const CONTEXT_RANGE = 2; // ±2 verses
    const sections = [];

    for (const ref of currentReferences) {
        const refBookId = ref.bookId;
        const refChapter = ref.chapterId;
        const fromVerse = ref.fromVerseId;
        const toVerse = ref.toVerseId || ref.fromVerseId;

        const rangeStart = Math.max(1, fromVerse - CONTEXT_RANGE);
        const rangeEnd = toVerse + CONTEXT_RANGE;

        const verses = getOsnb2VerseRange(refBookId, refChapter, rangeStart, rangeEnd);
        if (verses.length === 0) {
            sections.push(`  [${refBookId}:${refChapter}:${fromVerse}-${toVerse}] — vers ikke funnet i osnb`);
            continue;
        }

        const bookName = getBookName(refBookId, 'Norwegian bokmål');
        const lines = verses.map(v => {
            const marker = (v.verseId >= fromVerse && v.verseId <= toVerse) ? '>>>' : '   ';
            return `  ${marker} ${bookName} ${refChapter}:${v.verseId}: ${v.text}`;
        });
        sections.push(lines.join('\n'));
    }

    return sections.join('\n\n');
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
- Selvhenvisninger (referanser tilbake til kildeverset selv)
- ALDRI nevn spesifikke bibelutgaver, bibelselskap eller forlag (f.eks. "Bibelen 2011", "Bibelselskapet", "NIV", "ESV"). Skriv nøytralt uten referanse til bestemte oversettelser eller organisasjoner.`;
    } else if (langCode === 'nn') {
        basePrompt = `Du er ein korrekturlesar for bibelske kryssreferansar. Gå gjennom følgjande kryssreferansar for ${ref}.
Du får den ${originalLanguage}e originalteksten for å verifisere nøyaktigheita.`;
        taskDescription = `Di oppgåve er å verifisere kryssreferansane og identifisere:
- Feil bookId, chapterId, fromVerseId eller toVerseId (sjekk at dei refererte versa faktisk finst)
- Kryssreferansar som ikkje er relevante eller har svak kopling til kjeldeverset
- Viktige kryssreferansar som manglar
- Unøyaktige eller misvisande forklaringstekstar
- Sjølvhenvisingar (referansar tilbake til kjeldeverset sjølv)
- ALDRI nemn spesifikke bibelutgåver, bibelselskap eller forlag (t.d. "Bibelen 2011", "Bibelselskapet", "NIV", "ESV"). Skriv nøytralt utan referanse til bestemte omsetjingar eller organisasjonar.`;
    } else {
        basePrompt = `You are a proofreader for biblical cross-references. Review the following cross-references for ${ref}.
You are given the original ${originalLanguageEn} text to verify accuracy.`;
        taskDescription = `Your task is to verify the cross-references and identify:
- Incorrect bookId, chapterId, fromVerseId or toVerseId (check that referenced verses actually exist)
- Cross-references that are not relevant or have weak connection to the source verse
- Important cross-references that are missing
- Inaccurate or misleading explanation texts
- Self-references (references back to the source verse itself)
- NEVER mention specific Bible editions, Bible societies, or publishers (e.g., "NIV", "ESV", "KJV", "Bibelen 2011", "Bibelselskapet"). Write neutrally without referencing specific translations or organizations.`;
    }

    return `${basePrompt}

${taskDescription}

REFERANSEFORMAT:
Bibelreferanser i text-feltet bruker formatet: [ref:FORKORTELSE KAPITTEL:VERS|VISNINGSTEKST]
Eksempel: [ref:Joh 3:16|Johannes 3:16]. Bevar dette formatet i revisedReferences.
Bruk KVN-forkortelser (1 Mos, Sal, Joh, Åp osv.) i ref-delen og fullt boknavn i visningsteksten.

${useLocal ? `VIKTIG FOR KVALITETSKONTROLL:
- Fjern KUN referanser som er direkte feil (feil bookId/chapterId/verseId) eller helt irrelevante
- IKKE legg til nye referanser — det gjøres i et eget steg
- IKKE fjern referanser bare fordi de er "svake" — behold alt som har en rimelig kobling
- Hvis alle referansene er akseptable, returner tom issues-array og tom revisedReferences-array
- Maks 5 issues. Fokuser på det viktigste.
- score skal være 0-10 (0 = helt feil, 10 = perfekt)
` : ''}IMPORTANT:
- If the current references are good, return an empty issues array and empty revisedReferences array
- The revisedReferences must use the same format: [{bookId, chapterId, fromVerseId, toVerseId, text}]
- bookId values: OT books 1-39, NT books 40-66
- Focus on accuracy: are these real, meaningful cross-references?

Original text:
${originalText}

Current cross-references:
${refsJson}

FAKTISK BIBELTEKST FOR REFERANSENE (±2 vers fra osnb):
Linjer merket med >>> er de refererte versene. Sjekk om referansen peker til riktig vers,
eller om et nabovers er et bedre treff. Hvis et vers ikke finnes, er referansen sannsynligvis feil.
${buildReferenceContext(currentReferences)}`;
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

/**
 * Peker referansen på et vers som faktisk finnes?
 *
 * Kildesiden har alltid vært avgrenset — løkka i main() går ikke forbi
 * `book.chapters`. Måladressen bestemmer modellen, og der fantes ingen port:
 * 560 referanser i prod pekte på et kapittel målboka ikke har (#26).
 *
 * Men en adresse som ikke finnes hos oss er ikke uten videre feil. Vi følger
 * hebraisk/gresk versnummerering; modellen svarer ofte i den europeiske. «Mal 4:5»
 * finnes ikke — Malaki har 3 kapitler her — men det ER Mal 3:23, og referansen er
 * riktig. Målt på nb: 182 av de ugyldige er gyldige osmain-adresser, 556 finnes i
 * ingen nummerering. Bare de siste er bokforvekslingen #26 beskriver (`Høy 105:33`
 * for `Sal 105:33`). Derfor to utfall: 'renumber' skal rettes gjennom KVN,
 * 'drop' skal bort.
 *
 * Merk at dette bare fanger de som lander UTENFOR rekkevidde. En forvekslet bok
 * der kapittel og vers tilfeldigvis finnes gir en levende lenke til et urelatert
 * vers, og den gruppa er trolig større. Å fange den krever at man leser målverset
 * og sammenlikner med beskrivelsen — se punkt 3 i #26.
 *
 * @returns {{verdict: 'ok'|'renumber'|'drop', reason?: string}}
 */
export function checkTarget(ref) {
    const {bookId, chapterId, fromVerseId, toVerseId} = ref;
    const drop = reason => ({verdict: 'drop', reason});

    if (!Number.isInteger(bookId)) return drop(`bookId ${bookId} er ikke et heltall`);
    const book = books.find(b => b.id === bookId);
    if (!book) return drop(`bok ${bookId} finnes ikke`);

    if (!Number.isInteger(chapterId)) return drop(`chapterId ${chapterId} er ikke et heltall`);
    if (!Number.isInteger(fromVerseId)) return drop(`fromVerseId ${fromVerseId} er ikke et heltall`);
    const to = Number.isInteger(toVerseId) ? toVerseId : fromVerseId;
    if (to < fromVerseId) return drop(`toVerseId ${to} er mindre enn fromVerseId ${fromVerseId}`);

    if (chapterId >= 1 && chapterId <= book.chapters) {
        const present = versesIn(getOriginalChapter, bookId, chapterId);
        if (present && present.has(fromVerseId) && present.has(to)) return {verdict: 'ok'};
    }

    // Finnes adressen i osmain, er den riktig — bare skrevet i europeisk nummerering.
    const euro = versesIn(getOsmainChapter, bookId, chapterId);
    if (euro && euro.has(fromVerseId) && euro.has(to)) {
        return {
            verdict: 'renumber',
            reason: `${book.name} ${chapterId}:${fromVerseId} finnes bare i europeisk nummerering`
        };
    }

    return drop(chapterId > book.chapters
        ? `${book.name} har ${book.chapters} kapitler, referansen peker på ${chapterId}`
        : `${book.name} ${chapterId} har ikke vers ${fromVerseId}${to !== fromVerseId ? `-${to}` : ''}`);
}

/** Versnumrene i et kapittel, eller null om kapittelet ikke finnes. */
function versesIn(loader, bookId, chapterId) {
    try {
        const verses = loader(bookId, chapterId);
        if (!verses || !verses.length) return null;
        return new Set(verses.map(v => +v.verseId));
    } catch {
        return null;
    }
}

const osmainCache = {};

/** osmain følger den europeiske nummereringen, og er fasiten for «er dette en gyldig adresse der». */
function getOsmainChapter(bookId, chapterId) {
    const file = path.join(__dirname, 'bibles_raw', 'osmain', `${bookId}`, `${chapterId}.json`);
    if (!(file in osmainCache)) {
        osmainCache[file] = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf-8')) : null;
    }
    return osmainCache[file];
}

/**
 * Retter feltnavn og forkaster referanser som peker på et vers som ikke finnes.
 * Begge skriveveiene — generering og anvendt korrektur — går gjennom her.
 */
function normalizeReferences(refs, context = '') {
    const kept = [];
    for (const ref of refs) {
        // Fix common issue: verseId instead of fromVerseId
        if (ref.verseId !== undefined && ref.fromVerseId === undefined) {
            ref.fromVerseId = ref.verseId;
            delete ref.verseId;
        }
        // Ensure toVerseId defaults to fromVerseId
        if (ref.toVerseId === undefined && ref.fromVerseId !== undefined) {
            ref.toVerseId = ref.fromVerseId;
        }

        const {verdict, reason} = checkTarget(ref);
        const where = context ? ` i ${context}` : '';
        if (verdict === 'drop') {
            console.log(`  forkastet referanse${where}: ${reason}`);
            continue;
        }
        if (verdict === 'renumber') {
            // Riktig referanse, feil nummerering. Den beholdes — å slette den er å
            // miste en god kryssreferanse — men den skal gjennom KVN.
            console.log(`  NB${where}: ${reason}`);
        }
        kept.push(ref);
    }
    return kept;
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
    const result = await callWithRetry(prompt, {schema: REFERENCE_SCHEMA, local: useLocal, task: 'references', context: `${bookId}:${chapterId}:${verseId}`});

    const references = normalizeReferences(result.references, `${bookName} ${chapterId}:${verseId}`);

    const verse = {
        bookId,
        chapterId,
        verseId,
        references
    };

    ensureDir(filename);
    fs.writeFileSync(filename, JSON.stringify(verse, null, 2));
    console.log(`  Saved: ${filename} (${references.length} references)`);
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
    const result = await callWithRetry(prompt, {schema: REFERENCE_PROOFREAD_SCHEMA, local: useLocal, task: 'references', context: `proofread ${bookId}:${chapterId}:${verseId}`});

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
    const revisedRefs = normalizeReferences(proofreadResult.revisedReferences, `${getBookName(bookId, language)} ${chapterId}:${verseId} (korrektur)`);
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
        validate: false,
        fix: false,
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
        } else if (arg === '--local') {
            options.local = true;
        } else if (arg === '--force') {
            options.force = true;
        } else if (arg === '--validate') {
            options.validate = true;
        } else if (arg === '--fix') {
            options.fix = true;
        } else if (arg === '--help') {
            options.help = true;
        }
        i++;
    }

    return options;
}

/**
 * Sveiper referansefilene som alt ligger på disk med samme port som skrivingen.
 * Rapporterer som standard; `--fix` fjerner de ugyldige.
 */
function validateExisting(options) {
    const langCode = getLanguageCode(options.language);
    const root = path.join(__dirname, 'references', langCode);
    if (!fs.existsSync(root)) {
        console.log(`Ingen referanser for ${langCode} (${root} finnes ikke)`);
        return;
    }

    const bookDirs = fs.readdirSync(root).filter(n => /^\d+$/.test(n)).map(Number).sort((a, b) => a - b);
    let files = 0, total = 0, dropped = 0, renumber = 0, filesTouched = 0;
    const deadTargets = new Map();
    const renumberBooks = new Map();

    for (const bookId of bookDirs) {
        for (const chapterName of fs.readdirSync(path.join(root, `${bookId}`))) {
            const chapterDir = path.join(root, `${bookId}`, chapterName);
            if (!fs.statSync(chapterDir).isDirectory()) continue;
            for (const verseFile of fs.readdirSync(chapterDir).filter(n => n.endsWith('.json'))) {
                const file = path.join(chapterDir, verseFile);
                const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
                if (!Array.isArray(data.references)) continue;
                files++;
                total += data.references.length;

                const kept = [];
                for (const ref of data.references) {
                    const {verdict, reason} = checkTarget(ref);
                    const src = `${getBookName(data.bookId, options.language)} ${data.chapterId}:${data.verseId}`;
                    if (verdict === 'ok') {
                        kept.push(ref);
                        continue;
                    }
                    if (verdict === 'renumber') {
                        renumber++;
                        const book = books.find(b => b.id === ref.bookId);
                        renumberBooks.set(book?.name ?? ref.bookId, (renumberBooks.get(book?.name ?? ref.bookId) || 0) + 1);
                        kept.push(ref);   // riktig referanse — skal rettes, ikke slettes
                        continue;
                    }
                    dropped++;
                    const key = `${ref.bookId}:${ref.chapterId}`;
                    deadTargets.set(key, (deadTargets.get(key) || 0) + 1);
                    console.log(`  ${src} → ${reason}`);
                }

                if (kept.length !== data.references.length) {
                    filesTouched++;
                    if (options.fix) {
                        data.references = kept;
                        fs.writeFileSync(file, JSON.stringify(data, null, 2));
                    }
                }
            }
        }
    }

    console.log('---');
    console.log(`${langCode}: ${total} referanser i ${files} filer`);
    console.log(`${dropped} døde adresser i ${filesTouched} filer, ${deadTargets.size} unike døde mål`);
    if (renumber) {
        const top = [...renumberBooks.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
            .map(([name, n]) => `${name} ${n}`).join(', ');
        console.log(`${renumber} i europeisk nummerering — BEHOLDT, skal rettes gjennom KVN (${top})`);
    }
    if (dropped && !options.fix) console.log('Kjør med --fix for å fjerne de døde.');
}

async function main() {
    const args = process.argv.slice(2);
    const options = parseArgs(args);
    useLocal = options.local || false;

    options.language = normalizeLanguage(options.language);

    if (options.help) {
        printUsage();
        return;
    }

    if (options.validate) {
        validateExisting(options);
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

// Guard slik at checkTarget kan importeres (av tester, eller av et annet skript)
// uten at hele genereringen starter. Samme mønster som translations_meta.mjs.
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
    main().catch(console.error);
}
