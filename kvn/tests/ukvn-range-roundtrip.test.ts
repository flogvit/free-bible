import { describe, it, expect } from 'vitest';
import { UkvnMapper } from '../src/ukvn-mapper.js';
import { CrossMapper } from '../src/ukvn-cross-mapper.js';
import { loadUkvnMapping } from '../src/ukvn-loader.js';
import { ukvnEncode, ukvnDecode, ukvnFormat } from '../src/ukvn-types.js';
import { parseRef } from '../src/kvn.js';
import { BOOK_IDS, BOOK_NAMES } from '../src/types.js';

// --- Helpers ---

interface MappedVerse {
  book: number;
  chapter: number;
  verse: number;
  part: number;
}

/**
 * Map a full reference string from one translation through osmain to another.
 * Returns the mapped verses grouped by chapter.
 */
function mapReference(
  ref: string,
  sourceMapper: UkvnMapper,
  targetMapper: UkvnMapper,
): MappedVerse[] {
  const verses = parseRef(ref);
  const cross = new CrossMapper(sourceMapper, targetMapper);
  return verses.map(v => {
    const tkvn = ukvnEncode(v.book, v.chapter, v.verse, v.part);
    const result = cross.map(tkvn);
    return ukvnDecode(result.tkvn);
  });
}

/**
 * Format mapped verses as a compact reference string.
 * Groups consecutive verses and handles cross-chapter ranges.
 * E.g., [{ch:1,v:17},{ch:2,v:1},{ch:2,v:2}] -> "1:17;2:1-2"
 */
function formatMappedRef(bookId: number, verses: MappedVerse[]): string {
  if (verses.length === 0) return '';

  const bookName = BOOK_NAMES[bookId] || String(bookId);
  const groups: { chapter: number; ranges: string[] }[] = [];

  let currentCh = -1;
  let rangeStart = -1;
  let rangeStartPart = 0;
  let rangeEnd = -1;
  let rangeEndPart = 0;

  function flushRange() {
    if (rangeStart < 0) return;
    const group = groups.find(g => g.chapter === currentCh) || (() => {
      const g = { chapter: currentCh, ranges: [] as string[] };
      groups.push(g);
      return g;
    })();
    const startSuffix = rangeStartPart > 0 ? String.fromCharCode(96 + rangeStartPart) : '';
    const endSuffix = rangeEndPart > 0 ? String.fromCharCode(96 + rangeEndPart) : '';
    if (rangeStart === rangeEnd && rangeStartPart === rangeEndPart) {
      group.ranges.push(`${rangeStart}${startSuffix}`);
    } else {
      group.ranges.push(`${rangeStart}${startSuffix}-${rangeEnd}${endSuffix}`);
    }
  }

  for (const v of verses) {
    if (v.chapter !== currentCh) {
      flushRange();
      currentCh = v.chapter;
      rangeStart = v.verse;
      rangeStartPart = v.part;
      rangeEnd = v.verse;
      rangeEndPart = v.part;
    } else if (v.verse === rangeEnd + 1 && v.part === 0 && rangeEndPart === 0) {
      rangeEnd = v.verse;
      rangeEndPart = v.part;
    } else if (v.verse === rangeEnd && v.part > rangeEndPart) {
      rangeEndPart = v.part;
    } else {
      flushRange();
      rangeStart = v.verse;
      rangeStartPart = v.part;
      rangeEnd = v.verse;
      rangeEndPart = v.part;
    }
  }
  flushRange();

  const parts = groups.map(g => `${g.chapter},${g.ranges.join('.')}`);
  return `${bookName} ${parts.join(';')}`;
}

// --- Setup ---

const dnb2024 = new UkvnMapper(loadUkvnMapping('dnb2024'));
const osnb = new UkvnMapper(loadUkvnMapping('osnb'));

// Build an osmain identity mapper (no mapping = identity for everything)
const osmainMapper = new UkvnMapper({ version: 2, system: 'osmain', name: 'osmain',
  encoding: { partSize: 16, maxVerse: 177, maxChapter: 151 },
  bookNames: loadUkvnMapping('osnb').bookNames, stats: {}, map: [] });

// --- Tests ---

describe('Range round-trip: dnb2024 -> osmain -> dnb2024', () => {

  function testRangeRoundTrip(ref: string, expectedOsmain?: string) {
    // Parse dnb2024 reference
    const verses = parseRef(ref);
    const bookId = verses[0].book;

    // dnb2024 -> osmain
    const osmainVs = mapReference(ref, dnb2024, osmainMapper);
    const osmainRef = formatMappedRef(bookId, osmainVs);

    // osmain -> dnb2024
    const backVs: MappedVerse[] = osmainVs.map(v => {
      const kvn = ukvnEncode(v.book, v.chapter, v.verse, v.part);
      const tkvn = dnb2024.toTkvn(kvn);
      return ukvnDecode(tkvn);
    });
    const backRef = formatMappedRef(bookId, backVs);

    if (expectedOsmain) {
      expect(osmainRef).toBe(expectedOsmain);
    }
    expect(backRef).toBe(ref);
  }

  it('Jona 2,1-11 crosses osmain chapter boundary', () => {
    testRangeRoundTrip('Jona 2,1-11', 'Jona 1,17;2,1-10');
  });

  it('Jes 9,1a.2.6-7 with parts and gaps', () => {
    testRangeRoundTrip('Jes 9,1a.2.6-7');
  });

  // osmain laa ombrutt her fram til 2026-07-28 (dens 9,1 var europeisk 9,2 og
  // 9,21 var 9,1). Den foelger naa europeisk rekkefolge, som dnb2024_nb.
  it('Jes 9,1-7 uten ombryting', () => {
    testRangeRoundTrip('Jes 9,1-7', 'Jes 9,1-7');
  });

  it('Joel 3,1-5 crosses osmain chapter', () => {
    testRangeRoundTrip('Joel 3,1-5');
  });

  it('1 Mos 31,55 single boundary verse', () => {
    testRangeRoundTrip('1 Mos 31,55');
  });

  it('Salme 46,2-12 with psalm header shift', () => {
    testRangeRoundTrip('Sal 46,2-12');
  });

  it('Job 40,1-19 remapped from osmain 40:6-24', () => {
    testRangeRoundTrip('Job 40,1-19');
  });

  it('Job 40,20-28 crosses osmain chapter (41:27-34 + 41:1)', () => {
    testRangeRoundTrip('Job 40,20-28');
  });

  it('simple identity range (Joh 3,16-17)', () => {
    testRangeRoundTrip('Joh 3,16-17', 'Joh 3,16-17');
  });

  it('simple identity range (1 Mos 1,1-5)', () => {
    testRangeRoundTrip('1 Mos 1,1-5', '1 Mos 1,1-5');
  });

  it('Rom 13,11-12 from lesetekster', () => {
    testRangeRoundTrip('Rom 13,11-12', 'Rom 13,11-12');
  });
});

describe('Range conversion shows correct osmain chapters', () => {
  it('Jona 2,1 maps to osmain chapter 1, not 2', () => {
    const vs = mapReference('Jona 2,1', dnb2024, osmainMapper);
    expect(vs[0].chapter).toBe(1);
    expect(vs[0].verse).toBe(17);
  });

  it('Jona 2,2-11 maps to osmain chapter 2', () => {
    const vs = mapReference('Jona 2,2-11', dnb2024, osmainMapper);
    for (const v of vs) {
      expect(v.chapter).toBe(2);
    }
  });

  // dnb2024_nb samler europeisk 2,28-32 og 3,1-21 i ett kapittel 3 paa 26 vers,
  // saa dens 3,1-5 er osmain 2,28-32 — ikke kapittel 3.
  it('Joel 3,1-5 maps to osmain chapter 2', () => {
    const vs = mapReference('Joel 3,1-5', dnb2024, osmainMapper);
    for (const v of vs) {
      expect(v.chapter).toBe(2);
    }
  });

  it('Joel 3,6-26 maps to osmain chapter 3', () => {
    const vs = mapReference('Joel 3,6-26', dnb2024, osmainMapper);
    for (const v of vs) {
      expect(v.chapter).toBe(3);
    }
  });

  it('Job 39,34 maps to osmain 40:1', () => {
    const vs = mapReference('Job 39,34', dnb2024, osmainMapper);
    expect(vs[0].chapter).toBe(40);
    expect(vs[0].verse).toBe(1);
  });
});
