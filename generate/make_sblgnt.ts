import fs from "fs";
import {books} from "./constants.js";
import path from 'path';
import {fileURLToPath} from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function doSBLGNT(bookId) {
    const bookText = fs.readFileSync(path.join(__dirname, "../", books.find(b => b.id === bookId).file));
    const lines = bookText.toString().split("\n");
    lines.shift();

    const maxChapters = books.find(b => b.id === bookId).chapters;

    for(let chapterId=1;chapterId<=maxChapters;chapterId++) {
        const chapter = lines.filter(verse => {
            try {
                const [_, book, chapter, v, text] = verse.match(/([^\d]+)(\d+):(\d+)\s+(.+)/);
                return +chapter === +chapterId
            } catch (e) {
                return false
            }

        }).map(verse => {
            // console.log(bookId, chapterId, verse)
            const [_, book, chapter, verseId, text] = verse.match(/([^\d]+)(\d+):(\d+)\s+(.+)/);
            return {
                bookId,
                chapterId,
                verseId: +verseId,
                text
            }
        })
        const dir = path.join(__dirname, "bibles_raw", "sblgnt", `${bookId}`)
        if (!fs.existsSync(dir))
            fs.mkdirSync(dir, {recursive: true});
        const filename = path.join(dir, `${chapterId}.json`)
        fs.writeFileSync(filename, JSON.stringify(chapter, null, 2))
    }
}

async function main() {
    for(let bookId=40;bookId<=66;bookId++) {
        await doSBLGNT(bookId)
    }
}

main()