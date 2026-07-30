/**
 * Regner ut ensembler over lagrede dommer — ingen modellkjøring.
 *
 * Tallet som avgjør om oppsettet kan gi 100 % korrekt, er **bomraten**: hvor
 * mange ekte feil ingen detektor slår ut på, og som dermed blir stemplet OK.
 * Det er den eneste kilden til gale dommer. Alt annet ender som «uavklart» og
 * eskaleres — og uavklart er dyrt, ikke galt.
 *
 * Derfor optimeres nettet på bomrate alene. Eskaleringskostnaden får løpe:
 * målmaskinen har år til rådighet.
 *
 *   node ensemble.mjs              # alle konfigurasjoner + beste ELLER-nett
 *   node ensemble.mjs --per-tr     # og bomrate per oversettelse
 *   node ensemble.mjs a.json b.json
 */
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIRARG = process.argv.indexOf('--dir');
const VERDICTS = join(HERE, DIRARG >= 0 ? process.argv[DIRARG + 1] : 'verdicts-n6');
if (!existsSync(VERDICTS)) { console.error('ingen dommer lagret — kjør run.mjs først'); process.exit(1); }

const argv = process.argv.slice(2);
const PER_TR = argv.includes('--per-tr');
// bare filnavn — ikke flagg, og ikke verdien etter et flagg
const named = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));
const files = named.length ? named : readdirSync(VERDICTS).filter(f => f.endsWith('.json'));
const runs = files.map(f => JSON.parse(readFileSync(join(VERDICTS, f.replace(/^.*\//, '')), 'utf8')));
const KINDS = ['GRENSE', 'FEILVERS', 'FLETTET'];

function stat(rows) {
  const g = k => rows.filter(r => r.kind === k && r.flag !== null);
  const ok = g('OK');
  const bad = rows.filter(r => r.kind !== 'OK' && r.flag !== null);
  return {
    fa: ok.length ? 100 * ok.filter(r => r.flag).length / ok.length : NaN,
    rec: Object.fromEntries(KINDS.map(k => { const s = g(k); return [k, s.length ? 100 * s.filter(r => r.flag).length / s.length : NaN]; })),
    miss: bad.length ? 100 * bad.filter(r => !r.flag).length / bad.length : NaN,
    nBad: bad.length, nOk: ok.length,
  };
}

const line = (name, s) =>
  `${name.slice(0, 34).padEnd(34)} ${(s.fa.toFixed(1) + '%').padStart(11)} ` +
  KINDS.map(k => (isNaN(s.rec[k]) ? '-' : s.rec[k].toFixed(0) + '%').padStart(10)).join('') +
  `${(s.miss.toFixed(1) + '%').padStart(11)}`;

console.log(`${'konfigurasjon'.padEnd(34)} ${'falsk alarm'.padStart(11)} ${KINDS.map(k => k.padStart(10)).join('')} ${'BOMRATE'.padStart(11)}`);
console.log('-'.repeat(86));
for (const r of runs.sort((a, b) => stat(a.cases).miss - stat(b.cases).miss)) console.log(line(r.config, stat(r.cases)));

/** ELLER: slår ut hvis noen konfigurasjon slår ut. null teller som «sa ingenting». */
function union(sel) {
  const byId = new Map();
  for (const r of sel) for (const c of r.cases) {
    const cur = byId.get(c.id);
    if (!cur) byId.set(c.id, { ...c });
    else if (c.flag === true) cur.flag = true;
    else if (cur.flag === null && c.flag !== null) cur.flag = c.flag;
  }
  return [...byId.values()];
}

console.log('\n--- ELLER-nett, grådig på bomrate ---');
const chosen = [];
let remaining = [...runs];
while (remaining.length) {
  let best = null;
  for (const r of remaining) {
    const s = stat(union([...chosen, r]));
    if (!best || s.miss < best.s.miss - 1e-9 || (Math.abs(s.miss - best.s.miss) < 1e-9 && s.fa < best.s.fa)) best = { r, s };
  }
  if (chosen.length && best.s.miss >= stat(union(chosen)).miss - 1e-9) break;
  chosen.push(best.r);
  remaining = remaining.filter(x => x !== best.r);
  console.log(line('+ ' + best.r.config, best.s));
}

const net = union(chosen);
const fin = stat(net);
console.log(`\nbeste nett: ${chosen.map(c => c.config).join('  ELLER  ')}`);
console.log(`  bomrate  ${fin.miss.toFixed(2)} %  (${Math.round(fin.nBad * fin.miss / 100)} av ${fin.nBad} ekte feil ble stemplet OK)`);
console.log(`  eskalert ${fin.fa.toFixed(1)} % av de riktige parene`);

if (PER_TR) {
  console.log(`\n--- per oversettelse ---`);
  console.log(`${'oversettelse'.padEnd(20)} ${'bomrate'.padStart(9)} ${'eskalert'.padStart(10)} ${'n feil'.padStart(8)}`);
  const trs = [...new Set(net.map(r => r.tr))].sort();
  const rowsFor = tr => net.filter(r => r.tr === tr);
  for (const tr of trs) {
    const s = stat(rowsFor(tr));
    const warn = s.miss > fin.miss * 2 ? '   ← svakt her' : '';
    console.log(`${tr.padEnd(20)} ${(s.miss.toFixed(1) + '%').padStart(9)} ${(s.fa.toFixed(0) + '%').padStart(10)} ${String(s.nBad).padStart(8)}${warn}`);
  }
}

// --- Billigste nett som ikke bommer ---
// Det grådige søket over tar det FØRSTE nettet som når null bom. Men i produksjon
// er eskalering kostnaden som faktisk betales, så det interessante er det nettet
// med lavest falsk alarm blant dem som ikke bommer. Uttømmende søk over alle
// kombinasjoner opp til fire lag.
if (argv.includes('--cheapest')) {
  const idx = runs.map((_, i) => i);
  let best = null;
  const combos = [];
  const rec = (start, cur) => {
    if (cur.length) combos.push([...cur]);
    if (cur.length === 4) return;
    for (let i = start; i < idx.length; i++) { cur.push(i); rec(i + 1, cur); cur.pop(); }
  };
  rec(0, []);
  for (const combo of combos) {
    const s = stat(union(combo.map(i => runs[i])));
    if (s.miss > 0 || isNaN(s.miss)) continue;
    if (!best || s.fa < best.s.fa || (s.fa === best.s.fa && combo.length < best.combo.length)) best = { combo, s };
  }
  console.log(`\n--- billigste nett uten bom (${combos.length} kombinasjoner prøvd) ---`);
  if (!best) console.log('  ingen kombinasjon av ≤4 lag når null bom');
  else {
    console.log(`  ${best.combo.map(i => runs[i].config).join('  ELLER  ')}`);
    console.log(`  bomrate  ${best.s.miss.toFixed(2)} %`);
    console.log(`  eskalert ${best.s.fa.toFixed(1)} %   ← mot 22.2 % for det grådige nettet`);
    console.log(`  GRENSE ${best.s.rec.GRENSE.toFixed(0)}%  FEILVERS ${best.s.rec.FEILVERS.toFixed(0)}%  FLETTET ${best.s.rec.FLETTET.toFixed(0)}%`);
  }
}

// --- Holdout: velg nettet på halvparten av oversettelsene, mål på resten ---
// Tre lag som akkurat dekker hverandre på 210 feil er nettopp slik overtilpasning
// ser ut. Velges nettet på seks oversettelser og holder på de seks andre, er det
// ikke tilpasset støyen. Deles på OVERSETTELSE, ikke tilfeldig — det er nye språk
// systemet skal møte i produksjon, ikke nye vers fra språk det er innstilt på.
if (argv.includes('--holdout')) {
  const trs = [...new Set(runs[0].cases.map(c => c.tr))].sort();
  const A = new Set(trs.filter((_, i) => i % 2 === 0));
  const B = new Set(trs.filter((_, i) => i % 2 === 1));
  const slice = (r, set) => ({ ...r, cases: r.cases.filter(c => set.has(c.tr)) });

  const search = set => {
    const sub = runs.map(r => slice(r, set));
    let best = null;
    const combos = [];
    const rec = (start, cur) => {
      if (cur.length) combos.push([...cur]);
      if (cur.length === 4) return;
      for (let i = start; i < sub.length; i++) { cur.push(i); rec(i + 1, cur); cur.pop(); }
    };
    rec(0, []);
    for (const combo of combos) {
      const s = stat(union(combo.map(i => sub[i])));
      if (s.miss > 0 || isNaN(s.miss)) continue;
      if (!best || s.fa < best.s.fa) best = { combo, s };
    }
    return best;
  };

  for (const [navn, fit, test] of [['A→B', A, B], ['B→A', B, A]]) {
    const best = search(fit);
    console.log(`\n--- holdout ${navn} ---`);
    if (!best) { console.log('  fant ikke noe nett uten bom på treningshalvdelen'); continue; }
    console.log(`  valgt på [${[...fit].join(', ')}]:`);
    console.log(`    ${best.combo.map(i => runs[i].config).join('  ELLER  ')}`);
    console.log(`    trening: bom ${best.s.miss.toFixed(2)} %, eskalert ${best.s.fa.toFixed(1)} %`);
    const held = stat(union(best.combo.map(i => slice(runs[i], test))));
    const flag = held.miss > 0 ? '   ← BOMMER på usett data' : '   ← holder';
    console.log(`    holdout: bom ${held.miss.toFixed(2)} %, eskalert ${held.fa.toFixed(1)} %${flag}`);
    console.log(`             GRENSE ${held.rec.GRENSE.toFixed(0)}%  FEILVERS ${held.rec.FEILVERS.toFixed(0)}%  FLETTET ${held.rec.FLETTET.toFixed(0)}%  (n=${held.nBad})`);
  }
}
