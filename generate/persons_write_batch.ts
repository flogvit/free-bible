#!/usr/bin/env bun
// Write hand-authored person profiles. Reads a JSON array of person objects and
// writes each to persons/nb/<id>.json. Skips ids that already exist (never
// overwrites). Validates required fields and that id matches filename.
//
// Usage: node persons_write_batch.mjs <batch.json>
import * as fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PERSONS_DIR = path.join(__dirname, 'persons', 'nb');
const [, , BATCH] = process.argv;
if (!BATCH) { console.error('usage: node persons_write_batch.mjs <batch.json>'); process.exit(1); }

const REQ = ['id', 'name', 'title', 'era', 'summary', 'roles', 'family', 'keyEvents'];
const arr = JSON.parse(fs.readFileSync(BATCH, 'utf-8'));

let written = 0, skipped = 0, errors = 0;
for (const p of arr) {
  for (const k of REQ) if (!(k in p)) { console.error(`ERROR ${p.id || '?'}: missing ${k}`); errors++; }
  if (!p.family || typeof p.family !== 'object') { console.error(`ERROR ${p.id}: bad family`); errors++; continue; }
  if (!('relatedPersons' in p)) p.relatedPersons = [];
  if (!('lifespan' in p)) p.lifespan = '?';
  const fp = path.join(PERSONS_DIR, `${p.id}.json`);
  if (fs.existsSync(fp)) { skipped++; continue; }
  // canonical field order
  const ordered = {
    id: p.id, name: p.name, title: p.title, era: p.era, lifespan: p.lifespan,
    summary: p.summary, roles: p.roles, family: {
      father: p.family.father ?? null, mother: p.family.mother ?? null,
      siblings: p.family.siblings ?? [], spouse: p.family.spouse ?? null,
      children: p.family.children ?? [],
    },
    relatedPersons: p.relatedPersons, keyEvents: p.keyEvents,
  };
  fs.writeFileSync(fp, JSON.stringify(ordered, null, 2));
  written++;
}
console.log(`written: ${written}, skipped (exists): ${skipped}, errors: ${errors}`);
