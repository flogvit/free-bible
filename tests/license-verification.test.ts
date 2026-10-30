import { describe, it, expect } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

/**
 * A licence verification (bible.flogvit.com#170) is what a publisher acts on:
 * only `verification.status: "confirmed"` lets a translation out on the site
 * and in the MCP. So a verification has to carry its proof — the source's URL
 * and its own words — and a "not_confirmed" has to say why, or the next person
 * cannot tell a checked "no" from a guess.
 *
 * A license.json WITHOUT `verification` is a harvested claim nobody has
 * checked yet, and is allowed: it just cannot be published.
 */

const rawDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'generate', 'bibles_raw');

const verified = readdirSync(rawDir, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => ({ id: e.name, path: join(rawDir, e.name, 'license.json') }))
  .filter((t) => existsSync(t.path))
  .map((t) => ({ ...t, rec: JSON.parse(readFileSync(t.path, 'utf8')) }))
  .filter((t) => t.rec.verification);

describe('licence verification', () => {
  it('exists for at least the first group of #170', () => {
    expect(verified.length).toBeGreaterThanOrEqual(10);
  });

  for (const { id, rec } of verified) {
    const v = rec.verification;
    it(`${id}: a status, a date, and evidence with the source's own words`, () => {
      expect(['confirmed', 'not_confirmed']).toContain(v.status);
      expect(v.checked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(v.evidence.length).toBeGreaterThan(0);
      for (const e of v.evidence) {
        expect(e.url).toMatch(/^https:\/\//);
        expect(e.quote.trim().length).toBeGreaterThan(10);
      }
      expect(rec.translation).toBe(id);
    });
    // What a reader sees under the text is `credits`, never `statement`: a
    // confirmed licence that asks for credit must say whom, with links.
    if (v.status === 'confirmed' && rec.attribution_required) {
      it(`${id}: a licence that asks for credit names its sources for the reader`, () => {
        expect(rec.credits?.length ?? 0).toBeGreaterThan(0);
        for (const c of rec.credits) {
          expect(c.name.trim().length).toBeGreaterThan(0);
          expect(c.url).toMatch(/^https:\/\//);
          expect(['translated_from', 'text']).toContain(c.relation);
          if (c.license_url) expect(c.license_url).toMatch(/^https:\/\//);
        }
      });
    }
    if (v.status === 'not_confirmed') {
      it(`${id}: a "not confirmed" says why`, () => {
        expect((v.note ?? '').trim().length).toBeGreaterThan(40);
      });
    }
  }
});
