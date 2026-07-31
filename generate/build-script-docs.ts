#!/usr/bin/env bun

/**
 * Genererer `docs/skript.md` fra koden (#113).
 *
 * Den leser `SPEC`-blokken ut av hver kildefil TEKSTUELT framfor å importere
 * skriptet. Grunnen er konkret: flere av skriptene gjør arbeid ved import — de
 * leser filer, kaller Ollama, og `days.ts` sletter data. En dokumentasjons-
 * generator som importerer dem ville startet jobber.
 *
 * Formålslinja hentes fra den første setningen i toppkommentaren.
 *
 * Bruk:
 *   bun generate/build-script-docs.ts            # skriv docs/skript.md
 *   bun generate/build-script-docs.ts --check    # feil hvis fila er utdatert
 */

import {readFileSync, writeFileSync, existsSync} from 'fs';
import {dirname, join, relative} from 'path';
import {fileURLToPath} from 'url';
import {parseArgs, formatHelp, COMMON_FLAGS} from './cli.js';
import type {FlagSpec} from './cli.js';

const SPEC: Record<string, FlagSpec> = {
    check: {kind: 'boolean', help: 'ikke skriv — feil hvis docs/skript.md er utdatert'},
    help: COMMON_FLAGS.help,
};

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Kataloger vi dokumenterer, i den rekkefølgen de skal stå. */
const AREAS: Array<{dir: string; title: string; blurb: string}> = [
    {dir: 'generate', title: 'generate/', blurb: 'Translation, proofreading and all the supporting material.'},
    {dir: 'kvn/scripts', title: 'kvn/scripts/', blurb: 'Mappings, osmain and text verification. Read `kvn/README.md` first.'},
    {dir: 'contrib', title: 'contrib/', blurb: 'The queue for external contributions.'},
    {dir: 'articles', title: 'articles/', blurb: 'Harvesting open-access research articles (#15).'},
    {dir: 'books', title: 'books/', blurb: 'Harvesting public-domain books (#16).'},
    {dir: 'songs', title: 'songs/', blurb: 'Harvesting hymns and songs.'},
];

/** Filer som er biblioteker, ikke kjørbare skript. */
const LIBRARIES = new Set([
    'generate/cli.ts', 'generate/constants.ts', 'generate/lib.ts', 'generate/llm.ts',
    'generate/llm.js', 'generate/embeddings.ts', 'generate/env.ts',
    'generate/translations-schema.ts', 'generate/reading-plans-config.ts',
    'contrib/contrib-types.ts',
]);

/** Trekker ut den første setningen fra toppkommentaren. */
function purpose(src: string): string {
    const block = src.match(/^\s*(?:#![^\n]*\n)?\s*\/\*\*([\s\S]*?)\*\//);
    if (!block) return '';
    const text = block[1]
        .split('\n')
        .map(l => l.replace(/^\s*\*ateral?\s?/, '').replace(/^\s*\*\s?/, '').trim())
        .filter(l => l && !l.startsWith('Usage:') && !l.startsWith('Bruk:') && !l.startsWith('bun '))
        .join(' ')
        .trim();
    const first = text.split(/(?<=[.!?])\s/)[0] || text;
    return first.replace(/\s+/g, ' ').slice(0, 300);
}

/**
 * Henter `SPEC`-objektet ut av kildeteksten.
 *
 * `eval` er trygt her fordi inndata er våre egne, sporede kildefiler — men den
 * ser bare selve objektliteralen, ikke resten av skriptet.
 */
function extractSpec(src: string): Record<string, FlagSpec> | null {
    const m = src.match(/const SPEC:\s*Record<string,\s*FlagSpec>\s*=\s*(\{[\s\S]*?\n\};)/);
    if (!m) return null;
    try {
        // Flere SPEC-er bruker modulens egne konstanter som standardverdi
        // (`CHECK_LENGTH_DEFAULT`, `getTaskModel('triage')`). Å importere
        // modulen for å få tak i dem ville kjørt skriptet — se toppkommentaren.
        // I stedet får ukjente navn en sentinel som også kan kalles, slik at
        // både `X` og `f(x)` går gjennom. Verdien rapporteres da som «fra
        // koden» framfor å bli gjettet på.
        const body = m[1].replace(/;$/, '');
        // `with` er ikke lov i strict mode, og ES-moduler er alltid strict.
        // Så: finn de frie navnene i teksten og send dem inn som parametre.
        const KJENTE = new Set(['COMMON_FLAGS', 'true', 'false', 'null', 'undefined']);
        // Bare navn som ser ut som modulkonstanter (STORE_BOKSTAVER) eller
        // getters (`getTaskModel`). Å ta ALLE identifikatorer ville fanget
        // objektnøklene i SPEC-en selv.
        const frie = [...new Set(
            (body.match(/\b[A-Za-z_$][A-Za-z0-9_$]*\b/g) || [])
                .filter(n => !KJENTE.has(n) && (/^[A-Z][A-Z0-9_]*$/.test(n) || /^get[A-Z]/.test(n))),
        )];
        const fn = new Function('COMMON_FLAGS', ...frie, `return ${body}`);
        return fn(COMMON_FLAGS, ...frie.map(() => UKJENT)) as Record<string, FlagSpec>;
    } catch (e) {
        if (process.env.DEBUG_DOCS) console.error("SPEC-eval feilet:", e instanceof Error ? e.message : e);
        return null;
    }
}

/**
 * Standardverdi som kommer fra en modulkonstant vi ikke kan lese herfra.
 *
 * Symboler må gå gjennom uendret: returnerer man sentinelen for
 * `Symbol.toPrimitive`, kaster JS «Symbol.toPrimitive returned an object» så
 * snart verdien skal koersjoneres.
 */
const UKJENT: any = new Proxy(function () {} as any, {
    get: (_t, k) => {
        if (k === Symbol.toPrimitive) return () => '(fra koden)';
        if (k === 'toString' || k === Symbol.toStringTag) return () => '(fra koden)';
        if (typeof k === 'symbol') return undefined;
        return UKJENT;
    },
    apply: () => UKJENT,
});

function flagTable(spec: Record<string, FlagSpec>): string[] {
    const rows = Object.entries(spec).map(([name, s]) => {
        const def = s.default === UKJENT ? '*from the code*'
            : s.default !== undefined && s.default !== false ? `\`${s.default}\`` : '—';
        // Står et boolsk flagg PÅ som standard, er det `--no-<flagg>` brukeren
        // trenger — `--<flagg>` ville vært en no-op.
        const vist = s.kind === 'boolean' && s.default === true ? `no-${name}` : name;
        return `| \`--${vist}\` | ${s.kind} | ${def} | ${s.help} |`;
    });
    return ['| flag | type | default | meaning |', '|---|---|---|---|', ...rows];
}

function listScripts(dir: string): string[] {
    const abs = join(ROOT, dir);
    if (!existsSync(abs)) return [];
    const {readdirSync} = require('fs') as typeof import('fs');
    return readdirSync(abs)
        .filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.endsWith('.d.ts'))
        .map(f => `${dir}/${f}`)
        .filter(f => !LIBRARIES.has(f))
        .sort();
}

function build(): string {
    const out: string[] = [
        '# Script reference',
        '',
        '> Generated by `generate/build-script-docs.ts` from the source code.',
        '> **Do not edit by hand** — run `bun generate/build-script-docs.ts`.',
        '',
        "The flag tables come from each script's `SPEC`, so they cannot drift from the",
        'code. The default is included because it is the only thing you cannot read',
        'off the command line afterwards.',
        '',
        'The order to run them in is in [new-translation.md](new-translation.md) and',
        '[supporting-material.md](supporting-material.md). What is missing, and how',
        'much of it, is in [STATUS.md](../STATUS.md).',
        '',
        '**The purpose line under each script is still Norwegian**, because it is',
        "extracted from the script's own top comment. Translating those means editing",
        'about 50 source files, which also changes every `--help` output.',
        '',
        '## Common flags',
        '',
        'These mean the same thing in every script that has them (#51, #52):',
        '',
        ...flagTable(COMMON_FLAGS),
        '',
        '`--remote` has been **removed**: it meant the opposite of `--local`, and',
        'without the flag the job runs against Claude. `--lang`, `--dry`, `--source`',
        'and `--n` are still accepted, but warn.',
        '',
        'An unknown flag **throws**. The old behaviour — silently ignoring it — means',
        'a typo in a queue script gives you a job running with the wrong setting and',
        'saying nothing about it.',
        '',
    ];

    let migrated = 0;
    let total = 0;

    for (const area of AREAS) {
        const scripts = listScripts(area.dir);
        if (!scripts.length) continue;

        out.push(`## ${area.title}`, '', area.blurb, '');

        for (const rel of scripts) {
            total++;
            const src = readFileSync(join(ROOT, rel), 'utf-8');
            const spec = extractSpec(src);
            if (spec) migrated++;

            out.push(`### \`${rel}\``, '');
            const p = purpose(src);
            if (p) out.push(p, '');

            if (spec) {
                out.push(...flagTable(spec), '');
            } else {
                out.push('*Hand-rolled argument parsing — the flags are not generated from here.*', '');
            }
        }
    }

    out.push('## Libraries', '', 'Not executable, and therefore have no flags:', '');
    for (const lib of [...LIBRARIES].sort()) {
        if (!existsSync(join(ROOT, lib))) continue;
        const p = purpose(readFileSync(join(ROOT, lib), 'utf-8'));
        out.push(`- \`${lib}\`${p ? ` — ${p}` : ''}`);
    }
    out.push('', `---`, '', `${migrated} of ${total} scripts use the common flag contract.`);

    return out.join('\n') + '\n';
}

const {flags} = parseArgs(process.argv.slice(2), SPEC);
if (flags.help) {
    console.log(formatHelp(
        'generate/build-script-docs.ts',
        'genererer docs/skript.md fra SPEC-en i hvert skript',
        SPEC,
        ['bun generate/build-script-docs.ts', 'bun generate/build-script-docs.ts --check'],
    ));
    process.exit(0);
}

const target = join(ROOT, 'docs', 'skript.md');
const generated = build();

if (flags.check) {
    const current = existsSync(target) ? readFileSync(target, 'utf-8') : '';
    if (current !== generated) {
        console.error(`${relative(ROOT, target)} er utdatert — kjør: bun generate/build-script-docs.ts`);
        process.exit(1);
    }
    console.log(`${relative(ROOT, target)} er oppdatert`);
} else {
    writeFileSync(target, generated);
    console.log(`skrev ${relative(ROOT, target)}`);
}
