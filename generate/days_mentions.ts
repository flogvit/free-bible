import "./env.js";
import * as fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';

import {books, getBookName} from './constants.js';
import {callWithRetry} from './llm.js';
import {parseArgs, formatHelp, COMMON_FLAGS} from './cli.js';
import type {FlagSpec, Range} from './cli.js';
import type {Verse, Chapter} from '../kvn/src/bible-types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Flaggene skriptet godtar, i den rekkefølgen `--help` viser dem.
 *
 * Bare de felles flaggene skriptet faktisk bruker står her — kontrakten kaster
 * på ukjent flagg, så et flagg som ikke er erklært finnes ikke. Merk at
 * `--local` med vilje mangler: dagsomtaler kjøres ALLTID lokalt (`local: true`
 * er hardkodet i `processVerse`), så en bryter ville vært en løgn.
 */
const SPEC: Record<string, FlagSpec> = {
    bible: COMMON_FLAGS.bible,
    book: COMMON_FLAGS.book,
    chapter: {...COMMON_FLAGS.chapter, help: 'kapittel eller kapittelintervall (krever én enkelt bok)'},
    ot: COMMON_FLAGS.ot,
    nt: COMMON_FLAGS.nt,
    force: COMMON_FLAGS.force,
    help: COMMON_FLAGS.help,
};

const SCRIPT = 'generate/days_mentions.ts';
const PURPOSE = 'pass 1: skann hvert vers med lokal modell og hent ut dager, høytider og '
    + 'tidsbegreper → generate/days_mentions/<bible>/<bokId>/<kapittelId>.json';
const EXAMPLES = [
    'bun generate/days_mentions.ts --bible osnb --book 40 --chapter 12',
    'bun generate/days_mentions.ts --bible osnb --book 40',
    'bun generate/days_mentions.ts --bible osnb --nt',
    'bun generate/days_mentions.ts --bible osnb',
];

// Hjelpesjekken står først — før .env-lasting og før enhver fil- eller
// nettverksoperasjon. `--help` skal svare på hva skriptet tar, ikke begynne å
// gjøre det.
const {flags} = parseArgs(process.argv.slice(2), SPEC);
if (flags.help) {
    console.log(formatHelp(SCRIPT, PURPOSE, SPEC, EXAMPLES));
    process.exit(0);
}


const SOURCES_DIR = path.join(__dirname, 'bibles_raw');
const OUTPUT_BASE = path.join(__dirname, 'days_mentions');

/** Originalspråket verset hentes fra: hebraisk i GT, gresk i NT. */
type OriginalLanguage = 'hebrew' | 'greek';

/**
 * Originalspråkverset som ligger parallelt med det norske.
 *
 * `text` er `null` og `reason` satt når oppslaget ikke lyktes — feltet
 * `available` skiller de to tilfellene.
 */
interface ParallelVerse {
    language: OriginalLanguage;
    text: string | null;
    available: boolean;
    reason?: string;
}

// === Parallel verse lookup ===
// For bibles whose verse numbering matches hebrew/sblgnt directly (e.g. osnb),
// lookup is identity. For others, a chain through kvn would be required.

const IDENTITY_PARALLEL_BIBLES = new Set(['osnb']);

// `null` er en gyldig cache-verdi: den husker at kapitlet ikke finnes.
const chapterCache = new Map<string, Chapter | null>();
function loadSourceChapter(sourceName: string, bookId: number, chapterId: number): Chapter | null {
    const key = `${sourceName}/${bookId}/${chapterId}`;
    // `Map.get` er typet `V | undefined`, men `has` over har alt utelukket
    // `undefined`. Påstanden dokumenterer det; den endrer ingenting.
    if (chapterCache.has(key)) return chapterCache.get(key) as Chapter | null;
    const file = path.join(SOURCES_DIR, sourceName, String(bookId), `${chapterId}.json`);
    if (!fs.existsSync(file)) {
        chapterCache.set(key, null);
        return null;
    }
    const data: Chapter = JSON.parse(fs.readFileSync(file, 'utf8'));
    chapterCache.set(key, data);
    return data;
}

function getParallelVerse(bible: string, bookId: number, chapterId: number, verseId: number): ParallelVerse {
    const isOt = bookId <= 39;
    const sourceName = isOt ? 'hebrew' : 'sblgnt';
    const language: OriginalLanguage = isOt ? 'hebrew' : 'greek';

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

function buildPrompt(ref: string, norwegianText: string, parallel: ParallelVerse): string {
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

/**
 * Kategoriene er norske identifikatorer, som `Footnote.source` i versdataene —
 * ikke visningstekst.
 */
type DayCategory = 'høytid' | 'eskatologisk' | 'historisk' | 'ukentlig' | 'periode' | 'annet';

/** Ordet fra originalteksten som svarer til det norske dagsuttrykket. */
interface OriginalTerm {
    language: OriginalLanguage;
    script: string;
    transliteration: string;
}

/** Én dagsnevnelse slik modellen svarer den (`DAY_SCHEMA`). */
interface DayMention {
    name: string;
    category: DayCategory;
    norwegianTerm: string;
    originalTerm: OriginalTerm | null;
    quote: string;
    reason: string;
}

/** Svaret fra modellen, dekodet mot `DAY_SCHEMA`. */
interface DayMentionResult {
    days: DayMention[];
}

/** En dagsnevnelse med verset den ble funnet i — det som skrives til disk. */
type DayMentionRecord = DayMention & {
    bookId: number;
    chapterId: number;
    verseId: number;
    translation: string;
    originalAvailable: boolean;
};

async function processVerse(bible: string, bookId: number, chapterId: number, verse: Verse): Promise<DayMentionRecord[]> {
    const bookName = getBookName(bookId, 'nb');
    const ref = `${bookName} ${chapterId}:${verse.verseId}`;
    const parallel = getParallelVerse(bible, bookId, chapterId, verse.verseId);
    const prompt = buildPrompt(ref, verse.text, parallel);
    // `callWithRetry` er typet `object | string`; med skjema er det det dekodede
    // objektet. Påstanden navngir formen `DAY_SCHEMA` krever.
    const result = await callWithRetry(prompt, {
        schema: DAY_SCHEMA,
        local: true,
        context: ref
    }) as DayMentionResult;
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

/** Ett vers i utdatafila: dagene som ble funnet, eller feilen som stanset det. */
interface VerseDays {
    verseId: number;
    days: DayMentionRecord[];
    error?: string;
}

async function processChapter(bible: string, bookId: number, chapterId: number, force: boolean): Promise<void> {
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

    const verses: Chapter = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
    const results: VerseDays[] = [];
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
            process.stdout.write(`FEIL: ${(err as Error).message}\n`);
            results.push({verseId: verse.verseId, days: [], error: (err as Error).message});
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

async function main(): Promise<void> {
    const bible = flags.bible as string | undefined;
    if (!bible) {
        // Samme som før: manglende --bible skriver bruksteksten og gir exit 1.
        console.error(formatHelp(SCRIPT, PURPOSE, SPEC, EXAMPLES));
        process.exit(1);
    }

    const bibleDir = path.join(SOURCES_DIR, bible);
    if (!fs.existsSync(bibleDir)) {
        console.error(`Bible not found: ${bibleDir}`);
        process.exit(1);
    }

    const bookRange = flags.book as Range | undefined;
    const chapterRange = flags.chapter as Range | undefined;

    // `--ot`/`--nt` er snarveier for `--book`. Den gamle parseren leste
    // argumentene i rekkefølge og lot det siste vinne; kontrakten beholder ikke
    // rekkefølgen, så et eksplisitt `--book` går foran, og `--nt` foran `--ot`.
    // I praksis brukes de hver for seg, så resultatet er det samme.
    let bookStart = 1;
    let bookEnd = 66;
    if (flags.ot) {
        bookStart = 1;
        bookEnd = 39;
    }
    if (flags.nt) {
        bookStart = 40;
        bookEnd = 66;
    }
    if (bookRange) {
        bookStart = bookRange.start;
        bookEnd = bookRange.end;
    }

    if (chapterRange && bookStart !== bookEnd) {
        console.error('--chapter requires a single book (use --book <id>)');
        process.exit(1);
    }

    const force = flags.force as boolean;

    for (const book of books) {
        if (book.id < bookStart || book.id > bookEnd) continue;
        const bookName = getBookName(book.id, 'nb');
        const startCh = chapterRange?.start ?? 1;
        const endCh = chapterRange?.end ?? book.chapters;
        console.log(`\n=== ${bookName} (${book.id}), kapittel ${startCh}-${Math.min(endCh, book.chapters)} ===`);
        for (let ch = startCh; ch <= Math.min(endCh, book.chapters); ch++) {
            await processChapter(bible, book.id, ch, force);
        }
    }
}

// Kjører bare når fila startes direkte. Uten vakten kjører jobben ved IMPORT —
// det er grunnen til at days.ts slettet data bare man lastet modulen (#108),
// og det gjør skriptene umulige å teste.
if (import.meta.main) {
    main().catch(err => {
    console.error(err);
    process.exit(1);
});
}
