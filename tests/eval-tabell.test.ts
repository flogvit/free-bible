/**
 * bun test
 *
 * Innstillingen dokumentasjonen anbefaler skal fortsatt være den beste målte
 * (#107).
 *
 * Elleve `eval_*.json` lå i skriptrota uten at noe sted sa hvilken av dem som
 * vant. Filene bar kunnskapen, men bare for den som gadd å regne på dem — og
 * det er den samme kunnskapen `docs/cross-references.md` bygger sin ene
 * kommandolinje på (`--threshold 0.65`, ingen andre flagg).
 *
 * Å skrive svaret ned i prosa løser halve problemet. Den andre halvparten er at
 * prosaen ikke har noen kobling til målingene: legger noen inn en ny kjøring
 * som slår 0.65, står anbefalingen der like skråsikker som før. Denne testen er
 * koblingen. Den sjekker IKKE tallene i tabellen — de er frosne målinger fra
 * 2026-05-10 og endrer seg aldri — den sjekker PÅSTANDEN: ingen kjøring i
 * `generate/eval/` har høyere andel gode referanser enn den anbefalte.
 *
 * Den gjør samtidig eval-filene bærende. Slettes de, feiler testen, og
 * spørsmålet «sporet eller gitignorert» har et svar det går an å etterprøve.
 *
 * `results.json` holdes utenfor: den er den eneste kjøringen over
 * `EVAL_VERSES=extra` — fire andre vers — så andelen er ikke sammenliknbar.
 * Å ta den med ville sammenliknet to ulike prøver og kalt det en rangering.
 */
import {test, expect} from 'bun:test';
import {readdirSync, readFileSync} from 'fs';
import {dirname, join, resolve} from 'path';
import {fileURLToPath} from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EVAL_DIR = join(ROOT, 'generate', 'eval');

/** Kjøringen som er skrevet ned som valgt, uttrykt slik `extraArgs` lagret den. */
const ANBEFALT_ARGS = '--threshold 0.65';

/** Kjøringen over det andre testsettet — se toppkommentaren. */
const ANNET_TESTSETT = 'results.json';

interface EvalKjøring {
    fil: string;
    args: string;
    vers: number;
    refs: number;
    andelGode: number;
}

function lesKjøringer(): EvalKjøring[] {
    return readdirSync(EVAL_DIR)
        .filter((navn) => navn.endsWith('.json') && navn !== ANNET_TESTSETT)
        .map((navn) => {
            const d = JSON.parse(readFileSync(join(EVAL_DIR, navn), 'utf-8'));
            // `score: null` betyr at dommeren ikke svarte — hverken god eller
            // dårlig, så den skal ut av både teller og nevner.
            const scores: number[] = d.results
                .flatMap((r: {newRefs: {score: number | null}[]}) => r.newRefs.map((x) => x.score))
                .filter((s: number | null): s is number => s != null);
            const gode = scores.filter((s) => s >= 4).length;
            return {
                fil: navn,
                args: (d.extraArgs ?? '').trim(),
                vers: d.results.length,
                refs: scores.length,
                andelGode: gode / scores.length,
            };
        });
}

test('kjøringene som sammenliknes er målt over det samme testsettet', () => {
    const kjøringer = lesKjøringer();

    expect(kjøringer.length).toBeGreaterThan(1);
    // En rangering over ulike prøver er ikke en rangering. Kommer det inn en
    // kjøring over et annet antall vers, må den holdes utenfor slik
    // `results.json` er det — ikke sammenliknes som om den hørte hjemme her.
    expect([...new Set(kjøringer.map((k) => k.vers))]).toEqual([6]);
});

test('den anbefalte innstillingen finnes blant kjøringene', () => {
    const anbefalt = lesKjøringer().find((k) => k.args === ANBEFALT_ARGS);

    expect(anbefalt).toBeDefined();
    expect(anbefalt!.fil).toBe('thr065.json');
});

test('ingen målt innstilling slår den docs/cross-references.md anbefaler', () => {
    const kjøringer = lesKjøringer();
    const anbefalt = kjøringer.find((k) => k.args === ANBEFALT_ARGS)!;

    const bedre = kjøringer
        .filter((k) => k.andelGode > anbefalt.andelGode)
        .map((k) => `${k.fil} (${k.args || 'defaults'}): ${(k.andelGode * 100).toFixed(0)}%`);

    // Feiler denne, er ikke testen gal — da er anbefalingen i
    // docs/cross-references.md innhentet, og prosaen der skal skrives om.
    expect(bedre).toEqual([]);
});

test('docs/cross-references.md navngir den vinnende innstillingen', () => {
    const doc = readFileSync(join(ROOT, 'docs', 'cross-references.md'), 'utf-8');

    // Selve kommandoen operatøren kopierer, ikke bare tabellraden over den.
    expect(doc).toContain('--verify-only --resume --threshold 0.65');
    expect(doc).toContain('`--threshold 0.65` and nothing else is the setting that won');
});
