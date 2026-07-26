/**
 * Add "source" field to all osmain verses that came from osnb.
 * Books 1-39 (OT) = "tanach", Books 40-66 (NT) = "sblgnt"
 * Only adds to verses that don't already have a source field.
 */

import { readFileSync, readdirSync, existsSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';

const OSMAIN_DIR = join(import.meta.dirname, '../../generate/bibles_raw/osmain');

interface VerseData {
  bookId: number;
  chapterId: number;
  verseId: number;
  text: string;
  source?: string;
  [key: string]: any;
}

let updated = 0;
let skipped = 0;

const bookDirs = readdirSync(OSMAIN_DIR)
  .filter(d => /^\d+$/.test(d) && parseInt(d) <= 66 && statSync(join(OSMAIN_DIR, d)).isDirectory())
  .sort((a, b) => parseInt(a) - parseInt(b));

for (const bookStr of bookDirs) {
  const bookId = parseInt(bookStr);
  const source = bookId <= 39 ? 'tanach' : 'sblgnt';
  const bookDir = join(OSMAIN_DIR, bookStr);
  const files = readdirSync(bookDir).filter(f => f.endsWith('.json'));

  for (const f of files) {
    const filePath = join(bookDir, f);
    const verses: VerseData[] = JSON.parse(readFileSync(filePath, 'utf-8'));
    let changed = false;

    for (const v of verses) {
      if (!v.source && v.text !== '[NEEDS_TRANSLATION]') {
        v.source = source;
        updated++;
        changed = true;
      } else {
        skipped++;
      }
    }

    if (changed) {
      writeFileSync(filePath, JSON.stringify(verses, null, 2));
    }
  }
}

console.log(`Added source field: ${updated} verses`);
console.log(`Skipped (already has source or placeholder): ${skipped}`);
