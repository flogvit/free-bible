/**
 * Key-term consistency across a translation.
 *
 * Each chapter is translated in its own API call, so the model has no memory of how a
 * term was rendered in the previous chapter. Within a chapter consistency is good
 * (Psalm 136 renders the same refrain identically 26 times); across chapters it drifts.
 * Measured on osen: the identical Hebrew formula כי לעולם חסדו appears 37 times and is
 * rendered "steadfast love" 30 times and "mercy" 7 times.
 *
 * This script does two jobs:
 *   --audit   report which key terms are rendered inconsistently, and where
 *   --write   emit glossary/<bible>.json with the dominant rendering per term, which
 *             bible.mjs then injects into the translation prompt so later chapters
 *             follow the established choice instead of re-deciding
 *
 * Terms are matched on the source text, so this needs no word alignment: find every
 * verse whose Hebrew/Greek contains the term, then see which candidate rendering the
 * translation used.
 *
 * Usage:
 *   npx tsx glossary.mjs osen --audit
 *   npx tsx glossary.mjs osen --write
 */

import * as fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';

import {bibles, books, getLanguageCode} from './constants.js';

/**
 * Load-bearing terms whose rendering should stay stable across the whole bible.
 * `forms` are matched against the source text with diacritics stripped; `candidates`
 * are the renderings we recognise, longest match wins.
 *
 * Only terms where a single choice really is expected belong here. Words that
 * legitimately shift sense by context (nephesh, logos) are deliberately absent — a
 * glossary entry for those would force a wrong rendering.
 */
export const KEY_TERMS = {
    en: [
        {source: 'chesed', forms: ['חסד'], candidates: ['steadfast love', 'faithful love', 'lovingkindness', 'loyal love', 'unfailing love', 'mercy', 'kindness', 'goodness', 'devotion'], note: 'covenant loyalty; "kindness" is right for person-to-person use in the narratives'},
        {source: 'berit', forms: ['ברית'], candidates: ['covenant', 'treaty', 'pact', 'agreement']},
        {source: 'torah', forms: ['תורה'], candidates: ['law', 'instruction', 'teaching']},
        {source: 'tsedaqah', forms: ['צדקה'], candidates: ['righteousness', 'justice']},
        {source: 'mishpat', forms: ['משפט'], candidates: ['justice', 'judgment', 'ordinance', 'ruling']},
        {source: 'kavod', forms: ['כבוד'], candidates: ['glory', 'honor', 'splendor']},
        {source: 'ruach', forms: ['רוח'], candidates: ['spirit', 'wind', 'breath']},
        {source: 'ekklesia', forms: ['εκκλησια'], candidates: ['church', 'assembly', 'congregation']},
        {source: 'agape', forms: ['αγαπη'], candidates: ['love', 'charity']},
        {source: 'pistis', forms: ['πιστις'], candidates: ['faith', 'faithfulness', 'belief', 'trust']},
        {source: 'dikaiosune', forms: ['δικαιοσυνη'], candidates: ['righteousness', 'justice']},
        {source: 'charis', forms: ['χαρις'], candidates: ['grace', 'favor', 'kindness']}
    ]
};

const HEB_MARKS = /[֑-ׇ‫‬]/g;

function stripSource(text, bookId) {
    if (bookId <= 39) return text.replace(HEB_MARKS, '');
    return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

function readJson(file) {
    if (!fs.existsSync(file)) return null;
    try {
        return JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch {
        return null;
    }
}

function renderingOf(text, candidates) {
    const low = text.toLowerCase();
    const hits = candidates.filter(c => low.includes(c.toLowerCase()));
    // longest match wins: "steadfast love" before the "love" it contains
    return hits.length ? hits.reduce((a, b) => (b.length > a.length ? b : a)) : null;
}

export function collect(bible, terms) {
    const results = terms.map(t => ({...t, byRendering: new Map(), missing: []}));

    for (const book of books) {
        const source = book.id <= 39 ? 'hebrew' : 'sblgnt';
        for (let chapter = 1; chapter <= book.chapters; chapter++) {
            const translated = readJson(`bibles_raw/${bible}/${book.id}/${chapter}.json`);
            const originals = readJson(`bibles_raw/${source}/${book.id}/${chapter}.json`);
            if (!translated || !originals) continue;

            for (const original of originals) {
                const verse = translated.find(v => +v.verseId === +original.verseId);
                if (!verse?.text) continue;
                const bare = stripSource(original.text, book.id);

                for (const term of results) {
                    if (!term.forms.some(f => bare.includes(f))) continue;
                    const ref = {bookId: book.id, chapterId: chapter, verseId: original.verseId};
                    const rendering = renderingOf(verse.text, term.candidates);
                    if (!rendering) {
                        term.missing.push(ref);
                        continue;
                    }
                    if (!term.byRendering.has(rendering)) term.byRendering.set(rendering, []);
                    term.byRendering.get(rendering).push(ref);
                }
            }
        }
    }
    return results;
}

function bookName(id) {
    return (books.find(b => b.id === id) || {}).name || `Book ${id}`;
}

/**
 * Passages the bible contains twice. Where the source text is near-identical, any
 * divergence in the translation is drift by definition — the chapters were translated
 * in separate calls with no knowledge of each other.
 *
 * Where the source genuinely differs the check stays quiet on its own: it scores
 * source similarity and target similarity separately and only reports the gap. Psalm
 * 14 vs 53 is the useful control — the Hebrew really does read YHWH in one and Elohim
 * in the other, so "the LORD" vs "God" is correct and scores as expected.
 */
const PARALLEL_PASSAGES = [
    {name: '2 Samuel 22 / Psalm 18', a: [10, 22], b: [19, 18]},
    {name: 'Psalm 14 / Psalm 53', a: [19, 14], b: [19, 53]},
    {name: 'Psalm 40 / Psalm 70', a: [19, 40], b: [19, 70]},
    {name: 'Psalm 57 / Psalm 108', a: [19, 57], b: [19, 108]},
    {name: 'Psalm 60 / Psalm 108', a: [19, 60], b: [19, 108]},
    {name: 'Psalm 96 / 1 Chronicles 16', a: [19, 96], b: [13, 16]},
    {name: 'Psalm 105 / 1 Chronicles 16', a: [19, 105], b: [13, 16]},
    {name: 'Isaiah 2 / Micah 4', a: [23, 2], b: [33, 4]},
    {name: '2 Kings 18 / Isaiah 36', a: [12, 18], b: [23, 36]},
    {name: '2 Kings 19 / Isaiah 37', a: [12, 19], b: [23, 37]},
    {name: '2 Kings 20 / Isaiah 38', a: [12, 20], b: [23, 38]},
    {name: '2 Kings 25 / Jeremiah 52', a: [12, 25], b: [24, 52]},
    {name: 'Obadiah 1 / Jeremiah 49', a: [31, 1], b: [24, 49]}
];

// Ratcliff/Obershelp, same measure difflib uses — enough to rank similarity.
export function similarity(a, b) {
    if (!a || !b) return 0;
    const matched = (x, y) => {
        if (!x.length || !y.length) return 0;
        let best = 0, bx = 0, by = 0;
        const prev = new Array(y.length + 1).fill(0);
        for (let i = 0; i < x.length; i++) {
            const cur = new Array(y.length + 1).fill(0);
            for (let j = 0; j < y.length; j++) {
                if (x[i] === y[j]) {
                    cur[j + 1] = prev[j] + 1;
                    if (cur[j + 1] > best) { best = cur[j + 1]; bx = i + 1 - best; by = j + 1 - best; }
                }
            }
            prev.splice(0, prev.length, ...cur);
        }
        if (!best) return 0;
        return best + matched(x.slice(0, bx), y.slice(0, by)) + matched(x.slice(bx + best), y.slice(by + best));
    };
    return (2 * matched(a, b)) / (a.length + b.length);
}

function parallels(bible, {minSource = 0.80, minGap = 0.12} = {}) {
    console.log(`${'passage'.padEnd(28)}${'pairs'.padStart(6)}${'drift'.padStart(7)}\n`);
    let totalPairs = 0, totalDrift = 0;

    for (const p of PARALLEL_PASSAGES) {
        const srcA = readJson(`bibles_raw/${p.a[0] <= 39 ? 'hebrew' : 'sblgnt'}/${p.a[0]}/${p.a[1]}.json`);
        const srcB = readJson(`bibles_raw/${p.b[0] <= 39 ? 'hebrew' : 'sblgnt'}/${p.b[0]}/${p.b[1]}.json`);
        const tgtA = readJson(`bibles_raw/${bible}/${p.a[0]}/${p.a[1]}.json`);
        const tgtB = readJson(`bibles_raw/${bible}/${p.b[0]}/${p.b[1]}.json`);
        if (!srcA || !srcB || !tgtA || !tgtB) continue;

        const findings = [];
        let pairs = 0;
        for (const va of srcA) {
            const bareA = stripSource(va.text, p.a[0]);
            let best = null;
            for (const vb of srcB) {
                const s = similarity(bareA, stripSource(vb.text, p.b[0]));
                if (s >= minSource && (!best || s > best.s)) best = {vb, s};
            }
            if (!best) continue;
            pairs++;

            const ta = tgtA.find(v => +v.verseId === +va.verseId)?.text;
            const tb = tgtB.find(v => +v.verseId === +best.vb.verseId)?.text;
            if (!ta || !tb) continue;

            const t = similarity(ta.toLowerCase(), tb.toLowerCase());
            // Only the gap matters: near-identical source, diverging translation.
            if (best.s - t >= minGap) findings.push({va, vb: best.vb, s: best.s, t, ta, tb, gap: best.s - t});
        }

        totalPairs += pairs;
        totalDrift += findings.length;
        console.log(`${p.name.padEnd(28)}${String(pairs).padStart(6)}${String(findings.length).padStart(7)}`);
        for (const f of findings.sort((x, y) => y.gap - x.gap).slice(0, 3)) {
            console.log(`   source ${(f.s * 100).toFixed(0)}% alike, translation ${(f.t * 100).toFixed(0)}%`);
            console.log(`     ${p.a[1]}:${f.va.verseId}  ${f.ta.slice(0, 96)}`);
            console.log(`     ${p.b[1]}:${f.vb.verseId}  ${f.tb.slice(0, 96)}`);
        }
    }
    console.log(`\n${totalDrift} diverging pairs out of ${totalPairs} matched verses`);
}

function audit(results) {
    console.log(`${'term'.padEnd(12)}${'verses'.padStart(7)}  renderings`);
    for (const t of results) {
        const total = [...t.byRendering.values()].reduce((n, v) => n + v.length, 0) + t.missing.length;
        if (!total) continue;
        const sorted = [...t.byRendering.entries()].sort((a, b) => b[1].length - a[1].length);
        const summary = sorted.map(([r, v]) => `${r} ${v.length}`).join(', ');
        const drift = sorted.length > 1;
        console.log(`${(drift ? '! ' : '  ') + t.source.padEnd(10)}${String(total).padStart(7)}  ${summary}${t.missing.length ? `, (other) ${t.missing.length}` : ''}`);

        // the minority renderings are the candidates for review
        if (drift) {
            for (const [rendering, refs] of sorted.slice(1)) {
                if (refs.length > sorted[0][1].length * 0.4) continue;   // a real split, not drift
                const where = refs.slice(0, 6).map(r => `${bookName(r.bookId)} ${r.chapterId}:${r.verseId}`).join(', ');
                console.log(`${''.padEnd(21)}"${rendering}" in ${where}${refs.length > 6 ? ` +${refs.length - 6} more` : ''}`);
            }
        }
    }
}

function write(bible, results) {
    const entries = results
        .map(t => {
            const sorted = [...t.byRendering.entries()].sort((a, b) => b[1].length - a[1].length);
            if (!sorted.length) return null;
            const [rendering, refs] = sorted[0];
            const total = sorted.reduce((n, [, v]) => n + v.length, 0);
            return {
                source: t.source,
                rendering,
                share: +(refs.length / total).toFixed(2),
                occurrences: total,
                note: t.note
            };
        })
        .filter(Boolean);

    const dir = 'glossary';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, {recursive: true});
    const file = `${dir}/${bible}.json`;
    fs.writeFileSync(file, JSON.stringify(entries, null, 2));
    console.log(`Wrote ${file} — ${entries.length} terms`);
    return file;
}

function main() {
    const args = process.argv.slice(2);
    const bible = args.find(a => !a.startsWith('--'));
    if (!bible || !bibles[bible]) {
        console.log(`
Usage: npx tsx glossary.mjs <bible> [--audit|--write]

  --audit   show which key terms drift, and where the minority renderings are
  --write   emit glossary/<bible>.json for bible.mjs to use in the translation prompt

Known bibles: ${Object.keys(bibles).join(', ')}
`);
        process.exit(1);
    }

    const langCode = getLanguageCode(bibles[bible]);
    const terms = KEY_TERMS[langCode];
    if (!terms) {
        console.error(`No key terms defined for ${bibles[bible]} (${langCode}).`);
        process.exit(1);
    }

    if (args.includes('--parallels')) {
        console.log(`${bible} (${bibles[bible]}) — parallel passages\n`);
        parallels(bible);
        return;
    }

    console.log(`${bible} (${bibles[bible]}) — ${terms.length} key terms\n`);
    const results = collect(bible, terms);

    if (args.includes('--write')) write(bible, results);
    else audit(results);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main();
}
