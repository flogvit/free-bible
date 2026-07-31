import "../../generate/env.js";
/**
 * Generate a verse mapping between osmain and a translation.
 *
 * For each chapter:
 * 1. Compare osmain and translation verse counts
 * 2. If identical, check for identity mapping (skip if same)
 * 3. If different, send to Ollama for verse-by-verse matching
 * 4. If Ollama finds extra content in the translation, flag for osmain expansion
 *
 * Handles:
 * - 1:1 verse number differences
 * - Many:1 merges (multiple osmain verses → one translation verse)
 * - 1:many splits (one osmain verse → multiple translation verses)
 * - Extra content in translation verses (osmain needs expansion)
 * - Missing verses in translation
 *
 * Output: mapping file in kvn/mappings/<system>.ukvn.json
 *
 * Usage:
 *   bun scripts/generate-mapping.ts --bible dnb2011_nb --format txt
 *   bun scripts/generate-mapping.ts --bible english_kj --format raw
 *   bun scripts/generate-mapping.ts --bible dnb2011_nb --format txt --chapter 19:3
 *   bun scripts/generate-mapping.ts --bible dnb2011_nb --format txt --dry-run
 *   bun scripts/generate-mapping.ts --bible dnb2011_nb --format txt --model gemma4:31b
 *
 * `--source` er det gamle navnet på `--bible` og godtas fortsatt (med advarsel),
 * jf. LEGACY_ALIASES i generate/cli.ts.
 */

import { readFileSync, readdirSync, existsSync, statSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { parseArgs, formatHelp, COMMON_FLAGS } from '../../generate/cli.js';
import type { FlagSpec } from '../../generate/cli.js';

// === Args ===
//
// Hjelpen skal ut før noe leses fra disk, skrives til disk eller sendes til en
// modell. Dette skriptet lastet tidligere hele oversettelsen og startet mot
// Ollama på toppnivå, så `--help` ble lest som data og jobben gikk i gang.
//
// `--chapter` er IKKE COMMON_FLAGS.chapter: her er verdien en bok:kapittel-nøkkel
// («19:3»), ikke et kapittelintervall. Som `range` ville «19:3» blitt tolket som
// kapittel 19 uten at noe klaget, så flagget må være en streng.
//
// `--no-verify` faller ut av at `verify` står på som standard — kontrakten slår
// av et boolsk flagg med `--no-<flagg>`.
const SPEC: Record<string, FlagSpec> = {
  bible: { ...COMMON_FLAGS.bible, default: 'dnb2011_nb' },
  format: {
    kind: 'string',
    help: "'raw' leser JSON-katalogene, 'txt' leser external/closed/<bibel>.txt",
    default: 'raw',
  },
  chapter: { kind: 'string', help: 'bare dette kapittelet, som bok:kapittel, f.eks. 19:3' },
  model: { kind: 'string', help: 'Ollama-modellen som gjør versmatchingen', default: 'gemma4:31b' },
  'dry-run': { kind: 'boolean', help: 'list kapitlene som ville gått til Ollama, uten å kjøre dem' },
  fast: {
    kind: 'boolean',
    help: 'hopp over Ollama for kapitler med samme versnumre som osmain (uten flagget går alle gjennom, så tekstnivå-splitter og -sammenslåinger også fanges)',
  },
  verify: {
    kind: 'boolean',
    default: true,
    help: 'Claude-verifisering av flaggede kapitler; slått av markeres de «needsReview» i resultatfila i stedet',
  },
  help: COMMON_FLAGS.help,
};

const HELP_EXAMPLES = [
  'bun kvn/scripts/generate-mapping.ts --bible dnb2011_nb --format txt',
  'bun kvn/scripts/generate-mapping.ts --bible english_kj --format raw',
  'bun kvn/scripts/generate-mapping.ts --bible dnb2011_nb --format txt --chapter 19:3',
  'bun kvn/scripts/generate-mapping.ts --bible dnb2011_nb --format txt --dry-run',
  'bun kvn/scripts/generate-mapping.ts --bible osnb --format raw --fast --no-verify',
];

const { flags } = parseArgs(process.argv.slice(2), SPEC);
if (flags.help) {
  console.log(formatHelp(
    'kvn/scripts/generate-mapping.ts',
    'bygger versmappingen mellom osmain og en oversettelse, kapittel for kapittel',
    SPEC,
    HELP_EXAMPLES,
  ));
  process.exit(0);
}

const sourceName = flags.bible as string;
const sourceFormat = flags.format as string; // 'txt' or 'raw'
const chapterFilter = (flags.chapter as string | undefined) ?? null;
const ollamaModel = flags.model as string;
const dryRun = flags['dry-run'] as boolean;
// --fast: skip Ollama for chapters whose verse-ID set is identical to osmain
// (identity chapters contribute no mapping entries anyway). Opt-in; without it
// every chapter is sent to Ollama so text-level splits/merges are also detected.
const fast = flags.fast as boolean;
// --no-verify: skip the Claude API verification step. Flagged (non-exact) chapters
// are instead marked "needsReview: true" in their result file for manual/agent review.
const noVerify = !(flags.verify as boolean);

const OSMAIN_DIR = join(import.meta.dirname, '../../generate/bibles_raw/osmain');
const RAW_DIR = join(import.meta.dirname, '../../external/closed/raw');
const BIBLES_RAW_DIR = join(import.meta.dirname, '../../generate/bibles_raw');
const TXT_DIR = join(import.meta.dirname, '../../external/closed');
const MAPPINGS_DIR = join(import.meta.dirname, '../mappings');
const RESULTS_DIR = join(import.meta.dirname, '../data/mapping-results');
const OLLAMA_URL = 'http://localhost:11434/api/generate';

// === Types ===
interface VerseData {
  bookId: number;
  chapterId: number;
  verseId: number;
  text: string;
  source?: string;
  [key: string]: any;
}

interface MappingEntry {
  kvnFrom: number;
  kvnTo: number;
  kvnRef: string;
  tkvnFrom: number;
  tkvnTo: number;
  tkvnRef: string;
  order: number;
}

// === KVN encoding (no spacing, direct from osmain coordinates) ===
const PART_SIZE = 16;
const MAX_VERSE = 177;
const M_v = MAX_VERSE * PART_SIZE;
const MAX_CHAPTER = 151;
const M_ch = MAX_CHAPTER * M_v;

function encode(book: number, chapter: number, verse: number, part = 0): number {
  return book * M_ch + chapter * M_v + verse * PART_SIZE + part;
}

// === Book name mapping for txt files ===
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
  // English names (for nb88/nb94).
  //
  // Tretten av dem staves likt som i den norske blokka over — Neh, Jer, Dan,
  // Hos, Joel, Nah, Hab, Hag, Mal, Matt, Mark, Rom og Gal — og sto her en gang
  // til, med SAMME bok-id begge steder. En duplisert nøkkel i en objektliteral
  // gir bare én egenskap ved kjøring, så de andre oppføringene var død kode:
  // nøkkelsettet, verdiene og innsettingsrekkefølgen er identiske uten dem.
  // Rekkefølgen er verdt å merke seg, for BOOK_NAMES under plukker det FØRSTE
  // navnet per id, og BOOK_IDS skrives rått som `bookNames` i mappingfila.
  'Gen': 1, 'Exod': 2, 'Ex': 2, 'Lev': 3, 'Num': 4, 'Deut': 5,
  'Josh': 6, 'Judg': 7, 'Ruth': 8, '1Sam': 9, '2Sam': 10,
  '1Kgs': 11, '1Kings': 11, '2Kgs': 12, '2Kings': 12,
  '1Chr': 13, '2Chr': 14, 'Ezra': 15, 'Esth': 17,
  'Ps': 19, 'Prov': 20, 'Eccl': 21, 'Song': 22,
  'Isa': 23, 'Lam': 25, 'Ezek': 26,
  'Amos': 30, 'Obad': 31, 'Jonah': 32,
  'Mic': 33, 'Zeph': 36,
  'Zech': 38, 'Luke': 42,
  'John': 43, 'Acts': 44, '1Cor': 46, '2Cor': 47,
  'Eph': 49, 'Phil': 50, 'Col': 51,
  '1Thess': 52, '1Thes': 52, '2Thess': 53, '2Thes': 53,
  '1Tim': 54, '2Tim': 55, 'Titus': 56, 'Phlm': 57, 'Philem': 57,
  'Heb': 58, 'Jas': 59, '1Pet': 60, '2Pet': 61,
  '1John': 62, '2John': 63, '3John': 64, 'Jude': 65, 'Rev': 66,
};

const BOOK_NAMES: Record<number, string> = {};
for (const [name, id] of Object.entries(BOOK_IDS)) {
  if (!(id in BOOK_NAMES)) BOOK_NAMES[id] = name;
}

// === Load translation ===

function loadTxtBible(filename: string): Map<string, VerseData[]> {
  const file = join(TXT_DIR, filename);
  const content = readFileSync(file, 'utf-8');
  const byChapter = new Map<string, VerseData[]>();

  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    // Try Norwegian format: "1 Mos 1,1 text"
    let match = line.match(/^(.+?)\s+(\d+),(\d+)\s+(.+)$/);
    if (!match) {
      // Try English format: "Gen 1:1 text"
      match = line.match(/^(.+?)\s+(\d+):(\d+)\s+(.+)$/);
    }
    if (!match) continue;

    const bookName = match[1];
    const chapter = parseInt(match[2]);
    const verse = parseInt(match[3]);
    const text = match[4].trim();

    const bookId = BOOK_IDS[bookName];
    if (bookId === undefined) continue;

    const key = `${bookId}:${chapter}`;
    if (!byChapter.has(key)) byChapter.set(key, []);
    byChapter.get(key)!.push({ bookId, chapterId: chapter, verseId: verse, text });
  }

  return byChapter;
}

function loadRawBible(name: string): Map<string, VerseData[]> {
  const dir = existsSync(join(RAW_DIR, name)) ? join(RAW_DIR, name) : join(BIBLES_RAW_DIR, name);
  const byChapter = new Map<string, VerseData[]>();
  if (!existsSync(dir)) return byChapter;

  const bookDirs = readdirSync(dir)
    .filter(d => /^\d+$/.test(d) && parseInt(d) <= 66 && statSync(join(dir, d)).isDirectory());

  for (const bookStr of bookDirs) {
    const bookDir = join(dir, bookStr);
    for (const f of readdirSync(bookDir).filter(f => f.endsWith('.json'))) {
      const ch = parseInt(f.replace('.json', ''));
      try {
        const data: VerseData[] = JSON.parse(readFileSync(join(bookDir, f), 'utf-8'));
        if (data.length > 0) byChapter.set(`${bookStr}:${ch}`, data);
      } catch { /* skip */ }
    }
  }
  return byChapter;
}

function loadOsmainChapter(book: number, chapter: number): VerseData[] {
  const file = join(OSMAIN_DIR, String(book), `${chapter}.json`);
  if (!existsSync(file)) return [];
  try { return JSON.parse(readFileSync(file, 'utf-8')); } catch { return []; }
}

// === Ollama ===

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

async function askOllama(prompt: string): Promise<any> {
  const resp = await fetch(OLLAMA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: ollamaModel,
      prompt,
      stream: false,
      think: false,
      format: ollamaSchema,
      options: { temperature: 0, num_predict: 8192 },
    }),
  });
  if (!resp.ok) throw new Error(`Ollama error: ${resp.status}`);
  const data = await resp.json() as { response: string };
  return JSON.parse(data.response);
}

// === Claude verification for flagged results ===

let anthropic: Anthropic | null = null;
function getAnthropic(): Anthropic {
  if (!anthropic) anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return anthropic;
}

async function verifyWithClaude(
  osmainVerses: VerseData[],
  transVerses: VerseData[],
  ollamaResult: any,
  book: number,
  chapter: number,
  translationName: string,
): Promise<{ verified: boolean; correctedResult?: any; explanation: string }> {
  const osmainText = osmainVerses.map(v => `v${v.verseId}: ${v.text}`).join('\n');
  const transText = transVerses.map(v => `v${v.verseId}: ${v.text}`).join('\n');
  const ollamaJson = JSON.stringify(ollamaResult, null, 2);

  const prompt = `Du verifiserer en bibelvers-mapping laget av en lokal LLM.

OSMAIN (norsk mastertekst, bok ${book} kapittel ${chapter}, ${osmainVerses.length} vers):
${osmainText}

OVERSETTELSE: ${translationName} (${transVerses.length} vers):
${transText}

LLM-resultatet som skal verifiseres:
${ollamaJson}

LLM-en har flagget noen vers som problematiske (extra_content, partial, merged, split, eller missing).

Verifiser:
1. Er matchType riktig for hvert vers?
2. Er osmainVerses-referansene korrekte?
3. Er extraContent-rapporteringen korrekt? Har oversettelsen virkelig tekst som IKKE finnes i osmain?
4. Er det noe LLM-en har misset?

Svar i JSON:
{
  "verified": true/false,
  "issues": ["beskrivelse av problem"],
  "correctedMappings": [kun de som trenger korrigering, samme format som input],
  "correctedExtraContent": [kun de som trenger korrigering],
  "explanation": "kort forklaring"
}`;

  const client = getAnthropic();
  const completion = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = completion.content[0];
  if (text.type !== 'text') throw new Error('Unexpected Claude response type');

  const jsonMatch = text.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Could not parse Claude response as JSON');

  const claudeResult = JSON.parse(jsonMatch[0]);
  return {
    verified: claudeResult.verified,
    correctedResult: claudeResult.correctedMappings?.length > 0 ? claudeResult : undefined,
    explanation: claudeResult.explanation,
  };
}

/** Check if an Ollama result needs Claude verification */
function needsVerification(result: any): boolean {
  const mappings = result.mappings ?? [];
  const hasExtraContent = (result.extraContent?.length ?? 0) > 0;
  const hasNonExact = mappings.some((m: any) =>
    m.matchType === 'extra_content' ||
    m.matchType === 'missing' ||
    m.matchType === 'merged' ||
    m.matchType === 'split'
  );
  return hasExtraContent || hasNonExact;
}

function buildPrompt(osmainVerses: VerseData[], transVerses: VerseData[], book: number, chapter: number, translationName: string): string {
  const osmainText = osmainVerses.map(v => `v${v.verseId}: ${v.text.slice(0, 200)}`).join('\n');
  const transText = transVerses.map(v => `v${v.verseId}: ${v.text.slice(0, 200)}`).join('\n');

  return `You are mapping Bible verse numbering between two translations.

OSMAIN (Norwegian master text, ${osmainVerses.length} verses, book ${book} chapter ${chapter}):
${osmainText}

TRANSLATION: ${translationName} (${transVerses.length} verses):
${transText}

For each verse in the TRANSLATION, find the matching osmain verse(s).
Compare the CONTENT to determine the mapping, not just verse numbers.

Match types:
- "exact": same content, possibly different verse number
- "partial": translation has only part of the osmain verse
- "merged": translation verse combines multiple osmain verses
- "split": translation verse is part of a split osmain verse
- "extra_content": translation verse has MORE text than the osmain verse (important!)
- "missing": translation verse has no match in osmain

IMPORTANT: If a translation verse contains text that is NOT in any osmain verse,
report it in the extraContent array. This means osmain needs to be expanded.`;
}

// === Main ===

async function main(): Promise<void> {
  // .env leses her og ikke på toppnivå: --help skal ikke røre disk.

  console.log(`Source: ${sourceName} (format: ${sourceFormat})`);
  console.log(`Model: ${ollamaModel}`);
  if (dryRun) console.log('DRY RUN\n');

  console.log(`\nLoading translation ${sourceName}...`);
  const translation = sourceFormat === 'txt'
    ? loadTxtBible(`${sourceName}.txt`)
    : loadRawBible(sourceName);
  console.log(`Loaded ${translation.size} chapters\n`);

  // Collect all osmain chapter keys (books 1-66)
  const osmainKeys = new Set<string>();
  const osmainBookDirs = readdirSync(OSMAIN_DIR)
    .filter(d => /^\d+$/.test(d) && parseInt(d) <= 66 && statSync(join(OSMAIN_DIR, d)).isDirectory());
  for (const bookStr of osmainBookDirs) {
    const files = readdirSync(join(OSMAIN_DIR, bookStr)).filter(f => f.endsWith('.json'));
    for (const f of files) {
      osmainKeys.add(`${bookStr}:${f.replace('.json', '')}`);
    }
  }

  // Categorize chapters
  const identityChapters: string[] = [];
  const diffChapters: string[] = [];
  const missingInTranslation: string[] = [];
  const extraInTranslation: string[] = [];

  const allKeys = new Set([...osmainKeys, ...translation.keys()]);

  for (const key of [...allKeys].sort((a, b) => {
    const [ab, ac] = a.split(':').map(Number);
    const [bb, bc] = b.split(':').map(Number);
    return ab - bb || ac - bc;
  })) {
    if (chapterFilter && key !== chapterFilter) continue;
    const book = parseInt(key.split(':')[0]);
    if (book > 66) continue;

    const osmainVerses = loadOsmainChapter(book, parseInt(key.split(':')[1]));
    const transVerses = translation.get(key);

    if (!transVerses || transVerses.length === 0) {
      if (osmainVerses.length > 0) missingInTranslation.push(key);
      continue;
    }
    if (osmainVerses.length === 0) {
      extraInTranslation.push(key);
      continue;
    }

    // In --fast mode, skip Ollama when the verse-ID set is identical to osmain:
    // such chapters are a clean 1:1 identity and contribute no mapping entries.
    if (fast) {
      const osIds = osmainVerses.map(v => v.verseId).sort((a, b) => a - b);
      const trIds = transVerses.map(v => v.verseId).sort((a, b) => a - b);
      const identical = osIds.length === trIds.length && osIds.every((v, i) => v === trIds[i]);
      if (identical) {
        identityChapters.push(key);
        continue;
      }
    }

    // Otherwise go through Ollama — even with same verse count,
    // text content may differ (extra sentences, merges, etc.)
    diffChapters.push(key);
  }

  console.log(`Identity chapters (same verse IDs): ${identityChapters.length}`);
  console.log(`Different chapters (need Ollama): ${diffChapters.length}`);
  console.log(`Missing in translation: ${missingInTranslation.length}`);
  console.log(`Extra in translation: ${extraInTranslation.length}`);

  if (dryRun) {
    console.log('\nChapters needing Ollama:');
    for (const key of diffChapters) {
      const [bookStr, chStr] = key.split(':');
      const osmain = loadOsmainChapter(parseInt(bookStr), parseInt(chStr));
      const trans = translation.get(key)!;
      console.log(`  ${key}: osmain ${osmain.length}v, trans ${trans.length}v`);
    }
    process.exit(0);
  }

  // === Process diff chapters through Ollama ===

  mkdirSync(RESULTS_DIR, { recursive: true });
  const sourceResultsDir = join(RESULTS_DIR, sourceName);
  mkdirSync(sourceResultsDir, { recursive: true });

  const allMappings: MappingEntry[] = [];
  const expansionNeeded: Array<{ key: string; verse: number; description: string }> = [];
  let processed = 0;
  let ollamaErrors = 0;
  let claudeVerifications = 0;
  let claudeCorrections = 0;

  for (const key of diffChapters) {
    const [bookStr, chStr] = key.split(':');
    const book = parseInt(bookStr);
    const chapter = parseInt(chStr);

    // Skip if already processed (resume support)
    const resultFile = join(sourceResultsDir, `${book}-${chapter}.json`);
    if (existsSync(resultFile)) {
      // Load existing result and add to mappings
      const existing = JSON.parse(readFileSync(resultFile, 'utf-8'));
      const result = existing.result;
      for (const m of result.mappings) {
        if (m.matchType === 'missing') continue;
        for (let i = 0; i < m.osmainVerses.length; i++) {
          const osmainVerse = m.osmainVerses[i];
          const kvn = encode(book, chapter, osmainVerse);
          const tkvn = encode(book, chapter, m.translationVerse);
          if (kvn !== tkvn || m.osmainVerses.length > 1) {
            allMappings.push({
              kvnFrom: kvn, kvnTo: kvn,
              kvnRef: `${BOOK_NAMES[book] ?? book} ${chapter}:${osmainVerse}`,
              tkvnFrom: tkvn, tkvnTo: tkvn,
              tkvnRef: `${BOOK_NAMES[book] ?? book} ${chapter},${m.translationVerse}`,
              order: i,
            });
          }
        }
      }
      if (result.extraContent?.length > 0) {
        for (const ec of result.extraContent) {
          expansionNeeded.push({ key, verse: ec.translationVerse, description: ec.description });
        }
      }
      processed++;
      continue;
    }

    const osmainVerses = loadOsmainChapter(book, chapter);
    const transVerses = translation.get(key)!;

    const prompt = buildPrompt(osmainVerses, transVerses, book, chapter, sourceName);

    process.stdout.write(`  ${key} (osmain:${osmainVerses.length}v trans:${transVerses.length}v)... `);

    try {
      const start = Date.now();
      let result = await askOllama(prompt);
      const ollamaElapsed = ((Date.now() - start) / 1000).toFixed(1);

      // Claude verification for non-trivial findings
      let claudeNote = '';
      let needsReview = false;
      if (needsVerification(result) && noVerify) {
        // Skip the API; flag for manual/agent review instead.
        needsReview = true;
        claudeNote = ' [needs-review]';
      } else if (needsVerification(result)) {
        process.stdout.write(`gemma ${ollamaElapsed}s → Claude... `);
        try {
          const verification = await verifyWithClaude(
            osmainVerses, transVerses, result, book, chapter, sourceName
          );
          claudeVerifications++;

          if (!verification.verified && verification.correctedResult) {
            // Apply Claude's corrections
            const corrected = verification.correctedResult;
            if (corrected.correctedMappings?.length > 0) {
              // Replace only the corrected mappings in the result
              for (const cm of corrected.correctedMappings) {
                const idx = result.mappings.findIndex((m: any) => m.translationVerse === cm.translationVerse);
                if (idx >= 0) result.mappings[idx] = cm;
              }
            }
            if (corrected.correctedExtraContent) {
              result.extraContent = corrected.correctedExtraContent;
            }
            claudeCorrections++;
            claudeNote = ` [Claude corrected: ${verification.explanation.slice(0, 60)}]`;
          } else if (verification.verified) {
            claudeNote = ' [Claude verified ✓]';
          } else {
            claudeNote = ` [Claude: ${verification.explanation.slice(0, 60)}]`;
          }
        } catch (err: any) {
          claudeNote = ` [Claude error: ${err.message.slice(0, 40)}]`;
        }
      }

      const elapsed = ((Date.now() - start) / 1000).toFixed(1);

      // Save result (with Claude verification note)
      writeFileSync(
        join(sourceResultsDir, `${book}-${chapter}.json`),
        JSON.stringify({ key, result, claudeNote, needsReview, timestamp: new Date().toISOString() }, null, 2)
      );

      // Convert to mapping entries
      let entryCount = 0;
      for (const m of result.mappings) {
        if (m.matchType === 'missing') continue;

        for (let i = 0; i < m.osmainVerses.length; i++) {
          const osmainVerse = m.osmainVerses[i];
          const kvn = encode(book, chapter, osmainVerse);
          const tkvn = encode(book, chapter, m.translationVerse);

          if (kvn !== tkvn || m.osmainVerses.length > 1) {
            allMappings.push({
              kvnFrom: kvn, kvnTo: kvn,
              kvnRef: `${BOOK_NAMES[book] ?? book} ${chapter}:${osmainVerse}`,
              tkvnFrom: tkvn, tkvnTo: tkvn,
              tkvnRef: `${BOOK_NAMES[book] ?? book} ${chapter},${m.translationVerse}`,
              order: i,
            });
            entryCount++;
          }
        }
      }

      // Track extra content
      if (result.extraContent?.length > 0) {
        for (const ec of result.extraContent) {
          expansionNeeded.push({ key, verse: ec.translationVerse, description: ec.description });
        }
      }

      const extras = result.extraContent?.length > 0 ? `, ${result.extraContent.length} extra` : '';
      console.log(`✓ ${elapsed}s, ${entryCount} entries${extras}${claudeNote}`);
      processed++;
    } catch (err: any) {
      console.log(`ERROR: ${err.message}`);
      ollamaErrors++;
    }
  }

  // === Write mapping file ===

  allMappings.sort((a, b) => a.kvnFrom - b.kvnFrom);

  const mappingFile = {
    version: 2,
    system: sourceName,
    name: sourceName,
    encoding: {
      partSize: PART_SIZE,
      maxVerse: MAX_VERSE,
      maxChapter: MAX_CHAPTER,
    },
    bookNames: BOOK_IDS,
    stats: {
      identityChapters: identityChapters.length,
      mappedChapters: diffChapters.length,
      totalMappingEntries: allMappings.length,
      missingInTranslation: missingInTranslation.length,
      expansionsNeeded: expansionNeeded.length,
    },
    map: allMappings,
  };

  const outFile = join(MAPPINGS_DIR, `${sourceName}.ukvn.json`);
  writeFileSync(outFile, JSON.stringify(mappingFile, null, 2));

  console.log(`\n=== SUMMARY ===`);
  console.log(`Processed: ${processed} chapters through Ollama (gemma4)`);
  console.log(`Claude verifications: ${claudeVerifications}`);
  console.log(`Claude corrections: ${claudeCorrections}`);
  console.log(`Ollama errors: ${ollamaErrors}`);
  console.log(`Total mapping entries: ${allMappings.length}`);
  console.log(`Mapping written to: ${outFile}`);

  if (expansionNeeded.length > 0) {
    console.log(`\n=== OSMAIN EXPANSION NEEDED ===`);
    console.log(`${expansionNeeded.length} verses have extra content in ${sourceName}:`);
    for (const e of expansionNeeded) {
      console.log(`  ${e.key} v${e.verse}: ${e.description}`);
    }

    // Save expansion report
    const expansionFile = join(sourceResultsDir, '_expansion-needed.json');
    writeFileSync(expansionFile, JSON.stringify(expansionNeeded, null, 2));
    console.log(`\nExpansion report: ${expansionFile}`);
  }

  if (missingInTranslation.length > 0 && missingInTranslation.length <= 20) {
    console.log(`\n=== CHAPTERS MISSING IN TRANSLATION ===`);
    for (const key of missingInTranslation) {
      console.log(`  ${key}`);
    }
  }
}

// Avslutt med kode 1 på feil, ikke 0: et ukjent flagg skal stoppe et køskript.
main().catch(err => {
  console.error(err);
  process.exit(1);
});
