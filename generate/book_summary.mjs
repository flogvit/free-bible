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

function fileExists(language, bookNr) {
    const filePath = path.join(__dirname, `book_summaries/${language}/${bookNr}.txt`);
    return fs.existsSync(filePath) && fs.statSync(filePath).size > 0;
}

async function generateBookSummary(language, bookId) {
    const bookName = bookNames[bookId];
    const book = books.find(b => b.id === bookId);
    const chapterCount = book.chapters;

    const prompt = `Kan du lage hovedoverskrifter til ${bookName} (${chapterCount} kapitler) på denne malen?

Første Mosebok, også kjent som Genesis, er den første boken i Bibelen og består av 50 kapitler. Den dekker skapelsens historie, tidlige menneskelige generasjoner, og historiene til patriarkene. Her er noen forslag til hovedoverskrifter basert på de større historiene og hendelsene:

Skapelsen av Verden og Menneskeheten (Kapittel 1-2)
Syndefallet og Konsekvensene (Kapittel 3)
Kain og Abel: Brødrenes Konflikt (Kapittel 4)
Fra Adam til Noah: Menneskehetens Tidlige Generasjoner (Kapittel 5)
Noah og Syndfloden (Kapittel 6-9)
Menneskehetens Spredning og Babels Tårn (Kapittel 10-11)
Abraham og Guds Pakt: Utpakkingen av Guds Løfte (Kapittel 12-25:18)
Isak og Rebekka: Troens Utfordringer (Kapittel 25:19-28:9)
Jakob: En Manns Transformasjon og Løftets Fortsettelse (Kapittel 28:10-36)
Josef i Egypt: Guds Planer Utdypet (Kapittel 37-50)`;

    console.log(`Generating book summary for ${bookName}...`);
    const completion = await doAnthropicCall(prompt);
    const text = completion.content[0].text;

    const outputDir = path.join(__dirname, `book_summaries/${language}`);
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, {recursive: true});
    }

    const filename = path.join(outputDir, `${bookId}.txt`);
    fs.writeFileSync(filename, text);
    console.log(`Saved: ${filename}`);
}

async function main() {
    const args = process.argv.slice(2);
    const language = args[0] || 'nb';
    const startBook = args[1] ? +args[1] : 1;

    console.log(`Starting from book ${startBook}`);

    for (let bookId = startBook; bookId <= 66; bookId++) {
        if (fileExists(language, bookId)) {
            console.log(`Skipping ${bookNames[bookId]} (already exists)`);
            continue;
        }

        await generateBookSummary(language, bookId);
    }
}

main();
