#!/usr/bin/env bun
/**
 * convert-refs.mjs — Convert plain-text Bible references to [ref:...|...] markup.
 *
 * Usage:
 *   bun convert-refs.ts [--dry-run] [--stats] [--verify] [--path <glob>]
 */

import * as fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { bookNames } from './constants.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================
// KVN book abbreviations (same as kvn/src/types.ts)
// ============================================================

// `Record`: `validateConvertedRefs` slår opp med en forkortelse lest ut av
// teksten, ikke med en av nøklene her — oppslaget er dynamisk.
const BOOK_IDS: Record<string, number> = {
  '1 Mos': 1, '2 Mos': 2, '3 Mos': 3, '4 Mos': 4, '5 Mos': 5,
  'Jos': 6, 'Dom': 7, 'Rut': 8, '1 Sam': 9, '2 Sam': 10,
  '1 Kong': 11, '2 Kong': 12, '1 Krøn': 13, '2 Krøn': 14,
  'Esra': 15, 'Neh': 16, 'Est': 17, 'Job': 18, 'Sal': 19,
  'Ordsp': 20, 'Fork': 21, 'Høgs': 22, 'Jes': 23, 'Jer': 24,
  'Klag': 25, 'Esek': 26, 'Dan': 27, 'Hos': 28, 'Joel': 29,
  'Am': 30, 'Ob': 31, 'Jona': 32, 'Mi': 33, 'Nah': 34,
  'Hab': 35, 'Sef': 36, 'Hag': 37, 'Sak': 38, 'Mal': 39,
  'Matt': 40, 'Mark': 41, 'Luk': 42, 'Joh': 43, 'Apg': 44,
  'Rom': 45, '1 Kor': 46, '2 Kor': 47, 'Gal': 48, 'Ef': 49,
  'Flp': 50, 'Kol': 51, '1 Tess': 52, '2 Tess': 53,
  '1 Tim': 54, '2 Tim': 55, 'Tit': 56, 'Filem': 57, 'Hebr': 58,
  'Jak': 59, '1 Pet': 60, '2 Pet': 61, '1 Joh': 62, '2 Joh': 63,
  '3 Joh': 64, 'Jud': 65, 'Åp': 66,
};

// Reverse: bookId → KVN abbreviation
const BOOK_NAMES: Record<number, string> = {};
for (const [name, id] of Object.entries(BOOK_IDS)) {
  if (!(id in BOOK_NAMES)) BOOK_NAMES[id] = name;
}

// ============================================================
// Name → { bookId, kvnAbbr } mapping
// ============================================================

/** Én boknavn-form, slått opp til bok-id-en og KVN-forkortelsen den peker på. */
interface BookEntry {
  bookId: number;
  kvnAbbr: string;
}

/** Map from all known book name forms to { bookId, kvnAbbr } */
function buildNameMap(): Map<string, BookEntry> {
  const map = new Map<string, BookEntry>();

  function add(name: string, bookId: number): void {
    const kvnAbbr = BOOK_NAMES[bookId];
    if (!kvnAbbr) return;
    map.set(name, { bookId, kvnAbbr });
  }

  // Full names from bookNames (nb and nn)
  for (const lang of ['nb', 'nn']) {
    if (!bookNames[lang]) continue;
    for (const [id, name] of Object.entries(bookNames[lang])) {
      add(name, parseInt(id));
    }
  }

  // KVN abbreviations themselves
  for (const [abbr, id] of Object.entries(BOOK_IDS)) {
    add(abbr, id);
  }

  // Common Norwegian variants and long forms
  const variants = {
    // Pentateuch variants
    '1. Mosebok': 1, 'Første Mosebok': 1, '1. Mos': 1,
    '2. Mosebok': 2, 'Andre Mosebok': 2, '2. Mos': 2,
    '3. Mosebok': 3, 'Tredje Mosebok': 3, '3. Mos': 3,
    '4. Mosebok': 4, 'Fjerde Mosebok': 4, '4. Mos': 4,
    '5. Mosebok': 5, 'Femte Mosebok': 5, '5. Mos': 5,
    'Genesis': 1, 'Exodus': 2, 'Leviticus': 3, 'Numeri': 4, 'Deuteronomium': 5,

    // Common name variants
    'Dommerne': 7, 'Dommerboken': 7, 'Domarane': 7, 'Domarboka': 7,
    'Ruts bok': 8,
    '1. Samuel': 9, '1. Samuelsbok': 9, 'Første Samuelsbok': 9,
    '2. Samuel': 10, '2. Samuelsbok': 10, 'Andre Samuelsbok': 10,
    '1. Kongebok': 11, 'Første Kongebok': 11, '1. Kongeboken': 11,
    '2. Kongebok': 12, 'Andre Kongebok': 12, '2. Kongeboken': 12,
    '1. Krønikebok': 13, 'Første Krønikebok': 13,
    '2. Krønikebok': 14, 'Andre Krønikebok': 14,
    'Nehemja': 16, 'Nehemjas bok': 16,

    // Wisdom/Poetry
    'Jobs bok': 18,
    'Salmene': 19, 'Salmane': 19, 'Salme': 19, 'Salmenes bok': 19,
    'Ordspråkene': 20, 'Ordtøka': 20, 'Ordspråkenes bok': 20,
    'Forkynneren': 21, 'Forkynnaren': 21, 'Predikeren': 21,
    'Høysangen': 22, 'Høgsongen': 22, 'Salomos høysang': 22,

    // Prophets
    'Jesaja': 23, 'Jeremia': 24,
    'Klagesangene': 25, 'Klagesongane': 25,
    'Esekiel': 26,
    'Daniel': 27, 'Daniels bok': 27,
    'Hosea': 28, 'Hoseas bok': 28,
    'Amos': 30, 'Amos bok': 30,
    'Obadja': 31,
    'Jona': 32, 'Jonas bok': 32,
    'Mika': 33, 'Mikas bok': 33,
    'Nahum': 34, 'Nahums bok': 34,
    'Habakkuk': 35, 'Habakkuks bok': 35,
    'Sefanja': 36, 'Sefanjas bok': 36,
    'Haggai': 37, 'Haggais bok': 37,
    'Sakarja': 38, 'Sakarjas bok': 38,
    'Malaki': 39, 'Malakis bok': 39,

    // NT
    'Matteus': 40, 'Matteusevangeliet': 40, 'Evangeliet etter Matteus': 40,
    'Markus': 41, 'Markusevangeliet': 41, 'Evangeliet etter Markus': 41,
    'Lukas': 42, 'Lukasevangeliet': 42, 'Evangeliet etter Lukas': 42,
    'Johannes': 43, 'Johannesevangeliet': 43, 'Evangeliet etter Johannes': 43,
    'Apostlenes gjerninger': 44, 'Apostelgjerningane': 44, 'Apostelgjerningene': 44,
    'Romerne': 45, 'Romerbrevet': 45, 'Romarane': 45, 'Romarabrevet': 45,
    '1. Korinterne': 46, '1. Korinterbrev': 46, '1. Korintarane': 46,
    '2. Korinterne': 47, '2. Korinterbrev': 47, '2. Korintarane': 47,
    'Galaterne': 48, 'Galaterbrevet': 48, 'Galatarane': 48,
    'Efeserne': 49, 'Efeserbrevet': 49, 'Efesarane': 49,
    'Filipperne': 50, 'Filipperbrevet': 50, 'Filipparane': 50,
    'Kolosserne': 51, 'Kolosserbrevet': 51, 'Kolossarane': 51,
    '1. Tessalonikerne': 52, '1. Tessalonikerbrev': 52, '1. Tessalonikarane': 52,
    '2. Tessalonikerne': 53, '2. Tessalonikerbrev': 53, '2. Tessalonikarane': 53,
    '1. Timoteus': 54, '1. Timoteusbrev': 54, 'Første Timoteusbrev': 54,
    '2. Timoteus': 55, '2. Timoteusbrev': 55, 'Andre Timoteusbrev': 55,
    'Titus': 56, 'Titusbrevet': 56,
    'Filemon': 57, 'Filemonbrevet': 57,
    'Hebreerne': 58, 'Hebreerbrevet': 58, 'Hebrearane': 58,
    'Jakob': 59, 'Jakobs brev': 59, 'Jakobsbrevet': 59,
    '1. Peter': 60, '1. Peters brev': 60, '1. Petersbrev': 60,
    '2. Peter': 61, '2. Peters brev': 61, '2. Petersbrev': 61,
    '1. Johannes': 62, '1. Johannesbrev': 62, 'Første Johannesbrev': 62,
    '2. Johannes': 63, '2. Johannesbrev': 63, 'Andre Johannesbrev': 63,
    '3. Johannes': 64, '3. Johannesbrev': 64, 'Tredje Johannesbrev': 64,
    'Judas': 65, 'Judasbrevet': 65, 'Judas brev': 65,
    'Åpenbaringen': 66, 'Openberringa': 66, 'Johannes\' åpenbaring': 66, 'Åpenbaringsboken': 66,
  };

  for (const [name, id] of Object.entries(variants)) {
    add(name, id);
  }

  return map;
}

// ============================================================
// Regex builder
// ============================================================

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build the master regex for matching Bible references in text.
 * Returns { regex, nameMap }.
 */
function buildRefRegex(): { regex: RegExp; nameMap: Map<string, BookEntry> } {
  const nameMap = buildNameMap();

  // Sort names longest-first for regex alternation
  const names = [...nameMap.keys()].sort((a, b) => b.length - a.length);
  const namePattern = names.map(escapeRegex).join('|');

  // Match patterns:
  // 1. BOOK CHAPTER:VERSE[-VERSE] (with optional sub-verse letters and dot-separated groups)
  //    e.g. "Johannes 3:16", "1. Mosebok 1:1-3", "Ordspråkene 8:1-2.22-31", "Mika 5:1-4a"
  // 2. BOOK CHAPTER:VERSE-CHAPTER:VERSE (cross-chapter ranges)
  //    e.g. "1. Mosebok 1:26-2:2"

  // Verse spec: digits optionally followed by a-c, then optional range parts
  // Examples: "16", "1-3", "1-4a", "1a-4a", "1-2.22-31", "26-2:2"
  const verseSpecPattern = '\\d+[a-c]?(?:\\s*[-–]\\s*(?:\\d+:)?\\d+[a-c]?)?(?:\\.\\d+[a-c]?(?:\\s*[-–]\\s*\\d+[a-c]?)?)*';

  // Negative lookbehind: don't match if preceded by [ or word char (avoids matching inside [ref:...])
  // Existing [ref:...] blocks are also skipped by convertText's isInSkipRegion check
  const pattern = `(?<![\\[\\w])(${namePattern})\\s+(\\d+):(${verseSpecPattern})`;

  return {
    regex: new RegExp(pattern, 'g'),
    nameMap,
  };
}

// ============================================================
// Text conversion
// ============================================================

/** Et halvåpent intervall [start, end) i teksten som ikke skal konverteres. */
interface SkipRegion {
  start: number;
  end: number;
}

/**
 * Convert plain-text Bible references in a string to [ref:...|...] markup.
 * Skips text that is already inside [ref:...] blocks.
 */
function convertText(text: string, regex: RegExp, nameMap: Map<string, BookEntry>): { text: string; count: number } {
  let converted = '';
  let lastIndex = 0;
  let matchCount = 0;

  // Find existing [ref:...] regions to skip
  const skipRegions: SkipRegion[] = [];
  const existingRefRegex = /\[ref:[^\]]+\]/g;
  let skipMatch;
  while ((skipMatch = existingRefRegex.exec(text)) !== null) {
    skipRegions.push({ start: skipMatch.index, end: skipMatch.index + skipMatch[0].length });
  }

  function isInSkipRegion(pos: number): boolean {
    return skipRegions.some(r => pos >= r.start && pos < r.end);
  }

  // Reset regex
  regex.lastIndex = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const fullMatch = match[0];
    const bookName = match[1];
    const chapter = match[2];
    const verseSpec = match[3];

    // Skip if inside existing [ref:...] block
    if (isInSkipRegion(match.index)) continue;

    const entry = nameMap.get(bookName);
    if (!entry) continue;

    const displayText = fullMatch.trimStart();
    const refPart = `${entry.kvnAbbr} ${chapter}:${verseSpec}`;
    const markup = `[ref:${refPart}|${displayText}]`;

    // Calculate leading whitespace that was captured by the non-word boundary
    const leadingWs = fullMatch.length - fullMatch.trimStart().length;

    converted += text.slice(lastIndex, match.index + leadingWs) + markup;
    lastIndex = match.index + fullMatch.length;
    matchCount++;
  }

  converted += text.slice(lastIndex);
  return { text: converted, count: matchCount };
}

// ============================================================
// File processors
// ============================================================

/**
 * `T` er en påstand om hva fila inneholder, ikke en kontroll: `JSON.parse` gir
 * `any`, og ingenting validerer resultatet. Kallstedet bestemmer formen.
 */
function readJson<T>(filepath: string): T {
  return JSON.parse(fs.readFileSync(filepath, 'utf-8')) as T;
}

function writeJson(filepath: string, data: unknown): void {
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2) + '\n');
}

/**
 * Et vilkårlig JSON-objekt slik det ligger på disk. Skriptet plukker felter ut
 * av mange ulike filtyper og legger dem tilbake; `typeof`-sjekken i
 * `processTextField` er den eneste kontrollen som finnes.
 */
type JsonRecord = Record<string, unknown>;

/**
 * `text: unknown` fordi feltet kommer rett ut av et JSON-objekt — det er
 * `typeof`-sjekken under som avgjør om det i det hele tatt er tekst, og
 * verdien gis uendret tilbake når den ikke er det.
 */
function processTextField(text: unknown, regex: RegExp, nameMap: Map<string, BookEntry>): { text: unknown; count: number } {
  if (!text || typeof text !== 'string') return { text, count: 0 };
  return convertText(text, regex, nameMap);
}

/** Process verse_translation files */
function processVerseTranslation(filepath: string, regex: RegExp, nameMap: Map<string, BookEntry>, dryRun: boolean): number {
  const data = readJson<JsonRecord[]>(filepath);
  let totalCount = 0;
  const fields = ['connections', 'explanation', 'lostInTranslation', 'uncertainty', 'theologicalImplications', 'culturalBackground'];

  for (const verse of data) {
    for (const field of fields) {
      if (verse[field]) {
        const { text, count } = processTextField(verse[field], regex, nameMap);
        if (count > 0) {
          verse[field] = text;
          totalCount += count;
        }
      }
    }
  }

  if (totalCount > 0 && !dryRun) {
    writeJson(filepath, data);
  }
  return totalCount;
}

/**
 * Bare feltene skriptet rører. Resten av fila leses og skrives uendret, så en
 * fullstendig type ville vært en påstand om data ingen her ser på.
 */
interface ReferencesFile {
  references?: JsonRecord[];
}

/** Process reference files */
function processReferences(filepath: string, regex: RegExp, nameMap: Map<string, BookEntry>, dryRun: boolean): number {
  const data = readJson<ReferencesFile>(filepath);
  let totalCount = 0;

  if (data.references) {
    for (const ref of data.references) {
      if (ref.text) {
        const { text, count } = processTextField(ref.text, regex, nameMap);
        if (count > 0) {
          ref.text = text;
          totalCount += count;
        }
      }
    }
  }

  if (totalCount > 0 && !dryRun) {
    writeJson(filepath, data);
  }
  return totalCount;
}

/** Process markdown files (whole file) */
function processMarkdown(filepath: string, regex: RegExp, nameMap: Map<string, BookEntry>, dryRun: boolean): number {
  const content = fs.readFileSync(filepath, 'utf-8');
  const { text, count } = convertText(content, regex, nameMap);

  if (count > 0 && !dryRun) {
    fs.writeFileSync(filepath, text);
  }
  return count;
}

interface Prophecy {
  explanation?: unknown;
  reference?: unknown;
}

interface PropheciesCategory {
  explanation?: unknown;
  reference?: unknown;
  prophecies?: Prophecy[];
}

interface PropheciesFile {
  categories?: PropheciesCategory[];
}

/** Process prophecies file */
function processProphecies(filepath: string, regex: RegExp, nameMap: Map<string, BookEntry>, dryRun: boolean): number {
  const data = readJson<PropheciesFile>(filepath);
  let totalCount = 0;

  if (data.categories) {
    for (const category of data.categories) {
      if (category.explanation) {
        const { text, count } = processTextField(category.explanation, regex, nameMap);
        if (count > 0) { category.explanation = text; totalCount += count; }
      }
      if (category.reference) {
        const { text, count } = processTextField(category.reference, regex, nameMap);
        if (count > 0) { category.reference = text; totalCount += count; }
      }
      // Process prophecies within categories
      if (category.prophecies) {
        for (const prophecy of category.prophecies) {
          if (prophecy.explanation) {
            const { text, count } = processTextField(prophecy.explanation, regex, nameMap);
            if (count > 0) { prophecy.explanation = text; totalCount += count; }
          }
          if (prophecy.reference) {
            const { text, count } = processTextField(prophecy.reference, regex, nameMap);
            if (count > 0) { prophecy.reference = text; totalCount += count; }
          }
        }
      }
    }
  }

  if (totalCount > 0 && !dryRun) {
    writeJson(filepath, data);
  }
  return totalCount;
}

interface StoryFile {
  description?: unknown;
}

/** Process story files */
function processStory(filepath: string, regex: RegExp, nameMap: Map<string, BookEntry>, dryRun: boolean): number {
  const data = readJson<StoryFile>(filepath);
  let totalCount = 0;

  if (data.description) {
    const { text, count } = processTextField(data.description, regex, nameMap);
    if (count > 0) { data.description = text; totalCount += count; }
  }

  if (totalCount > 0 && !dryRun) {
    writeJson(filepath, data);
  }
  return totalCount;
}

interface ThemeSection {
  description?: unknown;
}

interface ThemeFile {
  introduction?: unknown;
  sections?: ThemeSection[];
}

/** Process theme files */
function processTheme(filepath: string, regex: RegExp, nameMap: Map<string, BookEntry>, dryRun: boolean): number {
  const data = readJson<ThemeFile>(filepath);
  let totalCount = 0;

  if (data.introduction) {
    const { text, count } = processTextField(data.introduction, regex, nameMap);
    if (count > 0) { data.introduction = text; totalCount += count; }
  }

  if (data.sections) {
    for (const section of data.sections) {
      if (section.description) {
        const { text, count } = processTextField(section.description, regex, nameMap);
        if (count > 0) { section.description = text; totalCount += count; }
      }
    }
  }

  if (totalCount > 0 && !dryRun) {
    writeJson(filepath, data);
  }
  return totalCount;
}

interface PersonEvent {
  description?: unknown;
}

interface PersonFile {
  summary?: unknown;
  keyEvents?: PersonEvent[];
}

/** Process person files */
function processPerson(filepath: string, regex: RegExp, nameMap: Map<string, BookEntry>, dryRun: boolean): number {
  const data = readJson<PersonFile>(filepath);
  let totalCount = 0;

  if (data.summary) {
    const { text, count } = processTextField(data.summary, regex, nameMap);
    if (count > 0) { data.summary = text; totalCount += count; }
  }

  if (data.keyEvents) {
    for (const event of data.keyEvents) {
      if (event.description) {
        const { text, count } = processTextField(event.description, regex, nameMap);
        if (count > 0) { event.description = text; totalCount += count; }
      }
    }
  }

  if (totalCount > 0 && !dryRun) {
    writeJson(filepath, data);
  }
  return totalCount;
}

// ============================================================
// Validation
// ============================================================

/** Én [ref:...]-markering som ikke lot seg tolke. */
interface ValidationError {
  file: string;
  ref: string;
  error: string;
}

function validateConvertedRefs(filepath: string): ValidationError[] {
  let content: string;
  try {
    if (filepath.endsWith('.json')) {
      content = JSON.stringify(readJson<unknown>(filepath));
    } else {
      content = fs.readFileSync(filepath, 'utf-8');
    }
  } catch { return []; }

  const errors: ValidationError[] = [];
  const refRegex = /\[ref:([^|\]]+)\|([^\]]+)\]/g;
  let match;

  while ((match = refRegex.exec(content)) !== null) {
    const refPart = match[1].trim();
    const displayText = match[2];

    // Extract book abbreviation
    let remaining = refPart;
    const atIdx = remaining.lastIndexOf('@');
    if (atIdx !== -1) remaining = remaining.slice(0, atIdx).trim();

    const m = remaining.match(/^(.+?)\s+(\d.*)$/);
    if (!m) {
      errors.push({ file: filepath, ref: match[0], error: 'Cannot parse reference part' });
      continue;
    }

    const book = m[1].trim();
    if (BOOK_IDS[book] === undefined) {
      errors.push({ file: filepath, ref: match[0], error: `Unknown book: "${book}"` });
    }
  }

  return errors;
}

// ============================================================
// Main
// ============================================================

/** `pathGlob: null` betyr «alle kjente filtyper», ikke «ingen filer». */
interface Options {
  dryRun: boolean;
  stats: boolean;
  verify: boolean;
  pathGlob: string | null;
}

function parseArgs(args: string[]): Options {
  const options: Options = {
    dryRun: false,
    stats: false,
    verify: false,
    pathGlob: null,
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--stats') options.stats = true;
    else if (arg === '--verify') options.verify = true;
    else if (arg === '--path' && i + 1 < args.length) options.pathGlob = args[++i];
    else if (arg === '--help') {
      console.log(`
Usage: bun convert-refs.ts [options]

Options:
  --dry-run    Show what would change without writing files
  --stats      Show conversion statistics
  --verify     Validate all converted [ref:...] markups
  --path <glob> Process only files matching glob pattern
  --help       Show this help
`);
      process.exit(0);
    }
    i++;
  }

  return options;
}

/** Recursively find files matching an extension under a directory. */
function findFiles(dir: string, ext: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  function walk(d: string): void {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const fullPath = path.join(d, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && fullPath.endsWith(ext)) {
        results.push(fullPath);
      }
    }
  }

  walk(dir);
  return results.sort();
}

/** `byType` telles opp på filtype-etiketter som settes i `main`, derfor `Record`. */
interface Stats {
  filesProcessed: number;
  filesModified: number;
  totalRefs: number;
  byType: Record<string, number>;
}

function main(): void {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  const { regex, nameMap } = buildRefRegex();

  const stats: Stats = {
    filesProcessed: 0,
    filesModified: 0,
    totalRefs: 0,
    byType: {},
  };

  function trackStats(type: string, filepath: string, count: number): void {
    stats.filesProcessed++;
    if (count > 0) {
      stats.filesModified++;
      stats.totalRefs += count;
      stats.byType[type] = (stats.byType[type] || 0) + count;
      if (options.dryRun || options.stats) {
        console.log(`  ${options.dryRun ? '[DRY RUN] ' : ''}${path.relative(__dirname, filepath)}: ${count} refs converted`);
      }
    }
  }

  const generateDir = __dirname;

  // If --path is specified, only process files in that directory
  if (options.pathGlob) {
    // Interpret --path as a directory + extension, e.g. "stories/nb" processes .json
    const targetDir = path.resolve(generateDir, options.pathGlob);
    const jsonFiles = findFiles(targetDir, '.json');
    const mdFiles = findFiles(targetDir, '.md');
    for (const filepath of [...mdFiles, ...jsonFiles]) {
      let count = 0;
      if (filepath.endsWith('.md')) {
        count = processMarkdown(filepath, regex, nameMap, options.dryRun);
      } else if (filepath.endsWith('.json')) {
        if (filepath.includes('verse_translation')) {
          count = processVerseTranslation(filepath, regex, nameMap, options.dryRun);
        } else if (filepath.includes('references/')) {
          count = processReferences(filepath, regex, nameMap, options.dryRun);
        } else if (filepath.includes('prophecies')) {
          count = processProphecies(filepath, regex, nameMap, options.dryRun);
        } else if (filepath.includes('stories/')) {
          count = processStory(filepath, regex, nameMap, options.dryRun);
        } else if (filepath.includes('themes/')) {
          count = processTheme(filepath, regex, nameMap, options.dryRun);
        } else if (filepath.includes('persons/')) {
          count = processPerson(filepath, regex, nameMap, options.dryRun);
        }
      }
      trackStats('custom', filepath, count);
    }
  } else {
    // Process all known file types

    // 1. Verse translations
    console.log('Processing verse_translation files...');
    for (const f of findFiles(path.join(generateDir, 'verse_translation'), '.json')) {
      const count = processVerseTranslation(f, regex, nameMap, options.dryRun);
      trackStats('verse_translation', f, count);
    }

    // 2. References
    console.log('Processing reference files...');
    for (const f of findFiles(path.join(generateDir, 'references', 'nb'), '.json')) {
      const count = processReferences(f, regex, nameMap, options.dryRun);
      trackStats('references', f, count);
    }

    // 3. Chapter summaries
    console.log('Processing chapter_summaries files...');
    for (const f of findFiles(path.join(generateDir, 'chapter_summaries', 'nb'), '.md')) {
      const count = processMarkdown(f, regex, nameMap, options.dryRun);
      trackStats('chapter_summaries', f, count);
    }

    // 4. Book summaries
    console.log('Processing book_summaries files...');
    for (const f of findFiles(path.join(generateDir, 'book_summaries', 'nb'), '.md')) {
      const count = processMarkdown(f, regex, nameMap, options.dryRun);
      trackStats('book_summaries', f, count);
    }

    // 5. Chapter context
    console.log('Processing chapter_context files...');
    for (const f of findFiles(path.join(generateDir, 'chapter_context', 'nb'), '.md')) {
      const count = processMarkdown(f, regex, nameMap, options.dryRun);
      trackStats('chapter_context', f, count);
    }

    // 6. Book context
    console.log('Processing book_context files...');
    for (const f of findFiles(path.join(generateDir, 'book_context', 'nb'), '.md')) {
      const count = processMarkdown(f, regex, nameMap, options.dryRun);
      trackStats('book_context', f, count);
    }

    // 7. Prophecies
    console.log('Processing prophecies...');
    for (const f of findFiles(path.join(generateDir, 'prophecies', 'nb'), '.json')) {
      const count = processProphecies(f, regex, nameMap, options.dryRun);
      trackStats('prophecies', f, count);
    }

    // 8. Stories
    console.log('Processing story files...');
    for (const f of findFiles(path.join(generateDir, 'stories', 'nb'), '.json')) {
      const count = processStory(f, regex, nameMap, options.dryRun);
      trackStats('stories', f, count);
    }

    // 9. Themes
    console.log('Processing theme files...');
    for (const f of findFiles(path.join(generateDir, 'themes', 'nb'), '.json')) {
      const count = processTheme(f, regex, nameMap, options.dryRun);
      trackStats('themes', f, count);
    }

    // 10. Persons
    console.log('Processing person files...');
    for (const f of findFiles(path.join(generateDir, 'persons', 'nb'), '.json')) {
      const count = processPerson(f, regex, nameMap, options.dryRun);
      trackStats('persons', f, count);
    }
  }

  // Verification pass
  if (options.verify) {
    console.log('\nValidating converted references...');
    const allErrors: ValidationError[] = [];

    const allFiles = [
      ...findFiles(path.join(generateDir, 'verse_translation'), '.json'),
      ...findFiles(path.join(generateDir, 'references', 'nb'), '.json'),
      ...findFiles(path.join(generateDir, 'chapter_summaries', 'nb'), '.md'),
      ...findFiles(path.join(generateDir, 'book_summaries', 'nb'), '.md'),
      ...findFiles(path.join(generateDir, 'chapter_context', 'nb'), '.md'),
      ...findFiles(path.join(generateDir, 'book_context', 'nb'), '.md'),
      ...findFiles(path.join(generateDir, 'stories', 'nb'), '.json'),
      ...findFiles(path.join(generateDir, 'themes', 'nb'), '.json'),
      ...findFiles(path.join(generateDir, 'persons', 'nb'), '.json'),
      ...findFiles(path.join(generateDir, 'prophecies', 'nb'), '.json'),
    ];

    for (const f of allFiles) {
      const errors = validateConvertedRefs(f);
      allErrors.push(...errors);
    }

    if (allErrors.length === 0) {
      console.log('All references validated successfully!');
    } else {
      console.log(`Found ${allErrors.length} validation errors:`);
      for (const err of allErrors) {
        console.log(`  ${path.relative(generateDir, err.file)}: ${err.error} — ${err.ref}`);
      }
    }
  }

  // Summary
  console.log('\n--- Summary ---');
  console.log(`Files processed: ${stats.filesProcessed}`);
  console.log(`Files modified: ${stats.filesModified}`);
  console.log(`Total refs converted: ${stats.totalRefs}`);
  if (options.stats && Object.keys(stats.byType).length > 0) {
    console.log('\nBy type:');
    for (const [type, count] of Object.entries(stats.byType)) {
      console.log(`  ${type}: ${count}`);
    }
  }
  if (options.dryRun) {
    console.log('\n(Dry run — no files were modified)');
  }
}

try {
  main();
} catch (e) {
  console.error(e);
  process.exit(1);
}
