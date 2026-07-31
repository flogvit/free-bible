#!/usr/bin/env bun
/**
 * Review helper: for a translation, print each real (non-identity) chapter with
 * osmain text, translation text, and the proposed mapping from its result file,
 * so a human can verify the alignment is correct.
 *
 * Flaggene går gjennom den felles kontrakten i generate/cli.ts; `--help` viser dem.
 * Argumentene er posisjonelle: <translation> [book:chapter]
 */
import fs from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parseArgs, formatHelp, COMMON_FLAGS } from '../../generate/cli.js';
import type { FlagSpec } from '../../generate/cli.js';
import type { Chapter } from '../src/bible-types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '../..');

/** Formen på kvn/data/mapping-results/<oversettelse>/<bok>-<kapittel>.json,
 *  slik build-mapping.ts skriver den (se ollamaSchema der). */
interface MappingResultEntry {
  translationVerse: number;
  osmainVerses: number[];
  matchType: string;
  note?: string;
}

interface MappingExtraContent {
  translationVerse: number;
  description: string;
}

interface MappingResult {
  mappings?: MappingResultEntry[];
  extraContent?: MappingExtraContent[];
}

interface MappingResultFile {
  key: string;
  result: MappingResult;
  needsReview?: boolean;
}

const SPEC: Record<string, FlagSpec> = {
  help: COMMON_FLAGS.help,
};

const HELP_EXAMPLES = [
  'bun kvn/scripts/review-mapping.ts <translation> [book:chapter]',
  'bun kvn/scripts/review-mapping.ts rv_1909_strongs',
  'bun kvn/scripts/review-mapping.ts rv_1909_strongs 4:13',
];

function main() {
  // Hjelpesjekken står først: gjennomgangen leser hele mapping-results-katalogen
  // og begge bibeltekstene, og `--help` skal ikke koste noe av det.
  const { flags, positional } = parseArgs(process.argv.slice(2), SPEC);
  if (flags.help) {
    console.log(formatHelp(
      'kvn/scripts/review-mapping.ts',
      'skriver ut hvert ikke-identisk kapittel med osmain-tekst, oversettelsestekst og foreslått mapping, til manuell kontroll',
      SPEC,
      HELP_EXAMPLES,
    ));
    process.exit(0);
  }

  const mod = positional[0];
  const chapterFilter = positional[1];
  if (!mod) { console.error('usage: bun kvn/scripts/review-mapping.ts <translation> [book:chapter]'); process.exit(1); }

  const resultsDir = join(REPO, 'kvn/data/mapping-results', mod);
  const verses = (m: string, b: string, c: string): Chapter => JSON.parse(fs.readFileSync(join(REPO, 'generate/bibles_raw', m, b, `${c}.json`), 'utf8'));

  const files = fs.readdirSync(resultsDir).filter(f => f.endsWith('.json') && !f.startsWith('_'));
  for (const f of files.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
    const { key, result, needsReview } = JSON.parse(fs.readFileSync(join(resultsDir, f), 'utf8')) as MappingResultFile;
    const [b, c] = key.split(':');
    if (chapterFilter && key !== chapterFilter) continue;
    // only show non-identity chapters (those with a real mapping)
    const os = verses('osmain', b, c), tr = verses(mod, b, c);
    const osSet = new Set(os.map(v => v.verseId)), trSet = new Set(tr.map(v => v.verseId));
    const identity = os.length === tr.length && os.every(v => trSet.has(v.verseId));
    if (identity) continue;
    const map = Object.fromEntries((result.mappings || []).map((m): [number, MappingResultEntry] => [m.translationVerse, m]));
    console.log(`\n===== ${mod} ${key} (osmain ${os.length}v, trans ${tr.length}v)${needsReview ? ' [needsReview]' : ''} =====`);
    const osById = Object.fromEntries(os.map((v): [number, string] => [v.verseId, v.text]));
    for (const t of tr) {
      const m = map[t.verseId];
      const to = m ? `-> osm ${m.osmainVerses.join(',')} (${m.matchType})` : '-> (identity)';
      const osTxt = m && m.osmainVerses.length ? (osById[m.osmainVerses[0]] || '').slice(0, 36) : '';
      console.log(`  t${String(t.verseId).padStart(3)} ${to.padEnd(24)} | ${t.text.slice(0, 34).padEnd(36)} | osm: ${osTxt}`);
    }
    if (result.extraContent?.length) console.log('  extraContent:', JSON.stringify(result.extraContent));
  }
}

// Kjører bare når fila startes direkte, slik at import ikke har bivirkninger (#108).
if (import.meta.main) {
    main();
}
