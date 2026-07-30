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
// kapitler gjensto per språk da flagget kom (#5). `words` er ikke i taskModels,
// så getTaskModel faller til ollamaModel — sett OLLAMA_MODEL for å styre det.
const TASK = 'words';

let useLocal = false;

function fileExists(language, bookNr, chapterNr) {
    const filePath = path.join(__dirname, `important_words/${language}/${bookNr}-${chapterNr}.txt`);
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
        model: useLocal ? getTaskModel(TASK) : undefined,
        context: `important words ${bibleRef}`,
    });

    const outputDir = path.join(__dirname, `important_words/${language}`);
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, {recursive: true});
    }

    const filename = path.join(outputDir, `${bookId}-${chapter}.txt`);
    fs.writeFileSync(filename, text.replaceAll("\n\n", "\n"));
    console.log(`Saved: ${filename}`);
}

function printUsage() {
    console.log(`
Usage: node important_words_chapter.mjs [language] [startBook] [startChapter] [options]

Skriver important_words/<språk>/<bok>-<kapittel>.txt. Kapitler som allerede
finnes hoppes over, så skriptet er trygt å kjøre om igjen.

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
    console.log(`Model: ${useLocal ? getTaskModel(TASK) : anthropicModel}`);
    console.log(`Starting from book ${startBook}, chapter ${startChapter}`);

    for (let bookId = startBook; bookId <= 66; bookId++) {
        const book = books.find(b => b.id === bookId);
        const maxChapters = book.chapters;
        const firstChapter = (bookId === startBook) ? startChapter : 1;

        for (let chapter = firstChapter; chapter <= maxChapters; chapter++) {
            if (fileExists(language, bookId, chapter)) {
                console.log(`Skipping ${getBookName(bookId, language)} ${chapter} (already exists)`);
                continue;
            }

            await generateImportantWords(language, bookId, chapter);
        }
    }
}

main();
