import { encode, decode, formatKvn, BOOK_IDS, BOOK_NAMES } from './types.js';
import type { KvnMappingFile, MaxVerseProvider } from './types.js';

/**
 * Converts between basis KVN and translation KVN (tkvn).
 *
 * kvn  = basis reference (osnb2/tanach/sblgnt coordinates encoded as bitfield)
 * tkvn = translation reference (e.g. dnb_2011_nb coordinates encoded as bitfield)
 */
export class KVNConverter {
  private kvnToTkvn: Map<number, number>;
  private tkvnToKvn: Map<number, number>;
  private extraTkvns: Set<number>;
  private extraAfterKvn: Map<number, number>; // tkvn -> afterKvn
  readonly system: string;

  constructor(mapping: KvnMappingFile) {
    this.system = mapping.system;
    this.kvnToTkvn = new Map();
    this.tkvnToKvn = new Map();
    this.extraTkvns = new Set();
    this.extraAfterKvn = new Map();

    for (const [kvn, tkvn] of mapping.map) {
      this.kvnToTkvn.set(kvn, tkvn);
      this.tkvnToKvn.set(tkvn, kvn);
    }

    for (const [tkvn, , afterKvn] of mapping.extraVerses) {
      this.extraTkvns.add(tkvn);
      this.extraAfterKvn.set(tkvn, afterKvn);
    }
  }

  /** Convert basis kvn to translation tkvn. Identity if not in map. */
  toTkvn(kvn: number): number {
    return this.kvnToTkvn.get(kvn) ?? kvn;
  }

  /** Convert translation tkvn to basis kvn. Returns null for extra verses. */
  toKvn(tkvn: number): number | null {
    if (this.extraTkvns.has(tkvn)) return null;
    return this.tkvnToKvn.get(tkvn) ?? tkvn;
  }

  /** Check if a tkvn is an extra verse (no basis equivalent). */
  isExtra(tkvn: number): boolean {
    return this.extraTkvns.has(tkvn);
  }

  get mappingCount(): number {
    return this.kvnToTkvn.size;
  }

  get extraCount(): number {
    return this.extraTkvns.size;
  }

  /** Check if a kvn has its identity position occupied by another mapping's tkvn. */
  isCollision(kvn: number): boolean {
    return !this.kvnToTkvn.has(kvn) && this.tkvnToKvn.has(kvn);
  }

  /**
   * Get a sortable kvn for a tkvn. For regular verses returns toKvn(tkvn).
   * For extra verses: walks the afterKvn chain back to the basis verse and
   * uses part-bits for ordering.
   *
   * Example (Rom 16:25–27 are extra after 16:24):
   *   toSortableKvn(Rom 16:25) → encode(45,16,24,1)
   *   toSortableKvn(Rom 16:26) → encode(45,16,24,2)
   *   toSortableKvn(Rom 16:27) → encode(45,16,24,3)
   */
  toSortableKvn(tkvn: number): number {
    if (!this.extraTkvns.has(tkvn)) {
      return this.toKvn(tkvn) ?? tkvn;
    }

    // Walk afterKvn chain to find basis verse and count depth
    let current = tkvn;
    let depth = 0;
    while (this.extraTkvns.has(current)) {
      const after = this.extraAfterKvn.get(current);
      if (after === undefined) break;
      current = after;
      depth++;
    }

    // current is now the basis tkvn (or the last non-extra afterKvn)
    const basisKvn = this.toKvn(current) ?? current;
    const d = decode(basisKvn);
    return encode(d.book, d.chapter, d.verse, depth);
  }

  /** Get the afterKvn for an extra verse, or null if not an extra verse. */
  getAfterKvn(tkvn: number): number | null {
    return this.extraAfterKvn.get(tkvn) ?? null;
  }

  /**
   * For collision positions: returns the kvn that maps to this position as its tkvn.
   * Returns null if no collision.
   */
  getCollisionSource(kvn: number): number | null {
    if (!this.isCollision(kvn)) return null;
    // kvn is occupied as a tkvn — find which source kvn maps to it
    return this.tkvnToKvn.get(kvn) ?? null;
  }
}

// ============================================================
// Reference parsing
// ============================================================

export interface VerseRef {
  book: number;
  chapter: number;
  verse: number;
  part: number; // 0 = whole, 1 = a, 2 = b, ...
}

export interface ParseRefOptions {
  /** Callback returning max verse for a book+chapter. Required for cross-chapter ranges. */
  maxVerse?: MaxVerseProvider;
}

/**
 * Parse a Bible reference string into an array of VerseRef.
 *
 * Supports formats like:
 *   "Ordsp 8,1-2.22-31"
 *   "Mika 5,1–4a"
 *   "1 Mos 1,1-31"
 *   "2 Mos 7,20-25.28"
 *   "Joh 18,1–19,42"            (cross-chapter, requires maxVerse)
 *   "Apg 13,1–4;14,22–23"      (semicolon multi-chapter)
 *   "Apg 17,22–25 og/eller 26–31"  (og/eller normalization)
 *
 * Book names must match BOOK_IDS keys.
 */
export function parseRef(ref: string, options?: ParseRefOptions): VerseRef[] {
  // Normalize "og/eller" (and/or) to dash — treat as full range
  ref = ref.replace(/\s+og\/eller\s+/g, '–');

  // Split on semicolons for multi-chapter references
  const semiParts = ref.split(';').map(s => s.trim());

  // Extract book name from first part
  const firstMatch = semiParts[0].match(/^(.+?)\s+(\d+),(.+)$/);
  if (!firstMatch) throw new Error(`Invalid reference: ${ref}`);
  const bookName = firstMatch[1];
  const book = BOOK_IDS[bookName];
  if (book === undefined) throw new Error(`Unknown book: ${bookName}`);

  const allRefs: VerseRef[] = [];

  for (let i = 0; i < semiParts.length; i++) {
    let chapterVerses: string;

    if (i === 0) {
      chapterVerses = `${firstMatch[2]},${firstMatch[3]}`;
    } else {
      chapterVerses = semiParts[i].trim();
    }

    // Parse chapter,verseSpec
    const m = chapterVerses.match(/^(\d+),(.+)$/);
    if (!m) throw new Error(`Invalid reference part: ${chapterVerses}`);
    const chapter = parseInt(m[1]);
    const verseSpec = m[2];

    // Detect cross-chapter range: verseSpec like "1–19,42" or "26–2,2"
    const crossMatch = verseSpec.match(/^(\d+[a-c]?)\s*[–-]\s*(\d+),(\d+[a-c]?)$/);
    if (crossMatch) {
      if (!options?.maxVerse) {
        throw new Error(`Cross-chapter range requires maxVerse callback: ${ref}`);
      }
      allRefs.push(...parseCrossChapterRange(
        book, chapter, crossMatch[1], parseInt(crossMatch[2]), crossMatch[3], options.maxVerse
      ));
      continue;
    }

    allRefs.push(...parseSingleChapterVerses(book, chapter, verseSpec));
  }

  return allRefs;
}

/**
 * Parse a single chapter's verse specification (e.g. "1–10", "1–4a", "1–2.22–31").
 */
function parseSingleChapterVerses(book: number, chapter: number, verseSpec: string): VerseRef[] {
  const refs: VerseRef[] = [];
  for (const segment of verseSpec.split('.')) {
    const rangeParts = segment.split(/[–-]/);

    if (rangeParts.length === 1) {
      const { verse, part } = parseVersePart(rangeParts[0]);
      refs.push({ book, chapter, verse, part });
    } else {
      // Use first and last parts (handles og/eller merging like "22–25–26–31" → 22–31)
      const start = parseVersePart(rangeParts[0]);
      const end = parseVersePart(rangeParts[rangeParts.length - 1]);

      for (let v = start.verse; v <= end.verse; v++) {
        let part = 0;
        if (v === start.verse && start.part > 0) part = start.part;
        else if (v === end.verse && end.part > 0) part = end.part;
        refs.push({ book, chapter, verse: v, part });
      }
    }
  }
  return refs;
}

/**
 * Parse a cross-chapter range like "1 Mos 1,26–2,2".
 */
function parseCrossChapterRange(
  book: number, startCh: number, startVStr: string,
  endCh: number, endVStr: string, maxVerse: MaxVerseProvider
): VerseRef[] {
  const refs: VerseRef[] = [];
  const start = parseVersePart(startVStr);
  const end = parseVersePart(endVStr);

  for (let ch = startCh; ch <= endCh; ch++) {
    const vStart = ch === startCh ? start.verse : 1;
    const vEnd = ch === endCh ? end.verse : maxVerse(book, ch);
    for (let v = vStart; v <= vEnd; v++) {
      let p = 0;
      if (ch === startCh && v === start.verse && start.part > 0) p = start.part;
      else if (ch === endCh && v === end.verse && end.part > 0) p = end.part;
      refs.push({ book, chapter: ch, verse: v, part: p });
    }
  }
  return refs;
}

function parseVersePart(s: string): { verse: number; part: number } {
  const trimmed = s.trim();
  const match = trimmed.match(/^(\d+)([a-c])?$/);
  if (!match) throw new Error(`Invalid verse: ${trimmed}`);
  const verse = parseInt(match[1]);
  const part = match[2] ? match[2].charCodeAt(0) - 96 : 0; // a=1, b=2, c=3
  return { verse, part };
}

/** Convert VerseRef[] to kvn numbers. */
export function refsToKvn(refs: VerseRef[]): number[] {
  return refs.map(r => encode(r.book, r.chapter, r.verse, r.part));
}

/** Convert kvn numbers to VerseRef[]. */
export function kvnToRefs(kvns: number[]): VerseRef[] {
  return kvns.map(k => {
    const d = decode(k);
    return { book: d.book, chapter: d.chapter, verse: d.verse, part: d.part };
  });
}

/**
 * Convert a reference string from one system to another.
 *
 * Example: convertRef("2 Mos 8,1-4", converter) converts from translation tkvn
 * coordinates to basis kvn, or vice versa depending on direction.
 */
export function convertRef(
  ref: string,
  converter: KVNConverter,
  direction: 'toKvn' | 'toTkvn'
): number[] {
  const refs = parseRef(ref);
  const kvns = refsToKvn(refs);

  if (direction === 'toKvn') {
    return kvns.map(tkvn => converter.toKvn(tkvn) ?? tkvn);
  } else {
    return kvns.map(kvn => converter.toTkvn(kvn));
  }
}

/** Format a list of kvn numbers as a human-readable reference string. */
export function formatRefs(kvns: number[]): string {
  if (kvns.length === 0) return '';

  const refs = kvnToRefs(kvns);

  // Group by (book, chapter) preserving order
  const groups: { book: number; chapter: number; refs: VerseRef[] }[] = [];
  let currentGroup: { book: number; chapter: number; refs: VerseRef[] } | null = null;

  for (const ref of refs) {
    if (!currentGroup || currentGroup.book !== ref.book || currentGroup.chapter !== ref.chapter) {
      currentGroup = { book: ref.book, chapter: ref.chapter, refs: [] };
      groups.push(currentGroup);
    }
    currentGroup.refs.push(ref);
  }

  // Check if all refs are in the same book
  const allSameBook = groups.every(g => g.book === groups[0].book);

  if (allSameBook) {
    const bookName = BOOK_NAMES[groups[0].book] ?? String(groups[0].book);
    const parts = groups.map(g => `${g.chapter},${formatVerseList(g.refs)}`);
    return `${bookName} ${parts.join('; ')}`;
  }

  // Multi-book: prefix each group with book name
  const bookParts: string[] = [];
  let prevBook: number | null = null;

  for (const g of groups) {
    const bookName = BOOK_NAMES[g.book] ?? String(g.book);
    if (g.book !== prevBook) {
      bookParts.push(`${bookName} ${g.chapter},${formatVerseList(g.refs)}`);
    } else {
      bookParts.push(`${g.chapter},${formatVerseList(g.refs)}`);
    }
    prevBook = g.book;
  }

  return bookParts.join('; ');
}

function formatVerseList(refs: VerseRef[]): string {
  if (refs.length === 0) return '';

  const segments: string[] = [];
  let rangeStart = refs[0];
  let rangePrev = refs[0];

  for (let i = 1; i < refs.length; i++) {
    const curr = refs[i];
    if (curr.verse === rangePrev.verse + 1 && rangePrev.part === 0 && curr.part === 0) {
      // Continue range
      rangePrev = curr;
    } else {
      // End current range, start new
      segments.push(formatRange(rangeStart, rangePrev));
      rangeStart = curr;
      rangePrev = curr;
    }
  }
  segments.push(formatRange(rangeStart, rangePrev));

  return segments.join('.');
}

function formatRange(start: VerseRef, end: VerseRef): string {
  const startStr = `${start.verse}${start.part > 0 ? String.fromCharCode(96 + start.part) : ''}`;
  if (start.verse === end.verse && start.part === end.part) return startStr;
  const endStr = `${end.verse}${end.part > 0 ? String.fromCharCode(96 + end.part) : ''}`;
  return `${startStr}–${endStr}`;
}
