import { describe, it, expect } from 'vitest';
import { UkvnMapper } from '../src/ukvn-mapper.js';
import { CrossMapper } from '../src/ukvn-cross-mapper.js';
import { loadUkvnMapping, listUkvnMappings } from '../src/ukvn-loader.js';
import { ukvnEncode, ukvnDecode, ukvnFormat } from '../src/ukvn-types.js';

/**
 * Round-trip tests: translation A -> osnb -> translation A
 * Verifies that valid references survive the trip through osmain hub.
 */

function roundTrip(
  sourceMapper: UkvnMapper,
  osnbMapper: UkvnMapper,
  book: number, ch: number, v: number, part = 0
): { ok: boolean; osnbRef: string; backRef: string } {
  const tkvn = ukvnEncode(book, ch, v, part);
  const toOsnb2 = new CrossMapper(sourceMapper, osnbMapper).map(tkvn);
  const back = new CrossMapper(osnbMapper, sourceMapper).map(toOsnb2.tkvn);
  return {
    ok: back.tkvn === tkvn,
    osnbRef: ukvnFormat(toOsnb2.tkvn),
    backRef: ukvnFormat(back.tkvn),
  };
}

describe('Round-trip: dnb2024 -> osnb -> dnb2024', () => {
  const dnb2024 = new UkvnMapper(loadUkvnMapping('dnb2024_nb'));
  const osnb = new UkvnMapper(loadUkvnMapping('osnb'));

  describe('Isaiah 9 boundary (Hebrew 8:23 / European 9:1)', () => {
    it('Jes 9,1 -> osnb 8:23 -> back', () => {
      const r = roundTrip(dnb2024, osnb, 23, 9, 1);
      expect(r.ok).toBe(true);
    });

    it('Jes 9,1a (with part) -> osnb 8:23a -> back', () => {
      const r = roundTrip(dnb2024, osnb, 23, 9, 1, 1);
      expect(r.ok).toBe(true);
    });

    it('Jes 9,2 -> osnb 9:1 -> back', () => {
      const r = roundTrip(dnb2024, osnb, 23, 9, 2);
      expect(r.ok).toBe(true);
    });

    it('Jes 9,6 (Messianic) -> osnb 9:5 -> back', () => {
      const r = roundTrip(dnb2024, osnb, 23, 9, 6);
      expect(r.ok).toBe(true);
    });

    it('Jes 9,7 -> osnb 9:6 -> back', () => {
      const r = roundTrip(dnb2024, osnb, 23, 9, 7);
      expect(r.ok).toBe(true);
    });
  });

  describe('Jonah 1-2 boundary (fish swallows Jonah)', () => {
    it('Jona 2,1 -> osnb 2:1 -> back', () => {
      const r = roundTrip(dnb2024, osnb, 32, 2, 1);
      expect(r.ok).toBe(true);
    });

    it('Jona 2,10 -> osnb 2:10 -> back', () => {
      const r = roundTrip(dnb2024, osnb, 32, 2, 10);
      expect(r.ok).toBe(true);
    });
  });

  describe('Genesis 31-32 boundary (Laban departs)', () => {
    it('1 Mos 31,55 -> osnb 32:1 -> back', () => {
      const r = roundTrip(dnb2024, osnb, 1, 31, 55);
      expect(r.ok).toBe(true);
    });

    it('1 Mos 32,1 -> osnb 32:2 -> back', () => {
      const r = roundTrip(dnb2024, osnb, 1, 32, 1);
      expect(r.ok).toBe(true);
    });
  });

  describe('Hosea 11-12 boundary', () => {
    // dnb2024_nb foelger hebraisk nummerering her: Hos 11 slutter paa vers 11,
    // og osmain 11:12 er dens 12,1. Verset aa teste er derfor 12,1 — 11,12
    // finnes ikke i modulen.
    it('Hos 12,1 -> osnb 11:12 -> back', () => {
      const r = roundTrip(dnb2024, osnb, 28, 12, 1);
      expect(r.ok).toBe(true);
      expect(r.osnbRef).toBe('28 12:1');
    });
  });

  describe('Joel 2-3 boundary (Spirit poured out)', () => {
    // dnb2024_nb har 27 vers i Joel 2; utgytelsen av Aanden ligger i dens
    // kapittel 3,1-5 (osmain 2,28-32 / osnb 3,1-5).
    it('Joel 3,1 -> osnb 3:1 -> back', () => {
      const r = roundTrip(dnb2024, osnb, 29, 3, 1);
      expect(r.ok).toBe(true);
      expect(r.osnbRef).toBe('29 3:1');
    });

    it('Joel 3,5 -> osnb 3:5 -> back', () => {
      const r = roundTrip(dnb2024, osnb, 29, 3, 5);
      expect(r.ok).toBe(true);
      expect(r.osnbRef).toBe('29 3:5');
    });

    it('Joel 3,6 -> osnb 4:1 -> back', () => {
      const r = roundTrip(dnb2024, osnb, 29, 3, 6);
      expect(r.ok).toBe(true);
    });

    it('Joel 3,21 -> osnb 4:21 -> back', () => {
      const r = roundTrip(dnb2024, osnb, 29, 3, 21);
      expect(r.ok).toBe(true);
    });
  });

  describe('Job 38-41 boundary (Behemoth/Leviathan)', () => {
    it('Job 39,1 (= osmain 38:39, lioness) -> back', () => {
      const r = roundTrip(dnb2024, osnb, 18, 39, 1);
      expect(r.ok).toBe(true);
    });

    it('Job 39,34 (= osmain 40:1, Lord answers) -> back', () => {
      const r = roundTrip(dnb2024, osnb, 18, 39, 34);
      expect(r.ok).toBe(true);
    });

    it('Job 39,38 (= osmain 40:5, Job silent) -> back', () => {
      const r = roundTrip(dnb2024, osnb, 18, 39, 38);
      expect(r.ok).toBe(true);
    });

    it('Job 40,1 (= osmain 40:6, Lord from storm) -> back', () => {
      const r = roundTrip(dnb2024, osnb, 18, 40, 1);
      expect(r.ok).toBe(true);
    });

    it('Job 40,19 (= osmain 40:24, last Behemoth) -> back', () => {
      const r = roundTrip(dnb2024, osnb, 18, 40, 19);
      expect(r.ok).toBe(true);
    });

    it('Job 40,20 (= osmain 41:1, Leviathan opening) -> back', () => {
      const r = roundTrip(dnb2024, osnb, 18, 40, 20);
      expect(r.ok).toBe(true);
    });

    it('Job 40,28 (= osmain 41:9, hope dashed) -> back', () => {
      const r = roundTrip(dnb2024, osnb, 18, 40, 28);
      expect(r.ok).toBe(true);
    });

    it('Job 41,1 (= osmain 41:10, who dares wake) -> back', () => {
      const r = roundTrip(dnb2024, osnb, 18, 41, 1);
      expect(r.ok).toBe(true);
    });

    it('Job 41,25 (= osmain 41:34, king of proud) -> back', () => {
      const r = roundTrip(dnb2024, osnb, 18, 41, 25);
      expect(r.ok).toBe(true);
    });
  });

  describe('Acts 19:40-41 split verse', () => {
    it('Apg 19,40a (= osmain 19:40) -> osnb 19:40a -> back', () => {
      const r = roundTrip(dnb2024, osnb, 44, 19, 40, 1);
      expect(r.ok).toBe(true);
    });

    it('Apg 19,40b (= osmain 19:41) -> osnb 19:40b -> back', () => {
      const r = roundTrip(dnb2024, osnb, 44, 19, 40, 2);
      expect(r.ok).toBe(true);
    });
  });
});

describe('Round-trip: all mappings, identity verses', () => {
  const osnb = new UkvnMapper(loadUkvnMapping('osnb'));
  const systems = listUkvnMappings().filter(s => s !== 'osnb');

  it.each(systems)('%s: Gen 1:1 round-trips', (system) => {
    const mapper = new UkvnMapper(loadUkvnMapping(system));
    const r = roundTrip(mapper, osnb, 1, 1, 1);
    expect(r.ok).toBe(true);
  });

  it.each(systems)('%s: Sal 23:1 round-trips', (system) => {
    const mapper = new UkvnMapper(loadUkvnMapping(system));
    const r = roundTrip(mapper, osnb, 19, 23, 1);
    expect(r.ok).toBe(true);
  });

  it.each(systems)('%s: Joh 3:16 round-trips', (system) => {
    const mapper = new UkvnMapper(loadUkvnMapping(system));
    const r = roundTrip(mapper, osnb, 43, 3, 16);
    expect(r.ok).toBe(true);
  });
});

describe('Round-trip: norwegian1938 (has Acts 19:41)', () => {
  const n1938 = new UkvnMapper(loadUkvnMapping('norwegian1938'));
  const osnb = new UkvnMapper(loadUkvnMapping('osnb'));

  it('Apg 19,41 identity round-trips', () => {
    const r = roundTrip(n1938, osnb, 44, 19, 41);
    expect(r.ok).toBe(true);
  });
});

describe('Part propagation through mappings', () => {
  const dnb2024 = new UkvnMapper(loadUkvnMapping('dnb2024_nb'));
  const osnb = new UkvnMapper(loadUkvnMapping('osnb'));

  it('parts propagate for cross-chapter boundary (Jes 9,1a)', () => {
    const tkvn = ukvnEncode(23, 9, 1, 1);
    const toOsnb2 = new CrossMapper(dnb2024, osnb).map(tkvn);
    const dec = ukvnDecode(toOsnb2.tkvn);
    expect(dec.chapter).toBe(8);
    expect(dec.verse).toBe(23);
    expect(dec.part).toBe(1);
  });

  it('parts propagate for same-chapter shift (Jes 9,6a)', () => {
    const tkvn = ukvnEncode(23, 9, 6, 1);
    const toOsnb2 = new CrossMapper(dnb2024, osnb).map(tkvn);
    const dec = ukvnDecode(toOsnb2.tkvn);
    expect(dec.chapter).toBe(9);
    expect(dec.verse).toBe(5);
    expect(dec.part).toBe(1);
  });
});
