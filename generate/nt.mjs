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

async function doText(bible, originalText, bookId, chapterId) {
    const language = bibles[bible];
    let content = `You will be given a bible text in the original language, and must return the translation as a json, and only json on the format:
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

    do {
        content = `${content}${returnContent}`
        completion = await doGPTCall(content)
        returnContent = completion.choices[0].message.content
        fullReturnContent = `${fullReturnContent}${returnContent}`
        console.log(returnContent)
    } while (completion.choices[0].finish_reason === "length")

    console.log(fullReturnContent)
    const result = JSON.parse(fullReturnContent.replaceAll("```json", "").replaceAll("```", ""))
    const dir = `bibles_raw/${bible}/${bookId}`
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, {recursive: true});
    }
    const filename = `${dir}/${chapterId}.json`
    console.log("Writing", filename);
    fs.writeFileSync(filename, JSON.stringify(result, null, 2))
}

async function doBook(bible, bookId, chapterId) {
    const bookText = fs.readFileSync(path.join(__dirname, "../", books.find(b => b.id === bookId).file));
    const lines = bookText.toString().split("\n");
    lines.shift();
    const chapter = lines.filter(verse => {
        try {
            const [_, book, chapter, v, text] = verse.match(/([^\d]+) (\d+):(\d+)\t(.+)/);
            return +chapter === +chapterId
        } catch (e) {
            return false
        }

    })
    await doText(bible, chapter.join("\n"), bookId, chapterId);
}

async function main() {
    for(let bookId=40; bookId<=66; bookId++) {
        const bible = "osnb1";
        const maxChapters = books.find(b => b.id === bookId).chapters;
        for (let chapterId = 1; chapterId <= maxChapters; chapterId++) {
            const chapterFile = `bibles_raw/${bible}/${bookId}/${chapterId}.json`
            if (!fs.existsSync(chapterFile))
                await doBook(bible, bookId, chapterId)
        }
    }
}

main();