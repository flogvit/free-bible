/**
 * Felles mekanisk skår — ingen GPU, alt regnes fra tall som allerede ligger i
 * testsettet.
 *
 * To forbedringer over de enkle tersklene:
 *
 *  1. Lengderatioen støyer mye mer for korte vers enn for lange. Et vers på 40
 *     tegn kan variere 50 % uten at noe er galt; et på 300 tegn kan ikke det.
 *     Så forventning og spredning estimeres per LENGDEBÅND, ikke globalt.
 *
 *  2. `sim` og `len` er brukt som to uavhengige terskler. Men et vers som er
 *     BÅDE kortere og mindre likt enn ventet er langt mer mistenkelig enn ett
 *     som bare er det ene. Vi slår dem sammen til én avstand.
 *
 *   bun joint.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

/** En rad i testset.json. */
interface Row {
  tr: string;
  kind: string;
  sim: number;
  simZ: number;
  len: number;
  A: string;
  B: string;
}
type Case = Row & { id: string };
interface ZScore { zl: number; zs: number }
type ScoredCase = Case & { z: ZScore };

const HERE = dirname(fileURLToPath(import.meta.url));
const VERDICTS = join(HERE, `verdicts-n${Number((process.argv.indexOf('--n')>=0)?process.argv[process.argv.indexOf('--n')+1]:6)}`);
const KINDS = ['OK', 'GRENSE', 'AVKORTET', 'FEILVERS', 'FLETTET'];
const N_PER = Number(process.argv.includes('--n') ? process.argv[process.argv.indexOf('--n') + 1] : 6);

const rows: Row[] = JSON.parse(readFileSync(join(HERE, 'testset.json'), 'utf8'));
const caseId = (r: Row) => `${r.tr}|${r.kind}|${r.A.length}|${r.B.length}|${r.B.slice(0, 24)}`;

// samme utvalg som run.mjs
const byTr = new Map<string, Map<string, Row[]>>();
for (const r of rows) {
  if (!byTr.has(r.tr)) byTr.set(r.tr, new Map(KINDS.map((k): [string, Row[]] => [k, []])));
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

const median = (a: number[]) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const mad = (a: number[], m: number) => 1.4826 * median(a.map(x => Math.abs(x - m))) || 1e-6;

// --- referansefordeling bygges på HELE testsettets OK-rader, ikke bare utvalget ---
const BANDS: [number, number][] = [[0, 80], [80, 160], [160, 320], [320, 1e9]];
const bandOf = (len: number) => BANDS.findIndex(([lo, hi]) => len >= lo && len < hi);

const ref = new Map<string, { l: number[]; s: number[] }>();   // tr|band → {lm, ls, sm, ss}
for (const r of rows) {
  if (r.kind !== 'OK') continue;
  const key = `${r.tr}|${bandOf(r.A.length)}`;
  if (!ref.has(key)) ref.set(key, { l: [], s: [] });
  ref.get(key)!.l.push(r.len);
  ref.get(key)!.s.push(r.sim);
}
const stats = new Map<string, { lm: number; ls: number; sm: number; ss: number }>();
for (const [key, v] of ref) {
  if (v.l.length < 20) continue;
  const lm = median(v.l), sm = median(v.s);
  stats.set(key, { lm, ls: mad(v.l, lm), sm, ss: mad(v.s, sm) });
}
console.log(`referansefordeling for ${stats.size} (oversettelse × lengdebånd)-celler\n`);

function score(r: Row): ZScore | null {
  const st = stats.get(`${r.tr}|${bandOf(r.A.length)}`);
  if (!st) return null;
  return {
    zl: (r.len - st.lm) / st.ls,       // negativ = kortere enn ventet
    zs: (r.sim - st.sm) / st.ss,       // negativ = mindre likt enn ventet
  };
}

// `filter(c => c.z)` fjerner nettopp de radene der z er null; assertion-en sier bare det.
const scored = cases.map(c => ({ ...c, z: score(c) })).filter(c => c.z) as ScoredCase[];
const ok = scored.filter(c => c.kind === 'OK');
const q = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.floor(s.length * p)))]; };

/**
 * Tre varianter, alle kalibrert til samme falske alarm på kontrollgruppa:
 *   kort   bare lengde, per lengdebånd
 *   felles kortere OG mindre lik — euklidsk avstand i den negative kvadranten
 *   lang   lengre enn ventet (fletting)
 */
const VARIANTS: Record<string, (c: ScoredCase) => number> = {
  'joint-kort': c => -Math.min(0, c.z.zl),
  'joint-felles': c => Math.hypot(Math.min(0, c.z.zl), Math.min(0, c.z.zs)),
  'joint-lang': c => Math.max(0, c.z.zl),
};

mkdirSync(VERDICTS, { recursive: true });
console.log(`${'variant'.padEnd(16)} ${'terskel'.padStart(8)} ${'falsk alarm'.padStart(12)} ${['GRENSE', 'FEILVERS', 'FLETTET'].map(k => k.padStart(10)).join('')}`);
for (const FA of [0.01, 0.03]) {
  for (const [name, f] of Object.entries(VARIANTS)) {
    const th = q(ok.map(f), 1 - FA);
    const verd = scored.map(c => ({ id: c.id, tr: c.tr, kind: c.kind, flag: f(c) > th }));
    const key = `${name}-fa${Math.round(FA * 100)}`;
    writeFileSync(join(VERDICTS, `signal-${key}.json`), JSON.stringify({ config: `signal-${key}`, threshold: th, cases: verd }));
    const pc = (k: string) => { const s = verd.filter(x => x.kind === k); return s.length ? `${(100 * s.filter(x => x.flag).length / s.length).toFixed(0)}%` : '-'; };
    console.log(`${key.padEnd(16)} ${th.toFixed(2).padStart(8)} ${pc('OK').padStart(12)} ${[pc('GRENSE'), pc('FEILVERS'), pc('FLETTET')].map(x => x.padStart(10)).join('')}`);
  }
}
