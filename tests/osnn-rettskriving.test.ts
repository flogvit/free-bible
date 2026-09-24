/**
 * bun test
 *
 * osnn er nynorsk, og en oversettelse med stavefeil i teksten er ikke en
 * variant leseren kan velge — den er bare feil. Skillet er verdt å holde fast
 * på: CLAUDE.md sier at variasjon mellom gjengivelser ER produktet, så denne
 * testen sier ingenting om ordvalg, bøyning eller stil. Den ser bare etter
 * former som ikke finnes i nynorsk i det hele tatt.
 *
 * Første rad kom fra #125: 1 Pet 2,12 skrev «baktallar». Verbet er «baktala»,
 * presens «baktalar» — med én l — og resten av osnn skriver det slik i 25
 * andre vers. Én fil hadde dobbel l tre steder, og ingenting sa fra, fordi
 * ingen test her leser TEKSTEN i bibeldataene; `tests/`-testene ser på
 * repostrukturen og `kvn/`-testene på versnummer.
 *
 * Testen leser hele kapittelfila som tekst, ikke bare `text`-feltet. En
 * stavefeil i `versions[].text` er like synlig for leseren — det er der
 * alternativene står — og en i `explanation` leses av den som lurer på hvorfor
 * verset er som det er.
 *
 * Raden er en FORM, ikke en versreferanse. Skulle den samme feilen dukke opp i
 * et annet kapittel senere, er det den samme feilen, og da skal testen se den
 * der også.
 */
import {test, expect} from 'bun:test';
import {readdirSync, readFileSync} from 'fs';
import {dirname, join, resolve} from 'path';
import {fileURLToPath} from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OSNN = join(ROOT, 'generate', 'bibles_raw', 'osnn');

/** Former som ikke finnes i nynorsk, og hva de skulle vært. */
const FEILSTAVINGER: Array<{feil: RegExp; rett: string}> = [
    // «tale» har én l i alle bøyninger: baktalar, baktala, baktalinga.
    {feil: /baktall\p{L}*/giu, rett: 'baktal…'},
];

function kapittelfiler(): string[] {
    const filer: string[] = [];
    for (const bok of readdirSync(OSNN, {withFileTypes: true})) {
        if (!bok.isDirectory()) continue;
        for (const kapittel of readdirSync(join(OSNN, bok.name))) {
            if (kapittel.endsWith('.json')) filer.push(join(bok.name, kapittel));
        }
    }
    return filer;
}

test('osnn har ingen kjente feilstavinger', () => {
    const funn: string[] = [];

    for (const fil of kapittelfiler()) {
        const innhold = readFileSync(join(OSNN, fil), 'utf8');
        for (const {feil, rett} of FEILSTAVINGER) {
            for (const treff of innhold.matchAll(feil)) {
                funn.push(`${fil}: «${treff[0]}» skal være «${rett}»`);
            }
        }
    }

    expect(funn).toEqual([]);
});
