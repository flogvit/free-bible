/**
 * Analyze whether verse splits across translations align with sentence boundaries.
 *
 * Finds cases where:
 * - One translation has 1 verse but another has 2+ at the same position
 * - Then checks if the merged text has punctuation (., !, ?, ;, :) where the split occurs
 *
 * This tells us if a simple sentence-splitting algorithm can handle verse splits.
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join } from 'path';

const RAW_DIR = join(import.meta.dirname, '../../external/closed/raw');

interface VerseData {
  bookId: number;
  chapterId: number;
  verseId: number;
  text: string;
}

// Step 1: Find chapters where verse counts differ across translations
// Step 2: For those chapters, find where splits/merges happen
// Step 3: Check if the text has sentence boundaries at split points

// First, identify the most common verse structure per chapter (the "majority")
// Then find translations that deviate

type ChapterKey = string; // "bookId:chapterId"

// Collect verse structures per chapter across a sample of diverse bibles
const sampleBibles = [
  'hebrew', 'original_hebrew', 'english_esv', 'english_kj', 'english_nrsv',
  'english_nasb', 'english_niv', 'english_nkj', 'english_berean',
  'dnb2011_nb', 'dnb2024_nb', 'norwegian', 'nb88_nb',
  'latin_clementine', 'latin_nova_vulgata',
  'german_lut17', 'german', 'german_schlachter2000',
  'french_s21', 'french', 'french_jerusalem',
  'russian_synodal', 'russian_rst',
  'spanish', 'spanish_rvr1960',
  'italian', 'italian_cei2008',
  'portuguese', 'portuguese_almeida1753',
  'swedish', 'danish', 'dutch', 'finnish',
  'greek_sblgnt', 'greek',
  'korean', 'chinese_union_simp', 'japanese',
];

interface ChapterData {
  bible: string;
  verses: VerseData[];
  verseCount: number;
  maxVerseId: number;
}

const chaptersByKey = new Map<ChapterKey, ChapterData[]>();

console.log('Loading sample bibles...');
let loaded = 0;

for (const bible of sampleBibles) {
  const bibleDir = join(RAW_DIR, bible);
  if (!existsSync(bibleDir)) continue;
  loaded++;

  const bookDirs = readdirSync(bibleDir).filter(d => {
    const full = join(bibleDir, d);
    return /^\d+$/.test(d) && statSync(full).isDirectory();
  });

  for (const bookStr of bookDirs) {
    const bookId = parseInt(bookStr);
    const bookDir = join(bibleDir, bookStr);
    const chapterFiles = readdirSync(bookDir).filter(f => f.endsWith('.json'));

    for (const chFile of chapterFiles) {
      const chapterId = parseInt(chFile.replace('.json', ''));
      const key: ChapterKey = `${bookId}:${chapterId}`;

      try {
        const verses: VerseData[] = JSON.parse(readFileSync(join(bookDir, chFile), 'utf-8'));
        if (!verses.length) continue;

        const data: ChapterData = {
          bible,
          verses,
          verseCount: verses.length,
          maxVerseId: Math.max(...verses.map(v => v.verseId)),
        };

        if (!chaptersByKey.has(key)) chaptersByKey.set(key, []);
        chaptersByKey.get(key)!.push(data);
      } catch {
        // skip
      }
    }
  }
}

console.log(`Loaded ${loaded} bibles\n`);

// Find chapters where translations disagree on verse count
// Focus on cases where the difference is small (1-3 verses) — these are the split/merge cases
// Large differences (like Joel 3 having 5 vs 26 verses) are chapter-level shifts, not verse splits

const splitCases: {
  key: string;
  fewer: ChapterData;
  more: ChapterData;
  diff: number;
}[] = [];

for (const [key, chapters] of chaptersByKey) {
  if (chapters.length < 2) continue;

  // Find min and max verse count
  const sorted = [...chapters].sort((a, b) => a.maxVerseId - b.maxVerseId);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const diff = max.maxVerseId - min.maxVerseId;

  // Only interested in small differences (verse splits, not chapter shifts)
  if (diff >= 1 && diff <= 5) {
    splitCases.push({ key, fewer: min, more: max, diff });
  }
}

console.log(`Found ${splitCases.length} chapters with small verse count differences (1-5)\n`);

// Analyze sentence boundaries at split points
const SENTENCE_ENDINGS = /[.!?;:]\s*$/;
const SENTENCE_BOUNDARIES = /[.!?;:،。！？；：]\s/;

let totalSplitPoints = 0;
let splitPointsWithPunctuation = 0;
let splitPointsWithoutPunctuation = 0;
const problemCases: {
  key: string;
  fewerBible: string;
  moreBible: string;
  fewerVerseId: number;
  fewerText: string;
  moreTexts: string[];
}[] = [];

for (const { key, fewer, more } of splitCases) {
  // Find verse IDs that exist in 'more' but not in 'fewer' (or where fewer has combined them)
  const fewerVerseIds = new Set(fewer.verses.map(v => v.verseId));
  const moreVerseIds = new Set(more.verses.map(v => v.verseId));

  // Look for cases where 'fewer' has verse N but 'more' has verse N and N+1
  // (meaning 'fewer' merged N and N+1)
  for (const fewerVerse of fewer.verses) {
    const vid = fewerVerse.verseId;
    // Check if 'more' has this verse AND the next one, while 'fewer' doesn't have the next
    if (moreVerseIds.has(vid) && moreVerseIds.has(vid + 1) && !fewerVerseIds.has(vid + 1)) {
      totalSplitPoints++;

      // The 'fewer' bible has these two verses merged into one
      // Check if the merged text has a sentence boundary in the middle
      const mergedText = fewerVerse.text;

      // Get the split texts from 'more'
      const moreVerse1 = more.verses.find(v => v.verseId === vid);
      const moreVerse2 = more.verses.find(v => v.verseId === vid + 1);

      if (!moreVerse1 || !moreVerse2) continue;

      // Check if the first part ends with sentence-ending punctuation
      // This is a proxy for whether we can split the merged text
      const firstPartEndsWithPunctuation = SENTENCE_ENDINGS.test(moreVerse1.text.trim());

      // Also check if the merged text has internal sentence boundaries
      const hasBoundaryInMerged = SENTENCE_BOUNDARIES.test(mergedText);

      if (firstPartEndsWithPunctuation || hasBoundaryInMerged) {
        splitPointsWithPunctuation++;
      } else {
        splitPointsWithoutPunctuation++;
        if (problemCases.length < 50) {
          problemCases.push({
            key,
            fewerBible: fewer.bible,
            moreBible: more.bible,
            fewerVerseId: vid,
            fewerText: mergedText,
            moreTexts: [moreVerse1.text, moreVerse2.text],
          });
        }
      }
    }
  }
}

console.log('=== SENTENCE SPLIT ANALYSIS ===');
console.log(`Total split points analyzed: ${totalSplitPoints}`);
console.log(`With punctuation at boundary: ${splitPointsWithPunctuation} (${totalSplitPoints > 0 ? Math.round(100 * splitPointsWithPunctuation / totalSplitPoints) : 0}%)`);
console.log(`WITHOUT punctuation at boundary: ${splitPointsWithoutPunctuation} (${totalSplitPoints > 0 ? Math.round(100 * splitPointsWithoutPunctuation / totalSplitPoints) : 0}%)`);

if (problemCases.length > 0) {
  console.log(`\n=== PROBLEM CASES (no punctuation at split point) ===`);
  for (const pc of problemCases.slice(0, 30)) {
    console.log(`\n${pc.key} (${pc.fewerBible} vs ${pc.moreBible}):`);
    console.log(`  Merged (${pc.fewerBible} v${pc.fewerVerseId}): "${pc.fewerText.slice(0, 120)}${pc.fewerText.length > 120 ? '...' : ''}"`);
    console.log(`  Split 1 (${pc.moreBible}): "${pc.moreTexts[0].slice(0, 80)}${pc.moreTexts[0].length > 80 ? '...' : ''}"`);
    console.log(`  Split 2 (${pc.moreBible}): "${pc.moreTexts[1].slice(0, 80)}${pc.moreTexts[1].length > 80 ? '...' : ''}"`);
  }
}

// Also check: how many sentences do verses typically have?
console.log('\n=== SENTENCE COUNT DISTRIBUTION ===');
const sentenceCounts = new Map<number, number>();
let totalVerses = 0;

// Sample from a few bibles
for (const bible of ['english_esv', 'dnb2011_nb', 'german_lut17']) {
  const bibleDir = join(RAW_DIR, bible);
  if (!existsSync(bibleDir)) continue;

  const bookDirs = readdirSync(bibleDir).filter(d => {
    const full = join(bibleDir, d);
    return /^\d+$/.test(d) && statSync(full).isDirectory();
  });

  for (const bookStr of bookDirs) {
    const bookDir = join(bibleDir, bookStr);
    const chapterFiles = readdirSync(bookDir).filter(f => f.endsWith('.json'));

    for (const chFile of chapterFiles) {
      try {
        const verses: VerseData[] = JSON.parse(readFileSync(join(bookDir, chFile), 'utf-8'));
        for (const v of verses) {
          // Count sentences by splitting on sentence-ending punctuation
          const sentences = v.text.split(/[.!?]+\s/).filter(s => s.trim().length > 0);
          const count = Math.max(1, sentences.length);
          sentenceCounts.set(count, (sentenceCounts.get(count) ?? 0) + 1);
          totalVerses++;
        }
      } catch {
        // skip
      }
    }
  }
}

console.log(`Sampled ${totalVerses} verses from 3 bibles:`);
const sortedCounts = [...sentenceCounts.entries()].sort((a, b) => a[0] - b[0]);
for (const [count, freq] of sortedCounts) {
  const pct = (100 * freq / totalVerses).toFixed(1);
  console.log(`  ${count} sentence(s): ${freq} verses (${pct}%)`);
}

// Check if 15 parts is enough
const maxSentences = Math.max(...sentenceCounts.keys());
console.log(`\nMax sentences in a single verse: ${maxSentences}`);
console.log(`Part field max (4 bits): 15`);
console.log(`Sufficient: ${maxSentences <= 15 ? 'YES' : 'NO — need more bits!'}`);
