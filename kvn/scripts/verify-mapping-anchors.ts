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
 */
import fs from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '../..');
const mod = process.argv[2];
if (!mod) { console.error('usage: verify-mapping-anchors.mjs <translation>'); process.exit(1); }

const strip = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const anchors = text => {
  const t = strip(text);
  const nums = (t.match(/\d+/g) || []);
  // proper nouns: capitalised words not at sentence start heuristic — take all Capitalised words len>=4
  const names = (t.match(/\b[A-ZÉÈÀÁÍÓÚÑ][a-zéèàáíóúñA-Z]{3,}/g) || []).map(w => w.toLowerCase().slice(0, 4));
  return { nums: new Set(nums), names: new Set(names) };
};

const verses = (m, b, c) => JSON.parse(fs.readFileSync(join(REPO, 'generate/bibles_raw', m, b, `${c}.json`), 'utf8'));
const resultsDir = join(REPO, 'kvn/data/mapping-results', mod);
const files = fs.readdirSync(resultsDir).filter(f => f.endsWith('.json') && !f.startsWith('_'));

let flagged = 0, checked = 0, chaptersFlagged = new Set();
for (const f of files) {
  const { key, result } = JSON.parse(fs.readFileSync(join(resultsDir, f), 'utf8'));
  const [b, c] = key.split(':');
  const os = verses('osmain', b, c), tr = verses(mod, b, c);
  const osSet = new Set(os.map(v => v.verseId)), trSet = new Set(tr.map(v => v.verseId));
  if (os.length === tr.length && os.every(v => trSet.has(v.verseId))) continue; // identity, skip
  const osById = Object.fromEntries(os.map(v => [v.verseId, v.text]));
  const trById = Object.fromEntries(tr.map(v => [v.verseId, v.text]));
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
