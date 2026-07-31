import { describe, it, expect } from 'bun:test';
import { UkvnMapper } from '../src/ukvn-mapper.js';
import { loadUkvnMapping, listUkvnMappings } from '../src/ukvn-loader.js';
import { ukvnDecode } from '../src/ukvn-types.js';
import type { UkvnMappingFile } from '../src/ukvn-types.js';

/**
 * Comprehensive round-trip tests for ALL cross-chapter mapping entries
 * in every mapping file. Cross-chapter entries are those where the osmain
 * chapter differs from the translation chapter - these are the trickiest
 * cases for verse mapping.
 */

interface CrossChapterEntry {
  kvnFrom: number;
  tkvnFrom: number;
  kvnRef: string;
  tkvnRef: string;
}

/**
 * Find all cross-chapter entries in a mapping file.
 * A cross-chapter entry is one where the osmain (kvnFrom) chapter differs
 * from the translation (tkvnFrom) chapter.
 */
function findCrossChapterEntries(mapping: UkvnMappingFile): CrossChapterEntry[] {
  return mapping.map
    .filter((entry) => {
      const kvn = ukvnDecode(entry.kvnFrom);
      const tkvn = ukvnDecode(entry.tkvnFrom);
      return kvn.chapter !== tkvn.chapter;
    })
    .map((entry) => ({
      kvnFrom: entry.kvnFrom,
      tkvnFrom: entry.tkvnFrom,
      kvnRef: entry.kvnRef,
      tkvnRef: entry.tkvnRef,
    }));
}

/**
 * Find entries where multiple kvnFrom values map to the same tkvnFrom.
 * These cannot round-trip cleanly because the reverse lookup picks only one.
 */
function findDuplicateTkvnEntries(mapping: UkvnMappingFile): Set<number> {
  const tkvnCounts = new Map<number, number[]>();
  for (const entry of mapping.map) {
    const existing = tkvnCounts.get(entry.tkvnFrom) || [];
    existing.push(entry.kvnFrom);
    tkvnCounts.set(entry.tkvnFrom, existing);
  }
  const duplicateKvns = new Set<number>();
  for (const [, kvns] of tkvnCounts) {
    if (kvns.length > 1) {
      // All kvnFrom values that share a tkvnFrom are ambiguous
      for (const kvn of kvns) {
        duplicateKvns.add(kvn);
      }
    }
  }
  return duplicateKvns;
}

const allSystems = listUkvnMappings();

for (const system of allSystems) {
  const mapping = loadUkvnMapping(system);
  const mapper = new UkvnMapper(mapping);
  const crossChapterEntries = findCrossChapterEntries(mapping);
  const duplicateKvns = findDuplicateTkvnEntries(mapping);

  // Filter out entries that cannot round-trip due to many-to-one mappings
  const testableEntries = crossChapterEntries.filter(
    (e) => !duplicateKvns.has(e.kvnFrom)
  );

  if (crossChapterEntries.length === 0) {
    describe(`${system}: cross-chapter entries`, () => {
      it('has no cross-chapter entries (nothing to test)', () => {
        expect(crossChapterEntries).toHaveLength(0);
      });
    });
    continue;
  }

  describe(`${system}: cross-chapter forward mapping (${crossChapterEntries.length} entries)`, () => {
    const entries = crossChapterEntries.map((e) => [
      `${e.kvnRef} -> ${e.tkvnRef}`,
      e.kvnFrom,
      e.tkvnFrom,
    ] as const);

    it.each(entries)(
      '%s',
      (_, kvnFrom, expectedTkvnFrom) => {
        const actual = mapper.toTkvn(kvnFrom);
        expect(actual).toBe(expectedTkvnFrom);
      }
    );
  });

  describe(`${system}: cross-chapter reverse mapping (${testableEntries.length} testable)`, () => {
    if (testableEntries.length === 0) {
      it('all cross-chapter entries have duplicate tkvnFrom (skipped)', () => {
        expect(true).toBe(true);
      });
      return;
    }

    const entries = testableEntries.map((e) => [
      `${e.tkvnRef} -> ${e.kvnRef}`,
      e.tkvnFrom,
      e.kvnFrom,
    ] as const);

    it.each(entries)(
      '%s',
      (_, tkvnFrom, expectedKvnFrom) => {
        const actual = mapper.toKvn(tkvnFrom);
        expect(actual).toBe(expectedKvnFrom);
      }
    );
  });

  // Round-trip through osmain: translation -> osmain -> translation.
  //
  // osmain er navet all kryssmapping skal gå gjennom. Tidligere gikk denne
  // testen via osnb, men osnb er bare enda en oversettelse — med egne hull —
  // så den testet osnb sin mapping like mye som oversettelsens egen.
  describe(`${system}: round-trip through osmain (${testableEntries.length} testable)`, () => {
    if (testableEntries.length === 0) {
      it('all cross-chapter entries have duplicate tkvnFrom (skipped)', () => {
        expect(true).toBe(true);
      });
      return;
    }

    const entries = testableEntries.map((e) => [
      `${e.tkvnRef} -> osmain -> back`,
      e.tkvnFrom,
    ] as const);

    it.each(entries)('%s', (_, tkvnFrom) => {
      expect(mapper.toTkvn(mapper.toKvn(tkvnFrom))).toBe(tkvnFrom);
    });
  });
}
