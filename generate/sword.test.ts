import {expect, test} from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import {readModule, testamentSlots} from './sword.js';

test('KJV versification has the slot counts of the SWORD index files', () => {
    // MHC.zip (zCom4): ot.bzv is 289 380 bytes = 24 115 slots, nt.bzv 98 952 = 8 246.
    expect(testamentSlots('ot').length).toBe(24115);
    expect(testamentSlots('nt').length).toBe(8246);
    expect(testamentSlots('ot')[4]).toEqual({book: 1, chapter: 1, verse: 1});
    expect(testamentSlots('nt')[4]).toEqual({book: 40, chapter: 1, verse: 1});
});

/** A zCom4 module with text at the given slots; equal text at neighbouring slots is a link. */
function writeModule(dir: string, texts: Map<number, string>) {
    const slots = testamentSlots('ot').length;
    const block = Buffer.from([...new Set(texts.values())].join(''), 'utf8');
    const z = zlib.deflateSync(new Uint8Array(block));
    const bzs = Buffer.alloc(12);
    bzs.writeUInt32LE(0, 0); bzs.writeUInt32LE(z.length, 4); bzs.writeUInt32LE(block.length, 8);
    const bzv = Buffer.alloc(slots * 12);
    const offsets = new Map<string, number>();
    let at = 0;
    for (const t of new Set(texts.values())) { offsets.set(t, at); at += Buffer.byteLength(t); }
    for (const [slot, t] of texts) {
        bzv.writeUInt32LE(0, slot * 12);
        bzv.writeUInt32LE(offsets.get(t)!, slot * 12 + 4);
        bzv.writeUInt32LE(Buffer.byteLength(t), slot * 12 + 8);
    }
    fs.writeFileSync(path.join(dir, 'ot.bzs'), new Uint8Array(bzs));
    fs.writeFileSync(path.join(dir, 'ot.bzv'), new Uint8Array(bzv));
    fs.writeFileSync(path.join(dir, 'ot.bzz'), new Uint8Array(z));
}

test('reads entries and folds linked verses into one range', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sword-'));
    // slot 2 = Genesis intro, 3 = Gen 1 intro, 4.. = Gen 1:1..
    writeModule(dir, new Map([[2, 'book'], [3, 'chapter'], [4, 'one-two'], [5, 'one-two'], [6, 'three']]));
    expect(readModule(dir, 'zCom4')).toEqual([
        {book: 1, chapter: 0, from: 0, to: 0, text: 'book'},
        {book: 1, chapter: 1, from: 0, to: 0, text: 'chapter'},
        {book: 1, chapter: 1, from: 1, to: 2, text: 'one-two'},
        {book: 1, chapter: 1, from: 3, to: 3, text: 'three'},
    ]);
});

test('a module in another versification is refused, not misread', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sword-'));
    writeModule(dir, new Map([[4, 'x']]));
    fs.writeFileSync(path.join(dir, 'ot.bzv'), new Uint8Array(Buffer.alloc(12 * 100)));
    expect(() => readModule(dir, 'zCom4')).toThrow(/versification/);
});
