/**
 * bun test
 *
 * Profetiene peker på vers i osnb, og osnb følger hebraisk versinndeling: en
 * salmeoverskrift er egne vers (Sal 22:1, Sal 51:1–2), og teksten begynner etter
 * dem. En adresse skrevet i King James-nummerering lander derfor på overskriften
 * — «forsaken-cry» pekte på «Til korlederen …» i stedet for «Min Gud, min Gud»
 * (#165).
 *
 * Overskriftsversene er de versene osnb har mer enn KJV i samme salme: KJV
 * nummererer ikke overskriften. En salme der overskriften står i vers 1 sammen
 * med teksten (Sal 110) har like mange vers i begge, og har ingen.
 */
import {test, expect} from 'bun:test';
import * as fs from 'fs';
import path from 'path';

const ROOT = path.join(import.meta.dir, '..', 'generate');
const PSALMS = 19;

type Ref = {bookId: number; chapter: number; verseStart: number};
type Prophecy = {id: string; prophecy: Ref; fulfillments?: Ref[]};

function verseCount(translation: string, chapter: number): number {
    const file = path.join(ROOT, 'bibles_raw', translation, String(PSALMS), `${chapter}.json`);
    return JSON.parse(fs.readFileSync(file, 'utf-8')).length;
}

const headingVerses = (chapter: number) => verseCount('osnb', chapter) - verseCount('kjv', chapter);

for (const lang of fs.readdirSync(path.join(ROOT, 'prophecies'))) {
    test(`ingen profeti i Salmene peker på en overskrift (${lang})`, () => {
        const {prophecies}: {prophecies: Prophecy[]} =
            JSON.parse(fs.readFileSync(path.join(ROOT, 'prophecies', lang, 'prophecies.json'), 'utf-8'));
        const onHeading = prophecies
            .flatMap(p => [p.prophecy, ...(p.fulfillments ?? [])].map(r => ({id: p.id, ...r})))
            .filter(r => r.bookId === PSALMS && r.verseStart <= headingVerses(r.chapter))
            .map(r => `${r.id}: ${r.chapter}:${r.verseStart}`);
        expect(onHeading).toEqual([]);
    });
}
