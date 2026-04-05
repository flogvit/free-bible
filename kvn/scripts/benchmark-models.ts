/**
 * Benchmark Ollama models for verse matching quality and speed.
 * Tests each model on a few known cases and compares results.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const OSMAIN_DIR = join(import.meta.dirname, '../../generate/bibles_raw/osmain');
const RAW_DIR = join(import.meta.dirname, '../../external/closed/raw');
const OLLAMA_URL = 'http://localhost:11434/api/generate';

interface VerseData {
  bookId: number;
  chapterId: number;
  verseId: number;
  text: string;
}

function loadChapter(dir: string, book: number, chapter: number): VerseData[] {
  const file = join(dir, String(book), `${chapter}.json`);
  if (!existsSync(file)) return [];
  return JSON.parse(readFileSync(file, 'utf-8'));
}

const responseSchema = {
  type: 'object' as const,
  properties: {
    bibleVerse: { type: 'number' as const },
    status: { type: 'string' as const, enum: ['missing_content', 'renumbered', 'merged'] },
    osmainVerse: { type: ['number', 'null'] as const },
    explanation: { type: 'string' as const },
  },
  required: ['bibleVerse', 'status', 'osmainVerse', 'explanation'],
};

async function askOllama(model: string, prompt: string): Promise<{ response: string; durationMs: number }> {
  const start = Date.now();
  const resp = await fetch(OLLAMA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      think: false,
      format: responseSchema,
      options: { temperature: 0, num_predict: 2048 },
    }),
  });

  if (!resp.ok) throw new Error(`Ollama error: ${resp.status} for model ${model}`);
  const data = await resp.json() as { response: string };
  return { response: data.response, durationMs: Date.now() - start };
}

// Test cases with known correct answers
const testCases = [
  {
    name: 'Psalm 3 (header shift) - Hebrew',
    book: 19, chapter: 3,
    bible: 'hebrew',
    missingVerse: 9,
    expectedAnswer: 'renumbered',
  },
  {
    name: '2 Mos 7 (chapter boundary) - Hebrew',
    book: 2, chapter: 7,
    bible: 'hebrew',
    missingVerse: 29,
    expectedAnswer: 'renumbered',
  },
  {
    name: 'Mal 3 (chapter split) - Hebrew',
    book: 39, chapter: 3,
    bible: 'hebrew',
    missingVerse: 24,
    expectedAnswer: 'renumbered',
  },
];

function buildPrompt(osmainVerses: VerseData[], bibleVerses: VerseData[], missingVerse: number, bibleName: string): string {
  const osmainText = osmainVerses
    .map(v => `  v${v.verseId}: ${v.text.slice(0, 150)}`)
    .join('\n');

  const bibleText = bibleVerses
    .map(v => `  v${v.verseId}: ${v.text.slice(0, 150)}`)
    .join('\n');

  return `/no_think
You are comparing Bible verse numbering between two versions.

OSMAIN (Norwegian master text, ${osmainVerses.length} verses):
${osmainText}

BIBLE: ${bibleName} (${bibleVerses.length} verses):
${bibleText}

The bible has verse ${missingVerse} that osmain does not have.

Is this genuinely missing content, or just a numbering difference where the content already exists in osmain under a different verse number?

Reply in JSON only:
{
  "bibleVerse": ${missingVerse},
  "status": "missing_content" | "renumbered" | "merged",
  "osmainVerse": <matching osmain verse number or null>,
  "explanation": "<brief explanation>"
}`;
}

// Get available models
const tagsResp = await fetch('http://localhost:11434/api/tags');
const tags = await tagsResp.json() as { models: Array<{ name: string }> };
// Filter to only test specific models, or all
const modelsArg = process.argv.find(a => a.startsWith('--models='));
const models = modelsArg
  ? modelsArg.split('=')[1].split(',')
  : tags.models.map(m => m.name);

console.log(`Available models: ${models.join(', ')}\n`);

// Run benchmarks
for (const tc of testCases) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`TEST: ${tc.name}`);
  console.log(`Expected: ${tc.expectedAnswer}`);
  console.log(`${'='.repeat(60)}`);

  const osmainVerses = loadChapter(OSMAIN_DIR, tc.book, tc.chapter);
  const bibleVerses = loadChapter(join(RAW_DIR, tc.bible), tc.book, tc.chapter);

  if (osmainVerses.length === 0 || bibleVerses.length === 0) {
    console.log('  SKIP: missing data');
    continue;
  }

  const prompt = buildPrompt(osmainVerses, bibleVerses, tc.missingVerse, tc.bible);

  for (const model of models) {
    process.stdout.write(`  ${model.padEnd(20)}`);

    try {
      const { response, durationMs } = await askOllama(model, prompt);

      // Try to parse JSON
      const jsonMatch = response.match(/\{[\s\S]*?\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        const correct = result.status === tc.expectedAnswer;
        console.log(
          `${(durationMs / 1000).toFixed(1)}s | ` +
          `status=${result.status} | ` +
          `osmainVerse=${result.osmainVerse} | ` +
          `${correct ? '✓ CORRECT' : '✗ WRONG'} | ` +
          `${(result.explanation ?? '').slice(0, 80)}`
        );
      } else {
        console.log(`${(durationMs / 1000).toFixed(1)}s | PARSE ERROR: ${response.slice(0, 100)}`);
      }
    } catch (err: any) {
      console.log(`ERROR: ${err.message}`);
    }
  }
}
