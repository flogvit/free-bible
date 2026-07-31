/**
 * Nøkkelord per kapittel, med forklaring på norsk.
 *
 * Skriver `important_words/<språk>/<bok>-<kapittel>.json` — en array av
 * `{word, explanation}`. Kapitler som allerede finnes hoppes over, så skriptet
 * er trygt å kjøre om igjen.
 *
 * Bruk:
 *   bun generate/important-words-chapter.ts --local
 */

import "./env.js";
import * as fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import {books, getBookName, normalizeLanguage, getLanguageCode, anthropicModel, getTaskModel} from "./constants.js";
import {callWithRetry} from "./llm.js";
import {parseArgs, formatHelp, COMMON_FLAGS} from './cli.js';
import type {FlagSpec, Range} from './cli.js';

// Nøkkelordekstraksjon er strukturert nok for en lokal modell, og 300 av 1189
// kapitler gjensto per språk da flagget kom (#5). taskModels.words er 27b, men
// resolveLocalModel bruker en større modell hvis en annen jobb alt har den lastet
// — sett OLLAMA_MODEL for å pinne valget.
const TASK = 'words';

let useLocal = false;

// De to linjene prompten bruker som MAL. En liten lokal modell svarer av og til
// med malen i stedet for å gjøre jobben — Åp 2 kom tilbake som nøyaktig disse to
// linjene. Uten en vakt skrives den fila, og fileExists() hopper over den for
// alltid siden den bare måler størrelse: ett dårlig svar blir permanent.
const TEMPLATE_WORDS = ['Gud', 'Skapte'];
const MIN_ENTRIES = 4;

/** Ett nøkkelord slik det ligger i utdatafila. */
interface WordEntry {
    word: string;
    explanation: string;
}

const isEntry = (line: string): boolean => /^[^:]{1,60}:.+/.test(line);

/**
 * Bare linjene på formen ord:forklaring.
 *
 * Prompten sier «ikke noe før og etter», men modellen skriver likevel en
 * innledning i 88 av 1778 filer — «Salme 121 er en av de vakreste …», og i noen
 * tilfeller en direkte gal påstand om at kapitlet ikke finnes. Innholdet under
 * er som regel helt brukbart, så å avvise fila ville kastet gode oppføringer for
 * en kosmetisk feil.
 *
 * Målt på alle eksisterende filer: samtlige 88 ikke-oppføringslinjer står FØRST,
 * ingen midt i eller sist. Det finnes altså ingen forklaringer som går over flere
 * linjer, og filtreringen kan ikke miste innhold.
 */
function entryLines(text: string): string[] {
    return text.split('\n').map(l => l.trim()).filter(Boolean).filter(isEntry);
}

/**
 * Modellsvaret som {word, explanation}. Splitter på FØRSTE kolon — en forklaring
 * kan selv inneholde kolon, et ord kan ikke (isEntry krever det).
 *
 * Trimmingen er kontrakten: modellen skrev vekselvis «Gud:...» og «Himmel: ...»,
 * og det skillet skal ikke lekke ut i dataene.
 */
function parseEntries(text: string): WordEntry[] {
    return entryLines(text).map(line => {
        const i = line.indexOf(':');
        return {word: line.slice(0, i).trim(), explanation: line.slice(i + 1).trim()};
    });
}

function rejectReason(entries: WordEntry[]): string | null {
    if (entries.length < MIN_ENTRIES) {
        return `bare ${entries.length} oppføringer på formen ord:forklaring`;
    }
    const words = entries.map(e => e.word);
    if (words.length === TEMPLATE_WORDS.length && TEMPLATE_WORDS.every((w, i) => words[i] === w)) {
        return 'svaret er promptens egen mal, ikke kapitlet';
    }
    return null;
}

function fileExists(language: string, bookNr: number, chapterNr: number): boolean {
    const filePath = path.join(__dirname, `important_words/${language}/${bookNr}-${chapterNr}.json`);
    return fs.existsSync(filePath) && fs.statSync(filePath).size > 0;
}

// Prompten er norsk med vilje. `important_words` er dekket av translate.ts
// (nb → andre språk), så et `en/`-katalognavn her ville blitt overskrevet ved
// neste oversettelseskjøring. Se README, «Convention».
async function generateImportantWords(language: string, bookId: number, chapter: number): Promise<boolean> {
    const bibleRef = `${getBookName(bookId, language)} ${chapter}`;

    const prompt = `Kan du skrive ut de viktigste ordene i ${bibleRef} og forklare dem på norsk, bokmål? Skriv kun ord og forklaring, ikke noe før og etter. Følg malen:

Gud:Den allmektige skaperen som i henhold til 1. Mosebok skapte himmelen, jorden og alt liv.
Skapte:Begrepet brukt til å beskrive Guds handling av å bringe universet og alt i det til eksistens.`;

    console.log(`Generating important words for ${bibleRef}...`);
    // `callWithRetry` i llm.ts har ennå ingen signatur, så TS utleder parameteren
    // til `{context?: string}` og avviser `local`/`task` som ukjente felter.
    // Påstanden er ren type — den slår bare av friskhetssjekken på literalen — og
    // følger llm.ts av seg selv den dagen den funksjonen blir typet.
    const text = await callWithRetry(prompt, {
        local: useLocal,
        task: TASK,
        context: `important words ${bibleRef}`,
    } as Parameters<typeof callWithRetry>[1]) as string;

    const entries = parseEntries(text);
    const problem = rejectReason(entries);
    if (problem) {
        console.log(`  SKIPPED ${bibleRef}: ${problem}`);
        return false;
    }

    const outputDir = path.join(__dirname, `important_words/${language}`);
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, {recursive: true});
    }

    const filename = path.join(outputDir, `${bookId}-${chapter}.json`);
    fs.writeFileSync(filename, JSON.stringify(entries, null, 2) + '\n');
    console.log(`Saved: ${filename} (${entries.length} ord)`);
    return true;
}

/**
 * Flaggkontrakten for dette skriptet (#51, #52, #53).
 *
 * Samme fem flagg som før. To ting er nye, og begge er kontraktens poeng:
 *
 *   1. Posisjonsformen `<språk> <startbok> <startkapittel>` er borte. Den var
 *      det tredje navnet på ting som alt het `--language`/`--book`/`--chapter`,
 *      og et posisjonsargument sier ikke hvilket begrep det er.
 *   2. `--book`/`--chapter` er INTERVALLER, ikke startpunkter. Før gikk
 *      `--book 66 --chapter 3` fra Åp 3 og ut bibelen; nå betyr det Åp 3.
 *      «Fra Matteus og ut» skrives `--book 40-66`. Det er den samme
 *      betydningen flaggene har i alle andre skript, og forskjellen var stille:
 *      ingenting i utdataene viste hvilken av de to lesningene som gjaldt.
 *
 * Ferdige kapitler hoppes fortsatt over, så en avbrutt kjøring tas igjen ved å
 * starte den på nytt — startpunktet var aldri det som gjorde jobben gjenopptakbar.
 */
const SPEC: Record<string, FlagSpec> = {
    language: COMMON_FLAGS.language,
    book: COMMON_FLAGS.book,
    chapter: COMMON_FLAGS.chapter,
    local: COMMON_FLAGS.local,
    help: COMMON_FLAGS.help,
};

const HELP_EXAMPLES = [
    'bun generate/important-words-chapter.ts                        # nb, hele bibelen, Claude',
    'bun generate/important-words-chapter.ts --local                # samme, lokal modell',
    'bun generate/important-words-chapter.ts --book 40-66 --local   # fra Matteus og ut',
    'bun generate/important-words-chapter.ts --book 19 --chapter 23 # bare Salme 23',
    'OLLAMA_MODEL=qwen3.5:27b bun generate/important-words-chapter.ts --local',
    '',
    'Utdata er important_words/<språk>/<bok>-<kapittel>.json, en array av',
    '{word, explanation}. Kapitler som allerede finnes hoppes over, så skriptet',
    'er trygt å kjøre om igjen.',
];

/** Flaggene skriptet kjenner, lest ut av kontrakten. */
interface WordOptions {
    language: string;
    bookStart: number;
    bookEnd: number;
    chapterStart: number | null;
    chapterEnd: number | null;
    local: boolean;
}

function readOptions(flags: ReturnType<typeof parseArgs>['flags']): WordOptions {
    const book = flags.book as Range | undefined;
    const chapter = flags.chapter as Range | undefined;

    return {
        language: getLanguageCode(normalizeLanguage(flags.language as string)),
        bookStart: book?.start ?? 1,
        bookEnd: book?.end ?? 66,
        chapterStart: chapter?.start ?? null,
        chapterEnd: chapter?.end ?? null,
        local: flags.local as boolean,
    };
}

async function main(): Promise<void> {
    // Hjelpen skal ut før noe leses fra disk eller sendes over nettet.
    const {flags} = parseArgs(process.argv.slice(2), SPEC);
    if (flags.help) {
        console.log(formatHelp(
            'generate/important-words-chapter.ts',
            'nøkkelord per kapittel, med forklaring',
            SPEC,
            HELP_EXAMPLES,
        ));
        process.exit(0);
    }

    const options = readOptions(flags);
    useLocal = options.local;
    const {language, bookStart, bookEnd, chapterStart, chapterEnd} = options;

    if (!useLocal && !process.env.ANTHROPIC_API_KEY) {
        console.error('ANTHROPIC_API_KEY mangler. Sett den, eller kjør med --local.');
        process.exit(1);
    }

    console.log(`Language: ${language}`);
    console.log(`Model: ${useLocal ? `${getTaskModel(TASK)} (eller en større som alt ligger i minnet)` : anthropicModel}`);
    console.log(`Books: ${bookStart}-${bookEnd}${chapterStart ? `, chapter ${chapterStart}-${chapterEnd ?? chapterStart}` : ''}`);

    let written = 0;
    let rejected = 0;

    for (const book of books) {
        if (book.id < bookStart || book.id > bookEnd) continue;

        // Kapittelintervallet gjelder ENDENE av bokintervallet: starten teller
        // bare i den første boka, slutten bare i den siste, og bøkene imellom
        // tas i sin helhet. Samme lesning som chapter-tags.ts. Med én bok —
        // `--book 19 --chapter 23` — er det rett og slett Salme 23.
        const firstChapter = (book.id === bookStart && chapterStart) ? chapterStart : 1;
        const lastChapter = (book.id === bookEnd && chapterEnd) ? Math.min(chapterEnd, book.chapters) : book.chapters;

        for (let chapter = firstChapter; chapter <= lastChapter; chapter++) {
            if (fileExists(language, book.id, chapter)) {
                console.log(`Skipping ${getBookName(book.id, language)} ${chapter} (already exists)`);
                continue;
            }

            if (await generateImportantWords(language, book.id, chapter)) written++;
            else rejected++;
        }
    }

    console.log('---');
    console.log(`Skrevet: ${written}, avvist: ${rejected}`);
    if (rejected > 0) {
        console.log('Avviste kapitler er IKKE skrevet, så en ny kjøring forsøker dem igjen.');
    }
}

// Avslutt med kode 1, ikke stille: et ukjent flagg kaster nå, og et køskript
// skal stoppe på det framfor å gå videre med feil innstilling.
main().catch(err => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
});
