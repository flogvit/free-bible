#!/usr/bin/env bun
// Maskinsjekk av contrib-køfiler (contrib/queue/*.json, free-bible-contrib/1):
//
//   1. strukturvalidering mot kontrakten (håndrullet — ingen ajv-avhengighet)
//   2. ref-oppløsning: raw + context_translation → kanonisk KVN
//      (parseRef i oversettelsens nummerering → ukvn-mapping → osmain →
//       BIT-SHIFT-encode fra kvn/src/types.ts — ALDRI ukvnEncode-verdiene)
//   3. valgfritt target-oppslag (--target-lookup): Crossref for DOI,
//      OpenLibrary for ISBN — fasit for revieweren, skrives i review.note
//
// Funn skrives inn i selve fila (review.note under MASKINSJEKK:), status
// røres aldri — det er reviewerens (menneskets) jobb via review.mjs.
//
// Kjøres under tsx pga. kvn-TS-importene:
//   npx tsx contrib/check.mjs [--id <id>] [--target-lookup]

import * as fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';
import {parseRef} from '../kvn/src/kvn.js';
import type {VerseRef} from '../kvn/src/kvn.js';
import {encode, decode, BOOK_IDS, BOOK_NAMES} from '../kvn/src/types.js';
import {loadUkvnMapping, UkvnMapper, ukvnEncode, ukvnDecode, resolveMappingId} from '../kvn/src/ukvn.js';
import {getMaxVerse} from '../kvn/src/load-bible.js';
import type {ContribDoc, ContribRef, ContribTarget, CrossrefAuthor} from './contrib-types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const QUEUE_DIR = path.join(__dirname, 'queue');

// Selvtest av kodings-regelen før noe annet: Esra 3:1 må være 15740944
// (bit-shift). Går denne i stykker, er importen feil og alt ville blitt galt.
if (encode(15, 3, 1, 0) !== 15740944) {
  console.error('SELVTEST FEILET: encode(15,3,1) ≠ 15740944 — feil KVN-koding importert.');
  process.exit(1);
}

const args = process.argv.slice(2);
const onlyId = args.includes('--id') ? args[args.indexOf('--id') + 1] : null;
const doLookup = args.includes('--target-lookup');

const KINDS = ['article_verse_refs', 'book_verse_refs', 'song_verse_refs'];
const REF_KINDS = ['cites', 'discusses', 'covers_passage'];
const STATUSES = ['pending', 'needs_info', 'approved', 'rejected'];
const TARGET_KEYS = ['catalog_id', 'doi', 'isbn13', 'isbn10', 'openlibrary_id', 'song_id', 'url', 'freetext'];
const REF_KEYS = ['raw', 'context_translation', 'kvnFrom', 'kvnTo', 'kvnRef', 'resolved_by',
  'confirmed_by_contributor', 'kind', 'where'];

// Boknavn-normalisering: BOOK_IDS-nøklene (inkl. aliaser) case-insensitivt,
// pluss «1. Mos»-varianten med punktum etter tallet.
const BOOK_LOOKUP = new Map<string, number>();
for (const [name, id] of Object.entries(BOOK_IDS)) {
  BOOK_LOOKUP.set(name.toLowerCase(), id);
  BOOK_LOOKUP.set(name.toLowerCase().replace(/^(\d) /, '$1. '), id);
  BOOK_LOOKUP.set(name.toLowerCase().replace(/^(\d) /, '$1.'), id);
}

/** «1. Mos 4,5» / «Rom 3:23» → kanonisk parseRef-form («1 Mos 4,5»), eller null. */
function normalizeRaw(raw: string): {bookId: number; rest: string | null} | null {
  let text = raw.trim().replace(/\s+/g, ' ');
  // Kolon-notasjon → komma (samme grep som refMarkupToKvn).
  text = text.replace(/(\d):(\d)/g, '$1,$2');
  const match = text.match(/^(.+?)\s+(\d.*)$/);
  if (!match) {
    // Kan være en ren bokreferanse («Rom») — hele boken.
    const id = BOOK_LOOKUP.get(text.toLowerCase());
    return id ? {bookId: id, rest: null} : null;
  }
  const id = BOOK_LOOKUP.get(match[1].toLowerCase());
  if (!id) return null;
  return {bookId: id, rest: match[2]};
}

/** Løser én ref til kanonisk KVN-spenn. Kaster med forklaring ved feil. */
function resolveRef(ref: ContribRef): {kvnFrom: number; kvnTo: number; kvnRef: string} {
  const normalized = normalizeRaw(ref.raw);
  if (!normalized) throw new Error(`ukjent bok i «${ref.raw}»`);
  const {bookId, rest} = normalized;

  // Hele boken: 1,1 → siste kapittel, siste vers.
  let translationRefs: VerseRef[];
  if (rest === null) {
    const lastChapter = lastChapterOf(bookId);
    translationRefs = [
      {book: bookId, chapter: 1, verse: 1, part: 0},
      {book: bookId, chapter: lastChapter, verse: getMaxVerse(bookId, lastChapter), part: 0},
    ];
  } else {
    // maxVerse er osnb-versifisering (hebraisk/gresk) — riktig for os*-utgavene,
    // nær nok for hele-kapittel-spenn i andre; avvik fanges av revieweren.
    translationRefs = parseRef(`${BOOK_NAMES[bookId]} ${rest}`, {maxVerse: getMaxVerse});
  }
  if (!translationRefs.length) throw new Error(`tom oppløsning for «${ref.raw}»`);

  // Kontekst-oversettelsens nummerering → osmain via ukvn-mapping.
  const mappingId = resolveMappingId(ref.context_translation) ?? ref.context_translation;
  let mapper: UkvnMapper;
  try {
    mapper = new UkvnMapper(loadUkvnMapping(mappingId));
  } catch {
    throw new Error(`ingen ukvn-mapping for context_translation «${ref.context_translation}»`);
  }

  const canonical = translationRefs.map((r) => {
    const osmain = ukvnDecode(mapper.toKvn(ukvnEncode(r.book, r.chapter, r.verse, r.part)));
    return encode(osmain.book, osmain.chapter, osmain.verse, osmain.part);
  });
  canonical.sort((a, b) => a - b);
  const first = decode(canonical[0]);
  const last = decode(canonical[canonical.length - 1]);
  const kvnRef = rest === null
    ? BOOK_NAMES[bookId]
    : first.chapter === last.chapter && first.verse === last.verse
      ? `${BOOK_NAMES[first.book]} ${first.chapter},${first.verse}`
      : `${BOOK_NAMES[first.book]} ${first.chapter},${first.verse}–` +
        (first.chapter === last.chapter ? `${last.verse}` : `${last.chapter},${last.verse}`);
  return {kvnFrom: canonical[0], kvnTo: canonical[canonical.length - 1], kvnRef};
}

function lastChapterOf(bookId: number): number {
  let chapter = 1;
  while (true) {
    try {
      if (getMaxVerse(bookId, chapter + 1) > 0) chapter++;
      else break;
    } catch {
      break;
    }
  }
  return chapter;
}

/** Strukturvalidering — returnerer liste av problemer (tom = ok). */
function validateDoc(doc: ContribDoc): string[] {
  const problems: string[] = [];
  if (doc.schema !== 'free-bible-contrib/1') problems.push(`schema: ${doc.schema}`);
  if (!KINDS.includes(doc.kind)) problems.push(`kind: ${doc.kind}`);
  if (!doc.target || typeof doc.target !== 'object') problems.push('target mangler');
  else {
    for (const key of Object.keys(doc.target)) {
      if (!TARGET_KEYS.includes(key)) problems.push(`ukjent target-felt: ${key}`);
    }
    if (Object.keys(doc.target).length === 0) problems.push('target er tomt');
    if (doc.target.doi && !/^10\./.test(doc.target.doi)) problems.push(`ugyldig doi: ${doc.target.doi}`);
    if (doc.target.isbn13 && !/^97[89]\d{10}$/.test(doc.target.isbn13)) {
      problems.push(`ugyldig isbn13: ${doc.target.isbn13}`);
    }
    if (doc.target.freetext && !doc.target.freetext.title) problems.push('freetext uten title');
  }
  if (!Array.isArray(doc.refs) || doc.refs.length === 0) problems.push('refs mangler');
  else {
    doc.refs.forEach((ref, i) => {
      if (!ref.raw) problems.push(`ref #${i + 1}: raw mangler`);
      if (!ref.context_translation) problems.push(`ref #${i + 1}: context_translation mangler`);
      if (!REF_KINDS.includes(ref.kind)) problems.push(`ref #${i + 1}: kind ${ref.kind}`);
      for (const key of Object.keys(ref)) {
        if (!REF_KEYS.includes(key)) problems.push(`ref #${i + 1}: ukjent felt ${key}`);
      }
      if (ref.where?.quote && ref.where.quote.length > 300) problems.push(`ref #${i + 1}: quote >300`);
    });
  }
  if (!doc.submitted?.at || !doc.submitted?.by?.user_id) problems.push('submitted.at/by.user_id mangler');
  if (!STATUSES.includes(doc.review?.status)) problems.push(`review.status: ${doc.review?.status}`);
  return problems;
}

const UA = 'free-bible-contrib/1.0 (https://github.com/flogvit/free-bible; mailto:flogvit@gmail.com)';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function lookupTarget(target: ContribTarget): Promise<string[]> {
  const notes: string[] = [];
  try {
    if (target.doi) {
      const res = await fetch(
        `https://api.crossref.org/works/${encodeURIComponent(target.doi)}?mailto=flogvit@gmail.com`,
        {headers: {'user-agent': UA}},
      );
      if (res.ok) {
        const {message} = await res.json();
        const authors = (message.author ?? []).map((a: CrossrefAuthor) => `${a.given ?? ''} ${a.family ?? ''}`.trim());
        notes.push(
          `Crossref: «${(message.title ?? [])[0] ?? '?'}» — ${authors.join(', ') || '?'}` +
            ` (${message['published']?.['date-parts']?.[0]?.[0] ?? '?'}, ${(message['container-title'] ?? [])[0] ?? '?'})`,
        );
      } else {
        notes.push(`Crossref: ${res.status} for doi ${target.doi}`);
      }
      await sleep(1100);
    }
    if (target.isbn13 || target.isbn10) {
      const isbn = target.isbn13 || target.isbn10;
      const res = await fetch(`https://openlibrary.org/isbn/${isbn}.json`, {headers: {'user-agent': UA}});
      if (res.ok) {
        const book = await res.json();
        notes.push(`OpenLibrary: «${book.title ?? '?'}» (${book.publish_date ?? '?'})`);
      } else {
        notes.push(`OpenLibrary: ${res.status} for isbn ${isbn}`);
      }
      await sleep(1100);
    }
  } catch (error) {
    notes.push(`oppslag feilet: ${(error as Error).message}`);
  }
  return notes;
}

// ---------------------------------------------------------------------------

if (!fs.existsSync(QUEUE_DIR)) {
  console.log(`Ingen kø (${QUEUE_DIR} finnes ikke).`);
  process.exit(0);
}

const files = fs.readdirSync(QUEUE_DIR)
  .filter((name) => /^\d+\.json$/.test(name))
  .filter((name) => !onlyId || name === `${onlyId}.json`);

let checked = 0;
for (const name of files) {
  const file = path.join(QUEUE_DIR, name);
  const doc: ContribDoc = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (doc.review?.status !== 'pending') continue;
  checked++;

  const report: string[] = [];
  const problems = validateDoc(doc);
  if (problems.length) report.push(...problems.map((p) => `struktur: ${p}`));

  let resolved = 0;
  let unresolved = 0;
  for (const ref of doc.refs ?? []) {
    if (Number.isInteger(ref.kvnFrom) && Number.isInteger(ref.kvnTo)) {
      resolved++;
      continue;
    }
    try {
      const {kvnFrom, kvnTo, kvnRef} = resolveRef(ref);
      ref.kvnFrom = kvnFrom;
      ref.kvnTo = kvnTo;
      ref.kvnRef = kvnRef;
      ref.resolved_by = 'pipeline';
      resolved++;
    } catch (error) {
      unresolved++;
      report.push(`uoppløst «${ref.raw}» (${ref.context_translation}): ${(error as Error).message}`);
    }
  }

  if (doLookup && doc.target) {
    report.push(...(await lookupTarget(doc.target)));
  }

  const summary = `MASKINSJEKK ${new Date().toISOString().slice(0, 10)}: ` +
    `${resolved} oppløst, ${unresolved} uoppløst` +
    (report.length ? `\n- ${report.join('\n- ')}` : '');
  const existingNote = doc.review.note ? doc.review.note.replace(/\n?MASKINSJEKK [\s\S]*$/, '').trim() : '';
  doc.review.note = existingNote ? `${existingNote}\n${summary}` : summary;

  fs.writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
  console.log(`${name}: ${resolved} oppløst, ${unresolved} uoppløst${report.length ? ` — ${report.length} merknader` : ''}`);
}

console.log(`contrib-check: ${checked} pending-filer sjekket.`);
