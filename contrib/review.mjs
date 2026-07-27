#!/usr/bin/env node
// Review av contrib-køfiler. Mennesket setter status; LLM-en gir bare en
// anbefaling i review.note (skjemaets regel: alt menneske-reviewes).
//
//   npx tsx contrib/review.mjs --list
//   npx tsx contrib/review.mjs --llm [--id <id>]        # Claude-anbefaling → note
//   npx tsx contrib/review.mjs --approve --id <id> [--note "…"]
//   npx tsx contrib/review.mjs --reject  --id <id> [--note "…"]
//   npx tsx contrib/review.mjs --needs-info --id <id> --note "spørsmål til bidragsyter"
//
// Approve-vakt (fra skjemaet): hver ref må ha kvnFrom/kvnTo, og target må ha
// en konkret id (catalog_id/doi/isbn/openlibrary_id — freetext/url er ikke nok).

import * as fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';
import dotenv from 'dotenv';
import {callWithRetry} from '../generate/llm.js';

dotenv.config({path: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env'), quiet: true});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const QUEUE_DIR = path.join(__dirname, 'queue');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const onlyId = value('--id');
const note = value('--note');

function queueFiles() {
  if (!fs.existsSync(QUEUE_DIR)) return [];
  return fs.readdirSync(QUEUE_DIR)
    .filter((name) => /^\d+\.json$/.test(name))
    .filter((name) => !onlyId || name === `${onlyId}.json`)
    .map((name) => path.join(QUEUE_DIR, name));
}

function load(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function save(file, doc) {
  fs.writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
}

function targetSummary(doc) {
  const target = doc.target ?? {};
  return target.freetext?.title || target.doi || target.isbn13 || target.isbn10 ||
    target.openlibrary_id || target.url || target.catalog_id || '—';
}

function hasConcreteId(target) {
  return !!(target?.catalog_id || target?.doi || target?.isbn13 || target?.isbn10 || target?.openlibrary_id);
}

// ---------------------------------------------------------------------------

if (flag('--list')) {
  for (const file of queueFiles()) {
    const doc = load(file);
    const refs = doc.refs ?? [];
    const unresolved = refs.filter((r) => !Number.isInteger(r.kvnFrom)).length;
    console.log(
      `${path.basename(file, '.json').padStart(6)}  ${String(doc.review?.status).padEnd(10)}` +
        `  ${doc.kind === 'book_verse_refs' ? 'bok     ' : 'artikkel'}` +
        `  refs=${refs.length} (${unresolved} uoppløst)  ${targetSummary(doc)}`,
    );
  }
  process.exit(0);
}

if (flag('--llm')) {
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
    const prompt = `Du er reviewer for free-bible sitt bidragssystem: brukere melder inn artikler/bøker
som omtaler bibelvers, og godkjente bidrag publiseres som vers→verk-lenker.

Vurder innsendingen under. Kriterier:
- Er verket reelt og identifiserbart (DOI/ISBN/katalog-id — eller løsbart fra fritekst)?
- Virker versreferansene rimelige for et slikt verk (kind: cites/discusses/covers_passage)?
- Uoppløste refs (mangler kvnFrom) må kunne løses av reviewer — er raw+context_translation nok?
- Spam/useriøst innhold avvises.

MASKINSJEKK-notatet nederst er deterministisk fasit (Crossref/OpenLibrary-oppslag og KVN-oppløsning).

Innsending:
${JSON.stringify(doc, null, 2)}`;
    const result = await callWithRetry(prompt, {schema: SCHEMA, context: `contrib ${path.basename(file)}`});
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

const verdict = flag('--approve') ? 'approved' : flag('--reject') ? 'rejected' : flag('--needs-info') ? 'needs_info' : null;
if (!verdict) {
  console.error('Bruk --list, --llm, eller --approve/--reject/--needs-info --id <id> [--note "…"]');
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
      '\nKjør contrib/check.mjs eller fyll inn manuelt først.');
    process.exit(1);
  }
  if (!hasConcreteId(doc.target)) {
    console.error('Kan ikke godkjenne: target mangler konkret id (doi/isbn/openlibrary_id/catalog_id).' +
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
