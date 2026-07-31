#!/usr/bin/env bun
// Apply AUDITED per-context reconciliations. Each entry is
// { referrer, field, slug, match }. In the referrer's file, the exact slug is
// replaced with `match` in the given relation field only. Entries with
// match "NEW"/empty/missing-from-catalog are skipped.
//
// Usage: bun persons-apply-context.ts <proposals.json> [--dry-run]
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
 * Skriptet tok `<proposals.json> [--dry]`. `--dry` heter nå `--dry-run` — det
 * gamle navnet går fortsatt gjennom som alias, med en advarsel. Uten flagget
 * skrives endringene til disk, som før.
 */
const SPEC: Record<string, FlagSpec> = {
    'dry-run': COMMON_FLAGS['dry-run'],
    help: COMMON_FLAGS.help,
};

const HELP_EXAMPLES = [
    'bun generate/persons-apply-context.ts proposals.json --dry-run   # vis hva som ville blitt endret',
    'bun generate/persons-apply-context.ts proposals.json             # skriv endringene',
];

// Hjelpesjekken står før alt annet: skriptet leser og JSON-parser hele
// persons-katalogen ved oppstart, og `--help` skal ikke koste noe av det.
const { flags, positional } = parseArgs(process.argv.slice(2), SPEC);
if (flags.help) {
    console.log(formatHelp(
        'generate/persons-apply-context.ts',
        'skriver reviderte per-kontekst-avstemminger fra <proposals.json> inn i det ene relasjonsfeltet hver post peker på',
        SPEC,
        HELP_EXAMPLES,
    ));
    process.exit(0);
}

const PROP = positional[0];
const DRY = flags['dry-run'] as boolean;
if (!PROP) { console.error('usage: bun generate/persons-apply-context.ts <proposals.json> [--dry-run]'); process.exit(1); }

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
 * `id` og relasjonsfeltene dette skriptet rører er tatt med — resten går
 * uendret gjennom JSON.parse/JSON.stringify.
 */
interface PersonProfile {
  id: string;
  family?: PersonFamily;
  relatedPersons?: string[];
}

/** Ett forslag fra persons-reconcile-context.ts, etter revisjon. */
interface ContextProposal {
  referrer: string;
  field: string;
  slug: string;
  match: string;
  confidence?: string;
  reason?: string;
}

const files = fs.readdirSync(PERSONS_DIR).filter(f => f.endsWith('.json'));
const catalog = new Set(files.map(f => f.replace(/\.json$/, '')));
const idToFile = new Map<string, string>();
for (const f of files) { const d = JSON.parse(fs.readFileSync(path.join(PERSONS_DIR, f), 'utf-8')) as PersonProfile; idToFile.set(d.id, f); }

const props = JSON.parse(fs.readFileSync(PROP, 'utf-8')) as ContextProposal[];
const FIELD_MAP: Record<string, string> = { father: 'father', mother: 'mother', spouse: 'spouse', sibling: 'siblings', child: 'children', related: 'relatedPersons' };

// group by referrer file
const byReferrer = new Map<string, ContextProposal[]>();
let skipped = 0;
for (const p of props) {
  if (!p.match || p.match === 'NEW' || p.match === p.slug || !catalog.has(p.match)) { skipped++; continue; }
  const file = idToFile.get(p.referrer);
  if (!file) { skipped++; continue; }
  if (!byReferrer.has(file)) byReferrer.set(file, []);
  byReferrer.get(file)!.push(p);
}
console.log(`applicable referrers: ${byReferrer.size}, skipped entries: ${skipped}`);

let filesChanged = 0, edits = 0;
for (const [file, list] of byReferrer) {
  const fp = path.join(PERSONS_DIR, file);
  const d = JSON.parse(fs.readFileSync(fp, 'utf-8')) as PersonProfile;
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
  if (d.family) for (const k of ['siblings', 'children'] as const) if (Array.isArray(d.family[k])) d.family[k] = [...new Set(d.family[k])];
  if (Array.isArray(d.relatedPersons)) d.relatedPersons = [...new Set(d.relatedPersons)];
  if (n > 0) { filesChanged++; edits += n; if (!DRY) fs.writeFileSync(fp, JSON.stringify(d, null, 2)); }
}
console.log(`${DRY ? '[dry] would change' : 'changed'} ${filesChanged} files, ${edits} reference edits`);
