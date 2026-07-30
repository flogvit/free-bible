/**
 * Lag 1 i mapping-verifiseringen (issue #18): lengdekorrelasjons-screen.
 *
 * Verselengder korrelerer på tvers av språk (et langt vers på hebraisk er
 * langt på swahili). For hvert kapittel scores mappingens effektive
 * justering (entries + identitetsfallback) mot rene skift-hypoteser
 * (-3..+3) på Pearson-korrelasjon av lengdeprofilene.
 *
 * Verdikter per kapittel:
 *  - PASS     mappingens justering er best (eller innen margin av best)
 *  - AUTOFIX  et annet rent skift vinner entydig (høy score, klar margin,
 *             nok vers) — entries kan genereres mekanisk med --apply
 *  - UNCLEAR  ingen hypotese er overbevisende (fletting/splitting) —
 *             kandidat for tekstbasert dom (Claude)
 * Kapitler med identiske versnummer-sett OG god identitetskorrelasjon
 * telles som PASS uten videre; identiske sett med LAV korrelasjon er
 * nettopp tittelsalme-klassen og blir UNCLEAR/AUTOFIX.
 *
 * Bruk:
 *   npx tsx scripts/screen-alignment.ts --lengths <fil> [--apply] [oversettelser...]
 *
 * Lengdefila: { <oversettelse>: { "bok:kap": [[verseId, tekstlengde], ...] } }
 * (bygges av en scan over generate/bibles_raw). Rapport skrives til
 * kvn/data/alignment-screen.json (sammendrag + alle ikke-PASS-celler).
 */
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { listUkvnMappings, loadUkvnMapping } from '../src/ukvn-loader.js';
import { ukvnDecode, ukvnEncode } from '../src/ukvn-types.js';

const REPO = join(import.meta.dirname, '../..');
const MAPPINGS_DIR = join(import.meta.dirname, '../mappings');

const args = process.argv.slice(2);
const li = args.indexOf('--lengths');
if (li < 0) { console.error('Mangler --lengths <fil>'); process.exit(1); }
const apply = args.includes('--apply');
const only = args.filter((a, i) => !a.startsWith('--') && i !== li + 1);

const MIN_PAIRS = 8;        // færre vers gir ustabil korrelasjon
const PASS_SCORE = 0.75;
const AUTOFIX_SCORE = 0.9;  // vinnerhypotesens minstekrav
const AUTOFIX_MARGIN = 0.3; // ...og avstand ned til mappingens score
const MIN_CV = 0.2;         // jevne verselengder (Ordspråkene) gir ikke signal

type Lengths = Record<string, Record<string, [number, number][]>>;
const lengths: Lengths = JSON.parse(readFileSync(args[li + 1], 'utf8'));
const osm = lengths['osmain'];

function corr(pairs: [number, number][]): number {
  const n = pairs.length;
  if (n < 4) return 0;
  const ma = pairs.reduce((s, p) => s + p[0], 0) / n;
  const mb = pairs.reduce((s, p) => s + p[1], 0) / n;
  let cov = 0, va = 0, vb = 0;
  for (const [x, y] of pairs) { cov += (x - ma) * (y - mb); va += (x - ma) ** 2; vb += (y - mb) ** 2; }
  return va && vb ? cov / Math.sqrt(va * vb) : 0;
}

interface Cell { key: string; verdict: 'AUTOFIX' | 'UNCLEAR' | 'LOWSIGNAL'; mapScore: number; bestShift: number; bestScore: number; pairs: number }

function screen(name: string): { pass: number; skipped: number; cells: Cell[] } {
  const fp = lengths[name];
  const mapping = loadUkvnMapping(name);
  // effektiv justering fra entries: "b:c" -> Map<osVers, trVers> (+ krysskap. markeres som ikke-ren)
  const entryMap = new Map<string, Map<number, number>>();
  const crossChapter = new Set<string>();
  for (const e of mapping.map) {
    const k = ukvnDecode(e.kvnFrom); const k2 = ukvnDecode(e.kvnTo);
    const t = ukvnDecode(e.tkvnFrom);
    const key = `${k.book}:${k.chapter}`;
    if (t.book !== k.book || t.chapter !== k.chapter) { crossChapter.add(key); crossChapter.add(`${t.book}:${t.chapter}`); continue; }
    if (!entryMap.has(key)) entryMap.set(key, new Map());
    for (let v = k.verse, tv = t.verse; v <= k2.verse; v++, tv++) entryMap.get(key)!.set(v, tv);
  }

  // Pass 1: score alle kapitler, og bygg oversettelsens egen baseline fra
  // identisk-nummererte kapitler (de er nesten alltid riktig justert).
  // Frie oversettelser (parafraser) korrelerer svakt over hele linja —
  // absolutte terskler ville flagget hele oversettelsen som støy.
  interface Scored { key: string; mapScore: number; bestShift: number; bestScore: number; pairs: number; cv: number; identical: boolean; shiftIsMapping: boolean }
  const scored: Scored[] = [];
  let skipped = 0;
  for (const key of Object.keys(fp)) {
    const trL = new Map(fp[key]);
    const osL = new Map(osm[key] ?? []);
    if (!osL.size || trL.size < 2) { skipped++; continue; }
    if (crossChapter.has(key)) { skipped++; continue; } // håndteres av kollisjonsauditen

    const em = entryMap.get(key) ?? new Map<number, number>();
    const mapPairs: [number, number][] = [];
    for (const [v, l] of osL) {
      const tv = em.get(v) ?? v;
      if (trL.has(tv)) mapPairs.push([l, trL.get(tv)!]);
    }
    if (mapPairs.length < MIN_PAIRS) { skipped++; continue; }
    const mapScore = corr(mapPairs);

    let bestShift = 0, bestScore = -2;
    for (let s = -3; s <= 3; s++) {
      const pairs: [number, number][] = [];
      for (const [v, l] of osL) if (trL.has(v + s)) pairs.push([l, trL.get(v + s)!]);
      if (pairs.length < MIN_PAIRS) continue;
      const c = corr(pairs);
      if (c > bestScore) { bestScore = c; bestShift = s; }
    }

    const osLens = mapPairs.map(p => p[0]);
    const mean = osLens.reduce((s, x) => s + x, 0) / osLens.length;
    const cv = Math.sqrt(osLens.reduce((s, x) => s + (x - mean) ** 2, 0) / osLens.length) / mean;
    const identical = osL.size === trL.size && [...osL.keys()].every(v => trL.has(v)) && em.size === 0;
    const shiftIsMapping = [...osL.keys()].every(v => !trL.has(v + bestShift) || (em.get(v) ?? v) === v + bestShift);
    scored.push({ key, mapScore, bestShift, bestScore, pairs: mapPairs.length, cv, identical, shiftIsMapping });
  }

  const idScores = scored.filter(s => s.identical && s.cv >= MIN_CV).map(s => s.mapScore).sort((a, b) => a - b);
  const baseline = idScores.length >= 20 ? idScores[Math.floor(idScores.length / 2)] : PASS_SCORE;

  // Pass 2: verdikter relativt til oversettelsens baseline
  let pass = 0;
  const cells: Cell[] = [];
  for (const s of scored) {
    const round = (x: number) => Math.round(x * 1000) / 1000;
    const cell: Cell = { key: s.key, verdict: 'UNCLEAR', mapScore: round(s.mapScore), bestShift: s.bestShift, bestScore: round(s.bestScore), pairs: s.pairs };
    if (s.cv < MIN_CV) {
      if (s.mapScore >= s.bestScore - 0.1) { pass++; continue; }
      cell.verdict = 'LOWSIGNAL'; cells.push(cell); continue;
    }
    if (!s.shiftIsMapping && s.bestScore >= AUTOFIX_SCORE && s.bestScore - s.mapScore >= AUTOFIX_MARGIN) {
      cell.verdict = 'AUTOFIX'; cells.push(cell); continue;
    }
    // mappingen er (nesten) beste hypotese og normal for oversettelsen → friskmeldt
    if (s.mapScore >= s.bestScore - 0.05 && s.mapScore >= baseline - 0.25) { pass++; continue; }
    // noe annet er merkbart bedre, men ikke autofiks-sikkert
    if (s.bestScore - s.mapScore >= 0.15) { cells.push(cell); continue; }
    // ingen ren hypotese passer, målt mot oversettelsens egen standard → fletting/splitting?
    if (s.bestScore < baseline - 0.25) { cells.push(cell); continue; }
    pass++;
  }
  return { pass, skipped, cells };
}

function applyAutofix(name: string, cells: Cell[]): number {
  const p = join(MAPPINGS_DIR, `${name}.ukvn.json`);
  const m = JSON.parse(readFileSync(p, 'utf8'));
  const fp = lengths[name];
  const bookName = new Map<number, string>();
  for (const [n, id] of Object.entries(m.bookNames as Record<string, number>)) {
    if (!bookName.has(id)) bookName.set(id, n);
  }
  let added = 0;
  for (const cell of cells) {
    if (cell.verdict !== 'AUTOFIX') continue;
    const [book, ch] = cell.key.split(':').map(Number);
    const trIds = new Set(fp[cell.key].map(x => x[0]));
    const osIds = (osm[cell.key] ?? []).map(x => x[0]);
    // fjern gamle entries for kapitlet (de scoret dårligere enn skiftet)
    m.map = m.map.filter((e: { kvnFrom: number }) => {
      const k = ukvnDecode(e.kvnFrom);
      return !(k.book === book && k.chapter === ch);
    });
    const bn = bookName.get(book) ?? String(book);
    for (const v of osIds) {
      const tv = v + cell.bestShift;
      if (!trIds.has(tv) || tv === v) continue;
      m.map.push({
        kvnFrom: ukvnEncode(book, ch, v), kvnTo: ukvnEncode(book, ch, v),
        kvnRef: `${bn} ${ch}:${v}`,
        tkvnFrom: ukvnEncode(book, ch, tv), tkvnTo: ukvnEncode(book, ch, tv),
        tkvnRef: `${bn} ${ch},${tv}`,
        order: 0,
      });
      added++;
    }
  }
  if (added) {
    m.map.sort((a: { kvnFrom: number; order: number }, b: { kvnFrom: number; order: number }) => a.kvnFrom - b.kvnFrom || a.order - b.order);
    m.stats.totalMappingEntries = m.map.length;
    writeFileSync(p, JSON.stringify(m, null, 2));
  }
  return added;
}

const names = only.length ? only : listUkvnMappings().filter(n => lengths[n]);
const report: Record<string, { pass: number; skipped: number; autofix: Cell[]; unclear: Cell[]; lowsignal: Cell[] }> = {};
let totPass = 0, totFix = 0, totUnclear = 0, totLow = 0, totApplied = 0;
for (const name of names) {
  if (!lengths[name]) continue;
  const r = screen(name);
  const autofix = r.cells.filter(c => c.verdict === 'AUTOFIX');
  const unclear = r.cells.filter(c => c.verdict === 'UNCLEAR');
  const lowsignal = r.cells.filter(c => c.verdict === 'LOWSIGNAL');
  totPass += r.pass; totFix += autofix.length; totUnclear += unclear.length; totLow += lowsignal.length;
  if (r.cells.length) report[name] = { pass: r.pass, skipped: r.skipped, autofix, unclear, lowsignal };
  if (apply && autofix.length) totApplied += applyAutofix(name, autofix);
}

writeFileSync(join(REPO, 'kvn/data/alignment-screen.json'), JSON.stringify({
  thresholds: { MIN_PAIRS, PASS_SCORE, AUTOFIX_SCORE, AUTOFIX_MARGIN, MIN_CV },
  totals: { pass: totPass, autofix: totFix, unclear: totUnclear, lowsignal: totLow },
  translations: report,
}, null, 2));

console.log(`${names.length} mappinger screenet`);
console.log(`PASS: ${totPass}  AUTOFIX: ${totFix}  UNCLEAR: ${totUnclear}  LOWSIGNAL: ${totLow}`);
if (apply) console.log(`Applisert: ${totApplied} entries`);
