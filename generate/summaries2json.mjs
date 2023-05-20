import dotenv from 'dotenv';

dotenv.config()
import * as fs from 'fs';

const languages = ['nb']

const doJson = async () => {
    const summaries = [];
    languages.forEach(language => {

        fs.readdirSync(`summaries/${language}/`).forEach(file => {
            const content = fs.readFileSync(`summaries/${language}/${file}`, 'utf-8');
            const parts = file.match(/(\d+)-(\d+)\.txt/);
            const bookId = parts[1];
            const chapterId = parts[2];
            const contentParts = content.split(/\n\n/);

            summaries.push({language, bookId, chapterId, text: `<p>${contentParts.join('</p><p>')}</p>`})
        });
    })
    fs.writeFileSync(`../client/src/assets/summaries.json`, JSON.stringify(summaries, null, 4));
}


await doJson();