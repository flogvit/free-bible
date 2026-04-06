/**
 * Diagnostic script: Cross-checks all osmain boundary verses against
 * osnb2 mapping, KJV, and nb-2024 to identify wrong texts.
 *
 * Does NOT modify any files.
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PART_SIZE = 16;
const MAX_VERSE = 177;
const MAX_CHAPTER = 151;
const MV = MAX_VERSE * PART_SIZE;
const MC = MAX_CHAPTER * MV;

function decode(kvn: number) {
  const part = kvn % PART_SIZE;
  const rest1 = (kvn - part) / PART_SIZE;
  const verse = rest1 % MAX_VERSE;
  const rest2 = (rest1 - verse) / MAX_VERSE;
  const chapter = rest2 % MAX_CHAPTER;
  const book = (rest2 - chapter) / MAX_CHAPTER;
  return { book, chapter, verse, part };
}

// Load osnb2 mapping
const mappingPath = join(__dirname, '../mappings/osnb2.ukvn.json');
const mapping = JSON.parse(readFileSync(mappingPath, 'utf-8'));
const bookNamesReverse: Record<number, string> = {};
for (const [name, id] of Object.entries(mapping.bookNames)) {
  if (!bookNamesReverse[id as number]) bookNamesReverse[id as number] = name;
}

// Load KJV into lookup: "book:chapter:verse" -> text
const kjvPath = join(__dirname, '../../external/closed/kjv.txt');
const kjvLookup: Record<string, string> = {};
if (existsSync(kjvPath)) {
  for (const line of readFileSync(kjvPath, 'utf-8').split('\n')) {
    const match = line.match(/^(\d+):(\d+):(\d+):(.+)$/);
    if (match) {
      // Handle the \alt:verse\ notation in KJV
      let text = match[4];
      // Remove embedded cross-references like \1:17\
      text = text.replace(/\\[\d:]+\\/g, '').trim();
      kjvLookup[`${match[1]}:${match[2]}:${match[3]}`] = text;
    }
  }
}

// Load nb-2024 into lookup
const nb2024Path = join(__dirname, '../../external/closed/nb-2024.txt');
const nb2024Lookup: Record<string, string> = {};
const bookAbbrToId: Record<string, number> = {};
for (const [name, id] of Object.entries(mapping.bookNames)) {
  bookAbbrToId[name] = id as number;
}
// Also add common variants
bookAbbrToId['Jon'] = 32;
bookAbbrToId['Jona'] = 32;

if (existsSync(nb2024Path)) {
  for (const line of readFileSync(nb2024Path, 'utf-8').split('\n')) {
    // Format: "1 Mos 1,1 text..." or "Jes 9,1 text..."
    const match = line.match(/^(\d?\s?\w+)\s+(\d+),(\d+)\s+(.+)$/);
    if (match) {
      const bookName = match[1];
      const ch = match[2];
      const v = match[3];
      const bookId = bookAbbrToId[bookName];
      if (bookId) {
        nb2024Lookup[`${bookId}:${ch}:${v}`] = match[4];
      }
    }
  }
}

// Helper to read osmain/osnb2 verse text
function readVerseText(bible: string, bookId: number, chapter: number, verseId: number): string | null {
  const filePath = join(__dirname, `../../generate/bibles_raw/${bible}/${bookId}/${chapter}.json`);
  if (!existsSync(filePath)) return null;
  const data = JSON.parse(readFileSync(filePath, 'utf-8'));
  const verse = data.find((v: any) => v.verseId === verseId);
  return verse?.text ?? null;
}

// Find boundary entries: where osmain chapter ≠ osnb2 chapter
const boundaryEntries = mapping.map.filter((entry: any) => {
  const osmain = decode(entry.kvnFrom);
  const osnb2 = decode(entry.tkvnFrom);
  // Cross-chapter boundary (different chapter)
  return osmain.chapter !== osnb2.chapter;
});

console.log(`\n=== OSMAIN BOUNDARY VERSE DIAGNOSTIC ===`);
console.log(`Total boundary entries (cross-chapter): ${boundaryEntries.length}\n`);

let correctCount = 0;
let wrongCount = 0;
let missingCount = 0;

for (const entry of boundaryEntries) {
  const osmain = decode(entry.kvnFrom);
  const osnb2Target = decode(entry.tkvnFrom);
  const bookName = bookNamesReverse[osmain.book] || String(osmain.book);

  // Read texts
  const osmainText = readVerseText('osmain', osmain.book, osmain.chapter, osmain.verse);
  const osnb2Text = readVerseText('osnb2', osnb2Target.book, osnb2Target.chapter, osnb2Target.verse);
  const kjvKey = `${osmain.book}:${osmain.chapter}:${osmain.verse}`;
  const kjvText = kjvLookup[kjvKey] || null;
  const nb2024Key = `${osmain.book}:${osmain.chapter}:${osmain.verse}`;
  const nb2024Text = nb2024Lookup[nb2024Key] || null;

  if (!osmainText || !osnb2Text) {
    missingCount++;
    console.log(`MISSING: ${bookName} ${osmain.chapter}:${osmain.verse} → osnb2 ${osnb2Target.chapter}:${osnb2Target.verse}`);
    if (!osmainText) console.log(`  osmain file missing`);
    if (!osnb2Text) console.log(`  osnb2 file missing`);
    continue;
  }

  // Compare: strip versions/metadata, just compare main text
  const textsMatch = osmainText.trim() === osnb2Text.trim();

  if (textsMatch) {
    correctCount++;
  } else {
    wrongCount++;
    console.log(`WRONG: ${bookName} ${osmain.chapter}:${osmain.verse} (osmain) → osnb2 ${osnb2Target.chapter}:${osnb2Target.verse}`);
    console.log(`  osmain has:  "${osmainText.substring(0, 80)}..."`);
    console.log(`  osnb2 has:   "${osnb2Text.substring(0, 80)}..."`);
    if (kjvText) {
      console.log(`  KJV has:     "${kjvText.substring(0, 80)}..."`);
    }
    if (nb2024Text) {
      console.log(`  nb-2024 has: "${nb2024Text.substring(0, 80)}..."`);
    }
    console.log();
  }
}

console.log(`\n=== SUMMARY ===`);
console.log(`Total boundary verses: ${boundaryEntries.length}`);
console.log(`Correct text: ${correctCount}`);
console.log(`Wrong text: ${wrongCount}`);
console.log(`Missing files: ${missingCount}`);
