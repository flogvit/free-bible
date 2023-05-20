import dotenv from 'dotenv'

dotenv.config()
import {ChatGPTAPI} from 'chatgpt'
import * as fs from 'fs';

let API = null;

const translations = {
    'osnb1': {
        long: "norwegian, bokmål",
        language: "nb"
    }
}

const books = [
    {"id": 1, "name": "1 Mosebok", "chapter_count": 50},
    {"id": 2, "name": "2 Mosebok", "chapter_count": 40},
    {"id": 3, "name": "3 Mosebok", "chapter_count": 27},
    {"id": 4, "name": "4 Mosebok", "chapter_count": 36},
    {"id": 5, "name": "5 Mosebok", "chapter_count": 34},
    {"id": 6, "name": "Josvas bok", "chapter_count": 24},
    {"id": 7, "name": "Dommernes bok", "chapter_count": 21},
    {"id": 8, "name": "Ruts bok", "chapter_count": 4},
    {"id": 9, "name": "1 Samuels bok", "chapter_count": 31},
    {"id": 10, "name": "2 Samuels bok", "chapter_count": 24},
    {"id": 11, "name": "1 Kongebok", "chapter_count": 22},
    {"id": 12, "name": "2 Kongebok", "chapter_count": 25},
    {"id": 13, "name": "1 Krønikebok", "chapter_count": 29},
    {"id": 14, "name": "2 Krønikebok", "chapter_count": 36},
    {"id": 15, "name": "Esras bok", "chapter_count": 10},
    {"id": 16, "name": "Nehemjas bok", "chapter_count": 13},
    {"id": 17, "name": "Esters bok", "chapter_count": 10},
    {"id": 18, "name": "Jobs bok", "chapter_count": 42},
    {"id": 19, "name": "Salmenes bok", "chapter_count": 150},
    {"id": 20, "name": "Ordspråkenes bok", "chapter_count": 31},
    {"id": 21, "name": "Forkynnerens bok", "chapter_count": 12},
    {"id": 22, "name": "Høysangen", "chapter_count": 8},
    {"id": 23, "name": "Jesajas bok", "chapter_count": 66},
    {"id": 24, "name": "Jeremias bok", "chapter_count": 52},
    {"id": 25, "name": "Klagesangene", "chapter_count": 5},
    {"id": 26, "name": "Esekiels bok", "chapter_count": 48},
    {"id": 27, "name": "Daniels bok", "chapter_count": 12},
    {"id": 28, "name": "Hoseas bok", "chapter_count": 14},
    {"id": 29, "name": "Joels bok", "chapter_count": 3},
    {"id": 30, "name": "Amos' bok", "chapter_count": 9},
    {"id": 31, "name": "Obadjas bok", "chapter_count": 1},
    {"id": 32, "name": "Jonas' bok", "chapter_count": 4},
    {"id": 33, "name": "Mikas bok", "chapter_count": 7},
    {"id": 34, "name": "Nahums bok", "chapter_count": 3},
    {"id": 35, "name": "Habakkuks bok", "chapter_count": 3},
    {"id": 36, "name": "Sefanjas bok", "chapter_count": 3},
    {"id": 37, "name": "Haggais bok", "chapter_count": 2},
    {"id": 38, "name": "Sakarjas bok", "chapter_count": 14},
    {"id": 39, "name": "Malakis bok", "chapter_count": 4},
    {"id": 40, "name": "Matteus' evangelium", "chapter_count": 28},
    {"id": 41, "name": "Markus' evangelium", "chapter_count": 16},
    {"id": 42, "name": "Lukas' evangelium", "chapter_count": 24},
    {"id": 43, "name": "Johannes' evangelium", "chapter_count": 21},
    {"id": 44, "name": "Apostlenes gjerninger", "chapter_count": 28},
    {"id": 45, "name": "Paulus' brev til romerne", "chapter_count": 16},
    {"id": 46, "name": "1 Korinterbrev", "chapter_count": 16},
    {"id": 47, "name": "2 Korinterbrev", "chapter_count": 13},
    {"id": 48, "name": "Galaterbrevet", "chapter_count": 6},
    {"id": 49, "name": "Efeserbrevet", "chapter_count": 6},
    {"id": 50, "name": "Filipperbrevet", "chapter_count": 4},
    {"id": 51, "name": "Kolosserbrevet", "chapter_count": 4},
    {"id": 52, "name": "1 Tessalonikerbrev", "chapter_count": 5},
    {"id": 53, "name": "2 Tessalonikerbrev", "chapter_count": 3},
    {"id": 54, "name": "1 Timoteusbrev", "chapter_count": 6},
    {"id": 55, "name": "2 Timoteusbrev", "chapter_count": 4},
    {"id": 56, "name": "Titusbrevet", "chapter_count": 3},
    {"id": 57, "name": "Filemonbrevet", "chapter_count": 1},
    {"id": 58, "name": "Hebreerbrevet", "chapter_count": 13},
    {"id": 59, "name": "Jakobsbrevet", "chapter_count": 5},
    {"id": 60, "name": "1 Petersbrev", "chapter_count": 5},
    {"id": 61, "name": "2 Petersbrev", "chapter_count": 3},
    {"id": 62, "name": "1 Johannesbrev", "chapter_count": 5},
    {"id": 63, "name": "2 Johannesbrev", "chapter_count": 1},
    {"id": 64, "name": "3 Johannesbrev", "chapter_count": 1},
    {"id": 65, "name": "Judasbrevet", "chapter_count": 1},
    {"id": 66, "name": "Johannes' åpenbaring", "chapter_count": 22}
]


async function doBook(translation, bookNr=1, chapter=1) {

    console.log("Starting up with parameters", bookNr, chapter);
    while(bookNr<=66) {
        let book = books.find(b => b.id === bookNr).name;
        do {
            API = new ChatGPTAPI({
                apiKey: process.env.OPENAI_API_KEY,
                completionParams: {
                    model: 'gpt-4',
                    temperature: 0.5,
                    top_p: 0.8
                }
            })
            await translate(translation, translations[translation].long, bookNr, chapter, `${book} ${chapter++}`)
        } while (chapter <= books.find(b => b.name === book).chapter_count)
        bookNr++;
        chapter = 1;
    }
}

const ask = async (text, prevRes = {}) => {
    console.log(`--> ASKING ${text}`);
    prevRes.timeoutMs = 10*60*1000;
    return await API.sendMessage(text, prevRes);
}
const translate = async (translation, bible_long, bookNr, chapter, bibleRef) => {
    let res = null;
    do {
        try {
            res = await ask(`Lag et sammendrag av ${bibleRef} på norsk, bokmål.
Når du er ferdig, skriv: FERDIG`);
        } catch(e) {console.log("Catching initial", e)}
    } while(!res)
    await store(translation, bookNr, chapter, res.text.replace("FINISHED", "").replace("FERDIG", ""));
    while (!res.text.includes("FINISHED") && !res.text.includes("FERDIG")) {
        try {
            res = await ask(`continue`, {
                parentMessageId: res.id
            })
        } catch(e) {console.log("Catching followup", e)}
        await store(translation, bookNr, chapter, res.text.replace("FINISHED", "").replace("FERDIG", ""));
    }
}

const store = async (translation, bookNr, chapterNr, text) => {
    fs.appendFileSync(`summaries/${translations[translation].language}/${bookNr}-${chapterNr}.txt`,
        text
    );
    console.log("==> SAVED");
}

const args = process.argv.slice(2);
if (args.length!==3)
    console.error("Wrong params: <translation> <bookId> <chapterId>");

await doBook(args[0], +args[1], +args[2]);