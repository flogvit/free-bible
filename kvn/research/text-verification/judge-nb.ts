/**
 * Dommer på tilbakeoversettelsen — enspråklig sammenlikning.
 *
 * Hypotesen: å oversette B til norsk én gang og så dømme norsk mot norsk er
 * bedre enn å dømme kryssspråklig, til omtrent samme kostnad (én generering
 * enten vei). Modellen slipper å holde to språk i hodet samtidig, og alle
 * nedstrøms signaler blir enspråklige.
 *
 * Krever at backtranslate.mjs har kjørt og skrevet backtranslations.json.
 *
 *   bun judge-nb.ts [modell]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const VERDICTS = join(HERE, 'verdicts-n6');
const SRC = join(HERE, 'backtranslations.json');
if (!existsSync(SRC)) { console.error('backtranslations.json mangler — kjør backtranslate.mjs først'); process.exit(1); }

const model = process.argv[2] ?? 'gemma4:31b';
const cases = JSON.parse(readFileSync(SRC, 'utf8'));
console.log(`${cases.length} par, dømmer norsk mot norsk med ${model}\n`);

const schema = { type: 'object', properties: { verdict: { type: 'string', enum: ['EQUIVALENT', 'B_MISSING', 'B_EXTRA', 'DIFFERENT'] } }, required: ['verdict'] };

async function ask(A, B) {
  try {
    const r = await fetch('http://localhost:11434/api/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model, stream: false, think: false, format: schema, keep_alive: '30m',
        options: { temperature: 0, num_predict: 64, num_ctx: 4096 },
        prompt: `A og B er to gjengivelser av samme bibelvers på norsk.
B er maskinoversatt fra et annet språk, så ordvalget kan være klosset — det spiller ingen rolle.

A: ${A}
B: ${B}

Sier de det samme?

EQUIVALENT — samme innhold
B_MISSING   — B utelater noe A sier
B_EXTRA     — B sier noe A ikke sier
DIFFERENT   — det er ikke samme avsnitt`,
      }),
    });
    if (!r.ok) return null;
    return JSON.parse((await r.json()).response).verdict !== 'EQUIVALENT';
  } catch { return null; }
}

const rows = [];
const t0 = Date.now();
for (let i = 0; i < cases.length; i++) {
  const c = cases[i];
  rows.push({ id: c.id, tr: c.tr, kind: c.kind, flag: await ask(c.A, c.bt) });
  if ((i + 1) % 25 === 0) {
    const el = (Date.now() - t0) / 1000;
    process.stdout.write(`\r  ${i + 1}/${cases.length}  ${(el / (i + 1)).toFixed(1)}s/par`);
  }
}
process.stdout.write('\r' + ' '.repeat(60) + '\r');

mkdirSync(VERDICTS, { recursive: true });
const name = `judge-nb-${model.replace(/[:.]/g, '_')}`;
writeFileSync(join(VERDICTS, `${name}.json`), JSON.stringify({ config: name, model, cases: rows }));
const pc = k => { const s = rows.filter(x => x.kind === k && x.flag !== null); return s.length ? `${(100 * s.filter(x => x.flag).length / s.length).toFixed(0)}%` : '-'; };
console.log(`${name}  falsk alarm ${pc('OK')}   GRENSE ${pc('GRENSE')}  FEILVERS ${pc('FEILVERS')}  FLETTET ${pc('FLETTET')}  ${((Date.now() - t0) / 1000 / cases.length).toFixed(1)}s/par`);
