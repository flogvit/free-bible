/**
 * node --test generate/
 *
 * Dekker isClosedSchema, som avgjør om en modell uten `openSchema` kan adopteres.
 * Skjemaene under er de faktiske i repoet: JUDGE_SCHEMA er det gemma4 ble målt
 * til 64/64 gyldige svar på, REFERENCE_PROOFREAD_SCHEMA er det den degraderte på
 * og som ga opphav til flagget.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {isClosedSchema} from './llm.js';

// kvn/scripts/verify-text.ts
const JUDGE_SCHEMA = {
    type: 'object',
    properties: {verdict: {type: 'string', enum: ['EQUIVALENT', 'B_MISSING', 'B_EXTRA', 'DIFFERENT']}},
    required: ['verdict'],
};

// generate/references.mjs
const REFERENCE_PROOFREAD_SCHEMA = {
    type: 'object',
    properties: {
        issues: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    type: {type: 'string', enum: ['error', 'missing']},
                    severity: {type: 'string', enum: ['critical', 'major']},
                    reference: {type: 'string'},
                    explanation: {type: 'string'},
                },
            },
        },
        summary: {type: 'string'},
        score: {type: 'integer'},
    },
};

// generate/triage.mjs
const TRIAGE_SCHEMA = {
    type: 'object',
    properties: {
        score: {type: 'integer'},
        issues: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    category: {type: 'string', enum: ['omission', 'addition']},
                    detail: {type: 'string'},
                },
            },
        },
    },
};

test('lukket: enum binder verdien', () => {
    assert.equal(isClosedSchema(JUDGE_SCHEMA), true);
});

test('lukket: tall og boolske verdier', () => {
    assert.equal(isClosedSchema({type: 'object', properties: {hit: {type: 'boolean'}}}), true);
    assert.equal(isClosedSchema({type: 'object', properties: {n: {type: 'integer'}}}), true);
});

test('lukket: array med maxItems og enum-elementer', () => {
    assert.equal(isClosedSchema({
        type: 'object',
        properties: {tags: {type: 'array', maxItems: 3, items: {type: 'string', enum: ['a', 'b']}}},
    }), true);
});

test('åpen: fritekstfelt', () => {
    assert.equal(isClosedSchema({type: 'object', properties: {note: {type: 'string'}}}), false);
});

test('åpen: ubegrenset array, selv med enum-elementer', () => {
    assert.equal(isClosedSchema({
        type: 'object',
        properties: {tags: {type: 'array', items: {type: 'string', enum: ['a', 'b']}}},
    }), false);
});

test('åpen: skjemaene flagget faktisk kom fra', () => {
    assert.equal(isClosedSchema(REFERENCE_PROOFREAD_SCHEMA), false);
    assert.equal(isClosedSchema(TRIAGE_SCHEMA), false);
});

test('åpen ved tvil: ukjent eller tomt', () => {
    assert.equal(isClosedSchema(undefined), false);
    assert.equal(isClosedSchema({}), false);
    assert.equal(isClosedSchema({type: 'object'}), false);
    assert.equal(isClosedSchema({type: 'object', additionalProperties: true, properties: {n: {type: 'integer'}}}), false);
});
