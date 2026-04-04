import dotenv from 'dotenv'
import * as fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config()

import {books, normalizeLanguage, getLanguageCode, getBookName} from "./constants.js";
import {callWithRetry, callOllamaRaw} from "./llm.js";

let useLocal = false;

// Persons to generate - Tier 1 (main characters)
const personsList = [
    // Tier 1 - Main characters
    { id: "jesus", name: "Jesus", searchTerms: ["Jesus", "Kristus", "Messias", "Guds Sønn", "Menneskesønnen"] },
    { id: "abraham", name: "Abraham", searchTerms: ["Abraham", "Abram"] },
    { id: "moses", name: "Moses", searchTerms: ["Moses"] },
    { id: "david", name: "David", searchTerms: ["David"] },
    { id: "paulus", name: "Paulus", searchTerms: ["Paulus", "Saulus"] },
    { id: "peter", name: "Peter", searchTerms: ["Peter", "Simon Peter", "Kefas", "Simon"] },
    { id: "jakob-israel", name: "Jakob (Israel)", searchTerms: ["Jakob", "Israel"] },
    { id: "josef-gt", name: "Josef (sønn av Jakob)", searchTerms: ["Josef"] },
    { id: "isak", name: "Isak", searchTerms: ["Isak"] },
    { id: "noah", name: "Noah", searchTerms: ["Noah", "Noa"] },
    { id: "salomo", name: "Salomo", searchTerms: ["Salomo"] },
    { id: "johannes-apostel", name: "Johannes (apostel)", searchTerms: ["Johannes"] },

    // Tier 2 - Important characters
    { id: "elia", name: "Elia", searchTerms: ["Elia", "Elias"] },
    { id: "elisa", name: "Elisa", searchTerms: ["Elisa"] },
    { id: "samuel", name: "Samuel", searchTerms: ["Samuel"] },
    { id: "daniel", name: "Daniel", searchTerms: ["Daniel"] },
    { id: "jeremia", name: "Jeremia", searchTerms: ["Jeremia"] },
    { id: "jesaja", name: "Jesaja", searchTerms: ["Jesaja"] },
    { id: "josva", name: "Josva", searchTerms: ["Josva"] },
    { id: "rut", name: "Rut", searchTerms: ["Rut", "Ruth"] },
    { id: "ester", name: "Ester", searchTerms: ["Ester"] },
    { id: "maria-jesu-mor", name: "Maria (Jesu mor)", searchTerms: ["Maria"] },
    { id: "johannes-doperen", name: "Johannes døperen", searchTerms: ["Johannes", "døperen"] },
    { id: "judas-iskariot", name: "Judas Iskariot", searchTerms: ["Judas Iskariot"] },
    { id: "stefanus", name: "Stefanus", searchTerms: ["Stefanus"] },
    { id: "barnabas", name: "Barnabas", searchTerms: ["Barnabas"] },
    { id: "timoteus", name: "Timoteus", searchTerms: ["Timoteus"] },
    { id: "nehemja", name: "Nehemja", searchTerms: ["Nehemja"] },
    { id: "esra", name: "Esra", searchTerms: ["Esra"] },
    { id: "job", name: "Job", searchTerms: ["Job"] },
    { id: "adam", name: "Adam", searchTerms: ["Adam"] },
    { id: "eva", name: "Eva", searchTerms: ["Eva"] },
];

// Roles in Norwegian
const roles = {
    prophet: "profet",
    king: "konge",
    judge: "dommer",
    priest: "prest",
    apostle: "apostel",
    disciple: "disippel",
    leader: "leder",
    matriarch: "matriark",
    patriarch: "patriark",
    martyr: "martyr",
    warrior: "kriger",
    wiseman: "vismann"
};

// Eras (linked to timeline periods)
const eras = {
    creation: "Skapelsen",
    patriarchs: "Patriarkene",
    exodus: "Utgang fra Egypt",
    conquest: "Erobringen",
    judges: "Dommertiden",
    "united-kingdom": "Det forente kongerike",
    "divided-kingdom": "Det delte kongerike",
    exile: "Eksilet",
    return: "Tilbakekomsten",
    intertestamental: "Mellomtestamentlig tid",
    jesus: "Jesu tid",
    "early-church": "Den tidlige kirke"
};

const PERSON_SCHEMA = {
    type: "object",
    properties: {
        id: {type: "string"},
        name: {type: "string"},
        title: {type: "string"},
        era: {type: "string", enum: ["creation", "patriarchs", "exodus", "conquest", "judges", "united-kingdom", "divided-kingdom", "exile", "return", "intertestamental", "jesus", "early-church"]},
        lifespan: {type: "string"},
        summary: {type: "string"},
        roles: {type: "array", items: {type: "string"}},
        family: {
            type: "object",
            properties: {
                father: {type: ["string", "null"]},
                mother: {type: ["string", "null"]},
                siblings: {type: "array", items: {type: "string"}},
                spouse: {type: ["string", "null"]},
                children: {type: "array", items: {type: "string"}}
            },
            required: ["father", "mother", "siblings", "spouse", "children"],
            additionalProperties: false
        },
        relatedPersons: {type: "array", items: {type: "string"}},
        keyEvents: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    title: {type: "string"},
                    description: {type: "string"},
                    verses: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                bookId: {type: "integer"},
                                chapter: {type: "integer"},
                                verses: {type: "array", items: {type: "integer"}}
                            },
                            required: ["bookId", "chapter", "verses"],
                            additionalProperties: false
                        }
                    }
                },
                required: ["title", "description", "verses"],
                additionalProperties: false
            }
        }
    },
    required: ["id", "name", "title", "era", "summary", "roles", "family", "relatedPersons", "keyEvents"],
    additionalProperties: false
};

async function generatePerson(personConfig) {
    const { id, name } = personConfig;
    const outputPath = path.join(__dirname, "persons", "nb", `${id}.json`);

    // Skip if already exists
    if (fs.existsSync(outputPath)) {
        console.log(`Skipping ${name} - already exists`);
        return;
    }

    console.log(`Generating profile for ${name}...`);

    const prompt = `Generate a comprehensive biblical character profile for ${name} in Norwegian bokmål.
The profile should follow this exact JSON structure:

{
  "id": "${id}",
  "name": "${name}",
  "title": "<kort beskrivende tittel, f.eks. 'Troens far' eller 'Israels konge'>",
  "era": "<en av: creation, patriarchs, exodus, conquest, judges, united-kingdom, divided-kingdom, exile, return, intertestamental, jesus, early-church>",
  "lifespan": "<omtrentlig levetid hvis kjent, f.eks. 'ca. 2000 f.Kr.' eller '?'>",
  "summary": "<2-3 setninger som oppsummerer personen og deres betydning>",
  "roles": [<liste med roller fra: profet, konge, dommer, prest, apostel, disippel, leder, matriark, patriark, martyr, kriger, vismann>],
  "family": {
    "father": "<fars id eller null>",
    "mother": "<mors id eller null>",
    "siblings": [<liste med søskens id-er>],
    "spouse": "<ektefelles id eller null>",
    "children": [<liste med barns id-er>]
  },
  "relatedPersons": [<liste med andre relaterte personers id-er>],
  "keyEvents": [
    {
      "title": "<kort tittel>",
      "description": "<1-2 setninger>",
      "verses": [{ "bookId": <1-66>, "chapter": <nummer>, "verses": [<vers-nummer>] }]
    }
  ]
}

Important guidelines:
1. Use lowercase IDs for family members and related persons (e.g., "abraham", "sara", "isak")
2. Include 4-6 key events that are most significant for this person
3. For keyEvents verses, use accurate book IDs: OT books 1-39, NT books 40-66
4. All descriptions and text should be in Norwegian bokmål
5. Be historically and biblically accurate
6. Include both OT and NT references where relevant (e.g., for Abraham include Hebrews references)
`;

    try {
        const personData = await callWithRetry(prompt, {schema: PERSON_SCHEMA, local: useLocal, context: `person ${id}`});
        fs.writeFileSync(outputPath, JSON.stringify(personData, null, 2));
        console.log(`  Written: ${outputPath}`);
    } catch (error) {
        console.error(`Error generating ${name}:`, error.message);
    }
}

// --- Index mode: scan bible for person names ---

const VALIDATE_NAME_SCHEMA = {
    type: "object",
    properties: {
        isPerson: {type: "boolean"},
        canonicalName: {type: "string"},
        aliases: {type: "array", items: {type: "string"}},
        aliasFor: {type: ["string", "null"]},
        explanation: {type: "string"}
    },
    required: ["isPerson", "canonicalName"],
    additionalProperties: false
};

const DISAMBIGUATE_SCHEMA = {
    type: "object",
    properties: {
        existingId: {type: ["string", "null"]},
        isNew: {type: "boolean"},
        disambiguation: {type: "string"}
    },
    required: ["existingId", "isNew"],
    additionalProperties: false
};

async function ollamaExtractPersons(verse) {
    const prompt = `List opp alle personnavn i dette bibelverset.

INKLUDER: Navn på mennesker, engler og guddommelige personer (f.eks. "Abram", "Sarai", "Gabriel", "Jesus").
IKKE INKLUDER: Stedsnavn (Egypt, Salem, Jordan), folkeslag (egyptere, kanaaneere), nasjonaliteter, titler brukt alene (Herren, Gud, kongen, farao).

Bruk grunnformen av navnet (f.eks. "Abram" ikke "Abrams", "Sara" ikke "Saras").

"${verse}"

Svar BARE med en kommaseparert liste av personnavn i grunnform, eller "ingen".`;

    try {
        const answer = await callOllamaRaw(prompt, {numPredict: 200});
        if (!answer || answer.toLowerCase() === 'ingen' || answer.toLowerCase() === 'none') return [];
        return answer.split(',').map(n => n.trim()).filter(n => n.length > 0 && !n.match(/^\d+$/));
    } catch (error) {
        console.warn(`\n  Ollama error: ${error.message}`);
        return [];
    }
}

// Ask Claude to validate if a name is actually a person
async function claudeValidateName(name, verse) {
    const prompt = `I dette bibelverset forekommer "${name}":
"${verse}"

Er "${name}" et personnavn (menneske, engel, guddommelig person)?
Ikke godkjenn stedsnavn, folkeslag, nasjonaliteter eller titler.
Hvis det er et personnavn:
- canonicalName: den mest kjente formen av navnet (f.eks. "Abrams" → "Abraham", "Sarai" → "Sara")
- aliases: alle andre kjente former av navnet (f.eks. Abraham → ["Abram"], Sara → ["Sarai"], Peter → ["Simon", "Kefas"])
- aliasFor: hvis navnet er et alias/eldre form, sett dette til det kanoniske navnet (f.eks. for "Sarai" → aliasFor: "Sara", for "Abram" → aliasFor: "Abraham"). Null hvis dette allerede er det kanoniske navnet.`;

    try {
        return await callWithRetry(prompt, {schema: VALIDATE_NAME_SCHEMA, local: useLocal, context: `validate ${name}`});
    } catch {
        return {isPerson: false, canonicalName: name};
    }
}

// Ask Claude to disambiguate a name against existing persons
async function claudeDisambiguate(name, verse, existingPersons) {
    const personSummaries = existingPersons.map(p =>
        `- id="${p.id}": ${p.name} — ${p.title || ''} (${p.era || ''})`
    ).join('\n');

    const prompt = `I dette bibelverset nevnes "${name}":
"${verse}"

Vi har allerede disse personene med lignende navn:
${personSummaries}

Er personen i verset en av de ovennevnte, eller en ny/annen person?
Hvis kjent, sett existingId til personens id. Hvis ny, sett isNew=true og gi en kort disambiguation (f.eks. "Kleopas' hustru").`;

    try {
        return await callWithRetry(prompt, {schema: DISAMBIGUATE_SCHEMA, local: useLocal, context: `disambiguate ${name}`});
    } catch {
        return {existingId: null, isNew: false};
    }
}

function findExistingPersonFiles(name, personsDir) {
    const slug = nameToId(name);
    const files = fs.readdirSync(personsDir).filter(f => f.endsWith('.json'));
    return files.filter(f => f === `${slug}.json` || f.startsWith(`${slug}-`));
}

function addReference(personFile, bookId, chapterId, verseId) {
    const data = JSON.parse(fs.readFileSync(personFile, 'utf-8'));
    if (!data.references) data.references = [];

    const refKey = `${bookId}:${chapterId}:${verseId}`;
    const exists = data.references.some(r =>
        `${r.bookId}:${r.chapterId}:${r.verseId}` === refKey
    );
    if (exists) return false;

    data.references.push({bookId, chapterId, verseId});
    fs.writeFileSync(personFile, JSON.stringify(data, null, 2));
    return true;
}

function countBibleVerses(bible, bookStart, bookEnd, chapterStart, chapterEnd) {
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
            total += verses.length;
        }
    }
    return total;
}

async function indexBible(bible, options = {}) {
    const bibleDir = path.join(__dirname, 'bibles_raw', bible);
    if (!fs.existsSync(bibleDir)) {
        console.error(`Bible translation not found: ${bibleDir}`);
        return;
    }

    const personsDir = path.join(__dirname, 'persons', 'nb');
    if (!fs.existsSync(personsDir)) {
        fs.mkdirSync(personsDir, {recursive: true});
    }

    const bookStart = options.bookStart || 1;
    const bookEnd = options.bookEnd || 66;
    const chapterStart = options.chapterStart || null;
    const chapterEnd = options.chapterEnd || null;

    const totalVerses = countBibleVerses(bible, bookStart, bookEnd, chapterStart, chapterEnd);
    console.log(`\nIndexing persons in ${bible} (${totalVerses} verses)...`);
    if (bookStart !== 1 || bookEnd !== 66) console.log(`  Books: ${bookStart}-${bookEnd}`);
    if (chapterStart) console.log(`  Chapters: ${chapterStart}-${chapterEnd}`);
    console.log('');

    // Map: lowercase name/alias → person file path (for quick lookup)
    const nameToFile = {};
    // Set of names we've validated as NOT persons (skip in future)
    const notPersons = new Set();

    const existingFiles = fs.readdirSync(personsDir).filter(f => f.endsWith('.json'));
    for (const f of existingFiles) {
        const filePath = path.join(personsDir, f);
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        nameToFile[data.name.toLowerCase()] = filePath;
        // Register aliases too
        if (data.aliases) {
            for (const alias of data.aliases) {
                nameToFile[alias.toLowerCase()] = filePath;
            }
        }
    }
    console.log(`  ${existingFiles.length} existing persons loaded (${Object.keys(nameToFile).length} names/aliases)\n`);

    let processed = 0;
    let newPersons = 0;
    let refsAdded = 0;
    const startTime = Date.now();

    for (const book of books) {
        if (book.id < bookStart || book.id > bookEnd) continue;
        const bookDir = path.join(bibleDir, String(book.id));
        if (!fs.existsSync(bookDir)) continue;

        const bookName = getBookName(book.id, 'Norwegian bokmål');
        const startCh = (book.id === bookStart && chapterStart) ? chapterStart : 1;
        const endCh = (book.id === bookEnd && chapterEnd) ? Math.min(chapterEnd, book.chapters) : book.chapters;

        for (let chapterId = startCh; chapterId <= endCh; chapterId++) {
            const chapterFile = path.join(bookDir, `${chapterId}.json`);
            if (!fs.existsSync(chapterFile)) continue;

            const verses = JSON.parse(fs.readFileSync(chapterFile, 'utf-8'));
            for (const verse of verses) {
                processed++;
                const pct = Math.round((processed / totalVerses) * 100);
                const elapsed = (Date.now() - startTime) / 1000;
                const rate = processed / elapsed;
                const remaining = Math.round((totalVerses - processed) / rate);
                const mins = Math.floor(remaining / 60);
                const secs = remaining % 60;
                process.stdout.write(`\r  [${pct}%] ${processed}/${totalVerses} — ${bookName} ${chapterId}:${verse.verseId} — ${refsAdded} refs, ${newPersons} new — ~${mins}m${secs}s left${''.padEnd(10)}`);

                const names = await ollamaExtractPersons(verse.text);

                for (const rawName of names) {
                    const nameLower = rawName.toLowerCase();

                    // Skip names we've already rejected
                    if (notPersons.has(nameLower)) continue;

                    // Known person — just add reference
                    if (nameToFile[nameLower]) {
                        const added = addReference(nameToFile[nameLower], verse.bookId, verse.chapterId, verse.verseId);
                        if (added) refsAdded++;
                        continue;
                    }

                    // Unknown name — check existing files by slug
                    const matchingFiles = findExistingPersonFiles(rawName, personsDir);

                    if (matchingFiles.length >= 1) {
                        // Slug matches but name differs — disambiguate with Claude
                        const existingPersons = matchingFiles.map(f =>
                            JSON.parse(fs.readFileSync(path.join(personsDir, f), 'utf-8'))
                        );
                        process.stdout.write(`\n  Disambiguating "${rawName}" — asking Claude...`);
                        const result = await claudeDisambiguate(rawName, verse.text, existingPersons);

                        if (result.existingId) {
                            // Known person — map name and add reference
                            const file = path.join(personsDir, `${result.existingId}.json`);
                            if (fs.existsSync(file)) {
                                nameToFile[nameLower] = file;
                                addReference(file, verse.bookId, verse.chapterId, verse.verseId);
                                refsAdded++;
                            }
                            process.stdout.write(` → ${result.existingId}\n`);
                        } else if (result.isNew && result.disambiguation) {
                            const newId = nameToId(rawName) + '-' + nameToId(result.disambiguation);
                            process.stdout.write(` → new: ${newId}\n`);
                            await generatePerson({id: newId, name: `${rawName} (${result.disambiguation})`});
                            const file = path.join(personsDir, `${newId}.json`);
                            if (fs.existsSync(file)) {
                                nameToFile[nameLower] = file;
                                addReference(file, verse.bookId, verse.chapterId, verse.verseId);
                                refsAdded++;
                            }
                            newPersons++;
                        } else {
                            nameToFile[nameLower] = path.join(personsDir, matchingFiles[0]);
                            addReference(nameToFile[nameLower], verse.bookId, verse.chapterId, verse.verseId);
                            refsAdded++;
                        }
                        continue;
                    }

                    // Completely new name — validate with Claude first
                    process.stdout.write(`\n  New name "${rawName}" — validating with Claude...`);
                    const validation = await claudeValidateName(rawName, verse.text);

                    if (!validation.isPerson) {
                        notPersons.add(nameLower);
                        process.stdout.write(` → not a person\n`);
                        continue;
                    }

                    // Claude confirmed it's a person
                    const canonicalName = validation.canonicalName || rawName;
                    const aliases = validation.aliases || [];
                    const aliasFor = validation.aliasFor || null;
                    const id = nameToId(canonicalName);
                    const file = path.join(personsDir, `${id}.json`);

                    // Check if canonical name, aliasFor, or any alias already exists
                    const allNames = [canonicalName, ...aliases];
                    if (aliasFor) allNames.push(aliasFor);
                    let existingFile = null;
                    for (const n of allNames) {
                        if (nameToFile[n.toLowerCase()]) {
                            existingFile = nameToFile[n.toLowerCase()];
                            break;
                        }
                    }

                    if (existingFile) {
                        // Map all names/aliases to this file
                        nameToFile[nameLower] = existingFile;
                        for (const a of aliases) nameToFile[a.toLowerCase()] = existingFile;
                        addReference(existingFile, verse.bookId, verse.chapterId, verse.verseId);
                        refsAdded++;
                        // Add aliases to the existing file if not already there
                        const existingData = JSON.parse(fs.readFileSync(existingFile, 'utf-8'));
                        const existingAliases = existingData.aliases || [];
                        let aliasesChanged = false;
                        for (const a of aliases) {
                            if (!existingAliases.includes(a) && a.toLowerCase() !== existingData.name.toLowerCase()) {
                                existingAliases.push(a);
                                aliasesChanged = true;
                            }
                        }
                        if (aliasesChanged) {
                            existingData.aliases = existingAliases;
                            fs.writeFileSync(existingFile, JSON.stringify(existingData, null, 2));
                        }
                        process.stdout.write(` → exists as ${path.basename(existingFile, '.json')}\n`);
                        continue;
                    }

                    process.stdout.write(` → generating ${id}...`);
                    await generatePerson({id, name: canonicalName});
                    if (fs.existsSync(file)) {
                        // Add aliases to the new file
                        if (aliases.length > 0) {
                            const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
                            data.aliases = aliases;
                            fs.writeFileSync(file, JSON.stringify(data, null, 2));
                        }
                        nameToFile[nameLower] = file;
                        nameToFile[canonicalName.toLowerCase()] = file;
                        for (const a of aliases) nameToFile[a.toLowerCase()] = file;
                        addReference(file, verse.bookId, verse.chapterId, verse.verseId);
                        refsAdded++;
                    }
                    newPersons++;
                    process.stdout.write(` done\n`);
                }
            }
        }
    }

    process.stdout.write('\r' + ''.padEnd(100) + '\r');
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(`\nDone in ${Math.floor(elapsed / 60)}m${elapsed % 60}s — ${processed} verses, ${refsAdded} refs added, ${newPersons} new persons`);
}

function nameToId(name) {
    return name
        .replace(/\s*\([^)]*\)/g, "") // Remove parentheses and their content
        .trim()
        .toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Remove accents
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9-]/g, "");
}

function parseRange(value) {
    if (value.includes('-')) {
        const [start, end] = value.split('-').map(n => parseInt(n, 10));
        return {start, end};
    }
    const num = parseInt(value, 10);
    return {start: num, end: num};
}

function printUsage() {
    console.log(`
Usage: node bible_persons.mjs [options] [person-id|name|all]

Modes:
  <person-id|name>     Generate a single person profile
  all                  Generate all pre-defined persons
  --index              Scan bible for person names with Ollama

Options:
  --bible <name>       Bible translation to scan (required for --index, e.g., osnb2)
  --book <range>       Process book(s): single (43) or range (1-20)
  --chapter <range>    Process chapter(s): single (1) or range (1-10)
  --ot                 Process only Old Testament (books 1-39)
  --nt                 Process only New Testament (books 40-66)
  --local              Use Ollama instead of Claude for generation
  --help               Show this help message

Examples:
  node bible_persons.mjs abraham                            # Generate Abraham
  node bible_persons.mjs "Set (Adams sønn)"                 # Generate new person
  node bible_persons.mjs all                                # Generate all pre-defined
  node bible_persons.mjs --bible osnb2 --index              # Index entire bible
  node bible_persons.mjs --bible osnb2 --index --book 1     # Index Genesis only
  node bible_persons.mjs --bible osnb2 --index --nt         # Index NT only
`);
}

async function main() {
    const args = process.argv.slice(2);

    const options = {
        index: false,
        bible: null,
        bookStart: null,
        bookEnd: null,
        chapterStart: null,
        chapterEnd: null,
        local: false,
        help: false,
    };
    const positional = [];

    let i = 0;
    while (i < args.length) {
        const arg = args[i];
        if (arg === '--index') {
            options.index = true;
        } else if (arg === '--bible' && i + 1 < args.length) {
            options.bible = args[++i];
        } else if (arg === '--book' && i + 1 < args.length) {
            const range = parseRange(args[++i]);
            options.bookStart = range.start;
            options.bookEnd = range.end;
        } else if (arg === '--chapter' && i + 1 < args.length) {
            const range = parseRange(args[++i]);
            options.chapterStart = range.start;
            options.chapterEnd = range.end;
        } else if (arg === '--ot') {
            options.bookStart = 1;
            options.bookEnd = 39;
        } else if (arg === '--nt') {
            options.bookStart = 40;
            options.bookEnd = 66;
        } else if (arg === '--local') {
            options.local = true;
        } else if (arg === '--help') {
            options.help = true;
        } else {
            positional.push(arg);
        }
        i++;
    }

    useLocal = options.local;

    if (options.help) {
        printUsage();
        return;
    }

    if (options.index) {
        if (!options.bible) {
            console.error('--index requires --bible <name>');
            return;
        }
        await indexBible(options.bible, options);
        return;
    }

    const input = positional.join(" ");

    if (!input) {
        printUsage();
        return;
    }

    if (input === "all") {
        for (const person of personsList) {
            await generatePerson(person);
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    } else {
        let person = personsList.find(p => p.id === input);
        if (!person) {
            person = personsList.find(p => p.name.toLowerCase() === input.toLowerCase());
        }
        if (!person) {
            const id = nameToId(input);
            person = {id, name: input, searchTerms: [input]};
            console.log(`Creating new person: ${input} (id: ${id})`);
        }
        await generatePerson(person);
    }
}

main();
