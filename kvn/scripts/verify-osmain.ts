/**
 * Verify osmain coverage against all raw bibles.
 *
 * For each chapter where a bible has different verse counts than osmain,
 * send both to Ollama to determine:
 * 1. Which osmain verses match which bible verses
 * 2. Whether the bible has content that osmain is missing
 * 3. Whether osmain renumbering is correct
 *
 * Starts with a quick scan to find chapters that need verification,
 * then processes them through Ollama one at a time.
 *
 * Usage:
 *   bun scripts/verify-osmain.ts                    # scan only, show what needs work
 *   bun scripts/verify-osmain.ts --verify           # run Ollama verification
 *   bun scripts/verify-osmain.ts --verify --bible english_esv  # verify one bible
 *   bun scripts/verify-osmain.ts --verify --chapter 19:3       # verify one chapter
 */

import { readFileSync, readdirSync, existsSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';

const OSMAIN_DIR = join(import.meta.dirname, '../../generate/bibles_raw/osmain');
const RAW_DIR = join(import.meta.dirname, '../../external/closed/raw');
const RESULTS_DIR = join(import.meta.dirname, '../data/verify-results');
const OLLAMA_URL = 'http://localhost:11434/api/generate';
const OLLAMA_MODEL = 'qwen3.5:27b';

interface VerseData {
  bookId: number;
  chapterId: number;
  verseId: number;
  text: string;
}

// Parse args
const args = process.argv.slice(2);
const doVerify = args.includes('--verify');
const bibleFilter = args.includes('--bible') ? args[args.indexOf('--bible') + 1] : null;
const chapterFilter = args.includes('--chapter') ? args[args.indexOf('--chapter') + 1] : null;

// === Load osmain structure ===
function loadChapter(dir: string, book: number, chapter: number): VerseData[] {
  const file = join(dir, String(book), `${chapter}.json`);
  if (!existsSync(file)) return [];
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return [];
  }
}

function loadStructure(dir: string): Map<string, number[]> {
  const result = new Map<string, number[]>();
  if (!existsSync(dir)) return result;

  const bookDirs = readdirSync(dir)
    .filter(d => /^\d+$/.test(d) && statSync(join(dir, d)).isDirectory());

  for (const bookStr of bookDirs) {
    const bookDir = join(dir, bookStr);
    const files = readdirSync(bookDir).filter(f => f.endsWith('.json'));
    for (const f of files) {
      const ch = parseInt(f.replace('.json', ''));
      try {
        const data: VerseData[] = JSON.parse(readFileSync(join(bookDir, f), 'utf-8'));
        result.set(`${bookStr}:${ch}`, data.map(v => v.verseId).sort((a, b) => a - b));
      } catch { /* skip */ }
    }
  }
  return result;
}

// === Ollama call ===
async function askOllama(prompt: string): Promise<string> {
  const resp = await fetch(OLLAMA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      prompt,
      stream: false,
      options: { temperature: 0.1, num_predict: 4096 },
    }),
  });

  if (!resp.ok) throw new Error(`Ollama error: ${resp.status}`);
  const data = await resp.json() as { response: string };
  return data.response;
}

// === Scan for differences ===
console.log('Loading osmain...');
const osmainStructure = loadStructure(OSMAIN_DIR);
console.log(`osmain: ${osmainStructure.size} chapters`);

// Find chapters that differ between osmain and raw bibles
interface DiffEntry {
  bible: string;
  key: string;
  book: number;
  chapter: number;
  osmainVerseCount: number;
  bibleVerseCount: number;
  osmainMax: number;
  bibleMax: number;
  missingInOsmain: number[]; // verse IDs in bible but not osmain
  extraInOsmain: number[];   // verse IDs in osmain but not bible
}

const diffs: DiffEntry[] = [];

// Use a representative sample for scanning (diverse traditions)
const sampleBibles = bibleFilter ? [bibleFilter] : [
  'english_esv', 'english_kj', 'english_nrsv', 'english_niv',
  'dnb2011_nb', 'dnb2024_nb', 'norwegian', 'nb88_nb',
  'latin_clementine', 'latin_nova_vulgata',
  'german_lut17', 'german_schlachter2000',
  'french_s21', 'french_jerusalem',
  'russian_synodal',
  'greek_sblgnt', 'hebrew',
  'spanish_rvr1960', 'italian_cei2008',
  'swedish', 'danish', 'dutch', 'finnish',
];

console.log(`Scanning ${sampleBibles.length} bibles for differences...`);

for (const bible of sampleBibles) {
  const bibleDir = join(RAW_DIR, bible);
  if (!existsSync(bibleDir)) continue;

  const bibleStructure = loadStructure(bibleDir);

  for (const [key, bibleVerseIds] of bibleStructure) {
    if (chapterFilter && key !== chapterFilter) continue;

    const osmainVerseIds = osmainStructure.get(key);

    if (!osmainVerseIds) {
      // Chapter doesn't exist in osmain at all
      diffs.push({
        bible, key,
        book: parseInt(key.split(':')[0]),
        chapter: parseInt(key.split(':')[1]),
        osmainVerseCount: 0,
        bibleVerseCount: bibleVerseIds.length,
        osmainMax: 0,
        bibleMax: bibleVerseIds[bibleVerseIds.length - 1],
        missingInOsmain: bibleVerseIds,
        extraInOsmain: [],
      });
      continue;
    }

    const osmainSet = new Set(osmainVerseIds);
    const bibleSet = new Set(bibleVerseIds);

    const missingInOsmain = bibleVerseIds.filter(v => !osmainSet.has(v));
    const extraInOsmain = osmainVerseIds.filter(v => !bibleSet.has(v));

    if (missingInOsmain.length > 0) {
      diffs.push({
        bible, key,
        book: parseInt(key.split(':')[0]),
        chapter: parseInt(key.split(':')[1]),
        osmainVerseCount: osmainVerseIds.length,
        bibleVerseCount: bibleVerseIds.length,
        osmainMax: osmainVerseIds[osmainVerseIds.length - 1],
        bibleMax: bibleVerseIds[bibleVerseIds.length - 1],
        missingInOsmain,
        extraInOsmain,
      });
    }
  }
}

// Deduplicate: group by chapter, collect all bibles that report the same missing verses
const byChapter = new Map<string, { bibles: string[]; missingVerses: Set<number> }>();
for (const diff of diffs) {
  if (!byChapter.has(diff.key)) {
    byChapter.set(diff.key, { bibles: [], missingVerses: new Set() });
  }
  const entry = byChapter.get(diff.key)!;
  entry.bibles.push(diff.bible);
  for (const v of diff.missingInOsmain) entry.missingVerses.add(v);
}

console.log(`\n=== CHAPTERS WITH VERSES MISSING FROM OSMAIN ===`);
console.log(`Total: ${byChapter.size} chapters\n`);

const sortedEntries = [...byChapter.entries()].sort((a, b) => {
  const [ab, ac] = a[0].split(':').map(Number);
  const [bb, bc] = b[0].split(':').map(Number);
  return ab - bb || ac - bc;
});

for (const [key, { bibles, missingVerses }] of sortedEntries) {
  const missing = [...missingVerses].sort((a, b) => a - b);
  const osmainVerses = osmainStructure.get(key);
  const osmainCount = osmainVerses?.length ?? 0;
  console.log(`  ${key}: missing [${missing.join(',')}] (osmain has ${osmainCount}v, ${bibles.length} bibles report this)`);
}

// Count NEEDS_TRANSLATION in osmain
let needsTranslation = 0;
let needsReview = 0;
for (const [key, verseIds] of osmainStructure) {
  const [bookStr, chStr] = key.split(':');
  const verses = loadChapter(OSMAIN_DIR, parseInt(bookStr), parseInt(chStr));
  for (const v of verses) {
    if (v.text.includes('[NEEDS_TRANSLATION]')) needsTranslation++;
    if (v.text.includes('[MISSING')) needsReview++;
  }
}

console.log(`\n=== OSMAIN STATUS ===`);
console.log(`Total chapters: ${osmainStructure.size}`);
console.log(`Chapters with missing verses: ${byChapter.size}`);
console.log(`Verses needing translation: ${needsTranslation}`);
console.log(`Verses needing review: ${needsReview}`);

if (!doVerify) {
  console.log('\nRun with --verify to process through Ollama');
  process.exit(0);
}

// === Ollama verification ===
console.log('\n=== STARTING OLLAMA VERIFICATION ===\n');

// Create results directory
if (!existsSync(RESULTS_DIR)) {
  const { mkdirSync } = await import('fs');
  mkdirSync(RESULTS_DIR, { recursive: true });
}

let processed = 0;
let versesMissing = 0;

for (const [key, { bibles, missingVerses }] of sortedEntries) {
  const [bookStr, chStr] = key.split(':');
  const book = parseInt(bookStr);
  const chapter = parseInt(chStr);

  // Load osmain chapter
  const osmainVerses = loadChapter(OSMAIN_DIR, book, chapter);

  // Load a representative bible that has the extra verses
  const representativeBible = bibles[0];
  const bibleVerses = loadChapter(join(RAW_DIR, representativeBible), book, chapter);

  if (osmainVerses.length === 0 || bibleVerses.length === 0) continue;

  // Build prompt
  const osmainText = osmainVerses
    .map(v => `  v${v.verseId}: ${v.text.slice(0, 200)}`)
    .join('\n');

  const bibleText = bibleVerses
    .map(v => `  v${v.verseId}: ${v.text.slice(0, 200)}`)
    .join('\n');

  const missing = [...missingVerses].sort((a, b) => a - b);

  const prompt = `/no_think
You are comparing Bible verse numbering between two versions.

OSMAIN (Norwegian master text, ${osmainVerses.length} verses):
${osmainText}

BIBLE: ${representativeBible} (${bibleVerses.length} verses):
${bibleText}

The bible has verses [${missing.join(',')}] that osmain does not have.

Analyze:
1. Are these genuinely new verses with content not covered by osmain?
2. Or is this just a numbering difference where the same content exists in osmain under different verse numbers?
3. For each missing verse, what is the situation?

Reply in JSON format:
{
  "chapter": "${key}",
  "analysis": [
    {
      "bibleVerse": <number>,
      "status": "missing_content" | "renumbered" | "merged",
      "osmainVerse": <number or null>,
      "explanation": "<brief explanation>"
    }
  ],
  "versesToAdd": [<list of verse numbers that have genuinely new content not in osmain>],
  "renumberingCorrect": <true if osmain's numbering looks correct, false if it needs fixing>,
  "renumberingIssue": "<explanation if renumberingCorrect is false, null otherwise>"
}

Only JSON, no other text.`;

  console.log(`Processing ${key} (${bibles.length} bibles, missing [${missing.join(',')}])...`);

  try {
    const response = await askOllama(prompt);

    // Try to extract JSON from response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);

      // Save result
      const resultFile = join(RESULTS_DIR, `${book}-${chapter}.json`);
      writeFileSync(resultFile, JSON.stringify({
        key,
        bibles,
        missingVerses: missing,
        ollamaResult: result,
        timestamp: new Date().toISOString(),
      }, null, 2));

      // Report
      const toAdd = result.versesToAdd ?? [];
      const renumOk = result.renumberingCorrect ?? true;

      if (toAdd.length > 0) {
        console.log(`  → ${toAdd.length} verses to add: [${toAdd.join(',')}]`);
        versesMissing += toAdd.length;
      }
      if (!renumOk) {
        console.log(`  → RENUMBERING ISSUE: ${result.renumberingIssue}`);
      }
      if (toAdd.length === 0 && renumOk) {
        console.log(`  → OK (numbering difference only)`);
      }
    } else {
      console.log(`  → Could not parse Ollama response`);
      const resultFile = join(RESULTS_DIR, `${book}-${chapter}.raw.txt`);
      writeFileSync(resultFile, response);
    }
  } catch (err: any) {
    console.error(`  → Error: ${err.message}`);
  }

  processed++;
}

console.log(`\n=== VERIFICATION COMPLETE ===`);
console.log(`Chapters processed: ${processed}`);
console.log(`Additional verses needed: ${versesMissing}`);
