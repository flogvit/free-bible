import dotenv from 'dotenv'
import kjv from '../bibles/kjv.json' assert { type: "json" };

dotenv.config()
import {ChatGPTAPI} from 'chatgpt'
import * as fs from 'fs';

let API = null;

const translations = {
    'osnb1': {
        long: "norwegian, bokmål",
        query: `Use your understanding of vulgata, KJV, WEB and ASV to make a translation of all verses in [bibleRef] with an easy to read language in norwegian, bokmål.
Adjust for previous verses so the sentences does not start with the same words and feels fluent.
When you are finished with the whole chapter, write FINISHED
I want you to answer in the format, and only answer in this format, no other text or questions:
[bookNr]:[chapter]:<verse>:<text>`,
        followup: `if you are finished with all verses in [bibleRef], write FINISHED, else continue`
    },
    'osen1': {
        long: "english",
        query: `Use your understanding of vulgata, KJV, WEB and ASV to make a translation of all verses in [bibleRef] with an easy to read language in modern english.
Adjust for previous verses so the sentences does not start with the same words and feels fluent.
When you are finished with the whole chapter, write FINISHED
I want you to answer in the format, and only answer in this format, no other text or questions:
[bookNr]:[chapter]:<verseNumber>:<text>`,
        followup: `if you are finished with all verses in [bibleRef], write FINISHED, else continue`
    }
}

const books = [
    {"id": 1, "name": "Genesis", "chapter_count": 50},
    {"id": 2, "name": "Exodus", "chapter_count": 40},
    {"id": 3, "name": "Leviticus", "chapter_count": 27},
    {"id": 4, "name": "Numbers", "chapter_count": 36},
    {"id": 5, "name": "Deuteronomy", "chapter_count": 34},
    {"id": 6, "name": "Joshua", "chapter_count": 24},
    {"id": 7, "name": "Judges", "chapter_count": 21},
    {"id": 8, "name": "Ruth", "chapter_count": 4},
    {"id": 9, "name": "1 Samuel", "chapter_count": 31},
    {"id": 10, "name": "2 Samuel", "chapter_count": 24},
    {"id": 11, "name": "1 Kings", "chapter_count": 22},
    {"id": 12, "name": "2 Kings", "chapter_count": 25},
    {"id": 13, "name": "1 Chronicles", "chapter_count": 29},
    {"id": 14, "name": "2 Chronicles", "chapter_count": 36},
    {"id": 15, "name": "Ezra", "chapter_count": 10},
    {"id": 16, "name": "Nehemiah", "chapter_count": 13},
    {"id": 17, "name": "Esther", "chapter_count": 10},
    {"id": 18, "name": "Job", "chapter_count": 42},
    {"id": 19, "name": "Psalms", "chapter_count": 150},
    {"id": 20, "name": "Proverbs", "chapter_count": 31},
    {"id": 21, "name": "Ecclesiastes", "chapter_count": 12},
    {"id": 22, "name": "Song of Solomon", "chapter_count": 8},
    {"id": 23, "name": "Isaiah", "chapter_count": 66},
    {"id": 24, "name": "Jeremiah", "chapter_count": 52},
    {"id": 25, "name": "Lamentations", "chapter_count": 5},
    {"id": 26, "name": "Ezekiel", "chapter_count": 48},
    {"id": 27, "name": "Daniel", "chapter_count": 12},
    {"id": 28, "name": "Hosea", "chapter_count": 14},
    {"id": 29, "name": "Joel", "chapter_count": 3},
    {"id": 30, "name": "Amos", "chapter_count": 9},
    {"id": 31, "name": "Obadiah", "chapter_count": 1},
    {"id": 32, "name": "Jonah", "chapter_count": 4},
    {"id": 33, "name": "Micah", "chapter_count": 7},
    {"id": 34, "name": "Nahum", "chapter_count": 3},
    {"id": 35, "name": "Habakkuk", "chapter_count": 3},
    {"id": 36, "name": "Zephaniah", "chapter_count": 3},
    {"id": 37, "name": "Haggai", "chapter_count": 2},
    {"id": 38, "name": "Zechariah", "chapter_count": 14},
    {"id": 39, "name": "Malachi", "chapter_count": 4},
    {"id": 40, "name": "Matthew", "chapter_count": 28},
    {"id": 41, "name": "Mark", "chapter_count": 16},
    {"id": 42, "name": "Luke", "chapter_count": 24},
    {"id": 43, "name": "John", "chapter_count": 21},
    {"id": 44, "name": "Acts", "chapter_count": 28},
    {"id": 45, "name": "Romans", "chapter_count": 16},
    {"id": 46, "name": "1 Corinthians", "chapter_count": 16},
    {"id": 47, "name": "2 Corinthians", "chapter_count": 13},
    {"id": 48, "name": "Galatians", "chapter_count": 6},
    {"id": 49, "name": "Ephesians", "chapter_count": 6},
    {"id": 50, "name": "Philippians", "chapter_count": 4},
    {"id": 51, "name": "Colossians", "chapter_count": 4},
    {"id": 52, "name": "1 Thessalonians", "chapter_count": 5},
    {"id": 53, "name": "2 Thessalonians", "chapter_count": 3},
    {"id": 54, "name": "1 Timothy", "chapter_count": 6},
    {"id": 55, "name": "2 Timothy", "chapter_count": 4},
    {"id": 56, "name": "Titus", "chapter_count": 3},
    {"id": 57, "name": "Philemon", "chapter_count": 1},
    {"id": 58, "name": "Hebrews", "chapter_count": 13},
    {"id": 59, "name": "James", "chapter_count": 5},
    {"id": 60, "name": "1 Peter", "chapter_count": 5},
    {"id": 61, "name": "2 Peter", "chapter_count": 3},
    {"id": 62, "name": "1 John", "chapter_count": 5},
    {"id": 63, "name": "2 John", "chapter_count": 1},
    {"id": 64, "name": "3 John", "chapter_count": 1},
    {"id": 65, "name": "Jude", "chapter_count": 1},
    {"id": 66, "name": "Revelation", "chapter_count": 22}
]


async function doBook(translation, bookNr=1, chapter=1, includeText=false) {

    console.log("Starting up with parameters", bookNr, chapter);
    while(bookNr<=66) {
        let book = books.find(b => b.id === bookNr).name;
        fs.appendFileSync(`bibles_raw/${translation}/${translation}-${bookNr}.txt`, '')
        do {
            API = new ChatGPTAPI({
                apiKey: process.env.OPENAI_API_KEY,
                completionParams: {
                    model: 'gpt-4',
                    temperature: 0.5,
                    top_p: 0.8
                }
            })
            await translate(translation, translations[translation].long, bookNr, chapter, `${book} ${chapter++}`, includeText)
        } while (chapter <= books.find(b => b.name === book).chapter_count)
        do {
            bookNr++;
            chapter = 1;
        } while(fs.existsSync(`bibles_raw/${translation}/${translation}-${bookNr}.txt`))
    }
}

const ask = async (text, prevRes = {}, systemMessage=null) => {
    console.log(`--> ASKING ${systemMessage?systemMessage : ""} ${text}`);
    prevRes.timeoutMs = 10*60*1000;
    if (systemMessage) {
        prevRes.systemMessage = systemMessage;
    }
    return await API.sendMessage(text, prevRes);
}
const translate = async (translation, bible_long, bookNr, chapter, bibleRef, includeText) => {
    let res = null;
    let systemMessage = null;
    if (includeText) {
        systemMessage = `Here is the KJV text for ${bibleRef}:
        
${kjv.filter(verse => verse.bookId===bookNr && verse.chapterId===chapter).map(verse => `${verse.bookId}:${verse.chapterId}:${verse.verseId}:${verse.text}`).join("\n")}

`
    }
    do {
        try {
            let query = translations[translation].query;
            query = query.replace("[bibleRef]", bibleRef);
            query = query.replace("[bookNr]", bookNr);
            query = query.replace("[chapter]", chapter);
            res = await ask(query, {}, systemMessage);
        } catch(e) {console.log("Catching initial", e)}
    } while(!res)
    await store(translation, bookNr, bibleRef, res.text);
    while (!res.text.includes("FINISHED")) {
        try {
            let query = translations[translation].followup;
            query = query.replace("[bibleRef]", bibleRef);
            query = query.replace("[bookNr]", bookNr);
            query = query.replace("[chapter]", chapter);
            res = await ask(query, {
                parentMessageId: res.id
            })
        } catch(e) {console.log("Catching followup", e)}
        await store(translation, bookNr, bibleRef, res.text);
    }
}

const store = async (translation, bookNr, bibleRef, text) => {
    const append = `[${bibleRef}]
${text}
`.replaceAll("\n\n", "\n");
    console.log(append);
    fs.appendFileSync(`bibles_raw/${translation}/${translation}-${bookNr}.txt`,
        append
    );
    console.log("==> SAVED");
}

const args = process.argv.slice(2);
if (args.length<3)
    console.error("Wrong params: <translation> <bookId> <chapterId> [1=include text in query]");

await doBook(args[0], +args[1], +args[2], args.length>3 ? !!args[3] : false);