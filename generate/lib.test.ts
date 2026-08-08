/**
 * bun test
 *
 * `lib.ts` er den delte modulen — en dårlig verdi herfra treffer mange skript.
 * Testene her dekker de to stedene som krasjet uleselig på ukjent nøkkel (#112).
 */
import {test, expect} from 'bun:test';
import {getRef, resolveBookRange, nameToId} from './lib.js';

test('getRef gir referanse for en gyldig bok', () => {
    expect(getRef(43, 3, 16)).toBe('John 3:16');
});

test('getRef sier hvilken bok-id som er ukjent', () => {
    // Kastet før en `TypeError: Cannot read properties of undefined`, som ikke
    // fortalte hva som var galt.
    expect(() => getRef(999, 1, 1)).toThrow(/ukjent bok-id 999/);
    expect(() => getRef(0, 1, 1)).toThrow(/ukjent bok-id 0/);
});

test('resolveBookRange slår opp et navngitt område', () => {
    expect(resolveBookRange('gt')).toEqual({from: 1, to: 39});
});

test('resolveBookRange sender et objekt rett gjennom', () => {
    expect(resolveBookRange({from: 5, to: 9})).toEqual({from: 5, to: 9});
});

test('resolveBookRange kaster på ukjent område, og lister de kjente', () => {
    // Ga før `undefined`, som gikk videre til getChaptersForRange og feilet
    // et helt annet sted.
    expect(() => resolveBookRange('finnesikke')).toThrow(/ukjent område/);
    expect(() => resolveBookRange('finnesikke')).toThrow(/kjente:/);
});

test('resolveBookRange kaster når området mangler helt', () => {
    // En plandefinisjon uten `bookRange` var brolagt med `!` i
    // build-reading-plans.ts: `undefined` gikk urørt gjennom her og krasjet
    // først i getChaptersForRange, på `.from` av `undefined`.
    expect(() => resolveBookRange(undefined)).toThrow(/mangler område/);
});

test('nameToId translittererer ø, æ og å før NFD', () => {
    // #25: `ø` og `æ` er egne bokstaver uten kanonisk dekomponering, så NFD
    // rører dem ikke — og `[^a-z0-9]` slettet dem da. «Bjørn» ble `bjrn`.
    // Rekkefølgen er poenget: translitterer FØRST, normaliser etterpå.
    expect(nameToId('Bjørn')).toBe('bjorn');
    expect(nameToId('Ræv')).toBe('raev');
    expect(nameToId('Håkon')).toBe('hakon');
});

test('nameToId fjerner en enkel parentes', () => {
    expect(nameToId('Set (Adams sønn)')).toBe('set');
});

test('nameToId beholder disambigueringen i en nøstet parentes', () => {
    // To feil er mulige her, og bare den ene er verre enn den andre.
    // `[^)]*` spiste fra ytre `(` til indre `)` og ga `jotam-yngste-sonn`.
    // Full nøstet fjerning ville gitt bare `jotam` — og da kolliderer
    // «Mattatias (… sønn av Amos)» med en annen Mattatias. Parentesen BÆRER
    // disambigueringen, så delvis fjerning er det riktige.
    expect(nameToId('Jotam (Jerubbaals (Gideons) yngste sønn)')).toBe('jotam-jerubbaals-yngste-sonn');
});
