/**
 * Leddekning — strengt innenfor paret.
 *
 *   dekning(A,B) = min over ledd a i A av ( max over ledd b i B av cos(a,b) )
 *
 * Helvers-cosinus midler bort et manglende ledd: stemmer to av tre, holder
 * tallet seg oppe. Deles versene i ledd, er et udekket ledd 100 % av sitt eget
 * signal i stedet for 33 % av versets.
 *
 * To ting lært av de første bommene:
 *
 *  1. RESERVEOPPDELING. `awadhi` Rom 8,1 slapp gjennom fordi osmain-verset ikke
 *     har indre tegnsetting — oppdelingen ga ett ledd, og paret ble hoppet over.
 *     Vers uten skilletegn deles nå på lengde i stedet.
 *
 *  2. FLERE TERSKLER. `burmese` Luk 15,16 slapp gjennom fordi terskelen var
 *     kalibrert til 0 % falsk alarm. Vi lager både en bevis-variant (0 %) og en
 *     nett-variant (noen få prosent), og lar ensemblet velge.
 *
 *   bun coverage.ts [antall-per-klasse]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const VERDICTS = join(HERE, `verdicts-n${Number(process.argv[2] ?? 6)}`);
const KINDS = ['OK', 'GRENSE', 'AVKORTET', 'FEILVERS', 'FLETTET'];
const N_PER = Number(process.argv[2] ?? 6);

/**
 * Del i setningsledd. Uten skilletegn: del på lengde, så vi alltid får ≥2 biter.
 *
 * minLen=30 HER, men 15 i backtranslate.mjs — og det er ikke en inkonsistens.
 * Et kort ledd («men ingen ga ham noe.», 24 tegn) bærer ofte nettopp det som
 * mangler ved en grensefeil, så lav terskel er riktig når begge sider er samme
 * språk. På tvers av språk finnes ingen pålitelig motpart til et så kort ledd —
 * kontrollfordelingen brer seg ut og terskelen faller. Målt: minLen=15 tok
 * covA-fa1 fra 23 % til 3 % på GRENSE og fra 58 % til 4 % på FEILVERS.
 */
function clauses(text, minLen = 30) {
  const parts = text.split(/(?<=[,;:.!?।॥။၊、，；：])\s+/);
  const out = [];
  for (const p of parts) {
    if (out.length && out[out.length - 1].length < minLen) out[out.length - 1] += ' ' + p;
    else out.push(p);
  }
  while (out.length > 1 && out[out.length - 1].length < minLen) out[out.length - 2] += ' ' + out.pop();
  const trimmed = out.map(s => s.trim()).filter(s => s.length >= 8);
  if (trimmed.length >= 2) return trimmed;

  // reserveoppdeling: to halvdeler på nærmeste ordgrense
  const t = text.trim();
  if (t.length < 2 * minLen) return trimmed.length ? trimmed : [t];
  const mid = Math.floor(t.length / 2);
  const sp = t.lastIndexOf(' ', mid);
  const cut = sp > minLen && t.length - sp > minLen ? sp : mid;
  return [t.slice(0, cut).trim(), t.slice(cut).trim()].filter(s => s.length >= 8);
}

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
let done = 0, skipped = 0;
for (const c of cases) {
  const ca = clauses(c.A), cb = clauses(c.B);
  if (ca.length < 2 || !cb.length) { out.push({ ...c, covA: null, covB: null }); skipped++; continue; }
  let embs;
  try { embs = await embed([...ca, ...cb]); } catch { out.push({ ...c, covA: null, covB: null }); continue; }
  const ea = embs.slice(0, ca.length), eb = embs.slice(ca.length);
  out.push({
    ...c,
    covA: Math.min(...ea.map(a => Math.max(...eb.map(b => dot(a, b))))),
    covB: Math.min(...eb.map(b => Math.max(...ea.map(a => dot(a, b))))),
  });
  if (++done % 60 === 0) process.stdout.write(`\r  ${done}/${cases.length}`);
}
process.stdout.write('\r' + ' '.repeat(40) + '\r');
console.log(`${skipped} par uten brukbar oppdeling\n`);

const median = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.floor(s.length * p)))]; };

const base = new Map();
for (const r of out) {
  if (r.kind !== 'OK' || r.covA === null) continue;
  if (!base.has(r.tr)) base.set(r.tr, { a: [], b: [] });
  base.get(r.tr).a.push(r.covA); base.get(r.tr).b.push(r.covB);
}
for (const r of out) {
  const s = base.get(r.tr);
  r.zA = s && r.covA !== null ? r.covA - median(s.a) : null;
  r.zB = s && r.covB !== null ? r.covB - median(s.b) : null;
}

mkdirSync(VERDICTS, { recursive: true });
console.log(`${'variant'.padEnd(18)} ${'falsk alarm'.padStart(12)} ${['GRENSE', 'FEILVERS', 'FLETTET'].map(k => k.padStart(10)).join('')}`);
for (const [name, get] of [['covA', r => r.zA], ['covB', r => r.zB]]) {
  for (const FA of [0.01, 0.05, 0.10]) {
    const ok = out.filter(r => r.kind === 'OK' && get(r) !== null).map(get);
    if (!ok.length) continue;
    const th = q(ok, FA);
    const verd = out.map(r => ({ id: r.id, tr: r.tr, kind: r.kind, flag: get(r) === null ? null : get(r) < th }));
    const key = `${name}-fa${Math.round(FA * 100)}`;
    writeFileSync(join(VERDICTS, `signal-${key}.json`), JSON.stringify({ config: `signal-${key}`, threshold: th, cases: verd }));
    const pc = k => { const s = verd.filter(x => x.kind === k && x.flag !== null); return s.length ? `${(100 * s.filter(x => x.flag).length / s.length).toFixed(0)}%` : '-'; };
    console.log(`${key.padEnd(18)} ${pc('OK').padStart(12)} ${[pc('GRENSE'), pc('FEILVERS'), pc('FLETTET')].map(x => x.padStart(10)).join('')}`);
  }
}
