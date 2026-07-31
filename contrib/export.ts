#!/usr/bin/env bun
// Eksporterer GODKJENTE contrib-innsendinger til kuratert data:
// generate/verse_works/<workId>.json — språknøytral, flat katalog (som
// generate/mappings/). bibel-importøren leser denne inn i works/
// work_verse_refs-tabellene.
//
// PII-regler (fra skjemaet): where.quote publiseres ALDRI (opphavsrett);
// raw/context_translation er interne og eksporteres ikke; navn tas med kun
// når credit=true. user_id forlater aldri frontend-databasen (står ikke i
// køfila på eksporterbar form utover submitted.by — som ikke eksporteres).
//
//   npx tsx contrib/export.mjs [--lookup]
//
// --lookup henter tittel/forfattere/år fra Crossref (DOI) / OpenLibrary (ISBN)
// og overstyrer freetext-metadataene.

import * as fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';
import type {ContribDoc, ContribFreetext, ContribKind, ContribTarget, CrossrefAuthor} from './contrib-types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const QUEUE_DIR = path.join(__dirname, 'queue');
const ARCHIVE_DIR = path.join(QUEUE_DIR, 'archive');
const OUT_DIR = path.join(__dirname, '..', 'generate', 'verse_works');

const doLookup = process.argv.includes('--lookup');
const UA = 'free-bible-contrib/1.0 (https://github.com/flogvit/free-bible; mailto:flogvit@gmail.com)';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Samme id-regel som articles/harvest.mjs.
const doiToId = (doi: string) => doi.toLowerCase().trim()
  .replace(/^https?:\/\/(dx\.)?doi\.org\//, '')
  .replace(/\//g, '_');

function slugify(text: string): string {
  return text.toLowerCase()
    .replace(/æ/g, 'ae').replace(/ø/g, 'o').replace(/å/g, 'a')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function workIdFor(kind: ContribKind, target: ContribTarget): string | null {
  if (target.catalog_id) return target.catalog_id;
  if (target.doi) return doiToId(target.doi);
  if (target.isbn13) return target.isbn13;
  if (target.isbn10) return target.isbn10;
  if (target.openlibrary_id) return target.openlibrary_id;
  if (kind === 'song_verse_refs') {
    // Sanger mangler global id: free-bible-katalogens song-NNNN, ellers slug
    // av tittel+artist (sang-prefiks saa navnerommet ikke krasjer med song-NNNN).
    if (target.song_id) return target.song_id;
    const title = target.freetext?.title;
    if (title) {
      const artist = target.freetext?.authors?.[0];
      return 'sang-' + slugify(artist ? `${title}-${artist}` : title);
    }
  }
  return null;
}

/**
 * Metadata slått opp mot Crossref/OpenLibrary. Alt er valgfritt: oppslaget er
 * best-effort, og tomt objekt betyr at freetext-feltene får stå.
 */
interface LookedUpMetadata {
  title?: string;
  authors?: string[];
  year?: number;
  container?: string;
}

async function lookupMetadata(target: ContribTarget): Promise<LookedUpMetadata> {
  try {
    if (target.doi) {
      const res = await fetch(
        `https://api.crossref.org/works/${encodeURIComponent(target.doi)}?mailto=flogvit@gmail.com`,
        {headers: {'user-agent': UA}},
      );
      await sleep(1100);
      if (res.ok) {
        const {message} = await res.json();
        return {
          title: (message.title ?? [])[0],
          authors: (message.author ?? []).map((a: CrossrefAuthor) => `${a.given ?? ''} ${a.family ?? ''}`.trim()).filter(Boolean),
          year: message['published']?.['date-parts']?.[0]?.[0],
          container: (message['container-title'] ?? [])[0],
        };
      }
    }
    if (target.isbn13 || target.isbn10) {
      const res = await fetch(`https://openlibrary.org/isbn/${target.isbn13 || target.isbn10}.json`,
        {headers: {'user-agent': UA}});
      await sleep(1100);
      if (res.ok) {
        const book = await res.json();
        const yearMatch = String(book.publish_date ?? '').match(/\d{4}/);
        return {
          title: book.title,
          year: yearMatch ? parseInt(yearMatch[0], 10) : undefined,
          container: (book.publishers ?? [])[0],
        };
      }
    }
  } catch {
    // Metadata-oppslag er best-effort; freetext-feltene står seg.
  }
  return {};
}

function approvedDocs(): {name: string; doc: ContribDoc}[] {
  const docs = [];
  for (const dir of [QUEUE_DIR, ARCHIVE_DIR]) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!/^\d+\.json$/.test(name)) continue;
      const doc = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
      if (doc.review?.status === 'approved') docs.push({name, doc});
    }
  }
  return docs;
}

const docs = approvedDocs();
if (!docs.length) {
  console.log('contrib-export: ingen godkjente innsendinger i køen.');
  process.exit(0);
}
fs.mkdirSync(OUT_DIR, {recursive: true});

let exported = 0;
for (const {name, doc} of docs) {
  const workId = workIdFor(doc.kind, doc.target ?? {});
  if (!workId) {
    console.error(`  ! ${name}: approved uten konkret target-id — skulle vært stoppet av approve-vakten`);
    continue;
  }

  const unresolved = (doc.refs ?? []).filter((r) => !Number.isInteger(r.kvnFrom));
  if (unresolved.length) {
    console.error(`  ! ${name}: ${unresolved.length} uoppløste refs — hopper over`);
    continue;
  }

  const outFile = path.join(OUT_DIR, `${workId}.json`);
  const existing = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : null;

  // Eksporterbare refs: kun kanonisk spenn + kind + side/seksjon. ALDRI quote,
  // raw eller context_translation.
  const newRefs = (doc.refs ?? []).map((r) => ({
    kvnFrom: r.kvnFrom,
    kvnTo: r.kvnTo,
    ...(r.kvnRef ? {kvnRef: r.kvnRef} : {}),
    kind: r.kind,
    ...(r.where?.page || r.where?.chapter_or_section
      ? {where: {
          ...(r.where.page ? {page: r.where.page} : {}),
          ...(r.where.chapter_or_section ? {chapter_or_section: r.where.chapter_or_section} : {}),
        }}
      : {}),
  }));

  const refKey = (r: {kvnFrom?: number; kvnTo?: number; kind?: string}) => `${r.kvnFrom}-${r.kvnTo}-${r.kind}`;
  const mergedRefs = [...(existing?.refs ?? [])];
  const seen = new Set(mergedRefs.map(refKey));
  for (const ref of newRefs) {
    if (!seen.has(refKey(ref))) {
      mergedRefs.push(ref);
      seen.add(refKey(ref));
    }
  }

  const contributors = new Set(existing?.contributors ?? []);
  if (doc.submitted?.by?.credit && doc.submitted.by.name) contributors.add(doc.submitted.by.name);

  const freetext: Partial<ContribFreetext> = doc.target?.freetext ?? {};
  const looked: LookedUpMetadata = doLookup ? await lookupMetadata(doc.target ?? {}) : {};
  const meta = {
    title: looked.title ?? existing?.title ?? freetext.title,
    authors: looked.authors ?? existing?.authors ?? freetext.authors,
    year: looked.year ?? existing?.year ?? freetext.year,
    container: looked.container ?? existing?.container ?? freetext.publisher_or_journal,
  };

  const target: ContribTarget = {};
  if (doc.target?.doi) target.doi = doc.target.doi;
  if (doc.target?.song_id) target.song_id = doc.target.song_id;
  if (doc.target?.isbn13) target.isbn13 = doc.target.isbn13;
  if (doc.target?.isbn10) target.isbn10 = doc.target.isbn10;
  if (doc.target?.openlibrary_id) target.openlibrary_id = doc.target.openlibrary_id;
  if (doc.target?.url) target.url = doc.target.url;

  const out = {
    id: workId,
    kind: doc.kind === 'book_verse_refs' ? 'book' : doc.kind === 'song_verse_refs' ? 'song' : 'article',
    target: Object.keys(target).length ? target : (existing?.target ?? {}),
    ...(meta.title ? {title: meta.title} : {}),
    ...(meta.authors?.length ? {authors: meta.authors} : {}),
    ...(meta.year ? {year: meta.year} : {}),
    ...(meta.container ? {container: meta.container} : {}),
    refs: mergedRefs,
    ...(contributors.size ? {contributors: [...contributors].sort()} : {}),
    updated: new Date().toISOString(),
  };

  fs.writeFileSync(outFile, JSON.stringify(out, null, 2) + '\n');
  exported++;
  console.log(`${name} → generate/verse_works/${workId}.json (${mergedRefs.length} refs)`);
}

console.log(`contrib-export: ${exported}/${docs.length} eksportert til ${OUT_DIR}`);
