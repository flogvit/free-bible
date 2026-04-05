export const UKVN_PART_SIZE = 16;
export const UKVN_MAX_VERSE = 177;
export const UKVN_MAX_CHAPTER = 151;

const MV = UKVN_MAX_VERSE * UKVN_PART_SIZE;   // 2832
const MC = UKVN_MAX_CHAPTER * MV;              // 427632

export function ukvnEncode(book: number, chapter: number, verse: number, part = 0): number {
  return book * MC + chapter * MV + verse * UKVN_PART_SIZE + part;
}

export function ukvnDecode(kvn: number): { book: number; chapter: number; verse: number; part: number } {
  const part = kvn % UKVN_PART_SIZE;
  const rest1 = (kvn - part) / UKVN_PART_SIZE;
  const verse = rest1 % UKVN_MAX_VERSE;
  const rest2 = (rest1 - verse) / UKVN_MAX_VERSE;
  const chapter = rest2 % UKVN_MAX_CHAPTER;
  const book = (rest2 - chapter) / UKVN_MAX_CHAPTER;
  return { book, chapter, verse, part };
}

export function ukvnFormat(kvn: number, bookNames?: Record<number, string>): string {
  const { book, chapter, verse, part } = ukvnDecode(kvn);
  const name = bookNames?.[book] ?? String(book);
  const suffix = part > 0 ? String.fromCharCode(96 + part) : '';
  return `${name} ${chapter}:${verse}${suffix}`;
}

export interface UkvnEntry {
  kvnFrom: number;
  kvnTo: number;
  kvnRef: string;
  tkvnFrom: number;
  tkvnTo: number;
  tkvnRef: string;
  order: number;
}

export interface UkvnMappingFile {
  version: number;
  system: string;
  name: string;
  encoding: { partSize: number; maxVerse: number; maxChapter: number };
  bookNames: Record<string, number>;
  stats: Record<string, number>;
  map: UkvnEntry[];
}
