/**
 * Rangeringssignal: er det mapper-utpekte osmain-verset det som likner mest?
 *
 * På de 13 ekte feilene fra FUNN.md rangerte bge-m3 riktig vers over det gale
 * 13 av 13 — også der de absolutte likhetstallene var lave (basque Sal 110 lå
 * på 0,41-0,61 uansett). Rangering tåler at et språk gir svak absolutt likhet;
 * en terskel gjør det ikke.
 *
 * ⚠ MERK: dette bryter med «bare paret». Kandidatene er de andre osmain-versene
 * i kapitlet. De brukes som sammenlikningsgrunnlag, ikke til å diagnostisere hvor
 * teksten tok veien — men det er en gråsone og skal være et bevisst valg.
 *
 * Måles i to varianter:
 *   rank1   flagg hvis et annet osmain-vers i kapitlet likner mer
 *   margin  flagg hvis forspranget til nummer to er lite (usikker match)
 *
 *   bun rank.ts [antall-per-klasse]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const RAW = join(HERE, '../../../generate/bibles_raw');
const VERDICTS = join(HERE, `verdicts-n${Number(process.argv[2] ?? 6)}`);
const KINDS = ['OK', 'GRENSE', 'AVKORTET', 'FEILVERS', 'FLETTET'];
const N_PER = Number(process.argv[2] ?? 6);

const embed = async texts => {
  const r = await fetch('http://localhost:11434/api/embed', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'bge-m3', input: texts, keep_alive: '30m' }),
  });
  if (!r.ok) throw new Error(await r.text());
  return (await r.json()).embeddings.map(v => {
    let s = 0; for (const x of v) s += x * x; s = Math.sqrt(s) || 1;
    return Float32Array.from(v, x => x / s);
  });
};
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

// osmain-kapitlene testsettet er bygget fra
const CH = [[1, 22], [2, 20], [5, 6], [9, 17], [13, 1], [18, 3], [19, 23], [20, 10],
            [23, 53], [40, 5], [41, 4], [42, 15], [44, 2], [45, 8], [58, 11], [66, 7]];

// osmain-vers per kapittel, embeddet én gang og gjenbrukt
const chapters = [];
for (const [b, c] of CH) {
  const f = join(RAW, 'osmain', String(b), `${c}.json`);
  if (!existsSync(f)) continue;
  const verses = JSON.parse(readFileSync(f, 'utf8')).filter(v => v.text?.length > 20);
  if (verses.length < 4) continue;
  chapters.push({ b, c, verses, emb: await embed(verses.map(v => v.text)) });
}
console.log(`${chapters.length} osmain-kapitler embeddet`);

// A-teksten identifiserer hvilket kapittel og vers paret gjelder
const byText = new Map();
for (const ch of chapters) ch.verses.forEach((v, i) => byText.set(v.text, { ch, i }));

const rows = JSON.parse(readFileSync(join(HERE, 'testset.json'), 'utf8'));
const caseId = r => `${r.tr}|${r.kind}|${r.A.length}|${r.B.length}|${r.B.slice(0, 24)}`;
const byTr = new Map();
for (const r of rows) {
  if (!byTr.has(r.tr)) byTr.set(r.tr, new Map(KINDS.map(k => [k, []])));
  byTr.get(r.tr).get(r.kind)?.push(r);
}
const cases = [];
for (const [tr, m] of byTr) {
  for (const k of KINDS) {
    if (k === 'AVKORTET') continue;
    const pool = m.get(k).slice(4);
    const step = Math.max(1, Math.floor(pool.length / N_PER));
    for (let i = 0, n = 0; i < pool.length && n < N_PER; i += step, n++) cases.push({ ...pool[i], id: caseId(pool[i]) });
  }
}
console.log(`${cases.length} par\n`);

const out = [];
let done = 0, noChapter = 0;
for (const c of cases) {
  const hit = byText.get(c.A);
  if (!hit) { out.push({ ...c, rank: null, margin: null }); noChapter++; continue; }
  let eb;
  try { [eb] = await embed([c.B]); } catch { out.push({ ...c, rank: null, margin: null }); continue; }
  const sims = hit.ch.emb.map(e => dot(eb, e));
  const mine = sims[hit.i];
  const sorted = [...sims].sort((x, y) => y - x);
  out.push({
    ...c,
    rank: sims.filter(s => s > mine).length + 1,      // 1 = mappingens vers likner mest
    margin: mine - (sorted[0] === mine ? sorted[1] ?? mine : sorted[0]),
  });
  if (++done % 60 === 0) process.stdout.write(`\r  ${done}/${cases.length}`);
}
process.stdout.write('\r' + ' '.repeat(40) + '\r');
if (noChapter) console.log(`${noChapter} par uten kapittelkobling\n`);

mkdirSync(VERDICTS, { recursive: true });
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.floor(s.length * p)))]; };

console.log(`${'variant'.padEnd(18)} ${'falsk alarm'.padStart(12)} ${['GRENSE', 'FEILVERS', 'FLETTET'].map(k => k.padStart(10)).join('')}`);
const variants = [
  ['rank1', r => r.rank === null ? null : r.rank > 1],
];
const okMargins = out.filter(r => r.kind === 'OK' && r.margin !== null).map(r => r.margin);
for (const FA of [0.05, 0.10]) {
  const th = q(okMargins, FA);
  variants.push([`margin-fa${Math.round(FA * 100)}`, r => r.margin === null ? null : r.margin < th]);
}
for (const [name, f] of variants) {
  const verd = out.map(r => ({ id: r.id, tr: r.tr, kind: r.kind, flag: f(r) }));
  writeFileSync(join(VERDICTS, `signal-${name}.json`), JSON.stringify({ config: `signal-${name}`, cases: verd }));
  const pc = k => { const s = verd.filter(x => x.kind === k && x.flag !== null); return s.length ? `${(100 * s.filter(x => x.flag).length / s.length).toFixed(0)}%` : '-'; };
  console.log(`${name.padEnd(18)} ${pc('OK').padStart(12)} ${[pc('GRENSE'), pc('FEILVERS'), pc('FLETTET')].map(x => x.padStart(10)).join('')}`);
}
