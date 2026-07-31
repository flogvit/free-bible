/**
 * Schema and controlled vocabularies for translation metadata (meta.json).
 *
 * Design rules:
 * - Every field is optional. An omitted field means "unknown", never "does not
 *   apply" and never a guess. The translation's id is its directory name, not a
 *   field — a field could disagree with the directory, and nothing would notice.
 * - Values that a website needs to display are codes, not prose, so the site
 *   localises the labels itself. Only `legacy[].text` and a few proper nouns
 *   are free text.
 * - `coverage` and `features` are computed from the bible data, never from an LLM.
 */

export const PHILOSOPHY = ['formal', 'dynamic', 'paraphrase', 'interlinear', 'source_text'] as const;
export type Philosophy = (typeof PHILOSOPHY)[number];

export const TRADITION = [
    'protestant', 'catholic', 'orthodox', 'jewish',
    'reformed', 'interconfessional', 'nondenominational'
] as const;
export type Tradition = (typeof TRADITION)[number];

// Codes for the source texts a translation was made from.
export const TEXTUAL_BASIS = [
    'mt',       // Masoretic Text
    'bhs',      // Biblia Hebraica Stuttgartensia
    'lxx',      // Septuagint
    'dss',      // Dead Sea Scrolls
    'tr',       // Textus Receptus
    'majority', // Byzantine / Majority Text
    'wh',       // Westcott-Hort (the 19th-century critical text)
    'resultant', // The Resultant Greek Testament (Weymouth's eclectic text)
    'na28',     // Nestle-Aland
    'ubs5',     // UBS Greek New Testament
    'sblgnt',   // SBL Greek New Testament
    'vulgate',
    'peshitta'
] as const;
export type TextualBasis = (typeof TEXTUAL_BASIS)[number];

export const RELATION = [
    'revision_of', 'modernization_of', 'strongs_edition_of',
    'translation_of', 'edition_of', 'renumbering_of'
] as const;
export type Relation = (typeof RELATION)[number];

export const METHOD = [
    'committee', 'single_translator', 'revision',
    'pivot', 'back_translation', 'ai_assisted'
] as const;
export type Method = (typeof METHOD)[number];

export const REVIEW = ['none', 'peer_review', 'ecclesiastical_approval', 'society_review'] as const;
export type Review = (typeof REVIEW)[number];

export const EDITION_LABEL = [
    'first_edition', 'revision', 'reprint', 'new_testament', 'complete_bible'
] as const;
export type EditionLabel = (typeof EDITION_LABEL)[number];

export const LEGACY_TAG = [
    'innovation', 'influence', 'controversy', 'reception', 'distinctive', 'limitation'
] as const;
export type LegacyTag = (typeof LEGACY_TAG)[number];

export const PROVENANCE_METHOD = ['llm', 'llm+web', 'manual', 'computed'] as const;
export type ProvenanceMethod = (typeof PROVENANCE_METHOD)[number];

export const TESTAMENT = ['both', 'ot', 'nt', 'other'] as const;
export type Testament = (typeof TESTAMENT)[number];

export const SCRIPT_DIRECTION = ['ltr', 'rtl'] as const;
export type ScriptDirection = (typeof SCRIPT_DIRECTION)[number];

/**
 * Field paths the LLM is allowed to claim knowledge about. Used to validate the
 * `uncertain` list from pass 1 so pass 2 cannot be sent chasing invented fields.
 *
 * Typed `readonly string[]` and not a literal union on purpose: every caller
 * filters *untrusted* paths against it (`KNOWLEDGE_FIELDS.includes(path)`), and
 * a narrow element type would reject exactly that call.
 */
export const KNOWLEDGE_FIELDS: readonly string[] = [
    'name.en', 'abbreviation',
    'language.iso639_3', 'language.iso639_1', 'language.script', 'language.direction',
    'year.published', 'year.revised',
    'place.city', 'place.country_iso',
    'translators', 'body', 'publisher',
    'philosophy', 'tradition', 'textual_basis', 'derived_from',
    'work.started', 'work.completed', 'work.method', 'work.source_languages',
    'work.pivot_from', 'work.team_size', 'work.commissioned_by', 'work.review', 'work.printer',
    'editions', 'legacy', 'links'
];

/**
 * The subset of JSON Schema this file writes. Structured outputs reject the rest,
 * so the type doubles as a reminder of what is allowed in META_SCHEMA.
 */
export interface JsonSchema {
    type?: 'object' | 'array' | 'string' | 'integer' | 'number' | 'boolean';
    enum?: readonly string[];
    properties?: Record<string, JsonSchema>;
    items?: JsonSchema;
    required?: readonly string[];
    additionalProperties?: boolean | JsonSchema;
    propertyNames?: { pattern: string };
    description?: string;
}

/** An object schema whose `properties` is guaranteed present, so callers can index it. */
export interface ObjectJsonSchema extends JsonSchema {
    type: 'object';
    properties: Record<string, JsonSchema>;
}

// ------------------------------------------------------------- meta.json shape ---

export interface MetaName {
    native?: string;
    en?: string;
}

export interface MetaLanguage {
    iso639_3?: string;
    iso639_1?: string;
    script?: string;
    direction?: ScriptDirection;
}

export interface MetaYear {
    published?: number;
    revised?: number;
}

export interface MetaPlace {
    city?: string;
    country_iso?: string;
}

export interface MetaTextualBasis {
    ot?: TextualBasis[];
    nt?: TextualBasis[];
}

export interface MetaDerivedFrom {
    translation: string;
    relation: Relation;
}

export interface MetaWork {
    started?: number;
    completed?: number;
    method?: Method[];
    source_languages?: string[];
    pivot_from?: string;
    team_size?: number;
    commissioned_by?: string;
    review?: Review;
    printer?: string;
}

export interface MetaEdition {
    year: number;
    label: EditionLabel;
    note?: string;
}

/**
 * Text keyed by ISO 639-1/639-3 language code. `en` is required: it is the floor
 * the website falls back to. Dynamic keys, hence the index signature.
 */
export type LocalizedText = { en: string } & Record<string, string>;

export interface MetaLegacy {
    tag: LegacyTag;
    text: LocalizedText;
}

export interface MetaLinks {
    wikipedia?: string;
    homepage?: string;
}

/** Counted off the files, never claimed by a model. */
export interface MetaCoverage {
    testament: Testament;
    books: number;
    chapters: number;
    verses: number;
    deuterocanonical: boolean;
    missing_books: number[];
}

export interface MetaFeatures {
    strongs: boolean;
    alt_versions: boolean;
}

/** One retrieved page and the field paths it supports. */
export interface MetaSource {
    url: string;
    fields: string[];
}

export interface MetaProvenance {
    method: ProvenanceMethod;
    verified: string[];
    sources: MetaSource[];
    generated: string;
}

/**
 * A finished meta.json. Every field is optional — an omitted field means
 * "unknown" — and the translation's id is its directory name, not a field here.
 */
export interface TranslationMeta {
    name?: MetaName;
    abbreviation?: string;
    language?: MetaLanguage;
    year?: MetaYear;
    place?: MetaPlace;
    translators?: string[];
    body?: string;
    publisher?: string;
    philosophy?: Philosophy;
    tradition?: Tradition;
    textual_basis?: MetaTextualBasis;
    derived_from?: MetaDerivedFrom;
    work?: MetaWork;
    editions?: MetaEdition[];
    legacy?: MetaLegacy[];
    links?: MetaLinks;
    /** Only on the pass-1 draft; stripped before the record is written. */
    uncertain?: string[];
    coverage?: MetaCoverage;
    features?: MetaFeatures;
    provenance?: MetaProvenance;
}

const enumOf = (values: readonly string[]): JsonSchema => ({ type: 'string', enum: values });

/**
 * JSON Schema for the LLM-authored part of meta.json (blocks a, b, e, f, g).
 * `coverage`, `features` and `provenance` are added by the generator, not the model.
 *
 * Structured outputs reject unsupported keywords (minLength, maximum, ...), so
 * bounds are enforced in validateMeta() instead.
 */
export const META_SCHEMA: ObjectJsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        name: {
            type: 'object',
            additionalProperties: false,
            properties: {
                native: { type: 'string' },
                en: { type: 'string' }
            }
        },
        abbreviation: { type: 'string' },
        language: {
            type: 'object',
            additionalProperties: false,
            properties: {
                iso639_3: { type: 'string' },
                iso639_1: { type: 'string' },
                script: { type: 'string' },
                direction: enumOf(SCRIPT_DIRECTION)
            }
        },
        year: {
            type: 'object',
            additionalProperties: false,
            properties: {
                published: { type: 'integer' },
                revised: { type: 'integer' }
            }
        },
        place: {
            type: 'object',
            additionalProperties: false,
            properties: {
                city: { type: 'string' },
                country_iso: { type: 'string' }
            }
        },
        translators: { type: 'array', items: { type: 'string' } },
        body: { type: 'string' },
        publisher: { type: 'string' },

        philosophy: enumOf(PHILOSOPHY),
        tradition: enumOf(TRADITION),
        textual_basis: {
            type: 'object',
            additionalProperties: false,
            properties: {
                ot: { type: 'array', items: enumOf(TEXTUAL_BASIS) },
                nt: { type: 'array', items: enumOf(TEXTUAL_BASIS) }
            }
        },
        derived_from: {
            type: 'object',
            additionalProperties: false,
            properties: {
                translation: { type: 'string' },
                relation: enumOf(RELATION)
            },
            required: ['translation', 'relation']
        },

        work: {
            type: 'object',
            additionalProperties: false,
            properties: {
                started: { type: 'integer' },
                completed: { type: 'integer' },
                method: { type: 'array', items: enumOf(METHOD) },
                source_languages: { type: 'array', items: { type: 'string' } },
                pivot_from: { type: 'string' },
                team_size: { type: 'integer' },
                commissioned_by: { type: 'string' },
                review: enumOf(REVIEW),
                printer: { type: 'string' }
            }
        },

        editions: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    year: { type: 'integer' },
                    label: enumOf(EDITION_LABEL),
                    note: { type: 'string' }
                },
                required: ['year', 'label']
            }
        },

        legacy: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    tag: enumOf(LEGACY_TAG),
                    // Keyed by ISO 639-1 language code. `en` is required: it is the
                    // floor the website falls back to, so a missing language shows
                    // English rather than the translation's own language.
                    text: {
                        type: 'object',
                        propertyNames: { pattern: '^[a-z]{2,3}$' },
                        additionalProperties: { type: 'string' },
                        required: ['en']
                    }
                },
                required: ['tag', 'text']
            }
        },

        links: {
            type: 'object',
            additionalProperties: false,
            properties: {
                wikipedia: { type: 'string' },
                homepage: { type: 'string' }
            }
        },

        uncertain: {
            type: 'array',
            items: { type: 'string' },
            description: 'Field paths above that were filled from memory and should be web-verified.'
        }
    },
    required: ['uncertain']
};

/**
 * The same shape back, but anything may have fallen away: an empty field is
 * dropped, and dropping the last field of an object drops the object too.
 */
export type Stripped<T> =
    T extends readonly (infer E)[] ? Stripped<E>[]
        : T extends object ? { [K in keyof T]?: Stripped<T[K]> }
            : T;

/** Remove null, undefined, empty strings, empty arrays and empty objects, recursively. */
export function stripEmpty<T>(value: T): Stripped<T> | undefined {
    if (Array.isArray(value)) {
        const items = value.map(stripEmpty).filter(v => v !== undefined);
        return (items.length ? items : undefined) as Stripped<T> | undefined;
    }
    if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(value)) {
            const cleaned = stripEmpty(val);
            if (cleaned !== undefined) out[key] = cleaned;
        }
        return (Object.keys(out).length ? out : undefined) as Stripped<T> | undefined;
    }
    if (value === null || value === undefined) return undefined;
    if (typeof value === 'string' && value.trim() === '') return undefined;
    return value as unknown as Stripped<T>;
}

const inEnum = <T extends string>(value: T | undefined, values: readonly T[]): boolean =>
    value === undefined || values.includes(value);

/**
 * Validate a finished meta object. Returns an array of problem strings; empty means valid.
 * Enforces the constraints structured outputs cannot express.
 */
export function validateMeta(meta: TranslationMeta): string[] {
    const problems: string[] = [];
    const check = (ok: boolean, message: string): void => { if (!ok) problems.push(message); };

    check(inEnum(meta.philosophy, PHILOSOPHY), `philosophy: unknown value "${meta.philosophy}"`);
    check(inEnum(meta.tradition, TRADITION), `tradition: unknown value "${meta.tradition}"`);
    check(inEnum(meta.language?.direction, SCRIPT_DIRECTION),
        `language.direction: unknown value "${meta.language?.direction}"`);
    check(inEnum(meta.work?.review, REVIEW), `work.review: unknown value "${meta.work?.review}"`);

    for (const testament of ['ot', 'nt'] as const) {
        for (const code of meta.textual_basis?.[testament] ?? []) {
            check(TEXTUAL_BASIS.includes(code), `textual_basis.${testament}: unknown code "${code}"`);
        }
    }
    for (const method of meta.work?.method ?? []) {
        check(METHOD.includes(method), `work.method: unknown value "${method}"`);
    }
    for (const edition of meta.editions ?? []) {
        check(EDITION_LABEL.includes(edition.label), `editions: unknown label "${edition.label}"`);
        check(Number.isInteger(edition.year), `editions: year must be an integer, got "${edition.year}"`);
    }

    const verified = new Set(meta.provenance?.verified ?? []);
    for (const item of meta.legacy ?? []) {
        check(LEGACY_TAG.includes(item.tag), `legacy: unknown tag "${item.tag}"`);
        // `text` is a language map, not a string. The statement is about the
        // translation but it is read by whoever is on the site, so it belongs to
        // the reader's language, not the translation's.
        const text = item.text;
        check(text !== null && typeof text === 'object' && !Array.isArray(text),
            `legacy: text must be an object keyed by language code ("${item.tag}")`);
        if (text && typeof text === 'object' && !Array.isArray(text)) {
            check(typeof text.en === 'string' && text.en.length > 0,
                `legacy: text.en is required — it is the fallback every other language lands on ("${item.tag}")`);
            for (const [lang, value] of Object.entries(text)) {
                check(/^[a-z]{2,3}$/.test(lang), `legacy: "${lang}" is not a language code ("${item.tag}")`);
                check(typeof value === 'string' && value.length <= 300,
                    `legacy: text.${lang} must be a single sentence under 300 chars ("${item.tag}")`);
            }
        }
        check(verified.has('legacy'), 'legacy: present but not listed in provenance.verified (sources required)');
    }

    if (meta.derived_from) {
        check(RELATION.includes(meta.derived_from.relation),
            `derived_from: unknown relation "${meta.derived_from.relation}"`);
    }

    if (meta.provenance) {
        check(PROVENANCE_METHOD.includes(meta.provenance.method),
            `provenance.method: unknown value "${meta.provenance.method}"`);
    }

    // Cross-check the claims against the measured text. coverage is counted off
    // the files, so where the two disagree the claim is what's wrong.
    if (meta.coverage) {
        const testament = meta.coverage.testament;
        check(inEnum(testament, TESTAMENT), `coverage.testament: unknown value "${testament}"`);

        if (testament === 'ot' && meta.textual_basis?.nt) {
            problems.push('textual_basis.nt claimed, but the translation has no New Testament books');
        }
        if (testament === 'nt' && meta.textual_basis?.ot) {
            problems.push('textual_basis.ot claimed, but the translation has no Old Testament books');
        }
        const editionLabels = (meta.editions ?? []).map(edition => edition.label);
        if (testament === 'both' && editionLabels.length && !editionLabels.includes('complete_bible')
            && editionLabels.every(label => label === 'new_testament')) {
            problems.push('only a new_testament edition is listed, but the translation has both testaments');
        }
    }

    const years = [meta.year?.published, meta.year?.revised, meta.work?.started, meta.work?.completed];
    for (const year of years) {
        if (year === undefined) continue;
        check(Number.isInteger(year) && year >= -300 && year <= 2100, `year out of range: ${year}`);
    }

    return problems;
}
