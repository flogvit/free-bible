#!/usr/bin/env bun
/**
 * Data-integrity check for translations in generate/bibles_raw/.
 *
 * Flags, per translation:
 *  - JSON parse errors
 *  - duplicate verse IDs within a chapter (corrupt/mashed verses)
 *  - fully-empty chapters
 *  - empty Old-Testament verses (the OT has no textual-variant omissions,
 *    so a blank OT verse is a real content gap)
 *
 * Blank NT verses at the ~16 known textual-variant locations are benign and
 * are reported separately, not as failures.
 *
 * Flaggene går gjennom den felles kontrakten i generate/cli.ts; `--help` viser dem.
 * Exit code 1 if any translation has a (non-benign) problem.
 */
import fs from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parseArgs, formatHelp, COMMON_FLAGS } from '../../generate/cli.js';
import type { FlagSpec } from '../../generate/cli.js';
import type { Verse } from '../src/bible-types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const base = join(__dirname, '../../generate/bibles_raw');

const SPEC: Record<string, FlagSpec> = {
  only: {kind: 'string', help: 'bare disse oversettelsene, kommaseparert (f.eks. kjv,web)'},
  all: {kind: 'boolean', help: 'ta med de feilfrie oversettelsene i utskriften også'},
  help: COMMON_FLAGS.help,
};

const HELP_EXAMPLES = [
  'bun kvn/scripts/check-bible-integrity.ts',
  'bun kvn/scripts/check-bible-integrity.ts --only kjv,web',
  'bun kvn/scripts/check-bible-integrity.ts --all',
];

const NT_VARIANTS = new Set([
  '40:17:21', '40:18:11', '40:23:14', '41:7:16', '41:9:44', '41:9:46', '41:11:26',
  '41:15:28', '42:17:36', '42:23:17', '43:5:4', '44:8:37', '44:15:34', '44:24:7',
  '44:28:29', '45:16:24',
]);

function main(): void {
  // Hjelpesjekken står først: skanningen leser hver eneste kapittelfil under
  // bibles_raw, og `--help` skal ikke koste noe av det.
  const { flags } = parseArgs(process.argv.slice(2), SPEC);
  if (flags.help) {
    console.log(formatHelp(
      'kvn/scripts/check-bible-integrity.ts',
      'dataintegritetssjekk av oversettelsene i generate/bibles_raw: parsefeil, dupliserte versnumre, tomme kapitler og tomme GT-vers',
      SPEC,
      HELP_EXAMPLES,
    ));
    process.exit(0);
  }

  const only = (flags.only as string | undefined)?.split(',');
  const showAll = flags.all as boolean;

  let problems = 0;
  const targets = fs.readdirSync(base).filter(f => fs.statSync(join(base, f)).isDirectory())
    .filter(m => !only || only.includes(m)).sort();

  for (const m of targets) {
    const dir = join(base, m);
    let dupCh = 0, emptyCh = 0, otEmpty = 0, ntVariant = 0; const parse: string[] = []; const samples: string[] = [];
    for (const b of fs.readdirSync(dir).filter(f => /^[0-9]+$/.test(f))) {
      for (const f of fs.readdirSync(join(dir, b)).filter(f => f.endsWith('.json'))) {
        const c = f.replace('.json', '');
        let v: Verse[];
        try { v = JSON.parse(fs.readFileSync(join(dir, b, f), 'utf8')); }
        catch { parse.push(`${b}/${f}`); continue; }
        const ids = v.map(x => x.verseId);
        if (new Set(ids).size !== ids.length) { dupCh++; if (samples.length < 3) samples.push(`dup ${b}:${c}`); }
        const empty = v.filter(x => !x.text || !String(x.text).trim());
        if (empty.length === v.length && v.length) { emptyCh++; if (samples.length < 3) samples.push(`empty-ch ${b}:${c}`); }
        for (const x of empty) {
          const key = `${b}:${c}:${x.verseId}`;
          if (+b >= 40 && NT_VARIANTS.has(key)) ntVariant++;
          else if (+b < 40) { otEmpty++; if (samples.length < 3) samples.push(`empty-OT ${b}:${c}:${x.verseId}`); }
          else ntVariant++;
        }
      }
    }
    const bad = parse.length || dupCh || emptyCh || otEmpty;
    if (bad) problems++;
    if (bad || showAll) {
      const tag = bad ? 'PROBLEM' : 'ok';
      const detail = bad
        ? `parseErrors=${parse.length} dupChapters=${dupCh} emptyChapters=${emptyCh} otEmptyVerses=${otEmpty}${ntVariant ? ` (ntVariants=${ntVariant} benign)` : ''} — ${samples.join(', ')}`
        : ntVariant ? `${ntVariant} benign NT-variant blanks` : 'clean';
      console.log(`${tag.padEnd(8)} ${m}: ${detail}`);
    }
  }
  console.log(`\n${targets.length} translations scanned, ${problems} with problems.`);
  process.exit(problems ? 1 : 0);
}

// Kjører bare når fila startes direkte, slik at import ikke har bivirkninger (#108).
if (import.meta.main) {
    main();
}
