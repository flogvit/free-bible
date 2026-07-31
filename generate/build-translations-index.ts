/**
 * Build generate/translations/index.json — one merged record per translation,
 * ready for a website to fetch once and use for both list and detail views.
 *
 * Sources, merged per translation:
 *   bibles_raw/<translation>/meta.json     editorial metadata (build-translations-meta.mjs)
 *   bibles_raw/<translation>/license.json  licence terms (existing, untouched)
 *
 * A translation's id is its directory name — that is the only place it is
 * recorded, so it cannot drift out of step with itself.
 *
 * The index is generated output: never edit it by hand, edit meta.json and
 * rebuild. Translations without meta.json are reported and left out.
 *
 *   bun build-translations-index.ts
 *
 * Flaggene går gjennom den felles kontrakten i cli.ts; `--help` viser dem.
 */
import * as fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';
import type {TranslationMeta} from './translations-schema.js';
import type {LicenseRecord} from './build-translations-meta.js';
import {parseArgs, formatHelp, COMMON_FLAGS} from './cli.js';
import type {FlagSpec} from './cli.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_DIR = path.join(__dirname, 'bibles_raw');
const OUT_DIR = path.join(__dirname, 'translations');
const OUT_FILE = path.join(OUT_DIR, 'index.json');

// Skriptet tar ingen argumenter utover hjelpen. Kontrakten er likevel med,
// slik at `--help` svarer i stedet for å bli tolket som et vanlig argument og
// skrive over translations/index.json (#108).
const SPEC: Record<string, FlagSpec> = {
    help: COMMON_FLAGS.help,
};

/**
 * meta.json slik indeksen leser den. `published` står ikke i `TranslationMeta`
 * fordi ingen av genereringspassene skriver det — det er et manuelt flagg som
 * holder en oversettelse ute av den publiserte indeksen.
 */
type IndexMeta = TranslationMeta & {published?: boolean};

/** Det `licenceBlock` slipper gjennom: lisensfeltene, omdøpt for nettstedet. */
interface LicenceBlock {
    license?: string;
    spdx?: string;
    attribution_required?: boolean;
    noncommercial?: boolean;
    kvn_renumber_ok?: boolean;
    catalogue?: string;
    statement?: string;
}

/** Én post i translations/index.json. */
type IndexEntry = IndexMeta & {
    translation: string;
    licence?: LicenceBlock;
};

/**
 * `T` er en påstand om hva fila inneholder, ikke en kontroll: `JSON.parse` gir
 * `any`, og ingenting validerer resultatet. Kallstedet bestemmer formen.
 */
function readJson<T>(file: string): T | null {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as T;
}

/** Licence fields a website may need; `translation` and `name` come from elsewhere. */
function licenceBlock(license: LicenseRecord | null): LicenceBlock | undefined {
    if (!license) return undefined;
    return {
        license: license.license,
        spdx: license.spdx,
        attribution_required: license.attribution_required,
        noncommercial: license.noncommercial,
        kvn_renumber_ok: license.kvn_renumber_ok,
        catalogue: license.source,
        statement: license.statement
    };
}

function main(): void {
    // Hjelpen skal ut før noe leses fra eller skrives til disk.
    const {flags} = parseArgs(process.argv.slice(2), SPEC);
    if (flags.help) {
        console.log(formatHelp(
            'generate/build-translations-index.ts',
            'slår sammen meta.json og license.json for hver oversettelse under '
            + 'generate/bibles_raw/ og SKRIVER den samlede generate/translations/index.json '
            + '(oversettelser uten meta.json, og de med "published": false, holdes utenfor)',
            SPEC,
        ));
        process.exit(0);
    }

    const translations = fs.readdirSync(RAW_DIR, {withFileTypes: true})
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
        .sort();

    const entries: IndexEntry[] = [];
    const missingMeta: string[] = [];
    const missingLicense: string[] = [];
    const withheld: string[] = [];

    for (const translation of translations) {
        const meta = readJson<IndexMeta>(path.join(RAW_DIR, translation, 'meta.json'));
        if (!meta) {
            missingMeta.push(translation);
            continue;
        }

        // `published: false` in meta.json withholds a translation from the
        // published index — superseded drafts, or anything not cleared for the
        // website. The bible data and its meta.json stay in the tree either way.
        if (meta.published === false) {
            withheld.push(translation);
            continue;
        }

        const license = readJson<LicenseRecord>(path.join(RAW_DIR, translation, 'license.json'));
        if (!license) missingLicense.push(translation);

        // Licence sits under its own key so it stays visibly separate from the
        // editorial facts — different provenance, different trust level.
        entries.push({translation, ...meta, licence: licenceBlock(license)});
    }

    // Group by language for list pages, falling back to the translation id.
    entries.sort((a, b) => {
        const langA = a.language?.iso639_3 ?? 'zzz';
        const langB = b.language?.iso639_3 ?? 'zzz';
        return langA.localeCompare(langB) || a.translation.localeCompare(b.translation);
    });

    fs.mkdirSync(OUT_DIR, {recursive: true});
    fs.writeFileSync(OUT_FILE, JSON.stringify(entries, null, 2) + '\n');

    const sizeKb = (fs.statSync(OUT_FILE).size / 1024).toFixed(1);
    console.log(`Wrote ${path.relative(__dirname, OUT_FILE)} — ${entries.length} translations, ${sizeKb} kB`);

    if (withheld.length) {
        console.log(`\nWithheld by "published": false (${withheld.length}): ${withheld.join(', ')}`);
    }
    if (missingLicense.length) {
        console.log(`\nNo license.json (${missingLicense.length}): ${missingLicense.join(', ')}`);
    }
    if (missingMeta.length) {
        console.log(`\nNo meta.json, left out of the index (${missingMeta.length}): ${missingMeta.join(', ')}`);
        console.log('Run: bun generate/build-translations-meta.ts');
    }
}

// Kjører bare når fila startes direkte. Uten vakten kjører jobben ved IMPORT —
// det er grunnen til at days.ts slettet data bare man lastet modulen (#108),
// og det gjør skriptene umulige å teste.
if (import.meta.main) {
    main();
}
