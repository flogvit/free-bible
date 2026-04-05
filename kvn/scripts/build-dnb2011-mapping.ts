/**
 * Build a universal KVN mapping for DNB 2011 by comparing against osnb2.
 *
 * Strategy:
 * 1. Parse dnb2011_nb.txt to get all (book, chapter, verse) → text
 * 2. Parse osnb2 to get all (book, chapter, verse) → text
 * 3. For each chapter where verse counts differ, use text similarity
 *    to match DNB2011 verses to osnb2 verses
 * 4. Generate mapping entries where tkvn ≠ kvn
 */

import { readFileSync, readdirSync, existsSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';

const DNB2011_FILE = join(import.meta.dirname, '../../external/closed/dnb2011_nb.txt');
const OSNB2_DIR = join(import.meta.dirname, '../../generate/bibles_raw/osnb2');
const OUT_FILE = join(import.meta.dirname, '../mappings/dnb2011_nb.ukvn.json');

// === Universal KVN encoding (same as osnb2 mapping) ===
const PART_SIZE = 16;
const MAX_VERSE_SPACED = 1770;
const MAX_CHAPTER_SPACED = 1510;
const M_v = MAX_VERSE_SPACED * PART_SIZE;
const M_ch = MAX_CHAPTER_SPACED * M_v;

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
  return { book: bookSpaced / 10, chapter: chapterSpaced / 10, verse: verseSpaced / 10, part };
}

// === Book name mapping (DNB2011 Norwegian names → book IDs) ===
const BOOK_IDS: Record<string, number> = {
  '1 Mos': 1, '2 Mos': 2, '3 Mos': 3, '4 Mos': 4, '5 Mos': 5,
  'Jos': 6, 'Dom': 7, 'Rut': 8, '1 Sam': 9, '2 Sam': 10,
  '1 Kong': 11, '2 Kong': 12, '1 Krøn': 13, '2 Krøn': 14,
  'Esra': 15, 'Neh': 16, 'Est': 17, 'Job': 18, 'Sal': 19,
  'Ordsp': 20, 'Fork': 21, 'Høys': 22, 'Jes': 23, 'Jer': 24,
  'Klag': 25, 'Esek': 26, 'Dan': 27, 'Hos': 28, 'Joel': 29,
  'Am': 30, 'Ob': 31, 'Jona': 32, 'Mi': 33, 'Nah': 34,
  'Hab': 35, 'Sef': 36, 'Hag': 37, 'Sak': 38, 'Mal': 39,
  'Matt': 40, 'Mark': 41, 'Luk': 42, 'Joh': 43, 'Apg': 44,
  'Rom': 45, '1 Kor': 46, '2 Kor': 47, 'Gal': 48, 'Ef': 49,
  'Fil': 50, 'Kol': 51, '1 Tess': 52, '2 Tess': 53,
  '1 Tim': 54, '2 Tim': 55, 'Tit': 56, 'Filem': 57, 'Hebr': 58,
  'Jak': 59, '1 Pet': 60, '2 Pet': 61, '1 Joh': 62, '2 Joh': 63,
  '3 Joh': 64, 'Jud': 65, 'Åp': 66,
};

const BOOK_NAMES: Record<number, string> = {};
for (const [name, id] of Object.entries(BOOK_IDS)) {
  if (!(id in BOOK_NAMES)) BOOK_NAMES[id] = name;
}

// === Parse DNB 2011 txt file ===
interface Verse {
  book: number;
  chapter: number;
  verse: number;
  text: string;
}

function parseDnb2011(): Verse[] {
  const content = readFileSync(DNB2011_FILE, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim());
  const verses: Verse[] = [];

  for (const line of lines) {
    // Format: "1 Mos 1,1 text..."
    // Book names can be multi-word like "1 Mos", "2 Kong"
    const match = line.match(/^(.+?)\s+(\d+),(\d+)\s+(.+)$/);
    if (!match) continue;

    const bookName = match[1];
    const chapter = parseInt(match[2]);
    const verse = parseInt(match[3]);
    const text = match[4].trim();

    const bookId = BOOK_IDS[bookName];
    if (bookId === undefined) {
      // Try common variations
      console.warn(`Unknown book name: "${bookName}" in line: ${line.slice(0, 60)}...`);
      continue;
    }

    verses.push({ book: bookId, chapter, verse, text });
  }

  return verses;
}

// === Load osnb2 ===
function loadOsnb2(): Map<string, Verse[]> {
  const result = new Map<string, Verse[]>();

  const bookDirs = readdirSync(OSNB2_DIR)
    .filter(d => /^\d+$/.test(d) && statSync(join(OSNB2_DIR, d)).isDirectory())
    .map(d => parseInt(d))
    .sort((a, b) => a - b);

  for (const bookId of bookDirs) {
    const bookDir = join(OSNB2_DIR, String(bookId));
    const chapterFiles = readdirSync(bookDir)
      .filter(f => f.endsWith('.json'))
      .map(f => parseInt(f.replace('.json', '')))
      .sort((a, b) => a - b);

    for (const chapterId of chapterFiles) {
      try {
        const data = JSON.parse(readFileSync(join(bookDir, `${chapterId}.json`), 'utf-8'));
        const verses: Verse[] = [];
        if (Array.isArray(data)) {
          for (const item of data) {
            const v = item.verseId ?? item.verse;
            const t = item.text ?? '';
            if (v !== undefined) verses.push({ book: bookId, chapter: chapterId, verse: v, text: t });
          }
        }
        if (verses.length > 0) {
          result.set(`${bookId}:${chapterId}`, verses.sort((a, b) => a.verse - b.verse));
        }
      } catch {
        // skip
      }
    }
  }
  return result;
}

// === Text similarity (normalized) ===
function normalize(text: string): string {
  return text.toLowerCase()
    .replace(/[«»""'']/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function similarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return 1;

  // Simple word overlap
  const wordsA = new Set(na.split(/\s+/));
  const wordsB = new Set(nb.split(/\s+/));
  const intersection = [...wordsA].filter(w => wordsB.has(w)).length;
  const union = new Set([...wordsA, ...wordsB]).size;
  return union > 0 ? intersection / union : 0;
}

// === Main ===
console.log('Parsing DNB 2011...');
const dnb2011Verses = parseDnb2011();
console.log(`DNB 2011: ${dnb2011Verses.length} verses`);

console.log('Loading osnb2...');
const osnb2Chapters = loadOsnb2();

// Group DNB2011 by book:chapter
const dnb2011Chapters = new Map<string, Verse[]>();
for (const v of dnb2011Verses) {
  const key = `${v.book}:${v.chapter}`;
  if (!dnb2011Chapters.has(key)) dnb2011Chapters.set(key, []);
  dnb2011Chapters.get(key)!.push(v);
}

console.log(`DNB 2011: ${dnb2011Chapters.size} chapters`);
console.log(`osnb2: ${osnb2Chapters.size} chapters`);

// === Find differences ===
// For each chapter, compare verse ranges
const mapEntries: Array<{
  tkvn: number;       // DNB2011 coordinate as KVN
  kvn: number;        // osnb2 coordinate as KVN
  tRef: string;       // human-readable tkvn
  kvnRef: string;     // human-readable kvn
  sim: number;        // text similarity score
}> = [];

const dnb2011Only: Array<{ tkvn: number; ref: string; text: string }> = [];
const osnb2Only: Array<{ kvn: number; ref: string; text: string }> = [];

// Get all chapter keys
const allChapterKeys = new Set([...dnb2011Chapters.keys(), ...osnb2Chapters.keys()]);

let identityCount = 0;
let mappedCount = 0;

for (const key of [...allChapterKeys].sort()) {
  const dnbVerses = dnb2011Chapters.get(key);
  const osnbVerses = osnb2Chapters.get(key);

  if (!dnbVerses && osnbVerses) {
    // Chapter only in osnb2
    for (const v of osnbVerses) {
      osnb2Only.push({
        kvn: encode(v.book, v.chapter, v.verse),
        ref: `${BOOK_NAMES[v.book] ?? v.book} ${v.chapter}:${v.verse}`,
        text: v.text.slice(0, 60),
      });
    }
    continue;
  }

  if (dnbVerses && !osnbVerses) {
    // Chapter only in DNB2011
    for (const v of dnbVerses) {
      dnb2011Only.push({
        tkvn: encode(v.book, v.chapter, v.verse),
        ref: `${BOOK_NAMES[v.book] ?? v.book} ${v.chapter},${v.verse}`,
        text: v.text.slice(0, 60),
      });
    }
    continue;
  }

  if (!dnbVerses || !osnbVerses) continue;

  // Both have this chapter — compare verse by verse
  const dnbByVerse = new Map(dnbVerses.map(v => [v.verse, v]));
  const osnbByVerse = new Map(osnbVerses.map(v => [v.verse, v]));

  const [bookStr] = key.split(':');
  const book = parseInt(bookStr);

  // Check each DNB2011 verse
  for (const [verseId, dnbVerse] of dnbByVerse) {
    const osnbVerse = osnbByVerse.get(verseId);

    if (osnbVerse) {
      // Same verse number exists in both — check if it's the same content
      const sim = similarity(dnbVerse.text, osnbVerse.text);
      if (sim > 0.5) {
        // Identity mapping (or close enough)
        identityCount++;
        continue;
      }
    }

    // Verse number doesn't match or content is different — find best match in osnb2
    // Search this chapter and adjacent chapters in osnb2
    let bestMatch: { verse: Verse; sim: number; chKey: string } | null = null;

    const [bStr, cStr] = key.split(':');
    const b = parseInt(bStr);
    const c = parseInt(cStr);

    // Search in current chapter and neighbors
    for (const searchKey of [`${b}:${c - 1}`, `${b}:${c}`, `${b}:${c + 1}`]) {
      const searchVerses = osnb2Chapters.get(searchKey);
      if (!searchVerses) continue;

      for (const candidate of searchVerses) {
        const sim = similarity(dnbVerse.text, candidate.text);
        if (sim > (bestMatch?.sim ?? 0.3)) {
          bestMatch = { verse: candidate, sim, chKey: searchKey };
        }
      }
    }

    if (bestMatch) {
      const tkvn = encode(dnbVerse.book, dnbVerse.chapter, dnbVerse.verse);
      const kvn = encode(bestMatch.verse.book, bestMatch.verse.chapter, bestMatch.verse.verse);

      if (tkvn !== kvn) {
        mapEntries.push({
          tkvn,
          kvn,
          tRef: `${BOOK_NAMES[dnbVerse.book] ?? dnbVerse.book} ${dnbVerse.chapter},${dnbVerse.verse}`,
          kvnRef: `${BOOK_NAMES[bestMatch.verse.book] ?? bestMatch.verse.book} ${bestMatch.verse.chapter}:${bestMatch.verse.verse}`,
          sim: bestMatch.sim,
        });
        mappedCount++;
      } else {
        identityCount++;
      }
    } else {
      // No match found in osnb2
      dnb2011Only.push({
        tkvn: encode(dnbVerse.book, dnbVerse.chapter, dnbVerse.verse),
        ref: `${BOOK_NAMES[dnbVerse.book] ?? dnbVerse.book} ${dnbVerse.chapter},${dnbVerse.verse}`,
        text: dnbVerse.text.slice(0, 60),
      });
    }
  }

  // Check for osnb2 verses not in DNB2011
  for (const [verseId, osnbVerse] of osnbByVerse) {
    if (!dnbByVerse.has(verseId)) {
      // Check if it was already mapped from a different DNB2011 verse
      const kvn = encode(osnbVerse.book, osnbVerse.chapter, osnbVerse.verse);
      const alreadyMapped = mapEntries.some(e => e.kvn === kvn);
      if (!alreadyMapped) {
        osnb2Only.push({
          kvn,
          ref: `${BOOK_NAMES[osnbVerse.book] ?? osnbVerse.book} ${osnbVerse.chapter}:${osnbVerse.verse}`,
          text: osnbVerse.text.slice(0, 60),
        });
      }
    }
  }
}

// === Output results ===
console.log('\n=== MAPPING RESULTS ===');
console.log(`Identity (same coord, similar text): ${identityCount}`);
console.log(`Mapped (different coord): ${mappedCount}`);
console.log(`DNB2011-only (no osnb2 match): ${dnb2011Only.length}`);
console.log(`osnb2-only (no DNB2011 match): ${osnb2Only.length}`);

// Sort map entries by kvn
mapEntries.sort((a, b) => a.kvn - b.kvn);

console.log('\n=== SAMPLE MAPPINGS (first 30) ===');
for (const entry of mapEntries.slice(0, 30)) {
  console.log(`  DNB2011 ${entry.tRef.padEnd(18)} → osnb2 ${entry.kvnRef.padEnd(18)} (sim: ${entry.sim.toFixed(2)})`);
}
if (mapEntries.length > 30) {
  console.log(`  ... and ${mapEntries.length - 30} more`);
}

if (dnb2011Only.length > 0) {
  console.log('\n=== DNB2011-ONLY VERSES (first 20) ===');
  for (const v of dnb2011Only.slice(0, 20)) {
    console.log(`  ${v.ref}: ${v.text}`);
  }
  if (dnb2011Only.length > 20) console.log(`  ... and ${dnb2011Only.length - 20} more`);
}

if (osnb2Only.length > 0) {
  console.log('\n=== OSNB2-ONLY VERSES (first 20) ===');
  for (const v of osnb2Only.slice(0, 20)) {
    console.log(`  ${v.ref}: ${v.text}`);
  }
  if (osnb2Only.length > 20) console.log(`  ... and ${osnb2Only.length - 20} more`);
}

// Low-similarity matches (potential errors)
const lowSim = mapEntries.filter(e => e.sim < 0.5);
if (lowSim.length > 0) {
  console.log(`\n=== LOW SIMILARITY MATCHES (<0.5) — ${lowSim.length} ===`);
  for (const entry of lowSim.slice(0, 20)) {
    console.log(`  DNB2011 ${entry.tRef} → osnb2 ${entry.kvnRef} (sim: ${entry.sim.toFixed(2)})`);
  }
}

// === Write mapping file ===
const mapping = {
  version: 2,
  system: 'dnb_2011_nb',
  name: 'Bibelen 2011 (bokmål)',
  encoding: {
    partSize: PART_SIZE,
    maxVerseSpaced: MAX_VERSE_SPACED,
    maxChapterSpaced: MAX_CHAPTER_SPACED,
  },
  map: mapEntries.map(e => [e.tkvn, e.kvn, e.tRef, e.kvnRef]),
  extraVerses: dnb2011Only.map(v => [v.tkvn, v.ref]),
  missingVerses: osnb2Only.map(v => [v.kvn, v.ref]),
};

writeFileSync(OUT_FILE, JSON.stringify(mapping, null, 2));
console.log(`\nMapping written to ${OUT_FILE}`);
