#!/usr/bin/env bun
// Apply an AUDITED reconciliation map to persons data. Deterministic and narrow:
// it only rewrites exact slug matches inside the known relation fields
// (family.father/mother/spouse, family.siblings[], family.children[],
// relatedPersons[]) to their canonical id. Everything else is untouched.
//
// The map is { "<fromSlug>": "<canonicalId>", ... }. Entries whose target is
// missing from the catalog, empty, or "NEW" are skipped (never applied).
//
// Usage:
//   node persons_apply_reconcile.mjs <map.json> [--dry]
import * as fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PERSONS_DIR = path.join(__dirname, 'persons', 'nb');
const [, , MAP_PATH, ...rest] = process.argv;
const DRY = rest.includes('--dry');
if (!MAP_PATH) { console.error('usage: node persons_apply_reconcile.mjs <map.json> [--dry]'); process.exit(1); }

const rawMap = JSON.parse(fs.readFileSync(MAP_PATH, 'utf-8'));
const files = fs.readdirSync(PERSONS_DIR).filter(f => f.endsWith('.json'));
const catalog = new Set(files.map(f => f.replace(/\.json$/, '')));

// keep only valid, non-identity, non-NEW mappings whose target exists
const map = new Map();
let skipped = 0;
for (const [from, to] of Object.entries(rawMap)) {
  if (!to || to === 'NEW' || to === from) { skipped++; continue; }
  if (!catalog.has(to)) { console.error(`  skip ${from} -> ${to} (target not in catalog)`); skipped++; continue; }
  map.set(from, to);
}
console.log(`map: ${map.size} applicable, ${skipped} skipped`);

const remapVal = v => (v && map.has(v)) ? map.get(v) : v;
const remapArr = a => {
  if (!Array.isArray(a)) return { arr: a, changed: 0 };
  let changed = 0;
  const seen = new Set();
  const out = [];
  for (const v of a) {
    const nv = remapVal(v);
    if (nv !== v) changed++;
    if (!seen.has(nv)) { seen.add(nv); out.push(nv); } // dedupe after remap
  }
  return { arr: out, changed };
};

let filesChanged = 0, edits = 0;
for (const f of files) {
  const fp = path.join(PERSONS_DIR, f);
  const d = JSON.parse(fs.readFileSync(fp, 'utf-8'));
  let n = 0;
  const fam = d.family;
  if (fam) {
    for (const k of ['father', 'mother', 'spouse']) {
      const nv = remapVal(fam[k]);
      if (nv !== fam[k]) { fam[k] = nv; n++; }
    }
    for (const k of ['siblings', 'children']) {
      const { arr, changed } = remapArr(fam[k]);
      if (changed) { fam[k] = arr; n += changed; }
    }
  }
  const rp = remapArr(d.relatedPersons);
  if (rp.changed) { d.relatedPersons = rp.arr; n += rp.changed; }

  if (n > 0) {
    filesChanged++; edits += n;
    if (!DRY) fs.writeFileSync(fp, JSON.stringify(d, null, 2));
  }
}
console.log(`${DRY ? '[dry] would change' : 'changed'} ${filesChanged} files, ${edits} reference edits`);
