/**
 * bun test
 *
 * `generate/` sin ROT er kode, ikke data (#107).
 *
 * Katalogen er både skriptkatalog og datakatalog. Det går bra så lenge dataen
 * ligger i UNDERKATALOGER — `bibles_raw/`, `references/`, `songs/` — og rota
 * bare holder skriptene. Det som skjedde 2026-05-10 var at elleve
 * `eval_*.json` fra én innstillingsdag ble liggende rett i rota, ~380 KB
 * mellom femti skript, og etter det kunne ingen se hvilken fil som var et
 * program og hvilken som var et måleresultat. De er flyttet til
 * `generate/eval/`, og `translations_seed.json` til `generate/data/`.
 *
 * Testen finnes fordi opprydningen ellers er en engangshandling: neste skript
 * som skriver et resultat til `__dirname` legger igjen den samme rota, og
 * ingenting sier fra. `eval-references.ts` gjorde nettopp det.
 *
 * Regelen er en TILLATELSESLISTE på suffiks, ikke en liste over kjente
 * synderfiler. En liste over navn må vedlikeholdes for å virke, og en liste
 * ingen vedlikeholder er en liste som sier ja til alt.
 *
 * `.md` er tillatt sammen med `.ts`: prosa ved siden av koden er ikke rot, og
 * `tests/docs-filnavn.test.ts` leser allerede `generate/*.md` som en mulighet.
 *
 * Skjulte filer hoppes over. `.env` og `.DS_Store` er begge gitignorert og
 * finnes bare på maskinen de ble laget på — en test som feilet på dem ville
 * feilet ulikt hos to utviklere, og det er ikke en påstand om repoet.
 */
import {test, expect} from 'bun:test';
import {readdirSync} from 'fs';
import {dirname, join, resolve} from 'path';
import {fileURLToPath} from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Kode og prosa. Alt annet er data, og data hører hjemme i en underkatalog. */
const TILLATTE_SUFFIKS = ['.ts', '.md'];

function løseFilerIGenerateRota(): string[] {
    return readdirSync(join(ROOT, 'generate'), {withFileTypes: true})
        .filter((e) => e.isFile() && !e.name.startsWith('.'))
        .map((e) => e.name);
}

test('generate/-rota holder bare skript og prosa — data ligger i underkataloger', () => {
    const data = løseFilerIGenerateRota()
        .filter((navn) => !TILLATTE_SUFFIKS.some((s) => navn.endsWith(s)));

    expect(data).toEqual([]);
});

test('innstillingskjøringene ligger i generate/eval/, ikke i rota', () => {
    // Navnet `eval_*.json` er formen de hadde da de lå løst. Kommer den
    // tilbake, er det den samme feilen på nytt — uansett suffiks.
    const evalIRota = løseFilerIGenerateRota().filter((navn) => navn.startsWith('eval_'));

    expect(evalIRota).toEqual([]);

    const evalKatalog = readdirSync(join(ROOT, 'generate', 'eval'));
    expect(evalKatalog).toContain('results.json');
});
