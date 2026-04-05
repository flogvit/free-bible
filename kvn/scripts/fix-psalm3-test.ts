/**
 * Test: Fix Psalm 3 renumbering using Ollama.
 *
 * Send osnb2 verses + a reference bible (ESV) to Ollama.
 * Ask it to map each ESV verse to the matching osnb2 verse(s).
 * Use the mapping to rebuild osmain with correct renumbering.
 */

import { readFileSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';

const OSNB2_DIR = join(import.meta.dirname, '../../generate/bibles_raw/osnb2');
const OSMAIN_DIR = join(import.meta.dirname, '../../generate/bibles_raw/osmain');
const RAW_DIR = join(import.meta.dirname, '../../external/closed/raw');
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

function loadChapter(dir: string, book: number, chapter: number): VerseData[] {
  const file = join(dir, String(book), `${chapter}.json`);
  if (!existsSync(file)) return [];
  return JSON.parse(readFileSync(file, 'utf-8'));
}

// Load data
const osnb2 = loadChapter(OSNB2_DIR, 19, 3);
const esv = loadChapter(join(RAW_DIR, 'english_esv'), 19, 3);
const dnb2011Lines = readFileSync(join(import.meta.dirname, '../../external/closed/dnb2011_nb.txt'), 'utf-8')
  .split('\n')
  .filter(l => l.startsWith('Sal 3,'));

console.log('=== OSNB2 Sal 3 ===');
for (const v of osnb2) console.log(`  v${v.verseId}: ${v.text.slice(0, 80)}`);

console.log('\n=== ESV Psalm 3 ===');
for (const v of esv) console.log(`  v${v.verseId}: ${v.text.slice(0, 80)}`);

console.log('\n=== DNB2011 Sal 3 ===');
for (const l of dnb2011Lines) console.log(`  ${l.slice(0, 85)}`);

// Schema for the response
const schema = {
  type: 'object' as const,
  properties: {
    mappings: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          targetVerse: { type: 'number' as const, description: 'The verse number in the target (majority) numbering' },
          osnb2Verses: { type: 'array' as const, items: { type: 'number' as const }, description: 'Which osnb2 verse(s) make up this verse' },
          mergeType: { type: 'string' as const, enum: ['single', 'merged'] },
        },
        required: ['targetVerse', 'osnb2Verses', 'mergeType'],
      },
    },
  },
  required: ['mappings'],
};

const osnb2Text = osnb2.map(v => `v${v.verseId}: ${v.text}`).join('\n');
const esvText = esv.map(v => `v${v.verseId}: ${v.text}`).join('\n');
const dnb2011Text = dnb2011Lines.join('\n');

const prompt = `You are mapping Bible verse numbering.

OSNB2 (Hebrew/Tanach numbering, Norwegian text, ${osnb2.length} verses):
${osnb2Text}

REFERENCE 1 - ESV (English, ${esv.length} verses):
${esvText}

REFERENCE 2 - DNB2011 (Norwegian):
${dnb2011Text}

The target numbering should have ${esv.length} verses (matching ESV/DNB2011 structure).
For each target verse number (1-${esv.length}), tell me which osnb2 verse(s) it corresponds to.
If a target verse combines multiple osnb2 verses, list all of them.

Compare the CONTENT of the verses to determine the mapping. Do not just match by verse number.`;

console.log('\n=== Calling Ollama... ===\n');

const resp = await fetch(OLLAMA_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: OLLAMA_MODEL,
    prompt,
    stream: false,
    think: false,
    format: schema,
    options: { temperature: 0, num_predict: 2048 },
  }),
});

if (!resp.ok) throw new Error(`Ollama error: ${resp.status}`);
const data = await resp.json() as { response: string };
const result = JSON.parse(data.response);

console.log('=== OLLAMA MAPPING ===');
for (const m of result.mappings) {
  const osnb2Refs = m.osnb2Verses.join('+');
  console.log(`  target v${m.targetVerse} ← osnb2 v${osnb2Refs} [${m.mergeType}]`);
}

// === Apply the mapping to rebuild osmain ===
const osnb2ByVerse = new Map(osnb2.map(v => [v.verseId, v]));
const newOsmain: VerseData[] = [];

for (const m of result.mappings) {
  const texts: string[] = [];
  const sources: string[] = [];
  for (const vId of m.osnb2Verses) {
    const v = osnb2ByVerse.get(vId);
    if (v) {
      texts.push(v.text);
      sources.push(v.source ?? 'tanach');
    }
  }

  newOsmain.push({
    bookId: 19,
    chapterId: 3,
    verseId: m.targetVerse,
    text: texts.join(' '),
    source: sources[0] ?? 'tanach',
  });
}

console.log('\n=== REBUILT OSMAIN Sal 3 ===');
for (const v of newOsmain) {
  console.log(`  v${v.verseId}: ${v.text.slice(0, 100)}`);
}

// Compare with what ESV has
console.log('\n=== COMPARISON ===');
for (let i = 0; i < newOsmain.length; i++) {
  const esvV = esv[i];
  const osmV = newOsmain[i];
  if (!esvV || !osmV) continue;
  const esvStart = esvV.text.slice(0, 40);
  const osmStart = osmV.text.slice(0, 40);
  console.log(`  v${osmV.verseId}: osm="${osmStart}..." / esv="${esvStart}..."`);
}

// Ask user before saving
console.log('\n=== SAVE? ===');
console.log('To save, run with --save flag');

if (process.argv.includes('--save')) {
  const osmainFile = join(OSMAIN_DIR, '19', '3.json');
  writeFileSync(osmainFile, JSON.stringify(newOsmain, null, 2));
  console.log(`Saved to ${osmainFile}`);
}
