import { describe, it, expect } from 'vitest';
import { KVNConverter, parseRef, refsToKvn } from '../src/kvn.js';
import { loadKvnMapping } from '../src/load-mapping.js';
import { verseExists, getMaxVerse, getChapterCount } from '../src/load-bible.js';
import { encode, decode } from '../src/types.js';

const mapping = loadKvnMapping();
const converter = new KVNConverter(mapping);

function roundTrip(kvn: number): number | null {
  const tkvn = converter.toTkvn(kvn);
  return converter.toKvn(tkvn);
}

/**
 * Test that all verses in a reference can be converted to tkvn and back.
 * Skips collision verses (identity position occupied by another mapping).
 */
function testRef(ref: string) {
  const refs = parseRef(ref);
  const kvns = refsToKvn(refs);

  for (const kvn of kvns) {
    const d = decode(kvn);
    expect(verseExists(d.book, d.chapter, d.verse),
      `${ref}: osnb ${d.book}:${d.chapter}:${d.verse} should exist in source`
    ).toBe(true);

    if (converter.isCollision(kvn)) continue;

    const result = roundTrip(kvn);
    expect(result,
      `${ref}: roundtrip failed for ${d.book}:${d.chapter}:${d.verse}`
    ).toBe(kvn);
  }
}

describe('well-known references roundtrip', () => {
  it('Ordsp 8,1-2.22-31', () => testRef('Ordsp 8,1-2.22-31'));
  it('1 Mos 1,1-31', () => testRef('1 Mos 1,1-31'));
  it('Sal 23,1-6', () => testRef('Sal 23,1-6'));
  it('Jes 53,1-12', () => testRef('Jes 53,1-12'));
  it('Joh 3,16-21', () => testRef('Joh 3,16-21'));
  it('Rom 8,28-39', () => testRef('Rom 8,28-39'));
  it('1 Kor 13,1-13', () => testRef('1 Kor 13,1-13'));
  it('Åp 21,1-8', () => testRef('Åp 21,1-8'));
});

describe('references near numbering boundaries', () => {
  it('2 Mos 7,20-25', () => testRef('2 Mos 7,20-25'));
  it('2 Mos 8,1-10', () => testRef('2 Mos 8,1-10'));
  it('1 Mos 31,50-54', () => testRef('1 Mos 31,50-54'));
  it('1 Mos 32,1-10', () => testRef('1 Mos 32,1-10'));
  it('Neh 4,1-10', () => testRef('Neh 4,1-10'));
  it('5 Mos 29,1-10', () => testRef('5 Mos 29,1-10'));
  it('Neh 7,66-67.69-72', () => testRef('Neh 7,66-67.69-72'));
  it('Dan 4,1-10', () => testRef('Dan 4,1-10'));
  it('1 Krøn 6,1-20', () => testRef('1 Krøn 6,1-20'));
  it('1 Krøn 6,50-66', () => testRef('1 Krøn 6,50-66'));
  it('Job 39,1-10', () => testRef('Job 39,1-10'));
  it('2 Mos 22,1-10', () => testRef('2 Mos 22,1-10'));
  it('Esek 21,1-10', () => testRef('Esek 21,1-10'));
});

describe('complete chapter roundtrips (excluding collision verses)', () => {
  function chapterRoundtrip(book: number, chapter: number) {
    const maxV = getMaxVerse(book, chapter);
    const failures: string[] = [];
    for (let v = 1; v <= maxV; v++) {
      const kvn = encode(book, chapter, v);
      if (converter.isCollision(kvn)) continue;

      const result = roundTrip(kvn);
      if (result !== kvn) {
        failures.push(`${book}:${chapter}:${v}`);
      }
    }
    expect(failures, `Failed roundtrips: ${failures.join(', ')}`).toEqual([]);
  }

  it('2 Mos 8', () => chapterRoundtrip(2, 8));
  it('1 Mos 32', () => chapterRoundtrip(1, 32));
  it('1 Krøn 6', () => chapterRoundtrip(13, 6));
  it('Dan 4', () => chapterRoundtrip(27, 4));
  it('Neh 4', () => chapterRoundtrip(16, 4));
  it('Mal 3', () => chapterRoundtrip(39, 3));
  it('Neh 7', () => chapterRoundtrip(16, 7));
  it('Job 39', () => chapterRoundtrip(18, 39));
});
