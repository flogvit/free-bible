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
 *   bun generate/make_script_docs.ts            # skriv docs/skript.md
 *   bun generate/make_script_docs.ts --check    # feil hvis fila er utdatert
 */

import {readFileSync, writeFileSync, existsSync} from 'fs';
import {dirname, join, relative} from 'path';
import {fileURLToPath} from 'url';
import {COMMON_FLAGS} from './cli.js';
import type {FlagSpec} from './cli.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Kataloger vi dokumenterer, i den rekkefølgen de skal stå. */
const AREAS: Array<{dir: string; title: string; blurb: string}> = [
    {dir: 'generate', title: 'generate/', blurb: 'Oversettelse, korrektur og alt tilleggsmateriale.'},
    {dir: 'kvn/scripts', title: 'kvn/scripts/', blurb: 'Mappinger, osmain og tekstverifisering. Les `kvn/README.md` først.'},
    {dir: 'contrib', title: 'contrib/', blurb: 'Køen for eksterne bidrag.'},
    {dir: 'articles', title: 'articles/', blurb: 'Høsting av åpne forskningsartikler (#15).'},
    {dir: 'books', title: 'books/', blurb: 'Høsting av public-domain-bøker (#16).'},
    {dir: 'songs', title: 'songs/', blurb: 'Høsting av salmer og sanger.'},
];

/** Filer som er biblioteker, ikke kjørbare skript. */
const LIBRARIES = new Set([
    'generate/cli.ts', 'generate/constants.ts', 'generate/lib.ts', 'generate/llm.ts',
    'generate/llm.js', 'generate/embeddings.ts', 'generate/env.ts',
    'generate/translations_schema.ts', 'generate/reading_plans_config.ts',
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
        const fn = new Function('COMMON_FLAGS', `return ${m[1].replace(/;$/, '')}`);
        return fn(COMMON_FLAGS) as Record<string, FlagSpec>;
    } catch {
        return null;
    }
}

function flagTable(spec: Record<string, FlagSpec>): string[] {
    const rows = Object.entries(spec).map(([name, s]) => {
        const def = s.default !== undefined && s.default !== false ? `\`${s.default}\`` : '—';
        return `| \`--${name}\` | ${s.kind} | ${def} | ${s.help} |`;
    });
    return ['| flagg | type | standard | betydning |', '|---|---|---|---|', ...rows];
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
        '# Skriptreferanse',
        '',
        '> Generert av `generate/make_script_docs.ts` fra kildekoden.',
        '> **Ikke rediger for hånd** — kjør `bun generate/make_script_docs.ts`.',
        '',
        'Flaggtabellene kommer fra `SPEC`-en i hvert skript, så de kan ikke drifte',
        'fra koden. Standardverdien er tatt med fordi den er den eneste som ikke går',
        'an å lese ut av kommandolinja i ettertid.',
        '',
        'Rekkefølgen man kjører dem i står i [ny-oversettelse.md](ny-oversettelse.md)',
        'og [tilleggsmateriale.md](tilleggsmateriale.md).',
        '',
        '## Felles flagg',
        '',
        'Disse betyr det samme i alle skript som har dem (#51, #52):',
        '',
        ...flagTable(COMMON_FLAGS),
        '',
        '`--remote` er **fjernet**: den betydde det motsatte av `--local`, og uten',
        'flagget kjøres jobben mot Claude. `--lang`, `--dry`, `--source` og `--n`',
        'godtas fortsatt, men advarer.',
        '',
        'Et ukjent flagg **kaster**. Den gamle oppførselen — stille ignorering —',
        'betyr at en skrivefeil i et køskript gir en jobb som kjører med feil',
        'innstilling uten å si fra.',
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
                out.push('*Håndrullet argumentparsing — flaggene er ikke generert herfra.*', '');
            }
        }
    }

    out.push('## Biblioteker', '', 'Ikke kjørbare, og har derfor ingen flagg:', '');
    for (const lib of [...LIBRARIES].sort()) {
        if (!existsSync(join(ROOT, lib))) continue;
        const p = purpose(readFileSync(join(ROOT, lib), 'utf-8'));
        out.push(`- \`${lib}\`${p ? ` — ${p}` : ''}`);
    }
    out.push('', `---`, '', `${migrated} av ${total} skript bruker den felles flaggkontrakten.`);

    return out.join('\n') + '\n';
}

const target = join(ROOT, 'docs', 'skript.md');
const generated = build();

if (process.argv.includes('--check')) {
    const current = existsSync(target) ? readFileSync(target, 'utf-8') : '';
    if (current !== generated) {
        console.error(`${relative(ROOT, target)} er utdatert — kjør: bun generate/make_script_docs.ts`);
        process.exit(1);
    }
    console.log(`${relative(ROOT, target)} er oppdatert`);
} else {
    writeFileSync(target, generated);
    console.log(`skrev ${relative(ROOT, target)}`);
}
