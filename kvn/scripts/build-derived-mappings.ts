/**
 * Deterministisk masseproduksjon av ukvn-mappinger (issue #17/#18).
 *
 * Mappinger avhenger kun av versifikasjonsskjema. For hver oversettelse uten mapping:
 *  - kapittel der oversettelsens versnummer-sett ⊆ osmains → identitet, ingen entries
 *  - ellers: finn en donor blant eksisterende mappinger med identisk
 *    versstruktur i HELE boka, og lån donorens entries for boka
 *  - bøker uten donor → residual (må gjennom build-mapping.ts/qwen senere)
 *
 * Boknivå (ikke kapittelnivå) fordi entries kan krysse kapittelgrenser
 * (f.eks. Esek 20:45–49 → 21,33–37).
 *
 * Skriver kvn/mappings/<oversettelse>.ukvn.json med proveniens i "derived"-feltet,
 * og en samlerapport i kvn/data/derived-mappings-report.json.
 *
 * Flaggene går gjennom den felles kontrakten i generate/cli.ts; `--help` viser dem.
 *
 * Fingerprint-fila: { <oversettelse>: { "bok:kap": [verseId, ...] } } — bygges av en
 * engangs-scan over generate/bibles_raw (se issue #17).
 */
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { listUkvnMappings, loadUkvnMapping } from '../src/ukvn-loader.js';
import { ukvnDecode } from '../src/ukvn-types.js';
import { parseArgs, formatHelp, COMMON_FLAGS } from '../../generate/cli.js';
import type { FlagSpec } from '../../generate/cli.js';

const REPO = join(import.meta.dirname, '../..');
const MAPPINGS_DIR = join(import.meta.dirname, '../mappings');

const SPEC: Record<string, FlagSpec> = {
  fingerprints: {kind: 'string', help: 'fil med versnummer-sett per oversettelse og kapittel (påkrevd)'},
  'dry-run': COMMON_FLAGS['dry-run'],
  help: COMMON_FLAGS.help,
};

const HELP_EXAMPLES = [
  'bun kvn/scripts/build-derived-mappings.ts --fingerprints kvn/data/fingerprints.json --dry-run',
  'bun kvn/scripts/build-derived-mappings.ts --fingerprints kvn/data/fingerprints.json',
];

// Donorprioritet: store, velkjente skjemaer først, deretter alfabetisk.
// Bare originale (ikke-utledede) mappinger kan være donorer.
const PRIORITY = ['kjv', 'web', 'asv', 'bsb', 'dnb2011_nb', 'segond_1910', 'rv_1909', 'luther_1912', 'synodal'];

const setEq = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => v === b[i]);
const subset = (a: number[], b: Set<number>) => a.every(v => b.has(v));

// Forhåndsindekser ankrene: entries per (osmain-)bok, og settkart per kapittel
type Entry = { kvnFrom: number; kvnTo: number; kvnRef: string; tkvnFrom: number; tkvnTo: number; tkvnRef: string; order: number };

function main(): void {
  // Hjelpen skal ut før noe leses fra eller skrives til disk.
  const { flags } = parseArgs(process.argv.slice(2), SPEC);
  if (flags.help) {
    console.log(formatHelp(
      'kvn/scripts/build-derived-mappings.ts',
      'masseproduserer ukvn-mappinger ved å låne entries fra en donor med identisk versifikasjon',
      SPEC,
      HELP_EXAMPLES,
    ));
    process.exit(0);
  }

  const fingerprintFile = flags.fingerprints as string | undefined;
  if (!fingerprintFile) { console.error('Mangler --fingerprints <fil>'); process.exit(1); }
  const dryRun = flags['dry-run'] as boolean;
  const fps: Record<string, Record<string, number[] | null>> = JSON.parse(readFileSync(fingerprintFile, 'utf8'));

  const originals = listUkvnMappings().filter(name => {
    try {
      const m = JSON.parse(readFileSync(join(MAPPINGS_DIR, `${name}.ukvn.json`), 'utf8'));
      return m.derived?.generatedBy !== 'build-derived-mappings';
    } catch { return false; }
  });
  const anchors = [...new Set([...PRIORITY.filter(a => originals.includes(a)), ...originals])]
    .filter(a => fps[a]); // bare ankre vi har data for

  const anchorEntries = new Map<string, Map<number, Entry[]>>();
  let template: { bookNames: unknown; encoding: unknown } | null = null;
  for (const a of anchors) {
    const m = loadUkvnMapping(a);
    if (!template) template = { bookNames: m.bookNames, encoding: m.encoding };
    const byBook = new Map<number, Entry[]>();
    for (const e of m.map as Entry[]) {
      const b = ukvnDecode(e.kvnFrom).book;
      if (!byBook.has(b)) byBook.set(b, []);
      byBook.get(b)!.push(e);
    }
    anchorEntries.set(a, byBook);
  }

  const osm = fps['osmain'];
  const osmSets = new Map(Object.entries(osm).map(([k, v]) => [k, new Set(v ?? [])]));

  // Håndlagde/genererte mappinger røres ikke; egne utledede regenereres
  // (slik at anker-fikser kan propageres ved å kjøre scriptet på nytt).
  const untouchable = new Set(listUkvnMappings().filter(name => {
    try {
      const m = JSON.parse(readFileSync(join(MAPPINGS_DIR, `${name}.ukvn.json`), 'utf8'));
      return m.derived?.generatedBy !== 'build-derived-mappings';
    } catch { return true; }
  }));
  const translations = Object.keys(fps).filter(m => m !== 'osmain' && !untouchable.has(m) && Object.keys(fps[m]).length > 0);

  const report: Record<string, { donors: Record<string, string>; residual: string[]; identity: number; borrowed: number }> = {};
  let written = 0;

  for (const mod of translations) {
    const fp = fps[mod];
    const books = new Set(Object.keys(fp).map(k => Number(k.split(':')[0])));
    const donors: Record<string, string> = {};
    const residual: string[] = [];
    const map: Entry[] = [];
    let identityChapters = 0, borrowedBooks = 0;

    for (const book of [...books].sort((a, b) => a - b)) {
      const chapters = Object.keys(fp).filter(k => k.startsWith(`${book}:`));
      // trenger boka entries i det hele tatt?
      const deviant = chapters.filter(k => {
        const ids = fp[k];
        if (!ids) return false;                    // ulesbart kapittel — hopp over
        const os = osmSets.get(k);
        if (!os) return true;                      // kapittel osmain ikke har
        return !subset(ids, os);
      });
      if (deviant.length === 0) { identityChapters += chapters.length; continue; }

      // finn donor med identisk struktur i alle oversettelsens kapitler i boka;
      // fallback: oversettelsens sett ⊆ donorens i alle kapitler (samme skjema,
      // oversettelsen mangler bare vers pga. hull i kilden) — merkes med ~
      let found: string | null = null;
      for (const a of anchors) {
        const afp = fps[a];
        if (chapters.every(k => afp[k] && fp[k] && setEq(afp[k]!, fp[k]!))) { found = a; break; }
      }
      if (!found) {
        // Subset er bare trygt når siste vers er likt — da er de manglende
        // versene hull i kilden, ikke et annet versifikasjonsskjema.
        // (Uten max-kravet matchet f.eks. KJV-skjema-salmer (19 vers) som
        // subset av hebraisk-skjema (21 vers) — helt feil donor.)
        for (const a of anchors) {
          const afp = fps[a];
          if (chapters.every(k => {
            if (!afp[k] || !fp[k]) return false;
            return subset(fp[k]!, new Set(afp[k]!)) && fp[k]!.at(-1) === afp[k]!.at(-1);
          })) { found = '~' + a; break; }
        }
      }
      if (found) {
        donors[String(book)] = found;
        map.push(...(anchorEntries.get(found.replace(/^~/, ''))!.get(book) ?? []));
        borrowedBooks++;
        identityChapters += chapters.length - deviant.length;
      } else {
        residual.push(...deviant);
        identityChapters += chapters.length - deviant.length;
      }
    }

    map.sort((a, b) => a.kvnFrom - b.kvnFrom || a.order - b.order);
    const out = {
      version: 2,
      system: mod,
      name: mod,
      encoding: template!.encoding,
      bookNames: template!.bookNames,
      stats: {
        identityChapters,
        mappedChapters: Object.keys(donors).length,
        totalMappingEntries: map.length,
        missingInTranslation: 0,
        expansionsNeeded: 0,
      },
      derived: {
        donors,
        residualChapters: residual,
        generatedBy: 'build-derived-mappings',
      },
      map,
    };
    report[mod] = { donors, residual, identity: identityChapters, borrowed: borrowedBooks };
    if (!dryRun) {
      writeFileSync(join(MAPPINGS_DIR, `${mod}.ukvn.json`), JSON.stringify(out, null, 2));
      written++;
    }
  }

  const totalResidual = Object.values(report).reduce((s, r) => s + r.residual.length, 0);
  const clean = Object.values(report).filter(r => r.residual.length === 0).length;
  if (!dryRun) {
    writeFileSync(join(REPO, 'kvn/data/derived-mappings-report.json'), JSON.stringify(report, null, 2));
  }
  console.log(`${translations.length} oversettelser behandlet, ${written} mappinger skrevet`);
  console.log(`${clean} oversettelser uten residual; ${totalResidual} residual-kapitler totalt (til qwen-fasen)`);
}

// Kjører bare når fila startes direkte, slik at import ikke har bivirkninger (#108).
if (import.meta.main) {
    main();
}
