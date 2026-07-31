/**
 * Hva SKAL helvers-posten peke på når delvers-poster finnes?
 *
 * 760 mappinger har `osmain V (part 0) → X+1` mens `V:a → X`. Slår en konsument
 * opp hele osmain-verset, får den da bare halen. README-en sier ikke hva som er
 * ment, så spørsmålet avgjøres på tekst: likner osmains hele vers mest på
 * oversettelsens X, på X+1, eller på X og X+1 satt sammen?
 *
 *   bun partzero.ts [antall]
 */
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '../../..');
const RAW = join(REPO, 'generate/bibles_raw');
const MAPS = join(REPO, 'kvn/mappings');
const PART = 16, MAXV = 177, MAXC = 151, MV = MAXV * PART, MC = MAXC * MV;
const dec = k => { const p = k % PART, r1 = (k - p) / PART, v = r1 % MAXV, r2 = (r1 - v) / MAXV; return { b: (r2 - r2 % MAXC) / MAXC, c: r2 % MAXC, v, p }; };

const cache = new Map();
function txt(tr, k) {
  const { b, c, v } = dec(k);
  const key = `${tr}/${b}/${c}`;
  if (!cache.has(key)) {
    const f = join(RAW, tr, String(b), `${c}.json`);
    cache.set(key, existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null);
  }
  return cache.get(key)?.find(x => x.verseId === v)?.text ?? null;
}

const embed = async t => {
  const r = await fetch('http://localhost:11434/api/embed', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'bge-m3', input: t }),
  });
  return (await r.json()).embeddings.map(v => { let s = 0; for (const x of v) s += x * x; s = Math.sqrt(s) || 1; return Float32Array.from(v, x => x / s); });
};
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

// samle tilfeller: helvers-post ≠ delvers-a-post
const want = Number(process.argv[2] ?? 60);
const cases = [];
for (const f of readdirSync(MAPS).filter(x => x.endsWith('.ukvn.json'))) {
  if (cases.length >= want) break;
  const tr = f.replace('.ukvn.json', '');
  if (!existsSync(join(RAW, tr))) continue;
  let m; try { m = JSON.parse(readFileSync(join(MAPS, f), 'utf8')); } catch { continue; }
  const whole = new Map(), first = new Map(), second = new Map();
  for (const e of m.map) {
    const d = dec(e.kvnFrom);
    if (d.p === 0) whole.set(e.kvnFrom, e.tkvnFrom);
    else if (d.p === 1) first.set(e.kvnFrom - 1, e.tkvnFrom);
    else if (d.p === 2) second.set(e.kvnFrom - 2, e.tkvnFrom);
  }
  for (const [k, t1] of first) {
    if (cases.length >= want) break;
    const w = whole.get(k), t2 = second.get(k);
    if (w === undefined || w === t1 || t2 === undefined) continue;
    cases.push({ tr, kvn: k, whole: w, a: t1, b: t2 });
  }
}
console.log(`${cases.length} tilfeller\n`);

let winA = 0, winB = 0, winAB = 0, n = 0;
const L = p => p ? String.fromCharCode(96 + p) : '';
console.log(`${'oversettelse'.padEnd(22)} ${'osmain'.padEnd(12)} ${'mot a'.padStart(7)} ${'mot b'.padStart(7)} ${'mot a+b'.padStart(8)}  vinner`);
for (const c of cases) {
  const os = txt('osmain', c.kvn);
  const ta = txt(c.tr, c.a), tb = txt(c.tr, c.b);
  if (!os || !ta || !tb || os.length < 30) continue;
  n++;
  const [eo, ea, eb, eab] = await embed([os, ta, tb, `${ta} ${tb}`]);
  const sa = dot(eo, ea), sb = dot(eo, eb), sab = dot(eo, eab);
  const best = sab >= sa && sab >= sb ? 'a+b' : sa >= sb ? 'a' : 'b';
  if (best === 'a') winA++; else if (best === 'b') winB++; else winAB++;
  const d = dec(c.kvn), dw = dec(c.whole);
  if (n <= 18) console.log(
    `${c.tr.slice(0, 22).padEnd(22)} ${(d.b + ' ' + d.c + ':' + d.v).padEnd(12)} ` +
    `${sa.toFixed(3).padStart(7)} ${sb.toFixed(3).padStart(7)} ${sab.toFixed(3).padStart(8)}  ${best}` +
    `   (mappingen peker på ${dw.c},${dw.v}${L(dw.p)} = ${c.whole === c.a ? 'a' : c.whole === c.b ? 'b' : '?'})`
  );
}
console.log(`\n${n} tilfeller målt — hva likner osmains HELE vers mest på:`);
console.log(`  bare delvers a  : ${winA}`);
console.log(`  bare delvers b  : ${winB}   ← det mappingen faktisk peker på`);
console.log(`  a og b sammen   : ${winAB}`);
