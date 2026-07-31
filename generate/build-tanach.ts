import fs from "fs";
import {books} from "./constants.js";
import path from 'path';
import {fileURLToPath} from 'url';
import type {Verse} from '../kvn/src/bible-types.js';

import {parseArgs, formatHelp, COMMON_FLAGS} from './cli.js';
import type {FlagSpec} from './cli.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Skriptet tar ingen flagg: det gjenimporterer HELE den hebraiske grunnteksten
 * hver gang, uten spørsmål. Derfor er `--help` det eneste som finnes — og
 * derfor må sjekken stå før første `readFileSync`/`writeFileSync` (#51).
 */
const SPEC: Record<string, FlagSpec> = {
    help: COMMON_FLAGS.help,
};

const HELP_PURPOSE =
    'importerer den hebraiske grunnteksten (Tanach) på nytt fra ' +
    'external/bibles/tanach/*.txt og OVERSKRIVER generate/bibles_raw/tanach/' +
    '<bok>/<kapittel>.json for alle 39 GT-bøkene. Ingen flagg, ingen ' +
    'avgrensning: hele grunnteksten skrives om ved hver kjøring.';

const HELP_EXAMPLES = [
    'bun generate/build-tanach.ts        # gjenimporter hele Tanach',
];

async function doTanach(bookId: number): Promise<void> {
    const bookText = fs.readFileSync(path.join(__dirname, "../", books.find(b => b.id === bookId)!.file));
    const lines = bookText.toString().split("\n");
    lines.shift();

    const maxChapters = books.find(b => b.id === bookId)!.chapters;

    for(let chapterId=1;chapterId<=maxChapters;chapterId++) {
        const chapter: Verse[] = lines.filter(verse => {
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
            const [_, verseId, chapter, text] = verse.match(/(\d+)\s*[:׃]\s*(\d+)\s*(.*)/)!;
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

async function main(): Promise<void> {
    // Hjelpen skal ut før noe leses eller skrives.
    const {flags} = parseArgs(process.argv.slice(2), SPEC);
    if (flags.help) {
        console.log(formatHelp('generate/build-tanach.ts', HELP_PURPOSE, SPEC, HELP_EXAMPLES));
        process.exit(0);
    }

    for(let bookId=1;bookId<=39;bookId++) {
        await doTanach(bookId)
    }
}

// Kjører bare når fila startes direkte. Uten vakten kjører jobben ved IMPORT —
// det er grunnen til at days.ts slettet data bare man lastet modulen (#108),
// og det gjør skriptene umulige å teste.
if (import.meta.main) {
    main()
}