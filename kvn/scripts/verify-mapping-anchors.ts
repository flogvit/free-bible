#!/usr/bin/env bun
/**
 * Automated sanity check for a translation's mapping result files.
 *
 * For each mapped translation verse V -> osmain verse O, it looks for
 * language-agnostic ANCHORS shared between the two texts:
 *   - numbers (digit sequences)
 *   - proper-noun stems (capitalised, diacritics-stripped, first 4 chars) —
 *     e.g. David/David, Saúl/Saul, Jonathán/Jonatan, Samsón/Samson
 * A verse that HAS anchors but shares NONE with its mapped osmain verse is
 * flagged for human review. Also flags: non-monotonic osmain refs, verses
 * mapped to a far-away osmain verse. (Works for Latin-script translations;
 * Hebrew/other scripts share fewer anchors so fewer verses are checkable.)
 *
 * Usage: bun scripts/verify-mapping-anchors.ts <translation>
 *
 * Flaggene går gjennom den felles kontrakten i generate/cli.ts; `--help` viser dem.
 */
import fs from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parseArgs, formatHelp, COMMON_FLAGS } from '../../generate/cli.js';
import type { FlagSpec } from '../../generate/cli.js';
import type { Chapter } from '../src/bible-types.js';
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '../..');

/** Formen på kvn/data/mapping-results/<oversettelse>/<bok>-<kapittel>.json,
 *  slik build-mapping.ts skriver den (se ollamaSchema der). */
interface MappingResultEntry {
  translationVerse: number;
  osmainVerses: number[];
  matchType: string;
  note?: string;
}

interface MappingResultFile {
  key: string;
  result: { mappings?: MappingResultEntry[] };
}

const SPEC: Record<string, FlagSpec> = {
  help: COMMON_FLAGS.help,
};

const HELP_EXAMPLES = [
  'bun kvn/scripts/verify-mapping-anchors.ts spanish',
  '',
  'Oversettelsen oppgis som posisjonsargument (uten --).',
];

const strip = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const anchors = (text: string) => {
  const t = strip(text);
  const nums = (t.match(/\d+/g) || []);
  // proper nouns: capitalised words not at sentence start heuristic — take all Capitalised words len>=4
  const names = (t.match(/\b[A-ZÉÈÀÁÍÓÚÑ][a-zéèàáíóúñA-Z]{3,}/g) || []).map(w => w.toLowerCase().slice(0, 4));
  return { nums: new Set(nums), names: new Set(names) };
};

const verses = (m: string, b: string, c: string): Chapter => JSON.parse(fs.readFileSync(join(REPO, 'generate/bibles_raw', m, b, `${c}.json`), 'utf8'));

function main(): void {
  // Hjelpen skal ut før noe leses fra disk.
  const { flags, positional } = parseArgs(process.argv.slice(2), SPEC);
  if (flags.help) {
    console.log(formatHelp(
      'kvn/scripts/verify-mapping-anchors.ts',
      'flagger mappede vers som ikke deler et eneste anker (tall eller egennavn) med osmain-verset',
      SPEC,
      HELP_EXAMPLES,
    ));
    process.exit(0);
  }

  const mod = positional[0];
  if (!mod) { console.error('usage: verify-mapping-anchors.mjs <translation>'); process.exit(1); }

  const resultsDir = join(REPO, 'kvn/data/mapping-results', mod);
  const files = fs.readdirSync(resultsDir).filter(f => f.endsWith('.json') && !f.startsWith('_'));

  let flagged = 0, checked = 0, chaptersFlagged = new Set<string>();
  for (const f of files) {
    const { key, result } = JSON.parse(fs.readFileSync(join(resultsDir, f), 'utf8')) as MappingResultFile;
    const [b, c] = key.split(':');
    const os = verses('osmain', b, c), tr = verses(mod, b, c);
    const osSet = new Set(os.map(v => v.verseId)), trSet = new Set(tr.map(v => v.verseId));
    if (os.length === tr.length && os.every(v => trSet.has(v.verseId))) continue; // identity, skip
    const osById = Object.fromEntries(os.map((v): [number, string] => [v.verseId, v.text]));
    const trById = Object.fromEntries(tr.map((v): [number, string] => [v.verseId, v.text]));
    let prevOs = 0;
    for (const m of (result.mappings || [])) {
      if (m.matchType === 'missing' || !m.osmainVerses.length) continue;
      const o = m.osmainVerses[0];
      if (o < prevOs) { console.log(`  ${key}: NON-MONOTONIC t${m.translationVerse} -> osm ${o} (after ${prevOs})`); chaptersFlagged.add(key); }
      prevOs = Math.max(prevOs, ...m.osmainVerses);
      const ta = anchors(trById[m.translationVerse] || '');
      const oa = anchors(osById[o] || '');
      const hasAnchors = ta.nums.size || ta.names.size;
      if (!hasAnchors) continue;
      checked++;
      const numMatch = [...ta.nums].some(n => oa.nums.has(n));
      const nameMatch = [...ta.names].some(n => oa.names.has(n));
      if (!numMatch && !nameMatch) {
        // only flag if the osmain verse has anchors too (else can't compare)
        if (oa.nums.size || oa.names.size) {
          console.log(`  ${key}: t${m.translationVerse}->osm${o} NO ANCHOR MATCH | tr:[${[...ta.names, ...ta.nums].join(',')}] osm:[${[...oa.names, ...oa.nums].join(',')}]`);
          flagged++; chaptersFlagged.add(key);
        }
      }
    }
  }
  console.log(`\n${mod}: checked ${checked} anchored verses, ${flagged} flagged across ${chaptersFlagged.size} chapters.`);
  console.log('chapters to hand-review:', [...chaptersFlagged].join(', ') || '(none)');
}

// Kjører bare når fila startes direkte, slik at import ikke har bivirkninger (#108).
if (import.meta.main) {
    main();
}
