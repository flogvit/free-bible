#!/usr/bin/env node
// Apply AUDITED per-context reconciliations. Each entry is
// { referrer, field, slug, match }. In the referrer's file, the exact slug is
// replaced with `match` in the given relation field only. Entries with
// match "NEW"/empty/missing-from-catalog are skipped.
//
// Usage: node persons_apply_context.mjs <proposals.json> [--dry]
import * as fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PERSONS_DIR = path.join(__dirname, 'persons', 'nb');
const [, , PROP, ...rest] = process.argv;
const DRY = rest.includes('--dry');
if (!PROP) { console.error('usage: node persons_apply_context.mjs <proposals.json> [--dry]'); process.exit(1); }

const files = fs.readdirSync(PERSONS_DIR).filter(f => f.endsWith('.json'));
const catalog = new Set(files.map(f => f.replace(/\.json$/, '')));
const idToFile = new Map();
for (const f of files) { const d = JSON.parse(fs.readFileSync(path.join(PERSONS_DIR, f), 'utf-8')); idToFile.set(d.id, f); }

const props = JSON.parse(fs.readFileSync(PROP, 'utf-8'));
const FIELD_MAP = { father: 'father', mother: 'mother', spouse: 'spouse', sibling: 'siblings', child: 'children', related: 'relatedPersons' };

// group by referrer file
const byReferrer = new Map();
let skipped = 0;
for (const p of props) {
  if (!p.match || p.match === 'NEW' || p.match === p.slug || !catalog.has(p.match)) { skipped++; continue; }
  const file = idToFile.get(p.referrer);
  if (!file) { skipped++; continue; }
  if (!byReferrer.has(file)) byReferrer.set(file, []);
  byReferrer.get(file).push(p);
}
console.log(`applicable referrers: ${byReferrer.size}, skipped entries: ${skipped}`);

let filesChanged = 0, edits = 0;
for (const [file, list] of byReferrer) {
  const fp = path.join(PERSONS_DIR, file);
  const d = JSON.parse(fs.readFileSync(fp, 'utf-8'));
  let n = 0;
  for (const p of list) {
    const jsonField = FIELD_MAP[p.field] || p.field;
    const fam = d.family || {};
    if (jsonField === 'father' || jsonField === 'mother' || jsonField === 'spouse') {
      if (fam[jsonField] === p.slug) { fam[jsonField] = p.match; n++; }
    } else if (jsonField === 'siblings' || jsonField === 'children') {
      const arr = fam[jsonField];
      if (Array.isArray(arr)) for (let k = 0; k < arr.length; k++) if (arr[k] === p.slug) { arr[k] = p.match; n++; }
    } else if (jsonField === 'relatedPersons') {
      const arr = d.relatedPersons;
      if (Array.isArray(arr)) for (let k = 0; k < arr.length; k++) if (arr[k] === p.slug) { arr[k] = p.match; n++; }
    }
  }
  // dedupe arrays after edits
  if (d.family) for (const k of ['siblings', 'children']) if (Array.isArray(d.family[k])) d.family[k] = [...new Set(d.family[k])];
  if (Array.isArray(d.relatedPersons)) d.relatedPersons = [...new Set(d.relatedPersons)];
  if (n > 0) { filesChanged++; edits += n; if (!DRY) fs.writeFileSync(fp, JSON.stringify(d, null, 2)); }
}
console.log(`${DRY ? '[dry] would change' : 'changed'} ${filesChanged} files, ${edits} reference edits`);
