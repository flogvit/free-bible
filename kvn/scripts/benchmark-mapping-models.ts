/**
 * Benchmark all local Ollama models on the mapping task.
 *
 * Tests each model on a few chapters with known correct mappings.
 * Measures: speed, JSON compliance, mapping accuracy.
 *
 * Usage:
 *   bun scripts/benchmark-mapping-models.ts
 *   bun scripts/benchmark-mapping-models.ts --models qwen3.5:122b,gemma4:31b
 *   bun scripts/benchmark-mapping-models.ts --warmup   # warmup each model first
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const OSMAIN_DIR = join(import.meta.dirname, '../../generate/bibles_raw/osmain');
const TXT_DIR = join(import.meta.dirname, '../../external/closed');
const OLLAMA_URL = 'http://localhost:11434/api/generate';

interface VerseData {
  bookId: number;
  chapterId: number;
  verseId: number;
  text: string;
  [key: string]: any;
}

const args = process.argv.slice(2);
const doWarmup = args.includes('--warmup');
const modelsArg = args.find(a => a.startsWith('--models='));

function loadChapter(dir: string, book: number, chapter: number): VerseData[] {
  const file = join(dir, String(book), `${chapter}.json`);
  if (!existsSync(file)) return [];
  try { return JSON.parse(readFileSync(file, 'utf-8')); } catch { return []; }
}

// Load DNB2011 chapter from txt
function loadDnb2011Chapter(book: number, chapter: number): VerseData[] {
  const content = readFileSync(join(TXT_DIR, 'dnb2011_nb.txt'), 'utf-8');
  const BOOK_IDS: Record<string, number> = {
    '1 Mos': 1, '2 Mos': 2, '3 Mos': 3, '4 Mos': 4, '5 Mos': 5,
    'Jos': 6, 'Dom': 7, 'Rut': 8, '1 Sam': 9, '2 Sam': 10,
    '1 Kong': 11, '2 Kong': 12, '1 Krøn': 13, '2 Krøn': 14,
    'Esra': 15, 'Neh': 16, 'Est': 17, 'Job': 18, 'Sal': 19,
    'Ordsp': 20, 'Fork': 21, 'Høys': 22, 'Høgs': 22, 'Jes': 23, 'Jer': 24,
    'Klag': 25, 'Esek': 26, 'Dan': 27, 'Hos': 28, 'Joel': 29,
    'Am': 30, 'Ob': 31, 'Jona': 32, 'Mi': 33, 'Nah': 34,
    'Hab': 35, 'Sef': 36, 'Hag': 37, 'Sak': 38, 'Mal': 39,
    'Matt': 40, 'Mark': 41, 'Luk': 42, 'Joh': 43, 'Apg': 44,
    'Rom': 45, '1 Kor': 46, '2 Kor': 47, 'Gal': 48, 'Ef': 49,
    'Fil': 50, 'Flp': 50, 'Kol': 51, '1 Tess': 52, '2 Tess': 53,
    '1 Tim': 54, '2 Tim': 55, 'Tit': 56, 'Filem': 57, 'Hebr': 58,
    'Jak': 59, '1 Pet': 60, '2 Pet': 61, '1 Joh': 62, '2 Joh': 63,
    '3 Joh': 64, 'Jud': 65, 'Åp': 66,
  };
  const result: VerseData[] = [];
  for (const line of content.split('\n')) {
    const match = line.match(/^(.+?)\s+(\d+),(\d+)\s+(.+)$/);
    if (!match) continue;
    const bookId = BOOK_IDS[match[1]];
    const ch = parseInt(match[2]);
    const v = parseInt(match[3]);
    if (bookId === book && ch === chapter) {
      result.push({ bookId, chapterId: ch, verseId: v, text: match[4].trim() });
    }
  }
  return result;
}

const ollamaSchema = {
  type: 'object' as const,
  properties: {
    mappings: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          translationVerse: { type: 'number' as const },
          osmainVerses: { type: 'array' as const, items: { type: 'number' as const } },
          matchType: { type: 'string' as const, enum: ['exact', 'partial', 'merged', 'split', 'extra_content', 'missing'] },
          note: { type: 'string' as const },
        },
        required: ['translationVerse', 'osmainVerses', 'matchType'],
      },
    },
    extraContent: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          translationVerse: { type: 'number' as const },
          description: { type: 'string' as const },
        },
        required: ['translationVerse', 'description'],
      },
    },
  },
  required: ['mappings', 'extraContent'],
};

async function askOllama(model: string, prompt: string): Promise<{ result: any; durationMs: number }> {
  const start = Date.now();
  const resp = await fetch(OLLAMA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      think: false,
      format: ollamaSchema,
      options: { temperature: 0, num_predict: 4096 },
    }),
  });
  if (!resp.ok) throw new Error(`Ollama error: ${resp.status}`);
  const data = await resp.json() as { response: string };
  return { result: JSON.parse(data.response), durationMs: Date.now() - start };
}

async function warmup(model: string): Promise<void> {
  process.stdout.write(`  Warming up ${model}... `);
  const start = Date.now();
  await fetch(OLLAMA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt: 'Hello',
      stream: false,
      think: false,
      options: { num_predict: 5 },
    }),
  });
  console.log(`${((Date.now() - start) / 1000).toFixed(1)}s`);
}

// Test cases with expected results
const testCases = [
  {
    name: 'Sal 3 (header split, 8→9 verses)',
    book: 19, chapter: 3,
    expected: {
      mappingCount: 9,
      // DNB2011 v1 should map to osmain v1 (partial — just the header)
      // DNB2011 v2 should map to osmain v1 (partial — the prayer)
      // DNB2011 v3-9 should map to osmain v2-8
      keyCheck: (mappings: any[]) => {
        const v1 = mappings.find((m: any) => m.translationVerse === 1);
        const v2 = mappings.find((m: any) => m.translationVerse === 2);
        const v9 = mappings.find((m: any) => m.translationVerse === 9);
        return v1?.osmainVerses?.includes(1) &&
               v2?.osmainVerses?.includes(1) &&
               v9?.osmainVerses?.includes(8);
      },
    },
  },
  {
    name: 'Sal 23 (identity, same numbering)',
    book: 19, chapter: 23,
    expected: {
      mappingCount: 6,
      keyCheck: (mappings: any[]) => {
        // All should be exact 1:1
        return mappings.every((m: any) =>
          m.osmainVerses.length === 1 &&
          m.osmainVerses[0] === m.translationVerse &&
          m.matchType === 'exact'
        );
      },
    },
  },
  {
    name: '1 Mos 1 (identity, 31 verses)',
    book: 1, chapter: 1,
    expected: {
      mappingCount: 31,
      keyCheck: (mappings: any[]) => {
        return mappings.length === 31 &&
               mappings.every((m: any) => m.matchType === 'exact');
      },
    },
  },
];

// Get available models
const tagsResp = await fetch('http://localhost:11434/api/tags');
const tags = await tagsResp.json() as { models: Array<{ name: string }> };
const allModels = tags.models.map(m => m.name);
const models = modelsArg ? modelsArg.split('=')[1].split(',') : allModels;

console.log(`Available models: ${allModels.join(', ')}`);
console.log(`Testing: ${models.join(', ')}\n`);

// Run benchmarks — one model at a time to avoid memory issues
const results: Array<{
  model: string;
  test: string;
  durationMs: number;
  jsonOk: boolean;
  mappingCount: number;
  keyCheckOk: boolean;
  error?: string;
}> = [];

// Pre-build prompts
const prompts: Array<{ tc: typeof testCases[0]; prompt: string; osmain: VerseData[]; trans: VerseData[] }> = [];
for (const tc of testCases) {
  const osmain = loadChapter(OSMAIN_DIR, tc.book, tc.chapter);
  const trans = loadDnb2011Chapter(tc.book, tc.chapter);
  if (osmain.length === 0 || trans.length === 0) continue;

  const osmainText = osmain.map(v => `v${v.verseId}: ${v.text.slice(0, 200)}`).join('\n');
  const transText = trans.map(v => `v${v.verseId}: ${v.text.slice(0, 200)}`).join('\n');

  const prompt = `You are mapping Bible verse numbering between two translations.

OSMAIN (Norwegian master text, ${osmain.length} verses, book ${tc.book} chapter ${tc.chapter}):
${osmainText}

TRANSLATION: dnb2011_nb (${trans.length} verses):
${transText}

For each verse in the TRANSLATION, find the matching osmain verse(s).
Compare the CONTENT to determine the mapping, not just verse numbers.

Match types:
- "exact": same content, possibly different verse number
- "partial": translation has only part of the osmain verse
- "merged": translation verse combines multiple osmain verses
- "split": translation verse is part of a split osmain verse
- "extra_content": translation verse has MORE text than the osmain verse
- "missing": translation verse has no match in osmain

If a translation verse contains text NOT in any osmain verse, report it in extraContent.`;

  prompts.push({ tc, prompt, osmain, trans });
}

for (const model of models) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`MODEL: ${model}`);
  console.log(`${'='.repeat(60)}`);

  // Warmup this model
  if (doWarmup) {
    await warmup(model);
  }

  for (const { tc, prompt } of prompts) {
    process.stdout.write(`  ${tc.name.padEnd(40)} `);

    try {
      const { result, durationMs } = await askOllama(model, prompt);
      const mappings = result.mappings ?? [];
      const keyCheckOk = tc.expected.keyCheck(mappings);

      const status = keyCheckOk ? '✓' : '✗';
      const extras = result.extraContent?.length > 0 ? ` +${result.extraContent.length}extra` : '';
      console.log(`${(durationMs / 1000).toFixed(1)}s | ${mappings.length} mappings | ${status}${extras}`);

      if (!keyCheckOk) {
        for (const m of mappings.slice(0, 3)) {
          console.log(`      trans v${m.translationVerse} ← osmain ${JSON.stringify(m.osmainVerses)} [${m.matchType}]`);
        }
        if (mappings.length > 3) console.log(`      ... (${mappings.length - 3} more)`);
      }

      results.push({
        model, test: tc.name, durationMs,
        jsonOk: true, mappingCount: mappings.length,
        keyCheckOk,
      });
    } catch (err: any) {
      console.log(`ERROR: ${err.message.slice(0, 60)}`);
      results.push({
        model, test: tc.name, durationMs: 0,
        jsonOk: false, mappingCount: 0, keyCheckOk: false,
        error: err.message,
      });
    }
  }
}

// Summary table
console.log(`${'='.repeat(60)}`);
console.log('SUMMARY');
console.log(`${'='.repeat(60)}`);
console.log(`${'Model'.padEnd(20)} ${'Avg Time'.padEnd(10)} ${'JSON OK'.padEnd(10)} ${'Accuracy'.padEnd(10)}`);

for (const model of models) {
  const modelResults = results.filter(r => r.model === model);
  const avgTime = modelResults.reduce((s, r) => s + r.durationMs, 0) / modelResults.length / 1000;
  const jsonOk = modelResults.filter(r => r.jsonOk).length;
  const accurate = modelResults.filter(r => r.keyCheckOk).length;
  console.log(
    `${model.padEnd(20)} ${avgTime.toFixed(1).padEnd(10)}s ${(jsonOk + '/' + modelResults.length).padEnd(10)} ${(accurate + '/' + modelResults.length).padEnd(10)}`
  );
}
