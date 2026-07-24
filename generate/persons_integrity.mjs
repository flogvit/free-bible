#!/usr/bin/env node
// Read-only integrity validator for the persons/ dataset.
//
// Guarantees the data foundation the website relies on:
//   1. one canonical id per person (filename == content.id, no duplicate ids)
//   2. referential closure (every family/relatedPersons slug resolves to exactly one person)
//
// This script NEVER writes to persons data. It only reports and, with --worklist,
// dumps a JSON worklist (to the given path) that drives the reconciliation work.
//
// Usage:
//   node persons_integrity.mjs                 # summary + exit 1 if any unresolved
//   node persons_integrity.mjs --verbose       # list every drift / unresolved ref
//   node persons_integrity.mjs --worklist out.json
//
import * as fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PERSONS_DIR = path.join(__dirname, 'persons', 'nb');

const args = process.argv.slice(2);
const VERBOSE = args.includes('--verbose');
const worklistIdx = args.indexOf('--worklist');
const WORKLIST = worklistIdx >= 0 ? args[worklistIdx + 1] : null;

// --- normalization ---------------------------------------------------------

// Bare display->slug, mirroring the generator's nameToId (strip parens, diacritics)
export function baseSlug(s) {
  return String(s).toLowerCase()
    .replace(/\s*\([^)]*\)/g, '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// Aggressive transliteration key: collapses the spelling drift between the slugs
// the generator emitted in relations and the actual profile slugs.
// Conservative on purpose — only well-known Norwegian<->generic pairs.
export function phoneticKey(s) {
  return String(s).toLowerCase()
    .replace(/\s*\([^)]*\)/g, '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim()
    .replace(/sch|sh|sj/g, 's')
    .replace(/kh|ch/g, 'k')
    .replace(/ph/g, 'f')
    .replace(/th/g, 't')
    .replace(/w/g, 'v')
    .replace(/x/g, 'ks')
    .replace(/y/g, 'j')
    .replace(/c/g, 'k')
    .replace(/z/g, 's')
    .replace(/q/g, 'k')
    .replace(/([a-z])\1+/g, '$1')   // collapse doubled letters (serubbabel/serubabel)
    .replace(/h/g, '')              // silent-h drift (ham/kam handled separately? keep)
    .replace(/[aeiou]/g, 'a')       // vowel-fold (mordokai/mordekai)
    .replace(/[^a-z0-9]+/g, '');
}

// --- load ------------------------------------------------------------------

const files = fs.readdirSync(PERSONS_DIR).filter(f => f.endsWith('.json'));
const persons = [];
for (const f of files) {
  const raw = fs.readFileSync(path.join(PERSONS_DIR, f), 'utf-8');
  let d;
  try { d = JSON.parse(raw); }
  catch (e) { console.error(`PARSE ERROR ${f}: ${e.message}`); continue; }
  persons.push({ file: f, slug: f.replace(/\.json$/, ''), d });
}

// --- structural checks -----------------------------------------------------

const drift = [];          // filename != content.id
const missingId = [];      // no content.id
const idToFiles = new Map();
for (const p of persons) {
  const id = p.d.id;
  if (!id) { missingId.push(p.file); continue; }
  if (id !== p.slug) drift.push({ file: p.file, slug: p.slug, id });
  if (!idToFiles.has(id)) idToFiles.set(id, []);
  idToFiles.get(id).push(p.file);
}
const dupIds = [...idToFiles.entries()].filter(([, fs]) => fs.length > 1);

// --- resolution index ------------------------------------------------------

const ids = new Set(persons.map(p => p.d.id).filter(Boolean));
const slugs = new Set(persons.map(p => p.slug));
// canonical exact keys: id + filename
const exact = new Set([...ids, ...slugs]);

// phonetic index (may map to several ids -> ambiguous)
const phonToIds = new Map();
const addPhon = (k, id) => {
  if (!k) return;
  if (!phonToIds.has(k)) phonToIds.set(k, new Set());
  phonToIds.get(k).add(id);
};
for (const p of persons) {
  if (!p.d.id) continue;
  addPhon(phoneticKey(p.d.id), p.d.id);
  addPhon(phoneticKey(p.slug), p.d.id);
  addPhon(phoneticKey(p.d.name || ''), p.d.id);
  for (const a of (p.d.aliases || [])) addPhon(phoneticKey(a), p.d.id);
}
// prefix index: bare form -> disambiguated ids (jeroboam -> jeroboam-i, jeroboam-ii)
function prefixCandidates(slug) {
  const out = [];
  for (const id of ids) if (id === slug || id.startsWith(slug + '-')) out.push(id);
  return out;
}

// --- collect references with context --------------------------------------

const RELS = ['father', 'mother', 'spouse', 'siblings', 'children'];
const refs = new Map(); // slug -> { count, refBy: [{id, rel}] }
function noteRef(slug, byId, rel) {
  if (!slug) return;
  if (!refs.has(slug)) refs.set(slug, { count: 0, refBy: [] });
  const e = refs.get(slug);
  e.count++;
  e.refBy.push({ by: byId, rel });
}
for (const p of persons) {
  const fam = p.d.family || {};
  noteRef(fam.father, p.d.id, 'father');
  noteRef(fam.mother, p.d.id, 'mother');
  noteRef(fam.spouse, p.d.id, 'spouse');
  for (const s of (fam.siblings || [])) noteRef(s, p.d.id, 'sibling');
  for (const s of (fam.children || [])) noteRef(s, p.d.id, 'child');
  for (const s of (p.d.relatedPersons || [])) noteRef(s, p.d.id, 'related');
}

// --- classify unresolved ---------------------------------------------------

const resolved = [], variant = [], ambiguous = [], missing = [];
for (const [slug, info] of refs) {
  if (exact.has(slug)) { resolved.push({ slug, ...info }); continue; }
  const pref = prefixCandidates(slug);
  const phon = phonToIds.get(phoneticKey(slug));
  const cands = new Set([...pref, ...(phon || [])]);
  if (cands.size === 1) variant.push({ slug, ...info, candidate: [...cands][0] });
  else if (cands.size > 1) ambiguous.push({ slug, ...info, candidates: [...cands] });
  else missing.push({ slug, ...info });
}

const sortByCount = (a, b) => b.count - a.count;
variant.sort(sortByCount); ambiguous.sort(sortByCount); missing.sort(sortByCount);

// --- report ----------------------------------------------------------------

console.log('=== persons integrity ===');
console.log(`profiles:            ${persons.length}`);
console.log(`distinct content.id: ${ids.size}`);
console.log(`filename != id drift:${drift.length}`);
console.log(`duplicate ids:       ${dupIds.length}`);
console.log(`missing content.id:  ${missingId.length}`);
console.log('--- references ---');
console.log(`distinct referenced slugs: ${refs.size}`);
console.log(`  resolved (exact):        ${resolved.length}`);
console.log(`  variant (1 candidate):   ${variant.length}`);
console.log(`  ambiguous (>1 candidate):${ambiguous.length}`);
console.log(`  MISSING (0 candidates):  ${missing.length}`);

if (VERBOSE) {
  if (drift.length) { console.log('\n-- drift (filename -> id) --'); drift.forEach(d => console.log(`  ${d.file}  ->  ${d.id}`)); }
  if (dupIds.length) { console.log('\n-- duplicate ids --'); dupIds.forEach(([id, fs]) => console.log(`  ${id}: ${fs.join(', ')}`)); }
  console.log('\n-- variant (safe reconcile) --');
  variant.forEach(v => console.log(`  ${v.slug} (${v.count}) -> ${v.candidate}`));
  console.log('\n-- ambiguous --');
  ambiguous.forEach(a => console.log(`  ${a.slug} (${a.count}) -> ${a.candidates.join(', ')}`));
  console.log('\n-- missing --');
  missing.forEach(m => console.log(`  ${m.slug} (${m.count})  [by: ${m.refBy.slice(0,4).map(r=>`${r.by}:${r.rel}`).join(', ')}]`));
}

if (WORKLIST) {
  fs.writeFileSync(WORKLIST, JSON.stringify({
    generatedFrom: PERSONS_DIR,
    structural: { drift, dupIds: dupIds.map(([id, fs]) => ({ id, files: fs })), missingId },
    references: { variant, ambiguous, missing },
  }, null, 2));
  console.log(`\nworklist -> ${WORKLIST}`);
}

const clean = drift.length === 0 && dupIds.length === 0 && missingId.length === 0
  && variant.length === 0 && ambiguous.length === 0 && missing.length === 0;
process.exit(clean ? 0 : 1);
