import dotenv from 'dotenv'
import * as fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config()

import {books, getBookName, normalizeLanguage, getLanguageCode, anthropicModel, getTaskModel} from "./constants.js";
import {callWithRetry} from "./llm.js";

// Nøkkelordekstraksjon er strukturert nok for en lokal modell, og 300 av 1189
// kapitler gjensto per språk da flagget kom (#5). taskModels.words er 27b, men
// resolveLocalModel bruker en større modell hvis en annen jobb alt har den lastet
// — sett OLLAMA_MODEL for å pinne valget.
const TASK = 'words';

let useLocal = false;

// De to linjene prompten bruker som MAL. En liten lokal modell svarer av og til
// med malen i stedet for å gjøre jobben — Åp 2 kom tilbake som nøyaktig disse to
// linjene. Uten en vakt skrives den fila, og fileExists() hopper over den for
// alltid siden den bare måler størrelse: ett dårlig svar blir permanent.
const TEMPLATE_WORDS = ['Gud', 'Skapte'];
const MIN_ENTRIES = 4;

const isEntry = (line) => /^[^:]{1,60}:.+/.test(line);

/**
 * Bare linjene på formen ord:forklaring.
 *
 * Prompten sier «ikke noe før og etter», men modellen skriver likevel en
 * innledning i 88 av 1778 filer — «Salme 121 er en av de vakreste …», og i noen
 * tilfeller en direkte gal påstand om at kapitlet ikke finnes. Innholdet under
 * er som regel helt brukbart, så å avvise fila ville kastet gode oppføringer for
 * en kosmetisk feil.
 *
 * Målt på alle eksisterende filer: samtlige 88 ikke-oppføringslinjer står FØRST,
 * ingen midt i eller sist. Det finnes altså ingen forklaringer som går over flere
 * linjer, og filtreringen kan ikke miste innhold.
 */
function entryLines(text) {
    return text.split('\n').map(l => l.trim()).filter(Boolean).filter(isEntry);
}

/**
 * Modellsvaret som {word, explanation}. Splitter på FØRSTE kolon — en forklaring
 * kan selv inneholde kolon, et ord kan ikke (isEntry krever det).
 *
 * Trimmingen er kontrakten: modellen skrev vekselvis «Gud:...» og «Himmel: ...»,
 * og det skillet skal ikke lekke ut i dataene.
 */
function parseEntries(text) {
    return entryLines(text).map(line => {
        const i = line.indexOf(':');
        return {word: line.slice(0, i).trim(), explanation: line.slice(i + 1).trim()};
    });
}

function rejectReason(entries) {
    if (entries.length < MIN_ENTRIES) {
        return `bare ${entries.length} oppføringer på formen ord:forklaring`;
    }
    const words = entries.map(e => e.word);
    if (words.length === TEMPLATE_WORDS.length && TEMPLATE_WORDS.every((w, i) => words[i] === w)) {
        return 'svaret er promptens egen mal, ikke kapitlet';
    }
    return null;
}

function fileExists(language, bookNr, chapterNr) {
    const filePath = path.join(__dirname, `important_words/${language}/${bookNr}-${chapterNr}.json`);
    return fs.existsSync(filePath) && fs.statSync(filePath).size > 0;
}

// Prompten er norsk med vilje. `important_words` er dekket av translate.mjs
// (nb → andre språk), så et `en/`-katalognavn her ville blitt overskrevet ved
// neste oversettelseskjøring. Se README, «Convention».
async function generateImportantWords(language, bookId, chapter) {
    const bibleRef = `${getBookName(bookId, language)} ${chapter}`;

    const prompt = `Kan du skrive ut de viktigste ordene i ${bibleRef} og forklare dem på norsk, bokmål? Skriv kun ord og forklaring, ikke noe før og etter. Følg malen:

Gud:Den allmektige skaperen som i henhold til 1. Mosebok skapte himmelen, jorden og alt liv.
Skapte:Begrepet brukt til å beskrive Guds handling av å bringe universet og alt i det til eksistens.`;

    console.log(`Generating important words for ${bibleRef}...`);
    const text = await callWithRetry(prompt, {
        local: useLocal,
        task: TASK,
        context: `important words ${bibleRef}`,
    });

    const entries = parseEntries(text);
    const problem = rejectReason(entries);
    if (problem) {
        console.log(`  SKIPPED ${bibleRef}: ${problem}`);
        return false;
    }

    const outputDir = path.join(__dirname, `important_words/${language}`);
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, {recursive: true});
    }

    const filename = path.join(outputDir, `${bookId}-${chapter}.json`);
    fs.writeFileSync(filename, JSON.stringify(entries, null, 2) + '\n');
    console.log(`Saved: ${filename} (${entries.length} ord)`);
    return true;
}

function printUsage() {
    console.log(`
Usage: node important_words_chapter.mjs [language] [startBook] [startChapter] [options]

Skriver important_words/<språk>/<bok>-<kapittel>.json — en array av
{word, explanation}. Kapitler som allerede finnes hoppes over, så skriptet er
trygt å kjøre om igjen.

Posisjonsargumentene er beholdt som de var. Flaggene overstyrer dem.

Options:
  --language <kode>  Målspråk (default nb)
  --book <n>         Start på denne boka
  --chapter <n>      Start på dette kapitlet i startboka
  --local            Bruk Ollama i stedet for Claude
  --help             Vis denne teksten

Eksempler:
  node important_words_chapter.mjs                        # nb, fra 1 Mos 1, Claude
  node important_words_chapter.mjs --local                # samme, lokal modell
  node important_words_chapter.mjs nb 40 1                # fra Matteus 1
  node important_words_chapter.mjs --book 40 --local
  OLLAMA_MODEL=qwen3.5:27b node important_words_chapter.mjs --local
`);
}

function parseArgs(args) {
    const options = {language: null, startBook: null, startChapter: null, local: false};
    const positional = [];

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--help' || arg === '-h') {
            printUsage();
            process.exit(0);
        } else if (arg === '--local') {
            options.local = true;
        } else if (arg === '--language' && i + 1 < args.length) {
            options.language = args[++i];
        } else if (arg === '--book' && i + 1 < args.length) {
            options.startBook = +args[++i];
        } else if (arg === '--chapter' && i + 1 < args.length) {
            options.startChapter = +args[++i];
        } else if (arg.startsWith('-')) {
            console.error(`Unknown option: ${arg}`);
            printUsage();
            process.exit(1);
        } else {
            positional.push(arg);
        }
    }

    // Posisjonsformen fra før flaggene fantes: <språk> <startbok> <startkapittel>.
    if (options.language === null && positional[0]) options.language = positional[0];
    if (options.startBook === null && positional[1]) options.startBook = +positional[1];
    if (options.startChapter === null && positional[2]) options.startChapter = +positional[2];

    return options;
}

async function main() {
    const options = parseArgs(process.argv.slice(2));

    useLocal = options.local;
    const language = getLanguageCode(normalizeLanguage(options.language || 'nb'));
    const startBook = options.startBook || 1;
    const startChapter = options.startChapter || 1;

    if (!useLocal && !process.env.ANTHROPIC_API_KEY) {
        console.error('ANTHROPIC_API_KEY mangler. Sett den, eller kjør med --local.');
        process.exit(1);
    }

    console.log(`Language: ${language}`);
    console.log(`Model: ${useLocal ? `${getTaskModel(TASK)} (eller en større som alt ligger i minnet)` : anthropicModel}`);
    console.log(`Starting from book ${startBook}, chapter ${startChapter}`);

    let written = 0;
    let rejected = 0;

    for (let bookId = startBook; bookId <= 66; bookId++) {
        const book = books.find(b => b.id === bookId);
        const maxChapters = book.chapters;
        const firstChapter = (bookId === startBook) ? startChapter : 1;

        for (let chapter = firstChapter; chapter <= maxChapters; chapter++) {
            if (fileExists(language, bookId, chapter)) {
                console.log(`Skipping ${getBookName(bookId, language)} ${chapter} (already exists)`);
                continue;
            }

            if (await generateImportantWords(language, bookId, chapter)) written++;
            else rejected++;
        }
    }

    console.log('---');
    console.log(`Skrevet: ${written}, avvist: ${rejected}`);
    if (rejected > 0) {
        console.log('Avviste kapitler er IKKE skrevet, så en ny kjøring forsøker dem igjen.');
    }
}

main();
