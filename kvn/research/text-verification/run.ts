/**
 * Kjører én konfigurasjon over testsettet og lagrer dommen PER PAR.
 *
 * Poenget med per-par-lagring: ensembler kan regnes ut i ettertid uten å kjøre
 * modellene på nytt. «Hva blir bomraten hvis gemma4 ELLER lengde ELLER bge-m3
 * slår ut?» er da et spørsmål til en fil, ikke en ny kjøring på flere timer.
 *
 *   bun run.ts <modell> [--prompt E|YN] [--think] [--pivot osmain|bsb|osen] [--shots]
 *   bun run.ts --signals            # mekaniske signaler (bge-m3 + lengde), ingen LLM
 *
 * Skriver kvn/research/text-verification/verdicts/<konfig>.json:
 *   { config, cases: [{id, tr, kind, flag}] }
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

/** Feilklassene i testsettet — fasiten hver rad er merket med. */
type Kind = 'OK' | 'GRENSE' | 'AVKORTET' | 'FEILVERS' | 'FLETTET';

/** En rad i testset.json: paret A (osmain) mot B (oversettelsen), med signalene. */
interface TestRow {
  tr: string;
  kind: Kind;
  sim: number;
  simZ: number;
  len: number;
  A: string;
  B: string;
}

/** En rad plukket ut til kjøringen, med den stabile id-en fra `caseId`. */
interface TestCase extends TestRow {
  id: string;
}

/** Én dom, slik den lagres per par i verdicts-fila. */
interface VerdictRow {
  id: string;
  tr: string;
  kind: Kind;
  flag: boolean | null;
  verdict: string | null;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const VERDICTS = join(HERE, `verdicts-n${Number((process.argv.indexOf('--n')>=0)?process.argv[process.argv.indexOf('--n')+1]:6)}`);
const KINDS: Kind[] = ['OK', 'GRENSE', 'AVKORTET', 'FEILVERS', 'FLETTET'];

const args = process.argv.slice(2);
const opt = <T>(n: string, d: T): string | T => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const has = (n: string): boolean => args.includes(n);

/** Stabil id per par, så ulike kjøringer kan sammenliknes rad for rad. */
const caseId = (c: TestRow): string => `${c.tr}|${c.kind}|${c.A.length}|${c.B.length}|${c.B.slice(0, 24)}`;

function loadCases(): TestCase[] {
  const rows = JSON.parse(readFileSync(join(HERE, 'testset.json'), 'utf8')) as TestRow[];
  const byTr = new Map<string, Map<Kind, TestRow[]>>();
  for (const r of rows) {
    if (!byTr.has(r.tr)) byTr.set(r.tr, new Map(KINDS.map(k => [k, []] as [Kind, TestRow[]])));
    byTr.get(r.tr)!.get(r.kind)?.push(r);
  }
  const N = Number(opt('--n', 6));
  const out: TestCase[] = [];
  for (const [tr, m] of byTr) {
    for (const k of KINDS) {
      if (k === 'AVKORTET') continue;           // identisk B-tekst med GRENSE
      const pool = m.get(k)!.slice(4);          // 0-3 er reservert til kalibreringseksempler
      const step = Math.max(1, Math.floor(pool.length / N));
      for (let i = 0, n = 0; i < pool.length && n < N; i += step, n++) {
        const c = { tr, kind: k, A: pool[i].A, B: pool[i].B, sim: pool[i].sim, simZ: pool[i].simZ, len: pool[i].len };
        out.push({ ...c, id: caseId(c) });
      }
    }
  }
  return out;
}

const cases = loadCases();
mkdirSync(VERDICTS, { recursive: true });

// ------------------------------------------------- mekaniske signaler (ingen LLM)
if (has('--signals')) {
  const ok = cases.filter(c => c.kind === 'OK');
  const q = (arr: number[], p: number): number => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length * p)]; };
  // terskler settes på kontrollgruppa, ikke på feilene
  const th = {
    simZ: q(ok.map(c => c.simZ), 0.02),
    lenLo: q(ok.map(c => c.len), 0.02),
    lenHi: q(ok.map(c => c.len), 0.98),
  };
  for (const [name, fn] of [
    ['simZ', (c: TestCase) => c.simZ < th.simZ],
    ['lenLo', (c: TestCase) => c.len < th.lenLo],
    ['lenHi', (c: TestCase) => c.len > th.lenHi],
  ] as [string, (c: TestCase) => boolean][]) {
    const rows = cases.map(c => ({ id: c.id, tr: c.tr, kind: c.kind, flag: fn(c) }));
    writeFileSync(join(VERDICTS, `signal-${name}.json`), JSON.stringify({ config: `signal-${name}`, thresholds: th, cases: rows }));
    const fa = 100 * rows.filter(r => r.kind === 'OK' && r.flag).length / rows.filter(r => r.kind === 'OK').length;
    console.log(`signal-${name.padEnd(8)} falsk alarm ${fa.toFixed(1)}%  ` +
      ['GRENSE', 'FEILVERS', 'FLETTET'].map(k => {
        const s = rows.filter(r => r.kind === k);
        return `${k} ${(100 * s.filter(r => r.flag).length / s.length).toFixed(0)}%`;
      }).join('  '));
  }
  process.exit(0);
}

// ------------------------------------------------------------------ LLM-dommer
const model = args.find(a => !a.startsWith('--') && !/^\d+$/.test(a));
if (!model) { console.error('oppgi modell, eller --signals'); process.exit(1); }
const PROMPT = opt('--prompt', 'E');
const THINK = has('--think');
const PIVOT = opt('--pivot', 'osmain');
const SHOTS = has('--shots');

const schemaE = { type: 'object', properties: { verdict: { type: 'string', enum: ['EQUIVALENT', 'B_MISSING', 'B_EXTRA', 'DIFFERENT'] } }, required: ['verdict'] };
const schemaYN = { type: 'object', properties: { same: { type: 'boolean' } }, required: ['same'] };
const schemaID = { type: 'object', properties: { sameVerse: { type: 'boolean' } }, required: ['sameVerse'] };
const schemaCOV = { type: 'object', properties: { covers: { type: 'boolean' } }, required: ['covers'] };
const RUBRIC = `Do they carry the same content?

EQUIVALENT — same content
B_MISSING   — B leaves out something A states
B_EXTRA     — B states something beyond A
DIFFERENT   — not the same passage`;

// Kalibreringseksempler per oversettelse.
//
// --shots      tar dem fra fasiten (OK-klassen). Går ikke i produksjon: der vet
//              vi ikke hvilke par som er riktige før vi har verifisert dem.
// --shots-auto tar dem MEKANISK — parene med høyest likhet og lengde nærmest
//              oversettelsens egen normal. De er nesten sikkert riktige, og
//              valget krever ingen fasit. Dette er varianten som kan brukes.
const SHOTS_AUTO = has('--shots-auto');
let shotsFor = new Map<string, string>();
if (SHOTS_AUTO) {
  const rows = JSON.parse(readFileSync(join(HERE, 'testset.json'), 'utf8')) as TestRow[];
  const g = new Map<string, TestRow[]>();
  for (const r of rows) {
    if (!g.has(r.tr)) g.set(r.tr, []);
    g.get(r.tr)!.push(r);
  }
  for (const [tr, all] of g) {
    // kandidatene er ALLE par, uten å vite hvilke som er riktige
    const med = (() => { const s = all.map(r => r.len).sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; })();
    const scored = all
      .filter(r => r.A.length > 60 && r.sim != null)
      .map(r => ({ r, score: r.sim - 1.5 * Math.abs(r.len - med) }))
      .sort((a, b) => b.score - a.score);
    if (scored.length < 6) continue;
    const same = scored.slice(0, 3).map(x => x.r);
    // motvekten: paret med LAVEST skår — nesten sikkert ikke samme tekst
    const diff = scored[scored.length - 1].r;
    shotsFor.set(tr, [...same.map(x => `A: ${x.A}\nB: ${x.B}\n→ EQUIVALENT`),
                      `A: ${diff.A}\nB: ${diff.B}\n→ DIFFERENT`].join('\n\n'));
  }
}
if (SHOTS) {
  const rows = JSON.parse(readFileSync(join(HERE, 'testset.json'), 'utf8')) as TestRow[];
  // Bare OK og FEILVERS får en bøtte; `?.` under er det som stille dropper resten.
  const g = new Map<string, Partial<Record<Kind, TestRow[]>>>();
  for (const r of rows) {
    if (!g.has(r.tr)) g.set(r.tr, { OK: [], FEILVERS: [] });
    g.get(r.tr)![r.kind]?.push(r);
  }
  for (const [tr, m] of g) {
    if (m.OK!.length < 4 || m.FEILVERS!.length < 1) continue;
    shotsFor.set(tr, [...m.OK!.slice(0, 3).map(x => `A: ${x.A}\nB: ${x.B}\n→ EQUIVALENT`),
                      `A: ${m.FEILVERS![0].A}\nB: ${m.FEILVERS![0].B}\n→ DIFFERENT`].join('\n\n'));
  }
}

// To adskilte spørsmål, fordi de ikke kan stilles i ett:
//   ID   identitet  — er dette samme vers? Fri gjengivelse er fortsatt samme vers.
//                     Skal fange FEILVERS. Bør ha nær null falsk alarm.
//   COV  dekning    — dekker B alt A sier? Skal fange GRENSE/AVKORTET/FLETTET.
// Å be om begge i ett svar gjør prompten både raus på stil og streng på
// fullstendighet, og det går ikke.
const RUBRIC_ID = `Is B the same verse of the Bible as A?

A free or paraphrastic rendering is still the same verse. Omitting a detail, or
adding a few words for clarity, is still the same verse. Answer false only if B
is a different passage than A.`;

const RUBRIC_COV = `Does B state everything A states?

Ignore wording, idiom, sentence structure and length — those differ between
languages. Answer false only if a statement, action or detail present in A is
absent from B, or if B contains a statement absent from A.`;

function buildPrompt(c: TestCase): string {
  const head = `A and B are two renderings of the same Bible verse in different languages.`;
  const pair = `A: ${c.A}\nB: ${c.B}`;
  const rub = PROMPT === 'YN'
    ? `Does B carry the same content as A — nothing left out, nothing added?\nWording and language differ; that does not matter.`
    : PROMPT === 'ID' ? RUBRIC_ID
    : PROMPT === 'COV' ? RUBRIC_COV
    : RUBRIC;
  if ((!SHOTS && !SHOTS_AUTO) || !shotsFor.has(c.tr)) return `${head}\n\n${pair}\n\n${rub}`;
  return `${head}
B always comes from the same translation. Here is how that translation normally
renders a verse — these are the reference points for what counts as EQUIVALENT:

${shotsFor.get(c.tr)}

Now judge this pair by the same standard.

${pair}

${rub}`;
}

// Runde to: still spørsmålet begge veier og krev at flagget holder i begge.
// Et ekte innholdsavvik er der uansett hvilken tekst som står først; en
// tilfeldig utslagsgivende formulering er det ikke.
const SWAP = has('--swap');

async function ask(c: TestCase): Promise<boolean | null> {
  if (SWAP) {
    const fwd = await ask1({ ...c });
    if (fwd !== true) return fwd;                       // ikke flagget den ene veien → ferdig
    return await ask1({ ...c, A: c.B, B: c.A }) === true; // flagg bare hvis begge veier flagger
  }
  return ask1(c);
}

let lastVerdict: string | null = null;

async function ask1(c: TestCase): Promise<boolean | null> {
  lastVerdict = null;
  try {
    const r = await fetch('http://localhost:11434/api/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model, prompt: buildPrompt(c), stream: false, think: THINK,
        // uten dette laster ollama modellen ut mellom kallene og hver dom
        // koster en ny innlasting — målt 11 s/par mot 2,7 s/par
        keep_alive: '30m',
        format: PROMPT === 'YN' ? schemaYN : PROMPT === 'ID' ? schemaID : PROMPT === 'COV' ? schemaCOV : schemaE,
        options: { temperature: 0, num_predict: THINK ? 2048 : 64, num_ctx: (SHOTS || SHOTS_AUTO) ? 32768 : 8192 },
      }),
    });
    if (!r.ok) return null;
    const j = JSON.parse((await r.json()).response);
    if (PROMPT === 'YN') return j.same === false;
    if (PROMPT === 'ID') return j.sameVerse === false;
    if (PROMPT === 'COV') return j.covers === false;
    // Selve dommen lagres ved siden av ja/nei. Falsk alarm er systematisk
    // B_EXTRA: osmain er bygget fra osnb og er tersere enn ordrette
    // oversettelser, så KJV og Reina-Valera «har mer» uten at noe er galt.
    // Uten dommen kan den skjevheten ikke skilles ut i etterkant.
    lastVerdict = j.verdict;
    return j.verdict !== 'EQUIVALENT';
  } catch { return null; }
}

const name = [model.replace(/[:.]/g, '_'), PROMPT, THINK ? 'think' : '', PIVOT !== 'osmain' ? PIVOT : '', SHOTS ? 'shots' : '', SHOTS_AUTO ? 'shotsauto' : '', SWAP ? 'swap' : '']
  .filter(Boolean).join('-');
const outFile = join(VERDICTS, `${name}.json`);
if (existsSync(outFile) && !has('--force')) { console.log(`${name} finnes — bruk --force`); process.exit(0); }

console.log(`${name}: ${cases.length} par`);
const rows: VerdictRow[] = [];
const t0 = Date.now();
for (let i = 0; i < cases.length; i++) {
  const flag = await ask(cases[i]);
  rows.push({ id: cases[i].id, tr: cases[i].tr, kind: cases[i].kind, flag, verdict: lastVerdict });
  if ((i + 1) % 25 === 0) {
    const el = (Date.now() - t0) / 1000;
    process.stdout.write(`\r  ${i + 1}/${cases.length}  ${(el / (i + 1)).toFixed(1)}s/par  ~${((cases.length - i - 1) * el / (i + 1) / 60).toFixed(0)} min igjen`);
  }
}
process.stdout.write('\r' + ' '.repeat(78) + '\r');
writeFileSync(outFile, JSON.stringify({ config: name, model, prompt: PROMPT, think: THINK, pivot: PIVOT, shots: SHOTS, secs: (Date.now() - t0) / 1000 / cases.length, cases: rows }));

const nk = (k: Kind): VerdictRow[] => rows.filter(r => r.kind === k && r.flag !== null);
const pc = (k: Kind): string => { const s = nk(k); return s.length ? `${(100 * s.filter(r => r.flag).length / s.length).toFixed(0)}%` : '-'; };
console.log(`${name}  falsk alarm ${pc('OK')}   GRENSE ${pc('GRENSE')}  FEILVERS ${pc('FEILVERS')}  FLETTET ${pc('FLETTET')}  ${((Date.now() - t0) / 1000 / cases.length).toFixed(1)}s/par`);
