/**
 * bun test
 *
 * checkTarget er porten som skulle vært der da de 560 døde referansene ble skrevet
 * (#26). Tilfellene under er hentet fra de faktiske dataene: `Høy 105:33` sto i
 * Dom 9:11 og skulle vært `Sal 105:33`, og `Mal 4:5` er riktig referanse skrevet i
 * europeisk nummerering.
 */
import { test, expect } from 'bun:test';

import {checkTarget} from './references.mjs';

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
