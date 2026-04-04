/**
 * Generates KVN mapping files from osnb2 source data and the old bibel2011.json.
 *
 * Output: mappings/dnb_2011_nb.kvn.json
 *
 * KVN bit layout: book (7) | chapter (8) | verse (8) | part (4) = 27 bits
 * kvn  = basis (osnb2 coordinates)
 * tkvn = translation coordinates
 *
 * Format:
 * {
 *   version: 1,
 *   system: "dnb_2011_nb",
 *   name: "Det Norske Bibelselskap 2011 Bokmål",
 *   bookNames: { ... },
 *   map: [
 *     [kvn, tkvn, "2 Mos 8:1", "2 Mos 7:26"],
 *     ...
 *   ],
 *   extraVerses: [
 *     [tkvn, "Rom 16:25", afterKvn],
 *     ...
 *   ]
 * }
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { encode, formatKvn, BOOK_NAMES } from '../src/types.js';
import type { VerseMapping, MappingEntry, ExtraVerseEntry, KvnMappingFile } from '../src/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BIBLES_DIR = join(__dirname, '../../generate/bibles_raw/osnb2');
const OLD_MAPPING = join(__dirname, '../mappings/bibel2011.json');
const OUTPUT = join(__dirname, '../mappings/dnb_2011_nb.kvn.json');

interface RawVerse {
  bookId: number;
  chapterId: number;
  verseId: number;
  text: string;
}

// Step 1: Build set of all existing osnb2 verses
const osnb2Verses = new Set<string>(); // "book-chapter-verse"

for (let book = 1; book <= 66; book++) {
  const bookDir = join(BIBLES_DIR, String(book));
  if (!existsSync(bookDir)) continue;

  const chapterFiles = readdirSync(bookDir)
    .filter(f => f.endsWith('.json'))
    .sort((a, b) => parseInt(a) - parseInt(b));

  for (const file of chapterFiles) {
    const chapter = parseInt(file.replace('.json', ''));
    const verses: RawVerse[] = JSON.parse(readFileSync(join(bookDir, file), 'utf-8'));
    for (const verse of verses) {
      osnb2Verses.add(`${book}-${chapter}-${verse.verseId}`);
    }
  }
}

console.log(`Found ${osnb2Verses.size} osnb2 verses`);

// Step 2: Read old mapping and convert to kvn/tkvn
const oldMapping: VerseMapping = JSON.parse(readFileSync(OLD_MAPPING, 'utf-8'));

const map: MappingEntry[] = [];
let phantomCount = 0;

// Collect phantom entries (non-Mal, non-Joel) for conversion to extraVerses
interface PhantomEntry {
  osnb2Key: string;
  bibel2011Key: string;
}
const phantomEntries: PhantomEntry[] = [];

for (const [osnb2Key, bibel2011Key] of Object.entries(oldMapping.verseMap)) {
  if (!osnb2Verses.has(osnb2Key)) {
    phantomCount++;
    const [sBook] = osnb2Key.split('-').map(Number);
    // Skip Mal (39) and Joel (29) phantoms — they have invalid tkvn targets
    if (sBook === 39 || sBook === 29) continue;
    phantomEntries.push({ osnb2Key, bibel2011Key });
    continue;
  }

  const [sBook, sChapter, sVerse] = osnb2Key.split('-').map(Number);
  const [tBook, tChapter, tVerse] = bibel2011Key.split('-').map(Number);

  const kvn = encode(sBook, sChapter, sVerse);
  const tkvn = encode(tBook, tChapter, tVerse);

  map.push([
    kvn,
    tkvn,
    formatKvn(kvn, BOOK_NAMES),
    formatKvn(tkvn, BOOK_NAMES),
  ]);
}

console.log(`Mapped ${map.length} verses from old mapping, ${phantomCount} phantoms total`);

// Step 3: Add manual Mal entries (osnb2 3:19-24 → tkvn 4:1-6)
for (let i = 0; i < 6; i++) {
  const kvn = encode(39, 3, 19 + i);
  const tkvn = encode(39, 4, 1 + i);
  map.push([kvn, tkvn, formatKvn(kvn, BOOK_NAMES), formatKvn(tkvn, BOOK_NAMES)]);
}
console.log('Added 6 manual Mal entries (osnb2 3:19-24 → tkvn 4:1-6)');

// Step 4: Add manual Joel entries (osnb2 3:1-5 → tkvn 2:28-32)
for (let i = 0; i < 5; i++) {
  const kvn = encode(29, 3, 1 + i);
  const tkvn = encode(29, 2, 28 + i);
  map.push([kvn, tkvn, formatKvn(kvn, BOOK_NAMES), formatKvn(tkvn, BOOK_NAMES)]);
}
console.log('Added 5 manual Joel entries (osnb2 3:1-5 → tkvn 2:28-32)');

// Sort by kvn for readability
map.sort((a, b) => a[0] - b[0]);

// Step 5: Build extra verses
const extraVerses: ExtraVerseEntry[] = [];

// 5a: Phantom-turned-extraVerses (88 entries)
// Sort by osnb2 key for proper chaining
phantomEntries.sort((a, b) => {
  const [aB, aC, aV] = a.osnb2Key.split('-').map(Number);
  const [bB, bC, bV] = b.osnb2Key.split('-').map(Number);
  if (aB !== bB) return aB - bB;
  if (aC !== bC) return aC - bC;
  return aV - bV;
});

// Build lookup: osnb2Key → bibel2011Key for phantom entries
const phantomByOsnb2 = new Map<string, string>();
for (const p of phantomEntries) {
  phantomByOsnb2.set(p.osnb2Key, p.bibel2011Key);
}

for (const pe of phantomEntries) {
  const [sBook, sChapter, sVerse] = pe.osnb2Key.split('-').map(Number);
  const [tBook, tChapter, tVerse] = pe.bibel2011Key.split('-').map(Number);
  const tkvn = encode(tBook, tChapter, tVerse);

  // Compute afterKvn
  const prevOsnb2Key = `${sBook}-${sChapter}-${sVerse - 1}`;
  let afterKvn: number;

  if (osnb2Verses.has(prevOsnb2Key)) {
    // Previous osnb2 position is a real verse
    afterKvn = encode(sBook, sChapter, sVerse - 1);
  } else if (phantomByOsnb2.has(prevOsnb2Key)) {
    // Previous position is another phantom — chain to its tkvn
    const prevBibel = phantomByOsnb2.get(prevOsnb2Key)!;
    const [pB, pC, pV] = prevBibel.split('-').map(Number);
    afterKvn = encode(pB, pC, pV);
  } else {
    // Search backwards for the last real verse
    let found = false;
    for (let v = sVerse - 2; v >= 1; v--) {
      const key = `${sBook}-${sChapter}-${v}`;
      if (osnb2Verses.has(key)) {
        afterKvn = encode(sBook, sChapter, v);
        found = true;
        break;
      }
    }
    if (!found) {
      // Look at previous chapter
      for (let ch = sChapter - 1; ch >= 1; ch--) {
        for (let v = 255; v >= 1; v--) {
          if (osnb2Verses.has(`${sBook}-${ch}-${v}`)) {
            afterKvn = encode(sBook, ch, v);
            found = true;
            break;
          }
        }
        if (found) break;
      }
    }
    if (!found) {
      afterKvn = encode(sBook, sChapter, sVerse - 1);
    }
  }

  extraVerses.push([tkvn, formatKvn(tkvn, BOOK_NAMES), afterKvn!]);
}

console.log(`Phantom extra verses: ${phantomEntries.length}`);

// 5b: Joel ch 3 extra verses (Bibel 2011 Joel 3:1-21, no osnb2 equivalent)
for (let v = 1; v <= 21; v++) {
  const tkvn = encode(29, 3, v);
  let afterKvn: number;
  if (v === 1) {
    // After the last real osnb2 Joel verse (3:5)
    afterKvn = encode(29, 3, 5);
  } else {
    // Chain to previous extra
    afterKvn = encode(29, 3, v - 1);
  }
  extraVerses.push([tkvn, formatKvn(tkvn, BOOK_NAMES), afterKvn]);
}

console.log('Added 21 Joel ch 3 extra verses');

// 5c: Original unmapped (Rom 16:25-27)
const sortedUnmapped = [...oldMapping.unmapped].sort((a, b) => {
  if (a.bookId !== b.bookId) return a.bookId - b.bookId;
  const [aCh, aV] = a.srcRef.split(':').map(Number);
  const [bCh, bV] = b.srcRef.split(':').map(Number);
  if (aCh !== bCh) return aCh - bCh;
  return aV - bV;
});

for (const entry of sortedUnmapped) {
  const [chapter, verse] = entry.srcRef.split(':').map(Number);
  const tkvn = encode(entry.bookId, chapter, verse);

  const prevKey = `${entry.bookId}-${chapter}-${verse - 1}`;
  let afterKvn: number;
  if (osnb2Verses.has(prevKey)) {
    const parts = prevKey.split('-').map(Number);
    afterKvn = encode(parts[0], parts[1], parts[2]);
  } else {
    afterKvn = encode(entry.bookId, chapter, verse - 1);
  }

  extraVerses.push([tkvn, formatKvn(tkvn, BOOK_NAMES), afterKvn]);
}

console.log(`Original unmapped extra verses: ${sortedUnmapped.length}`);

// Step 6: Write output
const output: KvnMappingFile = {
  version: 1,
  system: 'dnb_2011_nb',
  name: 'Det Norske Bibelselskap 2011 Bokmål',
  description: oldMapping.description,
  bookNames: oldMapping.bookNames,
  map,
  extraVerses,
};

writeFileSync(OUTPUT, JSON.stringify(output, null, 2));
console.log(`\nWritten to ${OUTPUT}`);
console.log(`  Map entries: ${map.length}`);
console.log(`  Extra verses: ${extraVerses.length}`);
console.log(`  Phantoms skipped (Mal+Joel): ${phantomCount - phantomEntries.length}`);

// Verify: show first few entries
console.log('\nFirst 5 map entries:');
for (const entry of map.slice(0, 5)) {
  console.log(`  ${entry[2]} → ${entry[3]}`);
}

// Show Mal entries
console.log('\nMal entries:');
for (const entry of map.filter(e => (e[0] >> 20) === 39)) {
  console.log(`  ${entry[2]} → ${entry[3]}`);
}

// Show Joel entries
console.log('\nJoel map entries:');
for (const entry of map.filter(e => (e[0] >> 20) === 29)) {
  console.log(`  ${entry[2]} → ${entry[3]}`);
}

console.log('\nJoel extra verses:');
for (const entry of extraVerses.filter(e => ((e[0] >> 20) & 0x7F) === 29)) {
  console.log(`  ${entry[1]} (after kvn ${entry[2]})`);
}

console.log('\nRom extra verses:');
for (const entry of extraVerses.filter(e => ((e[0] >> 20) & 0x7F) === 45)) {
  console.log(`  ${entry[1]} (after kvn ${entry[2]})`);
}
