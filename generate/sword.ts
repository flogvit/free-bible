/**
 * Reader for CrossWire SWORD modules in the compressed verse formats (zText/zCom and
 * zText4/zCom4), KJV versification. No SWORD library: the format is three files per
 * testament and is small enough to read directly.
 *
 *   <ot|nt>.bzs   one entry per compressed block: offset u32, compressed size u32,
 *                 uncompressed size u32 (little-endian)
 *   <ot|nt>.bzv   one entry per verse slot: block u32, offset in block u32, size
 *                 (u16 in zCom, u32 in zCom4)
 *   <ot|nt>.bzz   the zlib-compressed blocks
 *
 * Verse slots follow SWORD's layout for a testament: slot 0 is the module heading, 1 the
 * testament heading, then per book a book-intro slot, and per chapter a chapter-intro slot
 * followed by its verses. Gen 1:1 is slot 4.
 *
 * A commentary covering a verse range stores the text at the first verse and makes the
 * following verses point at the same bytes («linked»). `readModule` folds those into one
 * entry with `from`–`to`.
 */
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

const KJV: number[][] = JSON.parse(
    fs.readFileSync(path.join(import.meta.dir, 'data', 'kjv-versification.json'), 'utf8'));

/** Verse counts per chapter in SWORD's KJV versification, book 1..66 at index 0..65. */
export const kjvVersification: readonly (readonly number[])[] = KJV;

export interface SwordEntry {
    book: number;
    chapter: number;          // 0 = book introduction
    from: number;             // 0 = chapter introduction
    to: number;
    text: string;
}

type Driver = 'zCom' | 'zCom4' | 'zText' | 'zText4';

function verseEntrySize(driver: Driver): number {
    return driver.endsWith('4') ? 12 : 10;
}

/** The slot index of every (book, chapter, verse) in one testament, in slot order. */
export function testamentSlots(testament: 'ot' | 'nt'): { book: number; chapter: number; verse: number }[] {
    const slots: { book: number; chapter: number; verse: number }[] = [
        {book: 0, chapter: 0, verse: 0},      // module heading
        {book: 0, chapter: 0, verse: 0},      // testament heading
    ];
    const books = testament === 'ot' ? [1, 39] : [40, 66];
    for (let book = books[0]; book <= books[1]; book++) {
        slots.push({book, chapter: 0, verse: 0});
        KJV[book - 1].forEach((verses, i) => {
            for (let verse = 0; verse <= verses; verse++) slots.push({book, chapter: i + 1, verse});
        });
    }
    return slots;
}

function readTestament(dir: string, testament: 'ot' | 'nt', driver: Driver): SwordEntry[] {
    const bzv = path.join(dir, `${testament}.bzv`);
    if (!fs.existsSync(bzv)) return [];
    const idx = fs.readFileSync(bzv);
    const bzs = fs.readFileSync(path.join(dir, `${testament}.bzs`));
    const bzz = fs.readFileSync(path.join(dir, `${testament}.bzz`));
    const size = verseEntrySize(driver);
    const slots = testamentSlots(testament);
    if (idx.length / size !== slots.length) {
        throw new Error(`${bzv}: ${idx.length / size} verse slots, KJV versification has ${slots.length} — wrong versification or driver`);
    }

    const blocks = new Map<number, Buffer>();
    const block = (n: number): Buffer => {
        let b = blocks.get(n);
        if (!b) {
            const off = bzs.readUInt32LE(n * 12);
            const len = bzs.readUInt32LE(n * 12 + 4);
            b = zlib.inflateSync(new Uint8Array(bzz.subarray(off, off + len)));
            blocks.set(n, b);
        }
        return b;
    };

    const entries: SwordEntry[] = [];
    let lastKey = '';
    for (let i = 0; i < slots.length; i++) {
        const s = slots[i];
        if (s.book === 0) continue;
        const o = i * size;
        const blockNo = idx.readUInt32LE(o);
        const start = idx.readUInt32LE(o + 4);
        const len = size === 12 ? idx.readUInt32LE(o + 8) : idx.readUInt16LE(o + 8);
        if (len === 0) { lastKey = ''; continue; }
        const key = `${blockNo}:${start}:${len}`;
        const prev = entries[entries.length - 1];
        if (key === lastKey && prev && prev.book === s.book && prev.chapter === s.chapter && s.verse > 0) {
            prev.to = s.verse;
            continue;
        }
        lastKey = key;
        const text = block(blockNo).subarray(start, start + len).toString('utf8');
        entries.push({book: s.book, chapter: s.chapter, from: s.verse, to: s.verse, text});
    }
    return entries;
}

/** Every non-empty entry of a zCom/zCom4/zText/zText4 module, in canonical order. */
export function readModule(dataDir: string, driver: Driver): SwordEntry[] {
    return [...readTestament(dataDir, 'ot', driver), ...readTestament(dataDir, 'nt', driver)];
}
