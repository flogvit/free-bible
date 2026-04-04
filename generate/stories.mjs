import dotenv from 'dotenv'
import * as fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config()

import Anthropic from '@anthropic-ai/sdk';
import {books, anthropicModel, maxTokens, getBookName} from "./constants.js";

const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
});

const MAX_RETRIES = 3;

const STORIES_DIR = path.join(__dirname, 'stories', 'nb');
const PROOFREAD_DIR = path.join(__dirname, 'proofread_stories', 'nb');
const OSNB2_DIR = path.join(__dirname, 'bibles_raw', 'osnb2');

const VALID_CATEGORIES = [
    "skapelsen", "patriarkene", "moses", "oerkenvandringen", "landnaam",
    "dommerne", "kongetiden", "profetene", "eksil", "visdomslitteratur",
    "jesus-liv", "jesu-mirakler", "jesu-lignelser", "jesu-lidelse",
    "urkirken", "paulus"
];

// --- Schemas ---

const STORY_SCHEMA = {
    type: "object",
    properties: {
        slug: {type: "string"},
        title: {type: "string"},
        keywords: {type: "array", items: {type: "string"}},
        description: {type: "string"},
        category: {type: "string"},
        references: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    bookId: {type: "integer"},
                    startChapter: {type: "integer"},
                    startVerse: {type: "integer"},
                    endChapter: {type: "integer"},
                    endVerse: {type: "integer"}
                },
                required: ["bookId", "startChapter", "startVerse", "endChapter", "endVerse"],
                additionalProperties: false
            }
        }
    },
    required: ["slug", "title", "keywords", "description", "category", "references"],
    additionalProperties: false
};

const STORY_PROOFREAD_SCHEMA = {
    type: "object",
    properties: {
        issues: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    field: {type: "string", enum: ["slug", "title", "keywords", "description", "category", "references"]},
                    severity: {type: "string", enum: ["critical", "major", "minor"]},
                    explanation: {type: "string"},
                    current: {type: "string"},
                    suggested: {type: "string"}
                },
                required: ["field", "severity", "explanation"],
                additionalProperties: false
            }
        },
        summary: {type: "string"},
        score: {type: "integer"},
        revisedStory: STORY_SCHEMA
    },
    required: ["issues", "summary", "score", "revisedStory"],
    additionalProperties: false
};

const GENERATE_STORIES_SCHEMA = {
    type: "object",
    properties: {
        stories: {
            type: "array",
            items: STORY_SCHEMA
        }
    },
    required: ["stories"],
    additionalProperties: false
};

// --- Helpers ---

function fileExists(filepath) {
    return fs.existsSync(filepath) && fs.statSync(filepath).size > 0;
}

function ensureDir(filepath) {
    const dir = path.dirname(filepath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, {recursive: true});
    }
}

function getOsnb2Verses(bookId, chapterId) {
    const filepath = path.join(OSNB2_DIR, `${bookId}`, `${chapterId}.json`);
    if (!fileExists(filepath)) return [];
    return JSON.parse(fs.readFileSync(filepath, 'utf-8'));
}

function getPassageText(bookId, startChapter, startVerse, endChapter, endVerse) {
    const lines = [];
    const book = books.find(b => b.id === bookId);
    if (!book) return null;

    const bookName = getBookName(bookId, 'Norwegian bokmål');

    for (let ch = startChapter; ch <= endChapter; ch++) {
        const verses = getOsnb2Verses(bookId, ch);
        if (verses.length === 0) return null;

        const fromV = (ch === startChapter) ? startVerse : 1;
        const toV = (ch === endChapter) ? endVerse : Math.max(...verses.map(v => v.verseId));

        for (const v of verses) {
            if (v.verseId >= fromV && v.verseId <= toV) {
                lines.push(`${bookName} ${ch}:${v.verseId} — ${v.text}`);
            }
        }
    }
    return lines.length > 0 ? lines.join('\n') : null;
}

function loadAllStories() {
    const stories = [];
    if (!fs.existsSync(STORIES_DIR)) return stories;
    for (const file of fs.readdirSync(STORIES_DIR)) {
        if (!file.endsWith('.json')) continue;
        try {
            const data = JSON.parse(fs.readFileSync(path.join(STORIES_DIR, file), 'utf-8'));
            stories.push({filename: file, ...data});
        } catch (e) {
            console.error(`Error reading ${file}: ${e.message}`);
        }
    }
    return stories;
}

// --- Anthropic calls ---

async function doAnthropicCall(content, schema) {
    const options = {
        model: anthropicModel,
        max_tokens: maxTokens,
        messages: [{role: "user", content}]
    };
    if (schema) {
        options.output_config = {format: {type: "json_schema", schema}};
    }
    return anthropic.messages.create(options);
}

async function doAnthropicCallWithRetry(content, schema, context = '') {
    let lastError;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const completion = await doAnthropicCall(content, schema);
            if (completion.stop_reason === 'max_tokens') {
                throw new Error('Response truncated due to max_tokens limit');
            }
            return JSON.parse(completion.content[0].text);
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

// --- Proofread ---

function getProofreadPrompt(story, passageTexts) {
    const storyJson = JSON.stringify(story, null, 2);
    const categoriesList = VALID_CATEGORIES.join(', ');

    return `Du er en korrekturleser for bibelhistorier i et digitalt bibelprosjekt.
Gå gjennom følgende historie og verifiser at alt er korrekt.

Historien:
${storyJson}

Bibeltekst (osnb2) for de refererte passasjene:
${passageTexts}

Din oppgave er å verifisere:

1. **slug**: Skal være en god URL-vennlig identifikator med bindestreker, på norsk, som matcher tittelen.
2. **title**: Skal være en korrekt og dekkende tittel på norsk bokmål for denne bibelhistorien.
3. **keywords**: Skal inneholde relevante søkeord (lowercase) som hjelper brukere å finne historien. Sjekk at viktige nøkkelord er med og at ingen er irrelevante.
4. **description**: Skal være en presis 1-2 setningers oppsummering som faktisk samsvarer med bibelteksten. Sjekk at den ikke inneholder feil eller påstander som ikke stemmer med teksten.
5. **category**: Må være en av disse: ${categoriesList}. Sjekk at valgt kategori passer for historien.
6. **references**: Dette er den viktigste sjekken. Les bibelteksten nøye og verifiser at den faktisk inneholder historien som beskrives:
   - Inneholder den oppgitte bibelteksten faktisk denne historien? Hvis ikke, er referansene feil.
   - bookId er korrekt (1-39 GT, 40-66 NT)
   - startChapter/startVerse og endChapter/endVerse er fornuftige og dekker hele historien
   - Referansene starter ikke for sent eller slutter for tidlig

Hvis referansene er FEIL (teksten handler om noe annet enn historien):
- Bruk din bibelkunnskap til å finne de korrekte referansene.
- bookId-oversikt: 1=1.Mos, 2=2.Mos, 3=3.Mos, 4=4.Mos, 5=5.Mos, 6=Josva, 7=Dommerne, 8=Rut, 9=1.Sam, 10=2.Sam, 11=1.Kong, 12=2.Kong, 13=1.Krøn, 14=2.Krøn, 15=Esra, 16=Nehemja, 17=Ester, 18=Job, 19=Salmene, 20=Ordspråkene, 21=Forkynneren, 22=Høysangen, 23=Jesaja, 24=Jeremia, 25=Klagesangene, 26=Esekiel, 27=Daniel, 28=Hosea, 29=Joel, 30=Amos, 31=Obadja, 32=Jona, 33=Mika, 34=Nahum, 35=Habakkuk, 36=Sefanja, 37=Haggai, 38=Sakarja, 39=Malaki, 40=Matteus, 41=Markus, 42=Lukas, 43=Johannes, 44=Apostlenes gjerninger, 45=Romerne, 46=1.Kor, 47=2.Kor, 48=Galaterne, 49=Efeserne, 50=Filipperne, 51=Kolosserne, 52=1.Tess, 53=2.Tess, 54=1.Tim, 55=2.Tim, 56=Titus, 57=Filemon, 58=Hebreerne, 59=Jakob, 60=1.Peter, 61=2.Peter, 62=1.Johannes, 63=2.Johannes, 64=3.Johannes, 65=Judas, 66=Åpenbaringen

REFERANSEFORMAT:
Bibelreferanser i description-feltet bruker formatet: [ref:FORKORTELSE KAPITTEL:VERS|VISNINGSTEKST]
Eksempel: [ref:Joh 3:16|Johannes 3:16]. Bevar dette formatet i revisedStory.
Bruk KVN-forkortelser (1 Mos, Sal, Joh, Åp osv.) i ref-delen og fullt boknavn i visningsteksten.

VIKTIG:
- Hvis historien er god som den er, returner en tom issues-array og returner den uendrede historien i revisedStory.
- Hvis du foreslår endringer, returner den komplette reviderte historien i revisedStory.
- Feil referanser er KRITISK og skal gi lav score.
- score er 0-10 der 10 er perfekt.
- ALDRI nevn spesifikke bibelutgaver, bibelselskap eller forlag (f.eks. "Bibelen 2011", "Bibelselskapet", "NIV", "ESV"). Skriv nøytralt uten referanse til bestemte oversettelser eller organisasjoner.`;
}

async function proofreadStory(story, filename) {
    // Build passage texts from osnb2
    const passageParts = [];
    let missingPassage = false;

    for (const ref of story.references) {
        const text = getPassageText(ref.bookId, ref.startChapter, ref.startVerse, ref.endChapter, ref.endVerse);
        if (text) {
            passageParts.push(text);
        } else {
            const bookName = getBookName(ref.bookId, 'Norwegian bokmål');
            passageParts.push(`[Mangler osnb2-tekst for ${bookName} ${ref.startChapter}:${ref.startVerse}-${ref.endChapter}:${ref.endVerse}]`);
            missingPassage = true;
        }
    }

    const passageTexts = passageParts.join('\n\n');

    console.log(`Proofreading: ${story.title} (${filename})${missingPassage ? ' [delvis manglende tekst]' : ''}...`);

    const prompt = getProofreadPrompt(story, passageTexts);
    const result = await doAnthropicCallWithRetry(prompt, STORY_PROOFREAD_SCHEMA, `proofread ${filename}`);

    // Save proofread result
    const proofreadFile = path.join(PROOFREAD_DIR, filename);
    ensureDir(proofreadFile);
    fs.writeFileSync(proofreadFile, JSON.stringify(result, null, 2));

    // Print summary
    process.stdout.write(`  Score: ${result.score}/10`);
    if (result.issues && result.issues.length > 0) {
        console.log(` | Issues: ${result.issues.length}`);
        result.issues.forEach((issue, i) => {
            console.log(`    ${i + 1}. [${issue.severity}] ${issue.field}: ${issue.explanation}`);
            if (issue.current) console.log(`       Nå: ${issue.current}`);
            if (issue.suggested) console.log(`       Forslag: ${issue.suggested}`);
        });
    } else {
        console.log(' | No issues');
    }

    return result;
}

// --- Apply ---

// Returns { applied, refsChanged, newFilename } or null if nothing applied
function applyProofreadChanges(filename, proofreadResult = null, minScore = 7) {
    if (!proofreadResult) {
        const proofreadFile = path.join(PROOFREAD_DIR, filename);
        if (!fileExists(proofreadFile)) {
            console.log(`No proofread file for ${filename}`);
            return null;
        }
        proofreadResult = JSON.parse(fs.readFileSync(proofreadFile, 'utf-8'));
    }

    if (!proofreadResult.revisedStory) return null;
    if (proofreadResult.issues.length === 0) {
        console.log(`  No changes for ${filename} (score: ${proofreadResult.score}/10)`);
        return null;
    }

    if (proofreadResult.score >= minScore) {
        console.log(`  Skipping apply for ${filename} (score ${proofreadResult.score}/10 >= ${minScore}, good enough)`);
        return null;
    }

    const storyFile = path.join(STORIES_DIR, filename);
    const original = JSON.parse(fs.readFileSync(storyFile, 'utf-8'));
    const revised = proofreadResult.revisedStory;

    // Show what changed
    const fields = ['slug', 'title', 'description', 'category'];
    for (const field of fields) {
        if (JSON.stringify(original[field]) !== JSON.stringify(revised[field])) {
            console.log(`  ${field}: "${original[field]}" → "${revised[field]}"`);
        }
    }
    if (JSON.stringify(original.keywords) !== JSON.stringify(revised.keywords)) {
        const added = revised.keywords.filter(k => !original.keywords.includes(k));
        const removed = original.keywords.filter(k => !revised.keywords.includes(k));
        if (added.length) console.log(`  keywords added: ${added.join(', ')}`);
        if (removed.length) console.log(`  keywords removed: ${removed.join(', ')}`);
    }
    const refsChanged = JSON.stringify(original.references) !== JSON.stringify(revised.references);
    if (refsChanged) {
        console.log(`  references: updated (${original.references.length} → ${revised.references.length})`);
    }

    // If slug changed, we need to rename the file
    const newFilename = revised.slug + '.json';
    const newStoryFile = path.join(STORIES_DIR, newFilename);

    if (newFilename !== filename && fileExists(newStoryFile)) {
        console.log(`  WARNING: Cannot rename ${filename} → ${newFilename} (target file already exists). Keeping original filename.`);
        revised.slug = filename.replace('.json', '');
        fs.writeFileSync(storyFile, JSON.stringify(revised, null, 2));
    } else {
        fs.writeFileSync(newStoryFile, JSON.stringify(revised, null, 2));
        if (newFilename !== filename) {
            fs.unlinkSync(storyFile);
            console.log(`  Renamed ${filename} → ${newFilename}`);
        }
    }

    console.log(`  Applied revisions to ${revised.title}`);
    return { applied: true, refsChanged, newFilename };
}

// --- Generate ---

function getGeneratePrompt(existingTitles, category = null) {
    const categoriesList = VALID_CATEGORIES.join(', ');
    const existingList = existingTitles.join('\n- ');

    let categoryInstruction = '';
    if (category) {
        categoryInstruction = `\nGenerer BARE historier i kategorien "${category}".`;
    }

    return `Du er en ekspert på Bibelen og skal generere metadata for bibelhistorier til et digitalt bibelprosjekt.

Følgende historier finnes allerede:
- ${existingList}

Generer 10 nye bibelhistorier som IKKE finnes i listen over. Velg kjente, viktige historier som mangler.${categoryInstruction}

Gyldige kategorier: ${categoriesList}

For hver historie, generer:
- slug: URL-vennlig identifikator med bindestreker, på norsk
- title: Tittel på norsk bokmål
- keywords: Relevante søkeord (lowercase, norsk)
- description: 1-2 setningers oppsummering på norsk bokmål
- category: En av de gyldige kategoriene
- references: Array med bibelreferanser (bookId 1-39 for GT, 40-66 for NT)

REFERANSEFORMAT:
Når du refererer til bibelsteder i description-feltet, bruk formatet: [ref:FORKORTELSE KAPITTEL:VERS|VISNINGSTEKST]
Eksempel: [ref:Joh 3:16|Johannes 3:16], [ref:1 Mos 1:1-3|1. Mosebok 1:1-3]
Bruk KVN-forkortelser (1 Mos, Sal, Joh, Åp osv.) i ref-delen og fullt boknavn i visningsteksten.

VIKTIG:
- Hver referanse må ha korrekte bookId, startChapter, startVerse, endChapter, endVerse
- Sjekk at kapitlene og versene faktisk eksisterer i Bibelen
- Velg historier som er tydelig avgrenset i teksten
- Ikke dupliser eksisterende historier
- ALDRI nevn spesifikke bibelutgaver, bibelselskap eller forlag (f.eks. "Bibelen 2011", "Bibelselskapet", "NIV", "ESV"). Skriv nøytralt uten referanse til bestemte oversettelser eller organisasjoner.`;
}

async function generateStories(existingTitles, category) {
    console.log('Generating new stories...');

    const prompt = getGeneratePrompt(existingTitles, category);
    const result = await doAnthropicCallWithRetry(prompt, GENERATE_STORIES_SCHEMA, 'generate stories');

    const existingSlugs = new Set(
        fs.readdirSync(STORIES_DIR)
            .filter(f => f.endsWith('.json'))
            .map(f => f.replace('.json', ''))
    );

    const existingTitlesLower = new Set(existingTitles.map(t => t.toLowerCase()));

    // Also build a set of reference signatures to detect stories covering the same passages
    const existingRefSigs = new Set();
    for (const story of loadAllStories()) {
        if (story.references) {
            for (const ref of story.references) {
                existingRefSigs.add(`${ref.bookId}:${ref.startChapter}:${ref.startVerse}-${ref.endChapter}:${ref.endVerse}`);
            }
        }
    }

    let saved = 0;
    for (const story of result.stories) {
        if (existingSlugs.has(story.slug)) {
            console.log(`  Skipping "${story.title}" (slug "${story.slug}" exists)`);
            continue;
        }

        if (existingTitlesLower.has(story.title.toLowerCase())) {
            console.log(`  Skipping "${story.title}" (title already exists)`);
            continue;
        }

        // Check if all references overlap with an existing story
        const refSigs = story.references.map(r => `${r.bookId}:${r.startChapter}:${r.startVerse}-${r.endChapter}:${r.endVerse}`);
        if (refSigs.length > 0 && refSigs.every(sig => existingRefSigs.has(sig))) {
            console.log(`  Skipping "${story.title}" (same references already exist)`);
            continue;
        }

        const filename = path.join(STORIES_DIR, `${story.slug}.json`);
        ensureDir(filename);
        fs.writeFileSync(filename, JSON.stringify(story, null, 2));
        console.log(`  Created: ${story.slug}.json — ${story.title}`);
        saved++;
    }

    console.log(`Generated ${saved} new stories`);
    return result.stories;
}

// --- Local validation (no AI) ---

function validateStory(story, filename) {
    const issues = [];

    // slug matches filename
    const expectedFilename = story.slug + '.json';
    if (expectedFilename !== filename) {
        issues.push(`Slug "${story.slug}" does not match filename "${filename}"`);
    }

    // Required fields
    for (const field of ['slug', 'title', 'keywords', 'description', 'category', 'references']) {
        if (!story[field]) {
            issues.push(`Missing field: ${field}`);
        }
    }

    // Category validation
    if (story.category && !VALID_CATEGORIES.includes(story.category)) {
        issues.push(`Invalid category "${story.category}". Valid: ${VALID_CATEGORIES.join(', ')}`);
    }

    // Keywords should be lowercase
    if (story.keywords) {
        const uppercaseKws = story.keywords.filter(k => k !== k.toLowerCase());
        if (uppercaseKws.length > 0) {
            issues.push(`Keywords not lowercase: ${uppercaseKws.join(', ')}`);
        }
    }

    // Reference validation
    if (story.references) {
        for (const ref of story.references) {
            const book = books.find(b => b.id === ref.bookId);
            if (!book) {
                issues.push(`Invalid bookId: ${ref.bookId}`);
                continue;
            }
            if (ref.startChapter < 1 || ref.startChapter > book.chapters) {
                issues.push(`Invalid startChapter ${ref.startChapter} for ${book.name} (has ${book.chapters} chapters)`);
            }
            if (ref.endChapter < 1 || ref.endChapter > book.chapters) {
                issues.push(`Invalid endChapter ${ref.endChapter} for ${book.name} (has ${book.chapters} chapters)`);
            }
            if (ref.endChapter < ref.startChapter) {
                issues.push(`endChapter (${ref.endChapter}) < startChapter (${ref.startChapter})`);
            }
            if (ref.startChapter === ref.endChapter && ref.endVerse < ref.startVerse) {
                issues.push(`endVerse (${ref.endVerse}) < startVerse (${ref.startVerse}) in same chapter`);
            }

            // Check that osnb2 text exists for the reference
            const text = getPassageText(ref.bookId, ref.startChapter, ref.startVerse, ref.endChapter, ref.endVerse);
            if (!text) {
                const bookName = getBookName(ref.bookId, 'Norwegian bokmål');
                issues.push(`No osnb2 text for ${bookName} ${ref.startChapter}:${ref.startVerse}-${ref.endChapter}:${ref.endVerse}`);
            }
        }
    }

    return issues;
}

// --- CLI ---

function printUsage() {
    console.log(`
Usage: node stories.mjs [options]

Modes:
  --validate           Run local validation (no AI, checks format & references)
  --proofread          AI proofread stories against osnb2 text
  --apply              Apply proofread suggestions
  --generate           Generate new stories
  --generate --category <cat>  Generate stories for a specific category

Options:
  --file <slug>        Process only a specific story file (e.g., isaks-binding)
  --min-score <n>      Only apply changes if score < n (default: 7)
  --help               Show this help message

Directories:
  stories/nb/                Story files
  proofread_stories/nb/      Proofread results

Examples:
  node stories.mjs --validate                       # Validate all stories locally
  node stories.mjs --proofread                      # AI proofread all stories
  node stories.mjs --proofread --file isaks-binding  # Proofread one story
  node stories.mjs --proofread --apply               # Proofread and apply changes
  node stories.mjs --apply                           # Apply previously saved proofread results
  node stories.mjs --generate                        # Generate 10 new stories
  node stories.mjs --generate --category paulus      # Generate stories in a category
  node stories.mjs --generate --proofread --apply    # Generate, proofread, and apply
`);
}

function parseArgs(args) {
    const options = {
        validate: false,
        proofread: false,
        apply: false,
        generate: false,
        category: null,
        file: null,
        minScore: 7,
        help: false,
    };

    let i = 0;
    while (i < args.length) {
        const arg = args[i];
        if (arg === '--validate') {
            options.validate = true;
        } else if (arg === '--proofread') {
            options.proofread = true;
        } else if (arg === '--apply') {
            options.apply = true;
        } else if (arg === '--generate') {
            options.generate = true;
        } else if (arg === '--category' && i + 1 < args.length) {
            options.category = args[++i];
        } else if (arg === '--file' && i + 1 < args.length) {
            options.file = args[++i];
        } else if (arg === '--min-score' && i + 1 < args.length) {
            options.minScore = parseInt(args[++i], 10);
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

    if (options.help) {
        printUsage();
        return;
    }

    if (!options.validate && !options.proofread && !options.apply && !options.generate) {
        console.log('No mode specified. Use --help for usage.');
        return;
    }

    // Load stories
    const allStories = loadAllStories();
    let stories = allStories;

    if (options.file) {
        const slug = options.file.replace('.json', '');
        stories = allStories.filter(s => s.slug === slug);
        if (stories.length === 0) {
            console.error(`Story not found: ${slug}`);
            return;
        }
    }

    console.log(`Stories loaded: ${stories.length}`);
    console.log('---');

    // --- Validate ---
    if (options.validate) {
        let totalIssues = 0;
        let storiesWithIssues = 0;

        for (const story of stories) {
            const issues = validateStory(story, story.filename);
            if (issues.length > 0) {
                storiesWithIssues++;
                totalIssues += issues.length;
                console.log(`\n${story.filename}:`);
                issues.forEach(issue => console.log(`  - ${issue}`));
            }
        }

        console.log(`\n--- Validation ---`);
        console.log(`Stories: ${stories.length}`);
        console.log(`With issues: ${storiesWithIssues}`);
        console.log(`Total issues: ${totalIssues}`);
    }

    // --- Generate ---
    const generatedStories = [];
    if (options.generate) {
        const existingTitles = allStories.map(s => s.title);
        const newStories = await generateStories(existingTitles, options.category);

        if (newStories) {
            for (const story of newStories) {
                const filename = story.slug + '.json';
                const filepath = path.join(STORIES_DIR, filename);
                if (fileExists(filepath)) {
                    generatedStories.push({filename, ...story});
                }
            }
        }
    }

    // --- Proofread ---
    if (options.proofread) {
        // If generate was also requested, only proofread the new stories
        const toProofread = options.generate ? generatedStories : stories;
        let proofreadCount = 0;
        const results = {};

        for (const story of toProofread) {
            const {filename, ...storyData} = story;
            const result = await proofreadStory(storyData, story.filename);
            results[story.filename] = result;
            proofreadCount++;

            // Apply immediately if requested
            if (options.apply && result) {
                const applyResult = applyProofreadChanges(story.filename, result, options.minScore);

                // If references changed, do a second proofread to verify the new references against osnb2
                if (applyResult && applyResult.refsChanged) {
                    const verifyFilename = applyResult.newFilename;
                    const verifyFile = path.join(STORIES_DIR, verifyFilename);
                    const updatedStory = JSON.parse(fs.readFileSync(verifyFile, 'utf-8'));

                    console.log(`  Re-proofreading with updated references...`);
                    const verifyResult = await proofreadStory(updatedStory, verifyFilename);
                    proofreadCount++;

                    if (verifyResult && verifyResult.score < options.minScore) {
                        applyProofreadChanges(verifyFilename, verifyResult, options.minScore);
                    }
                }
            }
        }

        console.log(`\n--- Proofread ---`);
        console.log(`Proofread: ${proofreadCount}`);
    }

    // --- Apply only (without proofread) ---
    if (options.apply && !options.proofread) {
        for (const story of stories) {
            applyProofreadChanges(story.filename, null, options.minScore);
        }
    }

    console.log('\nDone!');
}

main().catch(console.error);
