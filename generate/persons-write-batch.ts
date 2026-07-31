#!/usr/bin/env bun
// Write hand-authored person profiles. Reads a JSON array of person objects and
// writes each to persons/nb/<id>.json. Skips ids that already exist (never
// overwrites). Validates required fields and that id matches filename.
//
// Usage: node persons-write-batch.mjs <batch.json>
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
 * Skriptet har ingen flagg: batch-fila er det eneste argumentet, og den leses
 * nå som `positional[0]` framfor `process.argv[2]`.
 */
const SPEC: Record<string, FlagSpec> = {
    help: COMMON_FLAGS.help,
};

const HELP_EXAMPLES = [
    'bun generate/persons-write-batch.ts batch.json   # skriv profilene som ennå ikke finnes',
];

const REQ = ['id', 'name', 'title', 'era', 'summary', 'roles', 'family', 'keyEvents'];

function main(): void {
  // Hjelpen svares før batch-fila leses og før noen profil skrives: `--help`
  // skal ikke gjøre arbeid.
  const { flags, positional } = parseArgs(process.argv.slice(2), SPEC);
  if (flags.help) {
    console.log(formatHelp(
      'generate/persons-write-batch.ts',
      'skriver håndskrevne personprofiler fra <batch.json> til generate/persons/nb/<id>.json — én fil per person, og en id som allerede finnes hoppes over (aldri overskriving)',
      SPEC,
      HELP_EXAMPLES,
    ));
    process.exit(0);
  }

  const BATCH = positional[0];
  if (!BATCH) { console.error('usage: node persons-write-batch.mjs <batch.json>'); process.exit(1); }

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
}

// Kjører bare når fila startes direkte. Uten vakten skriver den profiler ved IMPORT.
if (import.meta.main) {
  main();
}
