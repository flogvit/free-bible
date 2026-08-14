/**
 * bun test tests/modelltabell.test.ts
 *
 * Maskindokumentet skal svare på «hva kan jeg kjøre på denne maskinen» (#124).
 *
 * `docs/running-jobs.md` er dokumentet en bidragsyter leser før han starter en
 * jobb. Det målte svaret for en 64 GB-maskin lå i `docs/cross-references.md` —
 * en how-to for ÉN jobb — mens maskindokumentet oppga nedlastingsstørrelse og
 * delte modellene inn i «≤31b-klassen». To dokumenter målte forskjellige ting,
 * og bare det ene sa fra. Resultatet: `qwen3.6:35b` sto i maskindokumentet
 * utelukkende som en fiasko på 8 % — på en helt annen oppgave — mens den er den
 * målt raskeste dommeren som får plass på nettopp den maskinen.
 *
 * Testen sjekker IKKE tallene på nytt; de er frosne målinger fra 2026-08-01.
 * Den sjekker HVOR de står, og at den negative målingen ikke står alene:
 *
 *   1. dommertabellen (resident, s/vers, presisjon) og `eval-judges.ts` står i
 *      running-jobs.md,
 *   2. maskintabellen oppgir resident minne og deler ikke inn etter «31b»,
 *   3. `qwen3.6:35b` har både sin positive og sin negative måling der,
 *   4. cross-references.md peker på tabellen framfor å duplisere den.
 *
 * Punkt 4 er det som gjør de tre andre holdbare: to kopier av en måling driver
 * fra hverandre, og da er det ingen som vet hvilken som gjelder.
 */
import {test, expect} from 'bun:test';
import {existsSync, readFileSync} from 'fs';
import {dirname, join, resolve} from 'path';
import {fileURLToPath} from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const kjøring = readFileSync(join(ROOT, 'docs', 'running-jobs.md'), 'utf-8');
const kryssref = readFileSync(join(ROOT, 'docs', 'cross-references.md'), 'utf-8');

/**
 * Radene i dommertabellen — kjent igjen på KOLONNENE, ikke på overskriften over
 * den: den ene tabellen i repoet som oppgir både resident minne og sekunder per
 * vers. Da er det tabellens innhold testen holder fast, og en omskriving av
 * prosaen rundt står fritt.
 */
function dommertabell(doc: string): string[] {
    const linjer = doc.split('\n');
    const start = linjer.findIndex(
        (l) => l.startsWith('|') && /resident/i.test(l) && /s\/verse/i.test(l),
    );
    if (start === -1) return [];

    const rader: string[] = [];
    for (let i = start; i < linjer.length && linjer[i].startsWith('|'); i++) rader.push(linjer[i]);
    return rader;
}

/** Raden i dommertabellen for en modell, eller null om modellen ikke står der. */
function tabellrad(doc: string, modell: string): string | null {
    return dommertabell(doc).find((linje) => linje.includes(modell)) ?? null;
}

test('dommertabellen står i running-jobs.md, med resident, s/vers og presisjon', () => {
    const rader = dommertabell(kjøring);

    expect(rader.length).toBeGreaterThan(3);
    // Presisjon er den tredje kolonnen issuet krever: uten den rangerer tabellen
    // dommere etter fart alene, og det er nettopp feilen den skal forhindre.
    expect(rader[0]).toMatch(/precision/i);

    // Målingen fra 2026-08-01: 28,8 GB resident, 17 sekunder per vers.
    const rad = tabellrad(kjøring, 'qwen3.6:35b');
    expect(rad).not.toBeNull();
    expect(rad).toContain('28.8 GB');
    expect(rad).toContain('17');

    // De to andre målte dommerne hører med — uten dem er det ikke en
    // sammenlikning, bare en anbefaling.
    expect(tabellrad(kjøring, 'granite4.1:30b')).toContain('52.6 GB');
    expect(tabellrad(kjøring, 'qwen3.5:122b')).toContain('96');
});

test('running-jobs.md sier hvordan dommeren måles på nytt', () => {
    // Skriptet, ikke bare navnet på målingen: en tabell uten kommandoen bak seg
    // kan ikke etterprøves når det kommer en ny modell.
    expect(kjøring).toContain('generate/eval-judges.ts');
    expect(existsSync(join(ROOT, 'generate', 'eval-judges.ts'))).toBe(true);
});

test('maskintabellen oppgir resident minne, ikke bare nedlasting', () => {
    const maskin = kjøring.slice(kjøring.indexOf('## Hardware'), kjøring.indexOf('## What local models'));

    expect(maskin).toContain('resident');
    // Resident minne inkluderer KV-cachen, som skalerer med kontekstvinduet.
    // Står ikke det, leser en operatør nedlastingstall som om det var minnebruk.
    expect(maskin).toMatch(/KV cache|KV-cache/i);
});

test('maskindokumentet deler ikke lenger inn etter parametertall', () => {
    // «≤31b-klassen» beskriver en dense-verden: qwen3.6:35b er MoE, mindre
    // resident enn qwen3.6:27b og raskere enn begge.
    expect(kjøring).not.toMatch(/≤ ?31b/);
    expect(kjøring).not.toMatch(/31b class|31b-klassen/);
});

test('qwen3.6:35b står med både den positive og den negative målingen', () => {
    const negativ = kjøring.indexOf('8%');
    expect(negativ).toBeGreaterThan(-1);

    // Fiaskoen på 8 % gjaldt bedømming av oversettelseskvalitet. Står den som
    // eneste omtale, er modellen dømt av én oppgave.
    const omtaler = kjøring.split('qwen3.6:35b').length - 1;
    expect(omtaler).toBeGreaterThan(1);
});

test('prinsippet bak tallene er skrevet ned, ikke bare tallene', () => {
    // Hvorfor den samme modellen er likeverdig i den ene jobben og svak i den
    // andre: hvor kunnskapen kommer fra. Uten den setningen er tabellen to tall
    // som motsier hverandre.
    expect(kjøring).toMatch(/corpus/i);
    expect(kjøring).toMatch(/own parameters|its own weights/i);
});

test('cross-references.md peker på dommertabellen framfor å duplisere den', () => {
    expect(kryssref).toContain('running-jobs.md');

    // Selve tabellen skal finnes ett sted. Måletallene som identifiserer den —
    // resident minne per dommer — skal ikke stå to steder.
    expect(kryssref).not.toContain('28.8 GB');
    expect(kryssref).not.toContain('52.6 GB');

    // Men how-to-en blir: kommandolinja for den semantiske kjøringen er
    // dokumentets egen, og pinningen er hele forskjellen der.
    expect(kryssref).toContain('OLLAMA_MODEL=qwen3.6:35b bun generate/references-semantic.ts');
});
