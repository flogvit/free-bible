import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { UkvnMapper } from '../src/ukvn-mapper.js';
import { CrossMapper } from '../src/ukvn-cross-mapper.js';
import { ukvnEncode } from '../src/ukvn-types.js';
import type { UkvnMappingFile } from '../src/ukvn-types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadMapping(name: string): UkvnMappingFile {
  return JSON.parse(readFileSync(join(__dirname, `../mappings/${name}.ukvn.json`), 'utf-8'));
}

describe('CrossMapper', () => {
  const kjv = new UkvnMapper(loadMapping('english_kj'));
  const dnb2024 = new UkvnMapper(loadMapping('dnb2024_nb'));

  describe('KJV -> DNB2024', () => {
    const cross = new CrossMapper(kjv, dnb2024);

    it('maps identity verse (Gen 1:1) through both systems', () => {
      const kjvVerse = ukvnEncode(1, 1, 1);
      const result = cross.map(kjvVerse);
      expect(result.tkvn).toBe(kjvVerse);
      expect(result.partial).toBe(false);
    });

    it('maps KJV 1 Krøn 5:3 -> DNB2024 5:3 (via osmain 5:2)', () => {
      const kjvVerse = ukvnEncode(13, 5, 3);
      const result = cross.map(kjvVerse);
      // KJV 5:3 -> osmain 5:2, then DNB2024 maps osmain 5:2 -> DNB2024 5:3
      expect(result.osmainKvn).toBe(ukvnEncode(13, 5, 2));
      expect(result.tkvn).toBe(ukvnEncode(13, 5, 3));
      expect(result.partial).toBe(false);
    });

    it('maps KJV Sal 92:2 -> DNB2024 Sal 92:3 (psalm offset)', () => {
      const kjvVerse = ukvnEncode(19, 92, 2);
      const result = cross.map(kjvVerse);
      expect(result.tkvn).toBe(ukvnEncode(19, 92, 3));
    });

    it('marks partial when source maps to sub-verse', () => {
      const kjvVerse = ukvnEncode(13, 5, 1);
      const result = cross.map(kjvVerse);
      expect(result.partial).toBe(true);
      expect(result.osmainKvn).toBe(ukvnEncode(13, 5, 1, 1));
    });
  });

  describe('DNB2024 -> KJV', () => {
    const cross = new CrossMapper(dnb2024, kjv);

    it('maps DNB2024 Sal 92:3 -> KJV Sal 92:2', () => {
      const dnbVerse = ukvnEncode(19, 92, 3);
      const result = cross.map(dnbVerse);
      expect(result.tkvn).toBe(ukvnEncode(19, 92, 2));
    });
  });
});
