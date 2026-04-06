import { describe, it, expect } from 'vitest';
import { UkvnMapper } from '../src/ukvn-mapper.js';
import { CrossMapper } from '../src/ukvn-cross-mapper.js';
import { loadUkvnMapping, listUkvnMappings } from '../src/ukvn-loader.js';
import { ukvnEncode, ukvnDecode, ukvnFormat } from '../src/ukvn-types.js';

/**
 * Round-trip tests: translation A -> osnb2 -> translation A
 * Verifies that valid references survive the trip through osmain hub.
 */

function roundTrip(
  sourceMapper: UkvnMapper,
  osnb2Mapper: UkvnMapper,
  book: number, ch: number, v: number, part = 0
): { ok: boolean; osnb2Ref: string; backRef: string } {
  const tkvn = ukvnEncode(book, ch, v, part);
  const toOsnb2 = new CrossMapper(sourceMapper, osnb2Mapper).map(tkvn);
  const back = new CrossMapper(osnb2Mapper, sourceMapper).map(toOsnb2.tkvn);
  return {
    ok: back.tkvn === tkvn,
    osnb2Ref: ukvnFormat(toOsnb2.tkvn),
    backRef: ukvnFormat(back.tkvn),
  };
}

describe('Round-trip: dnb2024 -> osnb2 -> dnb2024', () => {
  const dnb2024 = new UkvnMapper(loadUkvnMapping('dnb2024'));
  const osnb2 = new UkvnMapper(loadUkvnMapping('osnb2'));

  describe('Isaiah 9 boundary (Hebrew 8:23 / European 9:1)', () => {
    it('Jes 9,1 -> osnb2 8:23 -> back', () => {
      const r = roundTrip(dnb2024, osnb2, 23, 9, 1);
      expect(r.ok).toBe(true);
    });

    it('Jes 9,1a (with part) -> osnb2 8:23a -> back', () => {
      const r = roundTrip(dnb2024, osnb2, 23, 9, 1, 1);
      expect(r.ok).toBe(true);
    });

    it('Jes 9,2 -> osnb2 9:1 -> back', () => {
      const r = roundTrip(dnb2024, osnb2, 23, 9, 2);
      expect(r.ok).toBe(true);
    });

    it('Jes 9,6 (Messianic) -> osnb2 9:5 -> back', () => {
      const r = roundTrip(dnb2024, osnb2, 23, 9, 6);
      expect(r.ok).toBe(true);
    });

    it('Jes 9,7 -> osnb2 9:6 -> back', () => {
      const r = roundTrip(dnb2024, osnb2, 23, 9, 7);
      expect(r.ok).toBe(true);
    });
  });

  describe('Jonah 1-2 boundary (fish swallows Jonah)', () => {
    it('Jona 2,1 -> osnb2 2:1 -> back', () => {
      const r = roundTrip(dnb2024, osnb2, 32, 2, 1);
      expect(r.ok).toBe(true);
    });

    it('Jona 2,10 -> osnb2 2:10 -> back', () => {
      const r = roundTrip(dnb2024, osnb2, 32, 2, 10);
      expect(r.ok).toBe(true);
    });
  });

  describe('Genesis 31-32 boundary (Laban departs)', () => {
    it('1 Mos 31,55 -> osnb2 32:1 -> back', () => {
      const r = roundTrip(dnb2024, osnb2, 1, 31, 55);
      expect(r.ok).toBe(true);
    });

    it('1 Mos 32,1 -> osnb2 32:2 -> back', () => {
      const r = roundTrip(dnb2024, osnb2, 1, 32, 1);
      expect(r.ok).toBe(true);
    });
  });

  describe('Hosea 11-12 boundary', () => {
    it('Hos 11,12 -> osnb2 12:1 -> back', () => {
      const r = roundTrip(dnb2024, osnb2, 28, 11, 12);
      expect(r.ok).toBe(true);
    });
  });

  describe('Joel 2-3 boundary (Spirit poured out)', () => {
    it('Joel 2,28 -> osnb2 3:1 -> back', () => {
      const r = roundTrip(dnb2024, osnb2, 29, 2, 28);
      expect(r.ok).toBe(true);
    });

    it('Joel 2,32 -> osnb2 3:5 -> back', () => {
      const r = roundTrip(dnb2024, osnb2, 29, 2, 32);
      expect(r.ok).toBe(true);
    });

    it('Joel 3,1 -> osnb2 4:1 -> back', () => {
      const r = roundTrip(dnb2024, osnb2, 29, 3, 1);
      expect(r.ok).toBe(true);
    });

    it('Joel 3,21 -> osnb2 4:21 -> back', () => {
      const r = roundTrip(dnb2024, osnb2, 29, 3, 21);
      expect(r.ok).toBe(true);
    });
  });

  describe('Job 38-41 boundary (Behemoth/Leviathan)', () => {
    it('Job 39,1 (= osmain 38:39, lioness) -> back', () => {
      const r = roundTrip(dnb2024, osnb2, 18, 39, 1);
      expect(r.ok).toBe(true);
    });

    it('Job 39,34 (= osmain 40:1, Lord answers) -> back', () => {
      const r = roundTrip(dnb2024, osnb2, 18, 39, 34);
      expect(r.ok).toBe(true);
    });

    it('Job 39,38 (= osmain 40:5, Job silent) -> back', () => {
      const r = roundTrip(dnb2024, osnb2, 18, 39, 38);
      expect(r.ok).toBe(true);
    });

    it('Job 40,1 (= osmain 40:6, Lord from storm) -> back', () => {
      const r = roundTrip(dnb2024, osnb2, 18, 40, 1);
      expect(r.ok).toBe(true);
    });

    it('Job 40,19 (= osmain 40:24, last Behemoth) -> back', () => {
      const r = roundTrip(dnb2024, osnb2, 18, 40, 19);
      expect(r.ok).toBe(true);
    });

    it('Job 40,20 (= osmain 41:27, Leviathan opening) -> back', () => {
      const r = roundTrip(dnb2024, osnb2, 18, 40, 20);
      expect(r.ok).toBe(true);
    });

    it('Job 40,28 (= osmain 41:1, hope dashed) -> back', () => {
      const r = roundTrip(dnb2024, osnb2, 18, 40, 28);
      expect(r.ok).toBe(true);
    });

    it('Job 41,1 (= osmain 41:2, who dares wake) -> back', () => {
      const r = roundTrip(dnb2024, osnb2, 18, 41, 1);
      expect(r.ok).toBe(true);
    });

    it('Job 41,25 (= osmain 41:26, king of proud) -> back', () => {
      const r = roundTrip(dnb2024, osnb2, 18, 41, 25);
      expect(r.ok).toBe(true);
    });
  });

  describe('Acts 19:40-41 split verse', () => {
    it('Apg 19,40a (= osmain 19:40) -> osnb2 19:40a -> back', () => {
      const r = roundTrip(dnb2024, osnb2, 44, 19, 40, 1);
      expect(r.ok).toBe(true);
    });

    it('Apg 19,40b (= osmain 19:41) -> osnb2 19:40b -> back', () => {
      const r = roundTrip(dnb2024, osnb2, 44, 19, 40, 2);
      expect(r.ok).toBe(true);
    });
  });
});

describe('Round-trip: all mappings, identity verses', () => {
  const osnb2 = new UkvnMapper(loadUkvnMapping('osnb2'));
  const systems = listUkvnMappings().filter(s => s !== 'osnb2');

  it.each(systems)('%s: Gen 1:1 round-trips', (system) => {
    const mapper = new UkvnMapper(loadUkvnMapping(system));
    const r = roundTrip(mapper, osnb2, 1, 1, 1);
    expect(r.ok).toBe(true);
  });

  it.each(systems)('%s: Sal 23:1 round-trips', (system) => {
    const mapper = new UkvnMapper(loadUkvnMapping(system));
    const r = roundTrip(mapper, osnb2, 19, 23, 1);
    expect(r.ok).toBe(true);
  });

  it.each(systems)('%s: Joh 3:16 round-trips', (system) => {
    const mapper = new UkvnMapper(loadUkvnMapping(system));
    const r = roundTrip(mapper, osnb2, 43, 3, 16);
    expect(r.ok).toBe(true);
  });
});

describe('Round-trip: norwegian1938 (has Acts 19:41)', () => {
  const n1938 = new UkvnMapper(loadUkvnMapping('norwegian1938'));
  const osnb2 = new UkvnMapper(loadUkvnMapping('osnb2'));

  it('Apg 19,41 identity round-trips', () => {
    const r = roundTrip(n1938, osnb2, 44, 19, 41);
    expect(r.ok).toBe(true);
  });
});

describe('Part propagation through mappings', () => {
  const dnb2024 = new UkvnMapper(loadUkvnMapping('dnb2024'));
  const osnb2 = new UkvnMapper(loadUkvnMapping('osnb2'));

  it('parts propagate for cross-chapter boundary (Jes 9,1a)', () => {
    const tkvn = ukvnEncode(23, 9, 1, 1);
    const toOsnb2 = new CrossMapper(dnb2024, osnb2).map(tkvn);
    const dec = ukvnDecode(toOsnb2.tkvn);
    expect(dec.chapter).toBe(8);
    expect(dec.verse).toBe(23);
    expect(dec.part).toBe(1);
  });

  it('parts propagate for same-chapter shift (Jes 9,6a)', () => {
    const tkvn = ukvnEncode(23, 9, 6, 1);
    const toOsnb2 = new CrossMapper(dnb2024, osnb2).map(tkvn);
    const dec = ukvnDecode(toOsnb2.tkvn);
    expect(dec.chapter).toBe(9);
    expect(dec.verse).toBe(5);
    expect(dec.part).toBe(1);
  });
});
