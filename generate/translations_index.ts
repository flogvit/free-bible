/**
 * Build generate/translations/index.json — one merged record per translation,
 * ready for a website to fetch once and use for both list and detail views.
 *
 * Sources, merged per translation:
 *   bibles_raw/<translation>/meta.json     editorial metadata (translations_meta.mjs)
 *   bibles_raw/<translation>/license.json  licence terms (existing, untouched)
 *
 * A translation's id is its directory name — that is the only place it is
 * recorded, so it cannot drift out of step with itself.
 *
 * The index is generated output: never edit it by hand, edit meta.json and
 * rebuild. Translations without meta.json are reported and left out.
 *
 *   node translations_index.mjs
 */
import * as fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_DIR = path.join(__dirname, 'bibles_raw');
const OUT_DIR = path.join(__dirname, 'translations');
const OUT_FILE = path.join(OUT_DIR, 'index.json');

function readJson(file) {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

/** Licence fields a website may need; `translation` and `name` come from elsewhere. */
function licenceBlock(license) {
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

function main() {
    const translations = fs.readdirSync(RAW_DIR, {withFileTypes: true})
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
        .sort();

    const entries = [];
    const missingMeta = [];
    const missingLicense = [];
    const withheld = [];

    for (const translation of translations) {
        const meta = readJson(path.join(RAW_DIR, translation, 'meta.json'));
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

        const license = readJson(path.join(RAW_DIR, translation, 'license.json'));
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
        console.log('Run: node translations_meta.mjs');
    }
}

main();
