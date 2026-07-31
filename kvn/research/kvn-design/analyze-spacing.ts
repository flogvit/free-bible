/**
 * Analyze all raw bibles to determine optimal spacing for universal KVN encoding.
 *
 * Scans external/closed/raw/* and generate/bibles_raw/osnb to find:
 * - All unique book IDs and how many exist
 * - Max chapters per book across all translations
 * - Max verses per chapter across all translations
 * - Gaps in book/chapter/verse numbering (where insertions might be needed)
 * - Recommended spacing factors
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join, basename } from 'path';
import { parseArgs, formatHelp, COMMON_FLAGS } from '../../../generate/cli.js';
import type { FlagSpec } from '../../../generate/cli.js';

// Skriptet tar ingen argumenter i dag, men skal likevel gå gjennom kontrakten:
// den er det som gjør at `--help` svarer i stedet for å skanne hver eneste
// rå-bibel, og at et ukjent flagg feiler høyt framfor å bli ignorert.
const SPEC: Record<string, FlagSpec> = {
  help: COMMON_FLAGS.help,
};

const HELP_EXAMPLES = [
  'bun kvn/scripts/analyze-spacing.ts',
];

const RAW_DIR = join(import.meta.dirname, '../../external/closed/raw');
const OSNB_DIR = join(import.meta.dirname, '../../generate/bibles_raw/osnb');

interface VerseData {
  bookId: number;
  chapterId: number;
  verseId: number;
  text: string;
}

// Track per book: max chapter, and per (book,chapter): max verse
const maxChapterPerBook = new Map<number, number>();
const maxVersePerBookChapter = new Map<string, number>();
const allBookIds = new Set<number>();
const bookChapterCounts = new Map<number, Set<number>>(); // book -> set of chapter counts seen
const chapterVerseCounts = new Map<string, Set<number>>(); // "book:chapter" -> set of verse counts seen

// Track how many bibles have each book
const bookBibleCount = new Map<number, number>();

// Track consecutive gaps
const bookGaps = new Map<string, number>(); // "bookA-bookB" -> gap size (for each bible)
const maxBookGap = { gap: 0, where: '' };

let bibleCount = 0;

function processBible(bibleDir: string, bibleName: string) {
  const bookDirs = readdirSync(bibleDir).filter(d => {
    const full = join(bibleDir, d);
    return /^\d+$/.test(d) && existsSync(full) && statSync(full).isDirectory();
  }).map(d => parseInt(d)).sort((a, b) => a - b);

  if (bookDirs.length === 0) return;
  bibleCount++;

  // Track books in this bible for gap analysis
  for (let i = 0; i < bookDirs.length; i++) {
    const bookId = bookDirs[i];
    allBookIds.add(bookId);
    bookBibleCount.set(bookId, (bookBibleCount.get(bookId) ?? 0) + 1);

    if (i > 0) {
      const gap = bookId - bookDirs[i - 1];
      if (gap > maxBookGap.gap) {
        maxBookGap.gap = gap;
        maxBookGap.where = `${bibleName}: book ${bookDirs[i - 1]} -> ${bookId}`;
      }
    }
  }

  for (const bookId of bookDirs) {
    const bookDir = join(bibleDir, String(bookId));
    const chapterFiles = readdirSync(bookDir)
      .filter(f => f.endsWith('.json'))
      .map(f => parseInt(f.replace('.json', '')))
      .sort((a, b) => a - b);

    // Track chapter count variation
    if (!bookChapterCounts.has(bookId)) bookChapterCounts.set(bookId, new Set());
    bookChapterCounts.get(bookId)!.add(chapterFiles.length);

    for (const chapterId of chapterFiles) {
      const key = `${bookId}:${chapterId}`;
      const maxCh = maxChapterPerBook.get(bookId) ?? 0;
      if (chapterId > maxCh) maxChapterPerBook.set(bookId, chapterId);

      try {
        const data: VerseData[] = JSON.parse(readFileSync(join(bookDir, `${chapterId}.json`), 'utf-8'));
        if (!data.length) continue;

        const verseIds = data.map(v => v.verseId).sort((a, b) => a - b);
        const maxVerse = verseIds[verseIds.length - 1];

        const currentMax = maxVersePerBookChapter.get(key) ?? 0;
        if (maxVerse > currentMax) maxVersePerBookChapter.set(key, maxVerse);

        if (!chapterVerseCounts.has(key)) chapterVerseCounts.set(key, new Set());
        chapterVerseCounts.get(key)!.add(verseIds.length);
      } catch {
        // skip malformed files
      }
    }
  }
}

function main(): void {
  // Hjelpen skal ut før noe leses fra disk.
  const { flags } = parseArgs(process.argv.slice(2), SPEC);
  if (flags.help) {
    console.log(formatHelp(
      'kvn/scripts/analyze-spacing.ts',
      'finner største bok-, kapittel- og versnummer i alle rå-bibler og foreslår spacing for KVN-kodingen',
      SPEC,
      HELP_EXAMPLES,
    ));
    process.exit(0);
  }

  // Process all raw bibles
  console.log('Scanning all raw bibles...');
  const rawBibles = readdirSync(RAW_DIR).filter(d =>
    statSync(join(RAW_DIR, d)).isDirectory()
  );

  for (const bible of rawBibles) {
    processBible(join(RAW_DIR, bible), bible);
  }

  // Also process osnb
  if (existsSync(OSNB_DIR)) {
    processBible(OSNB_DIR, 'osnb');
  }

  console.log(`\nScanned ${bibleCount} bibles\n`);

  // === Analysis ===

  // 1. Book IDs
  const sortedBooks = [...allBookIds].sort((a, b) => a - b);
  console.log('=== BOOK IDs ===');
  console.log(`Total unique book IDs: ${sortedBooks.length}`);
  console.log(`Range: ${sortedBooks[0]} - ${sortedBooks[sortedBooks.length - 1]}`);
  console.log(`Books: ${sortedBooks.join(', ')}`);

  // Find gaps in book numbering
  const bookNumGaps: { after: number; before: number; size: number }[] = [];
  for (let i = 1; i < sortedBooks.length; i++) {
    const gap = sortedBooks[i] - sortedBooks[i - 1];
    if (gap > 1) {
      bookNumGaps.push({ after: sortedBooks[i - 1], before: sortedBooks[i], size: gap - 1 });
    }
  }
  console.log(`\nGaps in book numbering (unused IDs):`);
  for (const g of bookNumGaps) {
    console.log(`  After book ${g.after}, before ${g.before}: ${g.size} unused IDs`);
  }

  // Books with low bible count (rare books)
  console.log(`\nBooks by frequency (rare first):`);
  const byFreq = [...bookBibleCount.entries()].sort((a, b) => a[1] - b[1]);
  for (const [bookId, count] of byFreq.filter(([, c]) => c < 50)) {
    console.log(`  Book ${bookId}: ${count} bibles`);
  }

  // 2. Max chapters per book
  console.log('\n=== MAX CHAPTERS PER BOOK ===');
  const maxChOverall = Math.max(...maxChapterPerBook.values());
  console.log(`Highest chapter number seen: ${maxChOverall}`);

  // Books with chapter count variation
  console.log('\nBooks with varying chapter counts:');
  for (const [bookId, counts] of [...bookChapterCounts.entries()].sort((a, b) => a[0] - b[0])) {
    if (counts.size > 1) {
      const sorted = [...counts].sort((a, b) => a - b);
      const max = Math.max(...sorted);
      console.log(`  Book ${bookId}: chapter counts seen: ${sorted.join(', ')} (max: ${max})`);
    }
  }

  // 3. Max verses per chapter
  console.log('\n=== MAX VERSES PER CHAPTER ===');
  const allMaxVerses = [...maxVersePerBookChapter.values()];
  const highestVerse = Math.max(...allMaxVerses);
  console.log(`Highest verse number seen: ${highestVerse}`);

  // Find chapters with very high verse counts
  const highVerseChapters = [...maxVersePerBookChapter.entries()]
    .filter(([, v]) => v > 100)
    .sort((a, b) => b[1] - a[1]);
  console.log(`\nChapters with >100 verses:`);
  for (const [key, maxV] of highVerseChapters.slice(0, 20)) {
    console.log(`  ${key}: max verse ${maxV}`);
  }

  // Chapters with most verse count variation
  console.log('\nChapters with most verse count variation (top 20):');
  const variationEntries = [...chapterVerseCounts.entries()]
    .map(([key, set]) => ({ key, count: set.size, values: [...set].sort((a, b) => a - b) }))
    .filter(e => e.count > 3)
    .sort((a, b) => b.count - a.count);
  for (const e of variationEntries.slice(0, 20)) {
    const min = e.values[0];
    const max = e.values[e.values.length - 1];
    console.log(`  ${e.key}: ${e.count} variants (${min}–${max})`);
  }

  // 4. Part field analysis (unchanged, always 0-15)
  console.log('\n=== PART FIELD ===');
  console.log('Part field: 0-15 (unchanged from current design)');
  console.log('0 = whole verse, 1-15 = sentence count (a=1, b=2, ...)');

  // 5. Spacing recommendations
  console.log('\n=== SPACING ANALYSIS ===');

  const maxBook = sortedBooks[sortedBooks.length - 1];
  const booksNeeded = maxBook; // We need at least this many slots

  // Calculate how many "insertions" might be needed between consecutive books
  // Look at where different traditions place books differently
  console.log(`\nMax book ID: ${maxBook}`);
  console.log(`Max chapter in any book: ${maxChOverall}`);
  console.log(`Max verse in any chapter: ${highestVerse}`);
  console.log(`Max part: 15`);

  // Calculate total KVN range for different spacing factors
  console.log('\n=== SPACING PROPOSALS ===');

  for (const spacing of [1, 2, 5, 10, 20, 50, 100]) {
    const bookSlots = maxBook * spacing;
    const chapterSlots = maxChOverall * spacing;
    const verseSlots = highestVerse * spacing;
    const partSlots = 16; // always 0-15

    // Simple multiplicative encoding
    const maxKvn = bookSlots * chapterSlots * verseSlots * partSlots;
    const fitsInSafeInt = maxKvn <= Number.MAX_SAFE_INTEGER;
    const bits = Math.ceil(Math.log2(maxKvn));

    // More readable: decimal encoding
    // book * B + chapter * C + verse * V + part
    const partDigits = 2; // 0-15
    const verseMultiplier = 100; // 2 digits for part
    const chapterMultiplier = verseSlots * verseMultiplier;
    const bookMultiplier = chapterSlots * chapterMultiplier;
    const maxDecimal = bookSlots * bookMultiplier;

    console.log(`\nSpacing ${spacing}x:`);
    console.log(`  Book range: 0-${bookSlots} (${bookSlots - maxBook} insertion slots)`);
    console.log(`  Chapter range: 0-${chapterSlots} (${chapterSlots - maxChOverall} insertion slots per book)`);
    console.log(`  Verse range: 0-${verseSlots} (${verseSlots - highestVerse} insertion slots per chapter)`);
    console.log(`  Max KVN (multiplicative): ${maxKvn.toLocaleString()} (${bits} bits, safe int: ${fitsInSafeInt})`);
    console.log(`  Max KVN (positional):     ${maxDecimal.toLocaleString()} (safe int: ${maxDecimal <= Number.MAX_SAFE_INTEGER})`);
  }

  // Recommend a decimal-friendly scheme
  console.log('\n=== RECOMMENDED ENCODING ===');
  console.log('Goal: human-readable, room for insertions, fits in JS safe integer\n');

  // Find smallest power-of-10 multipliers that work
  const recBookSpacing = 10; // 10x spacing for books
  const recBook = maxBook * recBookSpacing;
  const recChSpacing = 10;
  const recCh = maxChOverall * recChSpacing;
  const recVerseSpacing = 10;
  const recVerse = highestVerse * recVerseSpacing;

  // Encoding: book * M_book + chapter * M_chapter + verse * M_verse + part
  // Choose multipliers as powers of 10 for readability
  const partWidth = 100;    // 2 decimal digits (0-15 fits, room to 99)
  const verseWidth = recVerse * partWidth;
  const chapterWidth = recCh * verseWidth;
  const maxVal = recBook * chapterWidth;

  console.log(`Proposed layout (decimal):`);
  console.log(`  part:    last 2 digits       (0-99, using 0-15)`);
  console.log(`  verse:   next ${String(recVerse).length + 2} digits     (0-${recVerse}, max actual: ${highestVerse})`);
  console.log(`  chapter: next ${String(recCh).length} digits        (0-${recCh}, max actual: ${maxChOverall})`);
  console.log(`  book:    leading digits       (0-${recBook}, max actual: ${maxBook})`);
  console.log(`  Max value: ${maxVal.toLocaleString()}`);
  console.log(`  Fits in JS safe integer: ${maxVal <= Number.MAX_SAFE_INTEGER}`);
  console.log(`  Bits needed: ${Math.ceil(Math.log2(maxVal))}`);

  // Show example encodings
  console.log('\nExample encodings:');
  const examples = [
    { name: '1 Mos 1:1', book: 1, ch: 1, verse: 1, part: 0 },
    { name: '2 Mos 8:1', book: 2, ch: 8, verse: 1, part: 0 },
    { name: 'Sal 119:176', book: 19, ch: 119, verse: 176, part: 0 },
    { name: 'Mika 5:4a', book: 33, ch: 5, verse: 4, part: 1 },
    { name: 'Åp 22:21', book: 66, ch: 22, verse: 21, part: 0 },
  ];

  for (const ex of examples) {
    const b = ex.book * recBookSpacing;
    const c = ex.ch * recChSpacing;
    const v = ex.verse * recVerseSpacing;
    const kvn = b * (recCh * recVerse * partWidth) + c * (recVerse * partWidth) + v * partWidth + ex.part;
    console.log(`  ${ex.name.padEnd(15)} → book=${b} ch=${c} v=${v} part=${ex.part} → KVN=${kvn.toLocaleString()}`);
  }
}

// Kjører bare når fila startes direkte, slik at import ikke har bivirkninger (#108).
if (import.meta.main) {
    main();
}
