import dotenv from 'dotenv'
import * as fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config()

import Anthropic from '@anthropic-ai/sdk';
import {books, anthropicModel} from "./constants.js";

const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
});

const bookNames = {
    1: "1. Mosebok", 2: "2. Mosebok", 3: "3. Mosebok", 4: "4. Mosebok", 5: "5. Mosebok",
    6: "Josva", 7: "Dommerne", 8: "Rut", 9: "1. Samuel", 10: "2. Samuel",
    11: "1. Kongebok", 12: "2. Kongebok", 13: "1. Krønikebok", 14: "2. Krønikebok",
    15: "Esra", 16: "Nehemja", 17: "Ester", 18: "Job", 19: "Salmene", 20: "Ordspråkene",
    21: "Forkynneren", 22: "Høysangen", 23: "Jesaja", 24: "Jeremia", 25: "Klagesangene",
    26: "Esekiel", 27: "Daniel", 28: "Hosea", 29: "Joel", 30: "Amos", 31: "Obadja",
    32: "Jona", 33: "Mika", 34: "Nahum", 35: "Habakkuk", 36: "Sefanja", 37: "Haggai",
    38: "Sakarja", 39: "Malaki", 40: "Matteus", 41: "Markus", 42: "Lukas", 43: "Johannes",
    44: "Apostlenes gjerninger", 45: "Romerne", 46: "1. Korinterne", 47: "2. Korinterne",
    48: "Galaterne", 49: "Efeserne", 50: "Filipperne", 51: "Kolosserne",
    52: "1. Tessalonikerne", 53: "2. Tessalonikerne", 54: "1. Timoteus", 55: "2. Timoteus",
    56: "Titus", 57: "Filemon", 58: "Hebreerne", 59: "Jakob", 60: "1. Peter", 61: "2. Peter",
    62: "1. Johannes", 63: "2. Johannes", 64: "3. Johannes", 65: "Judas", 66: "Åpenbaringen"
};

async function doAnthropicCall(content) {
    return anthropic.messages.create({
        model: anthropicModel,
        max_tokens: 4096,
        messages: [
            {
                role: "user",
                content
            }
        ]
    });
}

function fileExists(language, bookNr, chapterNr) {
    const filePath = path.join(__dirname, `important_words/${language}/${bookNr}-${chapterNr}.txt`);
    return fs.existsSync(filePath) && fs.statSync(filePath).size > 0;
}

async function generateImportantWords(language, bookId, chapter) {
    const bookName = bookNames[bookId];
    const bibleRef = `${bookName} ${chapter}`;

    const prompt = `Kan du skrive ut de viktigste ordene i ${bibleRef} og forklare dem på norsk, bokmål? Skriv kun ord og forklaring, ikke noe før og etter. Følg malen:

Gud:Den allmektige skaperen som i henhold til 1. Mosebok skapte himmelen, jorden og alt liv.
Skapte:Begrepet brukt til å beskrive Guds handling av å bringe universet og alt i det til eksistens.`;

    console.log(`Generating important words for ${bibleRef}...`);
    const completion = await doAnthropicCall(prompt);
    const text = completion.content[0].text;

    const outputDir = path.join(__dirname, `important_words/${language}`);
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, {recursive: true});
    }

    const filename = path.join(outputDir, `${bookId}-${chapter}.txt`);
    fs.writeFileSync(filename, text.replaceAll("\n\n", "\n"));
    console.log(`Saved: ${filename}`);
}

async function main() {
    const args = process.argv.slice(2);
    const language = args[0] || 'nb';
    const startBook = args[1] ? +args[1] : 1;
    const startChapter = args[2] ? +args[2] : 1;

    console.log(`Starting from book ${startBook}, chapter ${startChapter}`);

    for (let bookId = startBook; bookId <= 66; bookId++) {
        const book = books.find(b => b.id === bookId);
        const maxChapters = book.chapters;
        const firstChapter = (bookId === startBook) ? startChapter : 1;

        for (let chapter = firstChapter; chapter <= maxChapters; chapter++) {
            if (fileExists(language, bookId, chapter)) {
                console.log(`Skipping ${bookNames[bookId]} ${chapter} (already exists)`);
                continue;
            }

            await generateImportantWords(language, bookId, chapter);
        }
    }
}

main();
