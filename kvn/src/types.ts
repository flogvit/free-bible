// ============================================================
// KVN bit layout: book (7) | chapter (8) | verse (8) | part (4)
// Total: 27 bits, fits in a regular JS number
//
// kvn  = basis-referanse (osnb/tanach/sblgnt koordinater)
// tkvn = translation KVN (oversettelsens koordinater)
// ============================================================

/**
 * Encode book, chapter, verse, part into a KVN number.
 * Part: 0 = whole verse, 1 = a (first sentence), 2 = b, etc.
 */
export function encode(book: number, chapter: number, verse: number, part = 0): number {
  return (book << 20) | (chapter << 12) | (verse << 4) | part;
}

/**
 * Decode a KVN number back to coordinates.
 */
export function decode(kvn: number): { book: number; chapter: number; verse: number; part: number } {
  return {
    book: (kvn >> 20) & 0x7F,
    chapter: (kvn >> 12) & 0xFF,
    verse: (kvn >> 4) & 0xFF,
    part: kvn & 0xF,
  };
}

/**
 * Format a KVN as a human-readable string like "2 Mos 8:1" or "2 Mos 8:1a".
 */
export function formatKvn(kvn: number, bookNames?: Record<number, string>): string {
  const { book, chapter, verse, part } = decode(kvn);
  const bookName = bookNames?.[book] ?? String(book);
  const partSuffix = part > 0 ? String.fromCharCode(96 + part) : ''; // 1=a, 2=b, ...
  return `${bookName} ${chapter}:${verse}${partSuffix}`;
}

// Book name -> book ID mapping (standard norsk)
export const BOOK_IDS: Record<string, number> = {
  '1 Mos': 1, '2 Mos': 2, '3 Mos': 3, '4 Mos': 4, '5 Mos': 5,
  'Jos': 6, 'Dom': 7, 'Rut': 8, '1 Sam': 9, '2 Sam': 10,
  '1 Kong': 11, '2 Kong': 12, '1 Krøn': 13, '2 Krøn': 14,
  'Esra': 15, 'Neh': 16, 'Est': 17, 'Job': 18, 'Sal': 19,
  'Ordsp': 20, 'Fork': 21, 'Høgs': 22, 'Jes': 23, 'Jer': 24,
  'Klag': 25, 'Esek': 26, 'Dan': 27, 'Hos': 28, 'Joel': 29,
  'Am': 30, 'Ob': 31, 'Jona': 32, 'Mi': 33, 'Nah': 34,
  'Hab': 35, 'Sef': 36, 'Hag': 37, 'Sak': 38, 'Mal': 39,
  'Matt': 40, 'Mark': 41, 'Luk': 42, 'Joh': 43, 'Apg': 44,
  'Rom': 45, '1 Kor': 46, '2 Kor': 47, 'Gal': 48, 'Ef': 49,
  'Flp': 50, 'Kol': 51, '1 Tess': 52, '2 Tess': 53,
  '1 Tim': 54, '2 Tim': 55, 'Tit': 56, 'Filem': 57, 'Hebr': 58,
  'Jak': 59, '1 Pet': 60, '2 Pet': 61, '1 Joh': 62, '2 Joh': 63,
  '3 Joh': 64, 'Jud': 65, 'Åp': 66,
  // Aliases (alternative abbreviations used in DNK lesetekster etc.)
  'Salme': 19, 'Amos': 30, 'Mika': 33, 'Høys': 22, 'Fil': 50,
};

// Book ID -> name (reverse of BOOK_IDS, first occurrence per ID wins)
export const BOOK_NAMES: Record<number, string> = (() => {
  const result: Record<number, string> = {};
  for (const [name, id] of Object.entries(BOOK_IDS)) {
    if (!(id in result)) result[id] = name;
  }
  return result;
})();

/**
 * Callback that returns the max verse number for a given book+chapter.
 * Used by parseRef to expand cross-chapter ranges.
 */
export type MaxVerseProvider = (book: number, chapter: number) => number;

// ============================================================
// Mapping file types
// ============================================================

/**
 * A single mapping entry: [kvn, tkvn, kvn-readable, tkvn-readable]
 */
export type MappingEntry = [number, number, string, string];

/**
 * An extra verse entry (only in this system, no basis equivalent).
 * [tkvn, readable, afterKvn]
 * afterKvn = the basis kvn this verse comes after
 */
export type ExtraVerseEntry = [number, string, number];

/**
 * KVN mapping file for a translation system.
 */
export interface KvnMappingFile {
  version: number;
  system: string;
  name: string;
  description: string;
  bookNames: Record<string, number>;
  map: MappingEntry[];
  extraVerses: ExtraVerseEntry[];
}

// ============================================================
// Old types (kept for generate script)
// ============================================================

export interface VerseMapping {
  id: string;
  name: string;
  description: string;
  bookNames: Record<string, number>;
  verseMap: Record<string, string>;
  unmapped: Array<{
    bookId: number;
    srcRef: string;
    reason: string;
  }>;
}

// ============================================================
// Test data types
// ============================================================

export interface VerseCoord {
  book: number;
  chapter: number;
  verse: number;
}

export interface TestCase {
  description: string;
  osnb: VerseCoord;
  translation: VerseCoord;
}

export interface UnmappedTestCase {
  description: string;
  translation: VerseCoord;
}

export interface PhantomTestCase {
  description: string;
  osnb: VerseCoord;
  translation: VerseCoord;
  osnbMaxVerse: number;
}

export interface TestReferenceData {
  description: string;
  generated: string;
  categories: {
    identity: TestCase[];
    chain_shift: TestCase[];
    cross_chapter_backward: TestCase[];
    same_chapter_backward: TestCase[];
    overflow_chapter: TestCase[];
    multi_chapter_block: TestCase[];
    phantom: PhantomTestCase[];
    unmapped: UnmappedTestCase[];
  };
}
