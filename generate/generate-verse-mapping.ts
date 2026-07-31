import "./env.js";
/**
 * Generate verse mapping between a Bible translation and osnb (tanach/sblgnt numbering).
 *
 * Usage:
 *   bun generate/generate-verse-mapping.ts <input-file> <mapping-id> [--use-ai]
 *
 * Example:
 *   bun generate/generate-verse-mapping.ts ../dnb2011.txt dnb_2011_nb
 *   bun generate/generate-verse-mapping.ts ../dnb2011.txt dnb_2011_nb --use-ai
 *
 * The input file should have one verse per line in the format:
 *   BookName chapter,verse text
 *
 * Without --use-ai, the script detects differences and outputs a skeleton mapping
 * that needs manual review. With --use-ai, it uses Claude to match verses with
 * different numbering.
 */

import * as fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { books, maxTokens } from './constants.js';
import type { Verse, Chapter } from '../kvn/src/bible-types.js';
import { parseArgs, formatHelp, COMMON_FLAGS } from './cli.js';
import type { FlagSpec } from './cli.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Ett vers slik det står i inndatafila, før noen mapping. */
interface SourceVerse {
  bookId: number;
  srcBookName: string;
  srcChapter: number;
  srcVerse: number;
  text: string;
}

/**
 * Beskrivelsen av et kjent inndataformat.
 *
 * `bookNames` har `undefined` i verditypen fordi oppslaget er dynamisk og
 * `parseInputFile` tester nettopp på `undefined` for et ukjent boknavn.
 */
interface InputFormat {
  name: string;
  description: string;
  lineRegex: RegExp;
  bookNames: Record<string, number | undefined>;
}

/** Kapitteltellingen for ett osnb-kapittel. */
interface ChapterCount {
  bookId: number;
  chapter: number;
  verseCount: number;
  maxVerse: number;
}

/** Kapitteltellinger nøklet på `${bookId}-${chapter}`. */
type ChapterCounts = Record<string, ChapterCount>;

/** Kildevers gruppert på `${bookId}-${chapter}`. */
type SourceGroups = Record<string, SourceVerse[]>;

/** `${bookId}-${kapittel}-${vers}` i kilden → samme form i osnb. */
type VerseMap = Record<string, string>;

/** En forskjell mellom kildens og osnbs kapittelinndeling. */
interface Diff {
  bookId: number;
  chapter: number;
  type: 'missing_in_source' | 'missing_in_osnb' | 'verse_count_mismatch';
  srcCount: number;
  osnbCount: number;
}

/** Ett kapittel-og-vers-par, brukt når vers legges ut på rekke. */
interface VerseRef {
  chapter: number;
  verse: number;
}

/**
 * Én linje i svaret fra modellen: kildevers → osnb-vers, eller `null` når
 * verset ikke har noen motpart.
 */
interface AiMappingEntry {
  src: [number, number];
  dst: [number, number] | null;
}

/**
 * En post i `unmapped`. Feltene er valgfrie fordi tre ulike former legges inn:
 * hele kapitler uten data, enkeltvers uten treff, og udekte forskjeller.
 */
interface UnmappedEntry {
  bookId: number;
  chapter?: number;
  srcRef?: string;
  type?: Diff['type'];
  srcCount?: number;
  osnbCount?: number;
  reason: string;
}

// --- Configuration per known format ---

const KNOWN_FORMATS: Record<string, InputFormat | undefined> = {
  dnb_2011_nb: {
    name: 'Det Norske Bibelselskap 2011 Bokmål',
    description: 'Bibelselskapets oversettelse 2011',
    lineRegex: /^(.+?)\s+(\d+),(\d+)\s+(.+)$/,
    bookNames: {
      '1 Mos': 1, '2 Mos': 2, '3 Mos': 3, '4 Mos': 4, '5 Mos': 5,
      'Jos': 6, 'Dom': 7, 'Rut': 8,
      '1 Sam': 9, '2 Sam': 10, '1 Kong': 11, '2 Kong': 12,
      '1 Krøn': 13, '2 Krøn': 14,
      'Esra': 15, 'Neh': 16, 'Est': 17, 'Job': 18,
      'Sal': 19, 'Ordsp': 20, 'Fork': 21, 'Høgs': 22,
      'Jes': 23, 'Jer': 24, 'Klag': 25, 'Esek': 26, 'Dan': 27,
      'Hos': 28, 'Joel': 29, 'Am': 30, 'Ob': 31, 'Jona': 32,
      'Mi': 33, 'Nah': 34, 'Hab': 35, 'Sef': 36, 'Hag': 37, 'Sak': 38, 'Mal': 39,
      'Matt': 40, 'Mark': 41, 'Luk': 42, 'Joh': 43, 'Apg': 44,
      'Rom': 45, '1 Kor': 46, '2 Kor': 47, 'Gal': 48, 'Ef': 49,
      'Flp': 50, 'Kol': 51, '1 Tess': 52, '2 Tess': 53,
      '1 Tim': 54, '2 Tim': 55, 'Tit': 56, 'Filem': 57,
      'Hebr': 58, 'Jak': 59, '1 Pet': 60, '2 Pet': 61,
      '1 Joh': 62, '2 Joh': 63, '3 Joh': 64, 'Jud': 65, 'Åp': 66,
    },
  },
};

// --- Kommandolinje ---

/**
 * Flaggkontrakten for dette skriptet (#51, #52, #53).
 *
 * Inndatafil og mapping-id er posisjonsargumenter, som før. Den gamle koden
 * leste dem som `args[0]`/`args[1]` i den rå argumentlista, så `--use-ai` foran
 * dem stjal plassen og skriptet lette etter en fil som het «--use-ai».
 * Kontrakten skiller flagg fra posisjonsargumenter, så rekkefølgen er fri.
 */
const SPEC: Record<string, FlagSpec> = {
  'use-ai': {kind: 'boolean', help: 'la Claude matche versene som ikke lar seg mappe deterministisk'},
  help: COMMON_FLAGS.help,
};

const HELP_EXAMPLES = [
  'bun generate/generate-verse-mapping.ts ../dnb2011.txt dnb_2011_nb',
  'bun generate/generate-verse-mapping.ts ../dnb2011.txt dnb_2011_nb --use-ai',
  '',
  `Kjente mapping-id-er: ${Object.keys(KNOWN_FORMATS).join(', ')}`,
  'Inndatafila har ett vers per linje: «Boknavn kapittel,vers tekst».',
  'Resultatet skrives til generate/mappings/<mapping-id>.json.',
];

// Hjelpen svares FØR .env leses og før inndatafila eller osnb-dataene åpnes:
// `--help` skal ikke gjøre arbeid. `KNOWN_FORMATS` over er ren data, ingen I/O.
const { flags, positional } = parseArgs(process.argv.slice(2), SPEC);
if (flags.help) {
  console.log(formatHelp(
    'generate/generate-verse-mapping.ts <input-file> <mapping-id>',
    'bygger versmapping mellom en oversettelse og osnb (hebraisk/gresk nummerering)',
    SPEC,
    HELP_EXAMPLES,
  ));
  process.exit(0);
}


const VERSE_MAPPING_SCHEMA = {
    type: "object",
    properties: {
        mappings: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    src: {
                        type: "array",
                        items: {type: "integer"},
                        minItems: 2,
                        maxItems: 2
                    },
                    dst: {
                        type: ["array", "null"],
                        items: {type: "integer"},
                        minItems: 2,
                        maxItems: 2
                    }
                },
                required: ["src", "dst"],
                additionalProperties: false
            }
        }
    },
    required: ["mappings"],
    additionalProperties: false
};

// --- Parsing ---

function parseInputFile(filePath: string, format: InputFormat): SourceVerse[] {
  const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n');
  const verses: SourceVerse[] = [];

  for (const line of lines) {
    const match = line.match(format.lineRegex);
    if (!match) {
      console.warn('Unparseable line:', line.substring(0, 80));
      continue;
    }
    const [, bookName, ch, v, text] = match;
    const bookId = format.bookNames[bookName];
    if (bookId === undefined) {
      console.warn('Unknown book name:', bookName);
      continue;
    }
    verses.push({
      bookId,
      srcBookName: bookName,
      srcChapter: parseInt(ch),
      srcVerse: parseInt(v),
      text: text.trim(),
    });
  }

  return verses;
}

// --- Load osnb data ---

function loadOsnb2Chapter(bookId: number, chapter: number): Chapter | null {
  const filePath = path.join(__dirname, 'bibles_raw', 'osnb', `${bookId}`, `${chapter}.json`);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function getOsnb2ChapterCounts(): ChapterCounts {
  const counts: ChapterCounts = {};
  for (const book of books) {
    for (let ch = 1; ch <= book.chapters; ch++) {
      const verses = loadOsnb2Chapter(book.id, ch);
      if (verses) {
        const key = `${book.id}-${ch}`;
        counts[key] = {
          bookId: book.id,
          chapter: ch,
          verseCount: verses.length,
          maxVerse: Math.max(...verses.map(v => v.verseId)),
        };
      }
    }
  }
  return counts;
}

// --- Group source verses by book+chapter ---

function groupByChapter(verses: SourceVerse[]): SourceGroups {
  const groups: SourceGroups = {};
  for (const v of verses) {
    const key = `${v.bookId}-${v.srcChapter}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(v);
  }
  return groups;
}

// --- Find differences ---

function findDifferences(srcGroups: SourceGroups, osnbCounts: ChapterCounts): Diff[] {
  const diffs: Diff[] = [];

  // Collect all unique bookId+chapter pairs from both sides
  const allBooks = new Set<number>();
  for (const key of Object.keys(srcGroups)) {
    allBooks.add(parseInt(key.split('-')[0]));
  }

  for (const bookId of [...allBooks].sort((a, b) => a - b)) {
    const srcChapters = Object.keys(srcGroups)
      .filter(k => k.startsWith(`${bookId}-`))
      .map(k => parseInt(k.split('-')[1]))
      .sort((a, b) => a - b);

    const osnbChapters = Object.keys(osnbCounts)
      .filter(k => k.startsWith(`${bookId}-`))
      .map(k => parseInt(k.split('-')[1]))
      .sort((a, b) => a - b);

    const maxSrcCh = Math.max(...srcChapters, 0);
    const maxOsnb2Ch = Math.max(...osnbChapters, 0);
    const maxCh = Math.max(maxSrcCh, maxOsnb2Ch);

    for (let ch = 1; ch <= maxCh; ch++) {
      const srcKey = `${bookId}-${ch}`;
      const srcVerses = srcGroups[srcKey] || [];
      const osnbInfo = osnbCounts[srcKey];

      if (srcVerses.length === 0 && !osnbInfo) continue;

      if (srcVerses.length === 0 && osnbInfo) {
        // Chapter exists in osnb but not in source
        diffs.push({
          bookId, chapter: ch, type: 'missing_in_source',
          srcCount: 0, osnbCount: osnbInfo.verseCount,
        });
      } else if (!osnbInfo && srcVerses.length > 0) {
        // Chapter exists in source but not in osnb
        diffs.push({
          bookId, chapter: ch, type: 'missing_in_osnb',
          srcCount: srcVerses.length, osnbCount: 0,
        });
      } else if (srcVerses.length !== osnbInfo.verseCount) {
        diffs.push({
          bookId, chapter: ch, type: 'verse_count_mismatch',
          srcCount: srcVerses.length, osnbCount: osnbInfo.verseCount,
        });
      }
    }
  }

  return diffs;
}

// --- AI-based verse matching ---

async function matchVersesWithAI(
  srcVerses: SourceVerse[],
  osnbVerses: Verse[],
  bookId: number,
  srcChapter: number,
  osnbChapter: number,
): Promise<AiMappingEntry[]> {
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const bookName = books.find(b => b.id === bookId)?.name || `Book ${bookId}`;

  const srcText = srcVerses
    .map(v => `${v.srcChapter}:${v.srcVerse} ${v.text}`)
    .join('\n');

  const osnbText = osnbVerses
    .map(v => `${v.chapterId}:${v.verseId} ${v.text}`)
    .join('\n');

  const prompt = `I have two Bible translations of ${bookName} with different verse numbering. I need you to map each verse from the SOURCE to the corresponding verse in OSNB (which follows Hebrew/Greek original numbering).

SOURCE verses (chapters ${[...new Set(srcVerses.map(v => v.srcChapter))].join(',')}):
${srcText}

OSNB verses (chapters ${[...new Set(osnbVerses.map(v => v.chapterId))].join(',')}):
${osnbText}

For each SOURCE verse, determine which OSNB verse it corresponds to based on content.

Rules:
- Most verses will be 1:1 matches with just shifted numbering
- Some verses might be split (1 source → 2 osnb) or merged (2 source → 1 osnb)
- For splits: map the source verse to the first osnb verse of the split
- For merges: map each source verse to the same osnb verse
- If a source verse has no match in osnb, use null

Return a JSON object with a 'mappings' array, one entry per source verse:
{
  "mappings": [
    { "src": [chapter, verse], "dst": [chapter, verse] },
    { "src": [chapter, verse], "dst": [chapter, verse] },
    ...
  ]
}

If dst is null (no match), use: { "src": [chapter, verse], "dst": null }`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
    output_config: {
      format: {
        type: "json_schema",
        schema: VERSE_MAPPING_SCHEMA
      }
    }
  });

  // `content[0]` er typet som unionen ContentBlock, der bare tekstvarianten har
  // `text`. Påstanden sier hva koden alltid har antatt — svaret er tvunget til
  // VERSE_MAPPING_SCHEMA over, så blokka er en tekstblokk.
  const result = JSON.parse((response.content[0] as { text: string }).text);
  return result.mappings;
}

// --- Deterministic mapping ---

/**
 * Apply sequential 1:1 mapping for a group of consecutive chapters.
 * All source verses are laid out in order, and mapped to all osnb verses in order.
 * Only adds entries where the mapping differs from identity (same chapter + verse).
 */
function mapChapterGroupSequentially(
  bookId: number,
  srcChapters: number[],
  osnbChapters: number[],
  srcGroups: SourceGroups,
  osnbCounts: ChapterCounts,
  verseMap: VerseMap,
): number {
  // Build sequential list of source refs
  const srcRefs: VerseRef[] = [];
  for (const ch of srcChapters) {
    const verses = srcGroups[`${bookId}-${ch}`] || [];
    for (const v of verses) {
      srcRefs.push({ chapter: ch, verse: v.srcVerse });
    }
  }

  // Build sequential list of osnb refs
  const osnbRefs: VerseRef[] = [];
  for (const ch of osnbChapters) {
    const info = osnbCounts[`${bookId}-${ch}`];
    if (info) {
      for (let v = 1; v <= info.maxVerse; v++) {
        osnbRefs.push({ chapter: ch, verse: v });
      }
    }
  }

  // Map 1:1 sequentially
  const count = Math.min(srcRefs.length, osnbRefs.length);
  for (let i = 0; i < count; i++) {
    const src = srcRefs[i];
    const dst = osnbRefs[i];
    if (src.chapter !== dst.chapter || src.verse !== dst.verse) {
      verseMap[`${bookId}-${src.chapter}-${src.verse}`] = `${bookId}-${dst.chapter}-${dst.verse}`;
    }
  }

  return count;
}

/**
 * Try to map verse differences deterministically.
 * Handles:
 * 1. Adjacent chapter pairs where verse counts compensate
 * 2. Multi-chapter blocks (e.g. Job 38-41) where totals match
 * 3. Overflow chapters (e.g. Malachi 4 → Malachi 3:19-24)
 */
function tryDeterministicMapping(
  diffs: Diff[],
  srcGroups: SourceGroups,
  osnbCounts: ChapterCounts,
): { verseMap: VerseMap; unhandled: Diff[] } {
  const verseMap: VerseMap = {};
  const handled = new Set<string>();

  // Group diffs by bookId, sorted by chapter
  const diffsByBook: Record<number, Diff[]> = {};
  for (const d of diffs) {
    if (!diffsByBook[d.bookId]) diffsByBook[d.bookId] = [];
    diffsByBook[d.bookId].push(d);
  }
  for (const bookDiffs of Object.values(diffsByBook)) {
    bookDiffs.sort((a, b) => a.chapter - b.chapter);
  }

  for (const [bookIdStr, bookDiffs] of Object.entries(diffsByBook)) {
    const bookId = parseInt(bookIdStr);

    // Find groups of consecutive diff chapters
    const groups: Diff[][] = [];
    let currentGroup: Diff[] = [bookDiffs[0]];

    for (let i = 1; i < bookDiffs.length; i++) {
      if (bookDiffs[i].chapter === currentGroup[currentGroup.length - 1].chapter + 1) {
        currentGroup.push(bookDiffs[i]);
      } else {
        groups.push(currentGroup);
        currentGroup = [bookDiffs[i]];
      }
    }
    groups.push(currentGroup);

    for (const group of groups) {
      const chapters = group.map(d => d.chapter);

      // Calculate totals for the group
      let srcTotal = 0;
      let osnbTotal = 0;
      const srcChapters: number[] = [];
      const osnbChapters: number[] = [];

      for (const d of group) {
        srcTotal += d.srcCount;
        if (d.srcCount > 0) srcChapters.push(d.chapter);

        if (d.type !== 'missing_in_osnb') {
          osnbTotal += d.osnbCount;
        }
        if (d.osnbCount > 0) osnbChapters.push(d.chapter);
      }

      // For "missing_in_osnb" chapters (like Mal 4), check if they overflow
      // into an adjacent osnb chapter that has extra verses
      const hasMissingOsnb2 = group.some(d => d.type === 'missing_in_osnb');
      if (hasMissingOsnb2) {
        // Find the osnb chapter(s) that contain the overflow
        // E.g., Mal 4 missing → Mal 3 in osnb has extra verses
        const firstCh = chapters[0];
        const lastCh = chapters[chapters.length - 1];

        // Check if previous chapter absorbs the overflow
        const prevKey = `${bookId}-${firstCh - 1}`;
        const prevOsnb2 = osnbCounts[prevKey];
        const prevSrc = srcGroups[prevKey];
        if (prevOsnb2 && prevSrc) {
          // Include the previous chapter in the group
          const prevSrcCount = prevSrc.length;
          if (prevSrcCount < prevOsnb2.verseCount) {
            // Previous osnb chapter has more verses - it absorbs the overflow
            srcTotal += prevSrcCount;
            osnbTotal += prevOsnb2.verseCount;
            srcChapters.unshift(firstCh - 1);
            osnbChapters.unshift(firstCh - 1);
          }
        }
      }

      if (srcTotal === osnbTotal && srcTotal > 0) {
        // Totals match - do sequential mapping
        mapChapterGroupSequentially(bookId, srcChapters, osnbChapters, srcGroups, osnbCounts, verseMap);
        for (const ch of chapters) handled.add(`${bookId}-${ch}`);
      } else if (group.length === 2 && !hasMissingOsnb2) {
        // Two adjacent chapters, totals match - handle as simple pair
        const d1 = group[0];
        const d2 = group[1];
        const pairSrcTotal = d1.srcCount + d2.srcCount;
        const pairOsnb2Total = d1.osnbCount + d2.osnbCount;

        if (pairSrcTotal === pairOsnb2Total) {
          mapChapterGroupSequentially(
            bookId,
            [d1.chapter, d2.chapter],
            [d1.chapter, d2.chapter],
            srcGroups, osnbCounts, verseMap
          );
          handled.add(`${bookId}-${d1.chapter}`);
          handled.add(`${bookId}-${d2.chapter}`);
        }
      }
    }
  }

  // Find unhandled diffs
  const unhandled = diffs.filter(d => !handled.has(`${d.bookId}-${d.chapter}`));

  return { verseMap, unhandled };
}

// --- Main ---

async function main(): Promise<void> {
  if (positional.length < 2) {
    console.log('Usage: bun generate/generate-verse-mapping.ts <input-file> <mapping-id> [--use-ai]');
    console.log('');
    console.log('Known mapping IDs:', Object.keys(KNOWN_FORMATS).join(', '));
    process.exit(1);
  }

  const inputFile = positional[0];
  const mappingId = positional[1];
  const useAI = flags['use-ai'] as boolean;

  const format = KNOWN_FORMATS[mappingId];
  if (!format) {
    console.error(`Unknown mapping ID: ${mappingId}. Known: ${Object.keys(KNOWN_FORMATS).join(', ')}`);
    process.exit(1);
  }

  console.log(`Parsing ${inputFile}...`);
  const srcVerses = parseInputFile(inputFile, format);
  console.log(`Parsed ${srcVerses.length} verses`);

  console.log('Loading osnb chapter data...');
  const osnbCounts = getOsnb2ChapterCounts();
  console.log(`Loaded ${Object.keys(osnbCounts).length} chapters from osnb`);

  const srcGroups = groupByChapter(srcVerses);
  console.log(`Source has ${Object.keys(srcGroups).length} chapters`);

  console.log('\nFinding differences...');
  const diffs = findDifferences(srcGroups, osnbCounts);

  if (diffs.length === 0) {
    console.log('No differences found! All verses map 1:1.');
    const mapping = {
      id: mappingId,
      name: format.name,
      description: format.description,
      bookNames: format.bookNames,
      verseMap: {},
      unmapped: [],
    };
    const outPath = path.join(__dirname, 'mappings', `${mappingId}.json`);
    fs.writeFileSync(outPath, JSON.stringify(mapping, null, 2));
    console.log(`Written to ${outPath}`);
    return;
  }

  console.log(`Found ${diffs.length} chapters with differences:\n`);
  for (const d of diffs) {
    const bookName = books.find(b => b.id === d.bookId)?.name || `Book ${d.bookId}`;
    console.log(`  ${bookName} ch${d.chapter}: ${d.type} (src=${d.srcCount}, osnb=${d.osnbCount})`);
  }

  // Try deterministic mapping first
  console.log('\nAttempting deterministic mapping for simple shifts...');
  const { verseMap, unhandled } = tryDeterministicMapping(diffs, srcGroups, osnbCounts);

  console.log(`Deterministic mapping created ${Object.keys(verseMap).length} entries`);
  if (unhandled.length > 0) {
    console.log(`${unhandled.length} chapters could not be mapped deterministically:`);
    for (const d of unhandled) {
      const bookName = books.find(b => b.id === d.bookId)?.name || `Book ${d.bookId}`;
      console.log(`  ${bookName} ch${d.chapter}: ${d.type} (src=${d.srcCount}, osnb=${d.osnbCount})`);
    }
  }

  // Group unhandled diffs into consecutive chapter groups per book for AI matching
  const unmapped: UnmappedEntry[] = [];
  if (useAI && unhandled.length > 0) {
    console.log('\nUsing AI to match remaining chapters...');

    // Group consecutive unhandled chapters by book
    const unhandledByBook: Record<number, Diff[]> = {};
    for (const d of unhandled) {
      if (!unhandledByBook[d.bookId]) unhandledByBook[d.bookId] = [];
      unhandledByBook[d.bookId].push(d);
    }

    for (const [bookIdStr, bookUnhandled] of Object.entries(unhandledByBook)) {
      const bookId = parseInt(bookIdStr);
      const bookName = books.find(b => b.id === bookId)?.name || `Book ${bookId}`;

      // Group into consecutive runs
      bookUnhandled.sort((a, b) => a.chapter - b.chapter);
      const aiGroups: Diff[][] = [];
      let current: Diff[] = [bookUnhandled[0]];
      for (let i = 1; i < bookUnhandled.length; i++) {
        if (bookUnhandled[i].chapter === current[current.length - 1].chapter + 1) {
          current.push(bookUnhandled[i]);
        } else {
          aiGroups.push(current);
          current = [bookUnhandled[i]];
        }
      }
      aiGroups.push(current);

      for (const group of aiGroups) {
        const chapters = group.map(d => d.chapter);

        // Collect all source verses for these chapters
        const allSrcVerses: SourceVerse[] = [];
        for (const d of group) {
          if (d.srcCount > 0) {
            const sv = srcGroups[`${bookId}-${d.chapter}`] || [];
            allSrcVerses.push(...sv);
          }
        }

        // Collect all osnb verses for these chapters
        const allOsnb2Verses: Verse[] = [];
        for (const d of group) {
          if (d.type !== 'missing_in_osnb') {
            const ov = loadOsnb2Chapter(bookId, d.chapter) || [];
            allOsnb2Verses.push(...ov);
          }
        }

        if (allOsnb2Verses.length === 0) {
          console.log(`  Skipping ${bookName} ch${chapters.join(',')} (no osnb data)`);
          for (const d of group) {
            unmapped.push({
              bookId, chapter: d.chapter,
              reason: `No osnb data for chapter (source has ${d.srcCount} verses)`,
            });
          }
          continue;
        }

        if (allSrcVerses.length === 0) {
          console.log(`  Skipping ${bookName} ch${chapters.join(',')} (no source data)`);
          for (const d of group) {
            unmapped.push({
              bookId, chapter: d.chapter,
              reason: `No source data for chapter (osnb has ${d.osnbCount} verses)`,
            });
          }
          continue;
        }

        console.log(`  Matching ${bookName} ch${chapters.join(',')} (${allSrcVerses.length} src → ${allOsnb2Verses.length} osnb)...`);

        try {
          const aiMapping = await matchVersesWithAI(
            allSrcVerses, allOsnb2Verses, bookId, chapters[0], chapters[0]
          );

          let mapped = 0;
          for (const entry of aiMapping) {
            if (entry.dst === null) {
              unmapped.push({
                bookId,
                srcRef: `${entry.src[0]}:${entry.src[1]}`,
                reason: 'No match in osnb',
              });
            } else {
              mapped++;
              if (entry.src[0] !== entry.dst[0] || entry.src[1] !== entry.dst[1]) {
                verseMap[`${bookId}-${entry.src[0]}-${entry.src[1]}`] =
                  `${bookId}-${entry.dst[0]}-${entry.dst[1]}`;
              }
            }
          }
          console.log(`    → mapped ${mapped} verses`);
        } catch (err) {
          console.error(`    → AI matching failed: ${(err as Error).message}`);
          for (const d of group) {
            unmapped.push({
              bookId, chapter: d.chapter,
              reason: `AI matching failed: ${(err as Error).message}`,
            });
          }
        }

        // Rate limiting
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  } else if (unhandled.length > 0) {
    for (const d of unhandled) {
      unmapped.push({
        bookId: d.bookId,
        chapter: d.chapter,
        type: d.type,
        srcCount: d.srcCount,
        osnbCount: d.osnbCount,
        reason: 'Not mapped (run with --use-ai to use AI matching)',
      });
    }
  }

  // Build output
  const mapping = {
    id: mappingId,
    name: format.name,
    description: format.description,
    bookNames: format.bookNames,
    verseMap,
    unmapped: unmapped.length > 0 ? unmapped : undefined,
  };

  const outPath = path.join(__dirname, 'mappings', `${mappingId}.json`);
  fs.writeFileSync(outPath, JSON.stringify(mapping, null, 2));
  console.log(`\nMapping written to ${outPath}`);
  console.log(`  ${Object.keys(verseMap).length} verse mappings`);
  if (unmapped.length > 0) {
    console.log(`  ${unmapped.length} unmapped entries (check "unmapped" in output)`);
  }
}

// Kjører bare når fila startes direkte. Uten vakten kjører jobben ved IMPORT —
// det er grunnen til at days.ts slettet data bare man lastet modulen (#108),
// og det gjør skriptene umulige å teste.
if (import.meta.main) {
    main().catch(err => {
  console.error(err);
  process.exit(1);
});
}
