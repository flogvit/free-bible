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

async function doText(bible, verse, filename) {
    const language = 'Norwegian bokmål';
    let content = `You will be given a verse in the original language.
You should explain every word in the original text in detail. Add interesting info if any. Your response must be in JSON format, and only JSON.
Do not include punctuation, commas etc as words.

JSON format:
[
    {
        "bookId": ${verse.bookId},
        "chapterId": ${verse.chapterId},
        "verseId": ${verse.verseId},
        "words": [
            {
                "word": "<word>",
                "pronunciation": "<in latin letters>",
                "wordId": <position in verse>,
                "explanation": "<explanation in ${language}>"
            }
        ]
    }
]

Original text:
${verse.text}
`
    console.log(`Processing ${verse.bookId}:${verse.chapterId}:${verse.verseId}...`);
    const completion = await doAnthropicCall(content);
    const returnContent = completion.content[0].text;

    console.log(returnContent);
    const result = JSON.parse(returnContent.replaceAll("```json", "").replaceAll("```", ""));
    console.log("Writing", filename);
    fs.writeFileSync(filename, JSON.stringify(result, null, 2));
}

async function main() {
    const args = process.argv.slice(2);
    const startBook = args[0] ? +args[0] : 1;
    const endBook = args[1] ? +args[1] : 1;

    for (let bookId = startBook; bookId <= endBook; bookId++) {
        const bible = bookId < 40 ? "tanach" : "sblgnt";
        const maxChapters = books.find(b => b.id === bookId).chapters;

        for (let chapterId = 1; chapterId <= maxChapters; chapterId++) {
            const chapterFile = path.join(__dirname, `bibles_raw/${bible}/${bookId}/${chapterId}.json`);
            if (!fs.existsSync(chapterFile)) {
                console.log(`Chapter file not found: ${chapterFile}`);
                continue;
            }

            const chapter = JSON.parse(fs.readFileSync(chapterFile));
            const outputPath = path.join(__dirname, "word4word", `${bible}`, `${bookId}`, `${chapterId}`);
            if (!fs.existsSync(outputPath)) {
                fs.mkdirSync(outputPath, {recursive: true});
            }

            for (let verse of chapter) {
                const filename = `${outputPath}/${verse.verseId}.json`;
                if (!fs.existsSync(filename)) {
                    console.log(verse);
                    await doText(bible, verse, filename);
                } else {
                    console.log(`Skipping ${bookId}:${chapterId}:${verse.verseId} (already exists)`);
                }
            }
        }
    }
}

main();
