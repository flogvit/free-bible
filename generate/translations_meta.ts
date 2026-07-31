import "./env.js";
/**
 * Generate bibles_raw/<translation>/meta.json — publishable metadata about each
 * translation (who, when, where, how it was made).
 *
 * Three sources of truth, in descending order of trust:
 *   1. computed  — coverage and features, read straight off the bible data
 *   2. manual    — translations_seed.json, for translations this repo produces itself
 *   3. llm+web   — pass 1 fills what the model knows and flags what it is unsure
 *                  of; pass 2 web-searches only the flagged fields and keeps
 *                  what a retrieved page actually supports
 *
 * An omitted field means unknown. Nothing is ever guessed into place.
 * license.json is read but never written — licence data stays where it is.
 *
 *   bun generate/translations_meta.ts                     # all translations missing meta.json
 *   bun generate/translations_meta.ts --only kjv,geneva   # named translations
 *   bun generate/translations_meta.ts --force             # regenerate existing
 *   bun generate/translations_meta.ts --recount           # refresh coverage only, no LLM
 *   bun generate/translations_meta.ts --no-web            # pass 1 only (cheap dry run)
 */
import * as fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';


import {callWithRetry, callWithWebSearch} from './llm.js';
import {parseArgs, formatHelp, COMMON_FLAGS} from './cli.js';
import type {FlagSpec} from './cli.js';
import {
    META_SCHEMA, KNOWLEDGE_FIELDS, PHILOSOPHY, TRADITION, TEXTUAL_BASIS,
    METHOD, REVIEW, EDITION_LABEL, LEGACY_TAG, RELATION,
    stripEmpty, validateMeta
} from './translations_schema.js';
import type {
    MetaCoverage, MetaFeatures, MetaProvenance, MetaSource,
    ObjectJsonSchema, TranslationMeta
} from './translations_schema.js';

/**
 * `bibles_raw/<oversettelse>/license.json` slik den ligger på disk. Den leses,
 * men skrives aldri herfra — lisensdata blir der de er.
 *
 * Alle felter er valgfrie fordi fila bare blir `JSON.parse`-et: ingenting
 * validerer den, og kallstedene her leser da også konsekvent med `?.`.
 */
export interface LicenseRecord {
    translation?: string;
    name?: string;
    language?: string;
    license?: string;
    spdx?: string;
    attribution_required?: boolean;
    noncommercial?: boolean;
    kvn_renumber_ok?: boolean;
    source?: string;
    statement?: string;
}

/** Det `computeCoverage` måler — tallene som aldri kommer fra en modell. */
export interface ComputedMeta {
    coverage: MetaCoverage;
    features: MetaFeatures;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_DIR = path.join(__dirname, 'bibles_raw');
const SEED_FILE = path.join(__dirname, 'translations_seed.json');

const VERSE_ID_RE = /"verseId"/g;
const STRONGS_RE = /\{[HG]\d+\}/;
const OT_LAST = 39;
const NT_LAST = 66;

// ---------------------------------------------------------------- computed ---

export function listTranslations(): string[] {
    return fs.readdirSync(RAW_DIR, {withFileTypes: true})
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
        .sort();
}

function numericEntries(dir: string): number[] {
    return fs.readdirSync(dir)
        .filter(name => /^\d+$/.test(name))
        .map(Number)
        .sort((a, b) => a - b);
}

/**
 * Read the whole translation once: book/chapter/verse counts plus feature detection.
 * Pure file IO — no LLM involved, so these numbers are always trustworthy.
 */
export function computeCoverage(translation: string): ComputedMeta {
    const translationDir = path.join(RAW_DIR, translation);
    const bookIds = numericEntries(translationDir);

    let chapters = 0;
    let verses = 0;
    let strongs = false;
    let altVersions = false;

    for (const bookId of bookIds) {
        const bookDir = path.join(translationDir, `${bookId}`);
        const chapterFiles = fs.readdirSync(bookDir).filter(name => name.endsWith('.json'));
        chapters += chapterFiles.length;

        for (const file of chapterFiles) {
            const raw = fs.readFileSync(path.join(bookDir, file), 'utf-8');
            verses += (raw.match(VERSE_ID_RE) || []).length;
            if (!strongs && STRONGS_RE.test(raw)) strongs = true;
            if (!altVersions && raw.includes('"versions"')) altVersions = true;
        }
    }

    const hasOt = bookIds.some(id => id <= OT_LAST);
    const hasNt = bookIds.some(id => id > OT_LAST && id <= NT_LAST);
    const testament = hasOt && hasNt ? 'both' : hasOt ? 'ot' : hasNt ? 'nt' : 'other';

    const expected = testament === 'ot' ? range(1, OT_LAST)
        : testament === 'nt' ? range(OT_LAST + 1, NT_LAST)
            : testament === 'both' ? range(1, NT_LAST)
                : [];
    const present = new Set(bookIds);

    return {
        coverage: {
            testament,
            books: bookIds.length,
            chapters,
            verses,
            deuterocanonical: bookIds.some(id => id > NT_LAST),
            missing_books: expected.filter(id => !present.has(id))
        },
        features: {strongs, alt_versions: altVersions}
    };
}

const range = (from: number, to: number): number[] => Array.from({length: to - from + 1}, (_, i) => from + i);

/**
 * `T` er en påstand om hva fila inneholder, ikke en kontroll: `JSON.parse` gir
 * `any`, og ingenting validerer resultatet. Kallstedet bestemmer formen.
 */
function readJson<T>(file: string): T | null {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as T;
}

// ------------------------------------------------------------------ prompts ---

const enumList = (label: string, values: readonly string[]): string => `${label}: ${values.join(' | ')}`;

const VOCABULARY = [
    enumList('philosophy', PHILOSOPHY),
    enumList('tradition', TRADITION),
    enumList('textual_basis.ot / .nt entries', TEXTUAL_BASIS),
    enumList('derived_from.relation', RELATION),
    enumList('work.method entries', METHOD),
    enumList('work.review', REVIEW),
    enumList('editions[].label', EDITION_LABEL),
    enumList('legacy[].tag', LEGACY_TAG)
].join('\n');

const RULES = `Rules:
- Omit any field you do not actually know. An omitted field means "unknown"; a
  guessed field is worse than a missing one. Never invent translator names,
  years, places or URLs.
- Use only the codes listed under Vocabulary. If no code fits, omit the field.
- language.iso639_3 / iso639_1 / script must be real ISO 639-3, ISO 639-1 and
  ISO 15924 codes.
- work.source_languages are ISO 639-3 codes of the languages translated FROM
  (hbo = biblical Hebrew, arc = Aramaic, grc = Koine Greek, lat = Latin).
  Set work.pivot_from only when the work was made from another translation
  rather than from the original languages.
- derived_from.translation must be one of the translation ids listed under Sibling translations.
- legacy[].text is exactly one factual sentence, in Norwegian bokmål.
- editions[] is the revision history, one entry per published edition.`;

function pass1Prompt(translation: string, license: LicenseRecord | null, computed: ComputedMeta, siblings: string[]): string {
    return `You are cataloguing a Bible translation for a public reference website.

Translation id: ${translation}
${license ? `Known from the licence catalogue:
  name: ${license.name}
  language: ${license.language}
  licence: ${license.license}
  statement: ${license.statement}
  catalogue: ${license.source}` : 'No licence record exists for this translation.'}

Measured from the actual text files (do not contradict these):
  testament: ${computed.coverage.testament}
  books: ${computed.coverage.books}, chapters: ${computed.coverage.chapters}, verses: ${computed.coverage.verses}
  deuterocanonical books present: ${computed.coverage.deuterocanonical}
  Strong's numbers in the text: ${computed.features.strongs}

Sibling translations in this collection (for derived_from / work.pivot_from):
${siblings.join(', ')}

Vocabulary:
${VOCABULARY}

${RULES}

Fill in what you know about this translation from memory. Then list, in
"uncertain", the field paths you filled but are NOT confident about — those get
web-verified in a second pass. Use these exact path strings:
${KNOWLEDGE_FIELDS.join(', ')}

For an obscure translation it is correct to return almost nothing. Do not pad.`;
}

function pass2SearchPrompt(translation: string, license: LicenseRecord | null, draft: TranslationMeta): string {
    const uncertain = draft.uncertain?.length ? draft.uncertain.join(', ') : '(none flagged)';
    return `Verify facts about a Bible translation by searching the web.

Translation id: ${translation}
Name: ${draft.name?.native || license?.name || translation}
Language: ${license?.language || draft.language?.iso639_3 || 'unknown'}

A first pass filled this in from memory. Treat it as a hypothesis, not as fact:
${JSON.stringify(stripEmpty({...draft, uncertain: undefined}) ?? {}, null, 2)}

These fields were flagged as unsure and are what you must check:
${uncertain}

Search for this translation (Wikipedia, the publisher's or Bible society's own
pages, digital library catalogues). Then report, in plain prose:
- for each flagged field: the correct value, or that you could not find it
- any flagged value from the draft that the sources contradict
- which page supports which fact

Do not report a fact you did not find on a page you retrieved. "Not found" is a
useful and expected answer.`;
}

function pass2MergePrompt(translation: string, draft: TranslationMeta, findings: string, urls: string[]): string {
    return `Produce the final catalogue record for Bible translation "${translation}".

Draft from memory:
${JSON.stringify(stripEmpty({...draft, uncertain: undefined}) ?? {}, null, 2)}

Findings from web search:
${findings}

Pages that were actually retrieved (you may cite only these URLs):
${urls.length ? urls.map(u => `- ${u}`).join('\n') : '(no pages were retrieved)'}

Vocabulary:
${VOCABULARY}

${RULES}

Merge the findings into the draft:
- Correct any draft value the findings contradict.
- Drop any draft value the findings could not confirm AND that was flagged as
  uncertain. Keep unflagged draft values as they are.
- List in "verified" the field paths a retrieved page supports.
- In "sources", map each cited URL to the field paths it supports. Cite only
  URLs from the list above.
- legacy[] entries may only survive if a retrieved page supports them.`;
}

// --------------------------------------------------------------- generation ---

/**
 * Svaret på sammensmeltings-prompten: de samme faktafeltene som meta.json,
 * pluss modellens egen kildeføring. `uncertain` er byttet ut med `verified`.
 */
interface MergeResult extends TranslationMeta {
    verified?: string[];
    sources?: MetaSource[];
}

const {uncertain: _uncertain, ...MERGE_PROPS} = META_SCHEMA.properties;
const MERGE_SCHEMA: ObjectJsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        ...MERGE_PROPS,
        verified: {type: 'array', items: {type: 'string'}},
        sources: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    url: {type: 'string'},
                    fields: {type: 'array', items: {type: 'string'}}
                },
                required: ['url', 'fields']
            }
        }
    },
    required: ['verified', 'sources']
};

const today = (): string => new Date().toISOString().slice(0, 10);

/** Keep only field paths the schema knows about, so provenance stays meaningful. */
const knownPaths = (paths?: readonly string[] | null): string[] =>
    [...new Set((paths ?? []).filter(p => KNOWLEDGE_FIELDS.includes(p)))];

function buildFromSeed(translation: string, seed: TranslationMeta, computed: ComputedMeta, license: LicenseRecord | null): TranslationMeta {
    const {provenance, ...facts} = seed;
    return assemble(facts, computed, license, {
        ...provenance,
        verified: knownPaths(provenance?.verified),
        generated: today()
    });
}

function assemble(
    facts: TranslationMeta,
    computed: ComputedMeta,
    license: LicenseRecord | null,
    // `Partial`: frø-posten sprer inn sin egen provenance-blokk, og typen kan
    // ikke se at `method` og `generated` alltid står der. Kallstedene setter dem.
    provenance: Partial<MetaProvenance>
): TranslationMeta {
    // Only the fact blocks get emptied out — for those, absent means unknown.
    // coverage, features and provenance are always measured or always known, so
    // they are attached verbatim: an empty missing_books means "complete", not
    // "unmeasured", and stripping it would destroy that distinction.
    const cleanFacts = stripEmpty({
        ...facts,
        // The licence catalogue is authoritative for the native name.
        name: stripEmpty({native: license?.name, ...facts.name})
    }) ?? {};

    // No id field: the translation's id is its directory name. Writing it here
    // too would let the two disagree, and nothing reads it.
    //
    // `as TranslationMeta`: `stripEmpty` returnerer `Stripped<T>`, som gjør ALLE
    // nestede felter valgfrie — den kan ikke vite hvilke som overlevde. Posten
    // går rett videre til `validateMeta`, som er den faktiske porten.
    return {
        ...cleanFacts,
        coverage: computed.coverage,
        features: computed.features,
        provenance: {
            method: provenance.method,
            verified: provenance.verified ?? [],
            sources: provenance.sources ?? [],
            generated: provenance.generated
        }
    } as TranslationMeta;
}

/** Det `generate` trenger utenom oversettelses-id-en. */
interface GenerateOptions {
    useWeb: boolean;
    license: LicenseRecord | null;
    computed: ComputedMeta;
    siblings: string[];
}

async function generate(translation: string, {useWeb, license, computed, siblings}: GenerateOptions): Promise<TranslationMeta> {
    // `callWithRetry` lover bare `string | object`; skjemaet over er det som
    // avgjør formen, så påstanden hører hjemme her.
    const draft = await callWithRetry(pass1Prompt(translation, license, computed, siblings), {
        schema: META_SCHEMA,
        context: `${translation} (pass 1)`
    }) as TranslationMeta;

    const flagged = knownPaths(draft.uncertain);
    if (!useWeb || flagged.length === 0) {
        const {uncertain, ...facts} = draft;
        return assemble(facts, computed, license, {
            method: 'llm',
            verified: [],
            sources: [],
            generated: today()
        });
    }

    console.log(`  web-verifying ${flagged.length} field(s): ${flagged.join(', ')}`);
    const search = await callWithWebSearch(pass2SearchPrompt(translation, license, draft), {
        context: `${translation} (pass 2 search)`
    });
    const retrieved = [...new Set(search.sources.map(s => s.url))];
    console.log(`  retrieved ${retrieved.length} page(s)`);

    const merged = await callWithRetry(
        pass2MergePrompt(translation, draft, search.text, retrieved),
        {schema: MERGE_SCHEMA, context: `${translation} (pass 2 merge)`}
    ) as MergeResult;

    const {verified, sources, ...facts} = merged;
    // Drop citations the search never actually fetched — the model must not
    // invent a URL to make a claim look sourced.
    const citable = new Set(retrieved);
    const keptSources = (sources ?? [])
        .filter(source => citable.has(source.url))
        .map(source => ({url: source.url, fields: knownPaths(source.fields)}));

    const supported = new Set(keptSources.flatMap(source => source.fields));
    return assemble(facts, computed, license, {
        method: 'llm+web',
        verified: knownPaths(verified).filter(field => supported.has(field)),
        sources: keptSources,
        generated: today()
    });
}

// --------------------------------------------------------------------- main ---

/** `only: null` betyr «alle oversettelser», ikke «ingen». */
interface Args {
    only: string[] | null;
    force: boolean;
    recount: boolean;
    useWeb: boolean;
}

/**
 * Flaggkontrakten for dette skriptet (#51, #52, #53).
 *
 * `--only` tar en KOMMASEPARERT liste og er derfor ikke `--bible` fra
 * fellesflaggene — den navngir flere oversettelser, ikke én.
 *
 * `--no-web` beholder navnet sitt: aksen er «gjør pass 2 eller ikke», og uten
 * flagget kjøres websøket, som før.
 */
const SPEC: Record<string, FlagSpec> = {
    only: {kind: 'string', help: 'bare disse oversettelsene, kommaseparert (f.eks. kjv,geneva)'},
    force: COMMON_FLAGS.force,
    recount: {kind: 'boolean', help: 'oppdater bare coverage/features på eksisterende meta.json, uten modellkall'},
    'no-web': {kind: 'boolean', help: 'hopp over websøk-passet — bare pass 1 (billig prøvekjøring)'},
    help: COMMON_FLAGS.help,
};

const HELP_EXAMPLES = [
    'bun generate/translations_meta.ts                     # alle uten meta.json',
    'bun generate/translations_meta.ts --only kjv,geneva   # navngitte oversettelser',
    'bun generate/translations_meta.ts --force             # lag på nytt selv om fila finnes',
    'bun generate/translations_meta.ts --recount           # bare nye tall, ingen modellkall',
    'bun generate/translations_meta.ts --no-web            # bare pass 1',
];

/** Oversetter de tolkede flaggene til `Args`. */
function readOptions(flags: ReturnType<typeof parseArgs>['flags']): Args {
    const only = (flags.only as string | undefined)
        ?.split(',').map(s => s.trim()).filter(Boolean);

    return {
        only: only ?? null,
        force: flags.force as boolean,
        recount: flags.recount as boolean,
        useWeb: !(flags['no-web'] as boolean),
    };
}

async function main(): Promise<void> {
    // Hjelpen skal ut før noe leses fra disk eller sendes over nettet.
    const {flags} = parseArgs(process.argv.slice(2), SPEC);
    if (flags.help) {
        console.log(formatHelp(
            'generate/translations_meta.ts',
            'publiserbar metadata per oversettelse — målt dekning, frødata og modellens kunnskap',
            SPEC,
            HELP_EXAMPLES,
        ));
        process.exit(0);
    }

    const args = readOptions(flags);
    // Fila har også en `_comment`-nøkkel; oppslaget er på oversettelses-id, så
    // typen beskriver postene, ikke hver nøkkel i fila.
    const seeds = readJson<Record<string, TranslationMeta>>(SEED_FILE) ?? {};
    const allTranslations = listTranslations();

    if (args.only) {
        const unknown = args.only.filter(m => !allTranslations.includes(m));
        if (unknown.length) throw new Error(`No such translation(s) in bibles_raw: ${unknown.join(', ')}`);
    }
    const translations = args.only ?? allTranslations;

    let written = 0, skipped = 0, failed = 0;

    for (const translation of translations) {
        const metaFile = path.join(RAW_DIR, translation, 'meta.json');
        const existing = readJson<TranslationMeta>(metaFile);

        if (existing && !args.force && !args.recount) {
            skipped++;
            continue;
        }

        try {
            const license = readJson<LicenseRecord>(path.join(RAW_DIR, translation, 'license.json'));
            process.stdout.write(`${translation}: counting... `);
            const computed = computeCoverage(translation);
            console.log(`${computed.coverage.books} books, ${computed.coverage.verses} verses`);

            let meta: TranslationMeta;
            if (args.recount && existing) {
                meta = {...existing, coverage: computed.coverage, features: computed.features};
            } else if (seeds[translation]) {
                console.log('  seeded (manual facts from this repo)');
                meta = buildFromSeed(translation, seeds[translation], computed, license);
            } else {
                meta = await generate(translation, {
                    useWeb: args.useWeb,
                    license,
                    computed,
                    siblings: allTranslations
                });
            }

            const problems = validateMeta(meta);
            if (problems.length) {
                console.error(`  INVALID: ${problems.join('; ')}`);
                failed++;
                continue;
            }

            fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2) + '\n');
            const verified = meta.provenance?.verified?.length ?? 0;
            console.log(`  wrote meta.json (${meta.provenance?.method}, ${verified} verified field(s))`);
            written++;
        } catch (error) {
            // `as Error` framfor en `instanceof`-sjekk: en sjekk ville endret
            // hva som skrives ut for et kast som ikke er en Error.
            console.error(`${translation}: FAILED — ${(error as Error).message}`);
            failed++;
        }
    }

    console.log(`\nDone. ${written} written, ${skipped} skipped (already present), ${failed} failed.`);
    if (failed) process.exitCode = 1;
}

// Guarded so computeCoverage/listTranslations can be imported without running a build.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main();
}
