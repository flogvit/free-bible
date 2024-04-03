import dnb30 from "../../bibles/dnb30.json";
import osnb1 from "../../bibles/osnb1.json";
import sblgnt from "../../bibles/sblgnt.json";
import tanach from "../../bibles/tanach.json";

export const TRANSLATIONS = {
    'dnb30': dnb30,
    'osnb1': osnb1,
    'sblgnt': sblgnt,
    'tanach': tanach
};

export const REF_BOOKS = {
    1: '1.Mos',
    2: '2.Mos',
    3: '3.Mos',
    4: '4.Mos',
    5: '5.Mos',
    6: 'Jos',
    7: 'Dom',
    8: 'Rut',
    9: '1.Sam',
    10: '2.Sam',
    11: '1.Kong',
    12: '2.Kong',
    13: '1.Krøn',
    14: '2.Krøn',
    15: 'Esr',
    16: 'Neh',
    17: 'Est',
    18: 'Job',
    19: 'Sal',
    20: 'Ord',
    21: 'Fork',
    22: 'Høy',
    23: 'Jes',
    24: 'Jer',
    25: 'Klag',
    26: 'Ese',
    27: 'Dan',
    28: 'Hos',
    29: 'Joe',
    30: 'Amo',
    31: 'Oba',
    32: 'Jon',
    33: 'Mik',
    34: 'Nah',
    35: 'Hab',
    36: 'Sef',
    37: 'Hag',
    38: 'Sak',
    39: 'Mal',
    40: 'Matt',
    41: 'Mark',
    42: 'Luk',
    43: 'Joh',
    44: 'Apg',
    45: 'Rom',
    46: '1.Kor',
    47: '2.Kor',
    48: 'Gal',
    49: 'Efe',
    50: 'Fil',
    51: 'Kol',
    52: '1.Tes',
    53: '2.Tes',
    54: '1.Tim',
    55: '2.Tim',
    56: 'Tit',
    57: 'Fil',
    58: 'Heb',
    59: 'Jak',
    60: '1.Pet',
    61: '2.Pet',
    62: '1.Joh',
    63: '2.Joh',
    64: '3.Joh',
    65: 'Jud',
    66: 'Åp'
}

export function MaxChapter(bible, book) {
    if (!bible?.value || !book?.value) return 0
    const bookId = +book.value
    return Math.max(...TRANSLATIONS[bible.value].filter(verse => verse.bookId === +bookId).map(verse => verse.chapterId));
}

export function getOriginalVerse(verse) {
    const bible = verse.bookId<40 ? tanach : sblgnt;
    const resultVerse = bible.find(v => v.bookId===verse.bookId && v.chapterId === verse.chapterId && v.verseId===verse.verseId)
    return resultVerse
}

export function getRefText(reference) {
    return `${REF_BOOKS[reference.bookId]} ${reference.chapterId},${reference.fromVerseId}${reference.toVerseId!==reference.fromVerseId ? "-"+reference.toVerseId : ''}`
}