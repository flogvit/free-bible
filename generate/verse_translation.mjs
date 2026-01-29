import dotenv from 'dotenv'
import * as fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config()

import Anthropic from '@anthropic-ai/sdk';
import {bibles, books, anthropicModel, getBookName} from "./constants.js";

const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
});

const MAX_RETRIES = 3;
const MAX_VERSES_PER_BATCH = 15; // Keep batches small for detailed explanations

function getOriginalSource(bookId) {
    return bookId <= 39 ? 'tanach' : 'sblgnt';
}

function readOriginalChapter(bookId, chapterId) {
    const source = getOriginalSource(bookId);
    const sourceFile = path.join(__dirname, `bibles_raw/${source}/${bookId}/${chapterId}.json`);

    if (!fs.existsSync(sourceFile)) {
        return null;
    }

    return JSON.parse(fs.readFileSync(sourceFile, 'utf-8'));
}

function readTranslatedChapter(bible, bookId, chapterId) {
    const translationFile = path.join(__dirname, `bibles_raw/${bible}/${bookId}/${chapterId}.json`);

    if (!fs.existsSync(translationFile)) {
        return null;
    }

    return JSON.parse(fs.readFileSync(translationFile, 'utf-8'));
}

function getExplanationPrompt(language, bookId, chapterId, originalVerses, translatedVerses) {
    const originalLanguage = bookId <= 39 ? 'hebraisk' : 'gresk';
    const originalLanguageEn = bookId <= 39 ? 'Hebrew' : 'Greek';

    // Pair up verses
    const versePairs = originalVerses.map(orig => {
        const trans = translatedVerses.find(t => +t.verseId === +orig.verseId);
        return {
            verseId: orig.verseId,
            original: orig.text,
            translation: trans ? trans.text : null
        };
    }).filter(v => v.translation);

    const formattedPairs = versePairs.map(v =>
        `Vers ${v.verseId}:\nOriginal: ${v.original}\nOversettelse: ${v.translation}`
    ).join('\n\n');

    const promptNb = `Du er en bibeloversettelsesekspert med luthersk teologisk bakgrunn. Forklar HVORFOR oversettelsen ble som den ble, på en måte som er genuint interessant og lærerik for bibellesere.

VIKTIG: Vi har allerede ord-for-ord-forklaringer som dekker hvert enkeltords betydning og grunnleggende grammatikk. Du skal IKKE gjenta dette.

KVALITETSKRAV:
- Inkluder KUN informasjon som er genuint interessant eller overraskende
- IKKE fyll på med "filler" - det er bedre å ha få, gode felter enn mange middelmådige
- Hvis et vers ikke har noe spesielt interessant, er det greit å bare ha explanation
- Skriv 1-4 setninger per felt avhengig av hvor mye som er verdt å si

Returner som JSON med følgende struktur:

Obligatorisk felt:
- explanation: Hvorfor oversettelsen ble som den ble. Fokuser på det som er interessant ved akkurat dette verset.

Valgfrie tilleggsfelter (KUN hvis genuint interessant):
- lostInTranslation: Ordspill, rim, dobbeltbetydninger, poetiske virkemidler som faktisk går tapt og som leseren ville hatt glede av å vite om. IKKE inkluder trivielle ting.
- uncertainty: Kun når teksten er genuint uklar eller omdiskutert blant forskere. Ikke inkluder teoretiske muligheter som ingen tar seriøst.
- theologicalImplications: Hvordan ordvalget påvirker forståelsen av teksten. Skriv fra et luthersk teologisk perspektiv (lov/evangelium, nåde, tro, Kristus-sentrert lesning), men presenter innsiktene direkte uten å sitere eller referere til Luther eller andre teologer.
- connections: Koblinger til ANDRE kapitler eller bøker i Bibelen (IKKE samme kapittel). Særlig interessant er NT-oppfyllelser av GT-tekster, eller hvordan NT-forfattere siterer/alluderer til teksten.
- culturalBackground: Historisk/kulturell kontekst som moderne lesere ikke kjenner til og som genuint belyser teksten.

IKKE inkluder:
- Hva enkeltord betyr (det finnes i word4word)
- Grunnleggende grammatikk
- Det som er åpenbart fra oversettelsen selv
- Referanser til andre bibeloversettelser
- "Filler" som later som det er interessant men egentlig er trivielt
- Connections til vers i samme kapittel (det er åpenbart for leseren)

Format:
[
    {
        "verseId": 1,
        "explanation": "Alltid inkludert - fokuser på det interessante",
        "lostInTranslation": "Kun hvis genuint interessant",
        "connections": "Kun til ANDRE kapitler/bøker"
    }
]

Originalspråk: ${originalLanguage}
Målspråk: ${language}

${formattedPairs}`;

    const promptEn = `You are a Bible translation expert with a Lutheran theological background. Explain WHY the translation turned out as it did, in a way that is genuinely interesting and educational for Bible readers.

IMPORTANT: We already have word-for-word explanations covering each word's meaning and basic grammar. Do NOT repeat this.

QUALITY REQUIREMENTS:
- Only include information that is genuinely interesting or surprising
- Do NOT pad with "filler" - better to have few good fields than many mediocre ones
- If a verse has nothing particularly interesting, just having explanation is fine
- Write 1-4 sentences per field depending on how much is worth saying

Return as JSON with the following structure:

Required field:
- explanation: Why the translation turned out as it did. Focus on what's interesting about this specific verse.

Optional additional fields (ONLY if genuinely interesting):
- lostInTranslation: Wordplay, rhymes, double meanings, poetic devices that are actually lost and that readers would benefit from knowing. Do NOT include trivial things.
- uncertainty: Only when the text is genuinely unclear or disputed among scholars. Don't include theoretical possibilities no one takes seriously.
- theologicalImplications: How word choices affect understanding of the text. Write from a Lutheran theological perspective (law/gospel, grace, faith, Christ-centered reading), but present insights directly without citing or referencing Luther or other theologians.
- connections: Links to OTHER chapters or books in the Bible (NOT the same chapter). Particularly interesting are NT fulfillments of OT texts, or how NT authors quote/allude to the text.
- culturalBackground: Historical/cultural context that modern readers don't know and that genuinely illuminates the text.

Do NOT include:
- What individual words mean (that's in word4word)
- Basic grammar
- What is obvious from the translation itself
- References to other Bible translations
- "Filler" that pretends to be interesting but is actually trivial
- Connections to verses in the same chapter (that's obvious to the reader)

Format:
[
    {
        "verseId": 1,
        "explanation": "Always included - focus on what's interesting",
        "lostInTranslation": "Only if genuinely interesting",
        "connections": "Only to OTHER chapters/books"
    }
]

Original language: ${originalLanguageEn}
Target language: ${language}

${formattedPairs}`;

    // Use Norwegian prompt for Norwegian, English for others
    if (language.toLowerCase().includes('norwegian') || language.toLowerCase().includes('norsk')) {
        return promptNb;
    }
    return promptEn;
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

    const arrayMatch = cleaned.match(/\[[\s\S]*]/);
    if (arrayMatch) {
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
            return parseJsonResponse(completion.content[0].text);
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

function getOutputPath(bible, bookId, chapterId) {
    return path.join(__dirname, `verse_translation/${bible}/${bookId}/${chapterId}.json`);
}

function getProofreadPath(bible, bookId, chapterId) {
    return path.join(__dirname, `proofread_verse_translation/${bible}/${bookId}/${chapterId}.json`);
}

function getProofreadPrompt(language, currentExplanations) {
    const fields = ['explanation', 'lostInTranslation', 'uncertainty', 'theologicalImplications', 'connections', 'culturalBackground'];

    const formatted = currentExplanations.map(v => {
        let entry = `Vers ${v.verseId}:`;

        for (const field of fields) {
            if (v[field]) {
                entry += `\n  ${field}: ${v[field]}`;

                // Show version history for this field
                const versionsKey = `${field}Versions`;
                if (v[versionsKey] && v[versionsKey].length > 0) {
                    entry += `\n    VERSJONSHISTORIKK (${v[versionsKey].length} tidligere versjoner - IKKE foreslå noen av disse):`;
                    v[versionsKey].forEach((ver, i) => {
                        entry += `\n    ${i + 1}. [${ver.type}/${ver.severity}] "${ver.text}"`;
                        if (ver.explanation) {
                            entry += `\n       Grunn: ${ver.explanation}`;
                        }
                    });
                }
            }
        }
        return entry;
    }).join('\n\n');

    return `Du er en korrekturleser for bibeloversettelsesforklaringer med luthersk teologisk bakgrunn. Gå gjennom følgende forklaringer.

Du kan:
1. ENDRE eksisterende tekst (type: error, factual, suggestion)
2. LEGGE TIL ny informasjon til et felt (type: addition)
3. FJERNE overflødig informasjon (type: redundant)
4. FJERNE "filler" som later som det er interessant (type: filler)

Fokuser KUN på:
- Faktafeil eller unøyaktigheter (KRITISK)
- Connections som peker til samme kapittel (bør fjernes eller endres til andre kapitler/bøker)
- "Filler"-innhold som later som det er interessant men egentlig er trivielt (IKKE explanation-feltet)
- Teologi som ikke er i tråd med luthersk tradisjon
- Tekst som siterer eller refererer til teologer (Luther, Calvin, kirkefedre osv.) - teologien skal presenteres direkte som innsikt, ikke som sitat

IKKE foreslå endringer for:
- Stilistiske preferanser
- Om hebraisk skrift skal inkluderes eller ikke (det er en redaksjonell beslutning)
- Småplukk som ikke påvirker forståelsen

KRITISK - FULLSTENDIGE SETNINGER:
- "suggested" feltet må ALLTID være en KOMPLETT ERSTATNINGSTEKST
- ALDRI returner bare endringene - returner hele den nye teksten
- Eksempel: Hvis nåværende er "Dette er feil om tre ord" og du vil endre "tre" til "syv",
  skal suggested være "Dette er riktig om syv ord", IKKE bare "syv ord"

Returner som JSON:
{
    "issues": [
        {
            "verseId": 1,
            "field": "explanation|lostInTranslation|uncertainty|theologicalImplications|connections|culturalBackground",
            "type": "error|factual|suggestion|addition|redundant|filler",
            "severity": "critical|major|minor",
            "current": "nåværende tekst (eller tom streng hvis addition)",
            "suggested": "KOMPLETT ny tekst som erstatter hele feltet",
            "explanation": "hvorfor denne endringen anbefales"
        }
    ],
    "summary": "Overordnet vurdering av kvaliteten",
    "score": 1-10
}

VIKTIG:
- Les VERSJONSHISTORIKK nøye - ALDRI foreslå tekst som ligner på tidligere versjoner
- Hvis et felt har 3+ versjoner, er det grundig gjennomgått - kun foreslå endringer for KRITISKE feil
- Hvis forklaringene er gode, returner tom issues-array
- Ved type "addition": current skal være tom streng, suggested er teksten som legges til
- Ved type "filler" eller "redundant": suggested skal være tom streng for å fjerne feltet
- ALDRI foreslå sletting av "explanation"-feltet - det er obligatorisk. Foreslå heller en kortere versjon.

Språk: ${language}

Nåværende forklaringer:
${formatted}`;
}

async function proofreadExplanations(bible, bookId, chapterId, filename, saveToFile = true) {
    if (!fileExists(filename)) {
        console.log(`No explanation file found for ${bookId}:${chapterId}`);
        return null;
    }

    const language = bibles[bible];
    const bookName = getBookName(bookId, 'nb');
    const currentExplanations = JSON.parse(fs.readFileSync(filename, 'utf-8'));

    console.log(`Proofreading explanations for ${bookName} ${chapterId}...`);

    const prompt = getProofreadPrompt(language, currentExplanations);
    const result = await doAnthropicCallWithRetry(prompt, `proofread ${bookId}:${chapterId}`);

    // Handle case where API returns array directly
    const proofreadResult = Array.isArray(result) ? {
        issues: result,
        summary: result.length === 0 ? "No issues found" : `Found ${result.length} issue(s)`,
        score: null
    } : result;

    if (saveToFile) {
        const proofreadFile = getProofreadPath(bible, bookId, chapterId);
        const dir = path.dirname(proofreadFile);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, {recursive: true});
        }
        console.log("Writing proofread results to", proofreadFile);
        fs.writeFileSync(proofreadFile, JSON.stringify(proofreadResult, null, 2));
    }

    // Print summary
    console.log(`\nProofread results for ${bookName} ${chapterId}:`);
    if (proofreadResult.score !== null && proofreadResult.score !== undefined) {
        console.log(`Score: ${proofreadResult.score}/10`);
    }
    console.log(`Summary: ${proofreadResult.summary}`);
    if (proofreadResult.issues && proofreadResult.issues.length > 0) {
        console.log(`Issues found: ${proofreadResult.issues.length}`);
        proofreadResult.issues.forEach((issue, i) => {
            console.log(`  ${i + 1}. [${issue.severity}] Verse ${issue.verseId} (${issue.field}): ${issue.type}`);
            console.log(`     ${issue.explanation}`);
        });
    }

    return proofreadResult;
}

function applyProofreadChanges(bible, bookId, chapterId, filename, proofreadResult = null) {
    if (!proofreadResult) {
        const proofreadFile = getProofreadPath(bible, bookId, chapterId);
        if (!fileExists(proofreadFile)) {
            console.log(`No proofread file found for ${bookId}:${chapterId}`);
            return;
        }
        proofreadResult = JSON.parse(fs.readFileSync(proofreadFile, 'utf-8'));
    }

    if (!fileExists(filename)) {
        console.log(`No explanation file found for ${bookId}:${chapterId}`);
        return;
    }

    const explanations = JSON.parse(fs.readFileSync(filename, 'utf-8'));

    if (!proofreadResult.issues || proofreadResult.issues.length === 0) {
        console.log(`No changes to apply for ${bookId}:${chapterId}`);
        return;
    }

    let appliedCount = 0;

    for (const issue of proofreadResult.issues) {
        // Allow empty string for deletion (filler/redundant), but skip if undefined
        if (issue.suggested === undefined || issue.suggested === null) continue;

        const verse = explanations.find(v => +v.verseId === +issue.verseId);
        if (!verse) {
            console.log(`  Verse ${issue.verseId} not found, skipping`);
            continue;
        }

        const field = issue.field;
        const versionsKey = `${field}Versions`;

        // Skip if suggested is same as current
        if (verse[field] === issue.suggested) continue;

        // Initialize versions array for this field if it doesn't exist
        if (!verse[versionsKey]) {
            verse[versionsKey] = [];
        }

        // For additions, don't save empty string to history
        if (issue.type === 'addition' && !verse[field]) {
            // Just add the new content
            verse[field] = issue.suggested;
        } else if ((issue.type === 'filler' || issue.type === 'redundant') && issue.suggested === '') {
            // Never delete the required explanation field
            if (field === 'explanation') {
                console.log(`  Skipped: Cannot delete required field 'explanation' for verse ${issue.verseId}`);
                continue;
            }
            // Save current text to history before deletion
            verse[versionsKey].push({
                text: verse[field] || '',
                type: issue.type,
                severity: issue.severity,
                explanation: issue.explanation
            });
            // Delete the field
            delete verse[field];
            console.log(`  Deleted: Verse ${issue.verseId} (${field}) [${issue.type}/${issue.severity}]`);
            appliedCount++;
            continue;
        } else {
            // Save current text to versions history
            verse[versionsKey].push({
                text: verse[field] || '',
                type: issue.type,
                severity: issue.severity,
                explanation: issue.explanation
            });

            // Update the field
            verse[field] = issue.suggested;
        }

        appliedCount++;
        console.log(`  Applied: Verse ${issue.verseId} (${field}) [${issue.type}/${issue.severity}]`);
    }

    if (appliedCount > 0) {
        fs.writeFileSync(filename, JSON.stringify(explanations, null, 2));
        const bookName = getBookName(bookId, 'nb');
        console.log(`Applied ${appliedCount} changes to ${bookName} ${chapterId}`);
    }
}

function fileExists(filepath) {
    return fs.existsSync(filepath) && fs.statSync(filepath).size > 0;
}

function readExistingExplanations(filepath) {
    if (fileExists(filepath)) {
        return JSON.parse(fs.readFileSync(filepath, 'utf-8'));
    }
    return [];
}

async function generateExplanations(bible, bookId, chapterId, filename, force = false) {
    const language = bibles[bible];
    const bookName = getBookName(bookId, 'nb');

    // Read original and translated texts
    const originalVerses = readOriginalChapter(bookId, chapterId);
    if (!originalVerses) {
        console.log(`Skipping ${bookName} ${chapterId} (no original text found)`);
        return;
    }

    const translatedVerses = readTranslatedChapter(bible, bookId, chapterId);
    if (!translatedVerses) {
        console.log(`Skipping ${bookName} ${chapterId} (no translation found for ${bible})`);
        return;
    }

    // Read existing explanations
    let existingExplanations = force ? [] : readExistingExplanations(filename);
    const existingVerseIds = existingExplanations.map(e => +e.verseId);

    // Filter to only verses that need explanations
    const versesToProcess = originalVerses.filter(v => !existingVerseIds.includes(+v.verseId));

    if (versesToProcess.length === 0) {
        console.log(`Skipping ${bookName} ${chapterId} (all verses already explained)`);
        return;
    }

    // Process in batches
    const batches = [];
    for (let i = 0; i < versesToProcess.length; i += MAX_VERSES_PER_BATCH) {
        batches.push(versesToProcess.slice(i, i + MAX_VERSES_PER_BATCH));
    }

    console.log(`Generating explanations for ${bookName} ${chapterId} (${versesToProcess.length} verses in ${batches.length} batch(es))...`);

    const allResults = [];

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        const batch = batches[batchIndex];
        const batchTranslations = translatedVerses.filter(t =>
            batch.some(b => +b.verseId === +t.verseId)
        );

        if (batches.length > 1) {
            console.log(`  Batch ${batchIndex + 1}/${batches.length}`);
        }

        const prompt = getExplanationPrompt(language, bookId, chapterId, batch, batchTranslations);
        const result = await doAnthropicCallWithRetry(prompt, `${bookId}:${chapterId} batch ${batchIndex + 1}`);
        allResults.push(...result);
    }

    // Merge with existing and sort
    const finalResult = [...existingExplanations, ...allResults].sort((a, b) => +a.verseId - +b.verseId);

    // Save
    const dir = path.dirname(filename);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, {recursive: true});
    }

    fs.writeFileSync(filename, JSON.stringify(finalResult, null, 2));
    console.log(`Saved: ${filename}`);
}

function printUsage() {
    console.log(`
Usage: node verse_translation.mjs <bible> [options]

Generates explanations for translation choices, comparing original text
(Hebrew/Greek) with the translated text.

Arguments:
  bible              Bible version to explain (e.g., osnb1, osnb2, osnn1)

Options:
  --proofread        Run proofreading after generation
  --apply            Apply proofread suggestions (requires prior --proofread run)
  --ot               Process only Old Testament (books 1-39)
  --nt               Process only New Testament (books 40-66)
  --book <range>     Process book(s): single (43) or range (1-20)
  --chapter <range>  Process chapter(s): single (1) or range (1-10)
  --force            Force re-generation even if file exists
  --help             Show this help message

Output structure:
  verse_translation/<bible>/<book>/<chapter>.json
  e.g., verse_translation/osnb2/1/1.json (Genesis 1)

Examples:
  node verse_translation.mjs osnb2 --book 1 --chapter 1    # Explain Genesis 1
  node verse_translation.mjs osnb2 --book 43               # Explain all of John
  node verse_translation.mjs osnb2 --nt                    # Explain entire NT
  node verse_translation.mjs osnn1 --book 1 --force        # Re-generate Genesis

Parallel processing (run in separate terminals):
  node verse_translation.mjs osnb2 --book 1-20 &           # terminal 1
  node verse_translation.mjs osnb2 --book 21-39 &          # terminal 2
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

        if (arg === '--proofread') {
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

    console.log(`Bible: ${options.bible} (${bibles[options.bible]})`);
    console.log(`Mode: ${modes.join(' → ')}`);
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
            const filename = getOutputPath(options.bible, bookId, chapterId);

            // Step 1: Generate (skip if file exists unless --force)
            if (!fileExists(filename) || options.force) {
                await generateExplanations(options.bible, bookId, chapterId, filename, options.force);
            } else {
                const bookName = getBookName(bookId, 'nb');
                console.log(`Skipping ${bookName} ${chapterId} (already exists)`);
            }

            // Step 2: Proofread (if requested)
            let proofreadResult = null;
            if (options.proofread && fileExists(filename)) {
                const saveToFile = !options.apply;
                proofreadResult = await proofreadExplanations(options.bible, bookId, chapterId, filename, saveToFile);
            }

            // Step 3: Apply (if requested)
            if (options.apply) {
                applyProofreadChanges(options.bible, bookId, chapterId, filename, proofreadResult);
            }
        }
    }

    console.log('Done!');
}

main().catch(console.error);
