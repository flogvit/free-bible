/**
 * Er falsk alarm systematisk B_EXTRA?
 *
 * 15 av 15 leste falske alarmer var B_EXTRA. Hypotesen: osmain er bygget fra
 * osnb, en muntlig norsk gjengivelse, og er tersere enn ordrette oversettelser.
 * Når KJV skriver «in my name» eller Reina-Valera «para dar de comer a pobres»
 * der osmain har komprimert, ser dommeren helt korrekt at oversettelsen sier
 * mer — men det er osmains stil, ikke en mappingfeil.
 *
 * Fletting, den ekte feilen B_EXTRA skal fange, betyr et HELT ekstra vers og
 * slår derfor også ut på lengde. Så B_EXTRA alene bør ikke flagge.
 *
 * Måles her: fordelingen av dommer per klasse, og hva som skjer med bomrate og
 * eskalering hvis B_EXTRA bare teller når lengden også er unormal.
 *
 *   bun verdikt-analyse.ts [verdict-fil ...]
 */
import { readFileSync, readdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

/** En rad i testset.json: et par (A = osmain-vers, B = oversettelsens vers). */
interface Row {
  tr: string;
  kind: string;
  sim: number;
  simZ: number;
  len: number;
  A: string;
  B: string;
}

/** Én dom over ett par, slik den ligger i domsfilene under DIR. */
interface VerdictCase {
  id: string;
  tr: string;
  kind: string;
  flag: boolean | null;
  verdict?: string;
}

/** Én kjøring: en konfigurasjon med dommene sine. */
interface Run {
  config: string;
  cases: VerdictCase[];
}

const HERE = dirname(fileURLToPath(import.meta.url));
const DIRARG = process.argv.indexOf('--dir');
const DIR = join(HERE, DIRARG >= 0 ? process.argv[DIRARG + 1] : 'verdicts-n6');
const KINDS = ['OK', 'GRENSE', 'FEILVERS', 'FLETTET'];
const VERDICTS = ['EQUIVALENT', 'B_MISSING', 'B_EXTRA', 'DIFFERENT'];

// bare filnavn, ikke flagg eller flaggverdier
const named = process.argv.slice(2).filter((a, i, arr) =>
  !a.startsWith('--') && !(i > 0 && arr[i - 1].startsWith('--')));
const files = named.length
  ? named.map(f => f.replace(/^.*\//, ''))
  : readdirSync(DIR).filter(f => f.endsWith('.json'));

// lengde per par, til å skille ekte fletting fra osmain-terserhet
const rows: Row[] = JSON.parse(readFileSync(join(HERE, 'testset.json'), 'utf8'));
const caseId = (r: Row): string => `${r.tr}|${r.kind}|${r.A.length}|${r.B.length}|${r.B.slice(0, 24)}`;
const lenById = new Map<string, number>();
for (const r of rows) if (!lenById.has(caseId(r))) lenById.set(caseId(r), r.len);

for (const f of files) {
  const j: Run = JSON.parse(readFileSync(join(DIR, f), 'utf8'));
  if (!j.cases.some(c => c.verdict)) continue;

  console.log(`\n=== ${j.config} ===`);
  console.log(`${'klasse'.padEnd(10)} ${VERDICTS.map(v => v.padStart(12)).join('')}`);
  for (const k of KINDS) {
    const s = j.cases.filter(c => c.kind === k && c.verdict);
    if (!s.length) continue;
    console.log(`${k.padEnd(10)} ${VERDICTS.map(v => {
      const n = s.filter(c => c.verdict === v).length;
      return `${n} (${(100 * n / s.length).toFixed(0)}%)`.padStart(12);
    }).join('')}`);
  }

  // regelvarianter
  const LEN_HI = 1.35;   // fletting gir et helt ekstra vers → tydelig lengre
  const regler: Record<string, (c: VerdictCase) => boolean> = {
    'alt som ikke er EQUIVALENT': c => c.verdict !== 'EQUIVALENT',
    'uten B_EXTRA':               c => c.verdict === 'B_MISSING' || c.verdict === 'DIFFERENT',
    'B_EXTRA kun når lang':       c => c.verdict === 'B_MISSING' || c.verdict === 'DIFFERENT'
                                     || (c.verdict === 'B_EXTRA' && (lenById.get(c.id) ?? 1) > LEN_HI),
  };
  console.log(`\n${'regel'.padEnd(28)} ${'falsk alarm'.padStart(12)} ${['GRENSE', 'FEILVERS', 'FLETTET'].map(k => k.padStart(10)).join('')} ${'bomrate'.padStart(10)}`);
  for (const [navn, fn] of Object.entries(regler)) {
    const g = (k: string): VerdictCase[] => j.cases.filter(c => c.kind === k && c.verdict);
    const pc = (k: string): string => { const s = g(k); return s.length ? `${(100 * s.filter(fn).length / s.length).toFixed(0)}%` : '-'; };
    const bad = j.cases.filter(c => c.kind !== 'OK' && c.verdict);
    const miss = 100 * bad.filter(c => !fn(c)).length / bad.length;
    console.log(`${navn.padEnd(28)} ${pc('OK').padStart(12)} ${['GRENSE', 'FEILVERS', 'FLETTET'].map(k => pc(k).padStart(10)).join('')} ${(miss.toFixed(1) + '%').padStart(10)}`);

    // lagre variantene som egne dommer, så ensemblet kan bruke dem
    if (navn !== 'alt som ikke er EQUIVALENT') {
      const slug = navn === 'uten B_EXTRA' ? 'noextra' : 'extraiflong';
      writeFileSync(join(DIR, `${j.config}-${slug}.json`), JSON.stringify({
        config: `${j.config}-${slug}`,
        cases: j.cases.map(c => ({ id: c.id, tr: c.tr, kind: c.kind, flag: c.verdict ? fn(c) : null })),
      }));
    }
  }
}
