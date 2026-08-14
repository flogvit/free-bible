/**
 * bun test
 *
 * checkTarget er porten som skulle vært der da de 560 døde referansene ble skrevet
 * (#26). Tilfellene under er hentet fra de faktiske dataene: `Høy 105:33` sto i
 * Dom 9:11 og skulle vært `Sal 105:33`, og `Mal 4:5` er riktig referanse skrevet i
 * europeisk nummerering.
 */
import { test, expect } from 'bun:test';

import {checkTarget, applyCorrections, REFERENCE_PROOFREAD_SCHEMA} from './references.js';

const ref = (bookId: number, chapterId: number, fromVerseId: number, toVerseId: number = fromVerseId) =>
    ({bookId, chapterId, fromVerseId, toVerseId});

test('ok: adresse som finnes i vår nummerering', () => {
    expect(checkTarget(ref(43, 3, 16)).verdict).toBe('ok');       // Joh 3:16
    expect(checkTarget(ref(1, 1, 1, 3)).verdict).toBe('ok');      // 1 Mos 1:1-3
});

test('renumber: europeisk nummerering — riktig referanse, feil adresse', () => {
    // Malaki har 3 kapitler her, 4 i den europeiske. Mal 4:5 = Mal 3:23.
    expect(checkTarget(ref(39, 4, 5)).verdict).toBe('renumber');
    // Joel har 4 kapitler her, 3 i den europeiske. Joel 3:18 = Joel 4:18.
    expect(checkTarget(ref(29, 3, 18)).verdict).toBe('renumber');
    // 4 Mos 16 slutter på v35 her; 16:36 er 17:1.
    expect(checkTarget(ref(4, 16, 36)).verdict).toBe('renumber');
});

test('drop: bokforveksling — finnes i ingen nummerering', () => {
    expect(checkTarget(ref(22, 105, 33)).verdict).toBe('drop');   // Høysangen har 8 kap (Sal 105:33)
    expect(checkTarget(ref(8, 19, 18)).verdict).toBe('drop');     // Rut har 4 kap (Dom 19:18)
    expect(checkTarget(ref(66, 46, 8)).verdict).toBe('drop');     // Åp har 22 kap (1 Kor 10:8)
});

test('drop: ugyldige felter', () => {
    expect(checkTarget(ref(0, 1, 1)).verdict).toBe('drop');
    expect(checkTarget(ref(67, 1, 1)).verdict).toBe('drop');
    expect(checkTarget(ref(1, 1, 5, 2)).verdict).toBe('drop');    // toVerseId < fromVerseId
    expect(checkTarget({bookId: 1, chapterId: 1}).verdict).toBe('drop');
});

test('drop: vers utenfor kapittelet', () => {
    // 1 Mos 1 har 31 vers i begge nummereringene
    expect(checkTarget(ref(1, 1, 99)).verdict).toBe('drop');
});

/**
 * #121: korrekturen fant ekte feil og leverte input tilbake uendret — 139 av 140
 * `revisedReferences` var adresselikt med lista modellen fikk, 0 referanser fjernet.
 * Modellen leste feltet som «lista», ikke «lista etter retting», og ekkoet den.
 *
 * Rettingen er ikke en bedre formulering: det finnes ikke lenger en liste å ekko.
 * Korrekturen svarer med operasjoner mot indeksene i lista den fikk, og koden
 * utfører dem.
 */
const withText = (bookId: number, chapterId: number, fromVerseId: number, text: string) =>
    ({bookId, chapterId, fromVerseId, toVerseId: fromVerseId, text});

test('skjemaet ber ikke om en omskrevet liste — det er ingenting å ekko', () => {
    const props = REFERENCE_PROOFREAD_SCHEMA.properties as Record<string, unknown>;
    expect(props.revisedReferences).toBeUndefined();
    expect(props.corrections).toBeDefined();
    expect(REFERENCE_PROOFREAD_SCHEMA.required).toContain('corrections');
});

test('remove fjerner referansen funnet peker på', () => {
    // Joh 1:20 i miniatyr: korrekturen flagget en selvhenvisning i referanse 2.
    const refs = [
        withText(43, 8, 12, 'lyset'),
        withText(43, 1, 20, 'selvhenvisning tilbake til kildeverset'),
        withText(43, 3, 28, 'samme vitnesbyrd'),
    ];
    const result = applyCorrections(refs, [{op: 'remove', index: 2, reason: 'selvhenvisning'}]);

    expect(result.removed).toBe(1);
    expect(result.changed).toBe(true);
    expect(result.references.map(r => r.chapterId)).toEqual([8, 3]);
});

test('rewrite bytter forklaringsteksten', () => {
    const refs = [withText(43, 3, 16, 'gammel og misvisende forklaring')];
    const result = applyCorrections(refs, [{op: 'rewrite', index: 1, text: 'ny forklaring', reason: 'unøyaktig'}]);

    expect(result.rewritten).toBe(1);
    expect(result.references[0].text).toBe('ny forklaring');
    expect(result.references[0].chapterId).toBe(3);
});

test('rewrite kan rette adressen, og den nye adressen må finnes', () => {
    const refs = [withText(22, 105, 33, 'Høy 105:33 — bokforveksling for Sal 105:33')];

    const fixed = applyCorrections(refs, [{op: 'rewrite', index: 1, bookId: 19, reason: 'feil bok'}]);
    expect(fixed.references[0].bookId).toBe(19);
    expect(fixed.rewritten).toBe(1);

    const dead = applyCorrections(refs, [{op: 'rewrite', index: 1, chapterId: 99, reason: 'feil kapittel'}]);
    expect(dead.rewritten).toBe(0);
    expect(dead.references[0].chapterId).toBe(105);   // uendret, rettingen ble forkastet
    expect(dead.skipped).toHaveLength(1);
});

test('add legger til en referanse, og en død adresse slipper ikke gjennom', () => {
    const refs = [withText(43, 3, 16, 'kjærlighet')];

    const added = applyCorrections(refs, [
        {op: 'add', bookId: 62, chapterId: 4, fromVerseId: 9, toVerseId: 10, text: 'Gud elsket oss først', reason: 'mangler'},
    ]);
    expect(added.added).toBe(1);
    expect(added.references).toHaveLength(2);
    expect(added.references[1].bookId).toBe(62);

    const bad = applyCorrections(refs, [
        {op: 'add', bookId: 66, chapterId: 46, fromVerseId: 8, text: 'Åp har 22 kapitler', reason: 'mangler'},
    ]);
    expect(bad.added).toBe(0);
    expect(bad.changed).toBe(false);
    expect(bad.skipped).toHaveLength(1);
});

test('indeks utenfor lista ignoreres i stedet for å treffe feil referanse', () => {
    const refs = [withText(43, 3, 16, 'kjærlighet')];
    const result = applyCorrections(refs, [
        {op: 'remove', index: 4, reason: 'irrelevant'},
        {op: 'remove', index: 0, reason: '0-basert av vane'},
        {op: 'rewrite', index: 2, text: 'ny', reason: 'unøyaktig'},
    ]);

    expect(result.references).toEqual(refs);
    expect(result.changed).toBe(false);
    expect(result.skipped).toHaveLength(3);
});

test('tom liste med rettinger lar fila stå urørt', () => {
    const refs = [withText(43, 3, 16, 'kjærlighet')];
    const result = applyCorrections(refs, []);

    expect(result.changed).toBe(false);
    expect(result.references).toEqual(refs);
});

test('rettinger treffer indeksene i lista korrekturen fikk, ikke de forskjøvede', () => {
    const refs = [
        withText(43, 8, 12, 'ett'),
        withText(43, 3, 28, 'to'),
        withText(43, 5, 33, 'tre'),
    ];
    const result = applyCorrections(refs, [
        {op: 'remove', index: 1, reason: 'irrelevant'},
        {op: 'rewrite', index: 3, text: 'rettet tre', reason: 'unøyaktig'},
    ]);

    expect(result.references.map(r => r.text)).toEqual(['to', 'rettet tre']);
});

test('en ekkoet liste er ikke lenger en mulig retting', () => {
    // Det gamle svaret — hele lista tilbake, uendret — har ingen vei inn i fila nå.
    const refs = [withText(43, 3, 16, 'kjærlighet')];
    const echoed = refs.map(r => ({...r}));
    const result = applyCorrections(refs, echoed.map(r => ({op: 'add' as const, ...r, reason: 'ekko'})));

    // Adressen finnes, så den ville blitt lagt til — men da som duplikat av noe
    // som alt står der, og det er nettopp det dedupliseringen skal stoppe.
    expect(result.references).toHaveLength(1);
    expect(result.changed).toBe(false);
});
