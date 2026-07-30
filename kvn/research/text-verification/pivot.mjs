/**
 * Er norsk feil sammenlikningsspråk?
 *
 * Samme B-side (oversettelsens vers, med de fire feiltypene), men A-siden hentes
 * fra tre kilder — alle slått opp gjennom de ekte KVN-mappingene:
 *   osmain  norsk bokmål        (dagens fasit)
 *   bsb     engelsk, moderne    (fremmed tekst, men engelsk)
 *   osen    engelsk, vår egen   (det osmainen ville bygget på)
 *
 * Hvis dommeren blir merkbart bedre med engelsk A-side, er osmainen hovedgrepet
 * og ikke en sidevei.
 */
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
const REPO = '/Users/vhanssen/WebstormProjects/flogvit/free-bible';
const RAW = join(REPO, 'generate/bibles_raw');
const MAPS = join(REPO, 'kvn/mappings');
const OUT = '/private/tmp/claude-501/-Users-vhanssen-WebstormProjects-flogvit-free-bible/d75e4318-6f77-4d5f-a6f5-6476f4c272c0/scratchpad';

// --- ukvn-koding (speiler kvn/src/ukvn-types.ts) ---
const PART = 16, MAXV = 177, MAXC = 151;
const MV = MAXV * PART, MC = MAXC * MV;
const enc = (b, c, v, p = 0) => b * MC + c * MV + v * PART + p;

/** kvn → oversettelsens tkvn, med delvers-fallback (speiler UkvnMapper.toTkvn) */
function mapperFor(name) {
  const f = join(MAPS, `${name}.ukvn.json`);
  if (!existsSync(f)) return null;
  const m = JSON.parse(readFileSync(f, 'utf8'));
  const k2t = new Map(), t2k = new Map();
  for (const e of m.map) {
    k2t.set(e.kvnFrom, e.tkvnFrom);
    if (!t2k.has(e.tkvnFrom)) t2k.set(e.tkvnFrom, e.kvnFrom);
  }
  const lift = (map, x) => {
    const hit = map.get(x); if (hit !== undefined) return hit;
    const p = x % PART;
    if (p > 0) { const base = map.get(x - p); if (base !== undefined) return base + p; }
    return x;
  };
  return { toTkvn: k => lift(k2t, k), toKvn: t => lift(t2k, t) };
}

const chCache = new Map();
function ch(tr, b, c) {
  const key = `${tr}/${b}/${c}`;
  if (chCache.has(key)) return chCache.get(key);
  const f = join(RAW, tr, String(b), `${c}.json`);
  const v = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
  chCache.set(key, v);
  return v;
}
const dec = kvn => {
  const p = kvn % PART, r1 = (kvn - p) / PART, v = r1 % MAXV, r2 = (r1 - v) / MAXV;
  return { book: (r2 - r2 % MAXC) / MAXC, chapter: r2 % MAXC, verse: v, part: p };
};
function textAt(tr, kvn) {
  const { book, chapter, verse } = dec(kvn);
  const c = ch(tr, book, chapter);
  return c?.find(x => x.verseId === verse)?.text ?? null;
}

function splitLast(text) {
  const m = [...text.matchAll(/[,;:.!?।॥။၊]\s+/g)];
  if (!m.length) return null;
  const c = m[m.length - 1];
  const head = text.slice(0, c.index + c[0].length).trim(), tail = text.slice(c.index + c[0].length).trim();
  if (head.length < 20 || tail.length < 15) return null;
  return head;
}

const SIDES = { osmain: null, bsb: mapperFor('bsb'), osen: mapperFor('osen') };
const TR = ['korean', 'thai', 'burmese', 'vietnamese_vie', 'amharic', 'awadhi', 'bashkir2023', 'swahili1850', 'russian_synodal', 'spanish'];
const CH = [[1, 22], [2, 20], [9, 17], [19, 23], [40, 5], [41, 4], [42, 15], [44, 2], [45, 8], [66, 7]];
const N_PER = 5;

const cases = [];
for (const tr of TR) {
  const tm = mapperFor(tr);
  if (!tm) { console.log(`${tr}: ingen mapping`); continue; }
  const picked = { OK: 0, GRENSE: 0, FEILVERS: 0, FLETTET: 0 };
  for (const [b, c] of CH) {
    const verses = ch(tr, b, c);
    if (!verses) continue;
    for (const v of verses) {
      if (!v.text || v.text.length < 40) continue;
      const kvn = tm.toKvn(enc(b, c, v.verseId));
      // A-tekst fra alle tre kilder; hopp over hvis en av dem mangler
      const A = {};
      let ok = true;
      for (const [name, mp] of Object.entries(SIDES)) {
        const t = textAt(name, mp ? mp.toTkvn(kvn) : kvn);
        if (!t || t.length < 40) { ok = false; break; }
        A[name] = t;
      }
      if (!ok) continue;

      const next = verses.find(x => x.verseId === v.verseId + 1)?.text;
      const head = splitLast(v.text);
      const variants = [['OK', v.text]];
      if (head) variants.push(['GRENSE', head]);
      if (next) { variants.push(['FEILVERS', next]); variants.push(['FLETTET', v.text + ' ' + next]); }
      for (const [kind, B] of variants) {
        if (picked[kind] >= N_PER) continue;
        picked[kind]++;
        cases.push({ tr, kind, A, B });
      }
    }
  }
}
console.log(`${cases.length} par, ${new Set(cases.map(c => c.tr)).size} oversettelser\n`);
writeFileSync(`${OUT}/pivot-cases.json`, JSON.stringify(cases));

// ------------------------------------------------------------------- dommeren
const schema = { type: 'object', properties: { verdict: { type: 'string', enum: ['EQUIVALENT', 'B_MISSING', 'B_EXTRA', 'DIFFERENT'] } }, required: ['verdict'] };
const build = (A, B) => `A and B are two renderings of the same Bible verse in different languages.

A: ${A}
B: ${B}

Do they carry the same content?

EQUIVALENT — same content
B_MISSING   — B leaves out something A states
B_EXTRA     — B states something beyond A
DIFFERENT   — not the same passage`;

async function ask(model, A, B) {
  try {
    const r = await fetch('http://localhost:11434/api/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt: build(A, B), stream: false, think: false, format: schema, options: { temperature: 0, num_predict: 64, num_ctx: 8192 } }),
    });
    return JSON.parse((await r.json()).response).verdict !== 'EQUIVALENT';
  } catch { return null; }
}

const model = process.argv[2] ?? 'gemma4:31b';
const KINDS = ['OK', 'GRENSE', 'FEILVERS', 'FLETTET'];
console.log(`=== ${model} ===`);
console.log(`${'A-side'.padEnd(10)} ${'falsk alarm'.padStart(12)} ${['GRENSE', 'FEILVERS', 'FLETTET'].map(k => k.padStart(10)).join('')}`);

const perSide = {};
for (const side of Object.keys(SIDES)) {
  const per = Object.fromEntries(KINDS.map(k => [k, { n: 0, f: 0 }]));
  const perTr = {};
  for (const c of cases) {
    const f = await ask(model, c.A[side], c.B);
    if (f === null) continue;
    per[c.kind].n++; if (f) per[c.kind].f++;
    perTr[c.tr] ??= { ok: 0, okF: 0, bad: 0, badF: 0 };
    if (c.kind === 'OK') { perTr[c.tr].ok++; if (f) perTr[c.tr].okF++; }
    else { perTr[c.tr].bad++; if (f) perTr[c.tr].badF++; }
  }
  perSide[side] = { per, perTr };
  const pc = k => `${(100 * per[k].f / (per[k].n || 1)).toFixed(0)}%`.padStart(10);
  console.log(`${side.padEnd(10)} ${((100 * per.OK.f / (per.OK.n || 1)).toFixed(1) + '%').padStart(12)} ${['GRENSE', 'FEILVERS', 'FLETTET'].map(pc).join('')}`);
}

console.log(`\nper oversettelse — falsk alarm / fanget:`);
console.log(`${'oversettelse'.padEnd(18)} ${Object.keys(SIDES).map(s => s.padStart(16)).join('')}`);
for (const tr of TR) {
  const cells = Object.keys(SIDES).map(s => {
    const t = perSide[s].perTr[tr];
    return t ? `${(100 * t.okF / (t.ok || 1)).toFixed(0)}% / ${(100 * t.badF / (t.bad || 1)).toFixed(0)}%`.padStart(16) : '-'.padStart(16);
  });
  console.log(`${tr.padEnd(18)} ${cells.join('')}`);
}
writeFileSync(`${OUT}/pivot-results.json`, JSON.stringify(perSide, null, 1));
