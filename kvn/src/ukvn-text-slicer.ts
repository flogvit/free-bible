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

function splitBySentences(text: string, part: number, totalParts: number): string {
  const breaks: number[] = [0];
  const regex = /(?<=[.!?»])\s+(?=[A-ZÆØÅ«])/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    breaks.push(m.index + m[0].length);
  }
  breaks.push(text.length);

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
