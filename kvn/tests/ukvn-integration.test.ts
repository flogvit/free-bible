import { describe, it, expect } from 'vitest';
import { UkvnMapper } from '../src/ukvn-mapper.js';
import { CrossMapper } from '../src/ukvn-cross-mapper.js';
import { loadUkvnMapping, listUkvnMappings } from '../src/ukvn-loader.js';
import { sliceVersePart } from '../src/ukvn-text-slicer.js';
import { ukvnEncode, ukvnDecode } from '../src/ukvn-types.js';

describe('Full pipeline: KJV -> DNB2024', () => {
  const kjvMapper = new UkvnMapper(loadUkvnMapping('english_kj'));
  const dnb2024Mapper = new UkvnMapper(loadUkvnMapping('dnb2024'));
  const cross = new CrossMapper(kjvMapper, dnb2024Mapper);

  it('maps all 66 books chapter 1 verse 1 as identity', () => {
    for (let book = 1; book <= 66; book++) {
      const kjvVerse = ukvnEncode(book, 1, 1);
      const result = cross.map(kjvVerse);
      expect(result.tkvn).toBe(kjvVerse);
      expect(result.partial).toBe(false);
    }
  });

  it('maps KJV Sal 23:1 -> DNB2024 Sal 23:1 (identity psalm)', () => {
    const v = ukvnEncode(19, 23, 1);
    const result = cross.map(v);
    expect(result.tkvn).toBe(v);
    expect(result.partial).toBe(false);
  });

  it('maps KJV Sal 92:2 -> DNB2024 Sal 92:3 (psalm offset chain)', () => {
    const kjvVerse = ukvnEncode(19, 92, 2);
    const result = cross.map(kjvVerse);
    expect(result.tkvn).toBe(ukvnEncode(19, 92, 3));
    expect(result.partial).toBe(false);
  });

  it('detects partial when KJV verse maps to sub-verse in osmain', () => {
    const v = ukvnEncode(13, 5, 1);
    const result = cross.map(v);
    expect(result.partial).toBe(true);
  });

  it('text slicer extracts correct part from merged verse', () => {
    const osmainText = 'En salme, en sang for sabbatsdagen. Det er godt å takke Herren og lovsynge ditt navn, du Høyeste,';
    expect(sliceVersePart(osmainText, 1, 2)).toBe('En salme, en sang for sabbatsdagen.');
    expect(sliceVersePart(osmainText, 2, 2)).toBe('Det er godt å takke Herren og lovsynge ditt navn, du Høyeste,');
  });
});

describe('Full pipeline: DNB2011 -> osnb', () => {
  const dnb2011Mapper = new UkvnMapper(loadUkvnMapping('dnb2011_nb'));
  const osnbMapper = new UkvnMapper(loadUkvnMapping('osnb'));
  const cross = new CrossMapper(dnb2011Mapper, osnbMapper);

  it('maps DNB2011 Sal 92:3 -> osnb Sal 92:3', () => {
    const dnbVerse = ukvnEncode(19, 92, 3);
    const result = cross.map(dnbVerse);
    expect(result.tkvn).toBe(ukvnEncode(19, 92, 3));
  });
});

describe('All mappings load successfully', () => {
  const systems = ['english_kj', 'dnb2011_nb', 'dnb2024',
                    'dnb30', 'nb1978', 'nb88_nb', 'nb94_nn', 'osnb',
                    'norwegian1921', 'norwegian1938', 'norwegian_bgo'];

  it.each(systems)('loads %s without errors', (system) => {
    const mapping = loadUkvnMapping(system);
    const mapper = new UkvnMapper(mapping);
    expect(mapper.system).toBe(system);
    expect(mapper.entryCount).toBeGreaterThanOrEqual(0);
  });
});
