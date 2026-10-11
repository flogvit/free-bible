/**
 * bun test
 *
 * Driver word4word sin kallvei mot en falsk Anthropic (#130). Generatorene kalte
 * `messages.create` uten strømming, og med maxTokens 32000 kastet SDK-en før
 * noe ble sendt: «Streaming is required for operations that may take longer
 * than 10 minutes». Testen bytter ut `fetch`, så ingenting går ut på nettet.
 */
import {test, expect, beforeAll, afterAll} from 'bun:test';

/** Én SSE-hendelse slik Messages-API-et strømmer den. */
function sse(event: string, data: unknown): string {
    return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** Et komplett strømmet svar med `text` som eneste tekstblokk. */
function streamedMessage(text: string): Response {
    const body = [
        sse('message_start', {type: 'message_start', message: {
            id: 'msg_test', type: 'message', role: 'assistant', model: 'test', content: [],
            stop_reason: null, stop_sequence: null, usage: {input_tokens: 1, output_tokens: 0},
        }}),
        sse('content_block_start', {type: 'content_block_start', index: 0, content_block: {type: 'text', text: ''}}),
        sse('content_block_delta', {type: 'content_block_delta', index: 0, delta: {type: 'text_delta', text}}),
        sse('content_block_stop', {type: 'content_block_stop', index: 0}),
        sse('message_delta', {type: 'message_delta', delta: {stop_reason: 'end_turn', stop_sequence: null}, usage: {output_tokens: 1}}),
        sse('message_stop', {type: 'message_stop'}),
    ].join('');
    return new Response(body, {headers: {'content-type': 'text/event-stream'}});
}

const originalFetch = globalThis.fetch;
const originalKey = process.env.ANTHROPIC_API_KEY;
/** Kroppene som ble sendt, ett element per forespørsel. */
let requests: Array<Record<string, unknown>> = [];
/** Svarene i rekkefølge; ett tas per forespørsel. */
let replies: string[] = [];

beforeAll(() => {
    process.env.ANTHROPIC_API_KEY = 'test';
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
        requests.push(JSON.parse(String(init?.body)));
        return streamedMessage(replies.shift() ?? '{}');
    }) as typeof fetch;
});

afterAll(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalKey;
});

test('word4word strømmer svaret i stedet for messages.create', async () => {
    const {requestWords} = await import('./word4word.js');
    requests = [];
    replies = [JSON.stringify({verses: [{words: [{word: 'בְּרֵאשִׁית', explanation: 'I begynnelsen'}]}]})];

    const result = await requestWords('prompt', {type: 'object'}, 'test');

    expect(requests).toHaveLength(1);
    expect(requests[0].stream).toBe(true);
    expect(result.verses[0].words[0].explanation).toBe('I begynnelsen');
});

test('word4word prøver på nytt når hallusinasjonssjekken slår ut', async () => {
    const {requestWords} = await import('./word4word.js');
    requests = [];
    replies = [
        JSON.stringify({verses: [{words: [{word: 'x', explanation: 'In the beginning God created'}]}]}),
        JSON.stringify({verses: [{words: [{word: 'x', explanation: 'I begynnelsen'}]}]}),
    ];

    const result = await requestWords('prompt', {type: 'object'}, 'test');

    expect(requests).toHaveLength(2);
    expect(result.verses[0].words[0].explanation).toBe('I begynnelsen');
});
