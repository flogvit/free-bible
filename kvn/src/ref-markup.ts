import { BOOK_IDS, BOOK_NAMES, encode, decode } from './types.js';

// ============================================================
// Ref markup format: [ref:BOK KAPITTEL:VERS@SYSTEM|VISNINGSTEKST]
// ============================================================

/** Regex to match a single [ref:...] markup in text */
export const REF_MARKUP_REGEX = /\[ref:([^|\]]+)\|([^\]]+)\]/g;

/** Parsed ref markup object */
export interface RefMarkup {
  book: string;       // KVN abbreviation, e.g. "Joh", "1 Mos"
  chapter: number;
  verseSpec: string;  // e.g. "16", "1-3", "1-4a", "1:26-2:2", "1-2.22-31", or "" for whole chapter
  system?: string;    // e.g. "dnb_2011_nb", undefined = osnb2
  displayText: string;
}

/** Match result with position info */
export interface RefMarkupMatch {
  ref: RefMarkup;
  fullMatch: string;
  start: number;
  end: number;
}

/**
 * Parse the reference part (before the pipe) of a ref markup.
 * Format: "BOK KAPITTEL:VERS@SYSTEM" or "BOK KAPITTEL@SYSTEM" or "BOK KAPITTEL:VERS"
 */
function parseRefPart(refPart: string): Omit<RefMarkup, 'displayText'> {
  let remaining = refPart.trim();
  let system: string | undefined;

  // Extract @SYSTEM if present
  const atIdx = remaining.lastIndexOf('@');
  if (atIdx !== -1) {
    system = remaining.slice(atIdx + 1).trim();
    remaining = remaining.slice(0, atIdx).trim();
  }

  // Split into book + chapter:verse
  // Book names can start with digits like "1 Mos", "2 Kong"
  // Pattern: everything up to the last space before a digit group is the book
  const match = remaining.match(/^(.+?)\s+(\d.*)$/);
  if (!match) {
    throw new Error(`Invalid ref markup reference: "${refPart}"`);
  }

  const book = match[1].trim();
  const chapterVerse = match[2].trim();

  // Split on first colon for chapter:verse
  const colonIdx = chapterVerse.indexOf(':');
  if (colonIdx === -1) {
    // Whole chapter reference like "Sal 23"
    const chapter = parseInt(chapterVerse, 10);
    if (isNaN(chapter)) {
      throw new Error(`Invalid chapter in ref markup: "${refPart}"`);
    }
    return { book, chapter, verseSpec: '', system };
  }

  const chapter = parseInt(chapterVerse.slice(0, colonIdx), 10);
  if (isNaN(chapter)) {
    throw new Error(`Invalid chapter in ref markup: "${refPart}"`);
  }
  const verseSpec = chapterVerse.slice(colonIdx + 1).trim();

  return { book, chapter, verseSpec, system };
}

/**
 * Parse a single [ref:...|...] markup string into a RefMarkup object.
 * Input should be the full markup including brackets.
 */
export function parseRefMarkup(markup: string): RefMarkup {
  const m = markup.match(/^\[ref:([^|\]]+)\|([^\]]+)\]$/);
  if (!m) {
    throw new Error(`Invalid ref markup: "${markup}"`);
  }

  const parsed = parseRefPart(m[1]);
  return { ...parsed, displayText: m[2] };
}

/**
 * Find all [ref:...|...] markups in a text string with position info.
 */
export function parseAllRefMarkups(text: string): RefMarkupMatch[] {
  const results: RefMarkupMatch[] = [];
  const regex = new RegExp(REF_MARKUP_REGEX.source, 'g');
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    try {
      const parsed = parseRefPart(match[1]);
      results.push({
        ref: { ...parsed, displayText: match[2] },
        fullMatch: match[0],
        start: match.index,
        end: match.index + match[0].length,
      });
    } catch {
      // Skip invalid markups
    }
  }

  return results;
}

/**
 * Build a [ref:...|...] markup string from a RefMarkup object.
 */
export function buildRefMarkup(ref: RefMarkup): string {
  let refPart = `${ref.book} ${ref.chapter}`;
  if (ref.verseSpec) {
    refPart += `:${ref.verseSpec}`;
  }
  if (ref.system) {
    refPart += `@${ref.system}`;
  }
  return `[ref:${refPart}|${ref.displayText}]`;
}

/**
 * Build a [ref:...|...] markup from numeric book ID, chapter, verse spec.
 */
export function buildRefMarkupFromIds(
  bookId: number,
  chapter: number,
  verseSpec: string,
  displayText: string,
  system?: string,
): string {
  const book = BOOK_NAMES[bookId];
  if (!book) {
    throw new Error(`Unknown book ID: ${bookId}`);
  }
  return buildRefMarkup({ book, chapter, verseSpec, displayText, system });
}

/**
 * Convert a ref markup's reference to KVN-compatible format.
 * Translates colon notation (3:16) to comma notation (3,16) used by parseRef.
 * Returns the KVN reference string like "Joh 3,16".
 */
export function refMarkupToKvn(markup: string): string {
  const ref = parseRefMarkup(markup);

  if (!ref.verseSpec) {
    // Whole chapter — KVN doesn't have a "whole chapter" format,
    // but we return the book + chapter for reference
    return `${ref.book} ${ref.chapter}`;
  }

  // Convert colon cross-chapter ranges like "1:26-2:2" to KVN format "1,26-2,2"
  // and simple verse specs like "16" stay as "3,16"
  const kvnVerseSpec = ref.verseSpec.replace(/:/g, ',');
  return `${ref.book} ${ref.chapter},${kvnVerseSpec}`;
}

/**
 * Validate a ref markup string. Returns null if valid, error message if invalid.
 */
export function validateRefMarkup(markup: string): string | null {
  try {
    const ref = parseRefMarkup(markup);

    // Check book abbreviation
    if (BOOK_IDS[ref.book] === undefined) {
      return `Unknown book abbreviation: "${ref.book}"`;
    }

    // Check chapter is positive
    if (ref.chapter < 1) {
      return `Invalid chapter number: ${ref.chapter}`;
    }

    // Check verse spec syntax if present
    if (ref.verseSpec) {
      // Allow digits, letters a-c, dashes, dots, colons (for cross-chapter ranges)
      if (!/^[\da-c:.\-–]+$/.test(ref.verseSpec)) {
        return `Invalid verse specification: "${ref.verseSpec}"`;
      }
    }

    // Check display text is non-empty
    if (!ref.displayText.trim()) {
      return 'Empty display text';
    }

    return null;
  } catch (e: any) {
    return e.message;
  }
}
