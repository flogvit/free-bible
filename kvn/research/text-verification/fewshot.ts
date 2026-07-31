/**
 * Kalibrering per oversettelse.
 *
 * Falsk alarm kommer av at modellen ikke vet hvor fri denne oversettelsen er.
 * Vi viser den derfor noen ekte par fra SAMME oversettelse først:
 *   - to-tre riktige par, merket EQUIVALENT  (dette er normal variasjon her)
 *   - ett par som er to ulike vers, merket DIFFERENT  (motvekt mot ja-skjevhet)
 *
 * Eksemplene lekker ikke feiltypen — ingen av dem er avkortet eller flettet.
 * Eksempelversene holdes utenfor testsettet.
 */
import { readFileSync, writeFileSync } from 'fs';

/** Feiltypene `matrix.ts` lager. `AVKORTET` finnes i dataene, men brukes ikke her. */
type Kind = 'OK' | 'GRENSE' | 'AVKORTET' | 'FEILVERS' | 'FLETTET';

/** En rad i `matrix.json`, slik `matrix.ts` skriver den. */
interface Row {
  tr: string;
  kind: Kind;
  sim: number;
  simZ: number;
  len: number;
  A: string;
  B: string;
}

/** Kalibreringseksemplene for én oversettelse. */
interface Shots {
  same: Row[];
  diff: Row;
}

/** Ett par i testsettet. */
interface Case {
  tr: string;
  kind: Kind;
  A: string;
  B: string;
}

/** Verdiene skjemaet under tillater. */
type Verdict = 'EQUIVALENT' | 'B_MISSING' | 'B_EXTRA' | 'DIFFERENT';

const DIR = '/private/tmp/claude-501/-Users-vhanssen-WebstormProjects-flogvit-free-bible/d75e4318-6f77-4d5f-a6f5-6476f4c272c0/scratchpad';
const KINDS: Kind[] = ['OK', 'GRENSE', 'FEILVERS', 'FLETTET'];
const N_PER = 5;

const rows: Row[] = JSON.parse(readFileSync(`${DIR}/matrix.json`, 'utf8'));
const byTr = new Map<string, Map<Kind, Row[]>>();
for (const r of rows) {
  if (r.kind === 'AVKORTET') continue;
  if (!byTr.has(r.tr)) byTr.set(r.tr, new Map<Kind, Row[]>(KINDS.map(k => [k, []])));
  byTr.get(r.tr)!.get(r.kind)?.push(r);
}

// eksempler tas fra starten, testsettet fra resten — ingen overlapp
const shots = new Map<string, Shots>(), cases: Case[] = [];
for (const [tr, m] of byTr) {
  const ok = m.get('OK')!, wrong = m.get('FEILVERS')!;
  if (ok.length < 12 || wrong.length < 4) continue;
  shots.set(tr, {
    same: [ok[0], ok[1], ok[2]],
    diff: wrong[0],
  });
  for (const k of KINDS) {
    const pool = m.get(k)!.slice(4);      // hopp over det eksemplene kom fra
    const step = Math.max(1, Math.floor(pool.length / N_PER));
    for (let i = 0, n = 0; i < pool.length && n < N_PER; i += step, n++) cases.push({ tr, kind: k, A: pool[i].A, B: pool[i].B });
  }
}
console.log(`${cases.length} par, ${shots.size} oversettelser\n`);

const schema = { type: 'object', properties: { verdict: { type: 'string', enum: ['EQUIVALENT', 'B_MISSING', 'B_EXTRA', 'DIFFERENT'] } }, required: ['verdict'] };
const RUBRIC = `Do they carry the same content?

EQUIVALENT — same content
B_MISSING   — B leaves out something A states
B_EXTRA     — B states something beyond A
DIFFERENT   — not the same passage`;

const plain = (A: string, B: string) =>
  `A and B are two renderings of the same Bible verse in different languages.\n\nA: ${A}\nB: ${B}\n\n${RUBRIC}`;

const calibrated = (tr: string, A: string, B: string) => {
  const s = shots.get(tr)!;
  const ex = [
    ...s.same.map(x => `A: ${x.A}\nB: ${x.B}\n→ EQUIVALENT`),
    `A: ${s.diff.A}\nB: ${s.diff.B}\n→ DIFFERENT`,
  ].join('\n\n');
  return `A and B are two renderings of the same Bible verse in different languages.
B always comes from the same translation. Here is how that translation normally
renders a verse — these are the reference points for what counts as EQUIVALENT:

${ex}

Now judge this pair by the same standard.

A: ${A}
B: ${B}

${RUBRIC}`;
};

async function ask(model: string, prompt: string): Promise<Verdict | null> {
  try {
    const r = await fetch('http://localhost:11434/api/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, stream: false, think: false, format: schema, options: { temperature: 0, num_predict: 64, num_ctx: 16384 } }),
    });
    return JSON.parse((await r.json()).response).verdict;
  } catch { return null; }
}

const model = process.argv[2] ?? 'gemma4:31b';
console.log(`=== ${model} ===`);
console.log(`${'variant'.padEnd(16)} ${'falsk alarm'.padStart(12)} ${['GRENSE', 'FEILVERS', 'FLETTET'].map(k => k.padStart(10)).join('')}`);

/** Teller per feiltype: `n` par sett, `f` av dem flagget. */
interface PerKind { n: number; f: number; }
/** Teller per oversettelse: kontrollgruppa (`ok`) mot resten (`bad`). */
interface PerTr { ok: number; okF: number; bad: number; badF: number; }
interface VariantResult { per: Record<Kind, PerKind>; perTr: Record<string, PerTr>; }

const out: Record<string, VariantResult> = {};
for (const [name, build] of [['uten eksempler', c => plain(c.A, c.B)], ['med kalibrering', c => calibrated(c.tr, c.A, c.B)]] as [string, (c: Case) => string][]) {
  const per = Object.fromEntries(KINDS.map(k => [k, { n: 0, f: 0 }])) as Record<Kind, PerKind>;
  const perTr: Record<string, PerTr> = {};
  for (const c of cases) {
    const v = await ask(model, build(c));
    if (!v) continue;
    const f = v !== 'EQUIVALENT';
    per[c.kind].n++; if (f) per[c.kind].f++;
    perTr[c.tr] ??= { ok: 0, okF: 0, bad: 0, badF: 0 };
    if (c.kind === 'OK') { perTr[c.tr].ok++; if (f) perTr[c.tr].okF++; }
    else { perTr[c.tr].bad++; if (f) perTr[c.tr].badF++; }
  }
  out[name] = { per, perTr };
  const pc = (k: Kind) => `${(100 * per[k].f / (per[k].n || 1)).toFixed(0)}%`.padStart(10);
  console.log(`${name.padEnd(16)} ${((100 * per.OK.f / (per.OK.n || 1)).toFixed(1) + '%').padStart(12)} ${(['GRENSE', 'FEILVERS', 'FLETTET'] as Kind[]).map(pc).join('')}`);
}

console.log(`\nfalsk alarm per oversettelse:`);
console.log(`${'oversettelse'.padEnd(20)} ${'uten'.padStart(8)} ${'med'.padStart(8)}`);
for (const tr of shots.keys()) {
  const a = out['uten eksempler'].perTr[tr], b = out['med kalibrering'].perTr[tr];
  if (!a || !b) continue;
  console.log(`${tr.padEnd(20)} ${((100 * a.okF / (a.ok || 1)).toFixed(0) + '%').padStart(8)} ${((100 * b.okF / (b.ok || 1)).toFixed(0) + '%').padStart(8)}`);
}
writeFileSync(`${DIR}/fewshot-results.json`, JSON.stringify(out, null, 1));
