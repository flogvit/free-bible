#!/usr/bin/env bun
/**
 * Generate KVN mappings for every open-licensed translation listed in
 * docs/open-bibles/inventory.json, using qwen3.5:122b via build-mapping.ts
 * (--fast --no-verify). Resumable: skips translations whose mapping already
 * exists, and build-mapping.ts itself resumes per-chapter. Updates
 * kvn_mapping status in inventory.json as each completes.
 *
 * Usage: bun scripts/batch-mappings.ts [--model <name>] [--only <m1,m2>]
 */
import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parseArgs, formatHelp, COMMON_FLAGS } from '../../generate/cli.js';
import type { FlagSpec } from '../../generate/cli.js';

// Hjelpen skal ut før inventory.json leses og før den første oversettelsen
// startes. Skriptet leste tidligere inventaret og gikk rett i gang på
// toppnivå, så `bun scripts/batch-mappings.ts --help` satte i gang en kø mot
// 71 oversettelser.
const SPEC: Record<string, FlagSpec> = {
  model: {
    kind: 'string',
    help: 'Ollama-modellen build-mapping.ts skal bruke',
    default: 'qwen3.5:122b',
  },
  only: {
    kind: 'string',
    help: 'kommaseparert liste over oversettelser; uten flagget kjøres alle med kvn_ok i inventaret',
  },
  help: COMMON_FLAGS.help,
};

const HELP_EXAMPLES = [
  'bun kvn/scripts/batch-mappings.ts',
  'bun kvn/scripts/batch-mappings.ts --model gemma4:31b',
  'bun kvn/scripts/batch-mappings.ts --only web,english_kj',
];

const { flags } = parseArgs(process.argv.slice(2), SPEC);
if (flags.help) {
  console.log(formatHelp(
    'kvn/scripts/batch-mappings.ts',
    'kjører build-mapping.ts for hver åpent lisensierte oversettelse i inventaret',
    SPEC,
    HELP_EXAMPLES,
  ));
  process.exit(0);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '../..');
const INV = join(REPO, 'docs/open-bibles/inventory.json');
const MAPPINGS = join(__dirname, '../mappings');

const model = flags.model as string;
const only = (flags.only as string | undefined)?.split(',').map(s => s.trim());

/** En rad i docs/open-bibles/inventory.json. */
interface InventoryRow {
  translation: string;
  language?: string;
  /** Oversettelsen har lov til å renummereres inn i KVN. */
  kvn_ok?: boolean;
  kvn_mapping?: boolean;
  status?: string;
  [key: string]: unknown;
}

function main(): void {
  const inv: InventoryRow[] = JSON.parse(readFileSync(INV, 'utf8'));
  let todo = inv.filter(r => r.kvn_ok);            // only translations allowed to renumber
  if (only) todo = todo.filter(r => only.includes(r.translation));

  console.log(`Batch KVN mapping — ${todo.length} translations, model=${model}\n`);
  let done = 0;
  const failed: string[] = [];
  for (const r of todo) {
    const m = r.translation;
    const mapFile = join(MAPPINGS, `${m}.ukvn.json`);
    if (existsSync(mapFile)) {
      console.log(`[skip] ${m} (mapping exists)`);
      r.kvn_mapping = true; r.status = 'kvn_done';
      writeFileSync(INV, JSON.stringify(inv, null, 2) + '\n');
      continue;
    }
    console.log(`\n=== ${m} (${r.language}) ===`);
    try {
      // `--bible` er det kanoniske navnet på det som het `--source`.
      execSync(
        `bun scripts/build-mapping.ts --bible ${m} --format raw --fast --no-verify --model ${model}`,
        { cwd: __dirname.replace(/\/scripts$/, ''), stdio: 'inherit' }
      );
      if (existsSync(mapFile)) { r.kvn_mapping = true; r.status = 'kvn_done'; done++; }
      else { failed.push(m); }
    } catch (e) {
      console.log(`  FAILED: ${m} — ${(e as Error).message.slice(0, 80)}`);
      failed.push(m);
    }
    // persist progress after each translation
    writeFileSync(INV, JSON.stringify(inv, null, 2) + '\n');
  }
  console.log(`\nDONE. mappings created: ${done}, failed: ${failed.length} ${failed.join(', ')}`);
}

// Kjører bare når fila startes direkte, slik at import ikke har bivirkninger (#108).
if (import.meta.main) {
    main();
}
