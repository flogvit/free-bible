/**
 * Fix osmain boundary-shift placeholders by copying text from osnb.
 *
 * Pattern: create-osnb3.ts dropped verses from the end of chapter N
 * (renumber_boundary) and added placeholders at the end of chapter N+1
 * (add_verses). The dropped verses ARE the placeholders — just under
 * different verse numbers.
 *
 * This script:
 * 1. Pairs boundary drops with add_verses in adjacent chapters
 * 2. Copies the text from the dropped osnb verses into the placeholders
 * 3. Reports new chapters that genuinely need translation (books 1-66)
 */

import { readFileSync, readdirSync, existsSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';

const OSNB_DIR = join(import.meta.dirname, '../../generate/bibles_raw/osnb');
const OSMAIN_DIR = join(import.meta.dirname, '../../generate/bibles_raw/osmain');
const RAW_DIR = join(import.meta.dirname, '../../external/closed/raw');
const LOG_FILE = join(import.meta.dirname, '../data/osnb3-renumber-log.json');

interface VerseData {
  bookId: number;
  chapterId: number;
  verseId: number;
  text: string;
  [key: string]: any;
}

const log: Array<{ key: string; type: string; details: string }> = JSON.parse(readFileSync(LOG_FILE, 'utf-8'));

// === Step 1: Pair boundary drops with add_verses ===

const boundaryDrops = log.filter(e => e.type === 'renumber_boundary' && parseInt(e.key.split(':')[0]) <= 66);
const addVerses = log.filter(e => e.type === 'add_verses' && parseInt(e.key.split(':')[0]) <= 66);

// Parse verse lists from details
function parseVerseList(details: string): number[] {
  const match = details.match(/\[([0-9,]+)\]/);
  if (!match) return [];
  return match[1].split(',').map(Number);
}

let fixed = 0;
let notPaired = 0;

for (const drop of boundaryDrops) {
  const [bookStr, chStr] = drop.key.split(':');
  const book = parseInt(bookStr);
  const chapter = parseInt(chStr);
  const droppedVerses = parseVerseList(drop.details);

  if (droppedVerses.length === 0) continue;

  // Look for matching add_verses in adjacent chapters
  // The dropped verses from chapter N should fill placeholders in chapter N+1
  // (or sometimes N-1, depending on direction)
  const nextKey = `${book}:${chapter + 1}`;
  const prevKey = `${book}:${chapter - 1}`;

  const addEntry = addVerses.find(a => a.key === nextKey) || addVerses.find(a => a.key === prevKey);

  if (!addEntry) {
    console.log(`  No matching add_verses for boundary drop ${drop.key}: [${droppedVerses.join(',')}]`);
    notPaired++;
    continue;
  }

  const addedVerseIds = parseVerseList(addEntry.details);
  const targetChapter = parseInt(addEntry.key.split(':')[1]);

  if (droppedVerses.length !== addedVerseIds.length) {
    console.log(`  Mismatch: ${drop.key} dropped ${droppedVerses.length} but ${addEntry.key} added ${addedVerseIds.length}`);
    // Still try to pair what we can
  }

  // Load the osnb source chapter to get the dropped verse texts
  const osnbFile = join(OSNB_DIR, String(book), `${chapter}.json`);
  if (!existsSync(osnbFile)) {
    console.log(`  osnb file not found: ${osnbFile}`);
    continue;
  }
  const osnbVerses: VerseData[] = JSON.parse(readFileSync(osnbFile, 'utf-8'));
  const osnbByVerse = new Map(osnbVerses.map(v => [v.verseId, v]));

  // Load the osmain target chapter
  const osmainFile = join(OSMAIN_DIR, String(book), `${targetChapter}.json`);
  if (!existsSync(osmainFile)) {
    console.log(`  osmain file not found: ${osmainFile}`);
    continue;
  }
  const osmainVerses: VerseData[] = JSON.parse(readFileSync(osmainFile, 'utf-8'));

  // Pair and fill
  const pairCount = Math.min(droppedVerses.length, addedVerseIds.length);
  let chapterFixed = 0;

  for (let i = 0; i < pairCount; i++) {
    const droppedVerseId = droppedVerses[i];
    const targetVerseId = addedVerseIds[i];

    const source = osnbByVerse.get(droppedVerseId);
    if (!source) {
      console.log(`  Source verse not found: osnb ${book}:${chapter}:${droppedVerseId}`);
      continue;
    }

    // Find and update the placeholder in osmain
    const target = osmainVerses.find(v => v.verseId === targetVerseId);
    if (!target) {
      console.log(`  Target placeholder not found: osmain ${book}:${targetChapter}:${targetVerseId}`);
      continue;
    }

    if (target.text === '[NEEDS_TRANSLATION]') {
      target.text = source.text;
      // Copy versions if present
      if (source.versions) (target as any).versions = source.versions;
      // Remove _samples if present
      delete (target as any)._samples;
      chapterFixed++;
      fixed++;
    }
  }

  if (chapterFixed > 0) {
    writeFileSync(osmainFile, JSON.stringify(osmainVerses, null, 2));
    console.log(`  ✓ ${drop.key} → ${addEntry.key}: filled ${chapterFixed} verses from osnb`);
  }
}

// === Step 2: Report remaining NEEDS_TRANSLATION ===

let remainingPlaceholders = 0;
const remainingByChapter: Array<{ key: string; count: number; verseIds: number[] }> = [];

const allBooks = readdirSync(OSMAIN_DIR)
  .filter(d => /^\d+$/.test(d) && parseInt(d) <= 66 && statSync(join(OSMAIN_DIR, d)).isDirectory())
  .sort((a, b) => parseInt(a) - parseInt(b));

for (const bookStr of allBooks) {
  const bookDir = join(OSMAIN_DIR, bookStr);
  const files = readdirSync(bookDir).filter(f => f.endsWith('.json'));

  for (const f of files) {
    const chapter = parseInt(f.replace('.json', ''));
    const verses: VerseData[] = JSON.parse(readFileSync(join(bookDir, f), 'utf-8'));
    const placeholders = verses.filter(v => v.text === '[NEEDS_TRANSLATION]');

    if (placeholders.length > 0) {
      remainingPlaceholders += placeholders.length;
      remainingByChapter.push({
        key: `${bookStr}:${chapter}`,
        count: placeholders.length,
        verseIds: placeholders.map(v => v.verseId),
      });
    }
  }
}

console.log(`\n=== RESULTS ===`);
console.log(`Boundary verses filled: ${fixed}`);
console.log(`Boundary drops not paired: ${notPaired}`);
console.log(`Remaining [NEEDS_TRANSLATION] in books 1-66: ${remainingPlaceholders}`);

if (remainingByChapter.length > 0) {
  console.log(`\n=== REMAINING PLACEHOLDERS (books 1-66) ===`);
  for (const entry of remainingByChapter) {
    console.log(`  ${entry.key}: ${entry.count} verses [${entry.verseIds.join(',')}]`);
  }

  // For remaining, show which translations have them
  console.log(`\n=== TRANSLATION COVERAGE FOR REMAINING VERSES ===`);
  const sampleBibles = ['english_esv', 'english_kj', 'english_nrsv', 'dnb2011_nb', 'dnb2024_nb',
    'latin_clementine', 'latin_nova_vulgata', 'german_lut17', 'french_s21', 'russian_synodal'];

  for (const entry of remainingByChapter) {
    const [bookStr, chStr] = entry.key.split(':');
    const book = parseInt(bookStr);
    const chapter = parseInt(chStr);

    const coverage: string[] = [];
    for (const bible of sampleBibles) {
      const file = join(RAW_DIR, bible, String(book), `${chapter}.json`);
      if (!existsSync(file)) continue;
      try {
        const data: VerseData[] = JSON.parse(readFileSync(file, 'utf-8'));
        const has = entry.verseIds.every(v => data.some(d => d.verseId === v));
        if (has) coverage.push(bible);
      } catch { /* skip */ }
    }
    console.log(`  ${entry.key}: found in [${coverage.join(', ')}]`);
  }
}
