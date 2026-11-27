import {describe, expect, test} from 'bun:test';
import {
    apiAccounts, spentIn, afterReview, afterTranslation, applyFindings, bookFiles, chaptersFromEntries, costOf, failed, isCreditExhausted,
    lastSend, mechanicalProblems, nextRequests, osisToParagraphs, recheck, reviewPrompt, splitParagraphs, translatePrompt, WORKS, worstCase,
    type Review, type Unit,
} from './commentary.js';

// Gen 1:3-5 as the MHC module has it, cut short.
const GEN_1_3 = '<div eID="gen34" type="x-p"/> <title type="x-s3">The Creation. (<hi type="small-caps">b. c.</hi> 4004.)</title> <div sID="gen35" type="x-p"/> <hi type="super">3</hi> And God said, Let there be light: and there was light. <hi type="super">4</hi> And God saw the light, that <hi type="italic">it was</hi> good. <div eID="gen35" type="x-p"/> <div sID="gen36" type="x-p"/> We have here a further account, <reference osisRef="John.3.21">John iii. 21</reference>. <note placement="foot">Hil. Megil. c. 2, &amp;#167; 11.</note><div eID="gen36" type="x-p"/>';

describe('osisToParagraphs', () => {
    test('keeps headings, verse numbers, italics, references and notes; drops structure', () => {
        expect(osisToParagraphs(GEN_1_3)).toEqual([
            '<h>The Creation. (b. c. 4004.)</h>',
            '<sup>3</sup> And God said, Let there be light: and there was light. <sup>4</sup> And God saw the light, that <i>it was</i> good.',
            'We have here a further account, <ref osisRef="John.3.21">John iii. 21</ref>. <note>Hil. Megil. c. 2, § 11.</note>',
        ]);
    });

    test('poetry lines become line breaks inside one paragraph', () => {
        const osis = 'describe it, <div eID="g1" type="x-p"/> <lg sID="g2"/> <l level="1" sID="g3"/>"He that is drunken<l eID="g3" level="1"/> <l level="1" sID="g4"/>Big with his sister."<l eID="g4" level="1"/> <lg eID="g2"/> <div sID="g5" type="x-p"/> A man may';
        expect(osisToParagraphs(osis)).toEqual(['describe it,', '"He that is drunken<br> Big with his sister."', 'A man may']);
    });

    test('an entry that is only markup has no paragraphs', () => {
        expect(osisToParagraphs('<chapter n="1" osisID="Gen.1" sID="Gen.1"/> ')).toEqual([]);
    });
});

test('chaptersFromEntries groups sections per chapter and drops empty entries', () => {
    const files = chaptersFromEntries('mhc', 'en', [
        {book: 1, chapter: 1, from: 0, to: 0, text: '<chapter n="1"/> '},
        {book: 1, chapter: 1, from: 1, to: 2, text: '<div sID="a" type="x-p"/>One.'},
        {book: 1, chapter: 1, from: 3, to: 5, text: 'Two.'},
        {book: 1, chapter: 2, from: 1, to: 1, text: 'Three.'},
    ]);
    expect(files.map(f => [f.chapter, f.sections.map(s => `${s.from}-${s.to}`)])).toEqual([[1, ['1-2', '3-5']], [2, ['1-1']]]);
});

test('splitParagraphs never splits a paragraph and keeps parts under the limit', () => {
    expect(splitParagraphs(['aaaa', 'bbbb', 'cc', 'dddddddddd', 'e'], 8)).toEqual([[0, 2], [2, 3], [3, 4], [4, 5]]);
    expect(splitParagraphs([], 8)).toEqual([]);
});

describe('applyFindings — findings carry only the changed passage', () => {
    test('replaces a unique quote in its paragraph', () => {
        const r = applyFindings(['Gud sa: Bli lys.', 'Og det ble lys.'], [
            {paragraph: 2, quote: 'ble lys', replacement: 'ble det lys', type: 'language', severity: 'minor', explanation: ''},
        ]);
        expect(r).toEqual({text: ['Gud sa: Bli lys.', 'Og det ble det lys.'], skipped: []});
    });

    test('a quote that is missing or not unique is skipped, never guessed at', () => {
        const r = applyFindings(['lys og lys'], [
            {paragraph: 1, quote: 'lys', replacement: 'mørke', type: 'meaning', severity: 'critical', explanation: ''},
            {paragraph: 1, quote: 'natt', replacement: 'dag', type: 'meaning', severity: 'minor', explanation: ''},
            {paragraph: 3, quote: 'x', replacement: 'y', type: 'meaning', severity: 'minor', explanation: ''},
        ]);
        expect(r.text).toEqual(['lys og lys']);
        expect(r.skipped.length).toBe(3);
    });
});

test('mechanicalProblems: paragraph count, and references per paragraph', () => {
    const src = ['See <ref osisRef="John.3.21">John iii. 21</ref>.', 'Temple, p. 329.'];
    expect(mechanicalProblems(src, ['Se <ref osisRef="John.3.21">Joh 3,21</ref>.', 'Temple, s. 329.'])).toEqual([]);
    expect(mechanicalProblems(src, ['Se Joh 3,21.', 'Temple, s. 329.'])).toEqual(['paragraph 1: ref: missing John.3.21']);
    expect(mechanicalProblems(src, ['alt i ett'])).toEqual(['1 paragraphs, the source has 2']);
});

const SOURCE = ['God said, <ref osisRef="Gen.1.3">v. 3</ref>.'];
const unit = (over: Partial<Unit> = {}): Unit => ({
    id: '1-1-0-0', section: 0, start: 0, end: 1, status: 'draft', rounds: 0, attempts: 0, versions: [], reviews: [],
    text: ['Gud sa, <ref osisRef="Gen.1.3">v. 3</ref>.'], translator: 'm', model: 'm', ...over,
});
const review = (over: Partial<Review> = {}): Review => ({
    issues: [], argument: {premises: true, conclusions: true, evidence: true, problems: ''}, score: 9, summary: '', ...over,
});

describe('afterReview — the gate', () => {
    test('clean review: checked, text unchanged, no new version', () => {
        const u = afterReview(unit(), SOURCE, review(), 'm', 3);
        expect([u.status, u.versions.length, u.rounds]).toEqual(['checked', 0, 1]);
    });

    test('minor findings are applied and do not hold the unit back', () => {
        const u = afterReview(unit(), SOURCE, review({issues: [
            {paragraph: 1, quote: 'Gud sa,', replacement: 'Gud sa:', type: 'language', severity: 'minor', explanation: 'kolon'},
        ]}), 'm', 3);
        expect(u.status).toBe('checked');
        expect(u.text).toEqual(['Gud sa: <ref osisRef="Gen.1.3">v. 3</ref>.']);
        expect(u.versions).toEqual([{text: unit().text!, explanation: 'kolon', model: 'm'}]);
    });

    test('a major finding is applied but the fix must be reviewed again', () => {
        const u = afterReview(unit(), SOURCE, review({issues: [
            {paragraph: 1, quote: 'Gud sa', replacement: 'Gud talte', type: 'meaning', severity: 'major', explanation: ''},
        ]}), 'm', 3);
        expect([u.status, u.text![0].startsWith('Gud talte')]).toEqual(['draft', true]);
    });

    test('a lost premise, conclusion or piece of evidence holds the unit back', () => {
        const u = afterReview(unit(), SOURCE, review({argument: {premises: true, conclusions: true, evidence: false, problems: 'belegget mangler'}}), 'm', 3);
        expect(u.status).toBe('draft');
    });

    test('a broken reference holds the unit back even when the reviewer saw nothing', () => {
        const u = afterReview(unit({text: ['Gud sa, v. 3.']}), SOURCE, review(), 'm', 3);
        expect(u.status).toBe('draft');
        expect(u.reviews[0].mechanical).toEqual(['paragraph 1: ref: missing Gen.1.3']);
    });

    test('still not clean after the last round: stuck, with the reason', () => {
        const u = afterReview(unit({rounds: 2, text: ['Gud sa, v. 3.']}), SOURCE, review(), 'm', 3);
        expect([u.status, u.note]).toEqual(['stuck', 'not clean after 3 reviews']);
    });
});

test('afterTranslation: a wrong paragraph count is a failed attempt, and the third one is stuck', () => {
    const fresh = unit({status: 'new', text: undefined, translator: undefined, model: undefined});
    const once = afterTranslation(fresh, SOURCE, ['a', 'b'], 'm');
    expect([once.status, once.attempts]).toEqual(['new', 1]);
    const third = afterTranslation({...fresh, attempts: 2}, SOURCE, [], 'm');
    expect(third.status).toBe('stuck');
    const ok = afterTranslation(fresh, SOURCE, ['Gud sa'], 'm');
    expect([ok.status, ok.translator, ok.text]).toEqual(['draft', 'm', ['Gud sa']]);
});

test('nextRequests: new → translate, draft → review, nothing for checked, stuck or in-flight units', () => {
    const us = [unit({id: 'a', status: 'new'}), unit({id: 'b'}), unit({id: 'c', status: 'checked'}), unit({id: 'd', status: 'stuck'}), unit({id: 'e'})];
    expect(nextRequests(us, new Set(['e']))).toEqual([{kind: 'translate', id: 'a'}, {kind: 'review', id: 'b'}]);
});

test('worstCase prices the largest answer a request may give, at half price', () => {
    const r = {custom_id: 't_1', params: {model: 'claude-fable-5-2', max_tokens: 32000, messages: [{role: 'user' as const, content: 'x'.repeat(2990)}]}};
    // input: 3000 chars of JSON / 3 = 1000 tokens × $8; output 32 000 × $40; per million, halved
    expect(worstCase('claude-fable-5-2', r)).toBeCloseTo(0.5 * (1000 * 8 + 32000 * 40) / 1e6, 3);
    expect(() => worstCase('no-such-model', r)).toThrow(/no price/);
});

test('isCreditExhausted recognises the API saying the credit is used up, and nothing else', () => {
    const msg = 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.';
    expect(isCreditExhausted({type: 'error', error: {type: 'invalid_request_error', message: msg}})).toBe(true);
    expect(isCreditExhausted({error: {type: 'billing_error', message: 'x'}})).toBe(true);
    expect(isCreditExhausted(new Error(`400 ${JSON.stringify({type: 'error', error: {type: 'invalid_request_error', message: msg}})}`))).toBe(true);
    expect(isCreditExhausted({type: 'error', error: {type: 'overloaded_error', message: 'Overloaded'}})).toBe(false);
});

describe('prompt caching (#163: as cheap as it can be)', () => {
    test('the fixed part of a prompt is the same for every unit, and the unit stays out of it', () => {
        const w = Object.values(WORKS)[0];
        const file = {work: 'mhc', language: 'en', book: 1, chapter: 1, sections: [{from: 1, to: 2, paragraphs: ['<sup>1</sup> In the beginning.', 'Note.']}]} as any;
        const a = {id: '1-1-0-0', section: 0, start: 0, end: 2, status: 'draft', text: ['<sup>1</sup> I begynnelsen.', 'Merk.'], rounds: 0, attempts: 0, versions: [], reviews: []} as any;
        const b = {...a, id: '1-1-0-1', start: 1};
        for (const make of [translatePrompt, reviewPrompt]) {
            expect(make(w, 'nb', file, a).fixed).toBe(make(w, 'nb', {...file, chapter: 9}, b).fixed);
            expect(make(w, 'nb', file, a).fixed).not.toContain('In the beginning');
            expect(make(w, 'nb', file, a).unit).toContain('In the beginning');
        }
    });
    test('cache writes and reads are counted in what was spent', () => {
        const usage = {input_tokens: 1000, output_tokens: 1000, cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 0} as any;
        // 0.5 x (1000 x $8 + 1M x $0.20 + 1000 x $40) / 1M
        expect(costOf('claude-fable-5-2', usage)).toBeCloseTo(0.5 * (8000 + 200_000 + 40_000) / 1e6, 9);
        const written = {input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 1_000_000, cache_read_input_tokens: 0,
            cache_creation: {ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 1_000_000}} as any;
        expect(costOf('claude-fable-5-2', written)).toBeCloseTo(0.5 * 16, 9);
    });
});

test('a unit stuck after its retry stays stuck and is not retried again', () => {
    const u = {id: '1-1-0-0', section: 0, start: 0, end: 1, status: 'stuck', text: ['x'], rounds: 3, attempts: 0, versions: [], reviews: [], note: 'not clean after 3 reviews', retried: true} as any;
    expect(nextRequests([u], new Set())).toEqual([]);
});

describe('a book whose last unit is stuck is not left behind (#173)', () => {
    const w = Object.values(WORKS)[0];
    const source = {work: 'mhc', language: 'en', book: 8, chapter: 2, sections: [{from: 1, to: 3, paragraphs: ['One.', 'Two, v. 3.']}]} as any;
    const done = {id: '8-2-0-0', section: 0, start: 0, end: 1, status: 'checked', text: ['En.'], translator: 'm', model: 'm', rounds: 1, attempts: 0, versions: [], reviews: []} as any;
    const found = {issues: [{paragraph: 1, quote: 'To', replacement: 'To,', type: 'reference', severity: 'major', explanation: 'henvisningen til v. 3 mangler'}],
        argument: {premises: true, conclusions: true, evidence: false, problems: 'belegget v. 3 er borte'}, score: 4, summary: '', model: 'm', mechanical: [], skipped: ['[major] paragraph 1: quote not found: «Tu»']} as any;
    const stuck = {id: '8-2-0-1', section: 0, start: 1, end: 2, status: 'stuck', text: ['To.'], translator: 'm', model: 'm', rounds: 3, attempts: 0, versions: [], reviews: [found], note: 'not clean after 3 reviews'} as any;
    const files = (last: Unit) => bookFiles([{book: 8, chapter: 2, units: [done, last]}], new Map([['8-2', source]]), 'nb');

    test('it is sent once more, on its own, with what its review found', () => {
        expect(files(stuck)).toBeUndefined();
        const again = lastSend(stuck, 3);
        expect([again.status, again.retried, nextRequests([done, again], new Set())]).toEqual(['draft', true, [{kind: 'review', id: '8-2-0-1'}]]);
        const prompt = reviewPrompt(w, 'nb', source, again).unit;
        for (const s of ['henvisningen til v. 3 mangler', 'belegget v. 3 er borte', 'quote not found: «Tu»']) expect(prompt).toContain(s);
        expect(reviewPrompt(w, 'nb', source, {...again, retried: false}).unit).not.toContain('belegget v. 3 er borte');
    });

    test('still not clean after that: the book is published, the unit marked as not checked', () => {
        const after = afterReview(lastSend(stuck, 3), ['Two, v. 3.'], found, 'm', 3);
        expect(after.status).toBe('stuck');
        expect(nextRequests([done, after], new Set())).toEqual([]);
        expect(files(after)![0].sections).toEqual([{from: 1, to: 3, paragraphs: ['En.', ...after.text!], models: ['m'], unchecked: [{start: 1, end: 2}]}]);
    });

    test('a unit that never got a translation is published in its English', () => {
        const untranslated = {...stuck, status: 'stuck', text: undefined, translator: undefined, model: undefined, attempts: 3, reviews: [], note: 'answer was not JSON'};
        const again = lastSend(untranslated, 3);
        expect([again.status, again.attempts]).toEqual(['new', 2]);
        const after = failed(again, 'answer was not JSON');
        expect(after.status).toBe('stuck');
        expect(files(after)![0].sections[0]).toEqual({from: 1, to: 3, paragraphs: ['En.', 'Two, v. 3.'], models: ['m'], unchecked: [{start: 1, end: 2, english: true}]});
    });

    test('a book whose units are all checked carries no mark', () => {
        expect(files({...stuck, status: 'checked'})![0].sections[0].unchecked).toBeUndefined();
    });
});

test('a stuck unit its review passed is checked once the reference check no longer raises a false alarm', () => {
    // 1-1-5-0: held through six reviews that found nothing, by «&c. 2.» read as chapter 2.
    const passed = {issues: [], argument: {premises: true, conclusions: true, evidence: true, problems: ''}, score: 9, summary: '', model: 'm', mechanical: ['paragraph 1: chapter: missing 2'], skipped: []};
    const u = {id: '1-1-5-0', section: 0, start: 0, end: 1, status: 'stuck', text: ['Sal 104,25 osv. 2. Velsignelsen'], rounds: 3, attempts: 0, versions: [], reviews: [passed], note: 'not clean after 3 reviews', retried: true} as any;
    expect(recheck(u, ['Ps. civ. 25 , &amp;c. 2. The blessing']).status).toBe('checked');
    expect(recheck(u, ['Ps. civ. 25 , ch. 2. The blessing']).status).toBe('stuck');
    const major = {...passed, issues: [{paragraph: 1, quote: 'x', replacement: 'y', type: 't', severity: 'major', explanation: ''}]};
    expect(recheck({...u, reviews: [major]}, ['Ps. civ. 25 , &amp;c. 2. The blessing']).status).toBe('stuck');
});

test('the API accounts come in their order, each with a name, and only from the keys Dux gives', () => {
    expect(apiAccounts({DUX_ANTHROPIC_API_KEYS: 'vhanssen-menneske.no\tsk-a\twrkspc_1\nother\tsk-b\t\n', ANTHROPIC_API_KEY: 'never'}))
        .toEqual([{name: 'vhanssen-menneske.no', key: 'sk-a', workspace: 'wrkspc_1'}, {name: 'other', key: 'sk-b', workspace: undefined}]);
    expect(apiAccounts({DUX_ANTHROPIC_API_KEY: 'sk-a', DUX_ANTHROPIC_WORKSPACE_ID: 'wrkspc_1'})).toEqual([{name: 'default', key: 'sk-a', workspace: 'wrkspc_1'}]);
    expect(apiAccounts({ANTHROPIC_API_KEY: 'never'})).toEqual([]);
});

test('each account has its own month: rows from before accounts were named are the first one\'s', () => {
    const now = new Date('2026-11-26T20:00:00Z');
    const rows = [
        {usd: 150, ended: '2026-11-20T10:00:00Z'},                              // before rows named their account
        {usd: 40, ended: '2026-11-26T18:00:00Z', account: 'vhanssen-menneske.no'},
        {usd: 5, ended: '2026-11-26T19:00:00Z', account: 'other'},
        {usd: 99, ended: '2026-10-31T23:00:00Z', account: 'other'},             // last month
    ];
    expect(spentIn(rows, now, 'vhanssen-menneske.no', 'vhanssen-menneske.no')).toBe(190);
    expect(spentIn(rows, now, 'other', 'vhanssen-menneske.no')).toBe(5);
    expect(spentIn(rows, now)).toBe(195);
});
