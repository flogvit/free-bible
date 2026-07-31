import { describe, it, expect } from 'bun:test';
import { KVNConverter, parseRef, refsToKvn, kvnToRefs, formatRefs } from '../src/kvn.js';
import { loadKvnMapping, listMappingSystems } from '../src/load-mapping.js';
import { getMaxVerse } from '../src/load-bible.js';
import { encode, decode, BOOK_IDS, BOOK_NAMES } from '../src/types.js';
import type { MaxVerseProvider } from '../src/types.js';

const mapping = loadKvnMapping();
const converter = new KVNConverter(mapping);

// MaxVerseProvider using osnb data (basis coordinates)
const osnbMaxVerse: MaxVerseProvider = (book, chapter) => getMaxVerse(book, chapter);

// ============================================================
// BOOK_NAMES bugfix verification
// ============================================================

describe('BOOK_NAMES alias-bug fix', () => {
  it('uses primary names, not aliases', () => {
    expect(BOOK_NAMES[19]).toBe('Sal');    // not 'Salme'
    expect(BOOK_NAMES[30]).toBe('Am');     // not 'Amos'
    expect(BOOK_NAMES[33]).toBe('Mi');     // not 'Mika'
    expect(BOOK_NAMES[22]).toBe('Høgs');   // not 'Høys'
    expect(BOOK_NAMES[50]).toBe('Flp');    // not 'Fil'
  });

  it('aliases still resolve in BOOK_IDS', () => {
    expect(BOOK_IDS['Salme']).toBe(19);
    expect(BOOK_IDS['Amos']).toBe(30);
    expect(BOOK_IDS['Mika']).toBe(33);
    expect(BOOK_IDS['Høys']).toBe(22);
    expect(BOOK_IDS['Fil']).toBe(50);
  });
});

// ============================================================
// Simple references (regression)
// ============================================================

describe('parseRef simple (regression)', () => {
  it('Joh 3,16', () => {
    const refs = parseRef('Joh 3,16');
    expect(refs).toEqual([{ book: 43, chapter: 3, verse: 16, part: 0 }]);
  });

  it('Sal 23,1-6', () => {
    const refs = parseRef('Sal 23,1-6');
    expect(refs).toHaveLength(6);
    expect(refs[0]).toEqual({ book: 19, chapter: 23, verse: 1, part: 0 });
    expect(refs[5]).toEqual({ book: 19, chapter: 23, verse: 6, part: 0 });
  });

  it('Ordsp 8,1-2.22-31', () => {
    const refs = parseRef('Ordsp 8,1-2.22-31');
    expect(refs).toHaveLength(12); // 2 + 10
    expect(refs[0]).toEqual({ book: 20, chapter: 8, verse: 1, part: 0 });
    expect(refs[1]).toEqual({ book: 20, chapter: 8, verse: 2, part: 0 });
    expect(refs[2]).toEqual({ book: 20, chapter: 8, verse: 22, part: 0 });
    expect(refs[11]).toEqual({ book: 20, chapter: 8, verse: 31, part: 0 });
  });
});

// ============================================================
// Sub-verse references
// ============================================================

describe('parseRef sub-verse', () => {
  it('Mika 5,1–4a', () => {
    const refs = parseRef('Mika 5,1–4a');
    expect(refs).toHaveLength(4);
    expect(refs[0]).toEqual({ book: 33, chapter: 5, verse: 1, part: 0 });
    expect(refs[3]).toEqual({ book: 33, chapter: 5, verse: 4, part: 1 }); // 4a
  });

  it('Jes 9,1a.2.6–7', () => {
    const refs = parseRef('Jes 9,1a.2.6–7');
    expect(refs).toHaveLength(4);
    expect(refs[0]).toEqual({ book: 23, chapter: 9, verse: 1, part: 1 }); // 1a
    expect(refs[1]).toEqual({ book: 23, chapter: 9, verse: 2, part: 0 });
    expect(refs[2]).toEqual({ book: 23, chapter: 9, verse: 6, part: 0 });
    expect(refs[3]).toEqual({ book: 23, chapter: 9, verse: 7, part: 0 });
  });

  it('1 Kor 5,6b–8', () => {
    const refs = parseRef('1 Kor 5,6b–8');
    expect(refs).toHaveLength(3);
    expect(refs[0]).toEqual({ book: 46, chapter: 5, verse: 6, part: 2 }); // 6b
    expect(refs[1]).toEqual({ book: 46, chapter: 5, verse: 7, part: 0 });
    expect(refs[2]).toEqual({ book: 46, chapter: 5, verse: 8, part: 0 });
  });

  it('Fork 3,1–2.4–7.11a', () => {
    const refs = parseRef('Fork 3,1–2.4–7.11a');
    expect(refs).toHaveLength(7); // 2 + 4 + 1
    expect(refs[0].verse).toBe(1);
    expect(refs[1].verse).toBe(2);
    expect(refs[2].verse).toBe(4);
    expect(refs[5].verse).toBe(7);
    expect(refs[6]).toEqual({ book: 21, chapter: 3, verse: 11, part: 1 }); // 11a
  });
});

// ============================================================
// Cross-chapter ranges (new)
// ============================================================

describe('parseRef cross-chapter', () => {
  it('Joh 18,1–19,42', () => {
    const refs = parseRef('Joh 18,1–19,42', { maxVerse: osnbMaxVerse });
    // Joh 18 has 40 verses, Joh 19 has 42
    expect(refs).toHaveLength(40 + 42);
    expect(refs[0]).toEqual({ book: 43, chapter: 18, verse: 1, part: 0 });
    expect(refs[39]).toEqual({ book: 43, chapter: 18, verse: 40, part: 0 });
    expect(refs[40]).toEqual({ book: 43, chapter: 19, verse: 1, part: 0 });
    expect(refs[refs.length - 1]).toEqual({ book: 43, chapter: 19, verse: 42, part: 0 });
  });

  it('1 Mos 1,26–2,2', () => {
    const refs = parseRef('1 Mos 1,26–2,2', { maxVerse: osnbMaxVerse });
    // 1 Mos 1 has 31 verses, so 26-31 = 6, plus 2:1-2 = 2
    expect(refs).toHaveLength(6 + 2);
    expect(refs[0]).toEqual({ book: 1, chapter: 1, verse: 26, part: 0 });
    expect(refs[5]).toEqual({ book: 1, chapter: 1, verse: 31, part: 0 });
    expect(refs[6]).toEqual({ book: 1, chapter: 2, verse: 1, part: 0 });
    expect(refs[7]).toEqual({ book: 1, chapter: 2, verse: 2, part: 0 });
  });

  it('1 Pet 3,18–4,2', () => {
    const refs = parseRef('1 Pet 3,18–4,2', { maxVerse: osnbMaxVerse });
    // 1 Pet 3 has 22 verses: 18-22 = 5, plus 4:1-2 = 2
    expect(refs).toHaveLength(5 + 2);
    expect(refs[0]).toEqual({ book: 60, chapter: 3, verse: 18, part: 0 });
    expect(refs[4]).toEqual({ book: 60, chapter: 3, verse: 22, part: 0 });
    expect(refs[5]).toEqual({ book: 60, chapter: 4, verse: 1, part: 0 });
    expect(refs[6]).toEqual({ book: 60, chapter: 4, verse: 2, part: 0 });
  });

  it('Jes 8,23b–9,6', () => {
    const refs = parseRef('Jes 8,23b–9,6', { maxVerse: osnbMaxVerse });
    // Jes 8 has 23 verses: 23b only = 1, plus 9:1-6 = 6
    expect(refs).toHaveLength(1 + 6);
    expect(refs[0]).toEqual({ book: 23, chapter: 8, verse: 23, part: 2 }); // 23b
    expect(refs[1]).toEqual({ book: 23, chapter: 9, verse: 1, part: 0 });
    expect(refs[6]).toEqual({ book: 23, chapter: 9, verse: 6, part: 0 });
  });

  it('throws without maxVerse callback', () => {
    expect(() => parseRef('Joh 18,1–19,42')).toThrow('Cross-chapter range requires maxVerse callback');
  });
});

// ============================================================
// Semicolon multi-chapter (new)
// ============================================================

describe('parseRef semicolon multi-chapter', () => {
  it('Apg 13,1–4;14,22–23', () => {
    const refs = parseRef('Apg 13,1–4;14,22–23');
    expect(refs).toHaveLength(4 + 2);
    expect(refs[0]).toEqual({ book: 44, chapter: 13, verse: 1, part: 0 });
    expect(refs[3]).toEqual({ book: 44, chapter: 13, verse: 4, part: 0 });
    expect(refs[4]).toEqual({ book: 44, chapter: 14, verse: 22, part: 0 });
    expect(refs[5]).toEqual({ book: 44, chapter: 14, verse: 23, part: 0 });
  });

  it('1 Mos 2,8–9;3,1–8', () => {
    const refs = parseRef('1 Mos 2,8–9;3,1–8');
    expect(refs).toHaveLength(2 + 8);
    expect(refs[0]).toEqual({ book: 1, chapter: 2, verse: 8, part: 0 });
    expect(refs[1]).toEqual({ book: 1, chapter: 2, verse: 9, part: 0 });
    expect(refs[2]).toEqual({ book: 1, chapter: 3, verse: 1, part: 0 });
    expect(refs[9]).toEqual({ book: 1, chapter: 3, verse: 8, part: 0 });
  });

  it('2 Tim 1,1–5;3,14–17', () => {
    const refs = parseRef('2 Tim 1,1–5;3,14–17');
    expect(refs).toHaveLength(5 + 4);
    expect(refs[0]).toEqual({ book: 55, chapter: 1, verse: 1, part: 0 });
    expect(refs[4]).toEqual({ book: 55, chapter: 1, verse: 5, part: 0 });
    expect(refs[5]).toEqual({ book: 55, chapter: 3, verse: 14, part: 0 });
    expect(refs[8]).toEqual({ book: 55, chapter: 3, verse: 17, part: 0 });
  });

  it('three chapters: Jes 40,1–8;42,1–4;49,1–6', () => {
    const refs = parseRef('Jes 40,1–8;42,1–4;49,1–6');
    expect(refs).toHaveLength(8 + 4 + 6);
    expect(refs[0]).toEqual({ book: 23, chapter: 40, verse: 1, part: 0 });
    expect(refs[7]).toEqual({ book: 23, chapter: 40, verse: 8, part: 0 });
    expect(refs[8]).toEqual({ book: 23, chapter: 42, verse: 1, part: 0 });
    expect(refs[11]).toEqual({ book: 23, chapter: 42, verse: 4, part: 0 });
    expect(refs[12]).toEqual({ book: 23, chapter: 49, verse: 1, part: 0 });
    expect(refs[17]).toEqual({ book: 23, chapter: 49, verse: 6, part: 0 });
  });
});

// ============================================================
// og/eller normalization (new)
// ============================================================

describe('parseRef og/eller', () => {
  it('Apg 17,22–25 og/eller 26–31', () => {
    const refs = parseRef('Apg 17,22–25 og/eller 26–31');
    expect(refs).toHaveLength(10); // 22–31
    expect(refs[0]).toEqual({ book: 44, chapter: 17, verse: 22, part: 0 });
    expect(refs[9]).toEqual({ book: 44, chapter: 17, verse: 31, part: 0 });
  });

  it('Joh 11,17–29 og/eller 30–46', () => {
    const refs = parseRef('Joh 11,17–29 og/eller 30–46');
    expect(refs).toHaveLength(30); // 17–46
    expect(refs[0]).toEqual({ book: 43, chapter: 11, verse: 17, part: 0 });
    expect(refs[29]).toEqual({ book: 43, chapter: 11, verse: 46, part: 0 });
  });
});

// ============================================================
// Combinations (new)
// ============================================================

describe('parseRef combinations', () => {
  it('cross-chapter + sub-vers: Jes 8,23b–9,6', () => {
    const refs = parseRef('Jes 8,23b–9,6', { maxVerse: osnbMaxVerse });
    expect(refs[0]).toEqual({ book: 23, chapter: 8, verse: 23, part: 2 });
    expect(refs[refs.length - 1]).toEqual({ book: 23, chapter: 9, verse: 6, part: 0 });
  });

  it('semicolon + dotted: Sal 118,1–2.19–29;22,1–5', () => {
    const refs = parseRef('Sal 118,1–2.19–29;22,1–5');
    // 118: 1-2 (2) + 19-29 (11) = 13, plus 22: 1-5 (5) = 18
    expect(refs).toHaveLength(13 + 5);
    expect(refs[0]).toEqual({ book: 19, chapter: 118, verse: 1, part: 0 });
    expect(refs[1]).toEqual({ book: 19, chapter: 118, verse: 2, part: 0 });
    expect(refs[2]).toEqual({ book: 19, chapter: 118, verse: 19, part: 0 });
    expect(refs[12]).toEqual({ book: 19, chapter: 118, verse: 29, part: 0 });
    expect(refs[13]).toEqual({ book: 19, chapter: 22, verse: 1, part: 0 });
    expect(refs[17]).toEqual({ book: 19, chapter: 22, verse: 5, part: 0 });
  });

  it('semicolon + cross-chapter: Matt 26,30–27,50;28,1–10', () => {
    const refs = parseRef('Matt 26,30–27,50;28,1–10', { maxVerse: osnbMaxVerse });
    // Matt 26 has: use osnb max for 26
    const matt26max = getMaxVerse(40, 26);
    const expectedPart1 = (matt26max - 30 + 1) + 50; // 26:30-max + 27:1-50
    expect(refs[0]).toEqual({ book: 40, chapter: 26, verse: 30, part: 0 });
    expect(refs[expectedPart1]).toEqual({ book: 40, chapter: 28, verse: 1, part: 0 });
    expect(refs[refs.length - 1]).toEqual({ book: 40, chapter: 28, verse: 10, part: 0 });
  });
});

// ============================================================
// Edge cases
// ============================================================

describe('parseRef edge cases', () => {
  it('single verse', () => {
    const refs = parseRef('1 Mos 1,1');
    expect(refs).toHaveLength(1);
    expect(refs[0]).toEqual({ book: 1, chapter: 1, verse: 1, part: 0 });
  });

  it('invalid reference throws', () => {
    expect(() => parseRef('FooBar 1,1')).toThrow('Unknown book');
    expect(() => parseRef('invalid')).toThrow('Invalid reference');
  });

  it('alias book names work', () => {
    const refs = parseRef('Salme 23,1');
    expect(refs[0].book).toBe(19);
  });
});

// ============================================================
// formatRefs tests
// ============================================================

describe('formatRefs', () => {
  it('simple single-chapter', () => {
    const kvns = refsToKvn(parseRef('Joh 3,16-21'));
    expect(formatRefs(kvns)).toBe('Joh 3,16–21');
  });

  it('dotted segments', () => {
    const kvns = refsToKvn(parseRef('Ordsp 8,1-2.22-31'));
    expect(formatRefs(kvns)).toBe('Ordsp 8,1–2.22–31');
  });

  it('multi-chapter same book', () => {
    const kvns = refsToKvn(parseRef('Apg 13,1–4;14,22–23'));
    expect(formatRefs(kvns)).toBe('Apg 13,1–4; 14,22–23');
  });

  it('multi-book output', () => {
    // Build refs from two different books
    const refs1 = parseRef('1 Mos 50,1-3');
    const refs2 = parseRef('2 Mos 1,1-3');
    const kvns = [...refsToKvn(refs1), ...refsToKvn(refs2)];
    expect(formatRefs(kvns)).toBe('1 Mos 50,1–3; 2 Mos 1,1–3');
  });

  it('empty returns empty string', () => {
    expect(formatRefs([])).toBe('');
  });

  it('uses primary book name (not alias)', () => {
    const kvns = refsToKvn(parseRef('Salme 23,1-6'));
    // formatRefs should use 'Sal' not 'Salme'
    expect(formatRefs(kvns)).toBe('Sal 23,1–6');
  });

  it('roundtrip parse→format→parse for simple refs', () => {
    const testRefs = [
      'Joh 3,16',
      'Sal 23,1-6',
      '1 Mos 1,1-31',
      'Ordsp 8,1-2.22-31',
    ];
    for (const ref of testRefs) {
      const kvns = refsToKvn(parseRef(ref));
      const formatted = formatRefs(kvns);
      const reparsed = refsToKvn(parseRef(formatted));
      expect(reparsed, `roundtrip failed for ${ref} → ${formatted}`).toEqual(kvns);
    }
  });
});

// ============================================================
// toSortableKvn tests
// ============================================================

describe('toSortableKvn', () => {
  it('regular verse returns toKvn result', () => {
    const tkvn = encode(43, 3, 16); // Joh 3:16
    expect(converter.toSortableKvn(tkvn)).toBe(tkvn); // identity
  });

  it('mapped regular verse returns kvn', () => {
    // 2 Mos 7:26 osnb maps to 2 Mos 8:1 in translation
    const kvn = encode(2, 7, 26);
    const tkvn = converter.toTkvn(kvn);
    expect(tkvn).toBe(encode(2, 8, 1));
    expect(converter.toSortableKvn(tkvn)).toBe(kvn);
  });

  it('extra verses sort after basis verse', () => {
    const rom16_24 = encode(45, 16, 24);
    const rom16_25 = encode(45, 16, 25);

    const s24 = converter.toSortableKvn(rom16_24);
    const s25 = converter.toSortableKvn(rom16_25);

    // First extra should sort after basis verse
    expect(s24).toBeLessThan(s25);
  });
});

// ============================================================
// getAfterKvn tests
// ============================================================

describe('getAfterKvn', () => {
  it('returns null for regular verses', () => {
    expect(converter.getAfterKvn(encode(43, 3, 16))).toBeNull();
  });

  it('returns afterKvn for first extra verse in chain', () => {
    const rom16_25 = encode(45, 16, 25);
    const afterKvn = converter.getAfterKvn(rom16_25);
    expect(afterKvn).not.toBeNull();
    expect(decode(afterKvn!)).toEqual({ book: 45, chapter: 16, verse: 24, part: 0 });
  });

  it('all Rom 16:25-27 extras point to afterKvn 16:24', () => {
    const rom16_24 = encode(45, 16, 24);

    // All three extras have the same afterKvn (the last real verse)
    expect(converter.getAfterKvn(encode(45, 16, 25))).toBe(rom16_24);
    expect(converter.getAfterKvn(encode(45, 16, 26))).toBe(rom16_24);
    expect(converter.getAfterKvn(encode(45, 16, 27))).toBe(rom16_24);
  });
});

// ============================================================
// getCollisionSource tests
// ============================================================

describe('getCollisionSource', () => {
  it('returns null for non-collision kvn', () => {
    expect(converter.getCollisionSource(encode(43, 3, 16))).toBeNull();
  });

  it('returns source kvn for 1 Krøn 12:4 collision', () => {
    // kvn 13:12:5 maps to tkvn 13:12:4, and kvn 13:12:4 exists as identity
    const collision = encode(13, 12, 4);
    expect(converter.isCollision(collision)).toBe(true);
    const source = converter.getCollisionSource(collision);
    expect(source).not.toBeNull();
    expect(decode(source!)).toEqual({ book: 13, chapter: 12, verse: 5, part: 0 });
  });
});

// ============================================================
// listMappingSystems tests
// ============================================================

describe('listMappingSystems', () => {
  it('returns at least dnb_2011_nb', () => {
    const systems = listMappingSystems();
    expect(systems).toContain('dnb_2011_nb');
  });

  it('returns sorted array of strings', () => {
    const systems = listMappingSystems();
    expect(Array.isArray(systems)).toBe(true);
    const sorted = [...systems].sort();
    expect(systems).toEqual(sorted);
  });
});

// ============================================================
// loadKvnMapping with system name
// ============================================================

describe('loadKvnMapping system support', () => {
  it('loads default (dnb_2011_nb) without argument', () => {
    const m = loadKvnMapping();
    expect(m.system).toBe('dnb_2011_nb');
  });

  it('loads dnb_2011_nb by system name', () => {
    const m = loadKvnMapping('dnb_2011_nb');
    expect(m.system).toBe('dnb_2011_nb');
    expect(m.map.length).toBeGreaterThan(0);
  });
});

// ============================================================
// "f" and "ff" suffix support
// ============================================================

describe('parseRef with f/ff suffix', () => {
  it('Matt 4,5f = Matt 4,5-6', () => {
    const refs = parseRef('Matt 4,5f');
    expect(refs).toHaveLength(2);
    expect(refs[0]).toEqual({ book: 40, chapter: 4, verse: 5, part: 0 });
    expect(refs[1]).toEqual({ book: 40, chapter: 4, verse: 6, part: 0 });
  });

  it('Matt 4,5ff = Matt 4,5-7 (3 verses)', () => {
    const refs = parseRef('Matt 4,5ff');
    expect(refs).toHaveLength(3);
    expect(refs[0]).toEqual({ book: 40, chapter: 4, verse: 5, part: 0 });
    expect(refs[2]).toEqual({ book: 40, chapter: 4, verse: 7, part: 0 });
  });

  it('Rom 10,8bf = Rom 10,8b and 10,9', () => {
    const refs = parseRef('Rom 10,8bf');
    expect(refs).toHaveLength(2);
    expect(refs[0]).toEqual({ book: 45, chapter: 10, verse: 8, part: 2 });
    expect(refs[1]).toEqual({ book: 45, chapter: 10, verse: 9, part: 0 });
  });
});

// ============================================================
// Whole-chapter and semicolon references
// ============================================================

describe('parseRef whole-chapter and semicolons', () => {
  it('1 Kong 19,3b-13;24,10-21 = two ranges in same book', () => {
    const refs = parseRef('1 Kong 19,3b-13;24,10-21');
    // First part: 1 Kong 19,3b-13
    expect(refs[0]).toEqual({ book: 11, chapter: 19, verse: 3, part: 2 });
    expect(refs[refs.length - 1]).toEqual({ book: 11, chapter: 24, verse: 21, part: 0 });
    // Check the split point
    const ch19 = refs.filter(r => r.chapter === 19);
    const ch24 = refs.filter(r => r.chapter === 24);
    expect(ch19).toHaveLength(11); // v3b through v13
    expect(ch24).toHaveLength(12); // v10 through v21
  });
});
