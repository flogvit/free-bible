import {describe, expect, test} from 'bun:test';
import {referenceProblems, romanToArabic} from './refcheck.js';

const blocking = (a: string, b: string) => referenceProblems(a, b).filter(p => p.blocking).map(p => p.kind);

describe('referenceProblems', () => {
    test('an invented § reference blocks — the Ewald case from 20.09', () => {
        expect(blocking('as Ewald shows', 'som Ewald viser (§ 287)')).toEqual(['section']);
        // The paragraph letter changed, 277c → 277a: the slip the judge found in the K&D Gen 1:1 sample.
        expect(blocking('Ewald Lehrb. § 277c der 7. A.', 'Ewald, Lehrb. § 277a i 7. utg.')).toEqual(['section']);
        expect(blocking('Ewald Lehrb. § 277c der 7. A.', 'Ewald, Lehrb. § 277c i 7. utg.')).toEqual([]);
    });

    test('a changed page number blocks; the cue word may change language', () => {
        expect(blocking('Sir W. Temple, p. 329.', 'Sir W. Temple, s. 329.')).toEqual([]);
        expect(blocking('Sir W. Temple, p. 329.', 'Sir W. Temple, s. 239.')).toEqual(['page']);
    });

    test('chapter references compare across Roman and Arabic numerals', () => {
        expect(blocking('see ch. xxix and c. 11', 'se kap. 29 og kap. 11')).toEqual([]);
        expect(blocking('see ch. xxix', 'se kap. 28')).toEqual(['chapter']);
    });

    test('a ref keeps its osisRef; its display text is free to change', () => {
        const src = '<ref osisRef="John.3.21">John iii. 21</ref>';
        expect(blocking(src, '<ref osisRef="John.3.21">Joh 3,21</ref>')).toEqual([]);
        expect(blocking(src, '<ref osisRef="John.3.12">Joh 3,12</ref>')).toEqual(['ref']);
        expect(blocking(src, 'Joh 3,21')).toEqual(['ref']);
    });

    test('verse numbers in a quoted Bible text must all be there', () => {
        expect(blocking('<sup>3</sup> And God said <sup>4</sup> And God saw',
            '<sup>3</sup> Og Gud sa og Gud så')).toEqual(['verse']);
    });

    test('a year after b. c. is not a chapter', () => {
        expect(blocking('The Creation. (b. c. 4004.)', 'Skapelsen (4004 f.Kr.)')).toEqual([]);
    });

    test('a word ending in s or c before a numbered point is no page or chapter (#163)', () => {
        // Each pair held a Genesis–Deuteronomy unit stuck through every review the reviewer passed.
        expect(blocking('Ps. civ. 25 , &amp;c. 2. The blessing', 'Sal 104,25 osv. 2. Velsignelsen')).toEqual([]);
        expect(blocking("gifts should attend God's. 2. He gave", 'gaver skal følge Guds. 2. Han ga')).toEqual([]);
        expect(blocking('made of no effect. 2. Yet', 'gjort virkningsløs. 2. Likevel')).toEqual([]);
        expect(blocking('see p. 12', 'se s. 21')).toEqual(['page']);
        expect(blocking('see ch. ii', 'se kap. 3')).toEqual(['chapter']);
    });

    test('plain chapter:verse pairs and bare numbers are advisory', () => {
        const p = referenceProblems('Is 34:11', 'Jes 34,12');
        expect(p.map(x => [x.kind, x.blocking])).toEqual([['pair', false]]);
    });
});

test('romanToArabic', () => {
    expect(['iii', 'iv', 'xxix', 'xl', 'cl', '12', 'word'].map(romanToArabic))
        .toEqual(['3', '4', '29', '40', '150', '12', 'word']);
});
