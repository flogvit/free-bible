/**
 * bun test
 *
 * Personblokka på et kapittel bygges av hver person som har en referanse dit
 * (`getPersonsByChapter()` i bibel). En referanse som tilhører en navnebror
 * setter derfor feil person på siden — og ingen strukturtest merker det, for
 * id-en finnes og verset finnes (#127).
 *
 * Indekseren ga hver forekomst av et navn til den første bæreren den fant, så
 * Matt 1 viste byen Hasor, Gideons sønn Jotam og Baal-presten Mattan. Matt 1 er
 * slektstavla med flest navnebrødre, og lista under er fasiten for den: hvert
 * ledd i slektstavla og hver person i fødselsfortellingen, og ingen andre.
 */
import {test, expect} from 'bun:test';
import * as fs from 'fs';
import path from 'path';

const PERSONS = path.join(import.meta.dir, '..', 'generate', 'persons');

const MATT_1 = [
    'abraham', 'isak', 'jakob-israel', 'juda', 'tamar-juda', 'peres', 'serah',
    'hesron', 'ram-hesrons-sonn', 'amminadab', 'nahsjon', 'salmon', 'rahab',
    'boas', 'rut', 'obed', 'isai', 'david', 'uria', 'salomo', 'rehabeam', 'abia',
    'asa', 'josafat', 'joram-juda', 'asarja', 'jotam-ussias-sonn', 'akas',
    'hiskia', 'manasse-juda', 'amon', 'josjia', 'jojakin', 'sjealtiel',
    'serubabel', 'abiud', 'eljakim-abiuds-sonn', 'asor-eljakims-sonn',
    'sadok-asors-sonn', 'akim', 'eliud', 'eleasar-jesu-forfader', 'matthan',
    'jakob-jesu-bestefar', 'josef-marias-mann', 'maria-jesu-mor', 'jesus',
    'immanuel',
].sort();

function personsIn(lang: string, bookId: number, chapterId: number): string[] {
    const dir = path.join(PERSONS, lang);
    return fs.readdirSync(dir)
        .map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')))
        .filter(p => (p.references ?? []).some((r: {bookId: number; chapterId: number}) =>
            r.bookId === bookId && r.chapterId === chapterId))
        .map(p => p.id)
        .sort();
}

for (const lang of ['nb', 'en']) {
    test(`Matt 1 (${lang}) lister bare slektstavla og fødselsfortellingen`, () => {
        expect(personsIn(lang, 40, 1)).toEqual(MATT_1);
    });
}

test('en har de samme referansene som nb', () => {
    // references er id-data, ikke tekst — en avvikende referanse på engelsk
    // ville gitt en annen personblokk på /en enn på /nb.
    const read = (lang: string, f: string) =>
        JSON.stringify(JSON.parse(fs.readFileSync(path.join(PERSONS, lang, f), 'utf-8')).references ?? []);
    const differ = fs.readdirSync(path.join(PERSONS, 'nb'))
        .filter(f => read('nb', f) !== read('en', f));
    expect(differ).toEqual([]);
});
