/**
 * Bomrate stratifisert etter hvor stor del av verset som flyttet.
 *
 * Et vers der 15 % av innholdet ligger i naboen er knapt en mappingfeil — det er
 * en oversetter som brøt setningen et annet sted. De ekte grensefeilene i FINDINGS.md
 * (1 Sam 20,42, 4 Mos 25,18) er hele setningsledd som utvetydig hører til det
 * andre verset. Ett samlet gjennomsnitt over 15-100 % skjuler den forskjellen.
 *
 * Andelen rekonstrueres fra testsettet: alle varianter av samme kildevers deler
 * A-tekst, så OK-variantens B er det hele verset og GRENSE-variantens B er stubben.
 *
 *   bun strata.ts [verdict-fil ...]
 */
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

/** En rad i testset.json: et par (A = osmain-vers, B = oversettelsens vers). */
interface Row {
  tr: string;
  kind: string;
  sim: number;
  simZ: number;
  len: number;
  A: string;
  B: string;
}

/** Én dom over ett par, slik den ligger i domsfilene under VERDICTS. */
interface VerdictCase {
  id: string;
  tr: string;
  kind: string;
  flag: boolean | null;
  verdict?: string;
}

/** Én kjøring: en konfigurasjon med dommene sine. */
interface Run {
  config: string;
  cases: VerdictCase[];
}

const HERE = dirname(fileURLToPath(import.meta.url));
const DIRARG = process.argv.indexOf('--dir');
const VERDICTS = join(HERE, DIRARG >= 0 ? process.argv[DIRARG + 1] : 'verdicts-n6');

// --- andel flyttet per GRENSE-par, via felles A-tekst ---
const rows: Row[] = JSON.parse(readFileSync(join(HERE, 'testset.json'), 'utf8'));
const fullFor = new Map<string, string>();        // tr|A → hele B-teksten
for (const r of rows) if (r.kind === 'OK') fullFor.set(`${r.tr}|${r.A}`, r.B);

const caseId = (r: Row): string => `${r.tr}|${r.kind}|${r.A.length}|${r.B.length}|${r.B.slice(0, 24)}`;
const fracById = new Map<string, number>();
for (const r of rows) {
  if (r.kind !== 'GRENSE') continue;
  const full = fullFor.get(`${r.tr}|${r.A}`);
  if (!full || full.length <= r.B.length) continue;
  fracById.set(caseId(r), 1 - r.B.length / full.length);
}
console.log(`andel flyttet rekonstruert for ${fracById.size} GRENSE-par\n`);

const named = process.argv.slice(2).filter((a, i, arr) =>
  !a.startsWith('--') && !(i > 0 && arr[i - 1].startsWith('--')));
const files = named.length
  ? named.map(f => f.replace(/^.*\//, ''))
  : readdirSync(VERDICTS).filter(f => f.endsWith('.json'));
const runs: Run[] = files.map(f => JSON.parse(readFileSync(join(VERDICTS, f), 'utf8')));

function union(sel: Run[]): VerdictCase[] {
  const byId = new Map<string, VerdictCase>();
  for (const r of sel) for (const c of r.cases) {
    const cur = byId.get(c.id);
    if (!cur) byId.set(c.id, { ...c });
    else if (c.flag === true) cur.flag = true;
    else if (cur.flag === null && c.flag !== null) cur.flag = c.flag;
  }
  return [...byId.values()];
}

const BANDS: [number, number][] = [[0.15, 0.25], [0.25, 0.40], [0.40, 0.60], [0.60, 1.01]];
const label = ([lo, hi]: [number, number]): string => `${(lo * 100).toFixed(0)}-${Math.min(100, hi * 100).toFixed(0)} %`;

function report(name: string, cases: VerdictCase[]): void {
  const g = cases.filter(c => c.kind === 'GRENSE' && c.flag !== null && fracById.has(c.id));
  if (!g.length) return;
  const cells = BANDS.map(b => {
    const s = g.filter(c => { const f = fracById.get(c.id)!; return f >= b[0] && f < b[1]; });
    return s.length ? `${(100 * s.filter(c => c.flag).length / s.length).toFixed(0)}% (${s.length})`.padStart(12) : '-'.padStart(12);
  });
  console.log(`${name.slice(0, 32).padEnd(32)} ${cells.join('')}`);
}

console.log(`${'konfigurasjon'.padEnd(32)} ${BANDS.map(b => label(b).padStart(12)).join('')}`);
console.log('-'.repeat(32 + 12 * BANDS.length));
for (const r of runs) report(r.config, r.cases);
console.log('-'.repeat(32 + 12 * BANDS.length));
report('ALLE KOMBINERT (ELLER)', union(runs));
console.log(`\n(prosent = fanget. Tall i parentes = antall par i båndet.)`);
