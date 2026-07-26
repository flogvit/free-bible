import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { UkvnMapper } from '../src/ukvn-mapper.js';
import { CrossMapper } from '../src/ukvn-cross-mapper.js';
import { loadUkvnMapping } from '../src/ukvn-loader.js';
import { ukvnEncode, ukvnDecode, ukvnFormat } from '../src/ukvn-types.js';

// --- Parse lesetekster references ---

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
  'Flp': 50, 'Fil': 50, 'Kol': 51, '1 Tess': 52, '2 Tess': 53,
  '1 Tim': 54, '2 Tim': 55, 'Tit': 56, 'Filem': 57, 'Hebr': 58,
  'Jak': 59, '1 Pet': 60, '2 Pet': 61, '1 Joh': 62, '2 Joh': 63,
  '3 Joh': 64, 'Jud': 65, 'Åp': 66,
  'Salme': 19, 'Amos': 30, 'Mika': 33, 'Høys': 22,
};

interface VerseRef {
  book: number;
  chapter: number;
  verse: number;
  part: number;
  label: string;
}

/**
 * Expand a verse spec like "1a.2.6-7" into individual verse refs.
 * Handles: single (3), range (1-10), part (1a, 19a), dot-separated (1a.2.6-7)
 */
function expandVerseSpec(bookId: number, chapter: number, spec: string, bookName: string): VerseRef[] {
  const refs: VerseRef[] = [];

  // Split on dots for compound specs like "1a.2.6-7"
  const segments = spec.split('.');

  for (const seg of segments) {
    // Range like "6-7" or "13-19a"
    const rangeMatch = seg.match(/^(\d+)([a-c])?[-–](\d+)([a-c])?$/);
    if (rangeMatch) {
      const startV = parseInt(rangeMatch[1]);
      const startP = rangeMatch[2] ? rangeMatch[2].charCodeAt(0) - 96 : 0;
      const endV = parseInt(rangeMatch[3]);
      const endP = rangeMatch[4] ? rangeMatch[4].charCodeAt(0) - 96 : 0;

      // Start verse (with part if specified)
      refs.push({
        book: bookId, chapter, verse: startV, part: startP,
        label: `${bookName} ${chapter},${startV}${startP ? String.fromCharCode(96 + startP) : ''}`
      });

      // Middle verses (whole verses)
      for (let v = startV + 1; v < endV; v++) {
        refs.push({
          book: bookId, chapter, verse: v, part: 0,
          label: `${bookName} ${chapter},${v}`
        });
      }

      // End verse (with part if specified, only if different from start)
      if (endV > startV) {
        refs.push({
          book: bookId, chapter, verse: endV, part: endP,
          label: `${bookName} ${chapter},${endV}${endP ? String.fromCharCode(96 + endP) : ''}`
        });
      }
      continue;
    }

    // Single verse like "2" or "1a"
    const singleMatch = seg.match(/^(\d+)([a-c])?$/);
    if (singleMatch) {
      const v = parseInt(singleMatch[1]);
      const p = singleMatch[2] ? singleMatch[2].charCodeAt(0) - 96 : 0;
      refs.push({
        book: bookId, chapter, verse: v, part: p,
        label: `${bookName} ${chapter},${v}${p ? String.fromCharCode(96 + p) : ''}`
      });
    }
  }

  return refs;
}

/**
 * Parse "[ref:Jes 9,1a.2.6-7@dnb2024]" into individual verse refs.
 */
function parseLesetekstRef(ref: string): VerseRef[] {
  const m = ref.match(/^\[ref:(.+?)@(\w+)\]$/);
  if (!m) return [];

  const refPart = m[1].trim();

  // Split book from chapter,verse
  const match = refPart.match(/^(.+?)\s+(\d.*)$/);
  if (!match) return [];

  const bookName = match[1].trim();
  const bookId = BOOK_IDS[bookName];
  if (!bookId) return [];

  const chapterVerse = match[2].trim();

  // Handle cross-chapter ranges like "1,26-2,2" (not common in lesetekster but possible)
  // For now, handle simple "chapter,versespec"
  const commaIdx = chapterVerse.indexOf(',');
  if (commaIdx === -1) return []; // whole chapter, skip

  const chapter = parseInt(chapterVerse.slice(0, commaIdx));
  const verseSpec = chapterVerse.slice(commaIdx + 1);

  return expandVerseSpec(bookId, chapter, verseSpec, bookName);
}

// --- Load lesetekster ---

interface LesetekstPart {
  refs: string[];
  title: string;
}
interface LesetekstOption { parts: LesetekstPart[]; }
interface LesetekstSlot { options: LesetekstOption[]; }
interface LesetekstEntry {
  name: string;
  slots: LesetekstSlot[];
}

function loadAllLesetekster(): { ref: string; context: string }[] {
  const dir = join(__dirname, '../../generate/dnk_lesetekster');
  const files = readdirSync(dir).filter(f => f.endsWith('.json'));
  const all: { ref: string; context: string }[] = [];

  for (const file of files) {
    const data: LesetekstEntry[] = JSON.parse(readFileSync(join(dir, file), 'utf-8'));
    for (const entry of data) {
      for (const slot of entry.slots) {
        for (const option of slot.options) {
          for (const part of option.parts) {
            for (const ref of part.refs) {
              all.push({ ref, context: `${entry.name} - ${part.title} (${file})` });
            }
          }
        }
      }
    }
  }

  return all;
}

// --- Tests ---

const dnb2024Mapping = loadUkvnMapping('dnb2024');
const osnbMapping = loadUkvnMapping('osnb');
const dnb2024 = new UkvnMapper(dnb2024Mapping);
const osnb = new UkvnMapper(osnbMapping);
const toOsnb2 = new CrossMapper(dnb2024, osnb);
const toDnb2024 = new CrossMapper(osnb, dnb2024);

const osnbNames: Record<number, string> = {};
for (const [name, id] of Object.entries(osnbMapping.bookNames)) {
  if (!osnbNames[id as number]) osnbNames[id as number] = name;
}

// Collect all unique verses from lesetekster
const allLesetekster = loadAllLesetekster();
const allVerseRefs: { verse: VerseRef; context: string }[] = [];
const seen = new Set<string>();

for (const { ref, context } of allLesetekster) {
  const verses = parseLesetekstRef(ref);
  for (const v of verses) {
    const key = `${v.book}:${v.chapter}:${v.verse}:${v.part}`;
    if (!seen.has(key)) {
      seen.add(key);
      allVerseRefs.push({ verse: v, context });
    }
  }
}

describe(`Lesetekster round-trip: dnb2024 -> osnb -> dnb2024 (${allVerseRefs.length} unique verses)`, () => {
  it('has lesetekster to test', () => {
    expect(allVerseRefs.length).toBeGreaterThan(100);
  });

  // Group by book for readable output
  const byBook = new Map<number, { verse: VerseRef; context: string }[]>();
  for (const entry of allVerseRefs) {
    const list = byBook.get(entry.verse.book) || [];
    list.push(entry);
    byBook.set(entry.verse.book, list);
  }

  for (const [bookId, entries] of byBook) {
    const bookName = Object.entries(BOOK_IDS).find(([, id]) => id === bookId)?.[0] || String(bookId);

    describe(bookName, () => {
      const testCases = entries.map(e => ({
        name: e.verse.label,
        ...e.verse,
      }));

      it.each(testCases)('$name round-trips', ({ book, chapter, verse, part }) => {
        const tkvn = ukvnEncode(book, chapter, verse, part);
        const mapped = toOsnb2.map(tkvn);
        const back = toDnb2024.map(mapped.tkvn);
        expect(back.tkvn).toBe(tkvn);
      });
    });
  }
});

describe('Composite reference tests (full lesetekst references)', () => {
  const compositeRefs = [
    '[ref:Jes 9,1a.2.6-7@dnb2024]',
    '[ref:Salme 24,1-10@dnb2024]',
    '[ref:Rom 13,11-12@dnb2024]',
    '[ref:1 Mos 1,1-5@dnb2024]',
    '[ref:Joh 1,1-14@dnb2024]',
    '[ref:Hebr 1,1-6@dnb2024]',
    '[ref:Apg 2,1-11@dnb2024]',
  ];

  for (const ref of compositeRefs) {
    describe(ref, () => {
      const verses = parseLesetekstRef(ref);

      it('parses into multiple verses', () => {
        expect(verses.length).toBeGreaterThan(0);
      });

      it.each(verses.map(v => ({ name: v.label, ...v })))(
        '$name round-trips through osnb',
        ({ book, chapter, verse, part }) => {
          const tkvn = ukvnEncode(book, chapter, verse, part);
          const mapped = toOsnb2.map(tkvn);
          const back = toDnb2024.map(mapped.tkvn);
          expect(back.tkvn).toBe(tkvn);
        }
      );
    });
  }
});
