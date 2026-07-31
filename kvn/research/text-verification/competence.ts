/**
 * Hvor godt duger dommeren på DENNE oversettelsen?
 *
 * Falsk alarm er ikke jevnt fordelt: målt på testsettet er den 0 % for spansk,
 * russisk, tysk, engelsk, thai, vietnamesisk og bashkir, men 17–33 % for
 * koreansk, burmesisk, awadhi og swahili. Et gjennomsnitt på 21 % skjulte at
 * problemet ligger i en håndfull språk.
 *
 * Følgen for designet: der dommeren har null falsk alarm er ett ja/nei-kall hele
 * løsningen. Der den ikke har det, må de mekaniske lagene og eventuelt
 * tilbakeoversettelse legges på. Hvilken oversettelse som trenger hva, avgjøres
 * ved å måle — ikke ved å gjette ut fra språkets størrelse.
 *
 * Målingen trenger INGEN fasit, og kan derfor kjøres på alle 1158:
 *   1. trekk vers spredt over bøkene, slå opp osmain-verset via mappingen
 *   2. behold dem som passerer de mekaniske sjekkene (rangerer først i kapitlet,
 *      lengde innenfor oversettelsens normale spenn) — de er nesten sikkert riktige
 *   3. la dommeren dømme dem. Alt den flagger her er falsk alarm.
 *
 * Steg 2 velger IKKE de letteste parene — det ville gitt et pyntet tall. Det
 * fjerner bare dem vi har mekanisk grunn til å tro er ekte feil.
 *
 *   node competence.mjs <oversettelse[,oversettelse...]> [--n 40] [--model gemma4:31b]
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '../../..');
const RAW = join(REPO, 'generate/bibles_raw');
const MAPS = join(REPO, 'kvn/mappings');
const OUT = join(HERE, 'competence.json');

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const N = Number(opt('--n', 40));
const model = opt('--model', 'gemma4:31b');
const names = (argv.find(a => !a.startsWith('--')) ?? '').split(',').filter(Boolean);
if (!names.length) { console.error('oppgi oversettelse(r)'); process.exit(1); }

const PART = 16, MAXV = 177, MAXC = 151, MV = MAXV * PART, MC = MAXC * MV;
const enc = (b, c, v) => b * MC + c * MV + v * PART;
const dec = k => { const p = k % PART, r1 = (k - p) / PART, v = r1 % MAXV, r2 = (r1 - v) / MAXV; return { b: (r2 - r2 % MAXC) / MAXC, c: r2 % MAXC, v, p }; };

function mapperFor(name) {
  const f = join(MAPS, `${name}.ukvn.json`);
  if (!existsSync(f)) return null;
  const m = JSON.parse(readFileSync(f, 'utf8'));
  const k2t = new Map(), t2k = new Map();
  for (const e of m.map) { k2t.set(e.kvnFrom, e.tkvnFrom); if (!t2k.has(e.tkvnFrom)) t2k.set(e.tkvnFrom, e.kvnFrom); }
  const lift = (map, x) => { const h = map.get(x); if (h !== undefined) return h; const p = x % PART; if (p > 0) { const b = map.get(x - p); if (b !== undefined) return b + p; } return x; };
  return { toKvn: t => lift(t2k, t) };
}

const cache = new Map();
function chap(tr, b, c) {
  const key = `${tr}/${b}/${c}`;
  if (!cache.has(key)) {
    const f = join(RAW, tr, String(b), `${c}.json`);
    cache.set(key, existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null);
  }
  return cache.get(key);
}

const embed = async texts => {
  const r = await fetch('http://localhost:11434/api/embed', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'bge-m3', input: texts, keep_alive: '30m' }),
  });
  if (!r.ok) throw new Error(await r.text());
  return (await r.json()).embeddings.map(v => { let s = 0; for (const x of v) s += x * x; s = Math.sqrt(s) || 1; return Float32Array.from(v, x => x / s); });
};
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
const median = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

const schema = { type: 'object', properties: { verdict: { type: 'string', enum: ['EQUIVALENT', 'B_MISSING', 'B_EXTRA', 'DIFFERENT'] } }, required: ['verdict'] };
async function judge(A, B) {
  try {
    const r = await fetch('http://localhost:11434/api/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model, stream: false, think: false, format: schema, keep_alive: '30m',
        options: { temperature: 0, num_predict: 64, num_ctx: 8192 },
        prompt: `A and B are two renderings of the same Bible verse in different languages.

A: ${A}
B: ${B}

Do they carry the same content?

EQUIVALENT — same content
B_MISSING   — B leaves out something A states
B_EXTRA     — B states something beyond A
DIFFERENT   — not the same passage`,
      }),
    });
    if (!r.ok) return null;
    return JSON.parse((await r.json()).response).verdict;
  } catch { return null; }
}

// spredt utvalg av kapitler: lov, fortelling, poesi, profeti, evangelium, brev
const SPREAD = [[1, 12], [2, 14], [5, 8], [6, 6], [9, 17], [11, 18], [13, 16], [18, 14],
                [19, 34], [20, 15], [23, 40], [24, 31], [26, 37], [27, 3], [40, 13], [41, 9],
                [42, 10], [43, 11], [44, 16], [45, 5], [46, 13], [49, 4], [58, 11], [60, 2], [66, 5]];

const results = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};

for (const tr of names) {
  const mp = mapperFor(tr);
  if (!mp || !existsSync(join(RAW, tr))) { console.log(`${tr}: mangler data eller mapping`); continue; }

  // 1. samle kandidatpar via mappingen
  const cand = [];
  for (const [b, c] of SPREAD) {
    const t = chap(tr, b, c);
    if (!t) continue;
    for (const v of t) {
      if (!v.text || v.text.length < 60) continue;
      const kvn = mp.toKvn(enc(b, c, v.verseId));
      const d = dec(kvn);
      if (d.p !== 0) continue;                       // delvers kan ikke lengdesammenliknes
      const os = chap('osmain', d.b, d.c)?.find(x => x.verseId === d.v);
      if (!os?.text || os.text.length < 60) continue;
      cand.push({ b: d.b, c: d.c, v: d.v, A: os.text, B: v.text });
    }
  }
  if (cand.length < N) { console.log(`${tr}: bare ${cand.length} kandidater`); if (!cand.length) continue; }

  // 2. mekanisk filter — fjern dem vi har grunn til å tro er ekte feil
  const lens = cand.map(x => x.B.length / x.A.length);
  const med = median(lens);
  const lo = median(lens.filter(x => x < med)), hi = median(lens.filter(x => x > med));
  const keep = [];
  for (let i = 0; i < cand.length; i += 24) {
    const batch = cand.slice(i, i + 24);
    let embs;
    try { embs = await embed(batch.flatMap(x => [x.A, x.B])); } catch { continue; }
    batch.forEach((x, j) => {
      const ratio = (x.B.length / x.A.length) / med;
      if (ratio < lo / med || ratio > hi / med) return;      // uvanlig lengde → kan være ekte feil
      x.sim = dot(embs[2 * j], embs[2 * j + 1]);
      keep.push(x);
    });
  }
  const simMed = median(keep.map(x => x.sim));
  const sample = keep.filter(x => x.sim >= simMed - 0.15)     // fjern de klart avvikende
    .filter((_, i) => i % Math.max(1, Math.floor(keep.length / N)) === 0).slice(0, N);

  // 3. døm dem. Alt som flagges her er falsk alarm.
  let n = 0, flagged = 0;
  const examples = [];
  for (const x of sample) {
    const v = await judge(x.A, x.B);
    if (!v) continue;
    n++;
    if (v !== 'EQUIVALENT') { flagged++; if (examples.length < 3) examples.push({ ref: `${x.b} ${x.c}:${x.v}`, verdict: v, A: x.A.slice(0, 90), B: x.B.slice(0, 90) }); }
  }
  const fa = n ? 100 * flagged / n : NaN;
  results[tr] = { model, n, flagged, fa: +fa.toFixed(1), simMedian: +simMed.toFixed(3), examples };
  writeFileSync(OUT, JSON.stringify(results, null, 1));

  const protokoll = fa <= 2 ? 'dommer alene holder'
    : fa <= 10 ? 'dommer + mekaniske lag'
    : 'trenger tilbakeoversettelse';
  console.log(`${tr.padEnd(24)} falsk alarm ${(fa.toFixed(0) + '%').padStart(5)}  (${flagged}/${n})  likhet ${simMed.toFixed(3)}   → ${protokoll}`);
}
