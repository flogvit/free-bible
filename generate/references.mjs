import dotenv from 'dotenv'
import {bibles, books} from "./constants.js";
import * as fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';
import {getOriginalChapter, getOriginalVerse, getRef} from "./lib.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config()

import OpenAI from 'openai';
const openai = new OpenAI();

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

async function doVerse(bible, bookId, chapterId, verseId) {
    const language = bibles[bible];
    // console.log(bible, originalText, language);
    // return;
    const verseOrg = getOriginalVerse(bookId, chapterId, verseId)
    console.log("Doing ref", getRef(bookId, chapterId, verseId))
    let content = `Can you write cross-references to ${getRef(bookId, chapterId, verseId)} in the language ${language}. 
The OT references is in tanach, and NT is in SBLGNT.

The original text for the verse is:
${verseOrg.text}

You should answer in a json format, and only json. If you find no cross-references, use empty array
[{
    bookId: <bookId as number>,
    chapterId: <chapterId as number>,
    fromVerseId: <verseId as number>,
    toVerseId: <verseId as number>,
    text: <Explain why this is a cross-reference, but do not add text like Dette er en kryssreferanse fordi>
},
...
]
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
    const dir = path.join(__dirname, "references", `${bookId}`, `${chapterId}`)
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, {recursive: true});
    }
    const filename = `${dir}/${verseId}.json`
    console.log("Writing", filename);
    const verse = {
        bookId,
        chapterId,
        verseId,
        references: result
    }
    fs.writeFileSync(filename, JSON.stringify(verse, null, 2))
}

async function main() {
    for(let bookId=1; bookId<=1; bookId++) {
        const bible = "osnb1";
        const maxChapters = books.find(b => b.id === bookId).chapters;
        for (let chapterId = 1; chapterId <= maxChapters; chapterId++) {
            const verses = getOriginalChapter(bookId, chapterId)
            for (const verse of verses) {
                const verseId = verse.verseId
                const verseFile = path.join(__dirname, "references", `${bookId}`, `${chapterId}`, `${verseId}.json`)
                if (!fs.existsSync(verseFile))
                    await doVerse(bible, bookId, chapterId, verseId)
            }
        }
    }
}

main();