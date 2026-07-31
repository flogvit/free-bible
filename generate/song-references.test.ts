/**
 * bun test
 *
 * Dekker lesinga av den strømmede ollama-responsen i song-references.ts.
 *
 * Regresjonen som ga opphav til testene: kallet hadde én frist for HELE
 * forespørselen (`AbortSignal.timeout(300000)`). Målt genereringsfart var 8,6
 * t/s, så fristen ga et tak på ~2 500 tokens — og en sang med ni referanser
 * genererte 1 833. Sanger som lå over taket ble drept midt i, alt arbeidet
 * kastet, og fordi `fetch` lå utenfor try-en slo `retries` aldri inn.
 */
import { test, expect } from 'bun:test';

import { readOllamaStream, extractJson } from './song-references.js';

const encoder = new TextEncoder();

/** Ollama-lignende strøm: én NDJSON-linje per bit, med pause foran hver. */
async function* stream(
    parts: string[],
    { gapMs = 0, stallAfter = null }: { gapMs?: number; stallAfter?: number | null } = {},
) {
    for (let i = 0; i < parts.length; i++) {
        if (stallAfter !== null && i === stallAfter) {
            await new Promise(r => setTimeout(r, 400));      // stille langt forbi idleMs
        }
        if (gapMs) await new Promise(r => setTimeout(r, gapMs));
        yield encoder.encode(JSON.stringify({ response: parts[i], done: false }) + '\n');
    }
    yield encoder.encode(JSON.stringify({ response: '', done: true }) + '\n');
}

test('setter sammen response-bitene i rekkefølge', async () => {
    const out = await readOllamaStream(stream(['{"a":', '1', '}']), { idleMs: 1000 });
    expect(out).toBe('{"a":1}');
});

test('et TREGT kall overlever, så lenge det gjør framgang', async () => {
    // Åtte biter à 40 ms = 320 ms total, godt over idleMs på 120 ms. Med den
    // gamle fristen på hele forespørselen ville dette blitt drept; her skal det
    // gå igjennom, fordi det aldri er stille lenge nok om gangen.
    const parts = ['1', '2', '3', '4', '5', '6', '7', '8'];
    const out = await readOllamaStream(stream(parts, { gapMs: 40 }), { idleMs: 120 });
    expect(out).toBe('12345678');
});

test('et STANSET kall avbrytes, og abort blir kalt', async () => {
    let aborted = false;
    await expect(
        readOllamaStream(stream(['a', 'b', 'c'], { stallAfter: 1 }), {
            idleMs: 50,
            abort: () => { aborted = true; },
        }),
    ).rejects.toThrow(/antatt stanset/);
    // abort skal kalles så forespørselen faktisk slippes
    expect(aborted).toBe(true);
});

test('en linje som er delt over to biter settes sammen', async () => {
    async function* split() {
        const line = JSON.stringify({ response: 'hei', done: false }) + '\n';
        yield encoder.encode(line.slice(0, 12));
        yield encoder.encode(line.slice(12));
    }
    expect(await readOllamaStream(split(), { idleMs: 1000 })).toBe('hei');
});

test('feil fra ollama kastes videre', async () => {
    async function* boom() {
        yield encoder.encode(JSON.stringify({ error: 'model not found' }) + '\n');
    }
    await expect(readOllamaStream(boom(), { idleMs: 1000 })).rejects.toThrow(/model not found/);
});

test('extractJson tar både rå JSON, ```json-blokk og innbakt objekt', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Her er svaret:\n{"a":1}\nferdig')).toEqual({ a: 1 });
    expect(extractJson('ikke json i det hele tatt')).toBe(null);
});
