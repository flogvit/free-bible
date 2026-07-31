#!/usr/bin/env bun
import "../generate/env.js";
// Review av contrib-køfiler. Mennesket setter status; LLM-en gir bare en
// anbefaling i review.note (skjemaets regel: alt menneske-reviewes).
//
//   bun contrib/review.ts --list
//   bun contrib/review.ts --llm [--id <id>]        # Claude-anbefaling → note
//   bun contrib/review.ts --approve --id <id> [--note "…"]
//   bun contrib/review.ts --reject  --id <id> [--note "…"]
//   bun contrib/review.ts --needs-info --id <id> --note "spørsmål til bidragsyter"
//
// Approve-vakt (fra skjemaet): hver ref må ha kvnFrom/kvnTo, og target må ha
// en konkret id (catalog_id/doi/isbn/openlibrary_id — freetext/url er ikke nok).

import * as fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';
import {callWithRetry} from '../generate/llm.js';
import type {ContribDoc} from './contrib-types.js';
import {parseArgs, formatHelp, COMMON_FLAGS} from '../generate/cli.js';
import type {FlagSpec} from '../generate/cli.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const QUEUE_DIR = path.join(__dirname, 'queue');

const SPEC: Record<string, FlagSpec> = {
  list: {kind: 'boolean', help: 'list køen: id, status, type, antall refs og target'},
  llm: {kind: 'boolean', help: 'la Claude skrive en anbefaling i review.note — setter aldri status'},
  approve: {kind: 'boolean', help: 'sett status approved (krever --id)'},
  reject: {kind: 'boolean', help: 'sett status rejected (krever --id)'},
  'needs-info': {kind: 'boolean', help: 'sett status needs_info (krever --id og --note)'},
  id: {kind: 'string', help: 'kø-id å jobbe på (contrib/queue/<id>.json)'},
  note: {kind: 'string', help: 'notat som lagres i review.note'},
  help: COMMON_FLAGS.help,
};

// Hjelpen skal ut FØR .env leses og før køen røres: `--help` skal aldri gjøre
// filesystem- eller nettverksarbeid.
const {flags} = parseArgs(process.argv.slice(2), SPEC);
if (flags.help) {
  console.log(formatHelp(
    'contrib/review.ts',
    'review av contrib-køfiler: mennesket setter status, LLM-en gir bare en anbefaling i review.note',
    SPEC,
    [
      'bun contrib/review.ts --list',
      'bun contrib/review.ts --llm --id 42',
      'bun contrib/review.ts --approve --id 42 --note "sjekket mot Crossref"',
      'bun contrib/review.ts --needs-info --id 42 --note "hvilken utgave?"',
    ],
  ));
  process.exit(0);
}


const onlyId = (flags.id as string | undefined) ?? null;
const note = (flags.note as string | undefined) ?? null;

function queueFiles() {
  if (!fs.existsSync(QUEUE_DIR)) return [];
  return fs.readdirSync(QUEUE_DIR)
    .filter((name) => /^\d+\.json$/.test(name))
    .filter((name) => !onlyId || name === `${onlyId}.json`)
    .map((name) => path.join(QUEUE_DIR, name));
}

function load(file: string): ContribDoc {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function save(file: string, doc: ContribDoc): void {
  fs.writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
}

function targetSummary(doc: ContribDoc): string {
  const target = doc.target ?? {};
  return target.freetext?.title || target.doi || target.isbn13 || target.isbn10 ||
    target.openlibrary_id || target.url || target.catalog_id || '—';
}

function hasConcreteId(doc: ContribDoc): boolean {
  const target = doc.target ?? {};
  if (target.catalog_id || target.doi || target.isbn13 || target.isbn10 || target.openlibrary_id) return true;
  // Sanger har ingen global identifikator: katalog-id eller tittel (sluggeres
  // av export.ts) er det konkreteste som finnes.
  if (doc.kind === 'song_verse_refs') return !!(target.song_id || target.freetext?.title);
  return false;
}

// ---------------------------------------------------------------------------

if (flags.list) {
  for (const file of queueFiles()) {
    const doc = load(file);
    const refs = doc.refs ?? [];
    const unresolved = refs.filter((r) => !Number.isInteger(r.kvnFrom)).length;
    console.log(
      `${path.basename(file, '.json').padStart(6)}  ${String(doc.review?.status).padEnd(10)}` +
        `  ${doc.kind === 'book_verse_refs' ? 'bok     ' : doc.kind === 'song_verse_refs' ? 'sang    ' : 'artikkel'}` +
        `  refs=${refs.length} (${unresolved} uoppløst)  ${targetSummary(doc)}`,
    );
  }
  process.exit(0);
}

if (flags.llm) {
  /** Svarformen SCHEMA under krever av modellen. */
  interface LlmRecommendation {
    recommendation: 'approve' | 'reject' | 'needs_info';
    reasoning: string;
    note_to_contributor: string;
  }
  const SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['recommendation', 'reasoning', 'note_to_contributor'],
    properties: {
      recommendation: {enum: ['approve', 'reject', 'needs_info']},
      reasoning: {type: 'string'},
      note_to_contributor: {type: 'string', description: 'Kort, vennlig — tom streng hvis approve.'},
    },
  };
  for (const file of queueFiles()) {
    const doc = load(file);
    if (doc.review?.status !== 'pending') continue;
    const prompt = `Du er reviewer for free-bible sitt bidragssystem: brukere melder inn artikler/bøker/sanger
som omtaler bibelvers, og godkjente bidrag publiseres som vers→verk-lenker.

Vurder innsendingen under. Kriterier:
- Er verket reelt og identifiserbart (DOI/ISBN/katalog-id — eller løsbart fra fritekst)?
- Virker versreferansene rimelige for et slikt verk (kind: cites/discusses/covers_passage)?
- Uoppløste refs (mangler kvnFrom) må kunne løses av reviewer — er raw+context_translation nok?
- Spam/useriøst innhold avvises.

MASKINSJEKK-notatet nederst er deterministisk fasit (Crossref/OpenLibrary-oppslag og KVN-oppløsning).

Innsending:
${JSON.stringify(doc, null, 2)}`;
    const result = await callWithRetry(prompt, {schema: SCHEMA, context: `contrib ${path.basename(file)}`}) as LlmRecommendation;
    const line = `ANBEFALING (claude): ${result.recommendation} — ${result.reasoning}` +
      (result.note_to_contributor ? `\nForslag til note: ${result.note_to_contributor}` : '');
    doc.review.note = doc.review.note
      ? `${doc.review.note.replace(/\n?ANBEFALING \(claude\):[\s\S]*$/, '').trim()}\n${line}`
      : line;
    save(file, doc);
    console.log(`${path.basename(file)}: ${result.recommendation} — ${result.reasoning}`);
  }
  process.exit(0);
}

const verdict = flags.approve ? 'approved' : flags.reject ? 'rejected' : flags['needs-info'] ? 'needs_info' : null;
if (!verdict) {
  console.error('Bruk --list, --llm, eller --approve/--reject/--needs-info --id <id> [--note "…"] (--help for alle flagg)');
  process.exit(1);
}
if (!onlyId) {
  console.error('--id <id> er påkrevd for verdikt.');
  process.exit(1);
}
const file = path.join(QUEUE_DIR, `${onlyId}.json`);
if (!fs.existsSync(file)) {
  console.error(`Finner ikke ${file}`);
  process.exit(1);
}
const doc = load(file);

if (verdict === 'approved') {
  const unresolved = (doc.refs ?? []).filter((r) => !Number.isInteger(r.kvnFrom) || !Number.isInteger(r.kvnTo));
  if (unresolved.length) {
    console.error(`Kan ikke godkjenne: ${unresolved.length} ref(s) mangler kvnFrom/kvnTo:` +
      unresolved.map((r) => `\n  - «${r.raw}»`).join('') +
      '\nKjør contrib/check.ts eller fyll inn manuelt først.');
    process.exit(1);
  }
  if (!hasConcreteId(doc)) {
    console.error('Kan ikke godkjenne: target mangler konkret id (doi/isbn/openlibrary_id/catalog_id — for sang: song_id eller tittel).' +
      '\nSlå opp verket og legg inn id-en i target først.');
    process.exit(1);
  }
}
if (verdict === 'needs_info' && !note) {
  console.error('--needs-info krever --note med spørsmålet til bidragsyteren.');
  process.exit(1);
}

doc.review = {
  status: verdict,
  reviewer: 'flogvit',
  at: new Date().toISOString(),
  ...(note ? {note} : doc.review?.note ? {note: doc.review.note} : {}),
};
save(file, doc);
console.log(`${onlyId}.json → ${verdict}${note ? ` (${note})` : ''}`);
