/**
 * Create osnb3 from osnb2:
 * 1. Copy osnb2 as base
 * 2. Renumber chapters where osnb2 differs from majority
 * 3. Add placeholder entries for missing verses/chapters
 *
 * Uses the build report from build-osnb3.ts to determine what needs changing.
 * Does NOT translate missing verses yet — marks them with placeholder text.
 */

import { readFileSync, readdirSync, existsSync, statSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const OSNB2_DIR = join(import.meta.dirname, '../../generate/bibles_raw/osnb2');
const RAW_DIR = join(import.meta.dirname, '../../external/closed/raw');
const OSNB3_DIR = join(import.meta.dirname, '../../generate/bibles_raw/osmain');
const REPORT_FILE = join(import.meta.dirname, '../data/osnb3-build-report.json');

interface VerseData {
  bookId: number;
  chapterId: number;
  verseId: number;
  text: string;
  versions?: any[];
  [key: string]: any;
}

// === Load the build report ===
const report = JSON.parse(readFileSync(REPORT_FILE, 'utf-8'));
const analyses: Array<{
  key: string;
  book: number;
  chapter: number;
  action: string;
  versesToAdd: number[];
  versesToShift: number[];
  maxVerse: number;
  majorityCount: number;
  totalBibles: number;
}> = report.analyses;

// Index by chapter key
const analysisByKey = new Map(analyses.map(a => [a.key, a]));

// === Collect majority verse structures from raw bibles ===
// We need the actual majority verse IDs for renumbering

type ChapterKey = string;

function getMajorityStructure(book: number, chapter: number): number[] | null {
  const key = `${book}:${chapter}`;
  // Scan raw bibles to get the most common verse structure
  const structureCounts = new Map<string, { count: number; verseIds: number[] }>();

  const rawBibles = readdirSync(RAW_DIR).filter(d =>
    statSync(join(RAW_DIR, d)).isDirectory()
  );

  for (const bible of rawBibles) {
    const chFile = join(RAW_DIR, bible, String(book), `${chapter}.json`);
    if (!existsSync(chFile)) continue;

    try {
      const data: VerseData[] = JSON.parse(readFileSync(chFile, 'utf-8'));
      if (!data.length) continue;
      const verseIds = data.map(v => v.verseId).sort((a, b) => a - b);
      const structKey = verseIds.join(',');

      if (!structureCounts.has(structKey)) {
        structureCounts.set(structKey, { count: 0, verseIds });
      }
      structureCounts.get(structKey)!.count++;
    } catch {
      // skip
    }
  }

  let best = { count: 0, verseIds: [] as number[] };
  for (const [, entry] of structureCounts) {
    if (entry.count > best.count) best = entry;
  }

  return best.verseIds.length > 0 ? best.verseIds : null;
}

// === Load osnb2 chapter ===
function loadOsnb2Chapter(book: number, chapter: number): VerseData[] {
  const file = join(OSNB2_DIR, String(book), `${chapter}.json`);
  if (!existsSync(file)) return [];
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return [];
  }
}

// === Find a sample text for a missing verse from raw bibles ===
function findSampleTexts(book: number, chapter: number, verse: number, maxSamples = 5): string[] {
  const samples: string[] = [];
  const rawBibles = readdirSync(RAW_DIR).filter(d =>
    statSync(join(RAW_DIR, d)).isDirectory()
  );

  for (const bible of rawBibles) {
    if (samples.length >= maxSamples) break;
    const chFile = join(RAW_DIR, bible, String(book), `${chapter}.json`);
    if (!existsSync(chFile)) continue;

    try {
      const data: VerseData[] = JSON.parse(readFileSync(chFile, 'utf-8'));
      const found = data.find(v => v.verseId === verse);
      if (found && found.text.trim()) {
        samples.push(`[${bible}] ${found.text.trim()}`);
      }
    } catch {
      // skip
    }
  }

  return samples;
}

// === Main: Create osnb3 ===
console.log('Creating osnb3...');

// Clean and create output directory
if (existsSync(OSNB3_DIR)) {
  console.log('osnb3 directory already exists, will overwrite files');
}

// Get all osnb2 books
const osnb2Books = readdirSync(OSNB2_DIR)
  .filter(d => /^\d+$/.test(d) && statSync(join(OSNB2_DIR, d)).isDirectory())
  .map(d => parseInt(d))
  .sort((a, b) => a - b);

let totalCopied = 0;
let totalRenumbered = 0;
let totalAdded = 0;
let totalNewChapters = 0;

// Track all renumbering operations for the log
const renumberLog: Array<{
  key: string;
  type: string;
  details: string;
}> = [];

// Process each osnb2 book
for (const bookId of osnb2Books) {
  const bookDir = join(OSNB2_DIR, String(bookId));
  const outBookDir = join(OSNB3_DIR, String(bookId));
  mkdirSync(outBookDir, { recursive: true });

  const chapterFiles = readdirSync(bookDir)
    .filter(f => f.endsWith('.json'))
    .map(f => parseInt(f.replace('.json', '')))
    .sort((a, b) => a - b);

  for (const chapterId of chapterFiles) {
    const key = `${bookId}:${chapterId}`;
    const analysis = analysisByKey.get(key);
    const osnb2Verses = loadOsnb2Chapter(bookId, chapterId);

    if (!analysis || (analysis.versesToShift.length === 0 && analysis.versesToAdd.length === 0)) {
      // No changes needed — copy as-is
      writeFileSync(join(outBookDir, `${chapterId}.json`), JSON.stringify(osnb2Verses, null, 2));
      totalCopied += osnb2Verses.length;
      continue;
    }

    // Need to renumber or add verses
    const majorityVerseIds = getMajorityStructure(bookId, chapterId);
    if (!majorityVerseIds) {
      // Fallback: copy as-is
      writeFileSync(join(outBookDir, `${chapterId}.json`), JSON.stringify(osnb2Verses, null, 2));
      totalCopied += osnb2Verses.length;
      continue;
    }

    const osnb2ByVerse = new Map(osnb2Verses.map(v => [v.verseId, v]));
    const osnb2VerseIds = new Set(osnb2Verses.map(v => v.verseId));
    const majoritySet = new Set(majorityVerseIds);

    // Determine the shift: osnb2 has extra verses not in majority
    // These are typically verse 1 being a heading in Hebrew (Psalms)
    // The shift means osnb2 verse N = majority verse N-shift
    const extraInOsnb2 = analysis.versesToShift; // verse IDs in osnb2 not in majority
    const extraInMajority = analysis.versesToAdd; // verse IDs in majority not in osnb2

    // Build the new chapter
    const newVerses: VerseData[] = [];

    // Strategy: use the majority verse IDs as the target
    // For each majority verse ID, find the matching osnb2 verse
    // The matching is based on the shift pattern

    if (extraInOsnb2.length > 0 && extraInMajority.length === 0) {
      // osnb2 has more verses than majority.
      // Two patterns:
      // A) Extra verses at START (e.g., Psalm headers as verse 1)
      //    → Prepend into osmain verse 1
      // B) Extra verses at END (e.g., chapter boundary shift: 2 Mos 7:26-29)
      //    → Drop them here, they'll appear in the next chapter via add_verses

      const osnb2Sorted = [...osnb2Verses].sort((a, b) => a.verseId - b.verseId);
      const extraSet = new Set(extraInOsnb2);

      // Determine if extras are at the start or end
      const firstExtra = Math.min(...extraInOsnb2);
      const lastExtra = Math.max(...extraInOsnb2);
      const osnb2Min = osnb2Sorted[0].verseId;
      const osnb2Max = osnb2Sorted[osnb2Sorted.length - 1].verseId;

      const extrasAtStart = firstExtra === osnb2Min;
      const extrasAtEnd = lastExtra === osnb2Max;

      // Separate extra and content verses
      const extraVerses = osnb2Sorted.filter(v => extraSet.has(v.verseId));
      const contentVerses = osnb2Sorted.filter(v => !extraSet.has(v.verseId));

      // Map content verses to majority verse IDs
      for (let i = 0; i < majorityVerseIds.length; i++) {
        const targetVerse = majorityVerseIds[i];
        const sourceV = contentVerses[i];

        if (sourceV) {
          newVerses.push({
            bookId,
            chapterId,
            verseId: targetVerse,
            text: sourceV.text,
            ...(sourceV.versions ? { versions: sourceV.versions } : {}),
          });
        } else {
          newVerses.push({
            bookId,
            chapterId,
            verseId: targetVerse,
            text: `[MISSING: no osnb2 source for position ${i}]`,
          });
        }
      }

      if (extrasAtStart && !extrasAtEnd) {
        // Pattern A: Prepend extra verse texts (headers) to verse 1
        const extraTexts = extraVerses.map(v => v.text);
        if (extraTexts.length > 0 && newVerses.length > 0) {
          const firstVerse = newVerses[0];
          firstVerse.text = extraTexts.join(' ') + ' ' + firstVerse.text;
        }
        renumberLog.push({
          key,
          type: 'renumber_prepend',
          details: `Prepended ${extraVerses.length} header verses [${extraInOsnb2.join(',')}] into verse 1. ${newVerses.length} verses in result.`,
        });
      } else if (extrasAtEnd && !extrasAtStart) {
        // Pattern B: Chapter boundary shift — extras dropped, will appear in next chapter
        renumberLog.push({
          key,
          type: 'renumber_boundary',
          details: `Dropped ${extraVerses.length} boundary verses [${extraInOsnb2.join(',')}] (moved to next chapter). ${newVerses.length} verses in result.`,
        });
      } else {
        // Mixed or unclear — append extra texts to last verse as fallback
        const extraTexts = extraVerses.map(v => v.text);
        if (extraTexts.length > 0 && newVerses.length > 0) {
          const lastVerse = newVerses[newVerses.length - 1];
          lastVerse.text = lastVerse.text + ' ' + extraTexts.join(' ');
        }
        renumberLog.push({
          key,
          type: 'renumber_mixed',
          details: `Mixed extras [${extraInOsnb2.join(',')}] appended to last verse. ${newVerses.length} verses in result.`,
        });
      }

      totalRenumbered += newVerses.length;

    } else if (extraInMajority.length > 0 && extraInOsnb2.length === 0) {
      // Majority has extra verses not in osnb2 — add them as placeholders
      // First copy all osnb2 verses
      for (const v of osnb2Verses) {
        newVerses.push({ ...v });
      }

      // Add placeholders for missing verses
      for (const verseId of extraInMajority) {
        const samples = findSampleTexts(bookId, chapterId, verseId, 3);
        newVerses.push({
          bookId,
          chapterId,
          verseId,
          text: `[NEEDS_TRANSLATION]`,
          _samples: samples,
        } as any);
        totalAdded++;
      }

      // Sort by verseId
      newVerses.sort((a, b) => a.verseId - b.verseId);

      renumberLog.push({
        key,
        type: 'add_verses',
        details: `Added ${extraInMajority.length} placeholder verses: [${extraInMajority.join(',')}]`,
      });

    } else {
      // Both sides have extras — complex case
      // For now, use majority structure and map what we can

      for (const targetVerse of majorityVerseIds) {
        const osnb2V = osnb2ByVerse.get(targetVerse);

        if (osnb2V) {
          newVerses.push({ ...osnb2V, verseId: targetVerse });
        } else {
          // Try to find from shifted osnb2 verses
          // Simple heuristic: look for targetVerse + shift
          let found = false;
          for (let delta = -5; delta <= 5; delta++) {
            const candidate = osnb2ByVerse.get(targetVerse + delta);
            if (candidate && !majoritySet.has(targetVerse + delta)) {
              newVerses.push({
                bookId,
                chapterId,
                verseId: targetVerse,
                text: candidate.text,
              });
              found = true;
              break;
            }
          }
          if (!found) {
            const samples = findSampleTexts(bookId, chapterId, targetVerse, 3);
            newVerses.push({
              bookId,
              chapterId,
              verseId: targetVerse,
              text: `[NEEDS_TRANSLATION]`,
              _samples: samples,
            } as any);
            totalAdded++;
          }
        }
      }

      // Handle extra osnb2 verses
      for (const extraV of extraInOsnb2) {
        if (!majoritySet.has(extraV)) {
          const v = osnb2ByVerse.get(extraV);
          if (v && newVerses.length > 0) {
            // Find closest verse and prepend/append
            const closest = newVerses.reduce((prev, curr) =>
              Math.abs(curr.verseId - extraV) < Math.abs(prev.verseId - extraV) ? curr : prev
            );
            closest.text = `[Merged from ${bookId}:${chapterId}:${extraV}] ${v.text} [End merged] ${closest.text}`;
          }
        }
      }

      newVerses.sort((a, b) => a.verseId - b.verseId);

      renumberLog.push({
        key,
        type: 'complex',
        details: `Complex merge: osnb2 extra [${extraInOsnb2.join(',')}], majority extra [${extraInMajority.join(',')}]. ${newVerses.length} verses in result.`,
      });
      totalRenumbered += newVerses.length;
    }

    writeFileSync(join(outBookDir, `${chapterId}.json`), JSON.stringify(newVerses, null, 2));
  }
}

// === Add new chapters (not in osnb2) ===
for (const analysis of analyses.filter(a => a.action === 'add_chapter')) {
  const { book, chapter, versesToAdd } = analysis;
  const outBookDir = join(OSNB3_DIR, String(book));
  mkdirSync(outBookDir, { recursive: true });

  const newVerses: VerseData[] = [];
  for (const verseId of versesToAdd) {
    const samples = findSampleTexts(book, chapter, verseId, 3);
    newVerses.push({
      bookId: book,
      chapterId: chapter,
      verseId,
      text: `[NEEDS_TRANSLATION]`,
      _samples: samples,
    } as any);
    totalAdded++;
  }

  newVerses.sort((a, b) => a.verseId - b.verseId);
  writeFileSync(join(outBookDir, `${chapter}.json`), JSON.stringify(newVerses, null, 2));
  totalNewChapters++;

  renumberLog.push({
    key: `${book}:${chapter}`,
    type: 'new_chapter',
    details: `New chapter with ${versesToAdd.length} placeholder verses`,
  });
}

// === Summary ===
console.log(`\n=== OSNB3 CREATION SUMMARY ===`);
console.log(`Verses copied as-is: ${totalCopied}`);
console.log(`Verses renumbered: ${totalRenumbered}`);
console.log(`Placeholder verses added: ${totalAdded}`);
console.log(`New chapters created: ${totalNewChapters}`);

// Count NEEDS_TRANSLATION
let needsTranslation = 0;
const allBooks = readdirSync(OSNB3_DIR)
  .filter(d => /^\d+$/.test(d) && statSync(join(OSNB3_DIR, d)).isDirectory());
for (const bookStr of allBooks) {
  const bookDir = join(OSNB3_DIR, bookStr);
  const files = readdirSync(bookDir).filter(f => f.endsWith('.json'));
  for (const f of files) {
    const data: VerseData[] = JSON.parse(readFileSync(join(bookDir, f), 'utf-8'));
    for (const v of data) {
      if (v.text.includes('[NEEDS_TRANSLATION]')) needsTranslation++;
    }
  }
}
console.log(`Verses needing translation: ${needsTranslation}`);

// Write renumber log
const logFile = join(import.meta.dirname, '../data/osnb3-renumber-log.json');
writeFileSync(logFile, JSON.stringify(renumberLog, null, 2));
console.log(`\nRenumber log: ${logFile}`);

// Show some examples
console.log(`\n=== RENUMBER EXAMPLES ===`);
for (const entry of renumberLog.slice(0, 20)) {
  console.log(`  ${entry.key} [${entry.type}]: ${entry.details}`);
}
if (renumberLog.length > 20) console.log(`  ... and ${renumberLog.length - 20} more`);
