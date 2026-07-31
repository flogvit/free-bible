import { describe, it, expect } from 'bun:test';
import {
  REF_MARKUP_REGEX,
  parseRefMarkup,
  parseAllRefMarkups,
  buildRefMarkup,
  buildRefMarkupFromIds,
  refMarkupToKvn,
  validateRefMarkup,
} from '../src/ref-markup.js';

describe('REF_MARKUP_REGEX', () => {
  it('matches a simple ref', () => {
    const text = 'Se [ref:Joh 3:16|Johannes 3:16] for detaljer.';
    const matches = [...text.matchAll(new RegExp(REF_MARKUP_REGEX.source, 'g'))];
    expect(matches).toHaveLength(1);
    expect(matches[0][1]).toBe('Joh 3:16');
    expect(matches[0][2]).toBe('Johannes 3:16');
  });

  it('matches multiple refs', () => {
    const text = '[ref:1 Mos 1:1|1. Mosebok 1:1] og [ref:Joh 3:16|Johannes 3:16]';
    const matches = [...text.matchAll(new RegExp(REF_MARKUP_REGEX.source, 'g'))];
    expect(matches).toHaveLength(2);
  });

  it('does not match malformed refs', () => {
    const text = '[ref:Joh 3:16] [ref:|text] [Joh 3:16|text]';
    const matches = [...text.matchAll(new RegExp(REF_MARKUP_REGEX.source, 'g'))];
    expect(matches).toHaveLength(0);
  });
});

describe('parseRefMarkup', () => {
  it('parses a simple reference', () => {
    const ref = parseRefMarkup('[ref:Joh 3:16|Johannes 3:16]');
    expect(ref.book).toBe('Joh');
    expect(ref.chapter).toBe(3);
    expect(ref.verseSpec).toBe('16');
    expect(ref.system).toBeUndefined();
    expect(ref.displayText).toBe('Johannes 3:16');
  });

  it('parses a numbered book', () => {
    const ref = parseRefMarkup('[ref:1 Mos 1:1-3|1. Mosebok 1:1-3]');
    expect(ref.book).toBe('1 Mos');
    expect(ref.chapter).toBe(1);
    expect(ref.verseSpec).toBe('1-3');
    expect(ref.displayText).toBe('1. Mosebok 1:1-3');
  });

  it('parses a whole chapter reference', () => {
    const ref = parseRefMarkup('[ref:Sal 23|Salme 23]');
    expect(ref.book).toBe('Sal');
    expect(ref.chapter).toBe(23);
    expect(ref.verseSpec).toBe('');
    expect(ref.displayText).toBe('Salme 23');
  });

  it('parses a sub-verse reference', () => {
    const ref = parseRefMarkup('[ref:Mi 5:1-4a|Mika 5:1-4a]');
    expect(ref.book).toBe('Mi');
    expect(ref.chapter).toBe(5);
    expect(ref.verseSpec).toBe('1-4a');
    expect(ref.displayText).toBe('Mika 5:1-4a');
  });

  it('parses a reference with system', () => {
    const ref = parseRefMarkup('[ref:Joh 3:16@dnb_2011_nb|Johannes 3:16]');
    expect(ref.book).toBe('Joh');
    expect(ref.chapter).toBe(3);
    expect(ref.verseSpec).toBe('16');
    expect(ref.system).toBe('dnb_2011_nb');
    expect(ref.displayText).toBe('Johannes 3:16');
  });

  it('parses a dot-separated verse range', () => {
    const ref = parseRefMarkup('[ref:Ordsp 8:1-2.22-31|Ordspråkene 8:1-2.22-31]');
    expect(ref.book).toBe('Ordsp');
    expect(ref.chapter).toBe(8);
    expect(ref.verseSpec).toBe('1-2.22-31');
  });

  it('parses a cross-chapter range', () => {
    const ref = parseRefMarkup('[ref:1 Mos 1:26-2:2|1. Mosebok 1:26-2:2]');
    expect(ref.book).toBe('1 Mos');
    expect(ref.chapter).toBe(1);
    expect(ref.verseSpec).toBe('26-2:2');
  });

  it('throws on invalid markup', () => {
    expect(() => parseRefMarkup('[ref:Joh 3:16]')).toThrow();
    expect(() => parseRefMarkup('not a ref')).toThrow();
  });
});

describe('parseAllRefMarkups', () => {
  it('finds all refs with positions', () => {
    const text = 'Se [ref:Joh 3:16|Johannes 3:16] og [ref:1 Mos 1:1|1. Mosebok 1:1] her.';
    const matches = parseAllRefMarkups(text);
    expect(matches).toHaveLength(2);

    expect(matches[0].ref.book).toBe('Joh');
    expect(matches[0].start).toBe(3);
    expect(matches[0].fullMatch).toBe('[ref:Joh 3:16|Johannes 3:16]');

    expect(matches[1].ref.book).toBe('1 Mos');
    expect(matches[1].start).toBe(35);
  });

  it('returns empty array for text without refs', () => {
    expect(parseAllRefMarkups('Ingen referanser her.')).toHaveLength(0);
  });

  it('skips invalid markups gracefully', () => {
    const text = '[ref:|bad] og [ref:Joh 3:16|OK]';
    const matches = parseAllRefMarkups(text);
    expect(matches).toHaveLength(1);
    expect(matches[0].ref.book).toBe('Joh');
  });
});

describe('buildRefMarkup', () => {
  it('builds a simple reference', () => {
    const result = buildRefMarkup({
      book: 'Joh', chapter: 3, verseSpec: '16', displayText: 'Johannes 3:16',
    });
    expect(result).toBe('[ref:Joh 3:16|Johannes 3:16]');
  });

  it('builds a whole chapter reference', () => {
    const result = buildRefMarkup({
      book: 'Sal', chapter: 23, verseSpec: '', displayText: 'Salme 23',
    });
    expect(result).toBe('[ref:Sal 23|Salme 23]');
  });

  it('builds a reference with system', () => {
    const result = buildRefMarkup({
      book: 'Joh', chapter: 3, verseSpec: '16', system: 'dnb_2011_nb', displayText: 'Johannes 3:16',
    });
    expect(result).toBe('[ref:Joh 3:16@dnb_2011_nb|Johannes 3:16]');
  });

  it('roundtrips through parse', () => {
    const original = '[ref:1 Mos 1:26-2:2|1. Mosebok 1:26-2:2]';
    const parsed = parseRefMarkup(original);
    const rebuilt = buildRefMarkup(parsed);
    expect(rebuilt).toBe(original);
  });
});

describe('buildRefMarkupFromIds', () => {
  it('builds from numeric book ID', () => {
    const result = buildRefMarkupFromIds(43, 3, '16', 'Johannes 3:16');
    expect(result).toBe('[ref:Joh 3:16|Johannes 3:16]');
  });

  it('builds with system', () => {
    const result = buildRefMarkupFromIds(43, 3, '16', 'Johannes 3:16', 'dnb_2011_nb');
    expect(result).toBe('[ref:Joh 3:16@dnb_2011_nb|Johannes 3:16]');
  });

  it('throws on unknown book ID', () => {
    expect(() => buildRefMarkupFromIds(999, 1, '1', 'test')).toThrow('Unknown book ID');
  });
});

describe('refMarkupToKvn', () => {
  it('converts simple ref to KVN format', () => {
    expect(refMarkupToKvn('[ref:Joh 3:16|Johannes 3:16]')).toBe('Joh 3,16');
  });

  it('converts range ref to KVN format', () => {
    expect(refMarkupToKvn('[ref:Ordsp 8:1-2.22-31|Ordspråkene 8:1-2.22-31]')).toBe('Ordsp 8,1-2.22-31');
  });

  it('converts cross-chapter ref to KVN format', () => {
    expect(refMarkupToKvn('[ref:1 Mos 1:26-2:2|1. Mosebok 1:26-2:2]')).toBe('1 Mos 1,26-2,2');
  });

  it('converts whole chapter ref', () => {
    expect(refMarkupToKvn('[ref:Sal 23|Salme 23]')).toBe('Sal 23');
  });
});

describe('validateRefMarkup', () => {
  it('returns null for valid ref', () => {
    expect(validateRefMarkup('[ref:Joh 3:16|Johannes 3:16]')).toBeNull();
  });

  it('returns null for valid numbered book', () => {
    expect(validateRefMarkup('[ref:1 Mos 1:1|1. Mosebok 1:1]')).toBeNull();
  });

  it('returns null for valid whole chapter', () => {
    expect(validateRefMarkup('[ref:Sal 23|Salme 23]')).toBeNull();
  });

  it('returns error for unknown book', () => {
    const err = validateRefMarkup('[ref:Xyz 1:1|Xyz 1:1]');
    expect(err).toContain('Unknown book abbreviation');
  });

  it('returns error for invalid syntax', () => {
    const err = validateRefMarkup('not valid');
    expect(err).toBeTruthy();
  });

  it('returns error for invalid verse spec', () => {
    const err = validateRefMarkup('[ref:Joh 3:!@#|bad]');
    expect(err).toBeTruthy();
  });

  it('accepts sub-verse references', () => {
    expect(validateRefMarkup('[ref:Mi 5:1-4a|Mika 5:1-4a]')).toBeNull();
  });

  it('accepts dot-separated ranges', () => {
    expect(validateRefMarkup('[ref:Ordsp 8:1-2.22-31|Ordspråkene 8:1-2.22-31]')).toBeNull();
  });

  it('accepts alias book names', () => {
    expect(validateRefMarkup('[ref:Salme 23:1|Salme 23:1]')).toBeNull();
    expect(validateRefMarkup('[ref:Amos 3:1|Amos 3:1]')).toBeNull();
    expect(validateRefMarkup('[ref:Mika 5:1|Mika 5:1]')).toBeNull();
  });
});
