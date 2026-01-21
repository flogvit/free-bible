import dotenv from 'dotenv'
import * as fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config()

import Anthropic from '@anthropic-ai/sdk';
import {bibles, books} from "./constants.js";

const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
});

async function doAnthropicCall(content) {
    return anthropic.messages.create({
        model: "claude-opus-4-5-20251101",
        max_tokens: 8192,
        messages: [
            {
                role: "user",
                content
            }
        ]
    });
}

async function doText(bible, originalText, verse, filename) {
    const language = bibles[bible];
    let content = `You will be given a verse in the original Greek language and a translation.
You should explain every word in the translated text. Your response must be in JSON format, and only JSON.
Do not include punctuation, commas etc as words.

IMPORTANT GUIDELINES FOR EXPLANATIONS:
- Write natural, varied ${language} explanations
- DO NOT start every explanation with "Det greske ordet..." - vary your sentence structure
- Focus on the meaning and significance of the word in context
- Include interesting facts the reader might not know (etymology, historical context, Greek wordplay)
- For names: explain the meaning of the name and any significant symbolism
- For verbs: explain the action and its nuances in Greek
- For nouns: explain the concept and its biblical/cultural significance
- For prepositions/conjunctions: briefly explain their function
- Keep explanations concise but informative (1-2 sentences)
- Use different opening phrases like: "Betyr...", "Refererer til...", "Navnet på...", "Et verb som...", "Brukes her for å...", etc.

JSON format:
[
    {
        "bookId": ${verse.bookId},
        "chapterId": ${verse.chapterId},
        "verseId": ${verse.verseId},
        "words": [
            {
                "word": "<word>",
                "wordId": <position in verse>,
                "original": "<original Greek word(s)>",
                "explanation": "<varied, natural explanation>"
            }
        ]
    }
]

Original Greek text:
${originalText}

Translation:
${verse.text}
`
    let completion = await doAnthropicCall(content)
    let returnContent = completion.content[0].text
    console.log(returnContent)

    const result = JSON.parse(returnContent.replaceAll("```json", "").replaceAll("```", ""))
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
    for(let bookId=40; bookId<=66; bookId++) {
        const bible = "sblgnt";
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