#!/usr/bin/env bun
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
import { nameToId } from './lib.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PERSONS_DIR = path.join(__dirname, 'persons', 'nb');

/** Slektsfeltene i en profil. Alle er valgfrie — de fleste personer har bare noen. */
interface PersonFamily {
  father?: string;
  mother?: string;
  spouse?: string;
  siblings?: string[];
  children?: string[];
}

/**
 * En personprofil slik den ligger i generate/persons/nb/<slug>.json.
 *
 * Bare feltene denne validatoren rører er tatt med, og `id` er valgfri fordi
 * det å mangle den er nettopp en av tingene skriptet leter etter.
 */
interface PersonProfile {
  id?: string;
  name?: string;
  aliases?: string[];
  family?: PersonFamily;
  relatedPersons?: string[];
}

/** En innlest profil sammen med fila og slug-en den kom fra. */
interface LoadedPerson {
  file: string;
  slug: string;
  d: PersonProfile;
}

/** Én profil som peker på en slug, og gjennom hvilket forhold. */
interface RefBy {
  /** `undefined` når profilen som peker selv mangler `id`. */
  by: string | undefined;
  rel: string;
}

/** Hvor mange ganger en slug er referert, og av hvem. */
interface RefInfo {
  count: number;
  refBy: RefBy[];
}

/** En referert slug med telleverket sitt, slik rapporten grupperer dem. */
interface RefEntry extends RefInfo {
  slug: string;
}

/** Slug som har nøyaktig én kandidat — trygg å skrive om. */
interface VariantEntry extends RefEntry {
  candidate: string;
}

/** Slug med flere kandidater — må avgjøres manuelt. */
interface AmbiguousEntry extends RefEntry {
  candidates: string[];
}

/** Fil hvis navn ikke stemmer med `content.id`. */
interface DriftEntry {
  file: string;
  slug: string;
  id: string;
}

const args = process.argv.slice(2);
const VERBOSE = args.includes('--verbose');
const worklistIdx = args.indexOf('--worklist');
const WORKLIST = worklistIdx >= 0 ? args[worklistIdx + 1] : null;

// --- normalization ---------------------------------------------------------

// Display->slug. Delegerer til generatorens egen nameToId framfor å speile den:
// denne kopien manglet translitterasjonen av ø og æ, så mirroret drev fra
// originalen uten at noe kunne oppdage det (#25).
export const baseSlug = (s: string): string => nameToId(s);

// Aggressive transliteration key: collapses the spelling drift between the slugs
// the generator emitted in relations and the actual profile slugs.
// Conservative on purpose — only well-known Norwegian<->generic pairs.
export function phoneticKey(s: string): string {
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
const persons: LoadedPerson[] = [];
for (const f of files) {
  const raw = fs.readFileSync(path.join(PERSONS_DIR, f), 'utf-8');
  let d: PersonProfile;
  try { d = JSON.parse(raw); }
  catch (e) { console.error(`PARSE ERROR ${f}: ${(e as Error).message}`); continue; }
  persons.push({ file: f, slug: f.replace(/\.json$/, ''), d });
}

// --- structural checks -----------------------------------------------------

const drift: DriftEntry[] = [];          // filename != content.id
const missingId: string[] = [];      // no content.id
const idToFiles = new Map<string, string[]>();
for (const p of persons) {
  const id = p.d.id;
  if (!id) { missingId.push(p.file); continue; }
  if (id !== p.slug) drift.push({ file: p.file, slug: p.slug, id });
  if (!idToFiles.has(id)) idToFiles.set(id, []);
  // `!` er ren typepåstand: linja over har nettopp lagt inn nøkkelen.
  idToFiles.get(id)!.push(p.file);
}
const dupIds = [...idToFiles.entries()].filter(([, fs]) => fs.length > 1);

// --- resolution index ------------------------------------------------------

// `as string[]` fordi `filter(Boolean)` fjerner de tomme id-ene uten at typen
// følger med — påstanden sier det filteret allerede gjør.
const ids = new Set(persons.map(p => p.d.id).filter(Boolean) as string[]);
const slugs = new Set(persons.map(p => p.slug));
// canonical exact keys: id + filename
const exact = new Set([...ids, ...slugs]);

// phonetic index (may map to several ids -> ambiguous)
const phonToIds = new Map<string, Set<string>>();
const addPhon = (k: string, id: string): void => {
  if (!k) return;
  if (!phonToIds.has(k)) phonToIds.set(k, new Set());
  // `!` er ren typepåstand: linja over har nettopp lagt inn nøkkelen.
  phonToIds.get(k)!.add(id);
};
for (const p of persons) {
  if (!p.d.id) continue;
  addPhon(phoneticKey(p.d.id), p.d.id);
  addPhon(phoneticKey(p.slug), p.d.id);
  addPhon(phoneticKey(p.d.name || ''), p.d.id);
  for (const a of (p.d.aliases || [])) addPhon(phoneticKey(a), p.d.id);
}
// prefix index: bare form -> disambiguated ids (jeroboam -> jeroboam-i, jeroboam-ii)
function prefixCandidates(slug: string): string[] {
  const out: string[] = [];
  for (const id of ids) if (id === slug || id.startsWith(slug + '-')) out.push(id);
  return out;
}

// --- collect references with context --------------------------------------

const RELS = ['father', 'mother', 'spouse', 'siblings', 'children'];
const refs = new Map<string, RefInfo>(); // slug -> { count, refBy: [{id, rel}] }
// `slug` og `byId` tar imot `undefined` fordi feltene i `family` er valgfrie;
// vakten på første linje er den som allerede håndterer det.
function noteRef(slug: string | undefined, byId: string | undefined, rel: string): void {
  if (!slug) return;
  if (!refs.has(slug)) refs.set(slug, { count: 0, refBy: [] });
  // `!` er ren typepåstand: linja over har nettopp lagt inn nøkkelen.
  const e = refs.get(slug)!;
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

const resolved: RefEntry[] = [], variant: VariantEntry[] = [], ambiguous: AmbiguousEntry[] = [], missing: RefEntry[] = [];
for (const [slug, info] of refs) {
  if (exact.has(slug)) { resolved.push({ slug, ...info }); continue; }
  const pref = prefixCandidates(slug);
  const phon = phonToIds.get(phoneticKey(slug));
  const cands = new Set([...pref, ...(phon || [])]);
  if (cands.size === 1) variant.push({ slug, ...info, candidate: [...cands][0] });
  else if (cands.size > 1) ambiguous.push({ slug, ...info, candidates: [...cands] });
  else missing.push({ slug, ...info });
}

const sortByCount = (a: RefInfo, b: RefInfo): number => b.count - a.count;
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
