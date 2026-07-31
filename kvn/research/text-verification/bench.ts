/**
 * Benchmark-instrument for dommeren.
 *
 * Testsettet er matrix.json: ekte vers fra 12 oversettelser, med fire feiltyper
 * laget i dataene, pluss uendrede kontrollpar.
 *   OK        uendret par (mappingen er riktig)      → skal IKKE flagges
 *   GRENSE    siste setningsledd flyttet til neste vers
 *   AVKORTET  siste setningsledd borte
 *   FEILVERS  mappingen peker på naboverset
 *   FLETTET   verset rommer også neste vers
 *
 * Hver konfigurasjon (modell × prompt × tenkemodus) kjøres på samme stratifiserte
 * utvalg, og resultatet legges i bench-results.json. Ferdige konfigurasjoner
 * hoppes over, så kjøringen kan gå i dagevis og avbrytes når som helst.
 *
 *   node bench.mjs <modell[,modell...]> [--prompts E,YN] [--think] [--n 4]
 *   node bench.mjs --report
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
const DIR = '/private/tmp/claude-501/-Users-vhanssen-WebstormProjects-flogvit-free-bible/d75e4318-6f77-4d5f-a6f5-6476f4c272c0/scratchpad';
const RESULTS = `${DIR}/bench-results.json`;
const KINDS = ['OK', 'GRENSE', 'AVKORTET', 'FEILVERS', 'FLETTET'];

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const N_PER = Number(flag('--n', 4));
const THINK = args.includes('--think');
const PROMPTS_ARG = flag('--prompts', 'E,YN').split(',');

// -------------------------------------------------------------- stratifisert utvalg
function sample() {
  const rows = JSON.parse(readFileSync(`${DIR}/matrix.json`, 'utf8'));
  const byTr = new Map();
  for (const r of rows) {
    if (!byTr.has(r.tr)) byTr.set(r.tr, new Map(KINDS.map(k => [k, []])));
    byTr.get(r.tr).get(r.kind)?.push(r);
  }
  const out = [];
  for (const [tr, m] of byTr) {
    for (const k of KINDS) {
      const pool = m.get(k);
      // GRENSE og AVKORTET har identisk B-tekst; ta bare GRENSE for LLM-en,
      // den kan uansett ikke skille dem uten å se naboen.
      if (k === 'AVKORTET') continue;
      const step = Math.max(1, Math.floor(pool.length / N_PER));
      for (let i = 0, n = 0; i < pool.length && n < N_PER; i += step, n++) {
        out.push({ tr, kind: k, A: pool[i].A, B: pool[i].B });
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------------ prompter
const SCHEMA_E = { type: 'object', properties: { verdict: { type: 'string', enum: ['EQUIVALENT', 'B_MISSING', 'B_EXTRA', 'DIFFERENT'] } }, required: ['verdict'] };
const SCHEMA_YN = { type: 'object', properties: { same: { type: 'boolean' } }, required: ['same'] };

const PROMPTS = {
  E: {
    schema: SCHEMA_E,
    flag: j => j.verdict !== 'EQUIVALENT',
    build: (A, B) => `A and B are two renderings of the same Bible verse in different languages.

A: ${A}
B: ${B}

Do they carry the same content?

EQUIVALENT — same content
B_MISSING   — B leaves out something A states
B_EXTRA     — B states something beyond A
DIFFERENT   — not the same passage`,
  },
  YN: {
    schema: SCHEMA_YN,
    flag: j => j.same === false,
    build: (A, B) => `A and B are two renderings of the same Bible verse in different languages.

A: ${A}
B: ${B}

Does B carry the same content as A — nothing left out, nothing added?
Wording and language differ; that does not matter.`,
  },
};

// --------------------------------------------------------------------------- kjør
async function ask(model, p, A, B, think) {
  const t0 = Date.now();
  try {
    const r = await fetch('http://localhost:11434/api/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model, prompt: p.build(A, B), stream: false, think,
        format: p.schema, options: { temperature: 0, num_predict: think ? 2048 : 64, num_ctx: 8192 },
      }),
    });
    if (!r.ok) return { err: `${r.status}`, ms: Date.now() - t0 };
    const d = await r.json();
    return { flag: p.flag(JSON.parse(d.response)), ms: Date.now() - t0 };
  } catch (e) { return { err: String(e).slice(0, 60), ms: Date.now() - t0 }; }
}

const load = () => existsSync(RESULTS) ? JSON.parse(readFileSync(RESULTS, 'utf8')) : {};

if (args.includes('--report')) {
  const all = load();
  const keys = Object.keys(all).sort();
  console.log(`${'konfigurasjon'.padEnd(34)} ${'falsk alarm'.padStart(12)} ${['GRENSE', 'FEILVERS', 'FLETTET'].map(k => k.padStart(9)).join('')} ${'s/par'.padStart(7)}`);
  for (const k of keys) {
    const r = all[k];
    const fa = r.per.OK ? 100 * r.per.OK.flagged / r.per.OK.n : 0;
    const cell = kk => r.per[kk] ? `${(100 * r.per[kk].flagged / r.per[kk].n).toFixed(0)}%`.padStart(9) : '-'.padStart(9);
    console.log(`${k.padEnd(34)} ${(fa.toFixed(1) + '%').padStart(12)} ${['GRENSE', 'FEILVERS', 'FLETTET'].map(cell).join('')} ${r.secs.toFixed(1).padStart(7)}`);
  }
  process.exit(0);
}

const cases = sample();
console.log(`${cases.length} par (${new Set(cases.map(c => c.tr)).size} oversettelser × ${N_PER} per feiltype)\n`);

const models = (args[0] && !args[0].startsWith('--')) ? args[0].split(',') : [];
if (!models.length) { console.error('oppgi modeller, eller --report'); process.exit(1); }

const all = load();
for (const model of models) {
  for (const pn of PROMPTS_ARG) {
    const p = PROMPTS[pn];
    if (!p) continue;
    const key = `${model} ${pn}${THINK ? ' think' : ''}`;
    if (all[key]) { console.log(`${key} — allerede målt, hopper over`); continue; }

    const per = Object.fromEntries(KINDS.map(k => [k, { n: 0, flagged: 0 }]));
    const perTr = {};
    let ms = 0, errs = 0;
    const t0 = Date.now();
    for (let i = 0; i < cases.length; i++) {
      const c = cases[i];
      const { flag, err, ms: dt } = await ask(model, p, c.A, c.B, THINK);
      ms += dt;
      if (err) { errs++; continue; }
      per[c.kind].n++; if (flag) per[c.kind].flagged++;
      perTr[c.tr] ??= { ok: 0, okFlag: 0, bad: 0, badFlag: 0 };
      if (c.kind === 'OK') { perTr[c.tr].ok++; if (flag) perTr[c.tr].okFlag++; }
      else { perTr[c.tr].bad++; if (flag) perTr[c.tr].badFlag++; }
      if ((i + 1) % 40 === 0) process.stdout.write(`\r  ${key}: ${i + 1}/${cases.length}`);
    }
    process.stdout.write('\r' + ' '.repeat(70) + '\r');

    all[key] = { model, prompt: pn, think: THINK, per, perTr, errs, secs: ms / 1000 / cases.length, n: cases.length };
    writeFileSync(RESULTS, JSON.stringify(all, null, 1));
    const fa = 100 * per.OK.flagged / (per.OK.n || 1);
    console.log(
      `${key.padEnd(34)} falsk alarm ${fa.toFixed(1)}%   ` +
      `GRENSE ${(100 * per.GRENSE.flagged / (per.GRENSE.n || 1)).toFixed(0)}%  ` +
      `FEILVERS ${(100 * per.FEILVERS.flagged / (per.FEILVERS.n || 1)).toFixed(0)}%  ` +
      `FLETTET ${(100 * per.FLETTET.flagged / (per.FLETTET.n || 1)).toFixed(0)}%   ` +
      `${(ms / 1000 / cases.length).toFixed(1)}s/par` + (errs ? `  (${errs} feil)` : '')
    );
  }
}
