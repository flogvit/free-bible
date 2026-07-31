import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { KVNConverter } from '../src/kvn.js';
import { loadKvnMapping } from '../src/load-mapping.js';
import { getMaxVerse, getChapterCount, verseExists, getTotalVerseCount } from '../src/load-bible.js';
import { decode } from '../src/types.js';
import type { TestReferenceData } from '../src/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const mapping = loadKvnMapping();
const converter = new KVNConverter(mapping);
const raw = readFileSync(join(__dirname, '../data/test-references.json'), 'utf-8');
const testData: TestReferenceData = JSON.parse(raw);

describe('osnb source data sanity', () => {
  it('has 66 books', () => {
    let count = 0;
    for (let book = 1; book <= 66; book++) {
      if (getChapterCount(book) > 0) count++;
    }
    expect(count).toBe(66);
  });

  it('has ~31000+ total verses', () => {
    const total = getTotalVerseCount();
    expect(total).toBeGreaterThan(31000);
    expect(total).toBeLessThan(32000);
  });
});

describe('mapped osnb verses exist in source data', () => {
  it('all explicitly mapped osnb verses exist in source', () => {
    for (const [kvn] of mapping.map) {
      const d = decode(kvn);
      const exists = verseExists(d.book, d.chapter, d.verse);
      expect(exists, `${d.book}:${d.chapter}:${d.verse} should exist in osnb`).toBe(true);
    }
  });
});

describe('phantom verses do not exist in osnb source', () => {
  it.each(testData.categories.phantom.map(tc => [tc.description, tc]))(
    '%s',
    (_desc, tc) => {
      const phantom = tc as typeof testData.categories.phantom[0];
      const exists = verseExists(phantom.osnb.book, phantom.osnb.chapter, phantom.osnb.verse);
      expect(exists).toBe(false);
    }
  );

  it('phantom osnbMaxVerse matches actual source data', () => {
    for (const tc of testData.categories.phantom) {
      const actual = getMaxVerse(tc.osnb.book, tc.osnb.chapter);
      if (tc.osnbMaxVerse === 0) {
        expect(actual).toBe(0);
      } else {
        expect(actual).toBe(tc.osnbMaxVerse);
      }
    }
  });
});

describe('non-phantom test case verses exist in osnb source', () => {
  const realCases = [
    ...testData.categories.identity,
    ...testData.categories.chain_shift,
    ...testData.categories.cross_chapter_backward,
    ...testData.categories.same_chapter_backward,
    ...testData.categories.overflow_chapter,
    ...testData.categories.multi_chapter_block,
  ];

  it('all osnb coordinates in test cases exist in source data', () => {
    for (const tc of realCases) {
      const exists = verseExists(tc.osnb.book, tc.osnb.chapter, tc.osnb.verse);
      expect(exists, `${tc.description}: osnb ${tc.osnb.book}:${tc.osnb.chapter}:${tc.osnb.verse} should exist`).toBe(true);
    }
  });
});

describe('mapping covers all verse differences completely', () => {
  it('all cross-chapter backward targets are in a previous chapter', () => {
    for (const tc of testData.categories.cross_chapter_backward) {
      expect(tc.translation.chapter).toBeLessThan(tc.osnb.chapter);
    }
  });

  it('chain shift verses have different verse numbers', () => {
    for (const tc of testData.categories.chain_shift) {
      expect(tc.osnb.verse).not.toBe(tc.translation.verse);
    }
  });
});

describe('collision verses', () => {
  it('finds collision verses where identity position is occupied', () => {
    let collisionCount = 0;
    for (let book = 1; book <= 66; book++) {
      const chapters = getChapterCount(book);
      for (let ch = 1; ch <= chapters; ch++) {
        const maxV = getMaxVerse(book, ch);
        for (let v = 1; v <= maxV; v++) {
          const kvn = (book << 20) | (ch << 12) | (v << 4);
          if (converter.isCollision(kvn)) {
            collisionCount++;
          }
        }
      }
    }
    // Document the count of collision verses
    expect(collisionCount).toBeGreaterThan(0);
    expect(collisionCount).toBeLessThan(200);
  });
});
