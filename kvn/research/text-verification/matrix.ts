/**
 * Hovedmålingen: fire feiltyper × alle detektorer, samme testsett og kontrollgruppe.
 *
 * Feiltyper (laget i ekte data, ett vers om gangen):
 *   GRENSE   siste setningsledd i vers N flyttet til starten av N+1  (halv setning på avveie)
 *   FEILVERS mappingen peker på nabo i stedet for riktig vers          (ren identitetsfeil)
 *   FLETTET  oversettelsens vers rommer osmain N og N+1               (for lang)
 *   AVKORTET siste setningsledd borte, ikke noe sted                  (høstetap)
 *
 * Detektorer (alle strengt på paret osmain X ↔ oversettelsens Y):
 *   sim   bge-m3 cosinus
 *   simZ  samme, som avvik fra oversettelsens egen fordeling
 *   len   lengderatio normalisert mot oversettelsens median
 *
 * Terskler settes slik at hver detektor får SAMME falske alarm på kontrollgruppa,
 * ellers er tallene ikke sammenliknbare.
 */
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { Chapter } from '../../src/bible-types.js';

/** Én måling: paret osmain-vers ↔ oversettelsens (muligens forstyrrede) vers. */
interface Row {
  tr: string;
  /** OK | GRENSE | FEILVERS | FLETTET | AVKORTET */
  kind: string;
  sim: number;
  simZ: number;
  len: number;
  A: string;
  B: string;
}

/** [kind, tekst] — varianten som måles mot osmain-verset. */
type Variant = [string, string];

const RAW = join(dirname(fileURLToPath(import.meta.url)), '../../../generate/bibles_raw');
const HERE = dirname(fileURLToPath(import.meta.url));
const ch = (m: string, b: number, c: number): Chapter | null => { const f = join(RAW, m, String(b), `${c}.json`); return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null; };

const embed = async (t: string[]): Promise<number[][]> => {
  const r = await fetch('http://localhost:11434/api/embed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'bge-m3', input: t }) });
  if (!r.ok) throw new Error(await r.text());
  return (await r.json() as { embeddings: number[][] }).embeddings.map(v => { let s = 0; for (const x of v) s += x * x; s = Math.sqrt(s) || 1; return v.map(x => x / s); });
};
const dot = (a: number[], b: number[]): number => a.reduce((s, x, i) => s + x * b[i], 0);
const median = (a: number[]): number => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const mad = (a: number[], m: number): number => 1.4826 * median(a.map(x => Math.abs(x - m))) || 1e-9;

function splitLast(text: string): [string, string, number] | null {
  const m = [...text.matchAll(/[,;:.!?।॥။၊]\s+/g)];
  if (!m.length) return null;
  const c = m[m.length - 1];
  const head = text.slice(0, c.index + c[0].length).trim(), tail = text.slice(c.index + c[0].length).trim();
  if (head.length < 20 || tail.length < 15) return null;
  return [head, tail, tail.length / text.length];
}

// bredt utvalg: språkfamilier, skriftsystemer, og sjangre (lov/fortelling/poesi/profeti/brev/slektstavle)
// Standardsettet dekker likhet 0,66-0,87. Korpuset har oversettelser langt under
// det — hcv (haitisk kreol) ligger på 0,573 og maori på 0,607 — og der er ALLE
// bge-m3-baserte signaler svakere. Måles de ikke, gjelder tallene bare halve
// korpuset.  --tr a,b,c  bytter settet,  --out fil  skriver et eget testsett.
const ARG = process.argv.slice(2);
const OPT = (n: string, d: string): string => { const i = ARG.indexOf(n); return i >= 0 ? ARG[i + 1] : d; };
const TR = OPT('--tr', 'spanish,russian_synodal,korean,thai,burmese,vietnamese_vie,amharic,akjv,german_luther1912,awadhi,bashkir2023,swahili1850').split(',');
const OUTFILE = OPT('--out', 'matrix.json');
const CH = [[1, 22], [2, 20], [5, 6], [9, 17], [13, 1], [18, 3], [19, 23], [20, 10],
            [23, 53], [40, 5], [41, 4], [42, 15], [44, 2], [45, 8], [58, 11], [66, 7]];

const rows: Row[] = [];   // {tr, kind, sim, len}  kind: OK | GRENSE | FEILVERS | FLETTET | AVKORTET

for (const tr of TR) {
  const simsOK: number[] = [], lensOK: number[] = [];
  const local: { osT: string; variants: Variant[] }[] = [];
  for (const [b, c] of CH) {
    const os = ch('osmain', b, c), t = ch(tr, b, c);
    if (!os || !t) continue;
    const tById = new Map(t.map((v): [number, string] => [v.verseId, v.text]));
    const osById = new Map(os.map((v): [number, string] => [v.verseId, v.text]));

    for (const v of os) {
      const osT = v.text, trT = tById.get(v.verseId);
      const trNext = tById.get(v.verseId + 1), osNext = osById.get(v.verseId + 1);
      if (!osT || !trT || osT.length < 60 || trT.length < 30) continue;

      const variants: Variant[] = [['OK', trT]];
      const sp = splitLast(trT);
      if (sp) {
        variants.push(['GRENSE', sp[0]]);         // slutten står nå i neste vers
        variants.push(['AVKORTET', sp[0]]);       // slutten er borte  (samme B-tekst, ulik årsak)
      }
      if (trNext) variants.push(['FEILVERS', trNext]);
      if (trNext) variants.push(['FLETTET', trT + ' ' + trNext]);

      // FEILVERS og FLETTET måles mot osmain N; GRENSE/AVKORTET har samme B-tekst,
      // så de gir identiske tall for sim/len — de skilles først av en dommer som
      // ser naboen, og det er utenfor oppgaven. Vi rapporterer dem samlet som KORT.
      local.push({ osT, variants });
    }
  }
  if (local.length < 40) { console.log(`${tr}: for lite data (${local.length})`); continue; }

  // embed i bolker
  const texts: string[] = [], idx: [number, number][] = [];
  for (const L of local) { idx.push([texts.length, L.variants.length]); texts.push(L.osT, ...L.variants.map(x => x[1])); }
  const embs: number[][] = [];
  for (let i = 0; i < texts.length; i += 96) embs.push(...await embed(texts.slice(i, i + 96)));

  let p = 0;
  const raw: Omit<Row, 'tr' | 'simZ'>[] = [];
  for (const L of local) {
    const eOs = embs[p++];
    for (const [kind, text] of L.variants) {
      const sim = dot(eOs, embs[p++]);
      const len = text.length / L.osT.length;
      raw.push({ kind, sim, len, A: L.osT, B: text });
    }
  }
  const okSim = raw.filter(r => r.kind === 'OK').map(r => r.sim);
  const okLen = raw.filter(r => r.kind === 'OK').map(r => r.len);
  const mS = median(okSim), sS = mad(okSim, mS), mL = median(okLen);
  for (const r of raw) rows.push({ tr, kind: r.kind, sim: r.sim, simZ: (r.sim - mS) / sS, len: r.len / mL, A: r.A, B: r.B });
  console.log(`${tr.padEnd(20)} ${raw.filter(r => r.kind === 'OK').length} vers  median sim ${mS.toFixed(3)}  spredning ${sS.toFixed(3)}  median lengderatio ${mL.toFixed(2)}`);
}

writeFileSync(join(HERE, OUTFILE), JSON.stringify(rows));

// ---- terskler kalibrert til lik falsk alarm, så detektorene er sammenliknbare ----
const KINDS = ['GRENSE', 'AVKORTET', 'FEILVERS', 'FLETTET'];
const ok = rows.filter(r => r.kind === 'OK');
console.log(`\n${rows.length} målinger, ${ok.length} kontroll\n`);

function calib(get: (r: Row) => number, dir: number, faTarget: number): number {
  const vals = ok.map(get).sort((a, b) => a - b);
  return dir < 0 ? vals[Math.floor(vals.length * faTarget)] : vals[Math.ceil(vals.length * (1 - faTarget)) - 1];
}
const DET: [string, (r: Row) => number, number][] = [
  ['sim  (absolutt)', r => r.sim, -1],
  ['simZ (per oversettelse)', r => r.simZ, -1],
  ['len  (for kort)', r => r.len, -1],
  ['len  (for lang)', r => r.len, +1],
];

for (const fa of [0.01, 0.05]) {
  console.log(`=== ved ${(fa * 100).toFixed(0)} % falsk alarm på kontrollgruppa ===`);
  console.log(`  ${'detektor'.padEnd(26)} ${KINDS.map(k => k.padStart(9)).join('')}`);
  for (const [name, get, dir] of DET) {
    const th = calib(get, dir, fa);
    const hit = (r: Row) => dir < 0 ? get(r) < th : get(r) > th;
    const cells = KINDS.map(k => {
      const s = rows.filter(r => r.kind === k);
      return s.length ? `${(100 * s.filter(hit).length / s.length).toFixed(0)}%`.padStart(9) : '-'.padStart(9);
    });
    console.log(`  ${name.padEnd(26)} ${cells.join('')}`);
  }
  // kombinert: slår ut hvis NOEN av dem slår ut (falsk alarm blir da høyere — rapporteres)
  const ths = DET.map(([, get, dir]): [(r: Row) => number, number, number] => [get, dir, calib(get, dir, fa / DET.length)]);
  const any = (r: Row) => ths.some(([get, dir, th]) => dir < 0 ? get(r) < th : get(r) > th);
  const faReal = 100 * ok.filter(any).length / ok.length;
  console.log(`  ${'alle kombinert'.padEnd(26)} ${KINDS.map(k => { const s = rows.filter(r => r.kind === k); return `${(100 * s.filter(any).length / s.length).toFixed(0)}%`.padStart(9); }).join('')}   (reell falsk alarm ${faReal.toFixed(1)} %)\n`);
}
