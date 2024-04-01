import * as fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getBible(bible) {
    const baseDir = path.join(__dirname, `/bibles_raw/${bible}`)

    let verses = [];

    try {
        // Step 1: Read the directory (book level)
        const books = fs.readdirSync(baseDir, { withFileTypes: true });
        const sortedBooks = books.filter(dirent => dirent.isDirectory()).sort((a, b) => a.name - b.name);

        for (const book of sortedBooks) {
            const bookPath = path.join(baseDir, book.name);
            const chapters = fs.readdirSync(bookPath, { withFileTypes: true });
            const sortedChapters = chapters.filter(dirent => dirent.isFile()).sort((a, b) => a.name.split('.')[0] - b.name.split('.')[0]);

            // Step 2: Read each chapter file and join verses
            for (const chapter of sortedChapters) {
                const chapterPath = path.join(bookPath, chapter.name);
                const chapterContent = fs.readFileSync(chapterPath, 'utf-8');
                const versesArray = JSON.parse(chapterContent);
                let id = 1;
                for(let verse of versesArray) {
                    if (id !== verse.verseId) {
                        console.log(`Wrong id ${id} `, verse);
                    }
                    const word4wordFile = path.join(__dirname, "word4word", bible, book.name, chapter.name.split('.')[0], `${verse.verseId}.json`)
                    if (fs.existsSync(word4wordFile)) {
                        const verseWords = JSON.parse(fs.readFileSync(word4wordFile, 'utf-8'))
                        verse.words = verseWords[0].words
                    }
                    id = verse.verseId+1
                }
                verses = verses.concat(versesArray);
            }
        }
    } catch (err) {
        console.error('Error reading verse files:', err);
    }

    return verses;
}

async function main() {
    const args = process.argv.slice(2);
    if (args.length !== 1)
        console.error("Wrong params: <bible>");

    const bible = args[0];
    const verses = getBible(bible)
    fs.writeFileSync(path.join(__dirname, `../compiled/bibles/${bible}.json`), JSON.stringify(verses, null, 2))
    fs.writeFileSync(path.join(__dirname, `../client/src/bibles/${bible}.json`), JSON.stringify(verses, null, 2))
}

main()