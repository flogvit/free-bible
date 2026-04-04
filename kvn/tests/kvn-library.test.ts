import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { KVNConverter } from '../src/kvn.js';
import { loadKvnMapping } from '../src/load-mapping.js';
import { encode } from '../src/types.js';
import type { TestReferenceData, TestCase, VerseCoord } from '../src/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const mapping = loadKvnMapping();
const converter = new KVNConverter(mapping);
const raw = readFileSync(join(__dirname, '../data/test-references.json'), 'utf-8');
const testData: TestReferenceData = JSON.parse(raw);

function toKvn(c: VerseCoord): number {
  return encode(c.book, c.chapter, c.verse);
}

describe('KVNConverter basic properties', () => {
  it('has mappings loaded', () => {
    expect(converter.mappingCount).toBeGreaterThan(0);
  });

  it('has 25 extra verses', () => {
    expect(converter.extraCount).toBe(25);
  });
});

describe('identity mappings', () => {
  it.each(testData.categories.identity.map(tc => [tc.description, tc]))(
    '%s',
    (_desc, tc) => {
      const typedTc = tc as TestCase;
      const kvn = toKvn(typedTc.osnb2);
      const tkvn = toKvn(typedTc.translation);

      // Identity: kvn should equal tkvn
      expect(kvn).toBe(tkvn);

      // toTkvn should return identity (not in map)
      expect(converter.toTkvn(kvn)).toBe(kvn);

      // toKvn should return identity
      expect(converter.toKvn(kvn)).toBe(kvn);
    }
  );
});

describe('chain shift mappings', () => {
  it.each(testData.categories.chain_shift.map(tc => [tc.description, tc]))(
    '%s',
    (_desc, tc) => {
      const typedTc = tc as TestCase;
      const kvn = toKvn(typedTc.osnb2);
      const expectedTkvn = toKvn(typedTc.translation);

      expect(converter.toTkvn(kvn)).toBe(expectedTkvn);
    }
  );

  it('reverse mapping works for chain shifts', () => {
    for (const tc of testData.categories.chain_shift) {
      const kvn = toKvn(tc.osnb2);
      const tkvn = toKvn(tc.translation);
      expect(converter.toKvn(tkvn)).toBe(kvn);
    }
  });
});

describe('cross-chapter backward mappings', () => {
  it.each(testData.categories.cross_chapter_backward.map(tc => [tc.description, tc]))(
    '%s',
    (_desc, tc) => {
      const typedTc = tc as TestCase;
      const kvn = toKvn(typedTc.osnb2);
      const expectedTkvn = toKvn(typedTc.translation);

      expect(converter.toTkvn(kvn)).toBe(expectedTkvn);
    }
  );

  it('reverse mapping works for cross-chapter backward', () => {
    for (const tc of testData.categories.cross_chapter_backward) {
      const kvn = toKvn(tc.osnb2);
      const tkvn = toKvn(tc.translation);
      expect(converter.toKvn(tkvn)).toBe(kvn);
    }
  });

  it('source and target are in different chapters', () => {
    for (const tc of testData.categories.cross_chapter_backward) {
      expect(tc.osnb2.chapter).not.toBe(tc.translation.chapter);
      expect(tc.translation.chapter).toBe(tc.osnb2.chapter - 1);
    }
  });
});

describe('same-chapter backward mappings', () => {
  it.each(testData.categories.same_chapter_backward.map(tc => [tc.description, tc]))(
    '%s',
    (_desc, tc) => {
      const typedTc = tc as TestCase;
      const kvn = toKvn(typedTc.osnb2);
      const expectedTkvn = toKvn(typedTc.translation);

      expect(converter.toTkvn(kvn)).toBe(expectedTkvn);
    }
  );

  it('source and target are in same chapter', () => {
    for (const tc of testData.categories.same_chapter_backward) {
      expect(tc.osnb2.chapter).toBe(tc.translation.chapter);
      expect(tc.translation.verse).toBeLessThan(tc.osnb2.verse);
    }
  });
});

describe('overflow chapter mappings', () => {
  it.each(testData.categories.overflow_chapter.map(tc => [tc.description, tc]))(
    '%s',
    (_desc, tc) => {
      const typedTc = tc as TestCase;
      const kvn = toKvn(typedTc.osnb2);
      const expectedTkvn = toKvn(typedTc.translation);

      expect(converter.toTkvn(kvn)).toBe(expectedTkvn);
    }
  );
});

describe('multi-chapter block mappings', () => {
  it.each(testData.categories.multi_chapter_block.map(tc => [tc.description, tc]))(
    '%s',
    (_desc, tc) => {
      const typedTc = tc as TestCase;
      const kvn = toKvn(typedTc.osnb2);
      const expectedTkvn = toKvn(typedTc.translation);

      expect(converter.toTkvn(kvn)).toBe(expectedTkvn);
    }
  );
});

describe('unmapped (extra) verses', () => {
  it('extra translation verses return null for toKvn', () => {
    for (const tc of testData.categories.unmapped) {
      const tkvn = toKvn(tc.translation);
      expect(converter.toKvn(tkvn)).toBeNull();
    }
  });

  it('extra verses are detected by isExtra', () => {
    for (const tc of testData.categories.unmapped) {
      const tkvn = toKvn(tc.translation);
      expect(converter.isExtra(tkvn)).toBe(true);
    }
  });

  it('regular verses are not flagged as extra', () => {
    for (const tc of testData.categories.identity) {
      const kvn = toKvn(tc.osnb2);
      expect(converter.isExtra(kvn)).toBe(false);
    }
  });
});

describe('round-trip consistency', () => {
  it('kvn -> tkvn -> kvn round-trip works for all non-phantom cases', () => {
    const allCases: TestCase[] = [
      ...testData.categories.identity,
      ...testData.categories.chain_shift,
      ...testData.categories.cross_chapter_backward,
      ...testData.categories.same_chapter_backward,
      ...testData.categories.overflow_chapter,
      ...testData.categories.multi_chapter_block,
    ];

    for (const tc of allCases) {
      const kvn = toKvn(tc.osnb2);
      const tkvn = converter.toTkvn(kvn);
      const roundTrip = converter.toKvn(tkvn);
      expect(roundTrip).toBe(kvn);
    }
  });
});
