/**
 * Strukturell dekningssjekk: finner osmain-vers som mappingen slår opp til et
 * versnummer oversettelsen ikke har.
 *
 * KJØR DENNE FØR `verify-text.ts`. Den er gratis — ingen modell, ingen GPU — og
 * den fant 168 774 uoppnåelige vers i 1 119 oversettelser første gang den gikk.
 * Uten den brukes måneder med GPU-tid på å verifisere tekst i vers der oppslaget
 * ikke kan lykkes uansett hva teksten sier.
 *
 * Årsaken er nesten alltid parafraser som fletter vers og merker blokken med det
 * FØRSTE versnummeret:
 *
 *   norwegian2018 1 Mos 1 har 17 vers med numrene 1,3,6,9,11,14,…
 *   v1 = «I begynnelsen skapte Gud himmelen og jorden. Jorden var ikke formet…»
 *        altså osmain 1,1 OG 1,2 i ett
 *
 * Mappingen behandler kapitlet som identitet, så osmain 1,2 slås opp som
 * oversettelsens vers 2 — som ikke finnes. Riktig post er en fletting eller et
 * delvers (`part`), ikke identitet.
 *
 * `kvn/tests` fanger det ikke: de sjekker at postene er velformede, ikke at
 * målet finnes.
 *
 * Bruk:
 *   npx tsx scripts/check-mapping-coverage.ts                  # alle
 *   npx tsx scripts/check-mapping-coverage.ts spanish japanese_jcb
 *   npx tsx scripts/check-mapping-coverage.ts --min 50          # bare de verste
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadUkvnMapping, listUkvnMappings } from '../src/ukvn-loader.js';
import { ukvnEncode, ukvnDecode, UKVN_PART_SIZE } from '../src/ukvn-types.js';
import { UkvnMapper } from '../src/ukvn-mapper.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '../..');
const RAW = join(REPO, 'generate/bibles_raw');
const OUT = join(REPO, 'kvn/data/mapping-coverage.json');

const args = process.argv.slice(2);
const mi = args.indexOf('--min');
const MIN_REPORT = mi >= 0 ? Number(args[mi + 1]) : 1;
const only = args.filter((a, i) => !a.startsWith('--') && i !== mi + 1);

interface Verse { verseId: number; text: string }

/** Versnumre per kapittel for en oversettelse: "bok:kap" → Set<versId> */
function structure(name: string): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>();
  const root = join(RAW, name);
  if (!existsSync(root)) return out;
  for (const bd of readdirSync(root)) {
    const b = Number(bd);
    if (!Number.isInteger(b) || b < 1 || b > 66) continue;
    for (const cf of readdirSync(join(root, bd))) {
      if (!cf.endsWith('.json')) continue;
      const c = Number(cf.slice(0, -5));
      if (!Number.isInteger(c)) continue;
      try {
        const verses: Verse[] = JSON.parse(readFileSync(join(root, bd, cf), 'utf8'));
        out.set(`${b}:${c}`, new Set(verses.filter(v => v.text?.trim()).map(v => v.verseId)));
      } catch { /* ødelagt fil — hopper over kapitlet */ }
    }
  }
  return out;
}

const osmain = structure('osmain');
if (!osmain.size) { console.error('fant ikke osmain'); process.exit(1); }

interface Finding {
  translation: string;
  missing: number;
  chapters: number;
  /** Ser det ut som en flettende parafrase? Da er hullene systematiske. */
  looksLikeParaphrase: boolean;
  examples: string[];
}

const findings: Finding[] = [];
const names = only.length ? only : listUkvnMappings().filter(n => existsSync(join(RAW, n)));
console.log(`${names.length} oversettelser\n`);

for (const name of names) {
  let mapper: UkvnMapper;
  try { mapper = new UkvnMapper(loadUkvnMapping(name)); } catch { continue; }

  const trStruct = structure(name);
  if (!trStruct.size) continue;

  let missing = 0;
  const badChapters = new Set<string>();
  const examples: string[] = [];
  // hvor mange av oversettelsens kapitler har FÆRRE vers enn osmain? Er det
  // nesten alle, er det en flettende parafrase og ikke enkeltstående hull.
  let shorter = 0, comparable = 0;

  for (const [key, trIds] of trStruct) {
    const osIds = osmain.get(key);
    if (!osIds) continue;                        // kapittel osmain ikke har
    comparable++;
    if (trIds.size < osIds.size) shorter++;

    const [b, c] = key.split(':').map(Number);
    for (const v of osIds) {
      const tkvn = mapper.toTkvn(ukvnEncode(b, c, v));
      const d = ukvnDecode(tkvn);
      // Delvers er per definisjon dekket av grunnverset.
      if (d.part > 0) continue;
      // Krysskapittel-poster peker et annet sted; sjekk der.
      const targetIds = d.chapter === c && d.book === b ? trIds : trStruct.get(`${d.book}:${d.chapter}`);
      if (targetIds?.has(d.verse)) continue;
      missing++;
      badChapters.add(key);
      if (examples.length < 4) examples.push(`${b} ${c}:${v} → ${d.chapter},${d.verse} (finnes ikke)`);
    }
  }

  if (missing >= MIN_REPORT) {
    findings.push({
      translation: name,
      missing,
      chapters: badChapters.size,
      looksLikeParaphrase: comparable > 20 && shorter / comparable > 0.5,
      examples,
    });
  }
}

findings.sort((a, b) => b.missing - a.missing);
const total = findings.reduce((s, f) => s + f.missing, 0);
const paraphrases = findings.filter(f => f.looksLikeParaphrase);

writeFileSync(OUT, JSON.stringify({
  generated: 'check-mapping-coverage.ts',
  totals: {
    translations: findings.length,
    verses: total,
    paraphrases: paraphrases.length,
    versesInParaphrases: paraphrases.reduce((s, f) => s + f.missing, 0),
  },
  findings,
}, null, 1));

console.log(`${'oversettelse'.padEnd(26)} ${'vers'.padStart(7)} ${'kap'.padStart(6)}  merknad`);
console.log('-'.repeat(70));
for (const f of findings.slice(0, 30)) {
  console.log(
    `${f.translation.padEnd(26)} ${String(f.missing).padStart(7)} ${String(f.chapters).padStart(6)}  ` +
    (f.looksLikeParaphrase ? 'flettende parafrase — systematisk' : f.examples[0] ?? '')
  );
}
if (findings.length > 30) console.log(`… og ${findings.length - 30} flere`);

console.log(`\n${total} uoppnåelige vers i ${findings.length} oversettelser`);
console.log(`  ${paraphrases.length} av dem er flettende parafraser (${paraphrases.reduce((s, f) => s + f.missing, 0)} vers)`);
console.log(`  — de trenger flettings- eller delversposter, ikke identitet`);
console.log(`\nRapport: kvn/data/mapping-coverage.json`);
