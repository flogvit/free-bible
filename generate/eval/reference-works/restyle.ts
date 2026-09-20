#!/usr/bin/env bun
/**
 * Stylist pass: take a rendering another model already produced and rewrite it as natural
 * Norwegian, without the source in the prompt. This is the second stage of the staged local
 * pipeline — qwen translates the whole corpus, then a Norwegian-centric model rewrites the
 * Norwegian, then the mechanical checks run on source vs result.
 *
 * The source is deliberately NOT shown to the stylist. qwen's errors on this corpus are
 * dominated by Norwegian idiom, not comprehension («jorden var uten form og tom» for «øde og
 * tom», «Guds Ånd beveget» for «svevet», «scenen for en ny skapelse»), and those are fixable
 * from the Norwegian alone. A stylist that reads the source is translating again with a
 * weaker model. Content drift is caught afterwards by refcheck.py and worddiff.py against
 * the source, not by the stylist's own judgement.
 *
 * Layout (one directory per sample, as run.ts):
 *   <sample>/<from>.proof.txt                 input: the rendering to rewrite
 *   <sample>/<model>.restyle-of-<from>.txt    output
 *
 * Usage:
 *   bun generate/eval/reference-works/restyle.ts --model NbAiLab/borealis-instruct-preview:27b
 *   bun generate/eval/reference-works/restyle.ts --model LTG/normistral-11b-thinking:q8_0 --only jfb-gen1_2
 *   bun generate/eval/reference-works/restyle.ts --model ... --from claude-opus-5 --stage first
 *   bun generate/eval/reference-works/restyle.ts --list
 *
 * Then compare, per sample:
 *   python3 generate/eval/reference-works/refcheck.py <sample>/source.txt <sample>/<out>
 *   python3 generate/eval/reference-works/worddiff.py <sample>/<from>.proof.txt <sample>/<out>
 */
import '../../env.js';
import { call } from '../../llm.js';
import { parseArgs, formatHelp, COMMON_FLAGS } from '../../cli.js';
import type { FlagSpec } from '../../cli.js';
import fs from 'fs';
import path from 'path';

const DIR = import.meta.dir;
const NUM_PREDICT = 4000;

const SPEC: Record<string, FlagSpec> = {
  model: { kind: 'string', help: 'stylist model (Ollama tag); file names use it with "/" and ":" → "-"' },
  from: { kind: 'string', default: 'qwen3.5-122b', help: 'whose rendering to rewrite (file-name form)' },
  stage: { kind: 'string', default: 'proof', help: 'which rendering: proof | first' },
  only: { kind: 'string', help: 'run one sample directory only' },
  think: { kind: 'boolean', help: 'let the model think (default off; a thinking block is stripped either way)' },
  list: { kind: 'boolean', help: 'list samples and existing stylist outputs, then exit' },
  help: COMMON_FLAGS.help,
};

const { flags } = parseArgs(process.argv.slice(2), SPEC);
if (flags.help) {
  console.log(formatHelp('generate/eval/reference-works/restyle.ts',
    'Rewrite an existing rendering as natural Norwegian with a Norwegian-centric model.', SPEC));
  process.exit(0);
}

const FROM = flags.from as string;
const STAGE = flags.stage as string;
const INPUT = `${FROM}.${STAGE}.txt`;

const samples = fs.readdirSync(DIR)
  .filter(n => fs.existsSync(path.join(DIR, n, 'source.txt')))
  .filter(n => !flags.only || n === flags.only)
  .sort();

if (flags.list) {
  for (const s of samples) {
    const outputs = fs.readdirSync(path.join(DIR, s))
      .filter(f => f.includes('.restyle-of-'))
      .map(f => f.replace(/\.txt$/, ''));
    const has = fs.existsSync(path.join(DIR, s, INPUT)) ? INPUT : `(no ${INPUT})`;
    console.log(`${s}  ${has}  →  ${outputs.join(', ') || '(no stylist output)'}`);
  }
  process.exit(0);
}
if (!flags.model) { console.error('--model is required'); process.exit(1); }
const MODEL = flags.model as string;
const TAG = MODEL.replace(/[/:]/g, '-');

const PROMPT = (current: string) => `Nedenfor står et avsnitt norsk prosa som er maskinoversatt eller modernisert fra en gammel bibelkommentar. Innholdet er riktig, men språket er stivt og bærer preg av kilden.

Skriv teksten om til god, naturlig norsk bokmålsprosa.

Regler:
- Innholdet skal være identisk. Ikke legg til, ikke fjern, ikke forklar, ikke forkort.
- Henvisninger står som de står: Jes 34,11 — Rom 5,20 — kap. 1,1 — § 277c — v. 12 — Gal. 3, 19. Ikke endre et tall, et boknavn eller en forkortelse.
- Alt som står i «» beholdes som sitat. Fet skrift etterfulgt av «--» er et oppslagsord som siterer bibelverset; behold både den fete skriften og «--».
- [hebr.] og [gresk] er plassholdere for ord OCR-en har ødelagt. La dem stå.
- Der teksten gjengir et bibelvers, bruk de norske bibeluttrykkene («øde og tom», «Guds Ånd svevet over vannet»).
- Behold forfatterens tone og synspunkter, også der de er daterte. Du retter språket, ikke saken.
- Svar bare med den omskrevne teksten. Ingen innledning, ingen kommentar, ingen forklaring.

Tekst:
${current}`;

/** Thinking models put reasoning in the text; keep only what comes after it. */
function stripThinking(text: string): { text: string; stripped: boolean } {
  const m = text.match(/<\/(?:think|thinking|reasoning)>/i);
  if (!m || m.index === undefined) return { text: text.trim(), stripped: false };
  return { text: text.slice(m.index + m[0].length).trim(), stripped: true };
}

console.log(`stylist ${MODEL} over ${INPUT} → <sample>/${TAG}.restyle-of-${FROM}.txt\n`);

for (const sample of samples) {
  const inPath = path.join(DIR, sample, INPUT);
  if (!fs.existsSync(inPath)) { console.log(`${sample}: no ${INPUT}, skipped`); continue; }
  const current = fs.readFileSync(inPath, 'utf8').trim();

  const started = Date.now();
  const raw = await call(PROMPT(current), {
    local: true, model: MODEL, think: !!flags.think,
    ollamaOptions: { num_predict: NUM_PREDICT },
  });
  const { text, stripped } = stripThinking(raw);
  const secs = ((Date.now() - started) / 1000).toFixed(0);

  const outPath = path.join(DIR, sample, `${TAG}.restyle-of-${FROM}.txt`);
  fs.writeFileSync(outPath, text + '\n');
  const ratio = (text.length / current.length).toFixed(2);
  console.log(`${sample}: ${current.length} → ${text.length} tegn (${ratio}×), ${secs} s${stripped ? ', tenkeblokk fjernet' : ''}`);
}
