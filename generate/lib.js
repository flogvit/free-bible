import * as fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';
import {books} from "./constants.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const cache = {}

export function getOriginalVerse(bookId, chapterId, verseId) {
    let filename = ""
    if (bookId<40) {
        filename = path.join(__dirname, "bibles_raw", "tanach", `${bookId}`, `${chapterId}.json`)
    } else {
        filename = path.join(__dirname, "bibles_raw", "sblgnt", `${bookId}`, `${chapterId}.json`)
    }
    const verses = cache[filename] ? cache[filename] : JSON.parse(fs.readFileSync(filename, 'utf-8'));
    if (!(filename in cache))
        cache[filename] = verses
    return verses.find( verse => +verse.bookId===+bookId && +verse.chapterId===+chapterId && +verse.verseId===+verseId)
}

export function getRef(bookId, chapterId, verseId) {
    return `${books.find(book => book.id===+bookId).name} ${chapterId}:${verseId}`
}

export function getOriginalChapter(bookId, chapterId) {
    let filename = ""
    if (bookId<40) {
        filename = path.join(__dirname, "bibles_raw", "tanach", `${bookId}`, `${chapterId}.json`)
    } else {
        filename = path.join(__dirname, "bibles_raw", "sblgnt", `${bookId}`, `${chapterId}.json`)
    }
    const verses = cache[filename] ? cache[filename] : JSON.parse(fs.readFileSync(filename, 'utf-8'));
    if (!(filename in cache))
        cache[filename] = verses
    return verses.filter( verse => +verse.bookId===+bookId && +verse.chapterId===+chapterId)
}

// Book ranges for convenient reference
export const bookRanges = {
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
export function getChaptersForRange(range) {
    const chapters = [];
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
export function getChaptersForBooks(bookIds) {
    const chapters = [];
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
export function resolveBookRange(config) {
    if (typeof config === 'string') {
        return bookRanges[config];
    }
    return config;
}