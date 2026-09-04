#!/usr/bin/env bun
/**
 * Renewal of old public-domain Bible reference works: run one model over the sample
 * corpus in this directory, first pass plus a proofread loop, and keep every output
 * next to the others so models can be compared on identical input.
 *
 * Layout (one directory per sample):
 *   <sample>/source.txt              the source paragraph (1937 Norwegian, 1871 English, 1866 German OCR)
 *   <sample>/kind                    modernize | translate_en | translate_de
 *   <sample>/<model>.first.txt       first pass
 *   <sample>/<model>.proof.txt       after the proofread loop (bible.ts --batch pattern)
 *   <sample>/<model>.proof.log       findings per round
 *
 * The proofread loop is the one behind osnb: source + current rendering → findings with the
 * whole corrected text + a 0–10 score; apply, remember the replaced version, repeat until
 * the score reaches --min-score or the rounds run out. A suggestion shorter than
 * MIN_LENGTH_RATIO of the current text is rejected as probably truncated.
 *
 * Usage:
 *   bun generate/eval/reference-works/run.ts --model qwen3.5:122b          # local (Ollama)
 *   bun generate/eval/reference-works/run.ts --model claude-opus-5 --claude # Anthropic API
 *   bun generate/eval/reference-works/run.ts --model gemma4:31b --only kd-gen1_1
 *   bun generate/eval/reference-works/run.ts --list
 *
 * Then compare, per sample:
 *   python3 generate/eval/reference-works/worddiff.py <sample>/source.txt <sample>/<model>.first.txt
 *   python3 generate/eval/reference-works/refcheck.py <sample>/source.txt <sample>/<model>.proof.txt
 *
 * Measured 2026-09-03/04 (qwen3.5:122b, claude-opus-5, claude-fable-5-1): a local reviewer
 * ran away past 12 000 tokens on one sample when given version history, so local calls cap
 * num_predict and a truncated round counts as failed; and the reviewer's own markup leaked
 * into the text once (`himmelsfeste**n**`). Check for `**` outside the lemma before use.
 */
import '../../env.js';
import { call } from '../../llm.js';
import { parseArgs, formatHelp, COMMON_FLAGS } from '../../cli.js';
import type { FlagSpec } from '../../cli.js';
import fs from 'fs';
import path from 'path';

const DIR = import.meta.dir;
const MIN_LENGTH_RATIO = 0.85;
const LOCAL_NUM_PREDICT = 6000;

const SPEC: Record<string, FlagSpec> = {
  model: { kind: 'string', help: 'model name; file names use it with ":" → "-"' },
  claude: { kind: 'boolean', help: 'call the Anthropic API (sets ANTHROPIC_MODEL to --model); default is Ollama' },
  only: { kind: 'string', help: 'run one sample directory only' },
  'min-score': { kind: 'number', default: 8, help: 'stop the proofread loop at this score' },
  rounds: { kind: 'number', default: 3, help: 'max proofread rounds' },
  'skip-proof': { kind: 'boolean', help: 'first pass only' },
  list: { kind: 'boolean', help: 'list samples and existing outputs, then exit' },
  help: COMMON_FLAGS.help,
};

const { flags } = parseArgs(process.argv.slice(2), SPEC);
if (flags.help) { console.log(formatHelp('generate/eval/reference-works/run.ts', 'Run one model over the reference-work samples: first pass, then the proofread loop.', SPEC)); process.exit(0); }

type Kind = 'modernize' | 'translate_en' | 'translate_de';
const samples = fs.readdirSync(DIR)
  .filter(n => fs.existsSync(path.join(DIR, n, 'source.txt')))
  .filter(n => !flags.only || n === flags.only)
  .sort();

if (flags.list) {
  for (const s of samples) {
    const kind = fs.readFileSync(path.join(DIR, s, 'kind'), 'utf8').trim();
    const outputs = fs.readdirSync(path.join(DIR, s)).filter(f => f.endsWith('.proof.txt')).map(f => f.replace('.proof.txt', ''));
    console.log(`${s}  [${kind}]  ${outputs.join(', ') || '(no outputs)'}`);
  }
  process.exit(0);
}
if (!flags.model) { console.error('--model is required'); process.exit(1); }
const MODEL = flags.model as string;
const TAG = MODEL.replace(/:/g, '-');
const useClaude = !!flags.claude;
// constants.ts reads ANTHROPIC_MODEL when it is imported, which has already happened by now.
// Re-run this script with the variable set instead of trying to change it after the fact.
if (useClaude && process.env.ANTHROPIC_MODEL !== MODEL) {
  const child = Bun.spawnSync([process.execPath, ...process.argv.slice(1)], {
    env: { ...process.env, ANTHROPIC_MODEL: MODEL }, stdout: 'inherit', stderr: 'inherit',
  });
  process.exit(child.exitCode ?? 1);
}
const MIN_SCORE = flags['min-score'] as number;
const MAX_ROUNDS = flags.rounds as number;

async function ask(prompt: string, schema?: object): Promise<string> {
  if (useClaude) return call(prompt, { schema, local: false });
  return call(prompt, { schema, local: true, model: MODEL, ollamaOptions: { num_predict: LOCAL_NUM_PREDICT } });
}

// ---------- first pass ----------
const FIRST: Record<Kind, (src: string) => string> = {
  modernize: (src) => `Nedenfor står et avsnitt fra en norsk bibelkommentar fra 1937 (Sigurd Odland, Romerbrevet). Skriv det om til dagens bokmål.

Regler:
- Bytt bare ut gammel rettskrivning og gamle ord og bøyninger (noget→noe, kunde→kunne, hvad→hva, sig→seg, mellem→mellom, efter→etter, blev→ble, ennu→ennå, ti→for, meget→mye, kun→bare osv.).
- Behold innholdet nøyaktig: hvert argument, hver henvisning (v. 12, Gal. 3, 19 osv.), hvert sitat i «».
- Behold setningsbygningen der den fungerer på moderne norsk; del bare opp setninger som er uleselige.
- Ikke legg til noe, ikke fjern noe, ikke forklar, ikke forkort.
- Rett åpenbare OCR-feil (f.eks. «komraet» → «kommet», «seiv» → «selv»).
- Svar bare med den moderniserte teksten, ingen innledning.

Tekst:
${src}`,
  translate_en: (src) => `Nedenfor står en versnote fra Jamieson, Fausset & Browns bibelkommentar (1871, engelsk). Oversett den til dagens bokmål.

Regler:
- Oversett trofast: alt innhold med, ingenting lagt til, ingenting forklart eller forkortet.
- Notene begynner med et oppslagsord i fet skrift (**...--**) som siterer verset. Oversett oppslagsordet til norsk, behold fet skrift og «--».
- Bibelhenvisninger skrives på norsk vis: Is 34:11 → Jes 34,11; Ge 1:3-5 → 1 Mos 1,3-5; Ro 5:20 → Rom 5,20.
- Behold forfatterens tone og synspunkter, også der de er datert. Ikke moderniser innholdet, bare språket.
- Svar bare med oversettelsen, ingen innledning.

Tekst:
${src}`,
  translate_de: (src) => `Nedenfor står et avsnitt fra Keil & Delitzsch, Biblischer Commentar über das Alte Testament (1866, tysk, OCR fra frakturskrift). Oversett det til dagens bokmål.

Regler:
- Oversett trofast: alt innhold med, ingenting lagt til, ingenting forklart eller forkortet.
- Hebraiske ord i OCR-en er ødelagt. Der et hebraisk ord åpenbart mangler eller er søppel, skriv [hebr.] i stedet for å gjette.
- Bibelhenvisninger skrives på norsk vis: Jes. 34,11 → Jes 34,11; c.2,4 → kap. 2,4.
- Behold forfatterens tone og synspunkter, også der de er datert. Ikke moderniser innholdet, bare språket.
- Rett åpenbare OCR-feil i det tyske (delte ord, feillest bokstav) stille.
- Svar bare med oversettelsen, ingen innledning.

Tekst:
${src}`,
};

// ---------- proofread ----------
const SCHEMA = {
  type: 'object',
  properties: {
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['error', 'suggestion', 'grammar'] },
          severity: { type: 'string', enum: ['critical', 'major', 'minor'] },
          quote: { type: 'string' },
          explanation: { type: 'string' },
          previousWasDefensible: { type: 'boolean' },
        },
        required: ['type', 'severity', 'quote', 'explanation', 'previousWasDefensible'],
        additionalProperties: false,
      },
    },
    suggested: { type: 'string' },
    summary: { type: 'string' },
    score: { type: 'integer' },
  },
  required: ['issues', 'suggested', 'summary', 'score'],
  additionalProperties: false,
};
interface Version { text: string; explanation: string; score: number }
interface Issue { type: string; severity: string; quote: string; explanation: string; previousWasDefensible: boolean }
interface Review { issues: Issue[]; suggested: string; summary: string; score: number }

const TASKS: Record<Kind, { what: string; rules: string }> = {
  modernize: {
    what: 'en modernisering av et avsnitt fra en norsk bibelkommentar fra 1937 (Sigurd Odland, Romerbrevet) til dagens bokmål',
    rules: `- Moderniseringen skal bare bytte gammel rettskrivning, gamle ord og bøyninger. Innholdet, henvisningene og sitatene skal være identiske med kilden.
- Rapportér som feil: innhold som er lagt til, fjernet eller forskjøvet; henvisninger eller sitater som avviker fra kilden; gammel form som står igjen (noget, kunde, hvad, sig, mellem, efter, blev, ennu, ti = for, kun, meget, tillike, jvfr.); OCR-feil som ikke er rettet.
- Ikke foreslå omskriving av setningsbygning som fungerer på moderne norsk.`,
  },
  translate_en: {
    what: 'en oversettelse av en versnote fra Jamieson, Fausset & Browns bibelkommentar (1871, engelsk) til dagens bokmål',
    rules: `- Rapportér som feil: meningsfeil, ord oversatt i feil betydning, grammatikk- og kjønnsfeil, unorsk setningsbygning, engelsk ordstilling.
- Bibelhenvisningene skal være nøyaktig de samme stedene som i kilden, skrevet på norsk vis (Is 34:11 → Jes 34,11; Ro 5:20 → Rom 5,20). En henvisning som peker på et annet sted enn kilden er en kritisk feil.
- Oppslagsordene i fet skrift (**...--**) skal beholdes som struktur, og siteres på norsk.
- Ikke moderniser eller mildne forfatterens synspunkter.`,
  },
  translate_de: {
    what: 'en oversettelse av et avsnitt fra Keil & Delitzsch, Biblischer Commentar über das Alte Testament (1866, tysk, OCR fra gammel trykk) til dagens bokmål',
    rules: `- Rapportér som feil: meningsfeil, mistede distinksjoner, grammatikk- og kjønnsfeil, unorsk setningsbygning.
- Hebraisk og gresk i kilden er ødelagt av OCR. I oversettelsen skal slike ord stå som [hebr.] eller [gresk], aldri som OCR-søppel (m&r72, &v &oy7], MERN, YIRYT ım). Søppel som står igjen er en feil.
- Bibelhenvisningene skal være de samme stedene som i kilden, på norsk vis (Ex. 15,5 → 2 Mos 15,5; Hi. → Job; Jes. → Jes; Sap. → Visd).
- Ikke moderniser eller mildne forfatterens synspunkter.`,
  },
};

function reviewPrompt(kind: Kind, source: string, current: string, versions: Version[]): string {
  const t = TASKS[kind];
  const history = versions.length
    ? `\nTIDLIGERE VERSJONER (${versions.length}) — foreslå ALDRI tekst som er lik eller nesten lik noen av disse:\n` +
      versions.map((v, i) => `${i + 1}. (score ${v.score}) «${v.text}»\n   Grunn til endring: ${v.explanation}`).join('\n')
    : '';
  return `Du er korrekturleser for ${t.what}. Du får kilden og den gjeldende gjengivelsen.

Vurder gjengivelsen mot kilden og finn:
- feil og unøyaktigheter
- klosset eller unorsk språk
- innhold som mangler eller er lagt til
- grammatikk- og stavefeil

Regler for denne oppgaven:
${t.rules}

Sett «previousWasDefensible» for hvert funn: true hvis den gjeldende formuleringen var en gyldig måte å gjengi kilden på, false hvis den var feil, ugrammatisk eller la til/fjernet innhold.

VIKTIG:
- «suggested» skal inneholde HELE den rettede teksten, ikke bare den endrede frasen. Er det ingen funn, skal «suggested» være identisk med gjeldende gjengivelse.
- Ikke gjør om på det som er riktig. Bare det funnene gjelder.
- Er teksten allerede god, returner tom issues-liste.
- Sett score fra 0 til 10, der 10 betyr at gjengivelsen er trofast og leser godt uten noe igjen å forbedre. Bruk bare 0–10-skalaen.
${history}

KILDE:
${source}

GJELDENDE GJENGIVELSE:
${current}`;
}

// ---------- run ----------
console.log(`model ${MODEL} via ${useClaude ? 'Anthropic API' : 'Ollama'} → <sample>/${TAG}.*`);
for (const sample of samples) {
  const dir = path.join(DIR, sample);
  const kind = fs.readFileSync(path.join(dir, 'kind'), 'utf8').trim() as Kind;
  const source = fs.readFileSync(path.join(dir, 'source.txt'), 'utf8');

  let t0 = Date.now();
  let current = (await ask(FIRST[kind](source))).trim();
  fs.writeFileSync(path.join(dir, `${TAG}.first.txt`), current + '\n');
  console.log(`${sample} first pass: ${source.length} → ${current.length} chars, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  if (flags['skip-proof']) continue;

  const versions: Version[] = [];
  const log: string[] = [];
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    t0 = Date.now();
    let r: Review;
    try {
      r = JSON.parse(await ask(reviewPrompt(kind, source, current, versions), SCHEMA));
    } catch (e) {
      const msg = (e as Error).message;
      log.push(`--- round ${round}: FAILED after ${((Date.now() - t0) / 1000).toFixed(0)}s — ${msg}`);
      console.log(`${sample} round ${round}: failed — ${msg}`);
      break;
    }
    const secs = ((Date.now() - t0) / 1000).toFixed(0);
    const score = r.score > 10 ? Math.round(r.score / 10) : r.score;
    log.push(`--- round ${round}: score ${score}/10, ${r.issues.length} findings, ${secs}s — ${r.summary}`);
    for (const i of r.issues) log.push(`  [${i.severity}/${i.type}${i.previousWasDefensible ? '' : ', not defensible'}] «${i.quote}» — ${i.explanation}`);
    let changed = false;
    if (r.issues.length && r.suggested && r.suggested.trim() !== current) {
      const ratio = r.suggested.trim().length / current.length;
      if (ratio < MIN_LENGTH_RATIO) {
        log.push(`  suggestion rejected: ${Math.round(ratio * 100)} % of current length — probably truncated`);
      } else {
        versions.push({ text: current, explanation: r.issues.map(i => i.explanation).join(' | '), score });
        current = r.suggested.trim();
        changed = true;
      }
    }
    console.log(`${sample} round ${round}: score ${score}, ${r.issues.length} findings, ${changed ? 'changed' : 'unchanged'}, ${secs}s`);
    if (!changed || score >= MIN_SCORE) break;
  }
  fs.writeFileSync(path.join(dir, `${TAG}.proof.txt`), current + '\n');
  fs.writeFileSync(path.join(dir, `${TAG}.proof.log`), log.join('\n') + '\n');
}
