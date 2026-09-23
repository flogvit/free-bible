#!/usr/bin/env bun
/**
 * Model test for Bible proofreading: is a new model better than the one we use?
 *
 * Runs the production proofread code from generate/bible.ts — not a copy of its prompts — over
 * eight frozen chapters with 30 known errors, and reports how many each model fixes, what else it
 * changed, and what it costs. Every run is kept in out/, so the report compares the new model
 * with every model tested before it.
 *
 *   bun generate/eval/proofread/run.ts --model claude-opus-6            # both methods, 2 runs each
 *   bun generate/eval/proofread/run.ts --model claude-opus-6 --method retranslate --runs 3
 *   bun generate/eval/proofread/run.ts --report                         # table only, no API calls
 *
 * The test set (targets.json, chapters/): 198 verses of osnb and osnn. 13 errors are real — found
 * by readers or on inspection, frozen here as they stood on 2026-09-23 so the test keeps working
 * after the data is fixed — and 17 are planted: a wrong number, a dropped clause, a dropped
 * negation, a wrong gender, swapped names. A target counts as fixed when none of its `bad`
 * strings remain and one string from each `need` list is present. 2 Tim 1,7 «sjølvdisiplin» is a
 * defensible rendering and must be left alone.
 *
 * Methods, both as bible.ts runs them, one round, no footnotes:
 *   proofread    --proofread --batch --text-only
 *   retranslate  --proofread --retranslate
 *
 * Reading the result: `fixed` is what we are after. `other changes` counts verses changed outside
 * the targets — some are real errors the test set does not know about, some are taste; read them
 * in the out/ file before counting them for or against a model. Runs of the same model differ,
 * so a difference of one fixed error between two models is noise.
 *
 * What is NOT tested: the loop that runs the batch proofread again until the score reaches 8,
 * footnotes, and the reference-work renewal (generate/eval/reference-works/ has its own).
 */
import '../../env.js';
import fs from 'fs';
import path from 'path';
import {parseArgs, formatHelp, COMMON_FLAGS} from '../../cli.js';
import type {FlagSpec} from '../../cli.js';
import {bibles, getBibleStyle} from '../../constants.js';
import type {Verse} from '../../../kvn/src/bible-types.js';
import {
    configureRun, usageTotals, usageCost, readOriginalText, doAnthropicCallWithRetry, getProofreadPrompt,
    createProofreadBatches, evaluateSuggestion, MIN_LENGTH_RATIO, PROOFREAD_TEXT_SCHEMA,
    retranslateVerdicts, applyRetranslate,
} from '../../bible.js';

const DIR = import.meta.dir;
const METHODS = ['proofread', 'retranslate'] as const;
type Method = typeof METHODS[number];
// Verses in osnb and osnn, for the per-translation estimate.
const BIBLE_VERSES = 31167;

const SPEC: Record<string, FlagSpec> = {
    model: {kind: 'string', help: 'Claude model to test'},
    method: {kind: 'string', default: 'both', help: 'proofread, retranslate or both'},
    runs: {kind: 'number', default: 2, help: 'runs per method; the same model differs from run to run'},
    effort: {kind: 'string', help: 'output_config.effort; without it the model\'s own default applies'},
    report: {kind: 'boolean', help: 'print the comparison of everything in out/ and exit'},
    help: COMMON_FLAGS.help,
};

interface Target { t: string; b: number; c: number; v: number; kind: string; real: boolean; bad: string[]; need: string[][] }
interface Change { key: string; before: string; after: string; reason: string }
interface RunRecord {
    model: string; effort: string | null; method: Method; at: string;
    cost: number | null; verses: number; fixed: string[]; missed: string[];
    trapChanged: boolean; other: Change[];
}

const {targets, mustNotChange}: {targets: Target[]; mustNotChange: {t: string; b: number; c: number; v: number}[]} =
    JSON.parse(fs.readFileSync(path.join(DIR, 'targets.json'), 'utf8'));
const chapters = [...new Map(targets.map(x => [`${x.t}/${x.b}/${x.c}`, x])).values()].map(x => ({t: x.t, b: x.b, c: x.c}));
const key = (t: string, b: number, c: number, v: number) => `${t} ${b}:${c}:${v}`;

function frozen(t: string, b: number, c: number): Verse[] {
    return JSON.parse(fs.readFileSync(path.join(DIR, 'chapters', t, String(b), `${c}.json`), 'utf8'));
}

function isFixed(x: Target, text: string): boolean {
    return !x.bad.some(s => text.includes(s)) && x.need.every(alts => alts.some(s => text.includes(s)));
}

/** Run one method over one chapter; returns the chapter as it would stand after --apply. */
async function runChapter(method: Method, t: string, b: number, c: number): Promise<{after: Verse[]; reasons: Map<number, string>}> {
    const before = frozen(t, b, c);
    const after: Verse[] = structuredClone(before);
    const language = bibles[t];
    const style = getBibleStyle(t);
    const original = readOriginalText(b, c, []);
    const reasons = new Map<number, string>();

    if (method === 'retranslate') {
        const result = await retranslateVerdicts(language, style, b, c, before, original);
        applyRetranslate(after, result);
        for (const r of result.replace) reasons.set(r.verseId, r.reason);
    } else {
        for (const batch of createProofreadBatches(before, original)) {
            const ids = new Set(batch.map(v => +v.verseId));
            const orig = original.filter(v => ids.has(+v.verseId)).map(v => `${v.verseId}: ${v.text}`).join('\n');
            const r = await doAnthropicCallWithRetry<{issues: {verseId: number; suggested: string; explanation: string}[]}>(
                getProofreadPrompt(language, style, b, c, orig, batch, true), PROOFREAD_TEXT_SCHEMA, `eval ${t} ${b}:${c}`, language !== 'English');
            // The same guards applyProofreadChanges uses, so a rejected suggestion counts as not made.
            for (const i of r.issues) {
                const v = after.find(x => +x.verseId === +i.verseId);
                if (!v || !i.suggested) continue;
                const {ratio, newText, dropsMarker} = evaluateSuggestion(v.text, i.suggested);
                if (ratio < MIN_LENGTH_RATIO || dropsMarker) continue;
                v.text = newText;
                reasons.set(+i.verseId, i.explanation);
            }
        }
    }
    return {after, reasons};
}

async function run(method: Method, model: string, effort: string | null): Promise<RunRecord> {
    usageTotals.input = 0; usageTotals.output = 0; usageTotals.calls = 0;
    const results = await Promise.all(chapters.map(async ch => ({...ch, before: frozen(ch.t, ch.b, ch.c), ...await runChapter(method, ch.t, ch.b, ch.c)})));

    const fixed: string[] = [], missed: string[] = [], other: Change[] = [];
    let trapChanged = false;
    for (const r of results) {
        for (const v of r.after) {
            const k = key(r.t, r.b, r.c, +v.verseId);
            const prev = r.before.find(x => +x.verseId === +v.verseId)!.text;
            const target = targets.find(x => key(x.t, x.b, x.c, x.v) === k);
            if (target) (isFixed(target, v.text) ? fixed : missed).push(k);
            else if (v.text !== prev) {
                if (mustNotChange.some(m => key(m.t, m.b, m.c, m.v) === k)) trapChanged = true;
                other.push({key: k, before: prev, after: v.text, reason: r.reasons.get(+v.verseId) ?? ''});
            }
        }
    }
    const verses = results.reduce((n, r) => n + r.before.length, 0);
    return {model, effort, method, at: new Date().toISOString(), cost: usageCost(), verses, fixed, missed, trapChanged, other};
}

function report(): void {
    const outDir = path.join(DIR, 'out');
    const records: RunRecord[] = fs.existsSync(outDir)
        ? fs.readdirSync(outDir).filter(f => f.endsWith('.json')).map(f => JSON.parse(fs.readFileSync(path.join(outDir, f), 'utf8')))
        : [];
    const groups = new Map<string, RunRecord[]>();
    for (const r of records) {
        const g = `${r.method}|${r.model}${r.effort ? ` (${r.effort})` : ''}`;
        groups.set(g, [...(groups.get(g) || []), r]);
    }
    console.log(`\n${targets.length} known errors in ${chapters.length} chapters, ${records[0]?.verses ?? '?'} verses. Cost at list price; per translation = ${BIBLE_VERSES.toLocaleString()} verses, one round.\n`);
    console.log(`${'method'.padEnd(12)} ${'model'.padEnd(26)} ${'runs'.padStart(4)}  ${'fixed'.padEnd(12)} ${'other changes'.padEnd(14)} ${'$/verse'.padStart(8)} ${'$/translation'.padStart(14)}`);
    const sorted = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
    for (const [g, rs] of sorted) {
        const [method, model] = g.split('|');
        const perVerse = rs.every(r => r.cost !== null) ? rs.reduce((n, r) => n + r.cost! / r.verses, 0) / rs.length : null;
        console.log(`${method.padEnd(12)} ${model.padEnd(26)} ${String(rs.length).padStart(4)}  ${rs.map(r => r.fixed.length).join(', ').padEnd(12)} ${rs.map(r => r.other.length).join(', ').padEnd(14)} ${perVerse === null ? '?'.padStart(8) : perVerse.toFixed(4).padStart(8)} ${perVerse === null ? '?'.padStart(14) : `$${Math.round(perVerse * BIBLE_VERSES)}`.padStart(14)}`);
        const always = targets.map(x => key(x.t, x.b, x.c, x.v)).filter(k => rs.every(r => r.missed.includes(k)));
        if (always.length) console.log(`${''.padEnd(44)}missed every run: ${always.join('; ')}`);
        if (rs.some(r => r.trapChanged)) console.log(`${''.padEnd(44)}changed 2 Tim 1,7 in ${rs.filter(r => r.trapChanged).length} run(s) — must be left alone`);
    }
    console.log(`\nChanges outside the targets are listed per run in ${path.relative(process.cwd(), outDir)}/ under "other".`);
}

const {flags} = parseArgs(process.argv.slice(2), SPEC);
if (flags.help) {
    console.log(formatHelp('generate/eval/proofread/run.ts', 'Model test for Bible proofreading: the production code over 30 known errors, compared with every model tested before.', SPEC));
    process.exit(0);
}
if (!flags.report) {
    if (!flags.model) { console.error('--model is required (or --report)'); process.exit(1); }
    const model = flags.model as string;
    const effort = (flags.effort as string | undefined) ?? null;
    const methods: Method[] = flags.method === 'both' ? [...METHODS] : [flags.method as Method];
    if (!methods.every(m => METHODS.includes(m))) { console.error(`--method must be ${METHODS.join(', ')} or both`); process.exit(1); }
    configureRun({model, effort: effort ?? undefined});
    fs.mkdirSync(path.join(DIR, 'out'), {recursive: true});
    for (const method of methods) {
        for (let i = 1; i <= (flags.runs as number); i++) {
            const r = await run(method, model, effort);
            const file = path.join(DIR, 'out', `${method}-${model}${effort ? `-${effort}` : ''}-${r.at.replace(/[:.]/g, '-')}.json`);
            fs.writeFileSync(file, JSON.stringify(r, null, 2) + '\n');
            console.log(`${method} run ${i}: fixed ${r.fixed.length}/${targets.length}, ${r.other.length} other changes, ${r.cost === null ? 'no price' : `$${r.cost.toFixed(2)}`}`);
        }
    }
}
report();
