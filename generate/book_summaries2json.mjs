import dotenv from 'dotenv';

dotenv.config()
import * as fs from 'fs';

const languages = ['nb']

const doJson = async () => {
    const summaries = [];
    languages.forEach(language => {

        fs.readdirSync(`book_summaries/${language}/`).forEach(file => {
            const content = fs.readFileSync(`book_summaries/${language}/${file}`, 'utf-8');
            const parts = file.match(/(\d+)\.txt/);
            const bookId = parts[1];
            const contentParts = content.split(/\n\n/);

            summaries.push({language, bookId, text: `<p>${contentParts.join('</p><p>')}</p>`.replaceAll(`\n`, '<br/>')})
        });
    })
    fs.writeFileSync(`../client/src/assets/book_summaries.json`, JSON.stringify(summaries, null, 4));
}


await doJson();