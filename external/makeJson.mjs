import dotenv from 'dotenv';

dotenv.config()
import * as fs from 'fs';

const doJson = async (translation) => {
    let result = []
    const visited = {};
    const content = fs.readFileSync(`bibles/${translation}.txt`, 'latin1');
    const re = /^(\d+):(\d+):(\d+):(\s*)(.*)$/;
    let oldBookId = 0;
    let oldChapterId = 1;
    let oldVerseId = 0;
    let lastPart = 0;
    content.split(/\r?\n/).forEach(line => {
        if (line.length === 0) return;
        const res = line.match(re);
        let bookId, chapterId, verseId, type, text;
        let uBookId, uChapterId, uVerseId;
        try {
            bookId = +res[1];
            chapterId = +res[2];
            verseId = +res[3];
            type = res[4];
            text = res[5];
            uBookId = bookId;
            uChapterId = chapterId;
            uVerseId = verseId;

            if (text.substring(0, 1) === "\\") {
                const parts = text.split(/\\/);
                const ref = parts[1].split(/:/);
                chapterId = +ref[0];
                verseId = +ref[1];
                text = parts[2];
            }

            if (text.slice(-1) === "\\") {
                result.push({bible: translation, bookId, chapterId, verseId, text: text.slice(0, -1).trim(), uBookId, uChapterId, uVerseId, part: ++lastPart})
                oldChapterId = uChapterId;
                oldVerseId = uVerseId;
                return;
            }
            if (type === "  ") return;
            if (bookId !== oldBookId) {
                oldChapterId = 1;
                oldVerseId = 0;
                oldBookId = bookId;
            }
            if (uChapterId > oldChapterId + 1 || uChapterId < oldChapterId) {
                console.log("Wrong chapter", bookId, line);
                process.exit(0);
            }
            if (uChapterId === oldChapterId + 1) {
                oldChapterId++;
                oldVerseId = 0;
            }
            if (uVerseId !== oldVerseId + 1 && verseId !== oldVerseId + 1) {
                console.log("Not next verse", bookId, line, oldChapterId, oldVerseId);
                process.exit(0);
            }
            oldVerseId++;
            const key = `${bookId}#${uChapterId}#${uVerseId}`;
            if (key in visited) {
                console.log("Double line", bookId, line)
                process.exit(0);
            }
            visited[key] = true;
            const insert = {bible: translation, bookId, chapterId, verseId, text: text.trim(), uBookId, uChapterId, uVerseId};
            if (lastPart>0)
                insert.part = ++lastPart;
            result.push(insert);
            lastPart = 0;
        } catch (e) {
            console.log(line, bookId);
            process.exit(0);
        }
    });
    fs.writeFileSync(`../bibles/${translation}.json`, JSON.stringify(result, null, 4));
}

const args = process.argv.slice(2);
if (args.length !== 1)
    console.error("Wrong params: <translation>");

await doJson(args[0]);