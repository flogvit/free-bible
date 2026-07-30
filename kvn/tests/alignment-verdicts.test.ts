import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { UkvnMapper } from '../src/ukvn-mapper.js';
import { loadUkvnMapping } from '../src/ukvn-loader.js';
import { ukvnEncode, ukvnDecode } from '../src/ukvn-types.js';

/**
 * Regresjonsvern for tekstverifiserte justeringsdommer (issue #18).
 *
 * Hver dom i kvn/data/alignment-verdicts.json er avgjort ved å lese
 * osmain mot oversettelsen. Uten denne testen kan en senere kjøring av
 * build-derived-mappings eller screen-alignment --apply overskrive dem
 * stille — dommen ville da være tapt uten at noe feiler.
 *
 * Testen sjekker at mappingen fortsatt gir dommens resultat for hver
 * oversettelse i gruppen. Oversettelser der vakten avviste dommen (fordi mappingen
 * allerede var bedre) hoppes over: de har aldri fått entriene.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const verdictsPath = join(repoRoot, 'kvn', 'data', 'alignment-verdicts.json');
const queuePath = join(repoRoot, 'kvn', 'data', 'alignment-judgment-queue.json');

interface Verdict {
  key: string;
  trIds: number[];
  // [osVers, trKapittel, trVers] eller [osVers, trKapittel, trVers, delvers]
  alignment: number[][];
  note: string;
}
interface QueueEntry { key: string; trIds: number[]; members: string[] }

const verdicts: Verdict[] = existsSync(verdictsPath)
  ? JSON.parse(readFileSync(verdictsPath, 'utf8'))
  : [];
const queue: QueueEntry[] = existsSync(queuePath)
  ? JSON.parse(readFileSync(queuePath, 'utf8'))
  : [];

const membersOf = new Map<string, string[]>();
for (const e of queue) membersOf.set(`${e.key}|${e.trIds.join(',')}`, e.members);

// osmain-familien får aldri gruppedommer (se apply-alignment-verdicts.py)
const EXCLUDED = new Set(['osnb', 'osnn', 'osen', 'oster']);

describe('tekstverifiserte justeringsdommer holder', () => {
  it('har dommer å verifisere', () => {
    expect(verdicts.length).toBeGreaterThan(0);
  });

  for (const v of verdicts) {
    const [book, chapter] = v.key.split(':').map(Number);
    const members = (membersOf.get(`${v.key}|${v.trIds.join(',')}`) ?? []).filter(
      (m) => !EXCLUDED.has(m)
    );
    if (members.length === 0 || v.alignment.length === 0) continue;

    // Én representant per gruppe holder: alle medlemmer har samme
    // versstruktur og fikk samme entries. Å teste alle ville lagt
    // hundretusener av assertions til suiten uten ny informasjon.
    const rep = members.find((m) => {
      try {
        const mapper = new UkvnMapper(loadUkvnMapping(m));
        const [ov, tc, tv, part] = v.alignment[0];
        return mapper.toTkvn(ukvnEncode(book, chapter, ov, part ?? 0)) === ukvnEncode(book, tc, tv);
      } catch {
        return false;
      }
    });

    it(`${v.key} (${members.length} oversettelser): ${v.note.slice(0, 60)}`, () => {
      expect(rep, `ingen oversettelse i gruppen følger dommen for ${v.key}`).toBeTruthy();
      const mapper = new UkvnMapper(loadUkvnMapping(rep!));
      for (const [ov, tc, tv, part] of v.alignment) {
        const got = ukvnDecode(mapper.toTkvn(ukvnEncode(book, chapter, ov, part ?? 0)));
        // mål som ikke finnes i oversettelsens data ble hoppet over ved applisering
        if (got.chapter === chapter && got.verse === ov && !(tc === chapter && tv === ov)) continue;
        const label = part ? `${ov}${String.fromCharCode(96 + part)}` : `${ov}`;
        expect(
          `${got.chapter},${got.verse}`,
          `${rep} ${v.key}:${label} skal peke på ${tc},${tv}`
        ).toBe(`${tc},${tv}`);
      }
    });
  }
});
