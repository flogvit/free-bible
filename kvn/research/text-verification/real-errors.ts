/**
 * Validering mot EKTE mappingfeil, ikke syntetiske.
 *
 * FUNN.md dokumenterer feil med kjent fasit. For hver av dem vet vi både hva
 * mappingen sa og hva den skulle ha sagt, så vi kan måle om detektorene skiller
 * de to — og like viktig: om de lar den riktige varianten være i fred.
 *
 * Dette er den eneste valideringen som teller. Syntetiske perturbasjoner viser
 * at en detektor kan se en feil jeg selv har laget; dette viser om den ser feil
 * som faktisk har stått i dataene.
 *
 *   node real-errors.mjs [modell]
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const RAW = join(HERE, '../../../generate/bibles_raw');
const ch = (m, b, c) => { const f = join(RAW, m, String(b), `${c}.json`); return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null; };
const txt = (m, b, c, v) => ch(m, b, c)?.find(x => x.verseId === v)?.text ?? null;

const embed = async t => {
  const r = await fetch('http://localhost:11434/api/embed', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'bge-m3', input: t }),
  });
  return (await r.json()).embeddings.map(v => { let s = 0; for (const x of v) s += x * x; s = Math.sqrt(s) || 1; return Float32Array.from(v, x => x / s); });
};
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

const schema = { type: 'object', properties: { verdict: { type: 'string', enum: ['EQUIVALENT', 'B_MISSING', 'B_EXTRA', 'DIFFERENT'] } }, required: ['verdict'] };
const model = process.argv[2] ?? 'gemma4:31b';
async function judge(A, B) {
  try {
    const r = await fetch('http://localhost:11434/api/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model, stream: false, think: false, format: schema,
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
    return JSON.parse((await r.json()).response).verdict;
  } catch { return 'ERR'; }
}

/**
 * Hver post: oversettelsens vers, det verset mappingen FEILAKTIG pekte på,
 * og det verset som er riktig. Detektoren skal flagge det gale og la det
 * riktige være.
 *   feil  = osmain-koordinat mappingen ga (galt)
 *   rett  = osmain-koordinat som faktisk svarer til oversettelsens vers
 */
const FASIT = [
  // albanian: Åp 1-12 ligger ett vers ned. Oversettelsens v_n er osmain v_(n+1).
  ...[[1, 5], [1, 12], [5, 3], [5, 9], [9, 4], [9, 15], [12, 2], [12, 10]]
    .map(([c, v]) => ({ tr: 'albanian', b: 66, c, trV: v, feil: v, rett: v + 1, hva: `albanian Åp ${c},${v} — hele 1-12 ett vers ned` })),
  // basque: oversettelsens Sal 110 er osmain Sal 111.
  ...[1, 2, 3, 4, 5].map(v => ({ tr: 'basque', b: 19, c: 110, trV: v, feil: v, rett: v, feilKap: 110, rettKap: 111, hva: `basque Sal 110,${v} — er osmain 111` })),
];

console.log(`${FASIT.length} kjente feil fra FUNN.md\n`);
console.log(`${'sak'.padEnd(46)} ${'sim feil'.padStart(9)} ${'sim rett'.padStart(9)}  ${'dom(feil)'.padEnd(12)} ${'dom(rett)'.padEnd(12)}`);

let simOK = 0, judgeOK = 0, judgeQuiet = 0, n = 0;
for (const f of FASIT) {
  const tr = txt(f.tr, f.b, f.c, f.trV);
  const osFeil = txt('osmain', f.b, f.feilKap ?? f.c, f.feil);
  const osRett = txt('osmain', f.b, f.rettKap ?? f.c, f.rett);
  if (!tr || !osFeil || !osRett) { console.log(`${f.hva.padEnd(46)} — mangler data`); continue; }
  n++;

  const [eT, eF, eR] = await embed([tr, osFeil, osRett]);
  const sF = dot(eT, eF), sR = dot(eT, eR);
  if (sR > sF) simOK++;

  const vF = await judge(osFeil, tr);
  const vR = await judge(osRett, tr);
  if (vF !== 'EQUIVALENT') judgeOK++;
  if (vR === 'EQUIVALENT') judgeQuiet++;

  console.log(
    `${f.hva.slice(0, 46).padEnd(46)} ${sF.toFixed(3).padStart(9)} ${sR.toFixed(3).padStart(9)}  ` +
    `${vF.padEnd(12)} ${vR.padEnd(12)}` +
    `${sR > sF ? '' : '   ← sim bommet'}${vF === 'EQUIVALENT' ? '   ← dommer bommet' : ''}`
  );
}

console.log(`\n${n} ekte feil:`);
console.log(`  bge-m3 rangerte riktig vers over det gale : ${simOK}/${n}`);
console.log(`  dommeren flagget det GALE paret          : ${judgeOK}/${n}`);
console.log(`  dommeren lot det RIKTIGE paret være      : ${judgeQuiet}/${n}   ← falsk alarm på ekte data`);

// ---------------------------------------------------------------- hele nettet
//
// Dommeren alene bommer på 2 av 13. Men nettet er dommeren ELLER tegnsetting
// ELLER lengde ELLER rangering — og rangeringen tok 13/13. Her måles nettet
// ende-til-ende på de samme ekte feilene, ikke bare dommerleddet.

const OPEN = /[,;:،؛۔॥।၊、，；：]\s*$/;

/** Rangering: er det mapper-utpekte osmain-verset det som likner mest i kapitlet? */
async function rankFlag(trText, b, c, v) {
  const chap = ch('osmain', b, c)?.filter(x => x.text?.length > 20);
  if (!chap || chap.length < 4) return null;
  const i = chap.findIndex(x => x.verseId === v);
  if (i < 0) return null;
  const embs = await embed([trText, ...chap.map(x => x.text)]);
  const sims = chap.map((_, j) => dot(embs[0], embs[j + 1]));
  return sims.some(s => s > sims[i]);
}

console.log(`\n--- hele nettet, ende-til-ende ---`);
console.log(`${'sak'.padEnd(46)} ${'dommer'.padStart(8)} ${'komma'.padStart(7)} ${'kort'.padStart(6)} ${'rang'.padStart(6)}   nettet`);
let netCaught = 0, netQuiet = 0, m = 0;
for (const f of FASIT) {
  const tr = txt(f.tr, f.b, f.c, f.trV);
  const osFeil = txt('osmain', f.b, f.feilKap ?? f.c, f.feil);
  const osRett = txt('osmain', f.b, f.rettKap ?? f.c, f.rett);
  if (!tr || !osFeil || !osRett) continue;
  m++;

  // lengdesignal trenger oversettelsens egen normal — regnes fra kapitlet
  const trChap = ch(f.tr, f.b, f.c) ?? [];
  const osChap = ch('osmain', f.b, f.feilKap ?? f.c) ?? [];
  const ratios = trChap.map(x => {
    const o = osChap.find(y => y.verseId === x.verseId);
    return o && x.text?.length > 40 && o.text.length > 40 ? x.text.length / o.text.length : null;
  }).filter(Boolean).sort((a, b2) => a - b2);
  const med = ratios.length ? ratios[Math.floor(ratios.length / 2)] : 1;

  const dJudge = (await judge(osFeil, tr)) !== 'EQUIVALENT';
  const dPunct = OPEN.test(tr);
  const dShort = med > 0 && (tr.length / osFeil.length) / med < 0.7;
  const dRank = await rankFlag(tr, f.b, f.feilKap ?? f.c, f.feil);

  const net = dJudge || dPunct || dShort || dRank === true;
  if (net) netCaught++;

  // og lar nettet det RIKTIGE paret være?
  const qJudge = (await judge(osRett, tr)) !== 'EQUIVALENT';
  const qRank = await rankFlag(tr, f.b, f.rettKap ?? f.c, f.rett);
  if (!(qJudge || dPunct || qRank === true)) netQuiet++;

  console.log(
    `${f.hva.slice(0, 46).padEnd(46)} ${(dJudge ? 'ja' : 'nei').padStart(8)} ${(dPunct ? 'ja' : 'nei').padStart(7)} ` +
    `${(dShort ? 'ja' : 'nei').padStart(6)} ${(dRank === null ? '-' : dRank ? 'ja' : 'nei').padStart(6)}   ${net ? 'FANGET' : '← BOM'}`
  );
}
console.log(`\n  nettet fanget det GALE paret  : ${netCaught}/${m}`);
console.log(`  nettet lot det RIKTIGE være   : ${netQuiet}/${m}   ← falsk alarm på ekte data`);
