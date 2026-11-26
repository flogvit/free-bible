#!/usr/bin/env bun
/**
 * Old public-domain Bible commentaries rendered into today's language, book by book,
 * through the Message Batches API, and published per book once every part of it has
 * passed the checks. The first work is Matthew Henry's Complete Commentary (`mhc`) into
 * bokmål (#163).
 *
 *   bun generate/commentary.ts --work mhc --language nb             run until done or out of credit
 *   bun generate/commentary.ts --work mhc --language nb --dry-run   what the next batch would hold, and its price
 *   bun generate/commentary.ts --work mhc --language nb --book 65 --limit 3 --once
 *
 * Steps, each one resumable (state is on disk, nothing lives only in the process):
 *
 *   1. source    SWORD module from CrossWire → generate/commentary/<work>/<src>/<book>/<chapter>.json,
 *                sections (a verse range each) of paragraphs in a small HTML subset.
 *   2. translate each section is cut into units of whole paragraphs (≤ UNIT_CHARS) and
 *                rendered paragraph for paragraph — the brief is a free modernisation that
 *                keeps the content, not a word-for-word translation.
 *   3. review    a proofread round per unit: findings carry only the changed passage
 *                (paragraph, exact quote, replacement), plus a check of the argument
 *                structure (premises, conclusions, evidence). Findings are applied, the
 *                replaced reading goes to `versions[]`.
 *   4. gate      a unit is `checked` when a review finds nothing critical or major, keeps the
 *                argument, and the mechanical checks pass (same paragraph count; refcheck.ts:
 *                every reference, verse number, §, page and chapter number as in the source).
 *                After --rounds reviews without that it is `stuck`, and its book waits.
 *   5. publish   a book whose units are all checked is written to
 *                generate/commentary/<work>/<language>/<book>/<chapter>.json, the same shape
 *                as the source with the model(s) that wrote and checked each section.
 *
 * Money: only the key Dux gives the session, DUX_ANTHROPIC_API_KEY — never ANTHROPIC_API_KEY
 * (Claude Code's own) and never generate/.env. When the API says the credit is used up, the
 * run stops with exit code 75; the same command later goes on from where it stopped.
 *
 * Work state, paid for and therefore kept in git: generate/commentary_work/<work>/<language>/
 * (one file per chapter, plus batches.json for batches in flight and cost.jsonl).
 */
import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import {readModule, type SwordEntry} from './sword.js';
import {referenceProblems, formatProblem} from './refcheck.js';
import {anthropicCacheReads, anthropicPrices, commentaryModel} from './constants.js';
import {parseArgs, formatHelp, COMMON_FLAGS, type FlagSpec, type Range} from './cli.js';

const GENERATE = import.meta.dir;
const ROOT = path.dirname(GENERATE);

/**
 * Effort for every request. `high` is what the 20.09 trial ran (Fable 5.1 with no effort
 * set, whose default is high), and that is the quality the owner chose. Lower effort is
 * untested on this text; change it only after measuring it on the trial corpus.
 */
export const EFFORT = 'high' as const;
const MAX_TOKENS = 32000;
/** Source characters per unit. MHC sections run to 76 000 characters (John 3:1–21). */
export const UNIT_CHARS = 12000;
const BATCH_DISCOUNT = 0.5;
const MAX_BATCH_REQUESTS = 5000;
const MAX_BATCH_BYTES = 200 * 1024 * 1024;   // the API's limit is 256 MB
const POLL_MS = 60_000;
const MAX_ATTEMPTS = 3;
export const EXIT_NO_CREDIT = 75;
const NO_CREDIT = `\nKreditten er brukt opp. Det som er betalt for, er lagret. Kjør samme kommando igjen når det er kreditt (den 1.) eller med en annen nøkkel i DUX_ANTHROPIC_API_KEY; den fortsetter der den stoppet.`;

// ---------------------------------------------------------------- works and languages

export interface Work {
    title: string;
    author: string;
    written: string;
    language: string;
    license: string;
    url: string;
    bytes: number;
    driver: 'zCom4';
    dataPath: string;
    /** For the prompts: who wrote it, when, in what language. */
    describe: string;
}

export const WORKS: Record<string, Work> = {
    mhc: {
        title: "Matthew Henry's Complete Commentary on the Whole Bible",
        author: 'Matthew Henry',
        written: '1706–1721',
        language: 'en',
        license: 'Public Domain',
        url: 'https://www.crosswire.org/ftpmirror/pub/sword/packages/rawzip/MHC.zip',
        bytes: 15195123,
        driver: 'zCom4',
        dataPath: 'modules/comments/zcom4/mhc',
        describe: 'Matthew Henrys bibelkommentar (Complete Commentary on the Whole Bible, engelsk, 1706–1721)',
    },
};

const LANGUAGES: Record<string, string> = {nb: 'dagens norske bokmål'};

// ---------------------------------------------------------------- OSIS → paragraphs

/**
 * One SWORD entry in OSIS → paragraphs in the subset the prompts and the pages use:
 * <h> (heading), <i>, <b>, <sup> (verse number), <br>, <note>, <ref osisRef="…">.
 * Everything else is structure (paragraph and line milestones) or dropped.
 */
export function osisToParagraphs(osis: string): string[] {
    const BREAK = '\n\n';
    const hiStack: string[] = [];
    let out = '';
    const text = osis.replace(/&amp;#(\d+);/g, '&#$1;').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
        .replace(/&quot;/g, '"').replace(/&apos;/g, "'");
    for (const m of text.matchAll(/<(\/?)(\w+)([^>]*?)(\/?)>|[^<]+/g)) {
        if (!m[2]) { out += m[0]; continue; }
        const [, close, tag, attrs, selfClose] = m;
        const type = /\btype="([^"]*)"/.exec(attrs)?.[1];
        switch (tag) {
            case 'title': out += close ? '</h>' + BREAK : BREAK + '<h>'; break;
            case 'div': if (type === 'x-p') out += BREAK; break;
            case 'lg': out += BREAK; break;
            case 'l': if (/\beID=/.test(attrs) || (close && !selfClose)) out += '<br>'; break;
            case 'reference': {
                const ref = /\bosisRef="([^"]*)"/.exec(attrs)?.[1];
                out += close ? '</ref>' : `<ref osisRef="${ref}">`;
                break;
            }
            case 'note': out += close ? '</note>' : '<note>'; break;
            case 'hi': {
                if (close) { const t = hiStack.pop(); if (t) out += `</${t}>`; break; }
                const t = type === 'italic' ? 'i' : type === 'bold' ? 'b' : type === 'super' ? 'sup' : '';
                if (!selfClose) hiStack.push(t);
                if (t) out += `<${t}>`;
                break;
            }
            default: break;   // chapter, milestone, book div: structure only
        }
    }
    return out.split(/\n{2,}/)
        .map(p => p.replace(/\s+/g, ' ').replace(/(\s*<br>\s*)+$/, '').replace(/^(\s*<br>\s*)+/, '').trim())
        .filter(p => p.replace(/<[^>]+>/g, '').trim().length > 0);
}

// ---------------------------------------------------------------- data shapes

export interface Section {
    from: number;             // 0 = chapter (or, in chapter 0, book) introduction
    to: number;
    paragraphs: string[];
    models?: string[];        // rendered files only: who wrote and checked it
}

export interface ChapterFile {
    work: string;
    language: string;
    source?: string;          // rendered files only: the language it was rendered from
    book: number;
    chapter: number;          // 0 = book introduction
    sections: Section[];
}

export interface Finding {
    paragraph: number;        // 1-based
    quote: string;
    replacement: string;
    type: string;
    severity: 'critical' | 'major' | 'minor';
    explanation: string;
}

export interface Review {
    issues: Finding[];
    argument: {premises: boolean; conclusions: boolean; evidence: boolean; problems: string};
    score: number;
    summary: string;
}

export type Status = 'new' | 'draft' | 'checked' | 'stuck';

export interface Unit {
    id: string;               // book-chapter-section-part
    section: number;
    start: number;            // paragraph range in the section, [start, end)
    end: number;
    status: Status;
    text?: string[];
    translator?: string;      // the model that wrote the first rendering
    model?: string;           // the model that last wrote or checked it
    rounds: number;          // reviews since the text was last translated or re-opened
    attempts: number;         // failed requests in a row
    versions: {text: string[]; explanation: string; model: string}[];
    reviews: (Review & {model: string; mechanical: string[]; skipped: string[]})[];
    note?: string;            // why it is stuck
}

interface ChapterState { book: number; chapter: number; units: Unit[] }

interface Pending {
    id: string;
    kind: Kind;
    model: string;
    units: string[];
    chars: number;            // input characters, for the measured price in --dry-run
    reserved: number;         // dollars held against the budget until the batch is collected
    created: string;
}
type Kind = 'translate' | 'review';

// ---------------------------------------------------------------- units

/** Paragraph ranges of at most `max` characters; a paragraph is never split. */
export function splitParagraphs(paragraphs: string[], max = UNIT_CHARS): [number, number][] {
    const ranges: [number, number][] = [];
    let start = 0, size = 0;
    paragraphs.forEach((p, i) => {
        if (i > start && size + p.length > max) { ranges.push([start, i]); start = i; size = 0; }
        size += p.length;
    });
    if (paragraphs.length) ranges.push([start, paragraphs.length]);
    return ranges;
}

export function unitsFor(file: ChapterFile): Unit[] {
    return file.sections.flatMap((s, si) => splitParagraphs(s.paragraphs).map(([start, end], part) => ({
        id: `${file.book}-${file.chapter}-${si}-${part}`,
        section: si, start, end, status: 'new' as Status, rounds: 0, attempts: 0, versions: [], reviews: [],
    })));
}

export function sourceOf(file: ChapterFile, u: Unit): string[] {
    return file.sections[u.section].paragraphs.slice(u.start, u.end);
}

// ---------------------------------------------------------------- checks and the gate

/** Same paragraph count, and per paragraph every blocking reference difference. */
export function mechanicalProblems(source: string[], text: string[]): string[] {
    if (source.length !== text.length) return [`${text.length} paragraphs, the source has ${source.length}`];
    return source.flatMap((s, i) => referenceProblems(s, text[i])
        .filter(p => p.blocking).map(p => `paragraph ${i + 1}: ${formatProblem(p)}`));
}

/**
 * Apply findings that carry only the changed passage. A quote must occur exactly once in
 * its paragraph; otherwise the finding is skipped and reported, never guessed at.
 */
export function applyFindings(text: string[], findings: Finding[]): {text: string[]; skipped: string[]} {
    const out = [...text];
    const skipped: string[] = [];
    for (const f of findings) {
        const i = f.paragraph - 1;
        const p = out[i];
        if (p === undefined) { skipped.push(`[${f.severity}] no paragraph ${f.paragraph}: «${f.quote}»`); continue; }
        const at = f.quote ? p.indexOf(f.quote) : -1;
        if (at < 0 || p.indexOf(f.quote, at + 1) >= 0) {
            skipped.push(`[${f.severity}] paragraph ${f.paragraph}: quote ${at < 0 ? 'not found' : 'not unique'}: «${f.quote}»`);
            continue;
        }
        out[i] = p.slice(0, at) + f.replacement + p.slice(at + f.quote.length);
    }
    return {text: out, skipped};
}

const BLOCKS = (f: Finding) => f.severity !== 'minor';

/** The unit after one review: findings applied, then checked, another round, or stuck. */
export function afterReview(u: Unit, source: string[], review: Review, model: string, maxRounds: number): Unit {
    const {text, skipped} = applyFindings(u.text!, review.issues);
    const mechanical = mechanicalProblems(source, text);
    const changed = text.some((p, i) => p !== u.text![i]);
    const a = review.argument;
    const clean = !review.issues.some(BLOCKS) && a.premises && a.conclusions && a.evidence && mechanical.length === 0;
    const rounds = u.rounds + 1;
    return {
        ...u,
        text,
        model,
        rounds,
        attempts: 0,
        versions: changed
            ? [...u.versions, {text: u.text!, explanation: review.issues.map(i => i.explanation).join(' | '), model: u.model ?? model}]
            : u.versions,
        reviews: [...u.reviews, {...review, model, mechanical, skipped}],
        status: clean ? 'checked' : rounds >= maxRounds ? 'stuck' : 'draft',
        note: clean ? undefined : rounds >= maxRounds ? `not clean after ${rounds} reviews` : undefined,
    };
}

/** The unit after a translation. A wrong paragraph count is a failed attempt, not a draft. */
export function afterTranslation(u: Unit, source: string[], paragraphs: string[], model: string): Unit {
    if (paragraphs.length !== source.length) {
        return failed(u, `translation had ${paragraphs.length} paragraphs, the source ${source.length}`);
    }
    return {...u, text: paragraphs, translator: model, model, status: 'draft', rounds: 0, attempts: 0, note: undefined};
}

export function failed(u: Unit, why: string): Unit {
    const attempts = u.attempts + 1;
    return {...u, attempts, status: attempts >= MAX_ATTEMPTS ? 'stuck' : u.status, note: why};
}

// ---------------------------------------------------------------- prompts

const BRIEF = (w: Work, lang: string) => `Oppdraget er en modernisering til ${LANGUAGES[lang]} som beholder det reelle innholdet, ikke en ord-for-ord-oversettelse. Skriv fritt og naturlig, slik en norsk forfatter ville skrevet det i dag: del lange setninger, bytt rekkefølge og ordvalg der det leser bedre. Men hvert resonnement skal være med — hver påstand, hvert premiss, hver konklusjon, hvert belegg, hvert sitat og hver henvisning. Ingenting legges til, ingenting tas bort, ingenting forklares eller mildnes. ${w.author}s syn og tone beholdes, også der de er datert.

Formatet:
- Avsnitt for avsnitt: like mange avsnitt som kilden, i samme rekkefølge.
- Merkingen beholdes der den står: <h>overskrift</h>, <i>…</i>, <b>…</b>, <sup>versnummer</sup>, <br>, <note>…</note>.
- <ref osisRef="…">…</ref>: osisRef står nøyaktig som i kilden. Teksten inni skrives som norsk henvisning (John iii. 21 → Joh 3,21; Eccles. 12. 13 → Fork 12,13; v. 14, 15 → v. 14–15).
- Bibelteksten som innleder et avsnitt (King James-sitatet med <sup>versnumre</sup>) gjengis på norsk nær King James-ordlyden, fordi kommentaren drøfter nettopp de ordene.
- Henvisninger til andre verk beholder alle tall og bokstaver (§ 3, p. 329 → s. 329, cap. 18 → kap. 18, l. 4 → bok 4). Ingen henvisning legges til.
- Latinske, greske og hebraiske ord og sitater står som i kilden.`;

const numbered = (ps: string[]) => ps.map((p, i) => `[${i + 1}] ${p}`).join('\n\n');

function where(file: ChapterFile, u: Unit): string {
    const s = file.sections[u.section];
    const verses = file.chapter === 0 ? 'innledningen til boka'
        : s.from === 0 ? `innledningen til kapittel ${file.chapter}`
        : `kapittel ${file.chapter}, vers ${s.from}${s.to > s.from ? `–${s.to}` : ''}`;
    const parts = file.sections[u.section].paragraphs.length > u.end - u.start ? `, avsnitt ${u.start + 1}–${u.end} av ${s.paragraphs.length}` : '';
    return `bok ${file.book} (osis-rekkefølge), ${verses}${parts}`;
}

/**
 * Each prompt in two parts: what is the same for every request of its kind (the brief and the instructions), sent as
 * the system prompt and cached, and what is this unit's (where it is from, the source, the rendering). Cache reads cost
 * a fortieth of input on Fable 5.2, and a batch's requests share the cached part (#163: «implementer alt du kan for å
 * få det billigere»).
 */
export interface Prompt { fixed: string; unit: string }

export function translatePrompt(w: Work, lang: string, file: ChapterFile, u: Unit): Prompt {
    return {
        fixed: `Du gjengir ${w.describe} på ${LANGUAGES[lang]}.

${BRIEF(w, lang)}

Svar med «paragraphs»: én streng per avsnitt i kilden.`,
        unit: `Teksten er fra ${where(file, u)}.

KILDE (${sourceOf(file, u).length} avsnitt):
${numbered(sourceOf(file, u))}`,
    };
}

export function reviewPrompt(w: Work, lang: string, file: ChapterFile, u: Unit): Prompt {
    const source = sourceOf(file, u);
    const mechanical = mechanicalProblems(source, u.text!);
    const advisory = source.flatMap((s, i) => referenceProblems(s, u.text![i] ?? '')
        .filter(p => !p.blocking).map(p => `avsnitt ${i + 1}: ${formatProblem(p)}`));
    const found = [...mechanical, ...advisory];
    return {
        fixed: `Du er korrekturleser for en gjengivelse av ${w.describe} på ${LANGUAGES[lang]}.

${BRIEF(w, lang)}

Gå gjennom gjengivelsen mot kilden, avsnitt for avsnitt.

1. Argumentasjonen. Finn hvert resonnement i kilden — premissene, konklusjonene og beleggene (skriftsteder, sitater, autoriteter) — og kontroller at hvert står i gjengivelsen med samme innhold og samme vekt. Svar i «argument» om premissene, konklusjonene og beleggene er bevart, og skriv i «problems» hva som mangler, er endret eller er lagt til (tom streng hvis ingenting).
2. Feil: meningsfeil, innhold som mangler eller er lagt til, feil henvisning eller tall, merking som er borte, grammatikk og unorsk språk.

Hvert funn bærer bare stedet som endres:
- «paragraph»: avsnittsnummeret i gjengivelsen
- «quote»: den nøyaktige teksten i gjengivelsen som skal byttes ut, tegn for tegn med merking, akkurat lang nok til å være entydig i avsnittet
- «replacement»: det som skal stå i stedet
Send aldri hele avsnitt. Fri, naturlig norsk er en del av oppdraget og er ikke en feil — rapporter ikke smak.
Alvorlighet: critical = meningen er feil, eller innhold mangler eller er lagt til; major = en henvisning, et tall, et belegg eller en nyanse som argumentet hviler på, er feil; minor = språk og stil som er galt, ikke bare annerledes.
Er gjengivelsen god, er «issues» tom. «score» 0–10, der 10 er trofast og godt språk uten noe igjen.`,
        unit: `Teksten er fra ${where(file, u)}.
${found.length ? `\nMekanisk sjekk av henvisningene (tall som ikke stemmer med kilden — vurder hver og rett det som er feil):\n${found.map(f => '- ' + f).join('\n')}\n` : ''}
KILDE (${source.length} avsnitt):
${numbered(source)}

GJENGIVELSE (${u.text!.length} avsnitt):
${numbered(u.text!)}`,
    };
}

const TRANSLATE_SCHEMA = {
    type: 'object',
    properties: {paragraphs: {type: 'array', items: {type: 'string'}}},
    required: ['paragraphs'],
    additionalProperties: false,
};

const REVIEW_SCHEMA = {
    type: 'object',
    properties: {
        argument: {
            type: 'object',
            properties: {
                premises: {type: 'boolean'},
                conclusions: {type: 'boolean'},
                evidence: {type: 'boolean'},
                problems: {type: 'string'},
            },
            required: ['premises', 'conclusions', 'evidence', 'problems'],
            additionalProperties: false,
        },
        issues: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    paragraph: {type: 'integer'},
                    quote: {type: 'string'},
                    replacement: {type: 'string'},
                    type: {type: 'string', enum: ['meaning', 'omission', 'addition', 'reference', 'markup', 'grammar', 'language']},
                    severity: {type: 'string', enum: ['critical', 'major', 'minor']},
                    explanation: {type: 'string'},
                },
                required: ['paragraph', 'quote', 'replacement', 'type', 'severity', 'explanation'],
                additionalProperties: false,
            },
        },
        summary: {type: 'string'},
        score: {type: 'integer'},
    },
    required: ['argument', 'issues', 'summary', 'score'],
    additionalProperties: false,
};

// ---------------------------------------------------------------- credit

/** «Your credit balance is too low» — from a thrown API error or an errored batch result. */
export function isCreditExhausted(e: unknown): boolean {
    const err = e as {type?: string; message?: string; error?: {type?: string; message?: string; error?: {type?: string; message?: string}}};
    const inner = err?.error?.error ?? err?.error ?? err;
    return inner?.type === 'billing_error' || /credit balance is too low/i.test(`${inner?.message ?? ''} ${err?.message ?? ''}`);
}

// ---------------------------------------------------------------- files

const readJson = <T>(p: string): T => JSON.parse(fs.readFileSync(p, 'utf8'));

function writeJson(p: string, data: unknown) {
    fs.mkdirSync(path.dirname(p), {recursive: true});
    const tmp = `${p}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 1) + '\n');
    fs.renameSync(tmp, p);
}

export const paths = (work: string, lang: string) => {
    const w = WORKS[work];
    return {
        meta: path.join(GENERATE, 'commentary', work, 'meta.json'),
        source: (b: number, c?: number) => path.join(GENERATE, 'commentary', work, w.language, ...(c === undefined ? [`${b}`] : [`${b}`, `${c}.json`])),
        sourceRoot: path.join(GENERATE, 'commentary', work, w.language),
        out: (b: number, c: number) => path.join(GENERATE, 'commentary', work, lang, `${b}`, `${c}.json`),
        outIndex: path.join(GENERATE, 'commentary', work, lang, 'index.json'),
        state: (b: number, c: number) => path.join(GENERATE, 'commentary_work', work, lang, `${b}`, `${c}.json`),
        batches: path.join(GENERATE, 'commentary_work', work, lang, 'batches.json'),
        cost: path.join(GENERATE, 'commentary_work', work, lang, 'cost.jsonl'),
        download: path.join(ROOT, 'external', 'commentaries', work),
    };
};

/** Sections per chapter, from the module's entries in canonical order. */
export function chaptersFromEntries(work: string, language: string, entries: SwordEntry[]): ChapterFile[] {
    const files = new Map<string, ChapterFile>();
    for (const e of entries) {
        const paragraphs = osisToParagraphs(e.text);
        if (!paragraphs.length) continue;
        const key = `${e.book}:${e.chapter}`;
        let f = files.get(key);
        if (!f) files.set(key, f = {work, language, book: e.book, chapter: e.chapter, sections: []});
        f.sections.push({from: e.from, to: e.to, paragraphs});
    }
    return [...files.values()];
}

function ensureSource(work: string, lang: string) {
    const p = paths(work, lang);
    if (fs.existsSync(p.meta)) return;
    const w = WORKS[work];
    fs.mkdirSync(p.download, {recursive: true});
    const zip = path.join(p.download, path.basename(w.url));
    if (!fs.existsSync(zip) || fs.statSync(zip).size !== w.bytes) {
        console.log(`laster ned ${w.url}`);
        const r = Bun.spawnSync(['curl', '-sSfL', '-o', zip, w.url], {stdout: 'inherit', stderr: 'inherit'});
        if (r.exitCode !== 0) throw new Error(`download of ${w.url} failed`);
    }
    if (fs.statSync(zip).size !== w.bytes) throw new Error(`${zip}: ${fs.statSync(zip).size} bytes, expected ${w.bytes} — not the module the trial read`);
    const r = Bun.spawnSync(['unzip', '-o', '-q', zip, '-d', p.download], {stdout: 'inherit', stderr: 'inherit'});
    if (r.exitCode !== 0) throw new Error(`unzip ${zip} failed`);
    const files = chaptersFromEntries(work, w.language, readModule(path.join(p.download, w.dataPath), w.driver));
    for (const f of files) writeJson(p.source(f.book, f.chapter), f);
    const {describe: _d, dataPath: _p, driver: _r, ...meta} = w;
    writeJson(p.meta, {id: work, ...meta, chapters: files.length});
    console.log(`kilde: ${files.length} kapitler skrevet til ${p.sourceRoot}`);
}

// ---------------------------------------------------------------- state

class Store {
    readonly sources = new Map<string, ChapterFile>();
    readonly states = new Map<string, ChapterState>();
    pending: Pending[];
    constructor(readonly work: string, readonly lang: string, books: number[]) {
        const p = paths(work, lang);
        for (const b of books) {
            const dir = p.source(b);
            if (!fs.existsSync(dir)) continue;
            const chapters = fs.readdirSync(dir).map(f => parseInt(f)).filter(n => !isNaN(n)).sort((x, y) => x - y);
            for (const c of chapters) {
                const src = readJson<ChapterFile>(p.source(b, c));
                this.sources.set(`${b}-${c}`, src);
                const sp = p.state(b, c);
                this.states.set(`${b}-${c}`, fs.existsSync(sp) ? readJson<ChapterState>(sp) : {book: b, chapter: c, units: unitsFor(src)});
            }
        }
        this.pending = fs.existsSync(p.batches) ? readJson<Pending[]>(p.batches) : [];
    }
    unit(id: string): {state: ChapterState; source: ChapterFile; unit: Unit; index: number} | undefined {
        const [b, c] = id.split('-');
        const state = this.states.get(`${b}-${c}`);
        const source = this.sources.get(`${b}-${c}`);
        const index = state?.units.findIndex(u => u.id === id) ?? -1;
        if (!state || !source || index < 0) return undefined;
        return {state, source, unit: state.units[index], index};
    }
    put(id: string, u: Unit) {
        const r = this.unit(id)!;
        r.state.units[r.index] = u;
        this.dirty.add(`${r.state.book}-${r.state.chapter}`);
    }
    private dirty = new Set<string>();
    save() {
        const p = paths(this.work, this.lang);
        for (const k of this.dirty) {
            const s = this.states.get(k)!;
            writeJson(p.state(s.book, s.chapter), s);
        }
        this.dirty.clear();
        writeJson(p.batches, this.pending);
    }
    allUnits(): Unit[] { return [...this.states.values()].flatMap(s => s.units); }
    bookUnits(book: number): Unit[] { return [...this.states.values()].filter(s => s.book === book).flatMap(s => s.units); }
    /** The units of the book's first chapter that is not done (every unit checked or stuck): chapter by chapter, the
     *  next one only when this one is done (#163). */
    chapterUnits(book: number): Unit[] {
        return [...this.states.values()].filter(s => s.book === book && s.units.some(u => u.status !== 'checked' && u.status !== 'stuck'))
            .sort((a, b) => a.chapter - b.chapter)[0]?.units ?? [];
    }
}

// ---------------------------------------------------------------- batches

const customId = (kind: Kind, unitId: string) => `${kind[0]}_${unitId}`;

function requestFor(store: Store, kind: Kind, unitId: string, model: string): Anthropic.Messages.Batches.BatchCreateParams.Request {
    const {source, unit} = store.unit(unitId)!;
    const w = WORKS[store.work];
    const prompt = kind === 'translate' ? translatePrompt(w, store.lang, source, unit) : reviewPrompt(w, store.lang, source, unit);
    return {
        custom_id: customId(kind, unitId),
        params: {
            model,
            max_tokens: MAX_TOKENS,
            output_config: {
                effort: EFFORT,
                format: {type: 'json_schema', schema: kind === 'translate' ? TRANSLATE_SCHEMA : REVIEW_SCHEMA},
            },
            // The fixed part is cached for an hour: a batch can take longer than the five-minute default to work through.
            system: [{type: 'text', text: prompt.fixed, cache_control: {type: 'ephemeral', ttl: '1h'}}],
            messages: [{role: 'user', content: prompt.unit}],
        },
    };
}

/** The next step for every unit in the window that has one and is not already in flight. */
export function nextRequests(units: Unit[], inFlight: Set<string>): {kind: Kind; id: string}[] {
    return units.filter(u => !inFlight.has(u.id)).flatMap(u =>
        u.status === 'new' ? [{kind: 'translate' as Kind, id: u.id}]
            : u.status === 'draft' ? [{kind: 'review' as Kind, id: u.id}]
                : []);
}

export function costOf(model: string, usage: Anthropic.Usage): number {
    const price = anthropicPrices[model];
    if (!price) return NaN;
    // The fixed part of each prompt is cached (an hour): written at 2x input, read at the model's cache-read price.
    const written = usage.cache_creation
        ? (usage.cache_creation.ephemeral_5m_input_tokens ?? 0) * 1.25 + (usage.cache_creation.ephemeral_1h_input_tokens ?? 0) * 2
        : (usage.cache_creation_input_tokens ?? 0) * 2;
    const read = (usage.cache_read_input_tokens ?? 0) * (anthropicCacheReads[model] ?? price[0] / 10);
    return BATCH_DISCOUNT * (usage.input_tokens * price[0] + written * price[0] + read + usage.output_tokens * price[1]) / 1e6;
}

async function harvest(client: Anthropic, store: Store, pending: Pending, maxRounds: number): Promise<{credit: boolean}> {
    let credit = false;
    let input = 0, output = 0, usd = 0, ok = 0, errors = 0;
    for await (const r of await client.messages.batches.results(pending.id)) {
        const id = r.custom_id.slice(2);
        const found = store.unit(id);
        if (!found) continue;
        const {unit, source} = found;
        const src = sourceOf(source, unit);
        const res = r.result;
        if (res.type !== 'succeeded') {
            errors++;
            if (res.type === 'errored' && isCreditExhausted(res.error)) { credit = true; continue; }
            if (res.type === 'errored' && res.error.error.type === 'invalid_request_error') {
                store.put(id, failed(unit, `invalid request: ${res.error.error.message}`));
            }
            continue;   // expired, canceled, server error: the unit is asked again next time
        }
        const msg = res.message;
        input += msg.usage.input_tokens; output += msg.usage.output_tokens; usd += costOf(pending.model, msg.usage);
        if (msg.stop_reason !== 'end_turn') {
            errors++;
            store.put(id, failed(unit, `stop_reason ${msg.stop_reason}${msg.stop_details ? ` (${msg.stop_details.category})` : ''}`));
            continue;
        }
        const block = msg.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
        let data: any;
        try { data = JSON.parse(block?.text ?? ''); } catch {
            errors++;
            store.put(id, failed(unit, 'answer was not JSON'));
            continue;
        }
        ok++;
        store.put(id, pending.kind === 'translate'
            ? afterTranslation(unit, src, data.paragraphs, pending.model)
            : afterReview(unit, src, data as Review, pending.model, maxRounds));
    }
    fs.appendFileSync(paths(store.work, store.lang).cost,
        JSON.stringify({batch: pending.id, kind: pending.kind, model: pending.model, requests: pending.units.length, chars: pending.chars, ok, errors, input, output, usd: +usd.toFixed(4), ended: new Date().toISOString()}) + '\n');
    console.log(`  ${pending.kind} ${pending.id}: ${ok} ok, ${errors} feil, ${input} inn / ${output} ut, $${usd.toFixed(2)}`);
    return {credit};
}

/**
 * What one request can cost at most: its input (≥ 1 token per 3 characters) and the
 * largest answer it is allowed, at batch price. The budget holds this until the batch is
 * collected and its real cost is known — no request is sent that could pass the budget.
 */
export function worstCase(model: string, r: Anthropic.Messages.Batches.BatchCreateParams.Request): number {
    const price = anthropicPrices[model];
    if (!price) throw new Error(`no price for ${model} in constants.ts → anthropicPrices; the budget cannot be kept without it`);
    // The cached part counted at full input price: the most it can cost.
    const input = JSON.stringify([r.params.system, r.params.messages]).length / 3;
    return BATCH_DISCOUNT * (input * price[0] + r.params.max_tokens * price[1]) / 1e6;
}

/** Dollars collected batches cost this calendar month (UTC), from cost.jsonl. */
export function spentThisMonth(work: string, lang: string, now = new Date()): number {
    const p = paths(work, lang).cost;
    if (!fs.existsSync(p)) return 0;
    const month = now.toISOString().slice(0, 7);
    return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
        .filter((r: {ended: string}) => r.ended.startsWith(month))
        .reduce((a: number, r: {usd: number}) => a + r.usd, 0);
}

/**
 * The price of a batch, from what earlier batches of the same kind and model actually cost
 * per input character (cost.jsonl), so thinking and output length are measured, not guessed.
 */
function estimate(work: string, lang: string, kind: Kind, model: string, chars: number): string {
    const p = paths(work, lang).cost;
    const past = (fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : [])
        .filter((r: {kind: string; model: string; chars?: number}) => r.kind === kind && r.model === model && r.chars);
    if (!past.length) return 'ingen målt pris ennå for denne typen og modellen (kjør et utvalg med --limit først)';
    const usd = past.reduce((a: number, r: {usd: number}) => a + r.usd, 0);
    const measured = past.reduce((a: number, r: {chars: number}) => a + r.chars, 0);
    return `$${(chars * usd / measured).toFixed(2)}, målt på ${past.length} tidligere batcher`;
}

function chunk<T>(items: T[], size: (t: T) => number): T[][] {
    const out: T[][] = [];
    let cur: T[] = [], bytes = 0;
    for (const it of items) {
        const s = size(it);
        if (cur.length && (cur.length >= MAX_BATCH_REQUESTS || bytes + s > MAX_BATCH_BYTES)) { out.push(cur); cur = []; bytes = 0; }
        cur.push(it); bytes += s;
    }
    if (cur.length) out.push(cur);
    return out;
}

// ---------------------------------------------------------------- publishing

/**
 * Write a book's rendered chapters once every unit in it is checked — only the files whose
 * content changed, so a later pass republishes exactly what it changed. True if anything
 * was written.
 */
export function publishBook(store: Store, book: number): boolean {
    const states = [...store.states.values()].filter(s => s.book === book);
    if (!states.length || states.some(s => s.units.some(u => u.status !== 'checked'))) return false;
    const p = paths(store.work, store.lang);
    const models = new Set<string>();
    let changed = false;
    for (const state of states) {
        const src = store.sources.get(`${state.book}-${state.chapter}`)!;
        const sections: Section[] = src.sections.map((s, si) => {
            const us = state.units.filter(u => u.section === si).sort((a, b) => a.start - b.start);
            const sm = [...new Set(us.flatMap(u => [u.translator!, u.model!]))];
            sm.forEach(m => models.add(m));
            return {from: s.from, to: s.to, paragraphs: us.flatMap(u => u.text!), models: sm};
        });
        const file: ChapterFile = {work: store.work, language: store.lang, source: src.language, book: state.book, chapter: state.chapter, sections};
        const out = p.out(state.book, state.chapter);
        if (fs.existsSync(out) && JSON.stringify(readJson(out)) === JSON.stringify(file)) continue;
        writeJson(out, file);
        changed = true;
    }
    if (!changed) return false;
    const books = fs.existsSync(p.outIndex) ? readJson<{books: Record<string, unknown>}>(p.outIndex).books : {};
    books[book] = {published: new Date().toISOString().slice(0, 10), models: [...models]};
    writeJson(p.outIndex, {work: store.work, language: store.lang, source: WORKS[store.work].language, books});
    return true;
}

// ---------------------------------------------------------------- run

const SPEC: Record<string, FlagSpec> = {
    work: {kind: 'string', default: 'mhc', help: `which commentary: ${Object.keys(WORKS).join(', ')}`},
    language: {...COMMON_FLAGS.language, help: `target language: ${Object.keys(LANGUAGES).join(', ')}`},
    book: COMMON_FLAGS.book,
    model: {kind: 'string', default: commentaryModel, help: 'model for new requests (constants.ts → commentaryModel)'},
    books: {kind: 'number', default: 1, help: 'work on this many unfinished books at a time, in canonical order: book by book, each published when done (#163)'},
    rounds: {kind: 'number', default: 3, help: 'reviews before a unit that is still not clean is stuck'},
    limit: {...COMMON_FLAGS.limit, help: 'at most N requests per batch (a sample run)'},
    once: {kind: 'boolean', help: 'one pass: collect finished batches, send the next, then exit without waiting'},
    'dry-run': {kind: 'boolean', help: 'show what the next batch would hold and roughly cost, send nothing'},
    again: {kind: 'boolean', help: 'a later pass: checked units written by another model are reviewed again by --model'},
    'retry-stuck': {kind: 'boolean', help: 'give stuck units new attempts and rounds'},
    budget: {kind: 'float', default: 200, help: 'dollars this job may spend on the key per calendar month: all of the $200 credit, which does not carry over (flogvit/dux-machina#879)'},
    help: COMMON_FLAGS.help,
};

function report(store: Store, books: number[]) {
    for (const b of books) {
        const us = store.bookUnits(b);
        if (!us.length) continue;
        const n = (s: Status) => us.filter(u => u.status === s).length;
        console.log(`  bok ${b}: ${n('checked')}/${us.length} godkjent, ${n('draft')} til korrektur, ${n('new')} uoversatt, ${n('stuck')} fast`);
    }
}

async function main() {
    const {flags} = parseArgs(process.argv.slice(2), SPEC);
    if (flags.help) {
        console.log(formatHelp('generate/commentary.ts', 'Render an old commentary into today\'s language through the Batches API, check it, publish it per book.', SPEC));
        return 0;
    }
    const work = flags.work as string, lang = flags.language as string, model = flags.model as string;
    if (!WORKS[work]) throw new Error(`unknown --work ${work}`);
    if (!LANGUAGES[lang]) throw new Error(`unknown --language ${lang}`);
    const maxRounds = flags.rounds as number;
    const range = flags.book as Range | undefined;
    const allBooks = Array.from({length: 66}, (_, i) => i + 1).filter(b => !range || (b >= range.start && b <= range.end));

    ensureSource(work, lang);
    const store = new Store(work, lang, allBooks);

    if (flags.again || flags['retry-stuck']) {
        for (const u of store.allUnits()) {
            if ((flags.again && u.status === 'checked' && u.model !== model) || (flags['retry-stuck'] && u.status === 'stuck')) {
                store.put(u.id, {...u, status: u.text ? 'draft' : 'new', rounds: 0, attempts: 0, note: undefined});
            }
        }
        store.save();
    }

    const key = process.env.DUX_ANTHROPIC_API_KEY;
    if (!key && !flags['dry-run']) {
        console.error('DUX_ANTHROPIC_API_KEY mangler. Jobben bruker bare nøkkelen Dux gir økta (aldri ANTHROPIC_API_KEY eller generate/.env).');
        return 2;
    }
    // A key not scoped to a workspace must name one on every request.
    const workspace = process.env.DUX_ANTHROPIC_WORKSPACE_ID;
    const client = new Anthropic({
        apiKey: key ?? 'dry-run', authToken: null,
        defaultHeaders: workspace ? {'anthropic-workspace-id': workspace} : undefined,
    });

    while (true) {
        // 1. collect what has ended
        let credit = false;
        for (const pend of key ? [...store.pending] : []) {
            let batch;
            try { batch = await client.messages.batches.retrieve(pend.id); } catch (e) {
                if (e instanceof Anthropic.NotFoundError) {
                    console.log(`  batch ${pend.id} finnes ikke for denne nøkkelen — enhetene sendes på nytt`);
                    store.pending = store.pending.filter(x => x !== pend);
                    continue;
                }
                throw e;
            }
            if (batch.processing_status !== 'ended') continue;
            credit = (await harvest(client, store, pend, maxRounds)).credit || credit;
            store.pending = store.pending.filter(x => x !== pend);
            store.save();
        }

        // 2. publish finished books
        for (const b of allBooks) if (publishBook(store, b)) console.log(`publisert: bok ${b}`);

        // 3. the window: the first --books books that are not all checked, and in each its first chapter not done
        const window = allBooks.filter(b => store.bookUnits(b).some(u => u.status !== 'checked' && u.status !== 'stuck')).slice(0, flags.books as number);
        const inFlight = new Set(store.pending.flatMap(p => p.units));
        let next = nextRequests(window.flatMap(b => store.chapterUnits(b)), inFlight);
        if (flags.limit) next = next.slice(0, flags.limit as number);

        if (credit) {
            console.log(NO_CREDIT);
            report(store, window);
            return EXIT_NO_CREDIT;
        }

        if (flags['dry-run']) {
            for (const kind of ['translate', 'review'] as Kind[]) {
                const reqs = next.filter(r => r.kind === kind);
                const chars = reqs.reduce((a, r) => a + JSON.stringify(requestFor(store, kind, r.id, model).params.messages).length, 0);
                console.log(`neste ${kind}: ${reqs.length} forespørsler, ${(chars / 1e6).toFixed(1)} M tegn inn — ${estimate(work, lang, kind, model, chars)}`);
            }
            report(store, window);
            return 0;
        }

        // 4. send the next step, as much of it as this month's budget leaves room for
        let left = (flags.budget as number) - spentThisMonth(work, lang) - store.pending.reduce((a, p) => a + p.reserved, 0);
        for (const kind of ['translate', 'review'] as Kind[]) {
            const reqs = next.filter(r => r.kind === kind).map(r => requestFor(store, kind, r.id, model));
            const affordable = [];
            for (const r of reqs) {
                const worst = worstCase(model, r);
                if (worst > left) break;
                left -= worst;
                affordable.push(r);
            }
            for (const group of chunk(affordable, r => JSON.stringify(r).length)) {
                try {
                    const batch = await client.messages.batches.create({requests: group});
                    store.pending.push({
                        id: batch.id, kind, model, units: group.map(r => r.custom_id.slice(2)),
                        chars: group.reduce((a, r) => a + JSON.stringify(r.params.messages).length, 0),
                        reserved: group.reduce((a, r) => a + worstCase(model, r), 0),
                        created: new Date().toISOString(),
                    });
                    store.save();
                    console.log(`sendt: ${kind} ${batch.id}, ${group.length} forespørsler`);
                } catch (e) {
                    if (isCreditExhausted(e)) {
                        console.log(NO_CREDIT);
                        report(store, window);
                        return EXIT_NO_CREDIT;
                    }
                    throw e;
                }
            }
        }

        if (!store.pending.length && next.length) {
            console.log(`\nMånedens budsjett (--budget $${flags.budget}) er brukt: $${spentThisMonth(work, lang).toFixed(2)} denne måneden. Kjør samme kommando igjen den 1.; den fortsetter der den stoppet.`);
            report(store, window);
            return EXIT_NO_CREDIT;
        }
        if (!store.pending.length) {
            report(store, allBooks);
            const stuck = store.allUnits().filter(u => u.status === 'stuck');
            console.log(stuck.length ? `ferdig, men ${stuck.length} enheter står fast (--retry-stuck gir dem nye runder)` : 'ferdig');
            return 0;
        }
        if (flags.once) { report(store, window); return 0; }
        await Bun.sleep(POLL_MS);
    }
}

if (import.meta.main) process.exit(await main());
