import { describe, it, expect } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

/**
 * A verse's `text` is the verse and nothing else. Translator's notes go in
 * `footnotes`, where a reader opens them; written into the text they stood in the
 * middle of the verse on bible.flogvit.com («…shadow of death,* I fear no evil…
 * [*Footnote: Or "the darkest valley"…]»), and in search, the songs and the MCP's
 * answers (bible.flogvit.com#207). The forms that were found in osen, oses and osnb
 * are the ones held here.
 */

const rawDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'generate', 'bibles_raw');
const OWN = ['osnb', 'osnn', 'osen', 'oses'];

/** A note written into verse text, in any of the forms that were found. */
export const INLINE_NOTE =
  /\[\s*\*?\s*(?:Footnote|Fotnote|Nota|Note)\s*:|\[\*|\[\^[\w-]+\]|<fn>|(?:^|\n\n)\s*\*\S|\*[ \t]+\*\S/i;

describe("own translations: no notes in the verse text", () => {
  for (const ed of OWN) {
    const dir = join(rawDir, ed);
    it(`${ed}: every verse is the verse alone`, { timeout: 60_000 }, () => {
      const books = readdirSync(dir).filter((b) => /^\d+$/.test(b));
      // A sparse or missing checkout would make this pass by measuring nothing.
      expect(books.length).toBe(66);
      const found: string[] = [];
      for (const b of books) {
        for (const f of readdirSync(join(dir, b)).filter((f) => f.endsWith('.json'))) {
          for (const v of JSON.parse(readFileSync(join(dir, b, f), 'utf8'))) {
            if (INLINE_NOTE.test(v.text) || v.text.includes('*')) found.push(`${b}:${f.replace('.json', '')}:${v.verseId}`);
          }
        }
      }
      expect(found).toEqual([]);
    });
  }

  it('the pattern knows every form that was found', () => {
    for (const s of [
      'death,* I fear [*Footnote: Or "the darkest valley"]',
      'text [Footnote: Ishmael means "God hears."]',
      'text [footnote: The Hebrew]',
      'text [Fotnote: Den hebraiske]',
      'Edom.[nota: «Edom» suena]',
      'Mahanaim.[^1]\n\n[^1]: Mahanaim means',
      'heads.<fn>Hebrew raqia</fn>',
      'Cabul, a name\n\n*Cabul sounds like',
      "armor?*  *Or 'within his double bridle'",
      'it?"* [*Or "What advantage"]',
    ]) {
      expect(INLINE_NOTE.test(s), s).toBe(true);
    }
    expect(INLINE_NOTE.test('In the beginning God created the heavens and the earth.')).toBe(false);
  });
});
