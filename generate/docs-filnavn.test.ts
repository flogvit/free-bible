/**
 * bun test
 *
 * Hvert filnavn dokumentasjonen navngir skal finnes (#119).
 *
 * Bun-runden døpte om 75 skript fra `.mjs`/`.js` til `.ts`, og dokumentasjonen
 * ble stående igjen med de gamle navnene: CLAUDE.md pekte på ni filer som ikke
 * fantes, `docs/lokale-jobber.md` på ni til — inkludert en kommando en operatør
 * skal kopiere rett inn i skallet (`bun triage.mjs osnb`). Symptomet er stille:
 * ingenting feiler før noen faktisk prøver, og da ser det ut som en manglende
 * fil framfor et utdatert dokument.
 *
 * Testen er STRUKTURELL: den leter ikke etter `.mjs` spesielt, men krever at
 * ethvert filnavn i backticks lar seg resolve. Neste omdøping fanges dermed
 * uansett hvilket suffiks den går til.
 *
 * Bare MARKDOWN sjekkes. I kildekode er `./llm.js` en gyldig ESM-spesifikator
 * for `llm.ts`, så samme regel ville gitt falske positiver der.
 */
import {test, expect} from 'bun:test';
import {existsSync, readFileSync, readdirSync, statSync} from 'fs';
import {dirname, join, resolve} from 'path';
import {fileURLToPath} from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Navn som med VILJE ikke finnes. Hver oppføring er en påstand som må kunne
 * forsvares — ikke et sted å dytte inn det som ikke går opp.
 */
const BEVISST_BORTE: Record<string, string> = {
    'kvn/scripts/build-osnb-mapping.ts':
        'slettet 2026-07-31 (#58); CLAUDE.md dokumenterer nettopp at den er borte',
    'references_semantic.mjs':
        'historisk sitat i eval-references-avsnittet: kommandoen som feilet FØR omdøpingen',
    'kvn/src/ukvn-types.js':
        'sitert FEILMELDING fra node (ERR_MODULE_NOT_FOUND) i lokale-jobber.md — ' +
        'at fila ikke finnes er nettopp poenget i det avsnittet',
};

/**
 * Kataloger vi ikke leter i: fremmed kode, data og et 21 GB arkiv.
 *
 * `docs/superpowers/` er PLANER og spesifikasjoner fra april — de beskriver
 * filer som ble foreslått, ikke filer som finnes. Et plandokument skal ikke
 * rettes i takt med koden; det er et øyeblikksbilde av hva vi tenkte da.
 */
const HOPP_OVER = new Set(['node_modules', 'external', '.git', 'bibles_raw', 'generate', 'superpowers']);

function markdownfiler(dir: string, ut: string[] = []): string[] {
    for (const e of readdirSync(dir, {withFileTypes: true})) {
        if (e.name.startsWith('.') || HOPP_OVER.has(e.name)) continue;
        const p = join(dir, e.name);
        if (e.isDirectory()) markdownfiler(p, ut);
        else if (e.name.endsWith('.md')) ut.push(p);
    }
    return ut;
}

/** `generate/` hoppes over i vandringen (21 000 datafiler), men dokumentene der skal med. */
function alleMarkdownfiler(): string[] {
    const generateDocs = readdirSync(join(ROOT, 'generate'), {withFileTypes: true})
        .filter((e) => e.isFile() && e.name.endsWith('.md'))
        .map((e) => join(ROOT, 'generate', e.name));
    return [...markdownfiler(ROOT), ...generateDocs];
}

// Filnavn i backticks: `triage.ts`, `generate/bible.ts`, `kvn/src/ukvn.ts`.
// Et navn kan stå midt i en kommando (`bun triage.ts osnb`), derfor tokeniseres
// innholdet framfor å matche hele backtick-innslaget.
const FILNAVN = /\b([\w./-]+\.(?:ts|mjs|js|sh))\b/g;
const BACKTICKS = /`([^`\n]+)`/g;

/** Stedene et dokumentert navn rimeligvis kan bo. */
function finnes(navn: string, dokument: string): boolean {
    const kandidater = [
        join(ROOT, navn),
        join(ROOT, 'generate', navn),
        join(dirname(dokument), navn),
        // KVN-avsnittene skriver stier relativt til `kvn/` (`src/ukvn.ts`,
        // `tests/mapping-integrity.test.ts`), fordi kvn/README.md er nabo.
        join(ROOT, 'kvn', navn),
        join(ROOT, 'kvn/scripts', navn),
        join(ROOT, 'kvn/src', navn),
        join(ROOT, 'kvn/tests', navn),
    ];
    return kandidater.some((p) => existsSync(p) && statSync(p).isFile());
}

test('hvert filnavn i dokumentasjonen finnes', () => {
    const døde: string[] = [];

    for (const dok of alleMarkdownfiler()) {
        const tekst = readFileSync(dok, 'utf-8');
        const relativt = dok.slice(ROOT.length + 1);

        for (const [, innhold] of tekst.matchAll(BACKTICKS)) {
            for (const [, navn] of innhold!.matchAll(FILNAVN)) {
                if (navn! in BEVISST_BORTE) continue;
                if (finnes(navn!, dok)) continue;
                døde.push(`${relativt}: ${navn}`);
            }
        }
    }

    expect(døde).toEqual([]);
});

test('unntakslista er ikke utdatert', () => {
    // Et unntak som PLUTSELIG finnes igjen skal ut av lista, ellers slutter den
    // å bety noe.
    for (const navn of Object.keys(BEVISST_BORTE)) {
        expect(existsSync(join(ROOT, navn))).toBe(false);
    }
});
