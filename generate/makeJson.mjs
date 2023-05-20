import dotenv from 'dotenv';
dotenv.config()
import * as fs from 'fs';

const doJson = async (translation) => {
    let result = []
    const visited = {};
    for(let i=1;i<=66;i++) {
        const content = fs.readFileSync(`bibles_raw/${translation}/${translation}-${i}.txt`, 'utf-8');
        const re = /^(\d+):(\d+):(\d+):\s*(.*)$/;
        let oldChapterId = 1;
        let oldVerseId = 0;
        content.split(/\r?\n/).forEach(line =>  {
            if (line.length===0) return;
            const res = line.match(re);
            let bookId, chapterId, verseId, text;
            try {
                bookId = +res[1];
                chapterId = +res[2];
                verseId = +res[3];
                text = res[4];
                if (bookId!==i) {
                    console.log("Error with book", i, line);
                    process.exit(0);
                }
                if (chapterId>oldChapterId+1 || chapterId<oldChapterId) {
                    console.log("Wrong chapter", i, line);
                    process.exit(0);
                }
                if (chapterId===oldChapterId+1) {
                    oldChapterId++;
                    oldVerseId=0;
                }
                if (verseId !== oldVerseId+1) {
                    console.log("Not next verse", i, line, oldChapterId, oldVerseId);
                    process.exit(0);
                }
                oldVerseId++;
                const key = `${bookId}#${chapterId}#${verseId}`;
                if (key in visited) {
                    console.log("Double line", i, line)
                    process.exit(0);
                }
                visited[key] = true;
                result.push({bible: translation, bookId, chapterId, verseId, text: text.trim(), uBookId: bookId, uChapterId: chapterId, uVerseId: verseId})
            } catch (e) {
                console.log(line, i);
                process.exit(0);
            }
        });
    }
    fs.writeFileSync(`../bibles/${translation}.json`, JSON.stringify(result, null, 4));
}

const args = process.argv.slice(2);
if (args.length!==1)
    console.error("Wrong params: <translation>");

await doJson(args[0]);