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
//   bun persons_apply_reconcile.ts <map.json> [--dry-run]
import * as fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseArgs, formatHelp, COMMON_FLAGS } from './cli.js';
import type { FlagSpec } from './cli.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PERSONS_DIR = path.join(__dirname, 'persons', 'nb');

/**
 * Flaggkontrakten for dette skriptet (#51, #52, #53).
 *
 * Skriptet tok `<map.json> [--dry]`. `--dry` heter nå `--dry-run` — det gamle
 * navnet går fortsatt gjennom som alias, med en advarsel. Uten flagget skrives
 * endringene til disk, som før.
 */
const SPEC: Record<string, FlagSpec> = {
    'dry-run': COMMON_FLAGS['dry-run'],
    help: COMMON_FLAGS.help,
};

const HELP_EXAMPLES = [
    'bun generate/persons_apply_reconcile.ts map.json --dry-run   # vis hva som ville blitt endret',
    'bun generate/persons_apply_reconcile.ts map.json             # skriv endringene',
];

// Hjelpesjekken står før alt annet: skriptet leser hele persons-katalogen og
// kartet ved oppstart, og `--help` skal ikke koste noe av det.
const { flags, positional } = parseArgs(process.argv.slice(2), SPEC);
if (flags.help) {
    console.log(formatHelp(
        'generate/persons_apply_reconcile.ts',
        'skriver et revidert avstemmingskart <map.json> inn i relasjonsfeltene i persons-profilene',
        SPEC,
        HELP_EXAMPLES,
    ));
    process.exit(0);
}

const MAP_PATH = positional[0];
const DRY = flags['dry-run'] as boolean;
if (!MAP_PATH) { console.error('usage: bun generate/persons_apply_reconcile.ts <map.json> [--dry-run]'); process.exit(1); }

/** Slektsfeltene i en profil. Alle er valgfrie — de fleste har bare noen. */
interface PersonFamily {
  father?: string;
  mother?: string;
  spouse?: string;
  siblings?: string[];
  children?: string[];
}

/**
 * En personprofil slik den ligger i generate/persons/nb/<slug>.json. Bare
 * relasjonsfeltene dette skriptet skriver om er tatt med — resten går uendret
 * gjennom JSON.parse/JSON.stringify.
 */
interface PersonProfile {
  family?: PersonFamily;
  relatedPersons?: string[];
}

/** Avstemmingskartet: { "<fromSlug>": "<canonicalId>", ... }. */
type ReconcileMap = Record<string, string>;

const rawMap = JSON.parse(fs.readFileSync(MAP_PATH, 'utf-8')) as ReconcileMap;
const files = fs.readdirSync(PERSONS_DIR).filter(f => f.endsWith('.json'));
const catalog = new Set(files.map(f => f.replace(/\.json$/, '')));

// keep only valid, non-identity, non-NEW mappings whose target exists
const map = new Map<string, string>();
let skipped = 0;
for (const [from, to] of Object.entries(rawMap)) {
  if (!to || to === 'NEW' || to === from) { skipped++; continue; }
  if (!catalog.has(to)) { console.error(`  skip ${from} -> ${to} (target not in catalog)`); skipped++; continue; }
  map.set(from, to);
}
console.log(`map: ${map.size} applicable, ${skipped} skipped`);

const remapVal = (v: string | undefined): string | undefined => (v && map.has(v)) ? map.get(v) : v;
const remapArr = (a: string[] | undefined): { arr: string[] | undefined; changed: number } => {
  if (!Array.isArray(a)) return { arr: a, changed: 0 };
  let changed = 0;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of a) {
    const nv = remapVal(v) as string;
    if (nv !== v) changed++;
    if (!seen.has(nv)) { seen.add(nv); out.push(nv); } // dedupe after remap
  }
  return { arr: out, changed };
};

let filesChanged = 0, edits = 0;
for (const f of files) {
  const fp = path.join(PERSONS_DIR, f);
  const d = JSON.parse(fs.readFileSync(fp, 'utf-8')) as PersonProfile;
  let n = 0;
  const fam = d.family;
  if (fam) {
    for (const k of ['father', 'mother', 'spouse'] as const) {
      const nv = remapVal(fam[k]);
      if (nv !== fam[k]) { fam[k] = nv; n++; }
    }
    for (const k of ['siblings', 'children'] as const) {
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
