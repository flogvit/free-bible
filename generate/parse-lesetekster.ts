import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

import { parseArgs, formatHelp, COMMON_FLAGS } from './cli.js';
import type { FlagSpec } from './cli.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Skriptet tar ingen flagg: det parser alle tre årgangene og skriver dem om
 * hver gang. `--help` er derfor det eneste som finnes, og sjekken må stå før
 * `mkdirSync` og den første `writeFileSync` (#51).
 */
const SPEC: Record<string, FlagSpec> = {
  help: COMMON_FLAGS.help,
};

const HELP_PURPOSE =
  'parser Den norske kirkes lesetekster fra external/dnk/lesetekster/' +
  '<årgang>-layout.txt (pdftotext -layout) og OVERSKRIVER ' +
  'generate/dnk_lesetekster/<årgang>.json med dag, dato, rekke og ' +
  '[ref:…@dnb2024]-oppmerkede lesninger. Alle tre årgangene skrives om ved ' +
  'hver kjøring; manglende inndatafiler hoppes over med en advarsel.';

const HELP_EXAMPLES = [
  'bun generate/parse-lesetekster.ts        # parse alle årgangene på nytt',
];

const bookAbbreviations = [
  '1 Mos', '2 Mos', '3 Mos', '4 Mos', '5 Mos',
  '1 Sam', '2 Sam', '1 Kong', '2 Kong', '1 Krøn', '2 Krøn',
  '1 Kor', '2 Kor', '1 Tess', '2 Tess', '1 Tim', '2 Tim',
  '1 Pet', '2 Pet', '1 Joh', '2 Joh', '3 Joh',
  'Jos', 'Dom', 'Rut', 'Esra', 'Neh', 'Est', 'Job',
  'Salme', 'Ordsp', 'Fork', 'Høys',
  'Jes', 'Jer', 'Klag', 'Esek', 'Dan', 'Hos', 'Joel', 'Amos',
  'Ob', 'Jona', 'Mika', 'Nah', 'Hab', 'Sef', 'Hag', 'Sak', 'Mal',
  'Matt', 'Mark', 'Luk', 'Joh', 'Apg', 'Rom',
  'Gal', 'Ef', 'Fil', 'Kol',
  'Tit', 'Filem', 'Hebr', 'Jak', 'Jud', 'Åp',
];

const sortedBooks = [...bookAbbreviations].sort((a, b) => b.length - a.length);
const bookPattern = sortedBooks.map(b => b.replace(/\s+/g, '\\s+')).join('|');

const refRegex = new RegExp(`^((?:eller|og)\\s+)?(${bookPattern})\\s+(\\d[\\d,.:;–\\-a-b\\s]*?)\\s*$`);
const refWithTitleRegex = new RegExp(`^((?:eller|og)\\s+)?(${bookPattern})\\s+(\\d[\\d,.:;–\\-a-b]*)\\s+(.+)$`);
const bookOnlyRegex = new RegExp(`^((?:eller|og)\\s+)(${bookPattern})\\s*$`);
// Layout mode: "eller Apg          Paulus og Silas løslates" — book-only + title on same line
const bookOnlyWithTitleRegex = new RegExp(`^((?:eller|og)\\s+)(${bookPattern})\\s{2,}([^\\d].+)$`);
const seriesAloneRegex = /^(I{1,3}V?|IV|A)$/;
const seriesPrefixRegex = /^(I{1,3}V?|IV|A)\s+/;

const weekdays = 'Søndag|Mandag|Tirsdag|Onsdag|Torsdag|Fredag|Lørdag|Olsok';
const dayHeaderRegex = new RegExp(`^(.+?)\\s+–\\s+((?:${weekdays}).*)$`);
const splitHeaderContinuation = new RegExp(`^–\\s+((?:${weekdays}).*)$`);

const dateContinuation = /^(?:\d{1,2}\.\s+)?(?:januar|februar|mars|april|mai|juni|juli|august|september|oktober|november|desember)?\s*\d{4}$/i;
const yearContinuation = /^\d{4}$/;
const refContinuation = /^[\d,.:;–\-a-b]+$/;
const ogEllerContinuation = /^og\/eller\s+([\d,.:;–\-a-b]+)$/;

const norwegianMonths: Record<string, number> = {
  'januar': 1, 'februar': 2, 'mars': 3, 'april': 4,
  'mai': 5, 'juni': 6, 'juli': 7, 'august': 8,
  'september': 9, 'oktober': 10, 'november': 11, 'desember': 12,
};

interface Part {
  refs: string[];
  title: string;
}

interface Option {
  parts: Part[];
}

interface Slot {
  options: Option[];
}

interface DayEntry {
  name: string;
  date: string;
  series: string;
  slots: Slot[];
}

interface FlatReading {
  prefix: string; // "", "eller", "og"
  ref: string;    // "Book chapter,verseSpec[;chapter,verseSpec]..."
  title: string;
  ogEllerVerses?: string; // verses after "og/eller" (same chapter as ref)
}

interface PendingBookOnly {
  prefix: string;
  book: string;
  bufferedTitle?: string;
}

function parseDate(dateStr: string): string {
  const allDates = [...dateStr.matchAll(/(\d{1,2})\.\s+(\w+)\s+(\d{4})/g)];
  if (allDates.length > 0) {
    const match = allDates[allDates.length - 1];
    const day = parseInt(match[1]);
    const month = norwegianMonths[match[2].toLowerCase()];
    const year = parseInt(match[3]);
    if (month) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  return dateStr;
}

function extractRefAndTitle(line: string): { prefix: string; reference: string; title: string } | null {
  const m = line.match(refWithTitleRegex);
  if (m) {
    const prefix = (m[1] || '').trim();
    return { prefix, reference: `${m[2]} ${m[3].trim()}`, title: m[4].trim() };
  }
  return null;
}

function extractRefOnly(line: string): { prefix: string; reference: string } | null {
  const m = line.match(refRegex);
  if (m) {
    const prefix = (m[1] || '').trim();
    return { prefix, reference: `${m[2]} ${m[3].trim()}` };
  }
  return null;
}

function isBookStart(line: string): boolean {
  const bookStartRegex = new RegExp(`^((?:eller|og)\\s+)?(${bookPattern})\\s+\\d`);
  return bookStartRegex.test(line);
}

function stripFooter(line: string): string {
  return line.replace(/\[Utskrift:[^\]]*\]/g, '').trim();
}

function normalizeDashes(s: string): string {
  return s.replace(/[–—]/g, '-');
}

function splitBookAndRest(refStr: string): { book: string; rest: string } | null {
  const m = refStr.match(/^(.+?)\s+(\d.+)$/);
  if (!m) return null;
  return { book: m[1].trim(), rest: m[2].trim() };
}

function splitCompoundRef(refStr: string): { book: string; verseSpec: string }[] {
  const sb = splitBookAndRest(refStr);
  if (!sb) return [];
  const parts = sb.rest.split(';').map(s => s.trim()).filter(s => s.length > 0);
  return parts.map(verseSpec => ({ book: sb.book, verseSpec: normalizeDashes(verseSpec) }));
}

function buildRefMarkup(book: string, verseSpec: string): string {
  return `[ref:${book} ${verseSpec}@dnb2024]`;
}

function expandOgEllerVerses(baseVerseSpec: string, ogEllerVerses: string): string {
  // baseVerseSpec like "17,22-25" → chapter=17. Returns "17,26-31"
  const chapMatch = baseVerseSpec.match(/^(\d+),/);
  if (!chapMatch) return normalizeDashes(ogEllerVerses);
  return `${chapMatch[1]},${normalizeDashes(ogEllerVerses)}`;
}

function buildSlots(flatReadings: FlatReading[]): Slot[] {
  const slots: Slot[] = [];
  let currentSlot: Slot | null = null;
  let currentOption: Option | null = null;

  for (const r of flatReadings) {
    const compounds = splitCompoundRef(r.ref);
    if (compounds.length === 0) continue;
    const part: Part = {
      refs: compounds.map(c => buildRefMarkup(c.book, c.verseSpec)),
      title: r.title,
    };

    if (r.prefix === 'eller') {
      if (!currentSlot) {
        currentSlot = { options: [] };
        slots.push(currentSlot);
      }
      currentOption = { parts: [part] };
      currentSlot.options.push(currentOption);
    } else if (r.prefix === 'og') {
      if (!currentSlot) {
        currentSlot = { options: [{ parts: [] }] };
        slots.push(currentSlot);
        currentOption = currentSlot.options[0];
      }
      if (!currentOption) {
        currentOption = { parts: [] };
        currentSlot.options.push(currentOption);
      }
      currentOption.parts.push(part);
    } else {
      currentSlot = { options: [] };
      slots.push(currentSlot);
      currentOption = { parts: [part] };
      currentSlot.options.push(currentOption);
    }

    // og/eller within same book: expand current slot to three likeverdige options
    if (r.ogEllerVerses && currentSlot && currentOption) {
      const base = compounds[0];
      const altVerseSpec = expandOgEllerVerses(base.verseSpec, r.ogEllerVerses);
      const altRefMarkup = buildRefMarkup(base.book, altVerseSpec);

      // Option 2: just the og/eller verses
      const altOption: Option = {
        parts: [{ refs: [altRefMarkup], title: r.title }],
      };
      // Option 3: both ranges combined
      const combinedOption: Option = {
        parts: [{ refs: [...part.refs, altRefMarkup], title: r.title }],
      };
      currentSlot.options.push(altOption);
      currentSlot.options.push(combinedOption);
    }
  }

  return slots;
}

/**
 * Split a single layout-mode line at the column boundary near col 58 (within ±12 cols).
 * Picks the widest 2+ space gap whose middle falls inside that range. The left/right
 * column boundary in the source PDFs sits around col 55-61.
 */
function splitLineColumns(line: string): { left: string | null; right: string | null } {
  const stripped = line.replace(/^\s+/, '');
  if (!stripped) return { left: null, right: null };
  const target = 58;
  const radius = 12;
  if (line.length <= target) return { left: line.trim() || null, right: null };

  // Strategy 1: detect isolated series indicator (I/II/III/IV/A) at col ~50-70 — that
  // marks the start of the right column. The gap right before the series indicator
  // is sometimes only 2-3 spaces (smaller than within-cell gaps), so largest-gap fails here.
  const seriesPattern = /(\S)(\s{2,})(I{1,3}V?|IV|A)(\s{2,})\S/g;
  for (const sm of line.matchAll(seriesPattern)) {
    const matchStart = sm.index!;
    const seriesPos = matchStart + 1 + sm[2].length;
    if (seriesPos >= 45 && seriesPos <= 72) {
      const left = line.substring(0, matchStart + 1).trim() || null;
      const right = line.substring(seriesPos).trim() || null;
      return { left, right };
    }
  }

  // Strategy 2: largest gap whose middle is near col 58
  const candidates: { start: number; end: number; width: number; dist: number }[] = [];
  for (const m of line.matchAll(/\s{2,}/g)) {
    const start = m.index!;
    const end = start + m[0].length;
    if (end < target - radius || start > target + radius) continue;
    const mid = (start + end) / 2;
    candidates.push({ start, end, width: m[0].length, dist: Math.abs(mid - target) });
  }
  if (candidates.length === 0) return { left: line.trim() || null, right: null };
  candidates.sort((a, b) => b.width - a.width || a.dist - b.dist);
  const best = candidates[0];
  const left = line.substring(0, best.start).trim() || null;
  const right = line.substring(best.end).trim() || null;
  return { left, right };
}

/**
 * Preprocess pdftotext -layout output: per page, split into LEFT and RIGHT streams,
 * concatenate as left-of-p1 + right-of-p1 + left-of-p2 + right-of-p2 + ...
 * Stops pdftotext's column shuffle from straddling readings across day boundaries.
 */
function preprocessLayoutText(text: string): string {
  const pages = text.split(/\f/);
  const out: string[] = [];
  for (const page of pages) {
    const left: string[] = [];
    const right: string[] = [];
    for (const line of page.split('\n')) {
      const { left: l, right: r } = splitLineColumns(line);
      if (l) left.push(l);
      if (r) right.push(r);
    }
    out.push(...left, ...right);
  }
  return out.join('\n');
}

function parsePdf(text: string): DayEntry[] {
  const flattened = preprocessLayoutText(text);
  const rawLines = flattened.split(/\n+/);
  const lines = rawLines.map(l => stripFooter(l.trim())).filter(l => l.length > 0);

  const entries: DayEntry[] = [];
  let currentEntry: DayEntry | null = null;
  let flatReadings: FlatReading[] = [];
  let pendingRef: { prefix: string; ref: string } | null = null;
  let pendingBookOnly: PendingBookOnly | null = null;
  let lastReading: FlatReading | null = null;
  let headerMode = true;

  function flushPendingRef(title: string = '') {
    if (pendingRef) {
      const reading: FlatReading = { prefix: pendingRef.prefix, ref: pendingRef.ref, title };
      flatReadings.push(reading);
      lastReading = reading;
      pendingRef = null;
    }
  }

  function firstUntitled(): FlatReading | null {
    for (const r of flatReadings) if (!r.title) return r;
    return null;
  }

  // Attach a title-line. Priority:
  //  1. If pendingBookOnly waiting for verses but already has bufferedTitle and there's
  //     no untitled in flatReadings, this title belongs to a block-form earlier ref.
  //  2. If untitled readings exist in flatReadings, attach to the first one (block mode).
  //  3. Else, attach to pendingRef (flush it with this title).
  //  4. Else, attach to last reading if it had no title (catch-all).
  function attachTitle(title: string) {
    const u = firstUntitled();
    if (u) { u.title = title; return; }
    if (pendingRef) { flushPendingRef(title); return; }
    if (pendingBookOnly && !pendingBookOnly.bufferedTitle) {
      pendingBookOnly.bufferedTitle = title;
      return;
    }
    if (lastReading && !lastReading.title) { lastReading.title = title; return; }
    // Drop unattachable title silently.
  }

  function flushDay() {
    if (!currentEntry) return;
    flushPendingRef();
    currentEntry.slots = buildSlots(flatReadings);
    entries.push(currentEntry);
    flatReadings = [];
    pendingBookOnly = null;
    lastReading = null;
  }

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    if (headerMode) {
      if (dayHeaderRegex.test(line)) {
        headerMode = false;
      } else {
        continue;
      }
    }

    // Day header
    const headerMatch = line.match(dayHeaderRegex);
    if (headerMatch) {
      flushDay();
      let name = headerMatch[1].trim();
      let dateStr = headerMatch[2].trim();
      while (i + 1 < lines.length) {
        const nextLine = lines[i + 1];
        if (dateContinuation.test(nextLine) || yearContinuation.test(nextLine)) {
          dateStr += ' ' + nextLine;
          i++;
        } else if (nextLine === 'desember' || /^desember\s+\d{4}$/.test(nextLine)) {
          dateStr += ' ' + nextLine;
          i++;
        } else {
          break;
        }
      }
      currentEntry = { name, date: parseDate(dateStr), series: '', slots: [] };
      continue;
    }

    // Date continuation right after header
    if (currentEntry && !currentEntry.series && flatReadings.length === 0 && !pendingRef) {
      if (dateContinuation.test(line) || yearContinuation.test(line)) {
        const newDate = parseDate(currentEntry.date + ' ' + line);
        if (newDate !== currentEntry.date + ' ' + line) {
          currentEntry.date = newDate;
        }
        continue;
      }
      const monthYearMatch = line.match(/^(januar|februar|mars|april|mai|juni|juli|august|september|oktober|november|desember)\s+(\d{4})$/i);
      if (monthYearMatch) {
        currentEntry.date = parseDate(currentEntry.date + ' ' + line);
        continue;
      }
    }

    if (!currentEntry) continue;

    // Series indicator
    if (!currentEntry.series) {
      if (seriesAloneRegex.test(line)) {
        currentEntry.series = line;
        continue;
      }
      const seriesPrefixMatch = line.match(seriesPrefixRegex);
      if (seriesPrefixMatch) {
        currentEntry.series = seriesPrefixMatch[1];
        line = line.substring(seriesPrefixMatch[0].length).trim();
        if (!line) continue;
      }
    }

    // Pending book-only — wait for verse spec
    if (pendingBookOnly) {
      const verseSpecMatch = line.match(/^(\d[\d,.:;–\-a-b]*)\s*$/);
      if (verseSpecMatch) {
        const reading: FlatReading = {
          prefix: pendingBookOnly.prefix,
          ref: `${pendingBookOnly.book} ${verseSpecMatch[1].trim()}`,
          title: pendingBookOnly.bufferedTitle || '',
        };
        flatReadings.push(reading);
        lastReading = reading;
        pendingBookOnly = null;
        continue;
      }
      // Non-verse line: could be title for upcoming wrapped ref, or title for an earlier untitled reading
      if (!pendingBookOnly.bufferedTitle && !firstUntitled()) {
        // No untitled to attach to — treat as title for the upcoming wrapped ref
        pendingBookOnly.bufferedTitle = line;
        continue;
      }
      // Else fall through; attachTitle below will route it
    }

    // Pending ref handling
    if (pendingRef) {
      if (refContinuation.test(line)) {
        pendingRef.ref += line;
        continue;
      }
      const ogEllerMatch = line.match(ogEllerContinuation);
      if (ogEllerMatch) {
        flushPendingRef();
        if (lastReading) lastReading.ogEllerVerses = ogEllerMatch[1].trim();
        continue;
      }
      if (isBookStart(line) || dayHeaderRegex.test(line) || bookOnlyRegex.test(line) || bookOnlyWithTitleRegex.test(line)) {
        flushPendingRef();
        // fall through to process this line
      } else {
        // Title-line. May belong to first untitled (block mode) or to pendingRef.
        attachTitle(line);
        continue;
      }
    }

    // og/eller continuation
    const ogEllerMatch2 = line.match(ogEllerContinuation);
    if (ogEllerMatch2) {
      if (lastReading) lastReading.ogEllerVerses = ogEllerMatch2[1].trim();
      continue;
    }

    // Ref + title on same line
    const refTitle = extractRefAndTitle(line);
    if (refTitle) {
      const reading: FlatReading = {
        prefix: refTitle.prefix,
        ref: refTitle.reference,
        title: refTitle.title,
      };
      flatReadings.push(reading);
      lastReading = reading;
      continue;
    }

    // Ref only
    const refOnly = extractRefOnly(line);
    if (refOnly) {
      pendingRef = { prefix: refOnly.prefix, ref: refOnly.reference };
      continue;
    }

    // Book-only with title on same line (layout mode wrap)
    const bookOnlyTitleMatch = line.match(bookOnlyWithTitleRegex);
    if (bookOnlyTitleMatch) {
      pendingBookOnly = {
        prefix: bookOnlyTitleMatch[1].trim(),
        book: bookOnlyTitleMatch[2],
        bufferedTitle: bookOnlyTitleMatch[3].trim(),
      };
      continue;
    }

    // Book-only (no title — old wrap form)
    const bookOnlyMatch = line.match(bookOnlyRegex);
    if (bookOnlyMatch) {
      pendingBookOnly = {
        prefix: bookOnlyMatch[1].trim(),
        book: bookOnlyMatch[2],
      };
      continue;
    }

    // Verse-only continuation for last reading (no pending)
    if (refContinuation.test(line)) {
      if (lastReading) lastReading.ref += line;
      continue;
    }

    // Split header continuation: this line is name, next line is "– Weekday date..."
    if (i + 1 < lines.length) {
      const nextLine = lines[i + 1];
      const splitMatch = nextLine.match(splitHeaderContinuation);
      if (splitMatch) {
        flushDay();
        let name = line;
        let dateStr = splitMatch[1].trim();
        i++;
        while (i + 1 < lines.length) {
          const nextNext = lines[i + 1];
          if (dateContinuation.test(nextNext) || yearContinuation.test(nextNext)) {
            dateStr += ' ' + nextNext;
            i++;
          } else {
            break;
          }
        }
        currentEntry = { name, date: parseDate(dateStr), series: '', slots: [] };
        continue;
      }
    }

    // Block-mode title attachment (no pendingRef, but untitled readings exist)
    if (firstUntitled()) {
      attachTitle(line);
      continue;
    }

    // Title for last reading without one
    if (lastReading && !lastReading.title) {
      lastReading.title = line;
      continue;
    }

    // Unknown — skip
  }

  flushDay();
  return entries;
}

const inputDir = path.join(__dirname, '..', 'external', 'dnk', 'lesetekster');
const outputDir = path.join(__dirname, 'dnk_lesetekster');

const files = [
  { input: '2025-2026-layout.txt', output: '2025-2026.json' },
  { input: '2026-2027-layout.txt', output: '2026-2027.json' },
  { input: '2027-2028-layout.txt', output: '2027-2028.json' },
];

function main(): void {
  // Hjelpen skal ut før katalogen opprettes og før noe skrives.
  const { flags } = parseArgs(process.argv.slice(2), SPEC);
  if (flags.help) {
    console.log(formatHelp('generate/parse-lesetekster.ts', HELP_PURPOSE, SPEC, HELP_EXAMPLES));
    process.exit(0);
  }

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  for (const file of files) {
    const inputPath = path.join(inputDir, file.input);
    if (!fs.existsSync(inputPath)) {
      console.warn(`Skipping ${file.input} — not found`);
      continue;
    }
    const text = fs.readFileSync(inputPath, 'utf-8');
    const entries = parsePdf(text);
    const outputPath = path.join(outputDir, file.output);
    fs.writeFileSync(outputPath, JSON.stringify(entries, null, 2), 'utf-8');
    console.log(`${file.output}: ${entries.length} entries`);

    let issues = 0;
    for (const entry of entries) {
      if (!entry.series) {
        console.warn(`  WARNING: No series for "${entry.name}"`);
        issues++;
      }
      if (entry.slots.length === 0) {
        console.warn(`  WARNING: No slots for "${entry.name}"`);
        issues++;
      }
      for (const slot of entry.slots) {
        for (const opt of slot.options) {
          for (const part of opt.parts) {
            if (!part.title) {
              console.warn(`  WARNING: Empty title in "${entry.name}" for refs ${part.refs.join(',')}`);
              issues++;
            }
          }
        }
      }
      if (entry.slots.length > 5) {
        console.warn(`  WARNING: ${entry.slots.length} slots for "${entry.name}"`);
        issues++;
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) {
        console.warn(`  WARNING: Bad date "${entry.date}" for "${entry.name}"`);
        issues++;
      }
    }
    if (issues === 0) {
      console.log(`  No issues found.`);
    } else {
      console.log(`  ${issues} issue(s) found.`);
    }
  }
}

// Kjører bare når fila startes direkte. Uten vakten kjørte parsingen ved IMPORT
// — den skrev alle tre årgangene bare man lastet modulen, som er samme feilform
// som days.ts hadde (#108).
if (import.meta.main) {
  main();
}
