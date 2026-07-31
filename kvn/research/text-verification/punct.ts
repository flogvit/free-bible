/**
 * Avbrutt setning — per oversettelse kalibrert.
 *
 * Et vers som ender på komma der oversettelsen ellers nesten aldri gjør det, er
 * en avbrutt setning. Signalet er gratis og nesten språkuavhengig i FORM, men
 * helt språkavhengig i STYRKE: awadhi avslutter 79 % av sine ekte vers med
 * komma, thai og amharisk 0 %. Terskelen må derfor være per oversettelse.
 *
 * ⚠ GJENKALLET KAN IKKE MÅLES PÅ DETTE TESTSETTET. Perturbasjonen kutter ved et
 * skilletegn og beholder det, så GRENSE-versene ender på komma ved konstruksjon
 * (87,6 % mot 16,3 % for ekte vers). Tallet ville se strålende ut og si
 * ingenting. Falsk alarm-siden er derimot artefaktfri og kan leses som den er.
 * Ekte gjenkall må måles mot ekte avkortninger, ikke mot mine egne.
 *
 *   bun punct.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
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

/** Et utvalgt par, med den avledede identifikatoren dommene deles på. */
interface Case extends Row {
  id: string;
}

/** Basislinje per oversettelse: hvor ofte ekte vers ender på et åpent skilletegn. */
interface Base {
  n: number;
  open: number;
}

interface Verdict {
  id: string;
  tr: string;
  kind: string;
  flag: boolean | null;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const VERDICTS = join(HERE, `verdicts-n${Number((process.argv.indexOf('--n')>=0)?process.argv[process.argv.indexOf('--n')+1]:6)}`);
const KINDS = ['OK', 'GRENSE', 'AVKORTET', 'FEILVERS', 'FLETTET'];
const N_PER = Number(process.argv.includes('--n') ? process.argv[process.argv.indexOf('--n') + 1] : 6);

// skilletegn som IKKE avslutter en setning, på tvers av skriftsystemer
const OPEN = /[,;:،؛۔॥।၊、，；：]\s*$/;

const rows: Row[] = JSON.parse(readFileSync(join(HERE, 'testset.json'), 'utf8'));
const caseId = (r: Row): string => `${r.tr}|${r.kind}|${r.A.length}|${r.B.length}|${r.B.slice(0, 24)}`;

// basislinje per oversettelse fra HELE korpuset av ekte vers, ikke fra utvalget
const base = new Map<string, Base>();
for (const r of rows) {
  if (r.kind !== 'OK') continue;
  if (!base.has(r.tr)) base.set(r.tr, { n: 0, open: 0 });
  const b = base.get(r.tr)!;
  b.n++; if (OPEN.test(r.B)) b.open++;
}

const byTr = new Map<string, Map<string, Row[]>>();
for (const r of rows) {
  if (!byTr.has(r.tr)) byTr.set(r.tr, new Map<string, Row[]>(KINDS.map(k => [k, []])));
  byTr.get(r.tr)!.get(r.kind)?.push(r);
}
const cases: Case[] = [];
for (const [tr, m] of byTr) {
  for (const k of KINDS) {
    if (k === 'AVKORTET') continue;
    const pool = m.get(k)!.slice(4);
    const step = Math.max(1, Math.floor(pool.length / N_PER));
    for (let i = 0, n = 0; i < pool.length && n < N_PER; i += step, n++) cases.push({ ...pool[i], id: caseId(pool[i]) });
  }
}

// Signalet gjelder bare der oversettelsen normalt AVSLUTTER versene sine.
// Over grensen er et komma ikke informativt og vi sier ingenting (null).
const MAX_BASE = 0.15;
mkdirSync(VERDICTS, { recursive: true });
const verd: Verdict[] = cases.map(c => {
  const b = base.get(c.tr);
  const rate = b ? b.open / b.n : 1;
  return { id: c.id, tr: c.tr, kind: c.kind, flag: rate > MAX_BASE ? null : OPEN.test(c.B) };
});
writeFileSync(join(VERDICTS, 'signal-punct.json'), JSON.stringify({
  config: 'signal-punct', note: 'gjenkall ikke målbart på dette testsettet — se filhode',
  baseRates: Object.fromEntries([...base].map(([k, v]) => [k, +(v.open / v.n).toFixed(3)])),
  cases: verd,
}));

const active = [...base].filter(([, v]) => v.open / v.n <= MAX_BASE).map(([k]) => k);
console.log(`signalet er aktivt for ${active.length} av ${base.size} oversettelser:`);
console.log('  ' + active.join(', '));
console.log(`  (av for: ${[...base].filter(([, v]) => v.open / v.n > MAX_BASE).map(([k]) => k).join(', ')})\n`);

const pc = (k: string): string => {
  const s = verd.filter(x => x.kind === k && x.flag !== null);
  return s.length ? `${(100 * s.filter(x => x.flag).length / s.length).toFixed(0)}% (n=${s.length})` : '-';
};
console.log(`  falsk alarm : ${pc('OK')}     ← artefaktfri, kan leses som den er`);
console.log(`  GRENSE      : ${pc('GRENSE')}  ← OPPBLÅST av konstruksjonen, ikke et resultat`);
console.log(`  FEILVERS    : ${pc('FEILVERS')}`);
console.log(`  FLETTET     : ${pc('FLETTET')}`);
