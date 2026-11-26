import { describe, it, expect } from 'bun:test';
import { UkvnMapper } from '../src/ukvn-mapper.js';
import { CrossMapper } from '../src/ukvn-cross-mapper.js';
import { loadUkvnMapping } from '../src/ukvn-loader.js';
import { ukvnEncode, ukvnFormat } from '../src/ukvn-types.js';

/**
 * Psalm titles, read against the printed editions (#164).
 *
 * osnb keeps the Hebrew numbering, with the title as its own verse. Each case
 * lists, for every osnb verse in a psalm, the verse of the printed edition
 * that carries the same text, and checks both directions through osmain.
 * The tables were read verse by verse against the texts in bibles_raw.
 */

const osnb = new UkvnMapper(loadUkvnMapping('osnb'));

type Pairs = Array<[osnbVerse: number, targetVerse: number]>;

/** osnb verses from..to, each landing `shift` verses lower in the target. */
function shifted(from: number, to: number, shift: number): Pairs {
  const out: Pairs = [];
  for (let v = from; v <= to; v++) out.push([v, v - shift]);
  return out;
}

function expectPsalm(target: string, psalm: number, pairs: Pairs) {
  const t = new UkvnMapper(loadUkvnMapping(target));
  const there = new CrossMapper(osnb, t);
  const back = new CrossMapper(t, osnb);
  const wrong: string[] = [];
  for (const [o, v] of pairs) {
    const got = there.map(ukvnEncode(19, psalm, o)).tkvn;
    if (got !== ukvnEncode(19, psalm, v)) wrong.push(`osnb ${psalm}:${o} -> ${ukvnFormat(got)}, expected ${psalm}:${v}`);
    const ret = back.map(ukvnEncode(19, psalm, v)).tkvn;
    if (ret !== ukvnEncode(19, psalm, o)) wrong.push(`${target} ${psalm}:${v} -> osnb ${ukvnFormat(ret)}, expected ${psalm}:${o}`);
  }
  expect(wrong).toEqual([]);
}

describe('english_kj: printed KJV has the title outside the verses', () => {
  it('Ps 9: KJV 9:1 is «I will praise thee» = osnb 9:2', () => expectPsalm('english_kj', 9, shifted(2, 21, 1)));
  it('Ps 77: KJV 77:1 is «I cried unto God» = osnb 77:2', () => expectPsalm('english_kj', 77, shifted(2, 21, 1)));
  it('Ps 60: KJV 60:1 is «O God, thou hast cast us off» = osnb 60:3', () =>
    expectPsalm('english_kj', 60, shifted(3, 14, 2)));

  // osmain has these six in the Hebrew numbering; the own editions' mapping
  // used to send the last osnb verses to a part of the verse before.
  for (const [psalm, last] of [[18, 51], [42, 12], [64, 11], [68, 36], [81, 17], [140, 14]]) {
    it(`Ps ${psalm}: osnb ${psalm}:${last} = KJV ${psalm}:${last - 1}`, () =>
      expectPsalm('english_kj', psalm, shifted(2, last, 1)));
  }
});

describe('Bibelselskapet: title as its own verse, as in osnb', () => {
  for (const target of ['dnb2024_nb', 'dnb2024_nn', 'dnb2011_nb']) {
    it(`${target} Ps 13:1-5`, () => expectPsalm(target, 13, shifted(1, 5, 0)));
    // 13:6 holds osmain 13:5 and 13:6 (KJV 13:5-6) as one verse.
    it(`${target} Ps 13:6 is KJV 13:5-6 and round-trips through osnb`, () => {
      const t = new UkvnMapper(loadUkvnMapping(target));
      const kjv = new CrossMapper(new UkvnMapper(loadUkvnMapping('english_kj')), t);
      expect(kjv.map(ukvnEncode(19, 13, 5)).tkvn).toBe(ukvnEncode(19, 13, 6));
      expect(kjv.map(ukvnEncode(19, 13, 6)).tkvn).toBe(ukvnEncode(19, 13, 6));
      const viaOsnb = new CrossMapper(osnb, t).map(new CrossMapper(t, osnb).map(ukvnEncode(19, 13, 6)).tkvn);
      expect(viaOsnb.tkvn).toBe(ukvnEncode(19, 13, 6));
    });
    it(`${target} Ps 51 (51:3 is «Vær meg nådig, Gud»)`, () => expectPsalm(target, 51, shifted(1, 21, 0)));
    it(`${target} Ps 60`, () => expectPsalm(target, 60, shifted(1, 14, 0)));
  }
});
