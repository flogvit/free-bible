/**
 * Build osnb_complete - complete Bible with all verse positions.
 *
 * Creates generate/bibles_raw/osnb_complete/ with all 66 books + extra chapters,
 * filling in ~143 verse positions that exist in ≥50 other translations but not in osnb.
 *
 * Also writes kvn/data/osnb-additions.json with metadata for each added verse.
 *
 * Flaggene går gjennom den felles kontrakten i generate/cli.ts; `--help` viser dem.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parseArgs, formatHelp, COMMON_FLAGS } from '../../generate/cli.js';
import type { FlagSpec } from '../../generate/cli.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '../..');
const OSNB_DIR = join(PROJECT_ROOT, 'generate/bibles_raw/osnb');
const OUTPUT_DIR = join(PROJECT_ROOT, 'generate/bibles_raw/kvn');
const REPORT_FILE = join(__dirname, '../data/verse-structure-report.json');
const MAPPING_FILE = join(__dirname, '../mappings/dnb_2011_nb.kvn.json');
const EXTERNAL_DIR = join(PROJECT_ROOT, 'external/closed/raw');
const ADDITIONS_FILE = join(__dirname, '../data/osnb-additions.json');

const THRESHOLD = 50;

// ============================================================
// Types
// ============================================================

interface RawVerse {
  bookId: number;
  chapterId: number;
  verseId: number;
  text: string;
  versions?: unknown[];
}

interface OutputVerse {
  bookId: number;
  chapterId: number;
  verseId: number;
  text: string;
  source?: string;
}

interface Addition {
  bookId: number;
  chapterId: number;
  verseId: number;
  source: string;
  type: 'numbering_shift' | 'missing_content';
  presentInTranslations: number;
}

interface ChapterReport {
  translationsWithChapter: number;
  maxVerseDistribution: Record<string, number>;
  dominantMaxVerse: number;
  commonMissingVerses: { verseId: number; missingIn: number; presentIn: number }[];
}

interface BookReport {
  bookId: number;
  translationsWithBook: number;
  chapterCountDistribution: Record<string, number>;
  dominantChapterCount: number;
  chapters: Record<string, ChapterReport>;
}

interface VerseStructureReport {
  generatedAt: string;
  translationCount: number;
  books: Record<string, BookReport>;
}

const SPEC: Record<string, FlagSpec> = {
  help: COMMON_FLAGS.help,
};

const HELP_EXAMPLES = [
  'bun kvn/scripts/build-osnb-complete.ts',
];

function main(): void {
  // Hjelpen skal ut før noe leses fra eller skrives til disk.
  const { flags } = parseArgs(process.argv.slice(2), SPEC);
  if (flags.help) {
    console.log(formatHelp(
      'kvn/scripts/build-osnb-complete.ts',
      'bygger generate/bibles_raw/kvn: osnb utfylt med versposisjoner som finnes i ≥50 andre oversettelser',
      SPEC,
      HELP_EXAMPLES,
    ));
    process.exit(0);
  }

  // ============================================================
  // Step 1: Read all osnb verses
  // ============================================================

  console.log('Step 1: Reading osnb verses...');

  const osnbData = new Map<string, RawVerse[]>();
  const osnbSet = new Set<string>();
  let osnbVerseCount = 0;

  for (let book = 1; book <= 66; book++) {
    const bookDir = join(OSNB_DIR, String(book));
    if (!existsSync(bookDir)) continue;

    const files = readdirSync(bookDir)
      .filter(f => f.endsWith('.json'))
      .sort((a, b) => parseInt(a) - parseInt(b));

    for (const file of files) {
      const chapter = parseInt(file.replace('.json', ''));
      const verses: RawVerse[] = JSON.parse(readFileSync(join(bookDir, file), 'utf-8'));
      osnbData.set(`${book}-${chapter}`, verses);
      for (const v of verses) {
        osnbSet.add(`${book}-${chapter}-${v.verseId}`);
        osnbVerseCount++;
      }
    }
  }

  console.log(`  Found ${osnbVerseCount} osnb verses`);

  // ============================================================
  // Step 2: Find missing verse positions from verse-structure-report
  // ============================================================

  console.log('Step 2: Finding missing verse positions...');

  const report: VerseStructureReport = JSON.parse(readFileSync(REPORT_FILE, 'utf-8'));

  interface MissingPosition {
    bookId: number;
    chapterId: number;
    verseId: number;
    presentInTranslations: number;
  }

  function estimatePresence(chapter: ChapterReport, verseId: number): number {
    // Check if in commonMissingVerses (has exact counts)
    const cmv = chapter.commonMissingVerses.find(v => v.verseId === verseId);
    if (cmv) return cmv.presentIn;

    if (verseId <= chapter.dominantMaxVerse) {
      // Within dominant range and not flagged as commonly missing → in nearly all translations
      return chapter.translationsWithChapter;
    }

    // Beyond dominant max: sum translations whose maxVerse >= verseId
    let count = 0;
    for (const [maxStr, n] of Object.entries(chapter.maxVerseDistribution)) {
      if (parseInt(maxStr) >= verseId) count += n;
    }
    return count;
  }

  const missingPositions: MissingPosition[] = [];

  for (const [bookIdStr, book] of Object.entries(report.books)) {
    const bookId = parseInt(bookIdStr);
    if (bookId > 66) continue; // Skip deuterocanonical

    for (const [chapterStr, chapter] of Object.entries(book.chapters)) {
      const chapterId = parseInt(chapterStr);
      const maxVerse = Math.max(...Object.keys(chapter.maxVerseDistribution).map(Number));

      for (let verseId = 1; verseId <= maxVerse; verseId++) {
        if (osnbSet.has(`${bookId}-${chapterId}-${verseId}`)) continue;

        const presentIn = estimatePresence(chapter, verseId);

        // Joel 4:1-21 explicitly included regardless of threshold
        const isJoel4 = bookId === 29 && chapterId === 4;

        if (presentIn >= THRESHOLD || isJoel4) {
          missingPositions.push({ bookId, chapterId, verseId, presentInTranslations: presentIn });
        }
      }
    }
  }

  missingPositions.sort((a, b) => {
    if (a.bookId !== b.bookId) return a.bookId - b.bookId;
    if (a.chapterId !== b.chapterId) return a.chapterId - b.chapterId;
    return a.verseId - b.verseId;
  });

  console.log(`  Found ${missingPositions.length} missing verse positions`);

  // ============================================================
  // Step 3: Build reverse mapping from dnb_2011
  // ============================================================

  console.log('Step 3: Building reverse mapping from dnb_2011...');

  const mappingFile = JSON.parse(readFileSync(MAPPING_FILE, 'utf-8'));

  // Build book name → ID lookup from mapping
  const bookNameToId: Record<string, number> = {};
  for (const [name, id] of Object.entries(mappingFile.bookNames)) {
    bookNameToId[name] = id as number;
  }

  function parseRef(ref: string): { book: number; chapter: number; verse: number } | null {
    const match = ref.match(/^(.+?)\s+(\d+):(\d+)$/);
    if (!match) return null;
    const book = bookNameToId[match[1]];
    if (book === undefined) return null;
    return { book, chapter: parseInt(match[2]), verse: parseInt(match[3]) };
  }

  // Map from European/tkvn key → osnb/kvn key (only where different and osnb exists)
  const reverseMapping = new Map<string, string>();

  for (const entry of mappingFile.map) {
    const [kvn, tkvn, kvnRef, tkvnRef] = entry;
    if (kvn === tkvn) continue;

    const tCoord = parseRef(tkvnRef);
    const sCoord = parseRef(kvnRef);
    if (!tCoord || !sCoord) continue;

    const tKey = `${tCoord.book}-${tCoord.chapter}-${tCoord.verse}`;
    const sKey = `${sCoord.book}-${sCoord.chapter}-${sCoord.verse}`;

    if (osnbSet.has(sKey)) {
      reverseMapping.set(tKey, sKey);
    }
  }

  console.log(`  Built reverse mapping with ${reverseMapping.size} entries from mapping file`);

  // Add known Hebrew-European versification shifts not in the mapping file.
  // These are well-documented differences where the text exists in osnb
  // under a different chapter/verse number.
  const manualShifts: Array<{ eurBook: number; eurChapter: number; eurVerse: number; hebChapter: number; hebVerse: number }> = [
    // Leviticus 6: European 6:24-30 = Hebrew 6:17-23 (offset +7)
    ...Array.from({ length: 7 }, (_, i) => ({ eurBook: 3, eurChapter: 6, eurVerse: 24 + i, hebChapter: 6, hebVerse: 17 + i })),
    // Joel 2:28-32 (European) = Joel 3:1-5 (Hebrew/osnb)
    ...Array.from({ length: 5 }, (_, i) => ({ eurBook: 29, eurChapter: 2, eurVerse: 28 + i, hebChapter: 3, hebVerse: 1 + i })),
    // Zechariah 1:18-21 (European) = Zechariah 2:1-4 (Hebrew)
    ...Array.from({ length: 4 }, (_, i) => ({ eurBook: 38, eurChapter: 1, eurVerse: 18 + i, hebChapter: 2, hebVerse: 1 + i })),
    // Hosea 11:12 = 12:1, Hosea 13:16 = 14:1
    { eurBook: 28, eurChapter: 11, eurVerse: 12, hebChapter: 12, hebVerse: 1 },
    { eurBook: 28, eurChapter: 13, eurVerse: 16, hebChapter: 14, hebVerse: 1 },
    // 1 Samuel 23:29 = 24:1
    { eurBook: 9, eurChapter: 23, eurVerse: 29, hebChapter: 24, hebVerse: 1 },
    // Jonah 1:17 = 2:1
    { eurBook: 32, eurChapter: 1, eurVerse: 17, hebChapter: 2, hebVerse: 1 },
    // Micah 5:15 = 6:1
    { eurBook: 33, eurChapter: 5, eurVerse: 15, hebChapter: 6, hebVerse: 1 },
    // Nahum 1:15 = 2:1
    { eurBook: 34, eurChapter: 1, eurVerse: 15, hebChapter: 2, hebVerse: 1 },
    // Ecclesiastes 5:20 = 6:1
    { eurBook: 21, eurChapter: 5, eurVerse: 20, hebChapter: 6, hebVerse: 1 },
    // Isaiah 64:12 = 64:11
    { eurBook: 23, eurChapter: 64, eurVerse: 12, hebChapter: 64, hebVerse: 11 },
    // Daniel 5:31 = 6:1
    { eurBook: 27, eurChapter: 5, eurVerse: 31, hebChapter: 6, hebVerse: 1 },
    // Job 41:27-34 (ASV/European) = Job 41:19-26 (Hebrew/osnb) — offset -8
    ...Array.from({ length: 8 }, (_, i) => ({ eurBook: 18, eurChapter: 41, eurVerse: 27 + i, hebChapter: 41, hebVerse: 19 + i })),
    // Numbers 29:40 (European) = Numbers 30:1 (Hebrew)
    { eurBook: 4, eurChapter: 29, eurVerse: 40, hebChapter: 30, hebVerse: 1 },
    // Psalm 11:8 (European/Septuagint) = Psalm 12:9 (Hebrew/osnb)
    { eurBook: 19, eurChapter: 11, eurVerse: 8, hebChapter: 12, hebVerse: 9 },
    // Psalm 43:6 (European/Septuagint) = Psalm 44:7 (Hebrew/osnb)
    { eurBook: 19, eurChapter: 43, eurVerse: 6, hebChapter: 44, hebVerse: 7 },
    // Psalm 70:7 (European/Septuagint) = Psalm 71:7 (Hebrew/osnb)
    { eurBook: 19, eurChapter: 70, eurVerse: 7, hebChapter: 71, hebVerse: 7 },
    // Psalm 127:6 (European/Septuagint) = Psalm 128:6 (Hebrew/osnb)
    { eurBook: 19, eurChapter: 127, eurVerse: 6, hebChapter: 128, hebVerse: 6 },
    // Joel 4:1-5 (Hebrew 4-chapter) = Joel 3:1-5 (Hebrew 3-chapter/osnb)
    ...Array.from({ length: 5 }, (_, i) => ({ eurBook: 29, eurChapter: 4, eurVerse: 1 + i, hebChapter: 3, hebVerse: 1 + i })),
  ];

  let manualAdded = 0;
  for (const s of manualShifts) {
    const eurKey = `${s.eurBook}-${s.eurChapter}-${s.eurVerse}`;
    const hebKey = `${s.eurBook}-${s.hebChapter}-${s.hebVerse}`;
    if (!reverseMapping.has(eurKey) && osnbSet.has(hebKey)) {
      reverseMapping.set(eurKey, hebKey);
      manualAdded++;
    }
  }
  console.log(`  Added ${manualAdded} manual versification shifts`);
  console.log(`  Total reverse mapping: ${reverseMapping.size} entries`);

  // ============================================================
  // Step 4: Source text for each missing position
  // ============================================================

  console.log('Step 4: Sourcing text for missing positions...');

  const additions: Addition[] = [];
  const addedVerses = new Map<string, OutputVerse>();

  // Cache for external chapter reads: "translation/book/chapter" → RawVerse[]
  const chapterCache = new Map<string, RawVerse[] | null>();

  function readExternalChapter(translation: string, bookId: number, chapterId: number): RawVerse[] | null {
    const cacheKey = `${translation}/${bookId}/${chapterId}`;
    if (chapterCache.has(cacheKey)) return chapterCache.get(cacheKey)!;

    const file = join(EXTERNAL_DIR, translation, String(bookId), `${chapterId}.json`);
    let result: RawVerse[] | null = null;
    if (existsSync(file)) {
      try {
        result = JSON.parse(readFileSync(file, 'utf-8'));
      } catch { /* malformed file */ }
    }
    chapterCache.set(cacheKey, result);
    return result;
  }

  function readExternalVerse(translation: string, bookId: number, chapterId: number, verseId: number): string | null {
    const verses = readExternalChapter(translation, bookId, chapterId);
    return verses?.find(v => v.verseId === verseId)?.text ?? null;
  }

  // Verse splits: positions where the content is part of an existing osnb verse.
  // These exist in some traditions that split a single verse into two.
  const verseSplits = new Map<string, { fromChapter: number; fromVerse: number; text: string }>();

  // Num 13:34 — Armenian tradition splits verse 33 (about the Nephilim/Anak's sons)
  verseSplits.set('4-13-34', {
    fromChapter: 13, fromVerse: 33,
    text: 'Der så vi kjempene – Anaks sønner kommer fra kjempene. I våre egne øyne var vi som gresshopper, og slik så vi ut for dem også.',
  });

  // Psalm 13:7 — Septuagint splits verse 6 (second sentence)
  verseSplits.set('19-13-7', {
    fromChapter: 13, fromVerse: 6,
    text: 'Jeg vil synge for Herren, for han har handlet vel mot meg.',
  });

  // Norwegian translations (priority order, modern bokmål first)
  const NORWEGIAN_SOURCES = ['norwegian2007', 'norwegian_bgo', 'norwegian', 'norwegian2018', 'norwegian_elb'];

  // Joel 4:6-21 (Hebrew 4-chapter) = Joel 3:6-21 (European 3-chapter).
  // Norwegian translations use European numbering, so look up Joel 3 for Joel 4 content.
  const joelCrossChapterMap = new Map<string, { lookupChapter: number; lookupVerse: number }>();
  for (let v = 6; v <= 21; v++) {
    joelCrossChapterMap.set(`29-4-${v}`, { lookupChapter: 3, lookupVerse: v });
  }

  let numberingShifts = 0;
  let fromNorwegian = 0;
  let notFound = 0;

  for (const pos of missingPositions) {
    const key = `${pos.bookId}-${pos.chapterId}-${pos.verseId}`;

    // Try 1: Reverse mapping (numbering shift — text exists in osnb under different number)
    const osnbSource = reverseMapping.get(key);
    if (osnbSource) {
      const [sBook, sChapter, sVerse] = osnbSource.split('-').map(Number);
      const chapterVerses = osnbData.get(`${sBook}-${sChapter}`);
      const verse = chapterVerses?.find(v => v.verseId === sVerse);
      if (verse) {
        addedVerses.set(key, {
          bookId: pos.bookId,
          chapterId: pos.chapterId,
          verseId: pos.verseId,
          text: verse.text,
          source: `osnb:${sChapter}:${sVerse}`,
        });
        additions.push({
          ...pos,
          source: `osnb:${sChapter}:${sVerse}`,
          type: 'numbering_shift',
        });
        numberingShifts++;
        continue;
      }
    }

    // Try 2: Verse splits (text is part of an existing osnb verse)
    const split = verseSplits.get(key);
    if (split) {
      addedVerses.set(key, {
        bookId: pos.bookId,
        chapterId: pos.chapterId,
        verseId: pos.verseId,
        text: split.text,
        source: `osnb:${split.fromChapter}:${split.fromVerse}`,
      });
      additions.push({ ...pos, source: `osnb:${split.fromChapter}:${split.fromVerse}`, type: 'numbering_shift' });
      numberingShifts++;
      continue;
    }

    // Try 3: Norwegian external translations
    const crossMap = joelCrossChapterMap.get(key);
    const lookupChapter = crossMap ? crossMap.lookupChapter : pos.chapterId;
    const lookupVerse = crossMap ? crossMap.lookupVerse : pos.verseId;

    let sourced = false;
    for (const trans of NORWEGIAN_SOURCES) {
      const text = readExternalVerse(trans, pos.bookId, lookupChapter, lookupVerse);
      if (text) {
        addedVerses.set(key, {
          bookId: pos.bookId,
          chapterId: pos.chapterId,
          verseId: pos.verseId,
          text,
          source: trans,
        });
        additions.push({ ...pos, source: trans, type: 'missing_content' });
        fromNorwegian++;
        sourced = true;
        break;
      }
    }

    if (!sourced) {
      console.warn(`  WARNING: No Norwegian text found for ${pos.bookId}:${pos.chapterId}:${pos.verseId}`);
      notFound++;
    }
  }

  console.log(`  Sourced: ${numberingShifts} numbering shifts, ${fromNorwegian} Norwegian, ${notFound} not found`);

  // ============================================================
  // Step 5: Build osnb_complete and write files
  // ============================================================

  console.log('Step 5: Writing osnb_complete...');

  const completeData = new Map<string, OutputVerse[]>();

  // Copy all osnb verses (stripping versions field)
  for (const [chapterKey, verses] of osnbData) {
    completeData.set(chapterKey, verses.map(v => ({
      bookId: v.bookId,
      chapterId: v.chapterId,
      verseId: v.verseId,
      text: v.text,
    })));
  }

  // Merge added verses into the chapter arrays
  for (const [key, verse] of addedVerses) {
    const [book, chapter] = key.split('-').map(Number);
    const chapterKey = `${book}-${chapter}`;
    if (!completeData.has(chapterKey)) {
      completeData.set(chapterKey, []);
    }
    completeData.get(chapterKey)!.push(verse);
  }

  // Sort verses within each chapter by verseId
  for (const verses of completeData.values()) {
    verses.sort((a, b) => a.verseId - b.verseId);
  }

  // Write chapter files
  if (existsSync(OUTPUT_DIR)) {
    // Clean existing output
    for (const entry of readdirSync(OUTPUT_DIR, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const bookDir = join(OUTPUT_DIR, entry.name);
        for (const f of readdirSync(bookDir)) {
          const filePath = join(bookDir, f);
          writeFileSync(filePath, ''); // Will be overwritten below
        }
      }
    }
  }
  mkdirSync(OUTPUT_DIR, { recursive: true });

  let totalVerseCount = 0;
  const sortedKeys = [...completeData.keys()].sort((a, b) => {
    const [aBook, aChapter] = a.split('-').map(Number);
    const [bBook, bChapter] = b.split('-').map(Number);
    return aBook !== bBook ? aBook - bBook : aChapter - bChapter;
  });

  for (const chapterKey of sortedKeys) {
    const [book, chapter] = chapterKey.split('-').map(Number);
    const bookDir = join(OUTPUT_DIR, String(book));
    mkdirSync(bookDir, { recursive: true });

    const verses = completeData.get(chapterKey)!;
    totalVerseCount += verses.length;
    writeFileSync(join(bookDir, `${chapter}.json`), JSON.stringify(verses, null, 2));
  }

  console.log(`  Written ${totalVerseCount} verses across ${sortedKeys.length} chapters`);

  // ============================================================
  // Step 6: Write manifest
  // ============================================================

  console.log('Step 6: Writing manifest...');

  const manifest = {
    generatedAt: new Date().toISOString(),
    osnbVerseCount,
    addedVerseCount: additions.length,
    totalVerseCount,
    additions: additions.sort((a, b) => {
      if (a.bookId !== b.bookId) return a.bookId - b.bookId;
      if (a.chapterId !== b.chapterId) return a.chapterId - b.chapterId;
      return a.verseId - b.verseId;
    }),
  };

  writeFileSync(ADDITIONS_FILE, JSON.stringify(manifest, null, 2));
  console.log(`  Written manifest with ${additions.length} additions to ${ADDITIONS_FILE}`);

  // ============================================================
  // Verification summary
  // ============================================================

  console.log('\n=== Summary ===');
  console.log(`  osnb verses:      ${osnbVerseCount}`);
  console.log(`  Added verses:      ${additions.length}`);
  console.log(`  Total verses:      ${totalVerseCount}`);
  console.log(`  Numbering shifts:  ${numberingShifts} (Norwegian from osnb)`);
  console.log(`  Norwegian sources: ${fromNorwegian}`);
  if (notFound > 0) console.log(`  NOT FOUND:         ${notFound}`);

  // Quick verification checks
  const gen3155 = addedVerses.get('1-31-55');
  if (gen3155) console.log(`\n  ✓ Gen 31:55 present (source: ${gen3155.source})`);
  else console.log('\n  ✗ Gen 31:55 MISSING');

  const joel4_1 = addedVerses.get('29-4-1');
  if (joel4_1) console.log(`  ✓ Joel 4:1 present (source: ${joel4_1.source})`);
  else console.log('  ✗ Joel 4:1 MISSING');

  const rom1625 = addedVerses.get('45-16-25');
  if (rom1625) console.log(`  ✓ Rom 16:25 present (source: ${rom1625.source})`);
  else console.log('  ✗ Rom 16:25 MISSING');

  const mal4_1 = addedVerses.get('39-4-1');
  if (mal4_1) console.log(`  ✓ Mal 4:1 present (source: ${mal4_1.source})`);
  else console.log('  ✗ Mal 4:1 MISSING');

  console.log('\nDone.');
}

main();
