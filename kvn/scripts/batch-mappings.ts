#!/usr/bin/env bun
/**
 * Generate KVN mappings for every open-licensed translation listed in
 * docs/open-bibles/inventory.json, using qwen3.5:122b via generate-mapping.ts
 * (--fast --no-verify). Resumable: skips translations whose mapping already
 * exists, and generate-mapping.ts itself resumes per-chapter. Updates
 * kvn_mapping status in inventory.json as each completes.
 *
 * Usage: bun scripts/batch-mappings.ts [--model <name>] [--only <m1,m2>]
 */
import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '../..');
const INV = join(REPO, 'docs/open-bibles/inventory.json');
const MAPPINGS = join(__dirname, '../mappings');

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : null; };
const model = arg('model') ?? 'qwen3.5:122b';
const only = arg('only')?.split(',').map(s => s.trim());

const inv = JSON.parse(readFileSync(INV, 'utf8'));
let todo = inv.filter(r => r.kvn_ok);            // only translations allowed to renumber
if (only) todo = todo.filter(r => only.includes(r.translation));

console.log(`Batch KVN mapping — ${todo.length} translations, model=${model}\n`);
let done = 0, failed = [];
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
    execSync(
      `bun scripts/generate-mapping.ts --source ${m} --format raw --fast --no-verify --model ${model}`,
      { cwd: __dirname.replace(/\/scripts$/, ''), stdio: 'inherit' }
    );
    if (existsSync(mapFile)) { r.kvn_mapping = true; r.status = 'kvn_done'; done++; }
    else { failed.push(m); }
  } catch (e) {
    console.log(`  FAILED: ${m} — ${e.message.slice(0, 80)}`);
    failed.push(m);
  }
  // persist progress after each translation
  writeFileSync(INV, JSON.stringify(inv, null, 2) + '\n');
}
console.log(`\nDONE. mappings created: ${done}, failed: ${failed.length} ${failed.join(', ')}`);
