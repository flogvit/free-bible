// For some reason a lot of verses is omitted when ran once
// Run several times to add the missing verses

import dotenv from 'dotenv'
import * as fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config()

import OpenAI from 'openai';
import {bibles, books} from "./constants.js";

const openai = new OpenAI();

let assistant = null;

async function doGPTCall(content) {
    return openai.chat.completions.create({
        messages: [
            {
                role: "system",
                content
            }
        ],
        model: "gpt-4-turbo-preview",
        max_tokens: null,
        n: 1,
        temperature: 0
    });
}

async function doText(bible, originalText, bookId, chapterId, verses, filename) {
    const language = bibles[bible];
    // console.log(bible, originalText, language);
    // return;
    let content = `You will be given a bible text in the original language, and must return the translation as a json on the format, and only json:
[
    {
        "bookId": ${bookId},
        "chapterId": ${chapterId},
        "verseId": verseId,
        "text": "Everything started when God created heaven and earth."
    },
]

Translation must be ${language} in a modern, easy to read, language. But you should emphasis translating theologically correct.

Text:
${originalText}
`
    let completion = null;
    let returnContent = ""
    let fullReturnContent = ""

    // console.log("Got answer")
    do {
        content = `${content}${returnContent}`
        completion = await doGPTCall(content)
        returnContent = completion.choices[0].message.content
        fullReturnContent = `${fullReturnContent}${returnContent}`
        console.log(returnContent)
    } while (completion.choices[0].finish_reason === "length")

    console.log(fullReturnContent)
    const result = JSON.parse(fullReturnContent.replaceAll("```json", "").replaceAll("```", ""))

    fs.writeFileSync(filename, JSON.stringify([...verses, ...result].sort((a, b) => a.verseId - b.verseId), null, 2))
}

async function doBook(bible, bookId, chapterId, filename) {
    const bookText = fs.readFileSync(path.join(__dirname, "../", books.find(b => b.id === bookId).file));
    const lines = bookText.toString().split("\r\n");

    // console.log(lines)
    let verses = [];
    if (fs.existsSync(filename))
        verses = JSON.parse(fs.readFileSync(filename, 'utf-8'))
    // console.log(bookId, chapterId, filename)
    const chapter = lines.filter(verse => {
        // console.log(verse);
        if (verse.match(/xxxx/)) return false;
        const match = verse.match(/(\d+)\s*[:׃]\s*(\d+)/);

        if (match) {
            const [, verseId, chapter] = match; // Destructure here inside the if check
            // console.log(verse, chapter, verseId);
            if (verses.some(verse => +verse.chapterId === +chapter && +verse.verseId === +verseId))
                return false
            return +chapter === +chapterId; // Assuming `chapter` is defined outside this snippet
        } else {
            console.log("No match found");
            return false;
        }

    })
    if (chapter.length>0) {
        console.log(verses)
        console.log(chapter)
       await doText(bible, chapter.join("\n"), bookId, chapterId, verses, filename);
    }
}

async function main() {
    for(let bookId=1;bookId<40;bookId++) {
        const bible = "osnb1";
        const maxChapters = books.find(b => b.id === bookId).chapters;
        for (let chapterId = 1; chapterId <= maxChapters; chapterId++) {
            const dir = `bibles_raw/${bible}/${bookId}`
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, {recursive: true});
            }
            const filename = `${dir}/${chapterId}.json`
//            if (!fs.existsSync(chapterFile))
                await doBook(bible, bookId, chapterId, filename)
        }
    }
}

main();