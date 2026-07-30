/**
 * Arbeidsliste fra tekstverifiseringen.
 *
 * Leser `kvn/data/text-verification/` og lager listen over vers som må ses på,
 * sortert etter feilklasse. Klassen kommer fra dommens type, som peker nesten
 * entydig på hva som er galt:
 *
 *   WRONG   dommen var DIFFERENT — 100 % av «peker på feil vers» i testsettet
 *   MERGED  dommen var B_EXTRA   — 99 % av «rommer også neste vers»
 *   SHORT   dommen var B_MISSING — 85 % av «mangler slutten»
 *   UNRESOLVED  bare mekaniske signaler slo ut; dommerne var enige om at
 *               teksten stemmer. Svakeste klassen — se på den sist.
 *
 * Uten den sorteringen er utfallet en udifferensiert haug. Med den kan hver
 * klasse rettes med sin egen framgangsmåte: WRONG trenger en forskyvning, MERGED
 * trenger en flettings- eller delverspost, SHORT trenger å finne ut hvor resten
 * av teksten ble av.
 *
 * Bruk:
 *   npx tsx scripts/verify-text-report.ts                    # sammendrag, alle
 *   npx tsx scripts/verify-text-report.ts kjv spanish        # bare disse
 *   npx tsx scripts/verify-text-report.ts --class WRONG      # bare én klasse
 *   npx tsx scripts/verify-text-report.ts --list --limit 40  # med verstekst
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ukvnDecode, UKVN_PART_SIZE } from '../src/ukvn-types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '../..');
const RAW = join(REPO, 'generate/bibles_raw');
const VER = join(REPO, 'kvn/data/text-verification');
const OUT = join(REPO, 'kvn/data/text-verification-worklist.json');

const args = process.argv.slice(2);
const opt = (n: string, d?: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const has = (n: string) => args.includes(n);
const WANT_CLASS = opt('--class');
const LIST = has('--list');
const LIMIT = Number(opt('--limit', '25'));
const only = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));

const CLASSES = ['WRONG', 'MERGED', 'SHORT', 'UNRESOLVED'] as const;
const BOOKS = ['', '1 Mos', '2 Mos', '3 Mos', '4 Mos', '5 Mos', 'Jos', 'Dom', 'Rut', '1 Sam', '2 Sam',
  '1 Kong', '2 Kong', '1 Krøn', '2 Krøn', 'Esra', 'Neh', 'Est', 'Job', 'Sal', 'Ordsp', 'Fork', 'Høys',
  'Jes', 'Jer', 'Klag', 'Esek', 'Dan', 'Hos', 'Joel', 'Am', 'Ob', 'Jona', 'Mi', 'Nah', 'Hab', 'Sef',
  'Hag', 'Sak', 'Mal', 'Matt', 'Mark', 'Luk', 'Joh', 'Apg', 'Rom', '1 Kor', '2 Kor', 'Gal', 'Ef',
  'Fil', 'Kol', '1 Tess', '2 Tess', '1 Tim', '2 Tim', 'Tit', 'Filem', 'Hebr', 'Jak', '1 Pet',
  '2 Pet', '1 Joh', '2 Joh', '3 Joh', 'Jud', 'Åp'];

interface Row {
  v: number; kvn: number; sim?: number | null; len?: number | null; lenZ?: number | null;
  cov?: number | null; punct?: boolean | null; j1?: string | null; j2?: string | null;
  verdict?: string; flag?: string[]; note?: string;
}
interface Item { tr: string; book: number; chapter: number; verse: number; kvn: number; verdict: string; flag: string[]; sim: number | null }

const cache = new Map<string, any[] | null>();
function verseText(tr: string, b: number, c: number, v: number): string | null {
  const key = `${tr}/${b}/${c}`;
  if (!cache.has(key)) {
    const f = join(RAW, tr, String(b), `${c}.json`);
    cache.set(key, existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null);
    if (cache.size > 200) { const k = cache.keys().next().value; if (k) cache.delete(k); }
  }
  return cache.get(key)?.find((x: any) => x.verseId === v)?.text ?? null;
}

if (!existsSync(VER)) { console.error(`${VER} finnes ikke — kjør verify-text.ts først`); process.exit(1); }
const translations = (only.length ? only : readdirSync(VER)).filter(t => existsSync(join(VER, t)) && !t.startsWith('_'));

const items: Item[] = [];
const perTr: Record<string, { verses: number; judged: number; counts: Record<string, number> }> = {};

for (const tr of translations) {
  const root = join(VER, tr);
  const st = { verses: 0, judged: 0, counts: Object.fromEntries(CLASSES.map(c => [c, 0])) as Record<string, number> };
  for (const bd of readdirSync(root)) {
    if (!/^\d+$/.test(bd)) continue;
    for (const cf of readdirSync(join(root, bd))) {
      if (!cf.endsWith('.json')) continue;
      let data: { rows: Row[] };
      try { data = JSON.parse(readFileSync(join(root, bd, cf), 'utf8')); } catch { continue; }
      for (const r of data.rows) {
        st.verses++;
        if (!r.verdict) continue;
        st.judged++;
        if (!CLASSES.includes(r.verdict as any)) continue;
        st.counts[r.verdict]++;
        items.push({
          tr, book: Number(bd), chapter: Number(cf.slice(0, -5)), verse: r.v,
          kvn: r.kvn, verdict: r.verdict, flag: r.flag ?? [], sim: r.sim ?? null,
        });
      }
    }
  }
  perTr[tr] = st;
}

// sterkeste bevis først: WRONG > MERGED > SHORT > UNRESOLVED, og innen klassen
// de med flest samvirkende signaler
const rank = (i: Item) => CLASSES.indexOf(i.verdict as any) * 100 - i.flag.length;
items.sort((a, b) => rank(a) - rank(b) || a.book - b.book || a.chapter - b.chapter || a.verse - b.verse);

const filtered = WANT_CLASS ? items.filter(i => i.verdict === WANT_CLASS) : items;

writeFileSync(OUT, JSON.stringify({
  generated: 'verify-text-report.ts',
  totals: {
    translations: translations.length,
    verses: Object.values(perTr).reduce((s, x) => s + x.verses, 0),
    judged: Object.values(perTr).reduce((s, x) => s + x.judged, 0),
    flagged: items.length,
    byClass: Object.fromEntries(CLASSES.map(c => [c, items.filter(i => i.verdict === c).length])),
  },
  perTranslation: perTr,
  items: filtered,
}, null, 1));

// ── sammendrag ──
console.log(`${'oversettelse'.padEnd(26)} ${'dømt'.padStart(8)} ${CLASSES.map(c => c.slice(0, 6).padStart(8)).join('')} ${'flagget'.padStart(9)}`);
console.log('-'.repeat(26 + 8 + 32 + 9));
for (const tr of translations.sort((a, b) => {
  const f = (x: string) => CLASSES.reduce((s, c) => s + perTr[x].counts[c], 0) / (perTr[x].judged || 1);
  return f(b) - f(a);
})) {
  const st = perTr[tr];
  const flagged = CLASSES.reduce((s, c) => s + st.counts[c], 0);
  console.log(
    `${tr.padEnd(26)} ${String(st.judged).padStart(8)} ` +
    CLASSES.map(c => String(st.counts[c]).padStart(8)).join('') +
    ` ${((100 * flagged / (st.judged || 1)).toFixed(1) + '%').padStart(9)}`
  );
}

const tot = Object.values(perTr).reduce((s, x) => s + x.judged, 0);
console.log(`\n${tot} vers dømt · ${items.length} flagget (${(100 * items.length / (tot || 1)).toFixed(1)} %)`);
for (const c of CLASSES) {
  const n = items.filter(i => i.verdict === c).length;
  if (n) console.log(`  ${c.padEnd(12)} ${String(n).padStart(7)}`);
}
const unjudged = Object.values(perTr).reduce((s, x) => s + x.verses - x.judged, 0);
if (unjudged) console.log(`\n  ${unjudged} vers mangler dom — kjør --pass verdict`);
console.log(`\nArbeidsliste: kvn/data/text-verification-worklist.json`);

if (LIST) {
  console.log(`\n${'─'.repeat(70)}`);
  for (const i of filtered.slice(0, LIMIT)) {
    const d = ukvnDecode(i.kvn - (i.kvn % UKVN_PART_SIZE));
    const osRef = `${BOOKS[d.book] ?? d.book} ${d.chapter},${d.verse}`;
    console.log(`\n${i.verdict}  ${i.tr}  ${BOOKS[i.book] ?? i.book} ${i.chapter},${i.verse}  →  osmain ${osRef}`);
    console.log(`  signaler: ${i.flag.join(', ')}${i.sim !== null ? `   likhet ${i.sim}` : ''}`);
    const os = verseText('osmain', d.book, d.chapter, d.verse);
    const tt = verseText(i.tr, i.book, i.chapter, i.verse);
    if (os) console.log(`  osmain: ${os.slice(0, 150)}`);
    if (tt) console.log(`  ${i.tr}: ${tt.slice(0, 150)}`);
  }
  if (filtered.length > LIMIT) console.log(`\n… og ${filtered.length - LIMIT} flere`);
}
