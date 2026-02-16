import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

// Sort longest first to match "1 Joh" before "Joh" etc.
const sortedBooks = [...bookAbbreviations].sort((a, b) => b.length - a.length);
const bookPattern = sortedBooks.map(b => b.replace(/\s+/g, '\\s+')).join('|');

// Match a bible reference: book + chapter,verse pattern
const refRegex = new RegExp(`^((?:eller|og)\\s+)?(${bookPattern})\\s+(\\d[\\d,.:;–\\-a-b\\s]*?)\\s*$`);
const refWithTitleRegex = new RegExp(`^((?:eller|og)\\s+)?(${bookPattern})\\s+(\\d[\\d,.:;–\\-a-b]*)\\s+(.+)$`);

// Match a series indicator at the start: I, II, III, IV, or A
const seriesRegex = /^(I{1,3}V?|IV|A)\s+/;

// Match a day header: contains " – " followed by a weekday (or Olsok)
const weekdays = 'Søndag|Mandag|Tirsdag|Onsdag|Torsdag|Fredag|Lørdag|Olsok';
const dayHeaderRegex = new RegExp(`^(.+?)\\s+–\\s+((?:${weekdays}).*)$`);
// Match a continuation line that starts with "– Weekday"
const splitHeaderContinuation = new RegExp(`^–\\s+((?:${weekdays}).*)$`);

// Date continuation: "DD. month YYYY", "month YYYY", or just "YYYY"
const dateContinuation = /^(?:\d{1,2}\.\s+)?(?:januar|februar|mars|april|mai|juni|juli|august|september|oktober|november|desember)?\s*\d{4}$/i;
const yearContinuation = /^\d{4}$/;

// Reference continuation: just numbers, dots, dashes, semicolons, a/b
const refContinuation = /^[\d,.:;–\-a-b]+$/;

// "og/eller" continuation: e.g., "og/eller 26–31"
const ogEllerContinuation = /^og\/eller\s+([\d,.:;–\-a-b]+)$/;

const norwegianMonths: Record<string, number> = {
  'januar': 1, 'februar': 2, 'mars': 3, 'april': 4,
  'mai': 5, 'juni': 6, 'juli': 7, 'august': 8,
  'september': 9, 'oktober': 10, 'november': 11, 'desember': 12,
};

interface Reading {
  reference: string;
  title: string;
  alternative?: boolean;
}

interface DayEntry {
  name: string;
  date: string;
  series: string;
  readings: Reading[];
}

function parseDate(dateStr: string): string {
  // Handle combined dates like "24. desember/Torsdag 25. desember 2025"
  // Take the LAST full date (DD. month YYYY) in the string
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
  // Remove [Utskrift: ...] from anywhere in the line
  return line.replace(/\[Utskrift:[^\]]*\]/g, '').trim();
}

function parsePdf(text: string): DayEntry[] {
  const rawLines = text.split(/[\n\f]+/);
  // Pre-process: strip footer from all lines
  const lines = rawLines.map(l => stripFooter(l.trim())).filter(l => l.length > 0);

  const entries: DayEntry[] = [];
  let currentEntry: DayEntry | null = null;
  let pendingRef: string | null = null;
  let pendingPrefix: string = '';
  let headerMode = true;

  function savePendingRef(title: string = '') {
    if (pendingRef && currentEntry) {
      currentEntry.readings.push({
        reference: pendingRef,
        title,
        ...(pendingPrefix === 'eller' ? { alternative: true } : {}),
      });
      pendingRef = null;
      pendingPrefix = '';
    }
  }

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Skip header section (intro text before first day entry)
    if (headerMode) {
      if (dayHeaderRegex.test(line)) {
        headerMode = false;
      } else {
        continue;
      }
    }

    // Check for day header
    const headerMatch = line.match(dayHeaderRegex);
    if (headerMatch) {
      // Save previous entry
      if (currentEntry) {
        savePendingRef();
        entries.push(currentEntry);
      }

      let name = headerMatch[1].trim();
      let dateStr = headerMatch[2].trim();

      // Check if next line is a date continuation
      while (i + 1 < lines.length) {
        const nextLine = lines[i + 1];
        if (dateContinuation.test(nextLine) || yearContinuation.test(nextLine)) {
          dateStr += ' ' + nextLine;
          i++;
        } else if (nextLine === 'desember' || /^desember\s+\d{4}$/.test(nextLine)) {
          // Handle split month names like "Torsdag 25.\ndesember 2025"
          dateStr += ' ' + nextLine;
          i++;
        } else {
          break;
        }
      }

      currentEntry = {
        name,
        date: parseDate(dateStr),
        series: '',
        readings: [],
      };
      pendingRef = null;
      pendingPrefix = '';
      continue;
    }

    // Check if line is a date continuation for the previous header
    if (currentEntry && !currentEntry.series && currentEntry.readings.length === 0) {
      if (dateContinuation.test(line) || yearContinuation.test(line)) {
        const newDate = parseDate(currentEntry.date + ' ' + line);
        if (newDate !== currentEntry.date + ' ' + line) {
          currentEntry.date = newDate;
        }
        continue;
      }
      // Handle "desember YYYY" or "juli YYYY" etc as date continuation
      const monthYearMatch = line.match(/^(januar|februar|mars|april|mai|juni|juli|august|september|oktober|november|desember)\s+(\d{4})$/i);
      if (monthYearMatch) {
        currentEntry.date = parseDate(currentEntry.date + ' ' + line);
        continue;
      }
    }

    if (!currentEntry) continue;

    // Check for series indicator at start of line
    const seriesMatch = line.match(seriesRegex);
    if (seriesMatch && !currentEntry.series) {
      currentEntry.series = seriesMatch[1];
      line = line.substring(seriesMatch[0].length).trim();
      if (!line) continue;
    }

    // Handle pending reference (multi-line ref)
    if (pendingRef) {
      // Check if this line is a reference continuation (just numbers/dots)
      if (refContinuation.test(line)) {
        pendingRef += line;
        continue;
      }
      // Check if this is "og/eller" continuation for the PENDING reference
      const ogEllerMatch = line.match(ogEllerContinuation);
      if (ogEllerMatch) {
        pendingRef += ' og/eller ' + ogEllerMatch[1];
        continue;
      }
      // This line should be the title (if not a new reference or header)
      if (!isBookStart(line) && !dayHeaderRegex.test(line)) {
        savePendingRef(line);
        continue;
      }
      // It's a new reference or header - save pending without title
      savePendingRef();
      // Fall through to process this line
    }

    // Handle "og/eller" continuation for previous reading
    const ogEllerMatch2 = line.match(ogEllerContinuation);
    if (ogEllerMatch2) {
      if (currentEntry.readings.length > 0) {
        const lastReading = currentEntry.readings[currentEntry.readings.length - 1];
        lastReading.reference += ' og/eller ' + ogEllerMatch2[1];
      }
      continue;
    }

    // Try to match reference + title on same line
    const refTitle = extractRefAndTitle(line);
    if (refTitle) {
      currentEntry.readings.push({
        reference: refTitle.reference,
        title: refTitle.title,
        ...(refTitle.prefix === 'eller' ? { alternative: true } : {}),
      });
      continue;
    }

    // Try to match reference only (no title on this line)
    const refOnly = extractRefOnly(line);
    if (refOnly) {
      pendingRef = refOnly.reference;
      pendingPrefix = refOnly.prefix;
      continue;
    }

    // If we get here, it might be a ref continuation for the previous reading
    if (refContinuation.test(line)) {
      if (currentEntry.readings.length > 0) {
        const lastReading = currentEntry.readings[currentEntry.readings.length - 1];
        lastReading.reference += line;
      }
      continue;
    }

    // Check if this line + next line form a split header
    // e.g., "Aposteldagen/6. søndag i treenighetstiden" + "– Søndag 27. juni 2027"
    if (i + 1 < lines.length) {
      const nextLine = lines[i + 1];
      const splitMatch = nextLine.match(splitHeaderContinuation);
      if (splitMatch) {
        // This line is the name, next line is "– Weekday date..."
        if (currentEntry) {
          savePendingRef();
          entries.push(currentEntry);
        }
        let name = line;
        let dateStr = splitMatch[1].trim();
        i++;

        // Check for further date continuation
        while (i + 1 < lines.length) {
          const nextNext = lines[i + 1];
          if (dateContinuation.test(nextNext) || yearContinuation.test(nextNext)) {
            dateStr += ' ' + nextNext;
            i++;
          } else {
            break;
          }
        }

        currentEntry = {
          name,
          date: parseDate(dateStr),
          series: '',
          readings: [],
        };
        pendingRef = null;
        pendingPrefix = '';
        continue;
      }
    }

    // Unknown line - skip
  }

  // Don't forget the last entry
  if (currentEntry) {
    savePendingRef();
    entries.push(currentEntry);
  }

  return entries;
}

// Process all three PDFs
const inputDir = path.join(__dirname, '..', 'external', 'dnk', 'lesetekster');
const outputDir = path.join(__dirname, 'dnk_lesetekster');

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

const files = [
  { input: '2025-2026-raw.txt', output: '2025-2026.json' },
  { input: '2026-2027-raw.txt', output: '2026-2027.json' },
  { input: '2027-2028-raw.txt', output: '2027-2028.json' },
];

for (const file of files) {
  const inputPath = path.join(inputDir, file.input);
  const text = fs.readFileSync(inputPath, 'utf-8');
  const entries = parsePdf(text);
  const outputPath = path.join(outputDir, file.output);
  fs.writeFileSync(outputPath, JSON.stringify(entries, null, 2), 'utf-8');
  console.log(`${file.output}: ${entries.length} entries`);

  // Validation
  let issues = 0;
  for (const entry of entries) {
    for (const reading of entry.readings) {
      if (!reading.title) {
        console.warn(`  WARNING: Empty title in "${entry.name}" for ref "${reading.reference}"`);
        issues++;
      }
    }
    if (entry.readings.length === 0) {
      console.warn(`  WARNING: No readings for "${entry.name}"`);
      issues++;
    }
    if (!entry.series) {
      console.warn(`  WARNING: No series for "${entry.name}"`);
      issues++;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) {
      console.warn(`  WARNING: Bad date "${entry.date}" for "${entry.name}"`);
      issues++;
    }
    if (entry.readings.length > 4) {
      console.warn(`  WARNING: ${entry.readings.length} readings for "${entry.name}"`);
      issues++;
    }
  }
  if (issues === 0) {
    console.log(`  No issues found.`);
  } else {
    console.log(`  ${issues} issue(s) found.`);
  }
}
