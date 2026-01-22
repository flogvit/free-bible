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

async function doText(bible, originalText, verse, filename) {
    const language = bibles[bible];
    let content = `You will be given a verse in the original Hebrew language and a translation.
You should explain every word in the translated text. Your response must be in JSON format, and only JSON.
Do not include punctuation, commas etc as words.

IMPORTANT GUIDELINES FOR EXPLANATIONS:
- Write natural, varied ${language} explanations
- DO NOT start every explanation with "Det hebraiske ordet..." - vary your sentence structure
- Focus on the meaning and significance of the word in context
- Include interesting facts the reader might not know (etymology, historical context, Hebrew wordplay)
- For names: explain the meaning of the name and any significant symbolism
- For verbs: explain the action and its nuances in Hebrew
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
                "original": "<original Hebrew word(s)>",
                "explanation": "<varied, natural explanation>"
            }
        ]
    }
]

Original Hebrew text:
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

async function doVerse(bible, verse, filename) {
    const tanachFile = path.join(__dirname, `bibles_raw/tanach/${verse.bookId}/${verse.chapterId}.json`);
    const tanachChapter = JSON.parse(fs.readFileSync(tanachFile));
    const originalVerse = tanachChapter.find(v => v.verseId === verse.verseId);

    if (!originalVerse) {
        console.log(`Original verse not found for ${verse.bookId}:${verse.chapterId}:${verse.verseId}`);
        return;
    }

    await doText(bible, originalVerse.text, verse, filename);
}

async function main() {
    const args = process.argv.slice(2);
    if (args.length !== 1)
        console.error("Wrong params: <bible>");

    const bible = args[0];
    for(let bookId=1; bookId<=39; bookId++) {
        const maxChapters = books.find(b => b.id === bookId).chapters;
        for (let chapterId = 1; chapterId <= maxChapters; chapterId++) {
            const chapterFile = path.join(__dirname, `bibles_raw/${bible}/${bookId}/${chapterId}.json`)
            if (!fs.existsSync(chapterFile)) {
                console.log(`Chapter file not found: ${chapterFile}`);
                continue;
            }
            const chapter = JSON.parse(fs.readFileSync(chapterFile))
            const outputPath = path.join(__dirname, "word4word", `${bible}`, `${bookId}`, `${chapterId}`);
            if (!fs.existsSync(outputPath)) {
                fs.mkdirSync(outputPath, {recursive: true});
            }
            for(let verse of chapter) {
                const filename = `${outputPath}/${verse.verseId}.json`
                if (!fs.existsSync(filename)) {
                    console.log(verse)
                    await doVerse(bible, verse, filename)
                }
            }
        }
    }
}

main();
