export function sliceVersePart(
  text: string,
  part: number,
  totalParts: number,
  refTexts?: string[],
): string {
  if (part === 0) return text;
  if (part > totalParts) return '';

  if (refTexts && refTexts.length === totalParts) {
    return splitByReference(text, part, refTexts);
  }

  const heading = leadingHeading(text);
  if (heading && totalParts > 1) {
    // The bracketed title is every part but the last; the verse itself is the last.
    if (part === totalParts) return text.slice(heading.length).trim();
    return splitBySentences(heading.trim(), part, totalParts - 1);
  }

  return splitBySentences(text, part, totalParts);
}

function splitByReference(text: string, part: number, refTexts: string[]): string {
  const boundaries = [0];

  for (let i = 1; i < refTexts.length; i++) {
    const searchStart = boundaries[boundaries.length - 1]! + 1;
    const needle = refTexts[i]!.slice(0, 20).trim();
    const pos = text.indexOf(needle, searchStart);
    if (pos >= 0) {
      boundaries.push(pos);
    } else {
      boundaries.push(Math.round((text.length * i) / refTexts.length));
    }
  }
  boundaries.push(text.length);

  const start = boundaries[part - 1];
  const end = boundaries[part];
  return text.slice(start, end).trim();
}

/**
 * A psalm title some translations print in brackets at the start of verse 1
 * (the Chinese Union Version: «（大卫逃避他儿子押沙龙的时候作的诗。）耶和华啊…»).
 * Darby prints it in braces, «{A Psalm of David, when he fled from Absalom his
 * son.} Jehovah, how…» (bible.flogvit.com#220).
 * Returns the bracketed block with its trailing space, or null. Only a block
 * followed by more text counts: a verse that is all brackets has no title.
 */
function leadingHeading(text: string): string | null {
  const m = /^\s*(?:[（(][^（()）]*[）)]|\{[^{}]*\})\s*/.exec(text);
  if (!m || m[0].length >= text.trimEnd().length) return null;
  return m[0];
}

/**
 * Where a sentence ends:
 * - «.», «!», «?» or «»» and a space before a capital in any script with case
 *   (Ð in Vietnamese, É in French, Ä in German), or before «. Not before ¿ or
 *   ¡: in the Reina-Valera a psalm title would then take the first question
 *   with it (Ps 22:1);
 * - the full-width stops «。», «！», «？» (Chinese, Japanese), after any closing
 *   brackets and spaces, before more text — those scripts have no capitals.
 */
const SENTENCE_BREAK = /(?<=[.!?»])\s+(?=[\p{Lu}«])|(?<=[。！？][\s」』）)]*)(?=[^\s」』）)])/gu;

function splitBySentences(text: string, part: number, totalParts: number): string {
  const breaks: number[] = [0];
  let m: RegExpExecArray | null;
  SENTENCE_BREAK.lastIndex = 0;
  while ((m = SENTENCE_BREAK.exec(text)) !== null) {
    const at = m.index + m[0].length;
    if (at > breaks[breaks.length - 1]!) breaks.push(at);
    if (m[0].length === 0) SENTENCE_BREAK.lastIndex++;
  }
  if (breaks[breaks.length - 1]! < text.length) breaks.push(text.length);

  const segments = breaks.length - 1;
  if (segments <= 1 && totalParts > 1) {
    return part === 1 ? text : '';
  }

  const segsPerPart = segments / totalParts;
  const startSeg = Math.round((part - 1) * segsPerPart);
  const endSeg = Math.round(part * segsPerPart);

  const startPos = breaks[startSeg] ?? 0;
  const endPos = breaks[endSeg] ?? text.length;
  return text.slice(startPos, endPos).trim();
}
