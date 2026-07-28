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

export interface MappingMeta {
  shortname: string;
  displayName: string;
}

/**
 * Metadata for known mapping systems: short aliases for inline references
 * (e.g. ref:1.mos 1@dnb2024) and display names for UI.
 */
export const MAPPING_META: Record<string, MappingMeta> = {
  osnb:          { shortname: 'osnb',   displayName: 'osnb (hebraisk/gresk)' },
  osnn:          { shortname: 'osnn',   displayName: 'osnn (hebraisk/gresk nynorsk)' },
  dnb2024_nb:     { shortname: 'dnb2024', displayName: 'Bibelselskapets 2024' },
  dnb2024_nn:     { shortname: 'dnb2024nn', displayName: 'Bibelselskapets 2024 (nynorsk)' },
  dnb2011_nb:     { shortname: 'dnb2011', displayName: 'Bibelselskapets 2011' },
  dnb30:          { shortname: 'dnb1930', displayName: 'Bibelselskapets 1930' },
  dnb1978_nb:     { shortname: 'dnb1978', displayName: 'Bibelselskapets 1978' },
  nb88_nb:        { shortname: 'nb88',    displayName: 'Norsk Bibel 1988' },
  nb94_nn:        { shortname: 'nb94',    displayName: 'Norsk Bibel 1994 (nynorsk)' },
  english_kj:     { shortname: 'kjv',     displayName: 'King James Version' },
  norwegian1921:  { shortname: 'n1921',   displayName: 'Norsk 1921' },
  norwegian1938:  { shortname: 'n1938',   displayName: 'Norsk 1938' },
  norwegian_bgo:  { shortname: 'bgo',     displayName: 'Bibelen Guds Ord' },
};

// Reverse lookup: shortname → mapping id
const SHORTNAME_TO_ID = new Map<string, string>();
for (const [id, meta] of Object.entries(MAPPING_META)) {
  SHORTNAME_TO_ID.set(meta.shortname, id);
}

// Legacy aliases for renamed mapping files.
// «nb» er Norsk Bibel (nb88/nb94); Bibelselskapet bruker «dnb», fullt utskrevet
// med språksuffiks. Gamle navn holdes oppslagbare her.
const LEGACY_ALIASES: Record<string, string> = {
  dnb2024: 'dnb2024_nb',
  nb1978: 'dnb1978_nb',
};

/**
 * Resolve a mapping shortname (e.g. "dnb2024") or full id to the canonical mapping id.
 * Returns undefined if not found.
 */
export function resolveMappingId(shortnameOrId: string): string | undefined {
  if (MAPPING_META[shortnameOrId]) return shortnameOrId;
  const fromShortname = SHORTNAME_TO_ID.get(shortnameOrId);
  if (fromShortname) return fromShortname;
  const legacy = LEGACY_ALIASES[shortnameOrId];
  if (legacy) return resolveMappingId(legacy);
  return undefined;
}
