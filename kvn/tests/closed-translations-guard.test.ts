import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

/**
 * Guard mot at lukkede (opphavsrettsbeskyttede) bibeloversettelser committes.
 *
 * To lag, fordi gitignore alene ikke beskytter mot `git add -f`
 * eller filer som allerede er tracket:
 *  1. Hvitelista i generate/bibles_raw/.gitignore må være intakt
 *     (default-deny) og må aldri inneholde kjente lukkede oversettelser.
 *  2. `git ls-files` må ikke inneholde filer utenfor hvitelista.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const gitignorePath = join(repoRoot, 'generate', 'bibles_raw', '.gitignore');

// Oversettelser som ALDRI skal committes (jf. issue #17).
// Navnevarianter tas med så en omdøping ikke smetter forbi.
const CLOSED_TRANSLATIONS = [
  'dnb2011_nb', 'dnb2011', 'dnb2024_nb', 'dnb2024',
  'nb-1978', 'nb1978', 'nb_1978',
  'nb-2024', 'nb2024', 'nb_2024',
  'nb88_nb', 'nb88', 'nb94_nn', 'nb94',
  'nn-2024', 'nn2024', 'nn_2024', 'nn2024_nn',
];

function loadWhitelist(): { lines: string[]; translations: string[] } {
  const lines = readFileSync(gitignorePath, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  const translations = lines
    .filter((l) => l.startsWith('!/') && l !== '!/.gitignore')
    .map((l) => l.replace(/^!\//, '').replace(/\/$/, ''));
  return { lines, translations };
}

describe('bibles_raw whitelist gitignore (lag 1)', () => {
  it('er default-deny: /* før negasjonene, og !/.gitignore med', () => {
    const { lines } = loadWhitelist();
    const denyIdx = lines.indexOf('/*');
    expect(denyIdx, 'mangler /*-regelen som ignorerer alt').toBeGreaterThanOrEqual(0);
    expect(lines.slice(0, denyIdx).every((l) => !l.startsWith('!'))).toBe(true);
    expect(lines).toContain('!/.gitignore');
  });

  it('hvitelister ingen lukkede oversettelser', () => {
    const { translations } = loadWhitelist();
    for (const closed of CLOSED_TRANSLATIONS) {
      expect(translations, `lukket oversettelse «${closed}» står i hvitelista`).not.toContain(closed);
    }
  });
});

describe('git-tracked filer i bibles_raw (lag 2)', () => {
  const tracked = execSync('git ls-files generate/bibles_raw', {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\n')
    .filter(Boolean);

  it('inneholder ingen filer fra lukkede oversettelser', () => {
    const offenders = tracked.filter((f) => {
      const translation = f.split('/')[2];
      return CLOSED_TRANSLATIONS.includes(translation);
    });
    expect(offenders, `lukkede oversettelser er tracket: ${offenders.slice(0, 5).join(', ')}`).toEqual([]);
  });

  it('er en delmengde av hvitelista (fanger git add -f av hva som helst)', () => {
    const { translations } = loadWhitelist();
    const allowed = new Set(translations);
    const offenders = tracked.filter((f) => {
      const rest = f.slice('generate/bibles_raw/'.length);
      if (rest === '.gitignore') return false;
      return !allowed.has(rest.split('/')[0]);
    });
    expect(
      offenders,
      `trackede filer utenfor hvitelista: ${offenders.slice(0, 5).join(', ')}`
    ).toEqual([]);
  });
});
