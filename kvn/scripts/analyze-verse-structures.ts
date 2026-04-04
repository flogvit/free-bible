/**
 * Analyze verse structures across all 1147+ Bible translations.
 *
 * Scans external/closed/raw/ and generate/bibles_raw/ to build a comprehensive
 * report of verse numbering traditions, chapter counts, verse gaps, and outliers.
 *
 * Output: kvn/data/verse-structure-report.json
 * Run:    npx tsx kvn/scripts/analyze-verse-structures.ts
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '../..');
const RAW_DIR = join(PROJECT_ROOT, 'external/closed/raw');
const GENERATE_DIR = join(PROJECT_ROOT, 'generate/bibles_raw');
const OUTPUT_DIR = join(__dirname, '../data');
const OUTPUT_FILE = join(OUTPUT_DIR, 'verse-structure-report.json');

// --- Types ---

interface ChapterInfo {
  verseCount: number;
  maxVerseId: number;
  minVerseId: number;
  missingVerses: number[];
}

interface BookInfo {
  chapterCount: number;
  chapters: Record<number, ChapterInfo>;
}

interface TranslationFingerprint {
  name: string;
  source: 'raw' | 'generate';
  bookCount: number;
  isNTOnly: boolean;
  tradition: string;
  books: Record<number, BookInfo>;
}

interface TraditionInfo {
  id: string;
  count: number;
  translations: string[];
  features: Record<string, string>;
}

interface ChapterReport {
  translationsWithChapter: number;
  maxVerseDistribution: Record<number, number>;
  dominantMaxVerse: number;
  commonMissingVerses: { verseId: number; missingIn: number; presentIn: number }[];
}

interface BookReport {
  bookId: number;
  translationsWithBook: number;
  chapterCountDistribution: Record<number, number>;
  dominantChapterCount: number;
  chapters: Record<number, ChapterReport>;
}

interface VerseStructureReport {
  generatedAt: string;
  translationCount: number;
  traditions: TraditionInfo[];
  books: Record<number, BookReport>;
  outliers: { name: string; reason: string }[];
}

interface RawVerse {
  bookId: number;
  chapterId: number;
  verseId: number;
  text: string;
}

// --- Helpers ---

function scanTranslation(baseDir: string, name: string): TranslationFingerprint | null {
  const translationDir = join(baseDir, name);
  if (!existsSync(translationDir)) return null;

  const books: Record<number, BookInfo> = {};
  let bookCount = 0;

  // Scan book directories (1-79 to catch deuterocanonical)
  const entries = readdirSync(translationDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const bookId = parseInt(entry.name);
    if (isNaN(bookId) || bookId < 1 || bookId > 79) continue;

    const bookDir = join(translationDir, entry.name);
    const chapterFiles = readdirSync(bookDir).filter(f => f.endsWith('.json'));
    if (chapterFiles.length === 0) continue;

    bookCount++;
    const chapters: Record<number, ChapterInfo> = {};

    for (const file of chapterFiles) {
      const chapterId = parseInt(file.replace('.json', ''));
      if (isNaN(chapterId)) continue;

      try {
        const raw = readFileSync(join(bookDir, file), 'utf-8');
        const verses: RawVerse[] = JSON.parse(raw);
        if (!Array.isArray(verses) || verses.length === 0) continue;

        const verseIds = verses.map(v => v.verseId).sort((a, b) => a - b);
        const minVerseId = verseIds[0];
        const maxVerseId = verseIds[verseIds.length - 1];

        // Find missing verses in the range
        const verseSet = new Set(verseIds);
        const missingVerses: number[] = [];
        for (let v = minVerseId; v <= maxVerseId; v++) {
          if (!verseSet.has(v)) missingVerses.push(v);
        }

        chapters[chapterId] = {
          verseCount: verses.length,
          maxVerseId,
          minVerseId,
          missingVerses,
        };
      } catch {
        // Skip malformed files
      }
    }

    if (Object.keys(chapters).length > 0) {
      books[bookId] = {
        chapterCount: Object.keys(chapters).length,
        chapters,
      };
    }
  }

  if (bookCount === 0) return null;

  const bookIds = Object.keys(books).map(Number);
  const isNTOnly = bookIds.every(id => id >= 40);

  return {
    name,
    source: baseDir === RAW_DIR ? 'raw' : 'generate',
    bookCount,
    isNTOnly,
    tradition: '', // classified later
    books,
  };
}

function classifyTradition(fp: TranslationFingerprint): string {
  if (fp.isNTOnly) return 'nt_only';

  const joel = fp.books[29];
  const mal = fp.books[39];

  // Not enough data to classify
  if (!joel && !mal) {
    // Check if it's a partial OT
    const otBooks = Object.keys(fp.books).map(Number).filter(id => id <= 39);
    if (otBooks.length === 0) return 'nt_only';
    return 'unclassifiable';
  }

  let joelType: 'hebrew_4ch' | 'hebrew_3ch' | 'european' | 'unknown' = 'unknown';
  let malType: 'hebrew' | 'european' | 'unknown' = 'unknown';

  if (joel) {
    if (joel.chapterCount === 4) {
      joelType = 'hebrew_4ch';
    } else if (joel.chapterCount === 3) {
      const ch2 = joel.chapters[2];
      if (ch2) {
        if (ch2.maxVerseId <= 27) {
          joelType = 'hebrew_3ch'; // 3 chapters but kap2 has ≤27 verses (split into ch3)
        } else if (ch2.maxVerseId >= 28) {
          joelType = 'european'; // 3 chapters, kap2 has 28+ verses (merged)
        }
      }
    }
  }

  if (mal) {
    if (mal.chapterCount === 3) {
      malType = 'hebrew';
    } else if (mal.chapterCount === 4) {
      malType = 'european';
    }
  }

  const isJoelHebrew = joelType === 'hebrew_4ch' || joelType === 'hebrew_3ch';

  // Classify based on combination
  if (isJoelHebrew && malType === 'hebrew') return 'hebrew';
  if (joelType === 'european' && malType === 'european') return 'european';
  if (isJoelHebrew && malType === 'european') return 'mixed_joel_heb_mal_eur';
  if (joelType === 'european' && malType === 'hebrew') return 'mixed_joel_eur_mal_heb';

  // One is unknown
  if (joelType === 'unknown' && malType === 'hebrew') return 'hebrew';
  if (joelType === 'unknown' && malType === 'european') return 'european';
  if (malType === 'unknown' && isJoelHebrew) return 'hebrew';
  if (malType === 'unknown' && joelType === 'european') return 'european';

  return 'unclassifiable';
}

// --- Main ---

async function main() {
  console.log('=== Bible Verse Structure Analyzer ===\n');

  // Collect all translation names
  const translations: { name: string; dir: string }[] = [];

  if (existsSync(RAW_DIR)) {
    const rawEntries = readdirSync(RAW_DIR, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => ({ name: e.name, dir: RAW_DIR }));
    translations.push(...rawEntries);
    console.log(`Found ${rawEntries.length} translations in external/closed/raw/`);
  }

  if (existsSync(GENERATE_DIR)) {
    const genEntries = readdirSync(GENERATE_DIR, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => ({ name: e.name, dir: GENERATE_DIR }));
    translations.push(...genEntries);
    console.log(`Found ${genEntries.length} translations in generate/bibles_raw/`);
  }

  console.log(`Total: ${translations.length} translations to scan\n`);

  // Scan all translations
  const fingerprints: TranslationFingerprint[] = [];
  const startTime = Date.now();
  let scanned = 0;
  const progressInterval = Math.max(1, Math.floor(translations.length / 20));

  for (const t of translations) {
    const fp = scanTranslation(t.dir, t.name);
    if (fp) {
      fp.tradition = classifyTradition(fp);
      fingerprints.push(fp);
    }
    scanned++;
    if (scanned % progressInterval === 0 || scanned === translations.length) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const pct = ((scanned / translations.length) * 100).toFixed(0);
      process.stdout.write(`\rScanning: ${scanned}/${translations.length} (${pct}%) - ${elapsed}s`);
    }
  }
  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nScanned ${fingerprints.length} valid translations in ${totalTime}s\n`);

  // --- Build report ---

  // 1. Tradition classification
  const traditionMap = new Map<string, TranslationFingerprint[]>();
  for (const fp of fingerprints) {
    const list = traditionMap.get(fp.tradition) || [];
    list.push(fp);
    traditionMap.set(fp.tradition, list);
  }

  const traditions: TraditionInfo[] = [];
  for (const [id, fps] of [...traditionMap.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const features: Record<string, string> = {};

    // Summarize key features from first full-bible translation
    const sample = fps.find(f => !f.isNTOnly && f.books[29] && f.books[39]);
    if (sample) {
      const joel = sample.books[29];
      const mal = sample.books[39];
      if (joel) {
        features['joel_chapters'] = String(joel.chapterCount);
        if (joel.chapters[2]) {
          features['joel_ch2_max_verse'] = String(joel.chapters[2].maxVerseId);
        }
      }
      if (mal) {
        features['mal_chapters'] = String(mal.chapterCount);
      }
    }

    traditions.push({
      id,
      count: fps.length,
      translations: fps.map(f => f.name).sort(),
      features,
    });
  }

  // 2. Per-book analysis
  const bookReports: Record<number, BookReport> = {};

  // Determine all books across all translations
  const allBookIds = new Set<number>();
  for (const fp of fingerprints) {
    for (const bookId of Object.keys(fp.books).map(Number)) {
      allBookIds.add(bookId);
    }
  }

  for (const bookId of [...allBookIds].sort((a, b) => a - b)) {
    const fpsWithBook = fingerprints.filter(fp => fp.books[bookId]);
    if (fpsWithBook.length === 0) continue;

    // Chapter count distribution
    const chapterCountDist: Record<number, number> = {};
    for (const fp of fpsWithBook) {
      const cc = fp.books[bookId].chapterCount;
      chapterCountDist[cc] = (chapterCountDist[cc] || 0) + 1;
    }
    const dominantChapterCount = Number(
      Object.entries(chapterCountDist).sort((a, b) => b[1] - a[1])[0][0]
    );

    // Per-chapter analysis
    const allChapterIds = new Set<number>();
    for (const fp of fpsWithBook) {
      for (const ch of Object.keys(fp.books[bookId].chapters).map(Number)) {
        allChapterIds.add(ch);
      }
    }

    const chapterReports: Record<number, ChapterReport> = {};

    for (const chapterId of [...allChapterIds].sort((a, b) => a - b)) {
      const fpsWithChapter = fpsWithBook.filter(
        fp => fp.books[bookId].chapters[chapterId]
      );
      if (fpsWithChapter.length === 0) continue;

      // Max verse distribution
      const maxVerseDist: Record<number, number> = {};
      for (const fp of fpsWithChapter) {
        const mv = fp.books[bookId].chapters[chapterId].maxVerseId;
        maxVerseDist[mv] = (maxVerseDist[mv] || 0) + 1;
      }
      const dominantMaxVerse = Number(
        Object.entries(maxVerseDist).sort((a, b) => b[1] - a[1])[0][0]
      );

      // Common missing verses
      // Collect all verse IDs that exist in at least one translation
      const versePresence = new Map<number, { present: number; missing: number }>();
      for (const fp of fpsWithChapter) {
        const ch = fp.books[bookId].chapters[chapterId];
        // Track all verse IDs from min to max across all translations
        const maxAcross = Math.max(dominantMaxVerse, ch.maxVerseId);
        for (let v = 1; v <= maxAcross; v++) {
          if (!versePresence.has(v)) {
            versePresence.set(v, { present: 0, missing: 0 });
          }
        }
        // Mark presence/absence
        const verseSet = new Set<number>();
        for (let v = ch.minVerseId; v <= ch.maxVerseId; v++) {
          if (!ch.missingVerses.includes(v)) verseSet.add(v);
        }
        for (const [v, counts] of versePresence) {
          if (v >= ch.minVerseId && v <= ch.maxVerseId) {
            if (verseSet.has(v)) counts.present++;
            else counts.missing++;
          }
        }
      }

      // Only report verses that are missing in a significant number but present in others
      const commonMissing: { verseId: number; missingIn: number; presentIn: number }[] = [];
      for (const [verseId, counts] of [...versePresence.entries()].sort((a, b) => a[0] - b[0])) {
        if (counts.missing >= 5 && counts.present >= 5) {
          commonMissing.push({
            verseId,
            missingIn: counts.missing,
            presentIn: counts.present,
          });
        }
      }

      chapterReports[chapterId] = {
        translationsWithChapter: fpsWithChapter.length,
        maxVerseDistribution: maxVerseDist,
        dominantMaxVerse,
        commonMissingVerses: commonMissing,
      };
    }

    bookReports[bookId] = {
      bookId,
      translationsWithBook: fpsWithBook.length,
      chapterCountDistribution: chapterCountDist,
      dominantChapterCount,
      chapters: chapterReports,
    };
  }

  // 3. Outlier detection
  const outliers: { name: string; reason: string }[] = [];
  for (const fp of fingerprints) {
    // Very few books
    if (fp.bookCount <= 3 && !fp.isNTOnly) {
      outliers.push({ name: fp.name, reason: `Only ${fp.bookCount} books (not NT-only)` });
      continue;
    }
    // Check for severely incomplete books
    for (const [bookIdStr, book] of Object.entries(fp.books)) {
      const bookId = Number(bookIdStr);
      const expected = bookReports[bookId]?.dominantChapterCount;
      if (expected && book.chapterCount < expected * 0.5) {
        outliers.push({
          name: fp.name,
          reason: `Book ${bookId}: ${book.chapterCount} chapters (expected ~${expected})`,
        });
      }
    }
  }

  // Deduplicate outliers per name
  const uniqueOutliers = new Map<string, string[]>();
  for (const o of outliers) {
    const reasons = uniqueOutliers.get(o.name) || [];
    reasons.push(o.reason);
    uniqueOutliers.set(o.name, reasons);
  }
  const outlierList = [...uniqueOutliers.entries()]
    .map(([name, reasons]) => ({ name, reason: reasons.join('; ') }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // --- Build final report ---
  const report: VerseStructureReport = {
    generatedAt: new Date().toISOString(),
    translationCount: fingerprints.length,
    traditions,
    books: bookReports,
    outliers: outlierList,
  };

  // Write report
  if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(OUTPUT_FILE, JSON.stringify(report, null, 2));
  console.log(`Report written to ${OUTPUT_FILE}\n`);

  // --- Console summary ---
  console.log('=== SUMMARY ===\n');

  console.log(`Total translations: ${fingerprints.length}`);
  console.log(`Total books found: ${allBookIds.size}\n`);

  console.log('--- Traditions ---');
  for (const t of traditions) {
    const featureStr = Object.entries(t.features)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ');
    console.log(`  ${t.id}: ${t.count} translations${featureStr ? ` (${featureStr})` : ''}`);
  }

  console.log('\n--- Books with chapter count variation ---');
  for (const [bookIdStr, book] of Object.entries(bookReports)) {
    const dist = book.chapterCountDistribution;
    if (Object.keys(dist).length > 1) {
      const distStr = Object.entries(dist)
        .sort((a, b) => b[1] - a[1])
        .map(([ch, count]) => `${ch}ch:${count}`)
        .join(', ');
      console.log(`  Book ${bookIdStr}: ${distStr}`);
    }
  }

  console.log('\n--- Common verse gaps (NT text variants) ---');
  const allGaps: { ref: string; missingIn: number; presentIn: number }[] = [];
  for (const [bookIdStr, book] of Object.entries(bookReports)) {
    for (const [chStr, ch] of Object.entries(book.chapters)) {
      for (const gap of ch.commonMissingVerses) {
        allGaps.push({
          ref: `${bookIdStr}:${chStr}:${gap.verseId}`,
          missingIn: gap.missingIn,
          presentIn: gap.presentIn,
        });
      }
    }
  }
  allGaps
    .sort((a, b) => b.missingIn - a.missingIn)
    .slice(0, 30)
    .forEach(g => {
      console.log(`  ${g.ref} - missing in ${g.missingIn}, present in ${g.presentIn}`);
    });

  console.log(`\n--- Outliers: ${outlierList.length} ---`);
  outlierList.slice(0, 20).forEach(o => {
    console.log(`  ${o.name}: ${o.reason}`);
  });
  if (outlierList.length > 20) {
    console.log(`  ... and ${outlierList.length - 20} more`);
  }

  // Joel details
  const joel = bookReports[29];
  if (joel) {
    console.log('\n--- Joel details ---');
    const distStr = Object.entries(joel.chapterCountDistribution)
      .sort((a, b) => b[1] - a[1])
      .map(([ch, count]) => `${ch}ch:${count}`)
      .join(', ');
    console.log(`  Chapter count distribution: ${distStr}`);
    if (joel.chapters[2]) {
      const mvDist = Object.entries(joel.chapters[2].maxVerseDistribution)
        .sort((a, b) => b[1] - a[1])
        .map(([mv, count]) => `${mv}v:${count}`)
        .join(', ');
      console.log(`  Chapter 2 max verse distribution: ${mvDist}`);
    }
  }

  // Malachi details
  const mal = bookReports[39];
  if (mal) {
    console.log('\n--- Malachi details ---');
    const distStr = Object.entries(mal.chapterCountDistribution)
      .sort((a, b) => b[1] - a[1])
      .map(([ch, count]) => `${ch}ch:${count}`)
      .join(', ');
    console.log(`  Chapter count distribution: ${distStr}`);
  }

  console.log(`\nDone in ${totalTime}s`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
