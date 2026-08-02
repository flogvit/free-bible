/**
 * bun test
 *
 * Prompten som ber om et NORSK notat skal vise norske boknavn.
 *
 * `getRef` bygger på `books[].name`, som er engelske identifikatorer. Da
 * kandidatlista brukte den, skrev modellen av det den så: «1 Chronicles 6:34
 * fungerer som en teologisk kontrast …» ble stående som referansetekst i
 * `references/nb`. 1 047 av 4 112 notater fra kjøringen 2026-08-01 fikk engelsk
 * boknavn i norsk prosa.
 *
 * Symptomet er stille: filene er strukturelt gyldige, adressene er riktige, og
 * ingen test feilet. Det oppdages bare av noen som leser teksten.
 */
import {test, expect} from 'bun:test';
import {buildVerifyPrompt} from './references-semantic.js';
import type {Verse} from '../kvn/src/bible-types.js';

const verse = (bookId: number, chapterId: number, verseId: number): Verse =>
    ({bookId, chapterId, verseId, text: 'tekst'});

test('kandidatlista i prompten bruker norske boknavn', () => {
    const prompt = buildVerifyPrompt(verse(3, 10, 1), [
        verse(13, 6, 34),   // 1. Krønikebok — «1 Chronicles» i books[].name
        verse(4, 16, 17),   // 4. Mosebok    — «Numbers»
        verse(19, 23, 1),   // Salmene       — «Psalms»
    ]);

    expect(prompt).toContain('1. Krønikebok 6:34');
    expect(prompt).toContain('4. Mosebok 16:17');
    expect(prompt).toContain('Salmene 23:1');
});

test('ingen engelske boknavn slipper gjennom i prompten', () => {
    const prompt = buildVerifyPrompt(verse(3, 10, 1), [
        verse(13, 6, 34), verse(4, 16, 17), verse(19, 23, 1), verse(40, 5, 3),
    ]);

    // Navnene under står i books[].name og ville dukket opp med getRef.
    for (const engelsk of ['Chronicles', 'Numbers', 'Psalms', 'Matthew', 'Leviticus']) {
        expect(prompt).not.toContain(engelsk);
    }
});

test('kildeverset vises også på norsk', () => {
    const prompt = buildVerifyPrompt(verse(3, 10, 1), [verse(2, 25, 8)]);
    expect(prompt).toContain('3. Mosebok 10:1');
});
