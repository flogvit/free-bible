/**
 * bun test
 *
 * Dekker den felles flaggkontrakten. Den er nå eneste vei inn for 35 skript,
 * så en feil her er en feil i alle sammen.
 */
import {test, expect} from 'bun:test';
import {parseArgs, formatHelp, COMMON_FLAGS} from './cli.js';
import type {FlagSpec, Range} from './cli.js';

const SPEC: Record<string, FlagSpec> = {
    ...COMMON_FLAGS,
    threshold: {kind: 'float', help: 'terskel', default: 0.6},
    lokalSomStandard: {kind: 'boolean', help: 'på som standard', default: true},
};

test('standardverdier settes', () => {
    const {flags} = parseArgs([], SPEC);
    expect(flags.language).toBe('nb');
    expect(flags.force).toBe(false);
    expect(flags.threshold).toBe(0.6);
});

test('intervall: enkelttall og spenn', () => {
    expect(parseArgs(['--book', '3'], SPEC).flags.book).toEqual({start: 3, end: 3});
    expect(parseArgs(['--book', '1-5'], SPEC).flags.book).toEqual({start: 1, end: 5});
});

test('posisjonsargumenter samles i rekkefølge', () => {
    const {positional} = parseArgs(['osnb', '--nt', 'ekstra'], SPEC);
    expect(positional).toEqual(['osnb', 'ekstra']);
});

test('ukjent flagg kaster', () => {
    // Den gamle oppførselen var stille ignorering — en skrivefeil i et
    // køskript ga da en jobb som kjørte med feil innstilling uten å si fra.
    expect(() => parseArgs(['--finnesikke'], SPEC)).toThrow(/ukjent flagg/);
});

test('flagg uten verdi kaster', () => {
    expect(() => parseArgs(['--language'], SPEC)).toThrow(/mangler verdi/);
    expect(() => parseArgs(['--language', '--nt'], SPEC)).toThrow(/mangler verdi/);
});

test('float bruker parseFloat, ikke parseInt', () => {
    // parseInt('0.60') gir 0, som er falsy — terskelen ville blitt borte.
    expect(parseArgs(['--threshold', '0.60'], SPEC).flags.threshold).toBe(0.6);
    expect(parseArgs(['--threshold', '0.85'], SPEC).flags.threshold).toBe(0.85);
});

test('number avviser ikke-tall', () => {
    expect(() => parseArgs(['--limit', 'mange'], SPEC)).toThrow(/ikke et tall/);
});

test('--no-<flagg> slår av et flagg som står på', () => {
    expect(parseArgs([], SPEC).flags.lokalSomStandard).toBe(true);
    expect(parseArgs(['--no-lokalSomStandard'], SPEC).flags.lokalSomStandard).toBe(false);
});

test('--no- på et ukjent flagg kaster fortsatt', () => {
    expect(() => parseArgs(['--no-finnesikke'], SPEC)).toThrow(/ukjent flagg/);
});

test('--remote avvises med forklaring', () => {
    // Den betydde det MOTSATTE av --local i de skriptene som hadde den, så
    // den kan ikke oversettes mekanisk.
    expect(() => parseArgs(['--remote'], SPEC)).toThrow(/--remote er fjernet/);
});

test('gamle navn godtas, men treffer det nye feltet', () => {
    expect(parseArgs(['--lang', 'nn'], SPEC).flags.language).toBe('nn');
    expect(parseArgs(['--source', 'osnb'], SPEC).flags.bible).toBe('osnb');
    expect(parseArgs(['--n', '5'], SPEC).flags.limit).toBe(5);
    expect(parseArgs(['--dry'], SPEC).flags['dry-run']).toBe(true);
});

test('hjelpeteksten viser standardverdien', () => {
    const h = formatHelp('x.ts', 'gjør noe', SPEC);
    expect(h).toContain('standard: nb');
    expect(h).toContain('standard: 0.6');
});

test('hjelpeteksten viser --no- for flagg som står på', () => {
    const h = formatHelp('x.ts', 'gjør noe', SPEC);
    expect(h).toContain('--no-lokalSomStandard');
});

test('intervall med søppel kaster', () => {
    expect(() => parseArgs(['--book', 'en-to'], SPEC)).toThrow(/gyldig intervall/);
});
