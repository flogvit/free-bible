#!/usr/bin/env node
/**
 * Data-integrity check for translations in generate/bibles_raw/.
 *
 * Flags, per translation:
 *  - JSON parse errors
 *  - duplicate verse IDs within a chapter (corrupt/mashed verses)
 *  - fully-empty chapters
 *  - empty Old-Testament verses (the OT has no textual-variant omissions,
 *    so a blank OT verse is a real content gap)
 *
 * Blank NT verses at the ~16 known textual-variant locations are benign and
 * are reported separately, not as failures.
 *
 * Usage:
 *   node scripts/check-bible-integrity.mjs            # scan all, list problems
 *   node scripts/check-bible-integrity.mjs --only kjv,web
 *   node scripts/check-bible-integrity.mjs --all      # include clean ones
 * Exit code 1 if any translation has a (non-benign) problem.
 */
import fs from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const base = join(__dirname, '../../generate/bibles_raw');
const arg = n => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : null; };
const only = arg('only')?.split(',');
const showAll = process.argv.includes('--all');

const NT_VARIANTS = new Set([
  '40:17:21', '40:18:11', '40:23:14', '41:7:16', '41:9:44', '41:9:46', '41:11:26',
  '41:15:28', '42:17:36', '42:23:17', '43:5:4', '44:8:37', '44:15:34', '44:24:7',
  '44:28:29', '45:16:24',
]);

let problems = 0;
const targets = fs.readdirSync(base).filter(f => fs.statSync(join(base, f)).isDirectory())
  .filter(m => !only || only.includes(m)).sort();

for (const m of targets) {
  const dir = join(base, m);
  let dupCh = 0, emptyCh = 0, otEmpty = 0, ntVariant = 0; const parse = []; const samples = [];
  for (const b of fs.readdirSync(dir).filter(f => /^[0-9]+$/.test(f))) {
    for (const f of fs.readdirSync(join(dir, b)).filter(f => f.endsWith('.json'))) {
      const c = f.replace('.json', '');
      let v;
      try { v = JSON.parse(fs.readFileSync(join(dir, b, f), 'utf8')); }
      catch { parse.push(`${b}/${f}`); continue; }
      const ids = v.map(x => x.verseId);
      if (new Set(ids).size !== ids.length) { dupCh++; if (samples.length < 3) samples.push(`dup ${b}:${c}`); }
      const empty = v.filter(x => !x.text || !String(x.text).trim());
      if (empty.length === v.length && v.length) { emptyCh++; if (samples.length < 3) samples.push(`empty-ch ${b}:${c}`); }
      for (const x of empty) {
        const key = `${b}:${c}:${x.verseId}`;
        if (+b >= 40 && NT_VARIANTS.has(key)) ntVariant++;
        else if (+b < 40) { otEmpty++; if (samples.length < 3) samples.push(`empty-OT ${b}:${c}:${x.verseId}`); }
        else ntVariant++;
      }
    }
  }
  const bad = parse.length || dupCh || emptyCh || otEmpty;
  if (bad) problems++;
  if (bad || showAll) {
    const tag = bad ? 'PROBLEM' : 'ok';
    const detail = bad
      ? `parseErrors=${parse.length} dupChapters=${dupCh} emptyChapters=${emptyCh} otEmptyVerses=${otEmpty}${ntVariant ? ` (ntVariants=${ntVariant} benign)` : ''} — ${samples.join(', ')}`
      : ntVariant ? `${ntVariant} benign NT-variant blanks` : 'clean';
    console.log(`${tag.padEnd(8)} ${m}: ${detail}`);
  }
}
console.log(`\n${targets.length} translations scanned, ${problems} with problems.`);
process.exit(problems ? 1 : 0);
