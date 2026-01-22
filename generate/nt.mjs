import dotenv from 'dotenv'
import * as fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config()

import Anthropic from '@anthropic-ai/sdk';
import {bibles, books, anthropicModel} from "./constants.js";

const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
});

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
    let completion = await doAnthropicCall(content)
    let returnContent = completion.content[0].text
    console.log(returnContent)

    const result = JSON.parse(returnContent.replaceAll("```json", "").replaceAll("```", ""))
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
        const bible = "osnn1";
        const maxChapters = books.find(b => b.id === bookId).chapters;
        for (let chapterId = 1; chapterId <= maxChapters; chapterId++) {
            const chapterFile = `bibles_raw/${bible}/${bookId}/${chapterId}.json`
            if (!fs.existsSync(chapterFile))
                await doBook(bible, bookId, chapterId)
        }
    }
}

main();