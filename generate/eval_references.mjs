import dotenv from 'dotenv';
import * as fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';
import {execSync} from 'child_process';
dotenv.config();

import {callWithRetry} from './llm.js';
import {getRef} from './lib.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEST_VERSES = process.env.EVAL_VERSES === 'extra' ? [
    {bookId: 1, chapterId: 3, verseId: 15},     // Gen 3:15 protoevangelium
    {bookId: 23, chapterId: 53, verseId: 5},    // Isa 53:5 by his stripes
    {bookId: 19, chapterId: 23, verseId: 1},    // Ps 23:1 the Lord is shepherd (NB: may need to check)
    {bookId: 44, chapterId: 2, verseId: 38},    // Acts 2:38 repent and be baptized
] : [
    {bookId: 1, chapterId: 1, verseId: 1},      // Gen 1:1 (creation)
    {bookId: 40, chapterId: 5, verseId: 3},     // Mt 5:3 (beatitudes)
    {bookId: 40, chapterId: 28, verseId: 19},   // Great commission
    {bookId: 42, chapterId: 19, verseId: 5},    // Sakkeus
    {bookId: 43, chapterId: 3, verseId: 16},    // John 3:16
    {bookId: 43, chapterId: 14, verseId: 6},    // I am the way
];

const JUDGE_SCHEMA = {
    type: 'object',
    properties: {
        score: {type: 'integer'},
        reason: {type: 'string'}
    },
    required: ['score', 'reason'],
    additionalProperties: false
};

function refKey(r) {
    return `${r.bookId}-${r.chapterId}-${r.fromVerseId}-${r.toVerseId}`;
}

function getOsnb2Text(bookId, chapterId, verseId) {
    const file = path.join(__dirname, 'bibles_raw', 'osnb', `${bookId}`, `${chapterId}.json`);
    if (!fs.existsSync(file)) return null;
    const verses = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return verses.find(v => +v.verseId === +verseId)?.text || null;
}

async function runPipelineOnVerse(verse, extraArgs = '') {
    const refFile = path.join(__dirname, 'references', 'nb', `${verse.bookId}`, `${verse.chapterId}`, `${verse.verseId}.json`);
    const beforeContent = fs.existsSync(refFile) ? fs.readFileSync(refFile, 'utf-8') : null;
    const beforeKeys = beforeContent ? new Set(JSON.parse(beforeContent).references.map(refKey)) : new Set();

    const cmd = `node references_semantic.mjs --verify-only --book ${verse.bookId} --chapter ${verse.chapterId} --verse ${verse.verseId} ${extraArgs}`;
    const t0 = Date.now();
    let output = '';
    try {
        output = execSync(cmd, {encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe']});
    } catch (e) {
        output = (e.stdout || '') + (e.stderr || '');
    }
    const elapsed = Date.now() - t0;

    const after = JSON.parse(fs.readFileSync(refFile, 'utf-8'));
    const newRefs = after.references.filter(r => !beforeKeys.has(refKey(r)));

    if (beforeContent !== null) {
        fs.writeFileSync(refFile, beforeContent);
    } else if (fs.existsSync(refFile)) {
        fs.unlinkSync(refFile);
    }

    return {newRefs, elapsed, output};
}

async function judgeRef(sourceVerse, ref) {
    const srcText = getOsnb2Text(sourceVerse.bookId, sourceVerse.chapterId, sourceVerse.verseId);
    const refText = getOsnb2Text(ref.bookId, ref.chapterId, ref.fromVerseId);
    if (!srcText || !refText) return null;

    const prompt = `Vurder om denne foreslåtte bibelske kryssreferansen er en ekte og verdifull referanse for en bibelleser.

KILDEVERS: ${getRef(sourceVerse.bookId, sourceVerse.chapterId, sourceVerse.verseId)}: ${srcText}
KANDIDATVERS: ${getRef(ref.bookId, ref.chapterId, ref.fromVerseId)}: ${refText}
FORESLÅTT BEGRUNNELSE: ${ref.text}

Score 1-5:
- 5: Direkte sitat / samme hendelse / klar oppfyllelse — uomtvistelig referanse
- 4: Sterk teologisk eller tematisk parallell — versene belyser hverandre meningsfullt
- 3: Defensible parallell — svak men reell kobling
- 2: Kun overfladisk likhet (felles ord eller imperativer, men ulikt poeng)
- 1: Ikke relatert; banal eller falsk parallell

Vær streng. En score på 4-5 betyr referansen tilfører reell verdi som ikke er åpenbar fra standard kryssreferanseverk.`;

    try {
        return await callWithRetry(prompt, {schema: JUDGE_SCHEMA, context: `judge ${ref.bookId}:${ref.chapterId}:${ref.fromVerseId}`});
    } catch (e) {
        console.warn(`  judge failed: ${e.message}`);
        return null;
    }
}

async function main() {
    const extraArgs = process.argv.slice(2).join(' ');
    console.log(`Eval over ${TEST_VERSES.length} verses (extra args: "${extraArgs}")`);
    console.log('Judge: Claude (independent of pipeline LLM)\n');

    const results = [];
    for (const v of TEST_VERSES) {
        const label = getRef(v.bookId, v.chapterId, v.verseId);
        process.stdout.write(`${label}: running pipeline... `);
        const {newRefs, elapsed} = await runPipelineOnVerse(v, extraArgs);
        process.stdout.write(`${(elapsed/1000).toFixed(0)}s, ${newRefs.length} new refs\n`);

        const judged = [];
        for (const r of newRefs) {
            const j = await judgeRef(v, r);
            if (j) {
                judged.push({...r, score: j.score, judgeReason: j.reason});
                const label2 = getRef(r.bookId, r.chapterId, r.fromVerseId);
                console.log(`  ${j.score}/5 ${label2.padEnd(20)} — ${r.text.slice(0,70)}`);
            } else {
                judged.push({...r, score: null});
            }
        }
        results.push({verse: v, label, elapsed, newRefs: judged});
    }

    console.log('\n=== SUMMARY ===');
    const totalNew = results.reduce((s, r) => s + r.newRefs.length, 0);
    const allScores = results.flatMap(r => r.newRefs.map(x => x.score).filter(s => s != null));
    const avg = allScores.length ? allScores.reduce((a, b) => a + b, 0) / allScores.length : 0;
    const high = allScores.filter(s => s >= 4).length;
    const totalTime = results.reduce((s, r) => s + r.elapsed, 0);

    console.log(`Verses tested:        ${results.length}`);
    console.log(`Total pipeline time:  ${(totalTime/1000).toFixed(0)}s, avg ${(totalTime/results.length/1000).toFixed(1)}s/verse`);
    console.log(`Total new refs:       ${totalNew}`);
    console.log(`Avg quality (1-5):    ${avg.toFixed(2)}`);
    console.log(`High-quality (≥4):    ${high}/${totalNew} (${(high*100/Math.max(totalNew,1)).toFixed(0)}%)`);

    const keepNet = high;
    const noisePct = totalNew > 0 ? ((totalNew - high) * 100 / totalNew).toFixed(0) : 0;
    console.log(`\nNet value: ${keepNet} good refs added across ${results.length} verses`);
    console.log(`Noise: ${noisePct}% of additions are judged below quality threshold`);

    fs.writeFileSync(path.join(__dirname, 'eval_results.json'), JSON.stringify({
        extraArgs, results,
        summary: {totalNew, avg, high, totalTime, noisePct}
    }, null, 2));
    console.log('\nFull results written to eval_results.json');
}

main().catch(err => { console.error(err); process.exit(1); });
