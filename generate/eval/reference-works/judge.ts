#!/usr/bin/env bun
/**
 * Blind comparison of finished renderings: one judge model sees the source and the
 * `<model>.proof.txt` of each candidate under shuffled labels A, B, C…, lists meaning errors
 * and language problems per rendering, scores 0–10 and ranks them. The labels are mapped back
 * afterwards, so the judge never knows which model wrote what — which matters when a model
 * would otherwise be judging its own output.
 *
 * Usage:
 *   bun generate/eval/reference-works/judge.ts --judge claude-fable-5-1 \
 *     --models claude-opus-5,claude-fable-5-1,claude-opus-5-5 --out judge-opus-5-5.json
 *
 * Run it more than once: the shuffle changes the order each time, and a verdict that flips
 * between runs is a tie, not a win.
 *
 * 2026-09-23, judge claude-fable-5-1, four runs (two kept as judge-opus-5-5.run*.json):
 * Opus 5.5 first in kd-gen1_1, kd-gen1_2 and odland-rom5_20-21 every time, Fable 5.1 first in
 * jfb-rom5_20 every time and in jfb-gen1_2 three of four, Opus 5 last in 19 of 20.
 */
import '../../env.js';
import { call } from '../../llm.js';
import { parseArgs, formatHelp, COMMON_FLAGS } from '../../cli.js';
import type { FlagSpec } from '../../cli.js';
import fs from 'fs';
import path from 'path';

const DIR = import.meta.dir;

const SPEC: Record<string, FlagSpec> = {
  judge: { kind: 'string', default: 'claude-fable-5-1', help: 'Anthropic model that judges' },
  models: { kind: 'string', help: 'comma-separated output tags to compare (<sample>/<tag>.proof.txt)' },
  out: { kind: 'string', help: 'result file, written in this directory' },
  help: COMMON_FLAGS.help,
};

const { flags } = parseArgs(process.argv.slice(2), SPEC);
if (flags.help) { console.log(formatHelp('generate/eval/reference-works/judge.ts', 'Blind judge: rank finished renderings of the reference-work samples.', SPEC)); process.exit(0); }
if (!flags.models || !flags.out) { console.error('--models and --out are required'); process.exit(1); }
const JUDGE = flags.judge as string;
// constants.ts reads ANTHROPIC_MODEL on import; re-run with it set, as run.ts does.
if (process.env.ANTHROPIC_MODEL !== JUDGE) {
  const child = Bun.spawnSync([process.execPath, ...process.argv.slice(1)], {
    env: { ...process.env, ANTHROPIC_MODEL: JUDGE }, stdout: 'inherit', stderr: 'inherit',
  });
  process.exit(child.exitCode ?? 1);
}
const MODELS = (flags.models as string).split(',').map(s => s.trim());
const LABELS = MODELS.map((_, i) => String.fromCharCode(65 + i));

const SCHEMA = {
  type: 'object',
  properties: {
    renderings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          meaningErrors: { type: 'array', items: { type: 'string' } },
          languageProblems: { type: 'array', items: { type: 'string' } },
          score: { type: 'integer' },
        },
        required: ['label', 'meaningErrors', 'languageProblems', 'score'],
        additionalProperties: false,
      },
    },
    ranking: { type: 'array', items: { type: 'string' } },
    reason: { type: 'string' },
  },
  required: ['renderings', 'ranking', 'reason'],
  additionalProperties: false,
};
interface Verdict {
  renderings: { label: string; meaningErrors: string[]; languageProblems: string[]; score: number }[];
  ranking: string[];
  reason: string;
}

const TASK: Record<string, string> = {
  modernize: 'modernisering til dagens bokmål av en norsk bibelkommentar fra 1937. Omskriving er lov så lenge innholdet er riktig forstått og bevart.',
  translate_en: 'oversettelse til dagens bokmål av en bibelkommentar (engelsk, 1871).',
  translate_de: 'oversettelse til dagens bokmål av en bibelkommentar (tysk, 1866, OCR med ødelagt hebraisk/gresk).',
};

function shuffle<T>(a: T[]): T[] {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; }
  return r;
}

const samples = fs.readdirSync(DIR).filter(n => fs.existsSync(path.join(DIR, n, 'source.txt'))).sort();
const results = [];
for (const sample of samples) {
  const kind = fs.readFileSync(path.join(DIR, sample, 'kind'), 'utf8').trim();
  const source = fs.readFileSync(path.join(DIR, sample, 'source.txt'), 'utf8');
  const order = shuffle(MODELS);
  const texts = order.map((m, i) => `GJENGIVELSE ${LABELS[i]}:\n${fs.readFileSync(path.join(DIR, sample, `${m}.proof.txt`), 'utf8')}`).join('\n\n');
  const prompt = `Du er fagfellevurderer. Oppgaven var en ${TASK[kind]}

Vurder hver gjengivelse mot kilden. List konkrete meningsfeil (innhold endret, lagt til, fjernet, feil henvisning, feil forståelse av et ord) og språkproblemer (unorsk, klosset, gammelmodig, stavefeil). Vær presis og siter. Gi hver en score 0–10 og ranger dem fra best til dårligst.

KILDE:
${source}

${texts}`;
  const v: Verdict = JSON.parse(await call(prompt, { schema: SCHEMA, local: false }));
  const byLabel = Object.fromEntries(order.map((m, i) => [LABELS[i], m]));
  const renderings = v.renderings
    .filter(r => byLabel[r.label])
    .map(r => ({ model: byLabel[r.label], score: r.score, meaningErrors: r.meaningErrors, languageProblems: r.languageProblems }));
  const ranking = v.ranking.map(l => byLabel[l]).filter(Boolean);
  results.push({ sample, ranking, renderings, reason: v.reason });
  console.log(`${sample}: ${ranking.join(' > ')}  (${renderings.map(r => `${r.model}=${r.score}`).join(', ')})`);
}
fs.writeFileSync(path.join(DIR, flags.out as string), JSON.stringify({ judge: JUDGE, models: MODELS, results }, null, 2) + '\n');
