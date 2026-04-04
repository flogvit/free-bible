import { describe, it, expect } from 'vitest';
import { loadKvnMapping } from '../src/load-mapping.js';
import { decode } from '../src/types.js';
import type { KvnMappingFile } from '../src/types.js';

const mapping: KvnMappingFile = loadKvnMapping();

describe('dnb_2011_nb.kvn.json mapping file integrity', () => {
  it('has required top-level fields', () => {
    expect(mapping.version).toBe(1);
    expect(mapping.system).toBe('dnb_2011_nb');
    expect(mapping.name).toBeTruthy();
    expect(mapping.bookNames).toBeDefined();
    expect(mapping.map).toBeDefined();
    expect(mapping.extraVerses).toBeDefined();
  });

  it('has 66 books in bookNames', () => {
    const bookIds = Object.values(mapping.bookNames);
    expect(bookIds.length).toBe(66);
    expect(Math.min(...bookIds)).toBe(1);
    expect(Math.max(...bookIds)).toBe(66);
  });

  it('map entries are [kvn, tkvn, readable, readable] tuples', () => {
    for (const entry of mapping.map) {
      expect(entry).toHaveLength(4);
      expect(typeof entry[0]).toBe('number'); // kvn
      expect(typeof entry[1]).toBe('number'); // tkvn
      expect(typeof entry[2]).toBe('string'); // kvn readable
      expect(typeof entry[3]).toBe('string'); // tkvn readable
    }
  });

  it('has no identity mappings (kvn !== tkvn)', () => {
    for (const [kvn, tkvn] of mapping.map) {
      expect(kvn).not.toBe(tkvn);
    }
  });

  it('has no duplicate kvn values in map', () => {
    const kvns = mapping.map.map(e => e[0]);
    const unique = new Set(kvns);
    expect(unique.size).toBe(kvns.length);
  });

  it('has no duplicate tkvn values in map', () => {
    const tkvns = mapping.map.map(e => e[1]);
    const unique = new Set(tkvns);
    expect(unique.size).toBe(tkvns.length);
  });

  it('all kvn values decode to valid book IDs (1-66)', () => {
    for (const [kvn] of mapping.map) {
      const d = decode(kvn);
      expect(d.book).toBeGreaterThanOrEqual(1);
      expect(d.book).toBeLessThanOrEqual(66);
    }
  });

  it('all tkvn values decode to valid book IDs (1-66)', () => {
    for (const [, tkvn] of mapping.map) {
      const d = decode(tkvn);
      expect(d.book).toBeGreaterThanOrEqual(1);
      expect(d.book).toBeLessThanOrEqual(66);
    }
  });

  it('does not map across different books', () => {
    for (const [kvn, tkvn] of mapping.map) {
      const src = decode(kvn);
      const tgt = decode(tkvn);
      expect(src.book).toBe(tgt.book);
    }
  });

  it('all mappings within same book reference adjacent chapters at most', () => {
    for (const [kvn, tkvn] of mapping.map) {
      const src = decode(kvn);
      const tgt = decode(tkvn);
      const chapterDiff = Math.abs(src.chapter - tgt.chapter);
      expect(chapterDiff).toBeLessThanOrEqual(2);
    }
  });

  it('readable strings match decoded values', () => {
    for (const [kvn, tkvn, kvnReadable, tkvnReadable] of mapping.map) {
      const src = decode(kvn);
      const tgt = decode(tkvn);
      expect(kvnReadable).toContain(`${src.chapter}:${src.verse}`);
      expect(tkvnReadable).toContain(`${tgt.chapter}:${tgt.verse}`);
    }
  });
});

describe('extra verses', () => {
  it('has 25 extra verses', () => {
    expect(mapping.extraVerses).toHaveLength(25);
  });

  it('extra verse entries are [tkvn, readable, afterKvn] tuples', () => {
    for (const entry of mapping.extraVerses) {
      expect(entry).toHaveLength(3);
      expect(typeof entry[0]).toBe('number'); // tkvn
      expect(typeof entry[1]).toBe('string'); // readable
      expect(typeof entry[2]).toBe('number'); // afterKvn
    }
  });

  it('includes Rom 16:25-27 extra verses', () => {
    const romExtras = mapping.extraVerses.filter(e => {
      const d = decode(e[0]);
      return d.book === 45 && d.chapter === 16 && d.verse >= 25;
    });
    expect(romExtras).toHaveLength(3);
  });

  it('includes Joel ch 3 extra verses (21)', () => {
    const joelExtras = mapping.extraVerses.filter(e => {
      const d = decode(e[0]);
      return d.book === 29 && d.chapter === 3;
    });
    expect(joelExtras).toHaveLength(21);
  });

  it('extra verses are not in the main map as tkvn targets', () => {
    const extraTkvns = new Set(mapping.extraVerses.map(e => e[0]));
    for (const [, tkvn] of mapping.map) {
      expect(extraTkvns.has(tkvn)).toBe(false);
    }
  });
});
