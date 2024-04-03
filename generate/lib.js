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