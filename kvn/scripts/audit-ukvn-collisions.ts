/**
 * Kollisjonsaudit for ukvn-mappinger (issue #18).
 *
 * Signaturen på en trunkert mapping (à la Dan 6): entries flytter osmain-vers
 * n → n+1 et stykke ut i kapitlet og stopper, slik at neste osmain-vers faller
 * tilbake på identitet og KOLLIDERER med forrige entrys mål. Legitime tilfeller
 * (ekstra sluttvers som venter på osmain-utvidelse) gir ingen kollisjon.
 *
 * Rapporterer per mapping:
 *  - KOLLISJON: identitetsfallback treffer samme oversettelsesvers som en entry
 *  - DANGLING: entry peker på oversettelsesvers som ikke finnes i dataene
 *
 * Bruk: npx tsx scripts/audit-ukvn-collisions.ts [mappingnavn ...]
 * Uten argumenter auditeres alle mappinger som har datamodul med samme navn.
 */
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { loadUkvnMapping, listUkvnMappings } from '../src/ukvn-loader.js';
import { ukvnDecode } from '../src/ukvn-types.js';

const REPO = join(import.meta.dirname, '../..');
const RAW = join(REPO, 'generate/bibles_raw');

function verseIds(module: string, book: number, chapter: number): Set<number> | null {
  const p = join(RAW, module, String(book), `${chapter}.json`);
  if (!existsSync(p)) return null;
  try {
    return new Set(JSON.parse(readFileSync(p, 'utf8')).map((v: { verseId: number }) => v.verseId));
  } catch {
    return null;
  }
}

function audit(name: string): { collisions: string[]; dangling: string[] } | null {
  if (!existsSync(join(RAW, name))) return null;
  const mapping = loadUkvnMapping(name);

  // Grupper entries per osmain-kapittel, og samle entry-mål per oversettelses-kapittel
  const byOsChapter = new Map<string, { osVerses: Set<number>; }>();
  const targets = new Map<string, Map<number, string>>(); // "b:c" -> trVers -> kvnRef
  for (const e of mapping.map) {
    const k1 = ukvnDecode(e.kvnFrom); const k2 = ukvnDecode(e.kvnTo);
    const t1 = ukvnDecode(e.tkvnFrom); const t2 = ukvnDecode(e.tkvnTo);
    const osKey = `${k1.book}:${k1.chapter}`;
    if (!byOsChapter.has(osKey)) byOsChapter.set(osKey, { osVerses: new Set() });
    for (let v = k1.verse; v <= k2.verse; v++) byOsChapter.get(osKey)!.osVerses.add(v);
    const trKey = `${t1.book}:${t1.chapter}`;
    if (!targets.has(trKey)) targets.set(trKey, new Map());
    for (let v = t1.verse; v <= t2.verse; v++) {
      if (!targets.get(trKey)!.has(v)) targets.get(trKey)!.set(v, e.kvnRef);
    }
  }

  const collisions: string[] = [];
  const dangling: string[] = [];

  // Dangling: entry-mål som ikke finnes i oversettelsens data
  for (const [trKey, verses] of targets) {
    const [b, c] = trKey.split(':').map(Number);
    const tr = verseIds(name, b, c);
    if (!tr) continue; // kapittel mangler i data (hull i høsting) — ikke mappingens feil
    for (const [v, ref] of verses) {
      if (!tr.has(v)) dangling.push(`${ref} -> ${trKey.replace(':', ' ')},${v} finnes ikke i data`);
    }
  }

  // Trunkeringssignatur: et kapittel MED entries der eksisterende
  // oversettelsesvers likevel ikke nås av verken entry eller identitet.
  // (Merges er lovlige — to osmain-vers på samme mål. Ekstra sluttvers uten
  // entries i kapitlet er lovlig — venter på osmain-utvidelse. Men entries +
  // unåelige vers i samme kapittel betyr at entriene stopper for tidlig.)
  const trChapters = new Set([...targets.keys()]);
  for (const [osKey] of byOsChapter) trChapters.add(osKey);
  for (const trKey of trChapters) {
    const [b, c] = trKey.split(':').map(Number);
    const tr = verseIds(name, b, c);
    const os = verseIds('osmain', b, c);
    if (!tr || !os) continue;
    const hit = targets.get(trKey) ?? new Map<number, string>();
    // identitet dekker tr-vers v hvis osmain har v i samme kapittel og
    // osmain-verset ikke er flyttet vekk av en egen entry
    const osMoved = byOsChapter.get(trKey)?.osVerses ?? new Set<number>();
    const unreachable = [...tr]
      .filter((v) => !hit.has(v) && !(os.has(v) && !osMoved.has(v)))
      .sort((a, z) => a - z);
    if (unreachable.length && (hit.size || osMoved.size)) {
      collisions.push(`${trKey.replace(':', ' ')}: vers [${unreachable.join(',')}] nås ikke (kapitlet har ${hit.size} entry-mål)`);
    }
  }

  return { collisions, dangling };
}

const names = process.argv.slice(2).length ? process.argv.slice(2) : listUkvnMappings();
let bad = 0, skipped = 0;
for (const name of names) {
  const r = audit(name);
  if (!r) { skipped++; continue; }
  if (r.collisions.length || r.dangling.length) {
    bad++;
    console.log(`\n== ${name}: ${r.collisions.length} kollisjoner, ${r.dangling.length} dangling`);
    for (const c of r.collisions.slice(0, 20)) console.log('  K: ' + c);
    for (const d of r.dangling.slice(0, 10)) console.log('  D: ' + d);
    if (r.collisions.length > 20 || r.dangling.length > 10) console.log('  … (kuttet)');
  }
}
console.log(`\n${names.length} mappinger sjekket, ${bad} med funn, ${skipped} uten datamodul (hoppet over)`);
