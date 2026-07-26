import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BIBLES_DIR = join(__dirname, '../../generate/bibles_raw/osnb');

interface RawVerse {
  bookId: number;
  chapterId: number;
  verseId: number;
  text: string;
}

/**
 * Get number of chapters for a book in osnb.
 */
export function getChapterCount(bookId: number): number {
  const bookDir = join(BIBLES_DIR, String(bookId));
  if (!existsSync(bookDir)) return 0;
  return readdirSync(bookDir).filter(f => f.endsWith('.json')).length;
}

/**
 * Get max verse number for a specific chapter in osnb.
 */
export function getMaxVerse(bookId: number, chapter: number): number {
  const filePath = join(BIBLES_DIR, String(bookId), `${chapter}.json`);
  if (!existsSync(filePath)) return 0;
  const verses: RawVerse[] = JSON.parse(readFileSync(filePath, 'utf-8'));
  if (verses.length === 0) return 0;
  return Math.max(...verses.map(v => v.verseId));
}

/**
 * Check if a specific verse exists in osnb.
 */
export function verseExists(bookId: number, chapter: number, verse: number): boolean {
  const filePath = join(BIBLES_DIR, String(bookId), `${chapter}.json`);
  if (!existsSync(filePath)) return false;
  const verses: RawVerse[] = JSON.parse(readFileSync(filePath, 'utf-8'));
  return verses.some(v => v.verseId === verse);
}

/**
 * Get total verse count across all books in osnb.
 */
export function getTotalVerseCount(): number {
  let total = 0;
  for (let book = 1; book <= 66; book++) {
    const bookDir = join(BIBLES_DIR, String(book));
    if (!existsSync(bookDir)) continue;
    for (const file of readdirSync(bookDir).filter(f => f.endsWith('.json'))) {
      const verses: RawVerse[] = JSON.parse(readFileSync(join(bookDir, file), 'utf-8'));
      total += verses.length;
    }
  }
  return total;
}
