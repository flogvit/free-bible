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
import {
    buildVerifyPrompt,
    coverageOf,
    formatCoverage,
    formatRunSummary,
    parseProgress,
    serializeProgress,
    isPending,
} from './references-semantic.js';
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

/*
 * #122: en kandidat modellen AVVISTE og en kandidat den ALDRI NEVNTE gir samme
 * fil — og samme tall. Prompten ber om «alltid alle N», men skjemaet har verken
 * minItems eller maxItems, så det er en oppfordring, ikke en garanti. Målt med
 * gemma4:31b på Joh 3:16: 13 kandidater, 1 svar, gyldig JSON, ingen feil.
 *
 * Tallene er det eneste grunnlaget vi har for å velge dommermodell, og en modell
 * som svarer på 1 av 13 og godtar den ene ser der ut som en usedvanlig streng
 * dommer. Den var ikke streng; den svarte ikke.
 */

const verdicts = (...ids: number[]) => ids.map(id => ({id}));

test('et fullstendig svar dekker alle kandidatene', () => {
    const cov = coverageOf(verdicts(0, 1, 2, 3), 4);
    expect(cov.answered).toBe(4);
    expect(cov.missing).toEqual([]);
    expect(cov.outOfRange).toEqual([]);
    expect(cov.duplicated).toEqual([]);
});

test('ett svar på tretten kandidater teller som tolv ubesvarte', () => {
    const cov = coverageOf(verdicts(0), 13);
    expect(cov.asked).toBe(13);
    expect(cov.answered).toBe(1);
    expect(cov.missing).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
});

test('id utenfor kandidatlista teller ikke som et svar', () => {
    // Målt: 14 svar på 13 kandidater. `if (!c) continue` fanger den ved skriving,
    // men den skal ikke få det til å se ut som full dekning heller.
    const cov = coverageOf(verdicts(0, 1, 2, 13), 3);
    expect(cov.answered).toBe(3);
    expect(cov.outOfRange).toEqual([13]);
    expect(cov.missing).toEqual([]);
});

test('samme id to ganger er ett svar, ikke to', () => {
    const cov = coverageOf(verdicts(0, 0, 1), 3);
    expect(cov.answered).toBe(2);
    expect(cov.duplicated).toEqual([0]);
    expect(cov.missing).toEqual([2]);
});

test('manglende results-felt er null svar, ikke null kandidater', () => {
    const cov = coverageOf(undefined, 5);
    expect(cov.asked).toBe(5);
    expect(cov.answered).toBe(0);
    expect(cov.missing).toEqual([0, 1, 2, 3, 4]);
});

test('ubesvarte id-er skrives som intervall, fordi de er en avkuttet hale', () => {
    const line = formatCoverage(coverageOf(verdicts(0), 13));
    expect(line).toContain('1 of 13');
    expect(line).toContain('1-12');
});

test('formatCoverage sier fra om id-er utenfor lista', () => {
    expect(formatCoverage(coverageOf(verdicts(0, 1, 7), 2))).toContain('7');
});

test('sluttoppsummeringen regner godtatt-andelen av BESVARTE, ikke av kandidater', () => {
    const summary = formatRunSummary({
        verses: 1, candidates: 13, answered: 1, accepted: 1,
        incompleteVerses: 1, outOfRange: 0, resume: false,
    });

    // Modellen svarte på 1 av 13 og godtok den ene. Det er 100 % av det den
    // vurderte — ikke 8 %, som er tallet den gamle linja skrev.
    expect(summary).toContain('Accepted: 1 (100% of answered)');
    expect(summary).not.toMatch(/[Aa]ccepted: 1 \(8%/);
    expect(summary).toContain('12');           // ubesvarte kandidater
    expect(summary).toMatch(/unanswered/i);
});

test('sluttoppsummeringen tier om ubesvarte når alt ble besvart', () => {
    const summary = formatRunSummary({
        verses: 10, candidates: 100, answered: 100, accepted: 30,
        incompleteVerses: 0, outOfRange: 0, resume: false,
    });
    expect(summary).toContain('30%');
    expect(summary).not.toMatch(/unanswered/i);
});

test('en resume-kjøring med hull peker på --retry-incomplete', () => {
    const summary = formatRunSummary({
        verses: 10, candidates: 100, answered: 60, accepted: 12,
        incompleteVerses: 7, outOfRange: 0, resume: true,
    });
    expect(summary).toContain('--retry-incomplete');
});

test('gammel framdriftsfil uten incomplete leses som før', () => {
    const p = parseProgress({processed: ['1-1-1', '1-1-2']});
    expect([...p.processed]).toEqual(['1-1-1', '1-1-2']);
    expect(p.incomplete.size).toBe(0);
});

test('framdriftsfila husker hvilke vers som fikk ufullstendig svar', () => {
    const p = parseProgress(serializeProgress({
        processed: new Set(['1-1-1', '1-1-2']),
        incomplete: new Set(['1-1-2']),
    }));
    expect(p.incomplete.has('1-1-2')).toBe(true);
    expect(p.processed.has('1-1-2')).toBe(true);
});

test('ødelagt framdriftsfil gir tomme mengder, ikke krasj', () => {
    const p = parseProgress(null);
    expect(p.processed.size).toBe(0);
    expect(p.incomplete.size).toBe(0);
});

test('--resume hopper over et ufullstendig vers med mindre --retry-incomplete', () => {
    const progress = {processed: new Set(['a', 'b']), incomplete: new Set(['b'])};
    expect(isPending('c', progress, false)).toBe(true);
    expect(isPending('b', progress, false)).toBe(false);
    expect(isPending('b', progress, true)).toBe(true);
    expect(isPending('a', progress, true)).toBe(false);
});
