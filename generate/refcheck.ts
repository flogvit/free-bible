#!/usr/bin/env bun
/**
 * Mechanical reference check between a source text and a rendering of it in another
 * language or spelling: every reference in the source must be in the rendering with the
 * same numbers, and the rendering must not have references the source lacks.
 *
 * Book names, abbreviations and the cue words differ between languages (p. / s., ch. /
 * kap., John iii. 21 / Joh 3,21), so the check compares what can be compared: the
 * numbers, sorted by what they number.
 *
 *   ref      `<ref osisRef="…">` targets — the exact passage, book included
 *   verse    `<sup>n</sup>` verse numbers in a quoted Bible text
 *   section  § numbers                        ← the blind spot of 20.09: an invented
 *   page     p./pp./pag./page → s./side          «Ewald § 287» passed the old check
 *   chapter  ch./chap./c./cap. → kap., Roman numerals read as numbers
 *   pair     chapter:verse / chapter,verse in plain text (Is 34:11 → Jes 34,11)
 *   number   any other number
 *
 * The first five block: a difference is a wrong or invented reference. `pair` and `number`
 * are advisory, because a rendering may legitimately write a chapter reference as a pair
 * («ch. iii. 21» → «kap. 3,21») or spell a number out.
 *
 *   bun generate/refcheck.ts <source.txt> <rendering.txt>     exit 1 on a blocking difference
 */
import fs from 'fs';

export type RefKind = 'ref' | 'verse' | 'section' | 'page' | 'chapter' | 'pair' | 'number';

export interface RefProblem {
    kind: RefKind;
    blocking: boolean;
    missing: string[];        // in the source, not in the rendering
    extra: string[];          // in the rendering, not in the source
}

const KINDS: RefKind[] = ['ref', 'verse', 'section', 'page', 'chapter', 'pair', 'number'];
const BLOCKING: ReadonlySet<RefKind> = new Set(KINDS.slice(0, 5));

const ROMAN: Record<string, number> = {i: 1, v: 5, x: 10, l: 50, c: 100};

/** `xxix` → 29. Anything that is not a Roman numeral comes back unchanged. */
export function romanToArabic(s: string): string {
    const t = s.toLowerCase();
    if (!/^[ivxlc]+$/.test(t)) return s;
    let n = 0;
    for (let i = 0; i < t.length; i++) {
        const v = ROMAN[t[i]], next = ROMAN[t[i + 1]] ?? 0;
        n += v < next ? -v : v;
    }
    return String(n);
}

// Ordered: each pattern removes what it matched, so a page number is not counted again
// as a plain number.
const PATTERNS: [RefKind, RegExp][] = [
    ['section', /(?:§|\$\.)\s*(\d+[a-z]?)(?![a-z])/g],   // «$.277» is how the K&D OCR reads §
    // A cue word starts a word: JavaScript's \b sees æ, ø, å and the apostrophe as word ends, so «løs. 2» and
    // «God's. 2» would read as page 2 (#163: 8 of 16 stuck units).
    // «s.» after a number is shillings («353 l. 11 s. 10 1/2 d.»), not a page (#173: 1 Kings 16).
    ['page', /(?<![\p{L}\p{N}'’])(?:pp?\.|pag\.|page\.?|(?<!\d\s*)s\.|side|sidene)\s*(\d+)/giu],
    // A Roman numeral only after a cue word that takes one: after «kapittel» an «i» is the preposition («et kapittel i
    // Kongebøkene»), and a rendering writes its chapter numbers in Arabic (#173: Ruth 2 and 2 Chronicles 9).
    ['chapter', /(?<![\p{L}\p{N}'’])(?:(?:ch\.|chap\.|c\.|cap\.|kap\.)\s*([ivxlc]+(?![\p{L}\p{N}])|\d+)|kapittel\s*(\d+))/giu],
    ['pair', /(?<!\d)(\d{1,3})\s*[:,]\s*(\d{1,3})(?!\d)/g],
    ['number', /\d+/g],
];

type Counts = Map<RefKind, Map<string, number>>;

function add(counts: Counts, kind: RefKind, key: string) {
    let m = counts.get(kind);
    if (!m) counts.set(kind, m = new Map());
    m.set(key, (m.get(key) ?? 0) + 1);
}

function collect(text: string): Counts {
    const counts: Counts = new Map();
    let t = text.replace(/&#167;/g, '§');
    t = t.replace(/<ref\s+osisRef="([^"]*)"[^>]*>[\s\S]*?<\/ref>/g, (_, ref) => { add(counts, 'ref', ref); return ' '; });
    t = t.replace(/<sup>\s*(\d+)\s*<\/sup>/g, (_, n) => { add(counts, 'verse', n); return ' '; });
    t = t.replace(/<[^>]+>/g, ' ');
    // Era markers, so «b. c. 4004» is a year and not chapter 4004.
    t = t.replace(/\b(?:b\.\s*c\.|a\.\s*d\.|f\.\s*kr\.|e\.\s*kr\.)/gi, ' ');
    // «&c.» is et cetera, so «&c. 2. The blessing» is the next point and not chapter 2 (#163: the other 8 stuck units).
    t = t.replace(/&(?:amp;)?c\./g, ' ');
    for (const [kind, re] of PATTERNS) {
        t = t.replace(re, (m: string, ...groups: unknown[]) => {
            const [a, b] = groups as string[];
            add(counts, kind, kind === 'number' ? m : kind === 'pair' ? `${a}:${b}` : romanToArabic(a ?? b));
            return ' ';
        });
    }
    return counts;
}

function diff(a: Map<string, number> | undefined, b: Map<string, number> | undefined): string[] {
    const out: string[] = [];
    for (const [k, n] of a ?? []) for (let i = (b?.get(k) ?? 0); i < n; i++) out.push(k);
    return out;
}

/** Every kind where source and rendering disagree. Empty when the references match. */
export function referenceProblems(source: string, rendering: string): RefProblem[] {
    const a = collect(source), b = collect(rendering);
    const problems: RefProblem[] = [];
    for (const kind of KINDS) {
        const missing = diff(a.get(kind), b.get(kind));
        const extra = diff(b.get(kind), a.get(kind));
        if (missing.length || extra.length) problems.push({kind, blocking: BLOCKING.has(kind), missing, extra});
    }
    return problems;
}

export function formatProblem(p: RefProblem): string {
    const parts = [];
    if (p.missing.length) parts.push(`missing ${p.missing.join(', ')}`);
    if (p.extra.length) parts.push(`not in source ${p.extra.join(', ')}`);
    return `${p.kind}${p.blocking ? '' : ' (advisory)'}: ${parts.join('; ')}`;
}

if (import.meta.main) {
    const [src, out] = process.argv.slice(2);
    if (!src || !out) {
        console.error('usage: bun generate/refcheck.ts <source> <rendering>');
        process.exit(2);
    }
    const problems = referenceProblems(fs.readFileSync(src, 'utf8'), fs.readFileSync(out, 'utf8'));
    console.log(`${out}: ${problems.length ? '' : 'references match'}`);
    for (const p of problems) console.log('  ' + formatProblem(p));
    process.exit(problems.some(p => p.blocking) ? 1 : 0);
}
