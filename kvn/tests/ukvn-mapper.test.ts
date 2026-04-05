import { describe, it, expect } from 'vitest';
import { ukvnEncode, ukvnDecode, UKVN_PART_SIZE, UKVN_MAX_VERSE, UKVN_MAX_CHAPTER } from '../src/ukvn-types.js';
import { UkvnMapper } from '../src/ukvn-mapper.js';
import { loadUkvnMapping, listUkvnMappings } from '../src/ukvn-loader.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { UkvnMappingFile } from '../src/ukvn-types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadMapping(name: string): UkvnMappingFile {
  return JSON.parse(readFileSync(join(__dirname, `../mappings/${name}.ukvn.json`), 'utf-8'));
}

describe('ukvn encoding', () => {
  it('encodes book 1, chapter 1, verse 1, part 0', () => {
    const kvn = ukvnEncode(1, 1, 1);
    expect(kvn).toBe((1 * 151 + 1) * 177 * 16 + 1 * 16);
  });

  it('round-trips encode/decode', () => {
    const kvn = ukvnEncode(19, 92, 15, 2);
    const d = ukvnDecode(kvn);
    expect(d).toEqual({ book: 19, chapter: 92, verse: 15, part: 2 });
  });

  it('encodes sub-verse parts', () => {
    const base = ukvnEncode(19, 92, 1, 0);
    const partA = ukvnEncode(19, 92, 1, 1);
    const partB = ukvnEncode(19, 92, 1, 2);
    expect(partA).toBe(base + 1);
    expect(partB).toBe(base + 2);
  });

  it('round-trips all 66 books chapter 1 verse 1', () => {
    for (let book = 1; book <= 66; book++) {
      const kvn = ukvnEncode(book, 1, 1);
      const d = ukvnDecode(kvn);
      expect(d.book).toBe(book);
      expect(d.chapter).toBe(1);
      expect(d.verse).toBe(1);
      expect(d.part).toBe(0);
    }
  });

  it('constants are correct', () => {
    expect(UKVN_PART_SIZE).toBe(16);
    expect(UKVN_MAX_VERSE).toBe(177);
    expect(UKVN_MAX_CHAPTER).toBe(151);
  });
});

describe('UkvnMapper', () => {
  describe('KJV mapping (simple, 30 entries)', () => {
    const mapper = new UkvnMapper(loadMapping('english_kj'));

    it('returns identity for unmapped verses', () => {
      const gen1_1 = ukvnEncode(1, 1, 1);
      expect(mapper.toTkvn(gen1_1)).toBe(gen1_1);
      expect(mapper.toKvn(gen1_1)).toBe(gen1_1);
    });

    it('maps 1 Krøn 5:2 (osmain) -> 1 Krøn 5:3 (KJV)', () => {
      const osmain = ukvnEncode(13, 5, 2);
      const kjv = ukvnEncode(13, 5, 3);
      expect(mapper.toTkvn(osmain)).toBe(kjv);
    });

    it('maps 1 Krøn 5:3 (KJV) -> 1 Krøn 5:2 (osmain)', () => {
      const kjv = ukvnEncode(13, 5, 3);
      const osmain = ukvnEncode(13, 5, 2);
      expect(mapper.toKvn(kjv)).toBe(osmain);
    });

    it('maps sub-verse: osmain 5:1a -> KJV 5:1', () => {
      const osmainPart = ukvnEncode(13, 5, 1, 1);
      const kjv = ukvnEncode(13, 5, 1);
      expect(mapper.toTkvn(osmainPart)).toBe(kjv);
    });

    it('maps sub-verse: osmain 5:1b -> KJV 5:2', () => {
      const osmainPart = ukvnEncode(13, 5, 1, 2);
      const kjv = ukvnEncode(13, 5, 2);
      expect(mapper.toTkvn(osmainPart)).toBe(kjv);
    });

    it('reverse: KJV 5:1 -> osmain 5:1a', () => {
      const kjv = ukvnEncode(13, 5, 1);
      const osmainPart = ukvnEncode(13, 5, 1, 1);
      expect(mapper.toKvn(kjv)).toBe(osmainPart);
    });

    it('maps cross-chapter: osmain Åp 12:18 -> KJV Åp 13:1a', () => {
      const osmain = ukvnEncode(66, 12, 18);
      const kjv = ukvnEncode(66, 13, 1, 1);
      expect(mapper.toTkvn(osmain)).toBe(kjv);
    });

    it('reports system name', () => {
      expect(mapper.system).toBe('english_kj');
    });
  });

  describe('DNB2011 mapping (complex, with psalms)', () => {
    const mapper = new UkvnMapper(loadMapping('dnb2011_nb'));

    it('maps psalm superscription: osmain Sal 92:1a -> dnb Sal 92:1', () => {
      const osmain = ukvnEncode(19, 92, 1, 1);
      const dnb = ukvnEncode(19, 92, 1);
      expect(mapper.toTkvn(osmain)).toBe(dnb);
    });

    it('maps psalm offset: osmain Sal 92:2 -> dnb Sal 92:3', () => {
      const osmain = ukvnEncode(19, 92, 2);
      const dnb = ukvnEncode(19, 92, 3);
      expect(mapper.toTkvn(osmain)).toBe(dnb);
    });

    it('has more than 1000 entries', () => {
      expect(mapper.entryCount).toBeGreaterThan(1000);
    });
  });
});

describe('ukvn-loader', () => {
  it('loads english_kj mapping by name', () => {
    const mapping = loadUkvnMapping('english_kj');
    expect(mapping.system).toBe('english_kj');
    expect(mapping.map.length).toBeGreaterThan(0);
  });

  it('lists available mappings', () => {
    const names = listUkvnMappings();
    expect(names).toContain('english_kj');
    expect(names).toContain('dnb2011_nb');
    expect(names).toContain('osnb2');
  });

  it('throws for unknown mapping', () => {
    expect(() => loadUkvnMapping('nonexistent')).toThrow();
  });
});
