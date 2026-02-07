/**
 * Generate verse mapping between a Bible translation and osnb2 (tanach/sblgnt numbering).
 *
 * Usage:
 *   node generate-verse-mapping.mjs <input-file> <mapping-id> [--use-ai]
 *
 * Example:
 *   node generate-verse-mapping.mjs ../bibel2011.txt bibel2011
 *   node generate-verse-mapping.mjs ../bibel2011.txt bibel2011 --use-ai
 *
 * The input file should have one verse per line in the format:
 *   BookName chapter,verse text
 *
 * Without --use-ai, the script detects differences and outputs a skeleton mapping
 * that needs manual review. With --use-ai, it uses Claude to match verses with
 * different numbering.
 */

import dotenv from 'dotenv';
import * as fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { books } from './constants.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

// --- Configuration per known format ---

const KNOWN_FORMATS = {
  bibel2011: {
    name: 'Bibel 2011',
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

// --- Parsing ---

function parseInputFile(filePath, format) {
  const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n');
  const verses = [];

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

// --- Load osnb2 data ---

function loadOsnb2Chapter(bookId, chapter) {
  const filePath = path.join(__dirname, 'bibles_raw', 'osnb2', `${bookId}`, `${chapter}.json`);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function getOsnb2ChapterCounts() {
  const counts = {};
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

function groupByChapter(verses) {
  const groups = {};
  for (const v of verses) {
    const key = `${v.bookId}-${v.srcChapter}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(v);
  }
  return groups;
}

// --- Find differences ---

function findDifferences(srcGroups, osnb2Counts) {
  const diffs = [];

  // Collect all unique bookId+chapter pairs from both sides
  const allBooks = new Set();
  for (const key of Object.keys(srcGroups)) {
    allBooks.add(parseInt(key.split('-')[0]));
  }

  for (const bookId of [...allBooks].sort((a, b) => a - b)) {
    const srcChapters = Object.keys(srcGroups)
      .filter(k => k.startsWith(`${bookId}-`))
      .map(k => parseInt(k.split('-')[1]))
      .sort((a, b) => a - b);

    const osnb2Chapters = Object.keys(osnb2Counts)
      .filter(k => k.startsWith(`${bookId}-`))
      .map(k => parseInt(k.split('-')[1]))
      .sort((a, b) => a - b);

    const maxSrcCh = Math.max(...srcChapters, 0);
    const maxOsnb2Ch = Math.max(...osnb2Chapters, 0);
    const maxCh = Math.max(maxSrcCh, maxOsnb2Ch);

    for (let ch = 1; ch <= maxCh; ch++) {
      const srcKey = `${bookId}-${ch}`;
      const srcVerses = srcGroups[srcKey] || [];
      const osnb2Info = osnb2Counts[srcKey];

      if (srcVerses.length === 0 && !osnb2Info) continue;

      if (srcVerses.length === 0 && osnb2Info) {
        // Chapter exists in osnb2 but not in source
        diffs.push({
          bookId, chapter: ch, type: 'missing_in_source',
          srcCount: 0, osnb2Count: osnb2Info.verseCount,
        });
      } else if (!osnb2Info && srcVerses.length > 0) {
        // Chapter exists in source but not in osnb2
        diffs.push({
          bookId, chapter: ch, type: 'missing_in_osnb2',
          srcCount: srcVerses.length, osnb2Count: 0,
        });
      } else if (srcVerses.length !== osnb2Info.verseCount) {
        diffs.push({
          bookId, chapter: ch, type: 'verse_count_mismatch',
          srcCount: srcVerses.length, osnb2Count: osnb2Info.verseCount,
        });
      }
    }
  }

  return diffs;
}

// --- AI-based verse matching ---

async function matchVersesWithAI(srcVerses, osnb2Verses, bookId, srcChapter, osnb2Chapter) {
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const bookName = books.find(b => b.id === bookId)?.name || `Book ${bookId}`;

  const srcText = srcVerses
    .map(v => `${v.srcChapter}:${v.srcVerse} ${v.text}`)
    .join('\n');

  const osnb2Text = osnb2Verses
    .map(v => `${v.chapterId}:${v.verseId} ${v.text}`)
    .join('\n');

  const prompt = `I have two Bible translations of ${bookName} with different verse numbering. I need you to map each verse from the SOURCE to the corresponding verse in OSNB2 (which follows Hebrew/Greek original numbering).

SOURCE verses (chapters ${[...new Set(srcVerses.map(v => v.srcChapter))].join(',')}):
${srcText}

OSNB2 verses (chapters ${[...new Set(osnb2Verses.map(v => v.chapterId))].join(',')}):
${osnb2Text}

For each SOURCE verse, determine which OSNB2 verse it corresponds to based on content.

Rules:
- Most verses will be 1:1 matches with just shifted numbering
- Some verses might be split (1 source → 2 osnb2) or merged (2 source → 1 osnb2)
- For splits: map the source verse to the first osnb2 verse of the split
- For merges: map each source verse to the same osnb2 verse
- If a source verse has no match in osnb2, use null

Return ONLY a JSON array, one entry per source verse:
[
  { "src": [chapter, verse], "dst": [chapter, verse] },
  { "src": [chapter, verse], "dst": [chapter, verse] },
  ...
]

If dst is null (no match), use: { "src": [chapter, verse], "dst": null }`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].text;
  // Extract JSON from response - find the outermost [...] block
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error(`Could not parse AI response for ${bookName} ch${srcChapter}: ${text.substring(0, 200)}`);
  }
  try {
    return JSON.parse(jsonMatch[0]);
  } catch (e) {
    // Try to fix common issues: trailing commas, truncated response
    let cleaned = jsonMatch[0]
      .replace(/,\s*\]/g, ']')  // trailing commas
      .replace(/}\s*{/g, '},{'); // missing commas between objects
    // If still invalid, try to find valid prefix
    try {
      return JSON.parse(cleaned);
    } catch (e2) {
      // Find the last complete object and close the array
      const lastBrace = cleaned.lastIndexOf('}');
      if (lastBrace > 0) {
        const truncated = cleaned.substring(0, lastBrace + 1) + ']';
        return JSON.parse(truncated);
      }
      throw new Error(`Could not parse AI JSON for ${bookName} ch${srcChapter}: ${e.message}`);
    }
  }
}

// --- Deterministic mapping ---

/**
 * Apply sequential 1:1 mapping for a group of consecutive chapters.
 * All source verses are laid out in order, and mapped to all osnb2 verses in order.
 * Only adds entries where the mapping differs from identity (same chapter + verse).
 */
function mapChapterGroupSequentially(bookId, srcChapters, osnb2Chapters, srcGroups, osnb2Counts, verseMap) {
  // Build sequential list of source refs
  const srcRefs = [];
  for (const ch of srcChapters) {
    const verses = srcGroups[`${bookId}-${ch}`] || [];
    for (const v of verses) {
      srcRefs.push({ chapter: ch, verse: v.srcVerse });
    }
  }

  // Build sequential list of osnb2 refs
  const osnb2Refs = [];
  for (const ch of osnb2Chapters) {
    const info = osnb2Counts[`${bookId}-${ch}`];
    if (info) {
      for (let v = 1; v <= info.maxVerse; v++) {
        osnb2Refs.push({ chapter: ch, verse: v });
      }
    }
  }

  // Map 1:1 sequentially
  const count = Math.min(srcRefs.length, osnb2Refs.length);
  for (let i = 0; i < count; i++) {
    const src = srcRefs[i];
    const dst = osnb2Refs[i];
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
function tryDeterministicMapping(diffs, srcGroups, osnb2Counts) {
  const verseMap = {};
  const handled = new Set();

  // Group diffs by bookId, sorted by chapter
  const diffsByBook = {};
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
    const groups = [];
    let currentGroup = [bookDiffs[0]];

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
      let osnb2Total = 0;
      const srcChapters = [];
      const osnb2Chapters = [];

      for (const d of group) {
        srcTotal += d.srcCount;
        if (d.srcCount > 0) srcChapters.push(d.chapter);

        if (d.type !== 'missing_in_osnb2') {
          osnb2Total += d.osnb2Count;
        }
        if (d.osnb2Count > 0) osnb2Chapters.push(d.chapter);
      }

      // For "missing_in_osnb2" chapters (like Mal 4), check if they overflow
      // into an adjacent osnb2 chapter that has extra verses
      const hasMissingOsnb2 = group.some(d => d.type === 'missing_in_osnb2');
      if (hasMissingOsnb2) {
        // Find the osnb2 chapter(s) that contain the overflow
        // E.g., Mal 4 missing → Mal 3 in osnb2 has extra verses
        const firstCh = chapters[0];
        const lastCh = chapters[chapters.length - 1];

        // Check if previous chapter absorbs the overflow
        const prevKey = `${bookId}-${firstCh - 1}`;
        const prevOsnb2 = osnb2Counts[prevKey];
        const prevSrc = srcGroups[prevKey];
        if (prevOsnb2 && prevSrc) {
          // Include the previous chapter in the group
          const prevSrcCount = prevSrc.length;
          if (prevSrcCount < prevOsnb2.verseCount) {
            // Previous osnb2 chapter has more verses - it absorbs the overflow
            srcTotal += prevSrcCount;
            osnb2Total += prevOsnb2.verseCount;
            srcChapters.unshift(firstCh - 1);
            osnb2Chapters.unshift(firstCh - 1);
          }
        }
      }

      if (srcTotal === osnb2Total && srcTotal > 0) {
        // Totals match - do sequential mapping
        mapChapterGroupSequentially(bookId, srcChapters, osnb2Chapters, srcGroups, osnb2Counts, verseMap);
        for (const ch of chapters) handled.add(`${bookId}-${ch}`);
      } else if (group.length === 2 && !hasMissingOsnb2) {
        // Two adjacent chapters, totals match - handle as simple pair
        const d1 = group[0];
        const d2 = group[1];
        const pairSrcTotal = d1.srcCount + d2.srcCount;
        const pairOsnb2Total = d1.osnb2Count + d2.osnb2Count;

        if (pairSrcTotal === pairOsnb2Total) {
          mapChapterGroupSequentially(
            bookId,
            [d1.chapter, d2.chapter],
            [d1.chapter, d2.chapter],
            srcGroups, osnb2Counts, verseMap
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

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.log('Usage: node generate-verse-mapping.mjs <input-file> <mapping-id> [--use-ai]');
    console.log('');
    console.log('Known mapping IDs:', Object.keys(KNOWN_FORMATS).join(', '));
    process.exit(1);
  }

  const inputFile = args[0];
  const mappingId = args[1];
  const useAI = args.includes('--use-ai');

  const format = KNOWN_FORMATS[mappingId];
  if (!format) {
    console.error(`Unknown mapping ID: ${mappingId}. Known: ${Object.keys(KNOWN_FORMATS).join(', ')}`);
    process.exit(1);
  }

  console.log(`Parsing ${inputFile}...`);
  const srcVerses = parseInputFile(inputFile, format);
  console.log(`Parsed ${srcVerses.length} verses`);

  console.log('Loading osnb2 chapter data...');
  const osnb2Counts = getOsnb2ChapterCounts();
  console.log(`Loaded ${Object.keys(osnb2Counts).length} chapters from osnb2`);

  const srcGroups = groupByChapter(srcVerses);
  console.log(`Source has ${Object.keys(srcGroups).length} chapters`);

  console.log('\nFinding differences...');
  const diffs = findDifferences(srcGroups, osnb2Counts);

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
    console.log(`  ${bookName} ch${d.chapter}: ${d.type} (src=${d.srcCount}, osnb2=${d.osnb2Count})`);
  }

  // Try deterministic mapping first
  console.log('\nAttempting deterministic mapping for simple shifts...');
  const { verseMap, unhandled } = tryDeterministicMapping(diffs, srcGroups, osnb2Counts);

  console.log(`Deterministic mapping created ${Object.keys(verseMap).length} entries`);
  if (unhandled.length > 0) {
    console.log(`${unhandled.length} chapters could not be mapped deterministically:`);
    for (const d of unhandled) {
      const bookName = books.find(b => b.id === d.bookId)?.name || `Book ${d.bookId}`;
      console.log(`  ${bookName} ch${d.chapter}: ${d.type} (src=${d.srcCount}, osnb2=${d.osnb2Count})`);
    }
  }

  // Group unhandled diffs into consecutive chapter groups per book for AI matching
  const unmapped = [];
  if (useAI && unhandled.length > 0) {
    console.log('\nUsing AI to match remaining chapters...');

    // Group consecutive unhandled chapters by book
    const unhandledByBook = {};
    for (const d of unhandled) {
      if (!unhandledByBook[d.bookId]) unhandledByBook[d.bookId] = [];
      unhandledByBook[d.bookId].push(d);
    }

    for (const [bookIdStr, bookUnhandled] of Object.entries(unhandledByBook)) {
      const bookId = parseInt(bookIdStr);
      const bookName = books.find(b => b.id === bookId)?.name || `Book ${bookId}`;

      // Group into consecutive runs
      bookUnhandled.sort((a, b) => a.chapter - b.chapter);
      const aiGroups = [];
      let current = [bookUnhandled[0]];
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
        const allSrcVerses = [];
        for (const d of group) {
          if (d.srcCount > 0) {
            const sv = srcGroups[`${bookId}-${d.chapter}`] || [];
            allSrcVerses.push(...sv);
          }
        }

        // Collect all osnb2 verses for these chapters
        const allOsnb2Verses = [];
        for (const d of group) {
          if (d.type !== 'missing_in_osnb2') {
            const ov = loadOsnb2Chapter(bookId, d.chapter) || [];
            allOsnb2Verses.push(...ov);
          }
        }

        if (allOsnb2Verses.length === 0) {
          console.log(`  Skipping ${bookName} ch${chapters.join(',')} (no osnb2 data)`);
          for (const d of group) {
            unmapped.push({
              bookId, chapter: d.chapter,
              reason: `No osnb2 data for chapter (source has ${d.srcCount} verses)`,
            });
          }
          continue;
        }

        if (allSrcVerses.length === 0) {
          console.log(`  Skipping ${bookName} ch${chapters.join(',')} (no source data)`);
          for (const d of group) {
            unmapped.push({
              bookId, chapter: d.chapter,
              reason: `No source data for chapter (osnb2 has ${d.osnb2Count} verses)`,
            });
          }
          continue;
        }

        console.log(`  Matching ${bookName} ch${chapters.join(',')} (${allSrcVerses.length} src → ${allOsnb2Verses.length} osnb2)...`);

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
                reason: 'No match in osnb2',
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
          console.error(`    → AI matching failed: ${err.message}`);
          for (const d of group) {
            unmapped.push({
              bookId, chapter: d.chapter,
              reason: `AI matching failed: ${err.message}`,
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
        osnb2Count: d.osnb2Count,
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

main().catch(err => {
  console.error(err);
  process.exit(1);
});
