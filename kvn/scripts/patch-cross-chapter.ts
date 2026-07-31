#!/usr/bin/env bun
/**
 * Add same-book, adjacent-chapter cross-chapter entries to a built .ukvn.json.
 * The per-chapter generate-mapping build can only emit within-chapter entries;
 * this patches in the boundary verses whose content lives in an adjacent osmain
 * chapter (e.g. Numbers 13:1 in a Hebrew-versified bible = osmain 12:16).
 *
 * Run AFTER the final build (rebuilding drops these). Usage:
 *   bun scripts/patch-cross-chapter.ts <translation> <book> <transCh:transV>=<osmCh:osmV> ...
 *   e.g.  bun scripts/patch-cross-chapter.ts rv_1909_strongs 4 13:1=12:16
 * Only same-book adjacent chapters (|osmCh-transCh| == 1) are accepted.
 */
import fs from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '../..');

const PART_SIZE = 16, MAX_VERSE = 177, M_v = MAX_VERSE * PART_SIZE, MAX_CHAPTER = 151, M_ch = MAX_CHAPTER * M_v;
const encode = (b, c, v) => b * M_ch + c * M_v + v * PART_SIZE;

const [mod, bookStr, ...pairs] = process.argv.slice(2);
const book = +bookStr;
const file = join(REPO, 'kvn/mappings', `${mod}.ukvn.json`);
const m = JSON.parse(fs.readFileSync(file, 'utf8'));
const bookName = m.bookNames ? Object.keys(m.bookNames).find(n => m.bookNames[n] === book) || book : book;

let added = 0;
for (const p of pairs) {
  const [tPart, oPart] = p.split('=');
  const [tc, tv] = tPart.split(':').map(Number);
  const [oc, ov] = oPart.split(':').map(Number);
  if (Math.abs(oc - tc) !== 1) { console.error(`REJECT ${p}: not adjacent chapters`); continue; }
  const tkvn = encode(book, tc, tv), kvn = encode(book, oc, ov);
  // remove any existing entry for this translation verse
  m.map = m.map.filter(e => !(e.tkvnFrom === tkvn));
  m.map.push({ kvnFrom: kvn, kvnTo: kvn, kvnRef: `${bookName} ${oc}:${ov}`, tkvnFrom: tkvn, tkvnTo: tkvn, tkvnRef: `${bookName} ${tc},${tv}`, order: 0 });
  added++;
}
m.map.sort((a, b) => a.kvnFrom - b.kvnFrom || a.tkvnFrom - b.tkvnFrom);
if (m.stats) m.stats.totalMappingEntries = m.map.length;
fs.writeFileSync(file, JSON.stringify(m, null, 2) + '\n');
console.log(`${mod}: added ${added} cross-chapter entries, ${m.map.length} total`);
