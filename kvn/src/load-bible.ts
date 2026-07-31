import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BIBLES_DIR = join(__dirname, '../../generate/bibles_raw/osnb');

import type { Verse as RawVerse } from './bible-types.js';

// Korpuset ligger TO NIVÅER OPP, altså utenfor pakka. Det er greit her — denne
// fila er testinfrastruktur for free-bibles eget korpus, ikke bibliotekflate
// (den står ikke i `package.json` sin `exports`, og bare tester importerer
// den). Men stien holder bare så lenge fila ligger i free-bible/kvn/src/.
//
// Blir `kvn/` vendret inn i et annet repo som `file:`-avhengighet, peker
// `../../generate/` ut i intet — og fram til nå sa den ingenting om det:
//
//   if (!existsSync(filePath)) return 0;
//
// En manglende datakatalog var dermed umulig å skille fra «kapittelet har null
// vers». `getMaxVerse(1, 1)` ga 0 i stedet for 31, uten en eneste feilmelding,
// og feilen dukket opp langt unna som «1 Mos 1:1 should exist = false». Det
// kostet en full feilsøkingsøkt å finne ut at kildekoden var identisk og at
// bare PLASSERINGEN skilte (bible.flogvit.com#62).
//
// Skillet som må holdes, og som `existsSync` alene ikke klarer:
//
//   Kapittelet finnes ikke      -> 0 er RIKTIG svar. Kallere løper over
//                                  kapitler og stoler på det.
//   Korpuset finnes ikke        -> KONFIGURASJONSFEIL. Skal si fra, høyt.
//
// Derfor sjekkes ROTEN separat fra den enkelte fila.

let corpusVerified = false;

/**
 * Kaster hvis korpusroten ikke finnes. Eksportert fordi det er halvparten av
 * kontrakten her, og en test som ikke kan treffe den kan ikke vokte den.
 */
export function verifyCorpus(dir: string = BIBLES_DIR): void {
  if (existsSync(dir)) return;
  throw new Error(
    [
      `Finner ikke råkorpuset osnb: ${dir}`,
      '',
      'load-bible.ts leser free-bibles eget korpus relativt til sin egen',
      'plassering (../../generate/bibles_raw/osnb). Stien holder bare når fila',
      'ligger i free-bible/kvn/src/.',
      '',
      'Er dette en VENDRET kopi av kvn i et annet repo, hører denne fila og',
      'testene som bruker den ikke med i kopien — de tester free-bibles data,',
      'ikke biblioteket.',
    ].join('\n'),
  );
}

/** Sjekkes én gang per prosess; korpuset dukker ikke opp midt i en kjøring. */
function corpus(): string {
  if (!corpusVerified) {
    verifyCorpus();
    corpusVerified = true;
  }
  return BIBLES_DIR;
}

/**
 * Get number of chapters for a book in osnb.
 *
 * 0 = boken finnes ikke i korpuset. Mangler HELE korpuset, kastes det i stedet.
 */
export function getChapterCount(bookId: number): number {
  const bookDir = join(corpus(), String(bookId));
  if (!existsSync(bookDir)) return 0;
  return readdirSync(bookDir).filter(f => f.endsWith('.json')).length;
}

/**
 * Get max verse number for a specific chapter in osnb.
 *
 * 0 = kapittelet finnes ikke. Mangler HELE korpuset, kastes det i stedet.
 */
export function getMaxVerse(bookId: number, chapter: number): number {
  const filePath = join(corpus(), String(bookId), `${chapter}.json`);
  if (!existsSync(filePath)) return 0;
  const verses: RawVerse[] = JSON.parse(readFileSync(filePath, 'utf-8'));
  if (verses.length === 0) return 0;
  return Math.max(...verses.map(v => v.verseId));
}

/**
 * Check if a specific verse exists in osnb.
 *
 * false = verset finnes ikke. Mangler HELE korpuset, kastes det i stedet.
 */
export function verseExists(bookId: number, chapter: number, verse: number): boolean {
  const filePath = join(corpus(), String(bookId), `${chapter}.json`);
  if (!existsSync(filePath)) return false;
  const verses: RawVerse[] = JSON.parse(readFileSync(filePath, 'utf-8'));
  return verses.some(v => v.verseId === verse);
}

/**
 * Get total verse count across all books in osnb.
 *
 * Uten korpus ville denne returnert 0 — et tall som ser ut som et svar. Den
 * kaster i stedet, av samme grunn som de andre.
 */
export function getTotalVerseCount(): number {
  const dir = corpus();
  let total = 0;
  for (let book = 1; book <= 66; book++) {
    const bookDir = join(dir, String(book));
    if (!existsSync(bookDir)) continue;
    for (const file of readdirSync(bookDir).filter(f => f.endsWith('.json'))) {
      const verses: RawVerse[] = JSON.parse(readFileSync(join(bookDir, file), 'utf-8'));
      total += verses.length;
    }
  }
  return total;
}
