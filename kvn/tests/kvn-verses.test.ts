import { describe, it, expect } from 'vitest';
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

describe('osnb2 source data sanity', () => {
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

describe('mapped osnb2 verses exist in source data', () => {
  it('all explicitly mapped osnb2 verses exist in source', () => {
    for (const [kvn] of mapping.map) {
      const d = decode(kvn);
      const exists = verseExists(d.book, d.chapter, d.verse);
      expect(exists, `${d.book}:${d.chapter}:${d.verse} should exist in osnb2`).toBe(true);
    }
  });
});

describe('phantom verses do not exist in osnb2 source', () => {
  it.each(testData.categories.phantom.map(tc => [tc.description, tc]))(
    '%s',
    (_desc, tc) => {
      const phantom = tc as typeof testData.categories.phantom[0];
      const exists = verseExists(phantom.osnb2.book, phantom.osnb2.chapter, phantom.osnb2.verse);
      expect(exists).toBe(false);
    }
  );

  it('phantom osnb2MaxVerse matches actual source data', () => {
    for (const tc of testData.categories.phantom) {
      const actual = getMaxVerse(tc.osnb2.book, tc.osnb2.chapter);
      if (tc.osnb2MaxVerse === 0) {
        expect(actual).toBe(0);
      } else {
        expect(actual).toBe(tc.osnb2MaxVerse);
      }
    }
  });
});

describe('non-phantom test case verses exist in osnb2 source', () => {
  const realCases = [
    ...testData.categories.identity,
    ...testData.categories.chain_shift,
    ...testData.categories.cross_chapter_backward,
    ...testData.categories.same_chapter_backward,
    ...testData.categories.overflow_chapter,
    ...testData.categories.multi_chapter_block,
  ];

  it('all osnb2 coordinates in test cases exist in source data', () => {
    for (const tc of realCases) {
      const exists = verseExists(tc.osnb2.book, tc.osnb2.chapter, tc.osnb2.verse);
      expect(exists, `${tc.description}: osnb2 ${tc.osnb2.book}:${tc.osnb2.chapter}:${tc.osnb2.verse} should exist`).toBe(true);
    }
  });
});

describe('mapping covers all verse differences completely', () => {
  it('all cross-chapter backward targets are in a previous chapter', () => {
    for (const tc of testData.categories.cross_chapter_backward) {
      expect(tc.translation.chapter).toBeLessThan(tc.osnb2.chapter);
    }
  });

  it('chain shift verses have different verse numbers', () => {
    for (const tc of testData.categories.chain_shift) {
      expect(tc.osnb2.verse).not.toBe(tc.translation.verse);
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
