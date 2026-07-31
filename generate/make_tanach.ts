import fs from "fs";
import {books} from "./constants.js";
import path from 'path';
import {fileURLToPath} from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function doTanach(bookId) {
    const bookText = fs.readFileSync(path.join(__dirname, "../", books.find(b => b.id === bookId).file));
    const lines = bookText.toString().split("\n");
    lines.shift();

    const maxChapters = books.find(b => b.id === bookId).chapters;

    for(let chapterId=1;chapterId<=maxChapters;chapterId++) {
        const chapter = lines.filter(verse => {
            // console.log(verse);
            if (verse.match(/xxxx/)) return false;
            const match = verse.match(/(\d+)\s*[:׃]\s*(\d+)/);

            if (match) {
                const [, verseId, chapter] = match;
                return +chapter === +chapterId;
            } else {
                console.log("No match found");
                return false;
            }

        }).map(verse => {
            console.log(bookId, chapterId, verse)
            const [_, verseId, chapter, text] = verse.match(/(\d+)\s*[:׃]\s*(\d+)\s*(.*)/);
            return {
                bookId,
                chapterId,
                verseId: +verseId,
                text
            }
        })
        const dir = path.join(__dirname, "bibles_raw", "tanach", `${bookId}`)
        if (!fs.existsSync(dir))
            fs.mkdirSync(dir, {recursive: true});
        const filename = path.join(dir, `${chapterId}.json`)
        fs.writeFileSync(filename, JSON.stringify(chapter, null, 2))
    }
}

async function main() {
    for(let bookId=1;bookId<=39;bookId++) {
        await doTanach(bookId)
    }
}

main()