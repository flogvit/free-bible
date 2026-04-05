/**
 * Test renumbering fix on multiple chapters using Ollama.
 * Same approach as fix-psalm3-test but generalized.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const OSNB2_DIR = join(import.meta.dirname, '../../generate/bibles_raw/osnb2');
const RAW_DIR = join(import.meta.dirname, '../../external/closed/raw');
const OLLAMA_URL = 'http://localhost:11434/api/generate';
const OLLAMA_MODEL = 'qwen3.5:122b';

interface VerseData {
  bookId: number;
  chapterId: number;
  verseId: number;
  text: string;
  [key: string]: any;
}

function loadChapter(dir: string, book: number, chapter: number): VerseData[] {
  const file = join(dir, String(book), `${chapter}.json`);
  if (!existsSync(file)) return [];
  try { return JSON.parse(readFileSync(file, 'utf-8')); } catch { return []; }
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

// Test cases: diverse renumbering patterns
const testCases = [
  { name: 'Sal 3 (header merge)', book: 19, chapter: 3, refBible: 'english_esv' },
  { name: 'Sal 51 (header merge, 2 extra)', book: 19, chapter: 51, refBible: 'english_esv' },
  { name: 'Sal 34 (header merge)', book: 19, chapter: 34, refBible: 'english_esv' },
  { name: '2 Mos 7 (boundary shift, 4 verses)', book: 2, chapter: 7, refBible: 'english_esv' },
  { name: '1 Mos 32 (boundary shift, 1 verse)', book: 1, chapter: 32, refBible: 'english_esv' },
  { name: '4 Mos 17 (boundary shift, 15 verses)', book: 4, chapter: 17, refBible: 'english_esv' },
  { name: 'Mal 3 (chapter split)', book: 39, chapter: 3, refBible: 'english_esv' },
  { name: '1 Kong 5 (boundary shift, 14 verses)', book: 11, chapter: 5, refBible: 'english_esv' },
];

for (const tc of testCases) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`TEST: ${tc.name}`);
  console.log(`${'='.repeat(60)}`);

  const osnb2 = loadChapter(OSNB2_DIR, tc.book, tc.chapter);
  const ref = loadChapter(join(RAW_DIR, tc.refBible), tc.book, tc.chapter);

  if (osnb2.length === 0) { console.log('  SKIP: no osnb2 data'); continue; }
  if (ref.length === 0) { console.log('  SKIP: no reference data'); continue; }

  console.log(`  osnb2: ${osnb2.length} verses (${osnb2[0].verseId}-${osnb2[osnb2.length-1].verseId})`);
  console.log(`  ref:   ${ref.length} verses (${ref[0].verseId}-${ref[ref.length-1].verseId})`);

  if (osnb2.length === ref.length) {
    console.log('  SKIP: same verse count, no renumbering needed');
    continue;
  }

  // Also load osnb2 adjacent chapters for context
  const osnb2Prev = loadChapter(OSNB2_DIR, tc.book, tc.chapter - 1);
  const osnb2Next = loadChapter(OSNB2_DIR, tc.book, tc.chapter + 1);

  const osnb2Text = osnb2.map(v => `v${v.verseId}: ${v.text}`).join('\n');
  const refText = ref.map(v => `v${v.verseId}: ${v.text}`).join('\n');

  let contextText = '';
  if (osnb2Prev.length > 0) {
    const last3 = osnb2Prev.slice(-3);
    contextText += `\nosnb2 chapter ${tc.chapter - 1} (last 3 verses):\n${last3.map(v => `v${v.verseId}: ${v.text}`).join('\n')}\n`;
  }
  if (osnb2Next.length > 0) {
    const first3 = osnb2Next.slice(0, 3);
    contextText += `\nosnb2 chapter ${tc.chapter + 1} (first 3 verses):\n${first3.map(v => `v${v.verseId}: ${v.text}`).join('\n')}\n`;
  }

  const prompt = `You are mapping Bible verse numbering.

OSNB2 (Hebrew/Tanach numbering, Norwegian text, ${osnb2.length} verses):
${osnb2Text}

REFERENCE (ESV, English, ${ref.length} verses):
${refText}
${contextText}
The target numbering should have ${ref.length} verses (matching the reference structure).
For each target verse number (1-${ref.length}), tell me which osnb2 verse(s) from chapter ${tc.chapter} it corresponds to.
If a target verse combines multiple osnb2 verses, list all of them.
If an osnb2 verse was moved to an adjacent chapter, it may not appear in the mapping — that is fine.

Compare the CONTENT of the verses to determine the mapping. Do not just match by verse number.`;

  try {
    const start = Date.now();
    const result = await askOllama(prompt);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);

    console.log(`  Ollama response (${elapsed}s):`);
    for (const m of result.mappings) {
      const osnb2Refs = m.osnb2Verses.join('+');
      const marker = m.mergeType === 'merged' ? ' *** MERGED ***' : '';
      console.log(`    target v${m.targetVerse} ← osnb2 v${osnb2Refs}${marker}`);
    }

    // Validate: every target verse should be present
    const targetVerses = new Set(result.mappings.map((m: any) => m.targetVerse));
    for (let i = 1; i <= ref.length; i++) {
      if (!targetVerses.has(i)) console.log(`    ⚠ MISSING target v${i}`);
    }

    // Check for osnb2 verses not mapped
    const mappedOsnb2 = new Set(result.mappings.flatMap((m: any) => m.osnb2Verses));
    const unmapped = osnb2.filter(v => !mappedOsnb2.has(v.verseId));
    if (unmapped.length > 0) {
      console.log(`    Unmapped osnb2 verses: [${unmapped.map(v => v.verseId).join(',')}] (moved to adjacent chapter)`);
    }
  } catch (err: any) {
    console.log(`  ERROR: ${err.message}`);
  }
}
