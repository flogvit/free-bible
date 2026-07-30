/**
 * Les de falske alarmene.
 *
 * 23 % falsk alarm er tallet som blokkerer alt. Men et tall sier ikke om det er
 * ekte oversettelsesforskjeller vi må godta, eller modellfeil vi kan fjerne.
 * Dette skriptet henter fram de faktiske tekstparene dommeren flagget feilaktig,
 * og de ekte feilene den slapp gjennom.
 *
 *   node inspect.mjs <verdict-fil> [--misses] [--n 15]
 */
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIRARG = process.argv.indexOf('--dir');
const VERDICTS = join(HERE, DIRARG >= 0 ? process.argv[DIRARG + 1] : 'verdicts-n6');
const argv = process.argv.slice(2);
const MISSES = argv.includes('--misses');
const N = Number((argv[argv.indexOf('--n') + 1]) || 15);
const file = argv.find(a => !a.startsWith('--') && !/^\d+$/.test(a));
if (!file) {
  console.log('tilgjengelige:', readdirSync(VERDICTS).filter(f => f.endsWith('.json')).join(' '));
  process.exit(1);
}

const run = JSON.parse(readFileSync(join(VERDICTS, file.replace(/^.*\//, '')), 'utf8'));
const rows = JSON.parse(readFileSync(join(HERE, 'testset.json'), 'utf8'));
const caseId = r => `${r.tr}|${r.kind}|${r.A.length}|${r.B.length}|${r.B.slice(0, 24)}`;
const byId = new Map();
for (const r of rows) if (!byId.has(caseId(r))) byId.set(caseId(r), r);

const trArg = argv.includes('--tr') ? argv[argv.indexOf('--tr') + 1].split(',') : null;
const want = (MISSES
  ? run.cases.filter(c => c.kind !== 'OK' && c.flag === false)
  : run.cases.filter(c => c.kind === 'OK' && c.flag === true)
).filter(c => !trArg || trArg.includes(c.tr));

console.log(`${run.config}: ${want.length} ${MISSES ? 'ekte feil som slapp gjennom' : 'falske alarmer'}\n`);

// vis bredt over oversettelser, ikke bare de første
const perTr = new Map();
for (const c of want) {
  if (!perTr.has(c.tr)) perTr.set(c.tr, []);
  perTr.get(c.tr).push(c);
}
let shown = 0;
outer:
for (let round = 0; round < 5; round++) {
  for (const [tr, list] of perTr) {
    if (!list[round]) continue;
    const src = byId.get(list[round].id);
    if (!src) continue;
    console.log(`--- ${tr}  [${list[round].kind}]  sim ${src.sim?.toFixed(3)}  simZ ${src.simZ?.toFixed(2)}  len ${src.len?.toFixed(2)} ---`);
    console.log(`  osmain: ${src.A}`);
    console.log(`  ${tr}: ${src.B}`);
    console.log();
    if (++shown >= N) break outer;
  }
}
