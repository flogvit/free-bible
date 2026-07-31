#!/usr/bin/env bun
/**
 * Structural coverage check for a translation's mapping result files.
 * For each non-identity chapter, reconstruct which osmain verse each translation
 * verse maps to (explicit entry, else identity), then flag:
 *   - a mapping targeting an osmain verse that does not exist (> osmain count)
 *   - an osmain verse left uncovered (no translation verse maps to it)
 *   - a non-monotonic sequence
 * These are the signatures of a bad auto-alignment (e.g. identity where an
 * offset was needed). Usage: node scripts/verify-mapping-coverage.mjs <translation>
 */
import fs from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '../..');
const mod = process.argv[2];
const verses = (m, b, c) => JSON.parse(fs.readFileSync(join(REPO, 'generate/bibles_raw', m, b, `${c}.json`), 'utf8'));
const dir = join(REPO, 'kvn/data/mapping-results', mod);

let flaggedChapters = 0;
for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json') && !f.startsWith('_')).sort()) {
  const { key, result } = JSON.parse(fs.readFileSync(join(dir, f), 'utf8'));
  const [b, c] = key.split(':');
  const os = verses('osmain', b, c), tr = verses(mod, b, c);
  const trSet = new Set(tr.map(v => v.verseId));
  if (os.length === tr.length && os.every(v => trSet.has(v.verseId))) continue; // identity
  const osCount = os.length;
  const explicit = new Map((result.mappings || []).map(m => [m.translationVerse, m]));
  const covered = new Set(); const issues = [];
  let prev = 0;
  for (const t of tr) {
    const m = explicit.get(t.verseId);
    let targets;
    if (m) { if (m.matchType === 'missing' || !m.osmainVerses.length) continue; targets = m.osmainVerses; }
    else targets = [t.verseId]; // identity default
    for (const o of targets) {
      if (o > osCount) issues.push(`t${t.verseId}->osm${o} (osmain has only ${osCount})`);
      covered.add(o);
    }
    const mn = Math.min(...targets);
    if (mn < prev) issues.push(`non-monotonic t${t.verseId}->osm${targets.join(',')} after ${prev}`);
    prev = Math.max(prev, ...targets);
  }
  const uncovered = [];
  for (let o = 1; o <= osCount; o++) if (!covered.has(o)) uncovered.push(o);
  // classify: uncovered ONLY at the edges (first/last, contiguous) = cross-chapter boundary (expected);
  // uncovered in the middle, or a target beyond osmain, or non-monotonic = a real alignment error.
  const edgeOnly = uncovered.length > 0 && uncovered.every(o => o <= (uncovered.filter(x => x <= 3).length) || o > osCount - 6)
    && !uncovered.some((o, i) => i > 0 && o - uncovered[i - 1] > 1 && o < osCount - 5 && o > 3);
  const realError = issues.length > 0 || uncovered.some(o => o > 3 && o <= osCount - 6);
  if (uncovered.length) issues.push(`uncovered: ${uncovered.join(',')}`);
  const tag = realError ? 'ERROR' : (uncovered.length ? 'boundary' : 'ok');
  if (issues.length) { if (realError) flaggedChapters++; console.log(`  [${tag}] ${key} (osm ${osCount}v, tr ${tr.length}v): ${issues.join(' | ')}`); }
}
console.log(`\n${mod}: ${flaggedChapters} chapters with REAL errors (boundary cases excluded).`);
process.exit(flaggedChapters ? 1 : 0);
