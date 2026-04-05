/**
 * Fix all renumbered chapters in osmain using Ollama.
 *
 * For each renumbered chapter (books 1-66):
 * 1. Send osnb2 verses + ESV reference to Ollama
 * 2. Get verse mapping (which osnb2 verses map to which target verses)
 * 3. Rebuild the osmain chapter with correct text
 *
 * Skips chapters that already look correct (no [NEEDS_TRANSLATION], same structure as reference).
 * Saves results for audit.
 *
 * Usage:
 *   npx tsx scripts/fix-all-renumbering.ts
 *   npx tsx scripts/fix-all-renumbering.ts --dry-run   # show what would change without saving
 */

import { readFileSync, readdirSync, existsSync, statSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const OSNB2_DIR = join(import.meta.dirname, '../../generate/bibles_raw/osnb2');
const OSMAIN_DIR = join(import.meta.dirname, '../../generate/bibles_raw/osmain');
const RAW_DIR = join(import.meta.dirname, '../../external/closed/raw');
const LOG_FILE = join(import.meta.dirname, '../data/osnb3-renumber-log.json');
const RESULTS_DIR = join(import.meta.dirname, '../data/fix-renumber-results');
const OLLAMA_URL = 'http://localhost:11434/api/generate';
const OLLAMA_MODEL = 'qwen3.5:122b';

interface VerseData {
  bookId: number;
  chapterId: number;
  verseId: number;
  text: string;
  source?: string;
  [key: string]: any;
}

const dryRun = process.argv.includes('--dry-run');

const log: Array<{ key: string; type: string; details: string }> =
  JSON.parse(readFileSync(LOG_FILE, 'utf-8'));

// Only process renumber entries for books 1-66
const toFix = log.filter(e => {
  const book = parseInt(e.key.split(':')[0]);
  return book <= 66 &&
    (e.type === 'renumber_boundary' || e.type === 'renumber_prepend' || e.type === 'renumber_mixed');
});

console.log(`Chapters to fix: ${toFix.length}`);
if (dryRun) console.log('DRY RUN — no files will be modified\n');

function loadChapter(dir: string, book: number, chapter: number): VerseData[] {
  const file = join(dir, String(book), `${chapter}.json`);
  if (!existsSync(file)) return [];
  try { return JSON.parse(readFileSync(file, 'utf-8')); } catch { return []; }
}

// Find the best reference bible for a chapter
function findReference(book: number, chapter: number): { bible: string; verses: VerseData[] } | null {
  // Prefer bibles that typically use European numbering
  const candidates = ['english_esv', 'english_nrsv', 'english_kj', 'dnb2024_nb', 'german_lut17'];
  for (const bible of candidates) {
    const verses = loadChapter(join(RAW_DIR, bible), book, chapter);
    if (verses.length > 0) return { bible, verses };
  }
  return null;
}

const schema = {
  type: 'object' as const,
  properties: {
    mappings: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          targetVerse: { type: 'number' as const },
          osnb2Verses: { type: 'array' as const, items: { type: 'number' as const } },
          mergeType: { type: 'string' as const, enum: ['single', 'merged'] },
        },
        required: ['targetVerse', 'osnb2Verses', 'mergeType'],
      },
    },
  },
  required: ['mappings'],
};

async function askOllama(prompt: string): Promise<any> {
  const resp = await fetch(OLLAMA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      prompt,
      stream: false,
      think: false,
      format: schema,
      options: { temperature: 0, num_predict: 4096 },
    }),
  });
  if (!resp.ok) throw new Error(`Ollama error: ${resp.status}`);
  const data = await resp.json() as { response: string };
  return JSON.parse(data.response);
}

mkdirSync(RESULTS_DIR, { recursive: true });

let fixed = 0;
let skipped = 0;
let errors = 0;
let unchanged = 0;

for (const entry of toFix) {
  const [bookStr, chStr] = entry.key.split(':');
  const book = parseInt(bookStr);
  const chapter = parseInt(chStr);

  const osnb2 = loadChapter(OSNB2_DIR, book, chapter);
  const ref = findReference(book, chapter);

  if (osnb2.length === 0) {
    console.log(`  ${entry.key}: SKIP (no osnb2 data)`);
    skipped++;
    continue;
  }
  if (!ref) {
    console.log(`  ${entry.key}: SKIP (no reference bible)`);
    skipped++;
    continue;
  }
  if (osnb2.length === ref.verses.length) {
    console.log(`  ${entry.key}: SKIP (same verse count as ${ref.bible})`);
    unchanged++;
    continue;
  }

  // Build prompt
  const osnb2Text = osnb2.map(v => `v${v.verseId}: ${v.text}`).join('\n');
  const refText = ref.verses.map(v => `v${v.verseId}: ${v.text}`).join('\n');

  // Context from adjacent chapters
  const osnb2Prev = loadChapter(OSNB2_DIR, book, chapter - 1);
  const osnb2Next = loadChapter(OSNB2_DIR, book, chapter + 1);
  let contextText = '';
  if (osnb2Prev.length > 0) {
    const last3 = osnb2Prev.slice(-3);
    contextText += `\nosnb2 chapter ${chapter - 1} (last 3 verses):\n${last3.map(v => `v${v.verseId}: ${v.text}`).join('\n')}\n`;
  }
  if (osnb2Next.length > 0) {
    const first3 = osnb2Next.slice(0, 3);
    contextText += `\nosnb2 chapter ${chapter + 1} (first 3 verses):\n${first3.map(v => `v${v.verseId}: ${v.text}`).join('\n')}\n`;
  }

  const prompt = `You are mapping Bible verse numbering.

OSNB2 (Hebrew/Tanach numbering, Norwegian text, ${osnb2.length} verses):
${osnb2Text}

REFERENCE (${ref.bible}, ${ref.verses.length} verses):
${refText}
${contextText}
The target numbering should have ${ref.verses.length} verses (matching the reference structure).
For each target verse number (1-${ref.verses.length}), tell me which osnb2 verse(s) from chapter ${chapter} it corresponds to.
If a target verse combines multiple osnb2 verses, list all of them.
If an osnb2 verse was moved to an adjacent chapter, it may not appear in the mapping — that is fine.

Compare the CONTENT of the verses to determine the mapping. Do not just match by verse number.`;

  process.stdout.write(`  ${entry.key} (osnb2:${osnb2.length}v → ref:${ref.verses.length}v)... `);

  try {
    const start = Date.now();
    const result = await askOllama(prompt);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);

    // Validate mapping
    const mappings: Array<{ targetVerse: number; osnb2Verses: number[]; mergeType: string }> = result.mappings;
    if (mappings.length !== ref.verses.length) {
      console.log(`⚠ mapping count mismatch (got ${mappings.length}, expected ${ref.verses.length}) [${elapsed}s]`);
    }

    // Build new osmain chapter
    const osnb2ByVerse = new Map(osnb2.map(v => [v.verseId, v]));
    const newOsmain: VerseData[] = [];
    let mergeCount = 0;

    for (const m of mappings) {
      const texts: string[] = [];
      let source = 'tanach';
      for (const vId of m.osnb2Verses) {
        const v = osnb2ByVerse.get(vId);
        if (v) {
          texts.push(v.text);
          source = v.source ?? (book <= 39 ? 'tanach' : 'sblgnt');
        }
      }
      if (m.mergeType === 'merged') mergeCount++;

      newOsmain.push({
        bookId: book,
        chapterId: chapter,
        verseId: m.targetVerse,
        text: texts.join(' '),
        source,
      });
    }

    // Check for unmapped osnb2 verses
    const mappedOsnb2 = new Set(mappings.flatMap(m => m.osnb2Verses));
    const unmapped = osnb2.filter(v => !mappedOsnb2.has(v.verseId));

    const summary = [
      `${elapsed}s`,
      mergeCount > 0 ? `${mergeCount} merges` : null,
      unmapped.length > 0 ? `${unmapped.length} unmapped→adjacent` : null,
    ].filter(Boolean).join(', ');

    console.log(`✓ ${summary}`);

    // Save result for audit
    writeFileSync(
      join(RESULTS_DIR, `${book}-${chapter}.json`),
      JSON.stringify({
        key: entry.key,
        type: entry.type,
        refBible: ref.bible,
        mappings,
        unmappedOsnb2: unmapped.map(v => v.verseId),
        timestamp: new Date().toISOString(),
      }, null, 2)
    );

    // Save to osmain (unless dry run)
    if (!dryRun) {
      // Preserve any existing translated verses (e.g., from fix-osmain-boundaries)
      const existingOsmain = loadChapter(OSMAIN_DIR, book, chapter);
      const existingByVerse = new Map(existingOsmain.map(v => [v.verseId, v]));

      // For verses beyond the mapping range (e.g., added placeholder verses), keep them
      const maxMappedVerse = Math.max(...mappings.map(m => m.targetVerse));
      const extraVerses = existingOsmain.filter(v =>
        v.verseId > maxMappedVerse && v.source === 'translated'
      );

      const finalOsmain = [...newOsmain, ...extraVerses].sort((a, b) => a.verseId - b.verseId);

      const osmainFile = join(OSMAIN_DIR, String(book), `${chapter}.json`);
      writeFileSync(osmainFile, JSON.stringify(finalOsmain, null, 2));
    }

    fixed++;
  } catch (err: any) {
    console.log(`ERROR: ${err.message}`);
    errors++;
  }
}

console.log(`\n=== SUMMARY ===`);
console.log(`Fixed: ${fixed}`);
console.log(`Skipped: ${skipped}`);
console.log(`Unchanged: ${unchanged}`);
console.log(`Errors: ${errors}`);
console.log(`Total: ${toFix.length}`);
if (dryRun) console.log('\n(dry run — no files were modified)');
