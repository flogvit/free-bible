import * as fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';
import {books} from "./constants.js";
import type {Verse, Chapter} from '../kvn/src/bible-types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Et sammenhengende intervall av bok-id-er, begge ender inklusive. */
export interface BookRange {
    from: number;
    to: number;
}

/** Ett kapittel utpekt av bok-id og kapittelnummer (ikke kapittelets innhold). */
export interface ChapterRef {
    bookId: number;
    chapter: number;
}

/**
 * Nøkkelen er det absolutte filnavnet kapitlet ble lest fra, så oppslaget er
 * dynamisk og trenger `Record`.
 */
const cache: Record<string, Chapter> = {}

function readCached(filename: string): Chapter {
    if (!(filename in cache)) cache[filename] = JSON.parse(fs.readFileSync(filename, 'utf-8'));
    return cache[filename];
}

/** Grunnteksten et kapittel oversettes fra: hebraisk for GT, SBLGNT for NT. */
export function getOriginalSource(bookId: number): string {
    return bookId <= 39 ? 'hebrew' : 'sblgnt';
}

function rawChapterFile(bible: string, bookId: number, chapterId: number): string {
    return path.join(__dirname, "bibles_raw", bible, `${bookId}`, `${chapterId}.json`);
}

/** `bibles_raw/<bible>/<bok>/<kapittel>.json`, eller `null` når kapitlet ikke finnes. */
export function readRawChapter(bible: string, bookId: number, chapterId: number): Chapter | null {
    const filename = rawChapterFile(bible, bookId, chapterId);
    if (!fs.existsSync(filename)) return null;
    return JSON.parse(fs.readFileSync(filename, 'utf-8'));
}

/** Kapitlet som `vers: tekst`-linjer — formen promptene får det i. `null` når det mangler. */
export function readChapterText(bible: string, bookId: number, chapterId: number): string | null {
    const verses = readRawChapter(bible, bookId, chapterId);
    return verses && verses.map(v => `${v.verseId}: ${v.text}`).join('\n');
}

/** Finnes fila, og har den innhold? En tom fil regnes som ikke skrevet. */
export function fileExists(filepath: string): boolean {
    return fs.existsSync(filepath) && fs.statSync(filepath).size > 0;
}

/** Lager katalogen fila skal ligge i. */
export function ensureParentDir(filepath: string): void {
    const dir = path.dirname(filepath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, {recursive: true});
}

export function getOriginalVerse(bookId: number, chapterId: number, verseId: number): Verse | undefined {
    const verses = readCached(rawChapterFile(getOriginalSource(bookId), bookId, chapterId));
    return verses.find( verse => +verse.bookId===+bookId && +verse.chapterId===+chapterId && +verse.verseId===+verseId)
}

export function getRef(bookId: number, chapterId: number, verseId: number): string {
    // Kastet før en `TypeError: Cannot read properties of undefined (reading
    // 'name')`, som ikke sier hvilken bok-id som var ukjent. Feilen er den
    // samme — bare lesbar (#112).
    const book = books.find(book => book.id === +bookId)
    if (!book) throw new Error(`getRef: ukjent bok-id ${bookId} (gyldige er 1–66)`)
    return `${book.name} ${chapterId}:${verseId}`
}

export function getOriginalChapter(bookId: number, chapterId: number): Chapter {
    const verses = readCached(rawChapterFile(getOriginalSource(bookId), bookId, chapterId));
    return verses.filter( verse => +verse.bookId===+bookId && +verse.chapterId===+chapterId)
}

/**
 * Get osnb verses in a range [verseStart..verseEnd] for a chapter.
 * Returns array of { bookId, chapterId, verseId, text }.
 */
export function getOsnbVerseRange(bookId: number, chapterId: number, verseStart: number, verseEnd: number): Chapter {
    const filename = rawChapterFile("osnb", bookId, chapterId);
    if (!fs.existsSync(filename)) return [];
    const verses = readCached(filename);
    return verses.filter(v => +v.bookId === +bookId && +v.chapterId === +chapterId && +v.verseId >= verseStart && +v.verseId <= verseEnd);
}

// Book ranges for convenient reference
// `Record<string, …>` framfor de utledede nøkkellitteralene: `resolveBookRange`
// slår opp med en vilkårlig streng fra leseplan-konfigurasjonen.
export const bookRanges: Record<string, BookRange> = {
    // GT sections
    gt: { from: 1, to: 39 },
    mosebokene: { from: 1, to: 5 },
    historiske: { from: 6, to: 17 },
    visdom: { from: 18, to: 22 },
    profeter: { from: 23, to: 39 },
    storeProfeter: { from: 23, to: 27 },
    smaProfeter: { from: 28, to: 39 },

    // NT sections
    nt: { from: 40, to: 66 },
    evangelier: { from: 40, to: 43 },
    apostelgjerninger: { from: 44, to: 44 },
    paulusBrev: { from: 45, to: 57 },
    allmenneBrev: { from: 58, to: 65 },
    apenbaringen: { from: 66, to: 66 },

    // Single books (by id)
    salmene: { from: 19, to: 19 },
    ordsprakene: { from: 20, to: 20 },
    job: { from: 18, to: 18 },
    forkynneren: { from: 21, to: 21 },
    hoysangen: { from: 22, to: 22 },
    romerbrevet: { from: 45, to: 45 },
    johannes: { from: 43, to: 43 },
    hebreerne: { from: 58, to: 58 },
};

/**
 * Get all chapters for a book range
 */
export function getChaptersForRange(range: BookRange): ChapterRef[] {
    const chapters: ChapterRef[] = [];
    for (const book of books) {
        if (book.id >= range.from && book.id <= range.to) {
            for (let ch = 1; ch <= book.chapters; ch++) {
                chapters.push({ bookId: book.id, chapter: ch });
            }
        }
    }
    return chapters;
}

/**
 * Get all chapters for specific book IDs
 */
export function getChaptersForBooks(bookIds: number[]): ChapterRef[] {
    const chapters: ChapterRef[] = [];
    for (const bookId of bookIds) {
        const book = books.find(b => b.id === bookId);
        if (book) {
            for (let ch = 1; ch <= book.chapters; ch++) {
                chapters.push({ bookId: book.id, chapter: ch });
            }
        }
    }
    return chapters;
}

/**
 * Resolve book range from string key or object
 */
export function resolveBookRange(config: string | BookRange | undefined): BookRange {
    // `undefined` er med i signaturen med vilje: en plandefinisjon uten
    // `bookRange` måtte ellers brolegges med `!` hos kalleren, og da gikk den
    // udefinerte verdien urørt videre til getChaptersForRange og krasjet på
    // `.from` av `undefined` — igjen langt fra der feilen var (#112).
    if (config === undefined) {
        throw new Error('resolveBookRange: mangler område (verken en nøkkel eller et {from,to}-objekt ble sendt inn)');
    }
    if (typeof config === 'string') {
        const range = bookRanges[config];
        // Ga før `undefined` for en ukjent nøkkel, mens signaturen lovte en
        // BookRange. Den udefinerte verdien gikk rett videre til
        // getChaptersForRange i build-reading-plans, som feilet et helt
        // annet sted (#112).
        if (!range) {
            const kjente = Object.keys(bookRanges).sort().join(', ');
            throw new Error(`resolveBookRange: ukjent område «${config}»\nkjente: ${kjente}`);
        }
        return range;
    }
    return config;
}
/**
 * Navn → id. ÉN implementasjon; den fantes i tre kopier med samme feil (#25).
 *
 * Rekkefølgen er det som betyr noe. `ø` og `æ` er egne bokstaver uten kanonisk
 * dekomponering, så NFD lar dem stå — og et etterfølgende `[^a-z0-9]`-filter
 * SLETTER dem framfor å translitterere. Resultatet var id-er som `akabs-snn`,
 * `jakobs-sster` og `fbe` (Føbe). `å` og `é` gikk klar, fordi de ER base pluss
 * diakritisk tegn, og det er derfor feilen så vilkårlig ut.
 *
 * Derfor: eksplisitt translitterasjon FØR NFD. `ø → o` og ikke `oe`, fordi det
 * er formen de id-ene som alt var riktige følger (`akabs-sonn`).
 *
 * `+` på tegnfilteret er den andre halvdelen: uten den forsvant `/` sporløst og
 * smeltet sammen alternative navn — `Abed-Nego/Asarja` ble `abed-negoasarja`.
 * Nå blir skilletegn én bindestrek.
 *
 * Samme regel som `slugify()` i `contrib/export.ts`, som avkorter til 60 tegn
 * for verk-id-er. Person-id-er avkortes ikke — de er allerede publiserte URL-er.
 */
export function nameToId(name: string): string {
    return String(name)
        // Bare balanserte, innerste parenteser. `[^)]*` spiste fra ytre `(` til
        // indre `)`, så «Jotam (Jerubbaals (Gideons) yngste sønn …)» mistet
        // «Jerubbaals» og ble `jotam-yngste-sonn-…`. Full nøstet fjerning er
        // også feil: da blir «Mattatias (… sønn av Amos)» bare `mattatias`, som
        // kolliderer med en annen Mattatias. Parentesen BÆRER disambigueringen.
        .replace(/\s*\([^()]*\)/g, '')
        .toLowerCase()
        .replace(/æ/g, 'ae').replace(/ø/g, 'o').replace(/å/g, 'a')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

/**
 * Navn (grunnform uten parentes, og hvert alias, i små bokstaver) → id-ene
 * til personene som bærer det.
 *
 * Et navn med flere bærere peker på alle. Det er ikke en oppslagstabell som
 * kan gi svaret, bare kandidatene — verset må avgjøre hvem det gjelder (#127).
 * Indekseren hadde ett kart med én fil per navn, og den som ble lest først
 * fikk hver forekomst: Gideons sønn Jotam satt med kong Jotams vers, og Josef
 * i Egypt med Marias mann i Matt 1:16.
 */
export function personNameIndex(
    persons: {id: string; name: string; aliases?: string[]}[],
): Map<string, string[]> {
    const index = new Map<string, string[]>();
    for (const p of persons) {
        const names = [p.name.replace(/\s*\(.*$/, ''), ...(p.aliases ?? [])];
        for (const name of names) {
            const key = name.trim().toLowerCase();
            const ids = index.get(key) ?? [];
            if (!ids.includes(p.id)) ids.push(p.id);
            index.set(key, ids);
        }
    }
    return index;
}
