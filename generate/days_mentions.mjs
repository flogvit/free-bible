import dotenv from 'dotenv';
import * as fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config();

import {books, getBookName} from './constants.js';
import {callWithRetry} from './llm.js';

const SOURCES_DIR = path.join(__dirname, 'bibles_raw');
const OUTPUT_BASE = path.join(__dirname, 'days_mentions');

// === Parallel verse lookup ===
// For bibles whose verse numbering matches hebrew/sblgnt directly (e.g. osnb),
// lookup is identity. For others, a chain through kvn would be required.

const IDENTITY_PARALLEL_BIBLES = new Set(['osnb']);

const chapterCache = new Map();
function loadSourceChapter(sourceName, bookId, chapterId) {
    const key = `${sourceName}/${bookId}/${chapterId}`;
    if (chapterCache.has(key)) return chapterCache.get(key);
    const file = path.join(SOURCES_DIR, sourceName, String(bookId), `${chapterId}.json`);
    if (!fs.existsSync(file)) {
        chapterCache.set(key, null);
        return null;
    }
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    chapterCache.set(key, data);
    return data;
}

function getParallelVerse(bible, bookId, chapterId, verseId) {
    const isOt = bookId <= 39;
    const sourceName = isOt ? 'hebrew' : 'sblgnt';
    const language = isOt ? 'hebrew' : 'greek';

    if (!IDENTITY_PARALLEL_BIBLES.has(bible)) {
        return {language, text: null, available: false, reason: `parallel-lookup-not-implemented-for-${bible}`};
    }

    const chapter = loadSourceChapter(sourceName, bookId, chapterId);
    if (!chapter) return {language, text: null, available: false, reason: 'source-chapter-missing'};
    const verse = chapter.find(v => v.verseId === verseId);
    if (!verse) return {language, text: null, available: false, reason: 'source-verse-missing'};
    return {language, text: verse.text, available: true};
}

// === LLM ===

const DAY_SCHEMA = {
    type: 'object',
    properties: {
        days: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    name: {type: 'string'},
                    category: {
                        type: 'string',
                        enum: ['høytid', 'eskatologisk', 'historisk', 'ukentlig', 'periode', 'annet']
                    },
                    norwegianTerm: {type: 'string'},
                    originalTerm: {
                        anyOf: [
                            {type: 'null'},
                            {
                                type: 'object',
                                properties: {
                                    language: {type: 'string', enum: ['hebrew', 'greek']},
                                    script: {type: 'string'},
                                    transliteration: {type: 'string'}
                                },
                                required: ['language', 'script', 'transliteration'],
                                additionalProperties: false
                            }
                        ]
                    },
                    quote: {type: 'string'},
                    reason: {type: 'string'}
                },
                required: ['name', 'category', 'norwegianTerm', 'originalTerm', 'quote', 'reason'],
                additionalProperties: false
            }
        }
    },
    required: ['days'],
    additionalProperties: false
};

function buildPrompt(ref, norwegianText, parallel) {
    const originalBlock = parallel.available
        ? `Original (${parallel.language}): "${parallel.text}"`
        : `Original: IKKE TILGJENGELIG (originalspråk-kilde mangler for dette verset).`;
    return `Bibelvers fra ${ref}:
Norsk: "${norwegianText}"
${originalBlock}

Nevner dette verset en spesifikk dag, høytid, tidsperiode eller navngitt tidsbegrep fra Bibelen?

TA MED:
- Navngitte høytider (sabbat, påske/pesach, pinse/shavuot, løvhyttefesten/sukkot, soningsdagen/yom kippur, nymånefest, tempelvielsesfesten, purim, usyret brøds høytid osv.)
- Eskatologiske eller teologiske dager ("Herrens dag", "dommens dag", "den store dag", "den første dag i uken" når den har teologisk betydning)
- Navngitte tidsperioder (sabbatsår, jubelår, 70 års fangenskap)
- Spesifikke historiske dager som markerer en bestemt hendelse, inkludert:
  - DATERTE HENDELSER: Enhver presis datoangivelse ("i den N. måneden, på den N. dagen", "den N. dagen i den N. måneden", "i det N. året, i den N. måneden, på den N. dagen") — disse markerer ALLTID en spesifikk historisk hendelse i konteksten, selv om verset ikke eksplisitt sier "på denne dagen". F.eks. "I den sjuende måneden, på den syttende dagen i måneden, ble arken stående" → tag som historisk dag (arkens landingsdag).
  - HENDELSES-DAGER med kontekst: "den dagen [konkret hendelse]", "samme dag [hendelse]", "på denne dagen [hendelse]" — selv om "den dagen" / "samme dag" grammatisk er bestemt artikkel, regnes de som spesifikk historisk dag når de etterfølges av en konkret, identifiserbar hendelse (pakts-inngåelse, salvelse, kongedøde, omskjærelse, slag, tempelinnvielse osv.). F.eks. "Den dagen sluttet Herren en pakt med Abram" (Gen 15:18), "Samme dag ble Abraham omskåret" (Gen 17:26).
  - NAVNGITTE PERIODER/REGLER knyttet til dag: "åtte dager gammel skal alle hankjønn omskjæres" → omskjærelses-dagen (8. dag) som navngitt regel/periode; "den syvende dag" som hviledag → sabbat.
  - Hendelses-navn: "dagen Noah gikk inn i arken", "dagen Jerusalem falt", "dagen for utgangen av Egypt", "den dagen Saul døde".
  - Skapelses-dagene ("den første/andre/tredje/fjerde/femte/sjette/sjuende dagen" i skapelsesfortellingen — kategori "historisk" eller "periode").
  - Oppstandelses-dagen ("den tredje dag" når den refererer til Jesu oppstandelse — kategori "eskatologisk").
- Forberedelsesdagen (parasceve)

VIKTIG OM "DEN TREDJE DAG":
- I skapelsesfortellingen (1 Mos 1) → category: "historisk" eller "periode"
- I oppstandelses-/profeti-kontekst (Jesus stod opp, "etter tre dager") → category: "eskatologisk"
- Vurder konteksten i verset.

IKKE TA MED:
- Generiske tidsmarkører uten spesifikk hendelse: "neste dag", "den dagen" (uten kontekst), "i de dager", "om tre dager" (uten oppstandelses-/profeti-kontekst)
- Vanlige ukedager uten religiøs betydning
- Aldersangivelser eller generell varighet ("levde i 80 år", "i 40 dager") med mindre tallet selv er den navngitte perioden ("70 års fangenskap")

For hver dag du finner:
- name: kort navn på dagen/høytiden/perioden
- category: "høytid", "eskatologisk", "historisk", "ukentlig", "periode" eller "annet"
- norwegianTerm: det faktiske ordet/uttrykket slik det står i den norske teksten
- originalTerm: ordet fra originalteksten som tilsvarer. Objekt med {language: "hebrew"|"greek", script: (det faktiske ordet fra originalteksten), transliteration: (latinsk translitterasjon)}. Sett null hvis originaltekst ikke er tilgjengelig, eller hvis du ikke kan identifisere et tydelig motsvar-ord.
- quote: kort sitat fra den norske teksten (maks ~80 tegn)
- reason: kort begrunnelse (1 setning)

Hvis ingen dager nevnes, returner tom liste.`;
}

async function processVerse(bible, bookId, chapterId, verse) {
    const bookName = getBookName(bookId, 'nb');
    const ref = `${bookName} ${chapterId}:${verse.verseId}`;
    const parallel = getParallelVerse(bible, bookId, chapterId, verse.verseId);
    const prompt = buildPrompt(ref, verse.text, parallel);
    const result = await callWithRetry(prompt, {
        schema: DAY_SCHEMA,
        local: true,
        context: ref
    });
    const rawDays = result.days || [];
    return rawDays.map(d => ({
        ...d,
        bookId,
        chapterId,
        verseId: verse.verseId,
        translation: bible,
        originalAvailable: parallel.available
    }));
}

async function processChapter(bible, bookId, chapterId, force) {
    const inputFile = path.join(SOURCES_DIR, bible, String(bookId), `${chapterId}.json`);
    const outputFile = path.join(OUTPUT_BASE, bible, String(bookId), `${chapterId}.json`);
    const bookName = getBookName(bookId, 'nb');

    if (!force && fs.existsSync(outputFile)) {
        console.log(`  ${bookName} ${chapterId}: already processed, skipping`);
        return;
    }
    if (!fs.existsSync(inputFile)) {
        console.log(`  ${bookName} ${chapterId}: input missing, skipping`);
        return;
    }

    const verses = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
    const results = [];
    let totalDays = 0;
    const t0 = Date.now();

    for (const verse of verses) {
        const ref = `${bookName} ${chapterId}:${verse.verseId}`;
        process.stdout.write(`  ${ref}... `);
        try {
            const days = await processVerse(bible, bookId, chapterId, verse);
            results.push({verseId: verse.verseId, days});
            totalDays += days.length;
            if (days.length > 0) {
                process.stdout.write(`${days.length}: ${days.map(d => d.name).join(', ')}\n`);
            } else {
                process.stdout.write(`-\n`);
            }
        } catch (err) {
            process.stdout.write(`FEIL: ${err.message}\n`);
            results.push({verseId: verse.verseId, days: [], error: err.message});
        }
    }

    fs.mkdirSync(path.dirname(outputFile), {recursive: true});
    fs.writeFileSync(outputFile, JSON.stringify({
        translation: bible,
        bookId,
        chapterId,
        verses: results
    }, null, 2));

    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`  ${bookName} ${chapterId}: ${totalDays} dag-forekomster i ${verses.length} vers (${dt}s)`);
}

function printUsage() {
    console.log(`
Usage: node days_mentions.mjs --bible <name> [options]

Pass 1: scan each verse with qwen3.5:122b and extract Bible day/feast mentions.
Output is per-chapter JSON with day occurrences (Norwegian + original-language term).

Options:
  --bible <name>       Bible translation to scan (e.g., osnb) [required]
  --book <range>       Process book(s): single (43) or range (1-20)
  --chapter <range>    Process chapter(s): single (12) or range (1-10) [requires single --book]
  --ot                 Process only Old Testament (books 1-39)
  --nt                 Process only New Testament (books 40-66)
  --force              Re-process even if chapter already has output
  --help               Show this help message

Output structure:
  generate/days_mentions/<bible>/<bookId>/<chapterId>.json

Examples:
  node days_mentions.mjs --bible osnb --book 40 --chapter 12
  node days_mentions.mjs --bible osnb --book 40
  node days_mentions.mjs --bible osnb --nt
  node days_mentions.mjs --bible osnb
`);
}

function parseRange(value) {
    if (value.includes('-')) {
        const [start, end] = value.split('-').map(n => parseInt(n, 10));
        return {start, end};
    }
    const n = parseInt(value, 10);
    return {start: n, end: n};
}

async function main() {
    const args = process.argv.slice(2);
    const options = {
        bible: null,
        bookStart: null,
        bookEnd: null,
        chapterStart: null,
        chapterEnd: null,
        force: false,
        help: false
    };

    let i = 0;
    while (i < args.length) {
        const arg = args[i];
        if (arg === '--bible' && i + 1 < args.length) {
            options.bible = args[++i];
        } else if (arg === '--book' && i + 1 < args.length) {
            const r = parseRange(args[++i]);
            options.bookStart = r.start;
            options.bookEnd = r.end;
        } else if (arg === '--chapter' && i + 1 < args.length) {
            const r = parseRange(args[++i]);
            options.chapterStart = r.start;
            options.chapterEnd = r.end;
        } else if (arg === '--ot') {
            options.bookStart = 1;
            options.bookEnd = 39;
        } else if (arg === '--nt') {
            options.bookStart = 40;
            options.bookEnd = 66;
        } else if (arg === '--force') {
            options.force = true;
        } else if (arg === '--help') {
            options.help = true;
        } else {
            console.error(`Unknown argument: ${arg}`);
            options.help = true;
        }
        i++;
    }

    if (options.help || !options.bible) {
        printUsage();
        process.exit(options.help ? 0 : 1);
    }

    const bibleDir = path.join(SOURCES_DIR, options.bible);
    if (!fs.existsSync(bibleDir)) {
        console.error(`Bible not found: ${bibleDir}`);
        process.exit(1);
    }

    const bookStart = options.bookStart ?? 1;
    const bookEnd = options.bookEnd ?? 66;

    if ((options.chapterStart || options.chapterEnd) && bookStart !== bookEnd) {
        console.error('--chapter requires a single book (use --book <id>)');
        process.exit(1);
    }

    for (const book of books) {
        if (book.id < bookStart || book.id > bookEnd) continue;
        const bookName = getBookName(book.id, 'nb');
        const startCh = options.chapterStart ?? 1;
        const endCh = options.chapterEnd ?? book.chapters;
        console.log(`\n=== ${bookName} (${book.id}), kapittel ${startCh}-${Math.min(endCh, book.chapters)} ===`);
        for (let ch = startCh; ch <= Math.min(endCh, book.chapters); ch++) {
            await processChapter(options.bible, book.id, ch, options.force);
        }
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
