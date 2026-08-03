import "./env.js";
import * as fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';

import {callWithRetry} from './llm.js';
import {loadEmbeddings, topKByIndex} from './embeddings.js';
import {buildVerifyPrompt, VERIFY_SCHEMA, coverageOf, acceptedVerdicts} from './references-semantic.js';
import {parseArgs, formatHelp, COMMON_FLAGS} from './cli.js';
import type {FlagSpec} from './cli.js';
import type {Verse} from '../kvn/src/bible-types.js';

/**
 * Måler hvilken lokal modell som kan være dommer i den semantiske
 * referanserørledningen, uten å røre en eneste referansefil.
 *
 * Dette er IKKE `eval-references.ts`. Den måler *rørledningens innstillinger*
 * (terskel, top-k, --theme/--concepts) med Claude som kvalitetsdommer og koster
 * API-kall. Denne måler *modellene* — hvem som i det hele tatt klarer oppgaven,
 * hvor fort, og hvor mye minne de tar — og koster ingenting.
 *
 * Grunnen til at den finnes: 2026-08-01 ble fem modeller sammenliknet i en rigg
 * som ble kastet etterpå. Kommer det en ny modell, skal ikke riggen bygges på
 * nytt — da måler man noe annet enn forrige gang og kan ikke sammenlikne.
 *
 * ## Hva den fanger, og hvorfor akkurat det
 *
 * - **`ufullstendige`** — svarte modellen om ALLE kandidatene? Et svar med færre
 *   oppføringer enn kandidater er gyldig JSON og ser normalt ut, men lar
 *   kandidater være uvurdert. gemma4:31b returnerte 1 av 13 og kalte det en
 *   suksess. Målingen deles nå med produksjonsstien — `coverageOf` i
 *   `references-semantic.ts` (#122) — slik at de to tallene betyr det samme.
 * - **Varm tid, ikke kald.** Ollama holder én modell om gangen, så et kall rett
 *   etter modellbytte betaler for innlastingen — og straffen er størst for den
 *   største modellen, altså skjev i modellenes disfavør. Målt 2026-08-01 er
 *   forskjellen 5–6 sekunder, men det skal ikke antas, det skal måles.
 * - **Resident minne, ikke filstørrelse.** KV-cachen skaleres med
 *   kontekstvinduet: granite4.1:30b er 17 GB på disk og 52,6 GB i minnet. Det er
 *   det residente tallet som avgjør hva som får plass på en 64 GB-maskin.
 *
 * ## Sekundene er bare gyldige INNENFOR én kjøring
 *
 * Maskinlast slår rett inn i tallene. Samme modell, samme prompt, målt på to
 * påfølgende dager: 27 s/vers med en rolig maskin, 122 s/vers med IntelliJ på
 * 265 % CPU og load average 11. Ingen struping, ingen batteridrift — bare kamp om
 * ressursene.
 *
 * Derfor måler denne alle modellene i ETT løp, og derfor skal to filer i `eval/`
 * ikke sammenliknes med hverandre. Forholdet mellom modeller innenfor samme fil
 * er robust; det absolutte sekundtallet er et øyeblikksbilde av maskinen.
 * Skal en ny modell veies mot en gammel, kjør begge på nytt i samme kall.
 *
 * ## Hva den IKKE svarer på
 *
 * Om referansene modellen godtar er RIKTIGE. Akseptrate er ikke presisjon — en
 * modell som godtar alt scorer likt med en som velger godt. Det krever Claude
 * som dommer; kjør `eval-references.ts` for det, eller dom de godtatte
 * referansene i `eval/judges-<tidsstempel>.json` separat.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SPEC: Record<string, FlagSpec> = {
    models: {kind: 'string', help: 'kommaseparerte ollama-modeller å måle'},
    verses: {kind: 'number', help: 'antall vers i utvalget', default: 10},
    threshold: {kind: 'string', help: 'minste cosinuslikhet, som i references-semantic', default: '0.65'},
    'neighbor-skip': {kind: 'number', help: 'hopp over vers i samme kapittel innenfor N', default: 5},
    'top-k': {kind: 'number', help: 'antall kandidater per vers', default: 30},
    help: COMMON_FLAGS.help,
};

const HELP_EXAMPLES = [
    'bun generate/eval-judges.ts --models qwen3.6:35b,qwen3.5:27b',
    'bun generate/eval-judges.ts --models nymodell:30b --verses 20',
    '',
    'Skriver eval/judges-<tidsstempel>.json. Rører ingen referansefiler,',
    'bruker ingen Claude-kall, og kan avbrytes når som helst.',
];

interface Row {
    model: string;
    verses: number;
    candidates: number;
    answered: number;
    incomplete: number;
    accepted: number;
    failures: number;
    coldSeconds: number;
    warmSecondsPerVerse: number;
    residentGB: number;
}

async function residentGB(model: string): Promise<number> {
    try {
        const res = await fetch('http://localhost:11434/api/ps');
        const data = await res.json() as {models: Array<{name: string; size: number}>};
        return +((data.models.find(m => m.name === model)?.size || 0) / 1e9).toFixed(1);
    } catch {
        return 0;
    }
}

/**
 * Deterministisk utvalg: jevnt fordelt over korpuset, og bare vers som har et
 * arbeidsbart antall kandidater. Uten den nedre grensen måler man mest tomgang —
 * 8 % av versene har null kandidater ved 0.65 — og uten en fast skrittlengde blir
 * to kjøringer usammenliknbare.
 */
function pickVerses(state: ReturnType<typeof loadEmbeddings<Verse>>, want: number, threshold: number, topK: number, skip: number) {
    const chosen: Array<{idx: number; candidates: Verse[]}> = [];
    const stride = Math.max(1, Math.floor(state.items.length / (want * 4)));
    for (let i = 0; i < state.items.length && chosen.length < want; i += stride) {
        const v = state.items[i];
        const cands = topKByIndex(state, i, {
            k: topK,
            threshold,
            filter: (it) => !(it.bookId === v.bookId && it.chapterId === v.chapterId && Math.abs(it.verseId - v.verseId) <= skip)
        }).map(t => state.items[t.idx]);
        if (cands.length >= 4) chosen.push({idx: i, candidates: cands});
    }
    return chosen;
}

async function main(): Promise<void> {
    const {flags} = parseArgs(process.argv.slice(2), SPEC);
    if (flags.help) {
        console.log(formatHelp(
            'generate/eval-judges.ts',
            'måler lokale modeller som dommer i den semantiske referanserørledningen: klarer de skjemaet, hvor fort, og hvor mye minne',
            SPEC,
            HELP_EXAMPLES,
        ));
        process.exit(0);
    }

    const models = String(flags.models || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!models.length) {
        console.error('--models er påkrevd. Se --help.');
        process.exit(1);
    }

    const threshold = parseFloat(flags.threshold as string);
    if (Number.isNaN(threshold)) throw new Error(`--threshold: «${flags.threshold}» er ikke et tall`);

    const state = loadEmbeddings<Verse>('osnb');
    const sample = pickVerses(state, flags.verses as number, threshold, flags['top-k'] as number, flags['neighbor-skip'] as number);
    const totalCandidates = sample.reduce((a, s) => a + s.candidates.length, 0);
    console.log(`${sample.length} vers, ${totalCandidates} kandidater, terskel ${threshold}`);
    console.log(`modeller: ${models.join(', ')}\n`);

    const rows: Row[] = [];
    const accepted: Array<Record<string, unknown>> = [];

    for (const model of models) {
        const row: Row = {
            model, verses: 0, candidates: 0, answered: 0, incomplete: 0,
            accepted: 0, failures: 0, coldSeconds: 0, warmSecondsPerVerse: 0, residentGB: 0,
        };

        // Oppvarming med SAMME prompt, slik at num_ctx allokeres som i de målte
        // kallene. Uten den måler første vers innlastingen i tillegg til arbeidet.
        const warm = sample[0];
        const t0 = Date.now();
        try {
            await callWithRetry(buildVerifyPrompt(state.items[warm.idx], warm.candidates), {
                schema: VERIFY_SCHEMA, local: true, model, context: `warmup ${model}`
            });
            row.coldSeconds = Math.round((Date.now() - t0) / 1000);
            row.residentGB = await residentGB(model);
        } catch (e) {
            console.log(`${model}: oppvarming feilet — ${(e as Error).message.slice(0, 80)}`);
            rows.push(row);
            continue;
        }

        let seconds = 0;
        for (const {idx, candidates} of sample) {
            const source = state.items[idx];
            const t = Date.now();
            try {
                const res = await callWithRetry(buildVerifyPrompt(source, candidates), {
                    schema: VERIFY_SCHEMA, local: true, model,
                    context: `${model} ${source.bookId}:${source.chapterId}:${source.verseId}`
                }) as {results?: Array<{id: number; accept: boolean; note: string}>};
                seconds += (Date.now() - t) / 1000;
                row.verses++;
                row.candidates += candidates.length;

                // Samme måling som produksjonsstien gjør (#122), fra samme
                // funksjon: `list.length` alene teller et duplikat som et svar
                // og en id utenfor lista som dekning.
                const coverage = coverageOf(res.results, candidates.length);
                row.answered += coverage.answered;
                if (coverage.missing.length) row.incomplete++;

                for (const {candidate, verdict} of acceptedVerdicts(res.results, candidates)) {
                    row.accepted++;
                    accepted.push({
                        model,
                        source: `${source.bookId}:${source.chapterId}:${source.verseId}`,
                        ref: `${candidate.bookId}:${candidate.chapterId}:${candidate.verseId}`,
                        note: verdict.note,
                    });
                }
            } catch (e) {
                row.failures++;
                console.log(`  ${model} ${source.bookId}:${source.chapterId}:${source.verseId} — ${(e as Error).message.slice(0, 60)}`);
            }
        }
        row.warmSecondsPerVerse = row.verses ? Math.round(seconds / row.verses) : 0;
        rows.push(row);
        console.log(`${model.padEnd(18)} ${String(row.residentGB).padStart(5)} GB  ${String(row.warmSecondsPerVerse).padStart(4)} s/vers  godtatt ${row.accepted}/${row.candidates}  ufullstendige ${row.incomplete}  feilet ${row.failures}`);
    }

    const dir = path.join(__dirname, 'eval');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, {recursive: true});
    // Tidsstempelet kommer fra fila som skrives, ikke fra en variabel i en tabell:
    // to kjøringer skal ikke overskrive hverandre slik eval/results.json gjør.
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const out = path.join(dir, `judges-${stamp}.json`);
    fs.writeFileSync(out, JSON.stringify({
        threshold, topK: flags['top-k'], neighborSkip: flags['neighbor-skip'],
        verses: sample.length, candidates: totalCandidates, rows, accepted
    }, null, 2));

    console.log(`\nSkrevet: ${path.relative(process.cwd(), out)}`);
    console.log('Akseptrate er ikke presisjon — de godtatte referansene ligger i fila og må dømmes separat.');
}

if (import.meta.main) {
    main().catch(err => {
        console.error(err);
        process.exit(1);
    });
}
