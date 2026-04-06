import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { KVNConverter } from '../src/kvn.js';
import { loadKvnMapping } from '../src/load-mapping.js';
import { getMaxVerse } from '../src/load-bible.js';
import { encode, decode, BOOK_IDS } from '../src/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LESETEKSTER_DIR = join(__dirname, '../../generate/dnk_lesetekster');

const mapping = loadKvnMapping();
const converter = new KVNConverter(mapping);

// Precompute translation max verse per chapter from osnb2 data + mapping
const translationMaxVerse = new Map<string, number>();
function getTranslationMaxVerse(book: number, chapter: number): number {
  const key = `${book}-${chapter}`;
  if (translationMaxVerse.has(key)) return translationMaxVerse.get(key)!;

  // Start with osnb2 max
  let max = getMaxVerse(book, chapter);

  // Check mapping for tkvn values in this chapter with higher verse numbers
  for (const [, tkvn] of mapping.map) {
    const d = decode(tkvn);
    if (d.book === book && d.chapter === chapter && d.verse > max) {
      max = d.verse;
    }
  }
  for (const [tkvn] of mapping.extraVerses) {
    const d = decode(tkvn);
    if (d.book === book && d.chapter === chapter && d.verse > max) {
      max = d.verse;
    }
  }

  translationMaxVerse.set(key, max);
  return max;
}

interface Reading {
  reference: string;
  title: string;
}

interface LeseDag {
  name: string;
  date: string;
  series: string;
  readings: Reading[];
}

/**
 * Extract the plain reference from a ref markup string.
 * "[ref:Rom 13,11-12@dnb2024|Rom 13,11–12]" -> "Rom 13,11-12"
 * "Rom 13,11–12" -> "Rom 13,11–12" (passthrough for plain refs)
 */
function extractRef(ref: string): string {
  // [ref:Rom 13,11-12@dnb2024|display] or [ref:Rom 13,11-12@dnb2024]
  const m = ref.match(/^\[ref:(.+?)(?:@[^\]|]+)?(?:\|[^\]]+)?\]$/);
  if (m) return m[1];
  return ref;
}

function loadAllReferences(): { ref: string; context: string }[] {
  const result: { ref: string; context: string }[] = [];
  const files = readdirSync(LESETEKSTER_DIR).filter(f => f.endsWith('.json')).sort();
  for (const file of files) {
    const data: LeseDag[] = JSON.parse(readFileSync(join(LESETEKSTER_DIR, file), 'utf-8'));
    for (const dag of data) {
      for (const reading of dag.readings) {
        result.push({ ref: extractRef(reading.reference), context: `${file}: ${dag.name}` });
      }
    }
  }
  return result;
}

function parseVNum(s: string): { verse: number; part: number } {
  const trimmed = s.trim();
  const match = trimmed.match(/^(\d+)([a-c])?$/);
  if (!match) throw new Error(`Invalid verse: ${trimmed}`);
  return {
    verse: parseInt(match[1]),
    part: match[2] ? match[2].charCodeAt(0) - 96 : 0,
  };
}

/**
 * Parse a single chapter,verseSpec into tkvn numbers.
 * Handles: "1–10", "1–4a", "1–2.22–31", "6b–8"
 */
function parseChapterVerses(book: number, chapter: number, verseSpec: string): number[] {
  const kvns: number[] = [];
  for (const segment of verseSpec.split('.')) {
    const rangeParts = segment.split(/[–-]/);
    if (rangeParts.length === 1) {
      const v = parseVNum(rangeParts[0]);
      kvns.push(encode(book, chapter, v.verse, v.part));
    } else {
      const start = parseVNum(rangeParts[0]);
      const end = parseVNum(rangeParts[1]);
      for (let v = start.verse; v <= end.verse; v++) {
        let p = 0;
        if (v === start.verse && start.part > 0) p = start.part;
        else if (v === end.verse && end.part > 0) p = end.part;
        kvns.push(encode(book, chapter, v, p));
      }
    }
  }
  return kvns;
}

/**
 * Parse a cross-chapter range like "26–2,2" (ch1 already known) or
 * full "18,24–19,7" into tkvn numbers.
 */
function parseCrossChapterRange(book: number, startCh: number, startVerse: string, endCh: number, endVerse: string): number[] {
  const kvns: number[] = [];
  const start = parseVNum(startVerse);
  const end = parseVNum(endVerse);

  for (let ch = startCh; ch <= endCh; ch++) {
    const vStart = ch === startCh ? start.verse : 1;
    const vEnd = ch === endCh ? end.verse : getTranslationMaxVerse(book, ch);
    for (let v = vStart; v <= vEnd; v++) {
      let p = 0;
      if (ch === startCh && v === start.verse && start.part > 0) p = start.part;
      else if (ch === endCh && v === end.verse && end.part > 0) p = end.part;
      kvns.push(encode(book, ch, v, p));
    }
  }
  return kvns;
}

/**
 * Parse a lesetekst reference into tkvn numbers (translation coordinates).
 *
 * Handles:
 * - Simple: "Matt 21,1–11"
 * - Sub-verse: "Hebr 6,13–19a", "Jes 9,1a.2.6–7"
 * - Dotted segments: "Fork 3,1–2.4–7.11a"
 * - Semicolon multi-chapter: "Apg 13,1–4;14,22–23"
 * - Cross-chapter ranges: "Joh 18,1–19,42", "1 Mos 1,26–2,2"
 * - "og/eller" alternatives: "Apg 17,22–25 og/eller 26–31"
 *
 * Throws on unparseable references.
 */
function parseLesetekstRef(ref: string): number[] | null {
  // Normalize "og/eller" (and/or) to dash — treat as full range
  ref = ref.replace(/\s+og\/eller\s+/g, '–');

  const parts = ref.split(';').map(s => s.trim());

  // Extract book name from first part
  const firstMatch = parts[0].match(/^(.+?)\s+(\d+),(.+)$/);
  if (!firstMatch) return null;
  const bookName = firstMatch[1];
  const book = BOOK_IDS[bookName];
  if (book === undefined) return null;

  const allKvns: number[] = [];

  for (let i = 0; i < parts.length; i++) {
    let chapterVerses: string;

    if (i === 0) {
      chapterVerses = `${firstMatch[2]},${firstMatch[3]}`;
    } else {
      chapterVerses = parts[i].trim();
    }

    // Parse chapter,verseSpec
    const m = chapterVerses.match(/^(\d+),(.+)$/);
    if (!m) return null;
    const chapter = parseInt(m[1]);
    const verseSpec = m[2];

    // Detect cross-chapter range: verseSpec like "24–19,7" or "26–2,2"
    const crossMatch = verseSpec.match(/^(\d+[a-c]?)\s*[–-]\s*(\d+),(\d+[a-c]?)$/);
    if (crossMatch) {
      allKvns.push(...parseCrossChapterRange(
        book, chapter, crossMatch[1], parseInt(crossMatch[2]), crossMatch[3]
      ));
      continue;
    }

    allKvns.push(...parseChapterVerses(book, chapter, verseSpec));
  }

  return allKvns;
}

const allRefs = loadAllReferences();

describe('lesetekster reference parsing', () => {
  it('loads all lesetekster files', () => {
    expect(allRefs.length).toBeGreaterThan(700);
  });

  it('all book names are recognized', () => {
    const unknownBooks: string[] = [];
    for (const { ref } of allRefs) {
      const match = ref.match(/^(.+?)\s+\d+,/);
      if (match) {
        const bookName = match[1];
        if (BOOK_IDS[bookName] === undefined) {
          unknownBooks.push(bookName);
        }
      }
    }
    const unique = [...new Set(unknownBooks)];
    expect(unique, `Unknown book names: ${unique.join(', ')}`).toEqual([]);
  });

  it('parses all references', () => {
    const failures: string[] = [];

    for (const { ref, context } of allRefs) {
      const result = parseLesetekstRef(ref);
      if (result === null || result.length === 0) {
        failures.push(`${context}: ${ref}`);
      }
    }

    expect(failures, `Failed to parse:\n${failures.join('\n')}`).toEqual([]);
  });
});

describe('lesetekster roundtrip (tkvn → kvn → tkvn)', () => {
  it('all parseable references roundtrip correctly', () => {
    const failures: string[] = [];
    let totalVerses = 0;
    let skippedExtra = 0;
    let skippedCollision = 0;

    for (const { ref, context } of allRefs) {
      const tkvns = parseLesetekstRef(ref);
      if (tkvns === null) continue;

      for (const tkvn of tkvns) {
        totalVerses++;

        if (converter.isExtra(tkvn)) {
          skippedExtra++;
          continue;
        }

        const kvn = converter.toKvn(tkvn);
        if (kvn === null) continue;

        if (converter.isCollision(kvn)) {
          skippedCollision++;
          continue;
        }

        const roundTrip = converter.toTkvn(kvn);
        if (roundTrip !== tkvn) {
          const d = decode(tkvn);
          failures.push(`${ref} (${context}): ${d.book}:${d.chapter}:${d.verse} — tkvn=${tkvn} → kvn=${kvn} → tkvn=${roundTrip}`);
        }
      }
    }

    expect(failures).toEqual([]);
  });
});
