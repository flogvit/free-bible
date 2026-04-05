/**
 * Build osnb3 — the master Bible text with all verses from all traditions.
 *
 * Step 1: Copy osnb2 as base
 * Step 2: Scan all 1148 raw bibles, find the majority numbering per chapter
 * Step 3: Identify verses missing from osnb2 that exist in other bibles
 * Step 4: Output a report of what needs to be added/renumbered
 *
 * This script does NOT translate or insert yet — it produces a plan.
 */

import { readFileSync, readdirSync, existsSync, statSync, writeFileSync, mkdirSync, cpSync } from 'fs';
import { join } from 'path';

const OSNB2_DIR = join(import.meta.dirname, '../../generate/bibles_raw/osnb2');
const RAW_DIR = join(import.meta.dirname, '../../external/closed/raw');
const OSNB3_DIR = join(import.meta.dirname, '../../generate/bibles_raw/osnb3');
const REPORT_FILE = join(import.meta.dirname, '../data/osnb3-build-report.json');

interface VerseData {
  bookId: number;
  chapterId: number;
  verseId: number;
  text: string;
}

type ChapterKey = string; // "book:chapter"

// === Step 1: Load osnb2 structure ===

function loadVerseStructure(dir: string): Map<ChapterKey, number[]> {
  const result = new Map<ChapterKey, number[]>();
  if (!existsSync(dir)) return result;

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
        if (!data.length) continue;
        const verseIds = data.map(v => v.verseId).sort((a, b) => a - b);
        result.set(`${bookId}:${chapterId}`, verseIds);
      } catch {
        // skip
      }
    }
  }
  return result;
}

console.log('Loading osnb2...');
const osnb2 = loadVerseStructure(OSNB2_DIR);
console.log(`osnb2: ${osnb2.size} chapters`);

// === Step 2: Scan all raw bibles, collect majority numbering ===

// For each (book, chapter): collect a histogram of verse structures
// Structure key = sorted verse IDs joined as string
const chapterStructures = new Map<ChapterKey, Map<string, { count: number; maxVerse: number; verseIds: number[]; examples: string[] }>>();
// Also track which books exist in which bibles
const bookPresence = new Map<number, number>(); // bookId -> count of bibles

let bibleCount = 0;

console.log('Scanning all raw bibles...');
const rawBibles = readdirSync(RAW_DIR).filter(d =>
  statSync(join(RAW_DIR, d)).isDirectory()
);

for (const bible of rawBibles) {
  const bibleDir = join(RAW_DIR, bible);
  const bookDirs = readdirSync(bibleDir)
    .filter(d => /^\d+$/.test(d) && existsSync(join(bibleDir, d)) && statSync(join(bibleDir, d)).isDirectory())
    .map(d => parseInt(d));

  if (bookDirs.length === 0) continue;
  bibleCount++;

  for (const bookId of bookDirs) {
    bookPresence.set(bookId, (bookPresence.get(bookId) ?? 0) + 1);

    const bookDir = join(bibleDir, String(bookId));
    const chapterFiles = readdirSync(bookDir).filter(f => f.endsWith('.json'));

    for (const chFile of chapterFiles) {
      const chapterId = parseInt(chFile.replace('.json', ''));
      const key: ChapterKey = `${bookId}:${chapterId}`;

      try {
        const data: VerseData[] = JSON.parse(readFileSync(join(bookDir, chFile), 'utf-8'));
        if (!data.length) continue;
        const verseIds = data.map(v => v.verseId).sort((a, b) => a - b);
        const maxVerse = verseIds[verseIds.length - 1];
        const structKey = `${verseIds.length}:${maxVerse}`;

        if (!chapterStructures.has(key)) chapterStructures.set(key, new Map());
        const structures = chapterStructures.get(key)!;

        if (!structures.has(structKey)) {
          structures.set(structKey, { count: 0, maxVerse, verseIds, examples: [] });
        }
        const entry = structures.get(structKey)!;
        entry.count++;
        if (entry.examples.length < 3) entry.examples.push(bible);
      } catch {
        // skip
      }
    }
  }
}

console.log(`Scanned ${bibleCount} bibles`);

// === Step 3: Determine majority numbering and find differences ===

interface ChapterAnalysis {
  key: string;
  book: number;
  chapter: number;
  osnb2Verses: number[] | null;
  majorityVerses: number[];
  majorityCount: number;
  totalBibles: number;
  action: 'keep' | 'renumber' | 'add_chapter';
  versesToAdd: number[];    // verse IDs in majority but not in osnb2
  versesToShift: number[];  // verse IDs in osnb2 but not in majority (need renumbering)
  maxVerse: number;
}

const analyses: ChapterAnalysis[] = [];
let keepCount = 0;
let renumberCount = 0;
let addChapterCount = 0;

for (const [key, structures] of [...chapterStructures.entries()].sort()) {
  const [bookStr, chapterStr] = key.split(':');
  const book = parseInt(bookStr);
  const chapter = parseInt(chapterStr);

  // Find majority structure
  let majority = { count: 0, maxVerse: 0, verseIds: [] as number[], examples: [] as string[] };
  let totalBibles = 0;
  for (const [, struct] of structures) {
    totalBibles += struct.count;
    if (struct.count > majority.count) {
      majority = struct;
    }
  }

  const osnb2Verses = osnb2.get(key) ?? null;

  // Compare osnb2 with majority
  if (!osnb2Verses) {
    // Chapter doesn't exist in osnb2 — need to add it
    analyses.push({
      key, book, chapter,
      osnb2Verses: null,
      majorityVerses: majority.verseIds,
      majorityCount: majority.count,
      totalBibles,
      action: 'add_chapter',
      versesToAdd: majority.verseIds,
      versesToShift: [],
      maxVerse: majority.maxVerse,
    });
    addChapterCount++;
    continue;
  }

  // Check if osnb2 matches majority
  const osnb2Set = new Set(osnb2Verses);
  const majoritySet = new Set(majority.verseIds);

  const inMajorityNotOsnb2 = majority.verseIds.filter(v => !osnb2Set.has(v));
  const inOsnb2NotMajority = osnb2Verses.filter(v => !majoritySet.has(v));

  if (inMajorityNotOsnb2.length === 0 && inOsnb2NotMajority.length === 0) {
    // Perfect match
    keepCount++;
    continue;
  }

  // There are differences
  analyses.push({
    key, book, chapter,
    osnb2Verses,
    majorityVerses: majority.verseIds,
    majorityCount: majority.count,
    totalBibles,
    action: inOsnb2NotMajority.length > 0 ? 'renumber' : 'keep',
    versesToAdd: inMajorityNotOsnb2,
    versesToShift: inOsnb2NotMajority,
    maxVerse: Math.max(majority.maxVerse, osnb2Verses[osnb2Verses.length - 1]),
  });
  if (inOsnb2NotMajority.length > 0) {
    renumberCount++;
  }
}

// Also find chapters in osnb2 that no other bible has (unlikely but check)
for (const [key] of osnb2) {
  if (!chapterStructures.has(key)) {
    const [bookStr, chapterStr] = key.split(':');
    console.warn(`osnb2 chapter ${key} not found in any raw bible`);
  }
}

// === Step 4: Report ===

console.log(`\n=== OSNB3 BUILD REPORT ===`);
console.log(`osnb2 chapters: ${osnb2.size}`);
console.log(`Total chapters across all bibles: ${chapterStructures.size}`);
console.log(`Chapters matching majority: ${keepCount}`);
console.log(`Chapters needing renumbering: ${renumberCount}`);
console.log(`New chapters to add: ${addChapterCount}`);

// Show renumber cases
const renumberCases = analyses.filter(a => a.action === 'renumber');
if (renumberCases.length > 0) {
  console.log(`\n=== CHAPTERS NEEDING RENUMBERING (${renumberCases.length}) ===`);
  for (const a of renumberCases.slice(0, 50)) {
    console.log(`  ${a.key}: osnb2 has [${a.versesToShift.join(',')}] not in majority, majority has [${a.versesToAdd.join(',')}] not in osnb2 (${a.majorityCount}/${a.totalBibles} bibles)`);
  }
  if (renumberCases.length > 50) console.log(`  ... and ${renumberCases.length - 50} more`);
}

// Show add chapter cases
const addCases = analyses.filter(a => a.action === 'add_chapter');
if (addCases.length > 0) {
  console.log(`\n=== NEW CHAPTERS TO ADD (${addCases.length}) ===`);
  for (const a of addCases) {
    console.log(`  Book ${a.book} Ch ${a.chapter}: ${a.majorityVerses.length} verses (in ${a.majorityCount}/${a.totalBibles} bibles)`);
  }
}

// Show chapters where osnb2 has extra verses not in majority
const extraOsnb2 = analyses.filter(a => a.versesToAdd.length > 0 && a.action !== 'add_chapter');
if (extraOsnb2.length > 0) {
  console.log(`\n=== CHAPTERS WHERE MAJORITY HAS EXTRA VERSES (${extraOsnb2.length}) ===`);
  for (const a of extraOsnb2.slice(0, 50)) {
    console.log(`  ${a.key}: majority adds verses [${a.versesToAdd.join(',')}] (${a.majorityCount}/${a.totalBibles})`);
  }
  if (extraOsnb2.length > 50) console.log(`  ... and ${extraOsnb2.length - 50} more`);
}

// Books that exist in raw bibles but not in osnb2
const osnb2Books = new Set([...osnb2.keys()].map(k => parseInt(k.split(':')[0])));
const missingBooks = [...bookPresence.entries()]
  .filter(([bookId]) => !osnb2Books.has(bookId))
  .sort((a, b) => a[0] - b[0]);

if (missingBooks.length > 0) {
  console.log(`\n=== BOOKS NOT IN OSNB2 ===`);
  for (const [bookId, count] of missingBooks) {
    console.log(`  Book ${bookId}: found in ${count} bibles`);
  }
}

// Summary stats for all verses
let totalVersesToAdd = 0;
let totalVersesToShift = 0;
for (const a of analyses) {
  totalVersesToAdd += a.versesToAdd.length;
  totalVersesToShift += a.versesToShift.length;
}

console.log(`\n=== TOTALS ===`);
console.log(`Verses to add to osnb3: ${totalVersesToAdd}`);
console.log(`Verses in osnb2 not matching majority: ${totalVersesToShift}`);
console.log(`New chapters: ${addChapterCount}`);
console.log(`New books: ${missingBooks.length}`);

// Write report
const report = {
  generated: new Date().toISOString(),
  osnb2Chapters: osnb2.size,
  totalChapters: chapterStructures.size,
  matchingChapters: keepCount,
  renumberChapters: renumberCount,
  newChapters: addChapterCount,
  totalVersesToAdd,
  totalVersesToShift,
  missingBooks: missingBooks.map(([id, count]) => ({ bookId: id, bibleCount: count })),
  analyses: analyses.map(a => ({
    ...a,
    osnb2Verses: undefined,  // too verbose for report
    majorityVerses: undefined,
  })),
};

writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));
console.log(`\nReport written to ${REPORT_FILE}`);
