import { describe, it, expect } from 'vitest';
import { UkvnMapper } from '../src/ukvn-mapper.js';
import { CrossMapper } from '../src/ukvn-cross-mapper.js';
import { loadUkvnMapping, listUkvnMappings } from '../src/ukvn-loader.js';
import { ukvnDecode, UKVN_PART_SIZE } from '../src/ukvn-types.js';
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

/**
 * Find osmain verses that osnb splits into parts (Sal 19:1a / 19:1b).
 * The reverse lookup returns the part, not the whole verse, so a round-trip
 * through osnb cannot come back to the part-less verse it started from.
 * Lossy by design — same class as the many-to-one exclusion above.
 */
function findPartSplitBaseKvns(mapping: UkvnMappingFile): Set<number> {
  const bases = new Set<number>();
  for (const entry of mapping.map) {
    const part = entry.kvnFrom % UKVN_PART_SIZE;
    if (part > 0) bases.add(entry.kvnFrom - part);
  }
  return bases;
}

const allSystems = listUkvnMappings();

// Load osnb once as the hub for cross-translation round-trips
const osnbMapping = loadUkvnMapping('osnb');
const osnbMapper = new UkvnMapper(osnbMapping);
const osnbDuplicateKvns = findDuplicateTkvnEntries(osnbMapping);
const osnbPartSplitKvns = findPartSplitBaseKvns(osnbMapping);

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

  // Round-trip through osnb: translation -> osmain -> osnb -> osmain -> translation
  if (system !== 'osnb') {
    // Also exclude entries whose osmain kvn hits a many-to-one in osnb
    const roundTripEntries = testableEntries.filter(
      (e) => !osnbDuplicateKvns.has(e.kvnFrom) && !osnbPartSplitKvns.has(e.kvnFrom)
    );

    describe(`${system}: round-trip through osnb (${roundTripEntries.length} testable)`, () => {
      if (roundTripEntries.length === 0) {
        it('all cross-chapter entries are ambiguous through osnb (skipped)', () => {
          expect(true).toBe(true);
        });
        return;
      }

      const crossToOsnb2 = new CrossMapper(mapper, osnbMapper);
      const crossBack = new CrossMapper(osnbMapper, mapper);

      const entries = roundTripEntries.map((e) => [
        `${e.tkvnRef} -> osnb -> back`,
        e.tkvnFrom,
      ] as const);

      it.each(entries)(
        '%s',
        (_, tkvnFrom) => {
          // Step 1: translation tkvn -> osmain -> osnb
          const toOsnb2 = crossToOsnb2.map(tkvnFrom);
          // Step 2: osnb tkvn -> osmain -> translation
          const backToSource = crossBack.map(toOsnb2.tkvn);
          expect(backToSource.tkvn).toBe(tkvnFrom);
        }
      );
    });
  }
}
