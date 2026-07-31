#!/usr/bin/env bun
/**
 * GPU-free pre-pass for KVN mapping generation.
 *
 * For every open translation, classify its diff-from-osmain chapters:
 *  - "pure gap": the translation keeps osmain's verse numbers but omits some
 *    (textual-variant verses). These map identity → deterministic, no LLM.
 *  - "real": genuine renumbering (merges/shifts, e.g. Psalm titles). Needs LLM
 *    or manual review — left untouched here.
 *
 * Writes a result file for each pure-gap chapter into
 * kvn/data/mapping-results/<translation>/<book>-<chapter>.json so that
 * generate-mapping.ts (resume) never sends them to Ollama. Reports the
 * remaining "real" chapters per translation.
 *
 * Flaggene går gjennom den felles kontrakten i generate/cli.ts; `--help` viser dem.
 */
import fs from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parseArgs, formatHelp, COMMON_FLAGS } from '../../generate/cli.js';
import type { FlagSpec } from '../../generate/cli.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '../..');
const base = join(REPO, 'generate/bibles_raw');
const resultsBase = join(REPO, 'kvn/data/mapping-results');

const SPEC: Record<string, FlagSpec> = {
  only: {kind: 'string', help: 'behandle bare disse oversettelsene, kommaseparert'},
  help: COMMON_FLAGS.help,
};

const HELP_EXAMPLES = [
  'bun kvn/scripts/build-gap-results.ts',
  'bun kvn/scripts/build-gap-results.ts --only kjv,web',
];

const verses = (p: string): number[] => JSON.parse(fs.readFileSync(p, 'utf8')).map((v: { verseId: number }) => v.verseId);

function main(): void {
  // Hjelpen skal ut før noe leses fra eller skrives til disk.
  const { flags } = parseArgs(process.argv.slice(2), SPEC);
  if (flags.help) {
    console.log(formatHelp(
      'kvn/scripts/build-gap-results.ts',
      'klassifiserer avvikende kapitler som rene hull (identitet, GPU-fritt) eller ekte omnummerering',
      SPEC,
      HELP_EXAMPLES,
    ));
    process.exit(0);
  }

  const only = (flags.only as string | undefined)?.split(',');

  const inv = JSON.parse(fs.readFileSync(join(REPO, 'docs/open-bibles/inventory.json'), 'utf8'));

  const report: { translation: string; gaps: number; real: number; realChapters: string[] }[] = [];
  for (const r of inv) {
    if (only && !only.includes(r.translation)) continue;
    const dir = join(base, r.translation);
    const outDir = join(resultsBase, r.translation);
    fs.mkdirSync(outDir, { recursive: true });
    let gaps = 0; const real: string[] = [];
    for (const b of fs.readdirSync(dir).filter(f => /^[0-9]+$/.test(f))) {
      for (const f of fs.readdirSync(join(dir, b)).filter(f => f.endsWith('.json'))) {
        const c = f.replace('.json', '');
        const op = join(base, 'osmain', b, f);
        if (!fs.existsSync(op)) continue;
        const os = verses(op), bs = verses(join(dir, b, f));
        const osSet = new Set(os), bsSet = new Set(bs);
        if (os.length === bs.length && os.every(x => bsSet.has(x))) continue; // identity
        const outFile = join(outDir, `${b}-${c}.json`);
        if (fs.existsSync(outFile)) { if (bs.every(x => osSet.has(x))) gaps++; else real.push(`${b}:${c}`); continue; }
        if (bs.every(x => osSet.has(x))) {                                    // pure gap → identity
          const result = { mappings: bs.map(id => ({ translationVerse: id, osmainVerses: [id], matchType: 'exact' })), extraContent: [] };
          fs.writeFileSync(outFile, JSON.stringify({ key: `${b}:${c}`, result, claudeNote: ' [gap, no GPU]', needsReview: false }, null, 2));
          gaps++;
        } else real.push(`${b}:${c}`);
      }
    }
    report.push({ translation: r.translation, gaps, real: real.length, realChapters: real });
  }
  const noReal = report.filter(r => r.real === 0);
  console.log(`Processed ${report.length} translations.`);
  console.log(`Gap result files written. ${noReal.length} translations have NO real-renumbering chapters (buildable GPU-free now):`);
  console.log('  ' + noReal.map(r => r.translation).join(', '));
  console.log('\nTranslations with real chapters remaining (need LLM/manual):');
  for (const r of report.filter(r => r.real > 0).sort((a, b) => a.real - b.real))
    console.log(`  ${r.translation}: ${r.real} — ${r.realChapters.slice(0, 8).join(', ')}${r.real > 8 ? ' …' : ''}`);
  fs.writeFileSync(join(REPO, 'kvn/data/gap-classification.json'), JSON.stringify(report, null, 1) + '\n');
}

main();
