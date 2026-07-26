/**
 * Build a universal KVN mapping for osnb.
 *
 * KVN encoding: book*10 * M_ch + chapter*10 * M_v + verse*10 * 16 + part
 * Where:
 *   PART_SIZE = 16
 *   M_v = 1770 * PART_SIZE = 28320  (verse multiplier)
 *   M_ch = 1510 * M_v = 42,763,200  (chapter multiplier)
 *   M_book = M_ch (book is just book*10 * M_ch)
 *
 * For osnb, most coordinates map directly (identity).
 * We also compare against the raw JSON bibles to find where osnb differs.
 */

import { readFileSync, readdirSync, existsSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';

const OSNB_DIR = join(import.meta.dirname, '../../generate/bibles_raw/osnb');
const RAW_DIR = join(import.meta.dirname, '../../external/closed/raw');
const OUT_FILE = join(import.meta.dirname, '../mappings/osnb.ukvn.json');

// === Universal KVN encoding ===
const PART_SIZE = 16;
const MAX_VERSE_SPACED = 1770;  // 177 * 10
const MAX_CHAPTER_SPACED = 1510; // 151 * 10

const M_v = MAX_VERSE_SPACED * PART_SIZE;  // 28,320
const M_ch = MAX_CHAPTER_SPACED * M_v;      // 42,763,200

function encode(book: number, chapter: number, verse: number, part = 0): number {
  return (book * 10) * M_ch + (chapter * 10) * M_v + (verse * 10) * PART_SIZE + part;
}

function decode(kvn: number): { book: number; chapter: number; verse: number; part: number } {
  const part = kvn % PART_SIZE;
  let rest = (kvn - part) / PART_SIZE;
  const verseSpaced = rest % MAX_VERSE_SPACED;
  rest = (rest - verseSpaced) / MAX_VERSE_SPACED;
  const chapterSpaced = rest % MAX_CHAPTER_SPACED;
  const bookSpaced = (rest - chapterSpaced) / MAX_CHAPTER_SPACED;

  return {
    book: bookSpaced / 10,
    chapter: chapterSpaced / 10,
    verse: verseSpaced / 10,
    part,
  };
}

function formatKvn(kvn: number): string {
  const { book, chapter, verse, part } = decode(kvn);
  const partSuffix = part > 0 ? String.fromCharCode(96 + part) : '';
  return `${book}:${chapter}:${verse}${partSuffix}`;
}

// === Load osnb ===
interface VerseData {
  bookId: number;
  chapterId: number;
  verseId: number;
  text?: string;
}

interface OsnbVerse {
  verse: number;
  text: string;
}

function loadOsnb2(): Map<string, OsnbVerse[]> {
  const chapters = new Map<string, OsnbVerse[]>();

  const bookDirs = readdirSync(OSNB_DIR)
    .filter(d => /^\d+$/.test(d) && statSync(join(OSNB_DIR, d)).isDirectory())
    .map(d => parseInt(d))
    .sort((a, b) => a - b);

  for (const bookId of bookDirs) {
    const bookDir = join(OSNB_DIR, String(bookId));
    const chapterFiles = readdirSync(bookDir)
      .filter(f => f.endsWith('.json'))
      .map(f => parseInt(f.replace('.json', '')))
      .sort((a, b) => a - b);

    for (const chapterId of chapterFiles) {
      try {
        const data = JSON.parse(readFileSync(join(bookDir, `${chapterId}.json`), 'utf-8'));
        const verses: OsnbVerse[] = [];

        if (Array.isArray(data)) {
          // Format: [{bookId, chapterId, verseId, text}] or [{verse, text}]
          for (const item of data) {
            const v = item.verseId ?? item.verse;
            const t = item.text ?? '';
            if (v !== undefined) verses.push({ verse: v, text: t });
          }
        } else if (typeof data === 'object') {
          // Format: {verses: [...]} or {1: "text", 2: "text"}
          if (data.verses) {
            for (const item of data.verses) {
              const v = item.verseId ?? item.verse;
              const t = item.text ?? '';
              if (v !== undefined) verses.push({ verse: v, text: t });
            }
          } else {
            for (const [key, val] of Object.entries(data)) {
              if (/^\d+$/.test(key)) {
                verses.push({ verse: parseInt(key), text: String(val) });
              }
            }
          }
        }

        if (verses.length > 0) {
          chapters.set(`${bookId}:${chapterId}`, verses.sort((a, b) => a.verse - b.verse));
        }
      } catch {
        // skip
      }
    }
  }

  return chapters;
}

// === Load a raw bible for comparison ===
function loadRawBible(name: string): Map<string, number[]> {
  const dir = join(RAW_DIR, name);
  const chapters = new Map<string, number[]>();
  if (!existsSync(dir)) return chapters;

  const bookDirs = readdirSync(dir)
    .filter(d => /^\d+$/.test(d) && statSync(join(dir, d)).isDirectory())
    .map(d => parseInt(d));

  for (const bookId of bookDirs) {
    const bookDir = join(dir, String(bookId));
    const chapterFiles = readdirSync(bookDir).filter(f => f.endsWith('.json'));

    for (const chFile of chapterFiles) {
      const chapterId = parseInt(chFile.replace('.json', ''));
      try {
        const data: VerseData[] = JSON.parse(readFileSync(join(bookDir, chFile), 'utf-8'));
        const verseIds = data.map(v => v.verseId).sort((a, b) => a - b);
        chapters.set(`${bookId}:${chapterId}`, verseIds);
      } catch {
        // skip
      }
    }
  }

  return chapters;
}

// === Build mapping ===
console.log('Loading osnb...');
const osnb = loadOsnb2();

console.log(`Loaded ${osnb.size} chapters from osnb`);

// Collect all verse positions
let totalVerses = 0;
const allPositions: { book: number; chapter: number; verse: number; kvn: number }[] = [];

for (const [key, verses] of osnb) {
  const [bookStr, chapterStr] = key.split(':');
  const book = parseInt(bookStr);
  const chapter = parseInt(chapterStr);

  for (const v of verses) {
    const kvn = encode(book, chapter, v.verse);
    allPositions.push({ book, chapter, verse: v.verse, kvn });
    totalVerses++;
  }
}

console.log(`Total verses in osnb: ${totalVerses}`);

// Verify encode/decode roundtrip
let roundtripErrors = 0;
for (const pos of allPositions) {
  const decoded = decode(pos.kvn);
  if (decoded.book !== pos.book || decoded.chapter !== pos.chapter || decoded.verse !== pos.verse) {
    roundtripErrors++;
    if (roundtripErrors <= 5) {
      console.error(`Roundtrip error: ${pos.book}:${pos.chapter}:${pos.verse} → ${pos.kvn} → ${decoded.book}:${decoded.chapter}:${decoded.verse}`);
    }
  }
}
console.log(`Roundtrip errors: ${roundtripErrors}`);

// Check for KVN collisions
const kvnSet = new Set<number>();
let collisions = 0;
for (const pos of allPositions) {
  if (kvnSet.has(pos.kvn)) {
    collisions++;
    console.error(`KVN collision: ${pos.book}:${pos.chapter}:${pos.verse} = ${pos.kvn}`);
  }
  kvnSet.add(pos.kvn);
}
console.log(`KVN collisions: ${collisions}`);

// Show some examples
console.log('\n=== EXAMPLE ENCODINGS ===');
const examples = [
  { desc: '1 Mos 1:1', book: 1, ch: 1, v: 1 },
  { desc: '2 Mos 8:1', book: 2, ch: 8, v: 1 },
  { desc: 'Sal 119:176', book: 19, ch: 119, v: 176 },
  { desc: 'Åp 22:21', book: 66, ch: 22, v: 21 },
];

for (const ex of examples) {
  const kvn = encode(ex.book, ex.ch, ex.v);
  const dec = decode(kvn);
  console.log(`  ${ex.desc.padEnd(15)} → KVN ${kvn.toLocaleString().padStart(16)} → decoded ${dec.book}:${dec.chapter}:${dec.verse}`);
}

// Show KVN range
const kvns = allPositions.map(p => p.kvn).sort((a, b) => a - b);
console.log(`\nKVN range: ${kvns[0].toLocaleString()} — ${kvns[kvns.length - 1].toLocaleString()}`);

// === Build mapping file ===
// For osnb, the mapping is identity — its coordinates ARE KVN coordinates.
// The mapping file lists all positions this translation covers.

// Group by book
const bookChapters = new Map<number, Map<number, number[]>>(); // book -> chapter -> verses
for (const pos of allPositions) {
  if (!bookChapters.has(pos.book)) bookChapters.set(pos.book, new Map());
  const chapters = bookChapters.get(pos.book)!;
  if (!chapters.has(pos.chapter)) chapters.set(pos.chapter, []);
  chapters.get(pos.chapter)!.push(pos.verse);
}

// Build compact representation: per chapter, just max verse (assuming contiguous 1..max)
// Flag chapters where verses are NOT contiguous
const mapping: {
  version: 2;
  system: string;
  name: string;
  encoding: {
    partSize: number;
    maxVerseSpaced: number;
    maxChapterSpaced: number;
  };
  // Per book: chapters with verse ranges
  books: Record<number, Record<number, { max: number; missing?: number[] }>>;
  // Verse number differences: tkvn -> kvn (empty for osnb, it IS the basis)
  map: Array<[number, number]>;  // [tkvn, kvn]
} = {
  version: 2,
  system: 'osnb',
  name: 'Open Source Norsk Bibel v2 (Tanach/SBLGNT)',
  encoding: {
    partSize: PART_SIZE,
    maxVerseSpaced: MAX_VERSE_SPACED,
    maxChapterSpaced: MAX_CHAPTER_SPACED,
  },
  books: {},
  map: [],
};

for (const [book, chapters] of [...bookChapters.entries()].sort((a, b) => a[0] - b[0])) {
  mapping.books[book] = {};
  for (const [chapter, verses] of [...chapters.entries()].sort((a, b) => a[0] - b[0])) {
    const sorted = verses.sort((a, b) => a - b);
    const max = sorted[sorted.length - 1];

    // Check for missing verses (non-contiguous)
    const expected = new Set(Array.from({ length: max }, (_, i) => i + 1));
    const actual = new Set(sorted);
    const missing = [...expected].filter(v => !actual.has(v));

    if (missing.length > 0) {
      mapping.books[book][chapter] = { max, missing };
    } else {
      mapping.books[book][chapter] = { max };
    }
  }
}

// Write mapping
writeFileSync(OUT_FILE, JSON.stringify(mapping, null, 2));
console.log(`\nMapping written to ${OUT_FILE}`);

// Stats
const bookCount = Object.keys(mapping.books).length;
const chapterCount = Object.values(mapping.books).reduce((sum, chs) => sum + Object.keys(chs).length, 0);
const missingCount = Object.values(mapping.books).reduce((sum, chs) =>
  sum + Object.values(chs).filter(v => v.missing).length, 0);

console.log(`\n=== MAPPING STATS ===`);
console.log(`Books: ${bookCount}`);
console.log(`Chapters: ${chapterCount}`);
console.log(`Total verses: ${totalVerses}`);
console.log(`Chapters with missing verses: ${missingCount}`);
console.log(`Map entries (tkvn≠kvn): ${mapping.map.length} (identity for osnb)`);

if (missingCount > 0) {
  console.log('\nChapters with non-contiguous verses:');
  for (const [book, chapters] of Object.entries(mapping.books)) {
    for (const [chapter, info] of Object.entries(chapters)) {
      if (info.missing) {
        console.log(`  Book ${book} Ch ${chapter}: missing verses ${info.missing.join(', ')}`);
      }
    }
  }
}
