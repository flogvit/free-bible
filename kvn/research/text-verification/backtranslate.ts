/**
 * Tilbakeoversettelse: gjør den kryssspråklige sammenlikningen enspråklig.
 *
 * Leddekning på tvers av språk støyet fordi setningsledd ikke faller på samme
 * sted i norsk og i målspråket — terskelen måtte settes så lavt at bare 13 % av
 * grensefeilene ble fanget. Oversetter vi først B til norsk, kan leddene stilles
 * opp mot hverandre for alvor.
 *
 *   B  --(lokal modell)-->  B'  (norsk)
 *   så: cosinus(A, B') og leddekning(A, B') — begge enspråklig
 *
 * For dyrt til det uttømmende laget (én generering per vers), men det er akkurat
 * det runde to skal være: dyrt, og bare på det som allerede er flagget.
 *
 *   bun backtranslate.ts [modell] [--n 6]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const VERDICTS = join(HERE, `verdicts-n${Number(process.argv.includes('--n') ? process.argv[process.argv.indexOf('--n')+1] : 6)}`);
const KINDS = ['OK', 'GRENSE', 'AVKORTET', 'FEILVERS', 'FLETTET'];
const argv = process.argv.slice(2);
const model = argv.find(a => !a.startsWith('--')) ?? 'gemma4:31b';
const N_PER = Number(argv.includes('--n') ? argv[argv.indexOf('--n') + 1] : 6);

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
console.log(`${cases.length} par, tilbakeoversetter med ${model}\n`);

const schema = { type: 'object', properties: { norwegian: { type: 'string' } }, required: ['norwegian'] };
async function backtranslate(text) {
  try {
    const r = await fetch('http://localhost:11434/api/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model, stream: false, think: false, format: schema, keep_alive: '30m',
        options: { temperature: 0, num_predict: 700, num_ctx: 4096 },
        // Bevisst ordrett: vi skal måle innhold, ikke stil. En fri gjengivelse
        // ville lagt til eller trukket fra og forurenset målingen.
        prompt: `Translate this Bible verse into Norwegian bokmål.

Translate literally, clause by clause. Do not add anything that is not there.
Do not omit anything that is there. Do not smooth the style.

${text}`,
      }),
    });
    if (!r.ok) return null;
    return JSON.parse((await r.json()).response).norwegian?.trim() || null;
  } catch { return null; }
}

const embed = async t => {
  const r = await fetch('http://localhost:11434/api/embed', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'bge-m3', input: t }),
  });
  return (await r.json()).embeddings.map(v => { let s = 0; for (const x of v) s += x * x; s = Math.sqrt(s) || 1; return Float32Array.from(v, x => x / s); });
};
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

function clauses(text, minLen = 15) {
  const parts = text.split(/(?<=[,;:.!?])\s+/);
  const out = [];
  for (const p of parts) {
    if (out.length && out[out.length - 1].length < minLen) out[out.length - 1] += ' ' + p;
    else out.push(p);
  }
  while (out.length > 1 && out[out.length - 1].length < minLen) out[out.length - 2] += ' ' + out.pop();
  return out.map(s => s.trim()).filter(s => s.length >= 8);
}

const out = [];
const t0 = Date.now();
for (let i = 0; i < cases.length; i++) {
  const c = cases[i];
  const bt = await backtranslate(c.B);
  if (!bt) { out.push({ ...c, sim2: null, cov2: null }); continue; }
  const ca = clauses(c.A), cb = clauses(bt);
  const embs = await embed([c.A, bt, ...ca, ...cb]);
  const sim2 = dot(embs[0], embs[1]);
  let cov2 = null;
  if (ca.length && cb.length) {
    const ea = embs.slice(2, 2 + ca.length), eb = embs.slice(2 + ca.length);
    cov2 = Math.min(...ea.map(a => Math.max(...eb.map(b => dot(a, b)))));
  }
  out.push({ ...c, bt, sim2, cov2 });
  if ((i + 1) % 20 === 0) {
    const el = (Date.now() - t0) / 1000;
    process.stdout.write(`\r  ${i + 1}/${cases.length}  ${(el / (i + 1)).toFixed(1)}s/par  ~${((cases.length - i - 1) * el / (i + 1) / 60).toFixed(0)} min igjen`);
  }
}
process.stdout.write('\r' + ' '.repeat(78) + '\r');

// normalisér per oversettelse, terskel på kontrollgruppa
const median = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.floor(s.length * p)))]; };
const base = new Map();
for (const r of out) {
  if (r.kind !== 'OK' || r.sim2 === null) continue;
  if (!base.has(r.tr)) base.set(r.tr, { s: [], c: [] });
  base.get(r.tr).s.push(r.sim2);
  if (r.cov2 !== null) base.get(r.tr).c.push(r.cov2);
}
for (const r of out) {
  const b = base.get(r.tr);
  r.zs = b && r.sim2 !== null ? r.sim2 - median(b.s) : null;
  r.zc = b && r.cov2 !== null && b.c.length ? r.cov2 - median(b.c) : null;
}

mkdirSync(VERDICTS, { recursive: true });

// Tilbakeoversettelsene lagres for seg. To grunner: en dommer kan kjøres på dem
// uten å generere på nytt, og de er LESBARE — når et vers flagges i et språk
// ingen på prosjektet kan, er det forskjellen på en arbeidsliste og en ubrukelig
// liste at man ser hva verset faktisk sier.
writeFileSync(join(HERE, 'backtranslations.json'), JSON.stringify(
  out.filter(r => r.bt).map(r => ({ id: r.id, tr: r.tr, kind: r.kind, A: r.A, B: r.B, bt: r.bt }))
));

console.log(`${'variant'.padEnd(22)} ${'falsk alarm'.padStart(12)} ${['GRENSE', 'FEILVERS', 'FLETTET'].map(k => k.padStart(10)).join('')}`);
for (const [name, get] of [['bt-sim', r => r.zs], ['bt-dekning', r => r.zc]]) {
  for (const FA of [0.01, 0.05]) {
    const ok = out.filter(r => r.kind === 'OK' && get(r) !== null).map(get);
    if (!ok.length) continue;
    const th = q(ok, FA);
    const verd = out.map(r => ({ id: r.id, tr: r.tr, kind: r.kind, flag: get(r) === null ? null : get(r) < th }));
    const key = `${name}-fa${Math.round(FA * 100)}`;
    writeFileSync(join(VERDICTS, `signal-${key}.json`), JSON.stringify({ config: `signal-${key}`, model, threshold: th, cases: verd }));
    const pc = k => { const s = verd.filter(x => x.kind === k && x.flag !== null); return s.length ? `${(100 * s.filter(x => x.flag).length / s.length).toFixed(0)}%` : '-'; };
    console.log(`${key.padEnd(22)} ${pc('OK').padStart(12)} ${[pc('GRENSE'), pc('FEILVERS'), pc('FLETTET')].map(x => x.padStart(10)).join('')}`);
  }
}
console.log(`\n${((Date.now() - t0) / 1000 / cases.length).toFixed(1)} s/par`);
console.log(`\neksempel på tilbakeoversettelse:`);
for (const r of out.filter(r => r.bt && r.kind === 'OK').slice(0, 2)) {
  console.log(`  osmain : ${r.A.slice(0, 100)}`);
  console.log(`  ${r.tr} : ${r.B.slice(0, 100)}`);
  console.log(`  tilbake: ${r.bt.slice(0, 100)}\n`);
}
