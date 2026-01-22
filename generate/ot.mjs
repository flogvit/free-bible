// For some reason a lot of verses is omitted when ran once
// Run several times to add the missing verses

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

const MAX_VERSES_PER_BATCH = 60;

async function doText(bible, originalText, bookId, chapterId, verses, filename) {
    const language = bibles[bible];
    const lines = originalText.split("\n");

    // Split into batches if there are too many verses
    const batches = [];
    for (let i = 0; i < lines.length; i += MAX_VERSES_PER_BATCH) {
        batches.push(lines.slice(i, i + MAX_VERSES_PER_BATCH));
    }

    console.log(`Processing ${lines.length} verses in ${batches.length} batch(es)`);

    let allResults = [];

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        const batch = batches[batchIndex];
        console.log(`Processing batch ${batchIndex + 1}/${batches.length} (${batch.length} verses)`);

        let content = `You will be given a bible text in the original language, and must return the translation as a json on the format, and only json:
[
    {
        "bookId": ${bookId},
        "chapterId": ${chapterId},
        "verseId": verseId,
        "text": "Everything started when God created heaven and earth."
    },
]

Translation must be ${language} in a modern, easy to read, language. But you should emphasize translating theologically correct.

Text:
${batch.join("\n")}
`
        let completion = await doAnthropicCall(content)
        let returnContent = completion.content[0].text
        console.log(returnContent)

        const result = JSON.parse(returnContent.replaceAll("```json", "").replaceAll("```", ""))
        allResults = [...allResults, ...result];
    }

    fs.writeFileSync(filename, JSON.stringify([...verses, ...allResults].sort((a, b) => a.verseId - b.verseId), null, 2))
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
        const bible = "osnn1";
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