/**
 * bun test
 *
 * Dekker parsingen i env.ts. Den erstatter dotenv, og en `.env`-parser som
 * tar feil er stille: nøkkelen blir bare borte, og skriptet feiler et helt
 * annet sted med «mangler API-nøkkel».
 */
import {test, expect} from 'bun:test';
import {parseEnv} from './env.js';

test('enkle par', () => {
    expect(parseEnv('A=1\nB=to')).toEqual({A: '1', B: 'to'});
});

test('kommentarer og tomme linjer hoppes over', () => {
    expect(parseEnv('# kommentar\n\nA=1\n   # innrykket kommentar\nB=2')).toEqual({A: '1', B: '2'});
});

test('mellomrom rundt nøkkel og verdi trimmes', () => {
    expect(parseEnv('  A  =  1  ')).toEqual({A: '1'});
});

test('verdier kan inneholde likhetstegn', () => {
    expect(parseEnv('URL=https://x.no/?a=1&b=2')).toEqual({URL: 'https://x.no/?a=1&b=2'});
});

test('omsluttende sitater fjernes', () => {
    expect(parseEnv('A="hei"\nB=\'hei\'')).toEqual({A: 'hei', B: 'hei'});
});

test('sitater INNI en verdi beholdes', () => {
    // Regresjon: en naiv `.replace(/["']/g, "")` ville spist disse.
    expect(parseEnv('A=say "hi"')).toEqual({A: 'say "hi"'});
});

test('\\n er escape bare i doble sitater', () => {
    expect(parseEnv('A="linje1\\nlinje2"')).toEqual({A: 'linje1\nlinje2'});
    expect(parseEnv("B='linje1\\nlinje2'")).toEqual({B: 'linje1\\nlinje2'});
});

test('linjer uten likhetstegn ignoreres', () => {
    expect(parseEnv('bare tekst\nA=1')).toEqual({A: '1'});
});

test('tom nøkkel ignoreres', () => {
    expect(parseEnv('=verdi\nA=1')).toEqual({A: '1'});
});

test('tom verdi er lov', () => {
    expect(parseEnv('A=')).toEqual({A: ''});
});
