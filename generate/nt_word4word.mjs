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

async function doText(bible, originalText, verse, filename) {
    const language = bibles[bible];
    // console.log(bible, originalText, language);
    // return;
    let content = `You will be given a verse in the original language and a translation.
    You should explain every word in the translated text. You response must be on the json format, and only json.
    Do not include punctuation, commas etc as words.
[
    {
        "bookId": ${verse.bookId},
        "chapterId": ${verse.chapterId},
        "verseId": ${verse.verseId},
        "words": [
            {
                word: <word>,
                wordId: <position in verse>,
                original: <original word(s)>,
                explanation: ""
            }
        ]
    },
]

Explanation must be ${language}. 

Original text:
${originalText}

Translation:
${verse.text}
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
    console.log("Writing", filename);
    fs.writeFileSync(filename, JSON.stringify(result, null, 2))
}

async function doBook(bible, verse, filename) {
    const bookText = fs.readFileSync(path.join(__dirname, "../", books.find(b => b.id === verse.bookId).file));
    const lines = bookText.toString().split("\n");
    lines.shift();
    // console.log(lines)
    const verseOrg = lines.filter(verse => {
        try {
            const [_, book, chapter, v, text] = verse.match(/([^\d]+) (\d+):(\d+)\t(.+)/);
            return +chapter === +chapterId && +v === +verseId
        } catch (e) {
            return false
        }

    })
    console.log(verseOrg)
    await doText(bible, verseOrg, verse, filename);
}

async function main() {
    for(let bookId=40; bookId<=40; bookId++) {
        const bible = "osnb1";
        const maxChapters = books.find(b => b.id === bookId).chapters;
        for (let chapterId = 1; chapterId <= maxChapters; chapterId++) {
            const chapterFile = path.join(__dirname, `bibles_raw/${bible}/${bookId}/${chapterId}.json`)
            const chapter = JSON.parse(fs.readFileSync(chapterFile))
            const outputPath = path.join(__dirname, "word4word", `${bible}`, `${bookId}`, `${chapterId}`);
            if (!fs.existsSync(outputPath)) {
                fs.mkdirSync(outputPath, {recursive: true});
            }
            for(let verse of chapter) {
                const filename = `${outputPath}/${verse.verseId}.json`
                if (!fs.existsSync(filename)) {
                    console.log(verse)
                    await doBook(bible, verse, filename)
                }
            }
        }
    }
}

main();