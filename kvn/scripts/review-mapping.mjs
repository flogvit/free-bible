#!/usr/bin/env node
/**
 * Review helper: for a translation, print each real (non-identity) chapter with
 * osmain text, translation text, and the proposed mapping from its result file,
 * so a human can verify the alignment is correct.
 *
 * Usage: node scripts/review-mapping.mjs <translation> [chapter]
 */
import fs from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '../..');
const [mod, chapterFilter] = process.argv.slice(2);
if (!mod) { console.error('usage: review-mapping.mjs <translation> [book:chapter]'); process.exit(1); }

const resultsDir = join(REPO, 'kvn/data/mapping-results', mod);
const verses = (m, b, c) => JSON.parse(fs.readFileSync(join(REPO, 'generate/bibles_raw', m, b, `${c}.json`), 'utf8'));

const files = fs.readdirSync(resultsDir).filter(f => f.endsWith('.json') && !f.startsWith('_'));
for (const f of files.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
  const { key, result, needsReview } = JSON.parse(fs.readFileSync(join(resultsDir, f), 'utf8'));
  const [b, c] = key.split(':');
  if (chapterFilter && key !== chapterFilter) continue;
  // only show non-identity chapters (those with a real mapping)
  const os = verses('osmain', b, c), tr = verses(mod, b, c);
  const osSet = new Set(os.map(v => v.verseId)), trSet = new Set(tr.map(v => v.verseId));
  const identity = os.length === tr.length && os.every(v => trSet.has(v.verseId));
  if (identity) continue;
  const map = Object.fromEntries((result.mappings || []).map(m => [m.translationVerse, m]));
  console.log(`\n===== ${mod} ${key} (osmain ${os.length}v, trans ${tr.length}v)${needsReview ? ' [needsReview]' : ''} =====`);
  const osById = Object.fromEntries(os.map(v => [v.verseId, v.text]));
  for (const t of tr) {
    const m = map[t.verseId];
    const to = m ? `-> osm ${m.osmainVerses.join(',')} (${m.matchType})` : '-> (identity)';
    const osTxt = m && m.osmainVerses.length ? (osById[m.osmainVerses[0]] || '').slice(0, 36) : '';
    console.log(`  t${String(t.verseId).padStart(3)} ${to.padEnd(24)} | ${t.text.slice(0, 34).padEnd(36)} | osm: ${osTxt}`);
  }
  if (result.extraContent?.length) console.log('  extraContent:', JSON.stringify(result.extraContent));
}
