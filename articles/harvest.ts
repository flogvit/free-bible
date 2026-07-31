#!/usr/bin/env bun
/**
 * Open-access article harvester for the article→verse linking project (issue #15).
 *
 * Harvests metadata + full text for openly licensed biblical-studies journals so
 * we can later parse them for Bible references (KVN) and link verses → articles.
 * We never republish article content; the frontend only links out via DOI/URL.
 *
 * Data lives in external/articles/ (GITIGNORED — must never be pushed):
 *   catalog.jsonl          one JSON line per article: the master catalog (all core
 *                          metadata incl. exact source URLs, license, file paths)
 *   meta/<shard>/<id>.json COMPLETE raw API responses (crossref/doaj/unpaywall)
 *                          + download provenance, so we never have to re-scrape
 *   pdf/<shard>/<id>.pdf   original PDF as downloaded
 *   text/<shard>/<id>.txt  extracted plain text (pdftotext) — parse this later
 *   state/harvest-state.json  per-journal incremental cursors
 *
 * <id> = DOI with '/' → '_' (lowercased), or doaj_<id> when no DOI exists.
 * <shard> = first 2 hex chars of sha256(id), 256 buckets.
 *
 * Usage:
 *   bun articles/harvest.ts meta   [--journal key] [--limit N] [--full]
 *   bun articles/harvest.ts pdf    [--journal key] [--limit N]
 *   bun articles/harvest.ts text   [--journal key] [--limit N]
 *   bun articles/harvest.ts all    [--journal key] [--limit N]
 *   bun articles/harvest.ts status
 *   bun articles/harvest.ts prune  [--journal key]   # delete PDFs whose text is
 *                                    # extracted (explicit user decision only)
 *
 * Text files keep pdftotext page breaks (\f) so a parser can locate the PDF page
 * of any match and deep-link via url_pdf#page=N. PDFs larger than maxPdfMb are
 * NOT downloaded but tracked as status=pdf_skipped_size with url+bytes, so they
 * can be fetched later by decision. Hosts that block bots (e.g. Silverchair for
 * TC) end up status=pdf_failed with pdf_last_error — metadata/links still work.
 *
 * All phases are idempotent + resumable: re-running skips what exists, and
 * `meta` runs incrementally (Crossref from-index-date since last run, minus 2
 * days of safety margin). Fetching NEW articles later = just run `all` again.
 * Journals are added by editing articles/journals.json.
 *
 * APIs (all free): Crossref (per-ISSN works), DOAJ (abstracts + fulltext links),
 * Unpaywall (legal OA PDF resolution). Polite: ~1 req/s + mailto identification.
 */
import fs from 'fs';
import { join, dirname } from 'path';
import { createHash } from 'crypto';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

import { parseArgs, formatHelp, COMMON_FLAGS } from '../generate/cli.js';
import type { FlagSpec, ParsedArgs } from '../generate/cli.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Flaggkontrakten kjører FØRST — før journals.json leses, før external/articles/
// røres, og før re-exec-en under. Ellers ville `--help` lest fil og startet en
// underprosess bare for å skrive ut en hjelpetekst.
const SPEC: Record<string, FlagSpec> = {
  journal: { kind: 'string', help: 'bare denne journalen (key i articles/journals.json)' },
  limit: COMMON_FLAGS.limit,
  full: { kind: 'boolean', help: 'full sveip i stedet for inkrementell — ignorer lastMetaRun' },
  help: COMMON_FLAGS.help,
};

let parsed: ParsedArgs;
try {
  parsed = parseArgs(process.argv.slice(2), SPEC);
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
const { flags, positional } = parsed;

const PHASES = ['meta', 'pdf', 'text', 'all', 'status', 'prune'];

if (flags.help) {
  console.log(formatHelp(
    'articles/harvest.ts',
    'høster metadata, PDF og tekst for åpent lisensierte bibelfaglige tidsskrifter (#15)',
    SPEC,
    [
      'bun articles/harvest.ts meta --journal ote --limit 50',
      'bun articles/harvest.ts all',
      'bun articles/harvest.ts status',
    ],
  ));
  console.log(`\nFase (første posisjonsargument): ${PHASES.join(' | ')}`);
  console.log('  prune sletter PDF-er som allerede er tekstuttrukket — bare etter eksplisitt beslutning.');
  process.exit(0);
}

// journals.ufs.ac.za and www.scielo.org.za (actat, ote, and doi.org links that
// redirect there) serve an incomplete TLS chain: the Sectigo intermediate is
// missing. curl chases it via the cert's AIA field, Node does not, so every
// fetch there dies with "unable to verify the first certificate" — which the
// PDF phase records as a normal failure and, after 3 attempts, locks the entry
// out for good. NODE_EXTRA_CA_CERTS is only read at startup, so re-exec once
// with the intermediate supplied. Without this the loss is silent.
const CA_CERT = join(__dirname, 'ca/sectigo-ovr36.pem');
if (!process.env.NODE_EXTRA_CA_CERTS && fs.existsSync(CA_CERT)) {
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, NODE_EXTRA_CA_CERTS: CA_CERT },
  });
  process.exit(r.status ?? 1);
}

const REPO = join(__dirname, '..');
const DATA = join(REPO, 'external/articles');
const CATALOG = join(DATA, 'catalog.jsonl');
const STATE_FILE = join(DATA, 'state/harvest-state.json');

const CONFIG: Config = JSON.parse(fs.readFileSync(join(__dirname, 'journals.json'), 'utf8'));
const { email, apiDelayMs, pdfDelayMs, maxPdfMb } = CONFIG.settings;
const UA = `free-bible-articles/1.0 (https://github.com/flogvit/free-bible; mailto:${email})`;

// ---------- types ----------
// Formene under beskriver JSON-en dette skriptet leser og skriver: journals.json,
// katalogen (catalog.jsonl), meta/<id>.json og de tre API-svarene. Bare feltene
// koden faktisk rører er med — API-ene returnerer atskillig mer, og hele råsvaret
// lagres uavkortet i meta/, så dette er et utvalg og ikke en full beskrivelse.

/** En journal i journals.json. */
interface Journal {
  key: string;
  name: string;
  issns: string[];
  enabled: boolean;
}

interface Config {
  settings: {
    email: string;
    apiDelayMs: number;
    pdfDelayMs: number;
    maxPdfMb: number;
  };
  journals: Journal[];
}

/**
 * `fetchJson` henger HTTP-statusen på feilen, slik at kallstedet kan skille
 * 404 (ISSN finnes ikke hos Crossref) fra alt annet.
 */
interface HttpError extends Error {
  status?: number;
}

interface FetchOpts {
  timeoutMs?: number;
  headers?: Record<string, string>;
}

type ArticleStatus =
  | 'meta_only'
  | 'no_oa'
  | 'pdf_ok'
  | 'pdf_failed'
  | 'pdf_skipped_size'
  | 'text_ok'
  | 'text_empty';

/** Relative stier under external/articles/ + integritetsdata for dem. */
interface ArticleFiles {
  pdf?: string;
  pdf_sha256?: string;
  pdf_bytes?: number;
  text?: string;
}

/** Én linje i catalog.jsonl. */
interface CatalogEntry {
  id: string;
  status: ArticleStatus;
  doi?: string | null;
  journal?: string;
  title?: string | null;
  authors?: string[];
  year?: number | null;
  venue?: string | null;
  publisher?: string | null;
  language?: string | null;
  license?: string | null;
  abstract?: string | null;
  oa_status?: string | null;
  url_doi?: string | null;
  url_landing?: string | null;
  url_fulltext_doaj?: string | null;
  url_pdf?: string;
  files?: ArticleFiles;
  text_pages?: boolean;
  pdf_attempts?: number;
  pdf_last_error?: string | null;
  pdf_skipped?: { url: string; bytes: number };
  pruned?: { ts: string; sha256?: string; bytes?: number };
}

interface CrossrefWork {
  DOI?: string;
  title?: string[];
  author?: { given?: string; family?: string }[];
  issued?: { 'date-parts'?: number[][] };
  'container-title'?: string[];
  publisher?: string;
  language?: string;
  license?: { URL?: string }[];
  abstract?: string;
  resource?: { primary?: { URL?: string } };
  URL?: string;
  link?: { URL?: string; 'content-type'?: string }[];
}

interface CrossrefResponse {
  message?: {
    items?: CrossrefWork[];
    'next-cursor'?: string;
  };
}

interface DoajBibjson {
  title?: string;
  year?: string | number;
  abstract?: string;
  identifier?: { type?: string; id?: string }[];
  author?: { name: string }[];
  journal?: { title?: string; language?: string[] };
  link?: { type?: string; url?: string }[];
}

interface DoajArticle {
  id?: string;
  bibjson?: DoajBibjson;
}

interface DoajResponse {
  total?: number;
  results?: DoajArticle[];
}

interface UnpaywallLocation {
  url_for_pdf?: string | null;
  url?: string | null;
  license?: string | null;
}

interface UnpaywallRecord {
  is_oa?: boolean;
  oa_status?: string | null;
  best_oa_location?: UnpaywallLocation | null;
  oa_locations?: UnpaywallLocation[];
}

/** meta/<shard>/<id>.json: råsvarene + nedlastingsproveniens. */
interface MetaRecord {
  id: string;
  doi?: string;
  journalKey?: string;
  sources: {
    crossref?: CrossrefWork;
    doaj?: DoajArticle;
    unpaywall?: UnpaywallRecord;
  };
  fetched: Record<string, string>;
  pdfDownload?: {
    url: string;
    ts: string;
    contentType: string | null;
    etag: string | null;
    lastModified: string | null;
    bytes: number;
    sha256: string;
  };
}

/** state/harvest-state.json: inkrementell markør per journal. */
interface HarvestState {
  journals: Record<string, { lastMetaRun?: string }>;
}

// ---------- helpers ----------
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const sha256 = (s: string | Uint8Array): string => createHash('sha256').update(s).digest('hex');
const shard = (id: string): string => sha256(id).slice(0, 2);
const doiToId = (doi: string): string => doi.toLowerCase().trim().replace(/^https?:\/\/(dx\.)?doi\.org\//, '').replace(/\//g, '_');
const decodeEntities = (s: string | null | undefined): string => (s || '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_: string, n: string) => String.fromCodePoint(+n)).replace(/&amp;/g, '&');
const stripXml = (s: string | null | undefined): string => decodeEntities(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const ensure = (p: string) => fs.mkdirSync(p, { recursive: true });

function metaPath(id: string): string { return join(DATA, 'meta', shard(id), `${id}.json`); }
function pdfPath(id: string): string { return join(DATA, 'pdf', shard(id), `${id}.pdf`); }
function textPath(id: string): string { return join(DATA, 'text', shard(id), `${id}.txt`); }

function loadMeta(id: string): MetaRecord {
  try { return JSON.parse(fs.readFileSync(metaPath(id), 'utf8')); } catch { return { id, sources: {}, fetched: {} }; }
}
function saveMeta(m: MetaRecord) {
  ensure(dirname(metaPath(m.id)));
  fs.writeFileSync(metaPath(m.id), JSON.stringify(m, null, 2) + '\n');
}

async function fetchWithRetry(url: string, opts: FetchOpts = {}, tries = 3): Promise<Response> {
  for (let i = 0; i < tries; i++) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 60000);
      const res = await fetch(url, { headers: { 'User-Agent': UA, ...(opts.headers || {}) }, signal: ctl.signal, redirect: 'follow' });
      clearTimeout(t);
      if (res.status === 429 || res.status >= 500) { await sleep(5000 * (i + 1) * (i + 1)); continue; }
      return res;
    } catch (e) {
      if (i === tries - 1) throw e;
      await sleep(5000 * (i + 1));
    }
  }
  throw new Error(`retries exhausted: ${url}`);
}
async function fetchJson<T = any>(url: string): Promise<T> {
  const res = await fetchWithRetry(url);
  if (!res.ok) { const err = new Error(`HTTP ${res.status} ${url}`) as HttpError; err.status = res.status; throw err; }
  return res.json();
}

// ---------- catalog ----------
const catalog = new Map<string, CatalogEntry>(); // id -> entry
function loadCatalog() {
  if (!fs.existsSync(CATALOG)) return;
  for (const line of fs.readFileSync(CATALOG, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const e: CatalogEntry = JSON.parse(line);
    catalog.set(e.id, e);
  }
}
let dirty = 0;
function flushCatalog(force = false) {
  if (!force && dirty === 0) return;
  const tmp = CATALOG + '.tmp';
  fs.writeFileSync(tmp, [...catalog.values()].map(e => JSON.stringify(e)).join('\n') + '\n');
  fs.renameSync(tmp, CATALOG);
  dirty = 0;
}
function upsert(id: string, patch: Partial<CatalogEntry>): CatalogEntry {
  const e: CatalogEntry = catalog.get(id) || { id, status: 'meta_only' };
  Object.assign(e, patch);
  catalog.set(id, e);
  if (++dirty >= 50) flushCatalog();
  return e;
}

// ---------- state ----------
function loadState(): HarvestState { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return { journals: {} }; } }
function saveState(s: HarvestState) { ensure(dirname(STATE_FILE)); fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2) + '\n'); }

// ---------- phase: meta ----------
async function harvestCrossref(j: Journal, since: string | null, limit: number | null): Promise<number> {
  let count = 0;
  for (const issn of j.issns) {
    let cursor: string | undefined = '*';
    while (true) {
      const filter = ['type:journal-article', since ? `from-index-date:${since}` : null].filter(Boolean).join(',');
      const url = `https://api.crossref.org/journals/${issn}/works?rows=100&cursor=${encodeURIComponent(cursor)}&filter=${filter}&mailto=${email}`;
      let data: CrossrefResponse;
      try { data = await fetchJson(url); }
      catch (e: any) { if (e.status === 404) { console.log(`  crossref: ISSN ${issn} not found, skipping`); break; } throw e; }
      const items = data.message?.items || [];
      for (const item of items) {
        if (!item.DOI) continue;
        const id = doiToId(item.DOI);
        const m = loadMeta(id);
        m.doi = item.DOI.toLowerCase();
        m.journalKey = j.key;
        m.sources.crossref = item; // full raw record
        m.fetched.crossref = new Date().toISOString();
        saveMeta(m);
        upsert(id, {
          doi: m.doi,
          journal: j.key,
          title: stripXml((item.title || [])[0]) || null,
          authors: (item.author || []).map(a => [a.given, a.family].filter(Boolean).join(' ')).filter(Boolean),
          year: item.issued?.['date-parts']?.[0]?.[0] ?? null,
          venue: (item['container-title'] || [])[0] || j.name,
          publisher: item.publisher || null,
          language: item.language || null,
          license: (item.license || [])[0]?.URL || null,
          abstract: stripXml(item.abstract) || catalog.get(id)?.abstract || null,
          url_doi: `https://doi.org/${m.doi}`,
          url_landing: item.resource?.primary?.URL || item.URL || null,
        });
        count++;
        if (limit && count >= limit) return count;
      }
      cursor = data.message?.['next-cursor'];
      if (!cursor || items.length === 0) break;
      await sleep(apiDelayMs);
    }
    await sleep(apiDelayMs);
  }
  return count;
}

// DOAJ caps deep paging at 1000 results per query (HTTP 400 beyond page 10).
// For journals with more articles we slice the query per publication year so
// every slice stays under the cap.
async function harvestDoaj(j: Journal, limit: number | null): Promise<number> {
  let count = 0;
  for (const issn of j.issns) {
    // probe total first
    let total = 0;
    try {
      const probe: DoajResponse = await fetchJson(`https://doaj.org/api/search/articles/${encodeURIComponent(`issn:"${issn}"`)}?page=1&pageSize=1`);
      total = probe.total ?? 0;
    } catch { /* fall through to plain sweep */ }
    await sleep(apiDelayMs);
    const queries: string[] = [];
    if (total > 1000) {
      const thisYear = new Date().getFullYear();
      for (let y = 1900; y <= thisYear; y++) queries.push(`issn:"${issn}" AND year:${y}`);
    } else {
      queries.push(`issn:"${issn}"`);
    }
    for (const query of queries) {
      const n = await doajSweep(query, j, limit ? limit - count : null);
      count += n;
      if (limit && count >= limit) return count;
    }
    await sleep(apiDelayMs);
  }
  return count;
}

async function doajSweep(query: string, j: Journal, limit: number | null): Promise<number> {
  let count = 0;
  let page = 1;
  while (true) {
    const url = `https://doaj.org/api/search/articles/${encodeURIComponent(query)}?page=${page}&pageSize=100`;
    let data: DoajResponse;
    try { data = await fetchJson(url); }
    catch (e: any) { console.log(`  doaj: "${query}" page ${page} failed (${e.message}), moving on`); break; }
    const results = data.results || [];
    {
      for (const r of results) {
        const bj = r.bibjson || {};
        const doi = (bj.identifier || []).find(x => x.type === 'doi')?.id;
        const id = doi ? doiToId(doi) : `doaj_${r.id}`;
        const m = loadMeta(id);
        if (doi) m.doi = doi.toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, '');
        m.journalKey = j.key;
        m.sources.doaj = r; // full raw record
        m.fetched.doaj = new Date().toISOString();
        saveMeta(m);
        const existing: Partial<CatalogEntry> = catalog.get(id) || {};
        upsert(id, {
          doi: m.doi || existing.doi || null,
          journal: j.key,
          title: existing.title || bj.title || null,
          authors: existing.authors?.length ? existing.authors : (bj.author || []).map(a => a.name).filter(Boolean),
          year: existing.year || (bj.year ? +bj.year : null),
          venue: existing.venue || bj.journal?.title || j.name,
          language: existing.language || (bj.journal?.language || [])[0] || null,
          abstract: existing.abstract || stripXml(bj.abstract) || null,
          url_doi: existing.url_doi || (m.doi ? `https://doi.org/${m.doi}` : null),
          url_landing: existing.url_landing || (bj.link || []).find(l => l.type === 'fulltext')?.url || null,
          url_fulltext_doaj: (bj.link || []).find(l => l.type === 'fulltext')?.url || existing.url_fulltext_doaj || null,
        });
        count++;
        if (limit && count >= limit) return count;
      }
    }
    const total = data.total ?? 0;
    const cap = Math.min(total, 1000); // DOAJ deep-paging cap
    if (page * 100 >= cap || results.length === 0) break;
    page++;
    await sleep(apiDelayMs);
  }
  return count;
}

// ---------- phase: pdf ----------
function pdfCandidates(entry: CatalogEntry, m: MetaRecord): string[] {
  const urls: string[] = [];
  const up = m.sources.unpaywall;
  if (up) {
    if (up.best_oa_location?.url_for_pdf) urls.push(up.best_oa_location.url_for_pdf);
    for (const loc of up.oa_locations || []) if (loc.url_for_pdf) urls.push(loc.url_for_pdf);
    if (up.best_oa_location?.url) urls.push(up.best_oa_location.url);
  }
  if (entry.url_fulltext_doaj) urls.push(entry.url_fulltext_doaj);
  for (const l of m.sources.crossref?.link || []) {
    if (l['content-type'] === 'application/pdf' && l.URL) urls.push(l.URL);
  }
  return [...new Set(urls)];
}

async function phasePdf(journalFilter: string | null, limit: number | null): Promise<number> {
  let done = 0;
  for (const entry of catalog.values()) {
    if (journalFilter && entry.journal !== journalFilter) continue;
    if (entry.files?.pdf) continue;
    if (entry.status === 'no_oa' || (entry.pdf_attempts || 0) >= 3) continue;
    if (limit && done >= limit) break;

    const m = loadMeta(entry.id);

    // 1. resolve via Unpaywall (once per article)
    if (entry.doi && !m.sources.unpaywall) {
      try {
        m.sources.unpaywall = await fetchJson<UnpaywallRecord>(`https://api.unpaywall.org/v2/${entry.doi}?email=${email}`);
        m.fetched.unpaywall = new Date().toISOString();
        saveMeta(m);
        upsert(entry.id, {
          oa_status: m.sources.unpaywall.oa_status || null,
          license: entry.license || m.sources.unpaywall.best_oa_location?.license || null,
        });
      } catch (e: any) {
        console.log(`  unpaywall miss ${entry.doi}: ${e.message}`);
      }
      await sleep(apiDelayMs);
    }

    // 2. try candidates until one is a real PDF
    const candidates = pdfCandidates(entry, m);
    if (candidates.length === 0) {
      upsert(entry.id, { status: m.sources.unpaywall?.is_oa === false ? 'no_oa' : entry.status, pdf_attempts: (entry.pdf_attempts || 0) + 1 });
      continue;
    }
    let saved = false;
    let sizeSkipped: { url: string; bytes: number } | null = null;
    let lastError: string | null = null;
    for (const url of candidates) {
      try {
        const res = await fetchWithRetry(url, { timeoutMs: 120000 }, 2);
        if (!res.ok) { lastError = `HTTP ${res.status} @ ${url}`; continue; }
        // size guard: track oversized ones so they can be fetched later by decision
        const cl = +(res.headers.get('content-length') || 0);
        if (cl > maxPdfMb * 1024 * 1024) { sizeSkipped = { url, bytes: cl }; break; }
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > maxPdfMb * 1024 * 1024) { sizeSkipped = { url, bytes: buf.length }; break; }
        if (!buf.subarray(0, 5).toString().startsWith('%PDF')) { lastError = `not a PDF @ ${url}`; continue; } // HTML landing page etc.
        ensure(dirname(pdfPath(entry.id)));
        // `as Uint8Array`: @types/node i node_modules erklærer Buffer slik at den
        // ikke regnes som tilordningsbar til ArrayBufferView. Ren typestøy.
        fs.writeFileSync(pdfPath(entry.id), buf as Uint8Array);
        m.pdfDownload = {
          url,
          ts: new Date().toISOString(),
          contentType: res.headers.get('content-type'),
          etag: res.headers.get('etag'),
          lastModified: res.headers.get('last-modified'),
          bytes: buf.length,
          sha256: sha256(buf as Uint8Array),
        };
        saveMeta(m);
        upsert(entry.id, {
          url_pdf: url,
          files: { ...(entry.files || {}), pdf: `pdf/${shard(entry.id)}/${entry.id}.pdf`, pdf_sha256: m.pdfDownload.sha256, pdf_bytes: buf.length },
          status: 'pdf_ok',
        });
        saved = true;
        done++;
        if (done % 25 === 0) console.log(`  pdf: ${done} downloaded...`);
        break;
      } catch (e: any) {
        lastError = `${e.message} @ ${url.slice(0, 100)}`;
        console.log(`  pdf fail ${entry.id}: ${lastError.slice(0, 140)}`);
      }
    }
    if (!saved) {
      if (sizeSkipped) {
        console.log(`  size-skipped (${(sizeSkipped.bytes / 1e6).toFixed(0)}MB > ${maxPdfMb}MB): ${entry.id}`);
        upsert(entry.id, { status: 'pdf_skipped_size', pdf_skipped: sizeSkipped });
      } else {
        upsert(entry.id, { pdf_attempts: (entry.pdf_attempts || 0) + 1, pdf_last_error: lastError, status: entry.status === 'meta_only' ? 'pdf_failed' : entry.status });
      }
    }
    await sleep(pdfDelayMs);
  }
  return done;
}

// ---------- phase: text ----------
function phaseText(journalFilter: string | null, limit: number | null): number {
  let done = 0;
  for (const entry of catalog.values()) {
    if (journalFilter && entry.journal !== journalFilter) continue;
    if (!entry.files?.pdf || entry.files?.text) continue;
    if (limit && done >= limit) break;
    const pdf = join(DATA, entry.files.pdf);
    if (!fs.existsSync(pdf)) continue;
    ensure(dirname(textPath(entry.id)));
    const out = textPath(entry.id);
    // NOTE: no -nopgbrk — form feeds (\f) mark page boundaries, so a later
    // reference parser can compute the page of a match (pages before it + 1)
    // and deep-link into the PDF with url_pdf#page=N.
    const r = spawnSync('pdftotext', ['-enc', 'UTF-8', pdf, out], { timeout: 120000 });
    const ok = r.status === 0 && fs.existsSync(out) && fs.statSync(out).size > 200;
    upsert(entry.id, {
      files: { ...entry.files, text: ok ? `text/${shard(entry.id)}/${entry.id}.txt` : undefined },
      text_pages: ok ? true : undefined,
      status: ok ? 'text_ok' : 'text_empty',
    });
    done++;
    if (done % 100 === 0) console.log(`  text: ${done} extracted...`);
  }
  return done;
}

// ---------- phase: prune ----------
// Deletes local PDFs for articles whose text is already extracted, to save disk.
// NEVER run automatically — explicit user decision only. Provenance survives:
// meta/<id>.json keeps the exact download URL, sha256, size and headers, and the
// catalog keeps pdf_sha256/pdf_bytes + pruned timestamp, so any PDF can be
// re-fetched and verified bit-for-bit later.
function phasePrune(journalFilter: string | null) {
  let n = 0, freed = 0;
  for (const entry of catalog.values()) {
    if (journalFilter && entry.journal !== journalFilter) continue;
    if (!entry.files?.pdf || !entry.files?.text || entry.status !== 'text_ok') continue;
    const p = join(DATA, entry.files.pdf);
    if (!fs.existsSync(p)) continue;
    freed += fs.statSync(p).size;
    fs.unlinkSync(p);
    const files = { ...entry.files };
    delete files.pdf;
    upsert(entry.id, { files, pruned: { ts: new Date().toISOString(), sha256: entry.files.pdf_sha256, bytes: entry.files.pdf_bytes } });
    n++;
  }
  console.log(`pruned ${n} PDFs, freed ${(freed / 1e9).toFixed(2)} GB (text + provenance kept)`);
}

// ---------- phase: status ----------
function phaseStatus() {
  const byStatus: Record<string, number> = {}, byJournal: Record<string, { total: number; pdf: number; text: number }> = {};
  for (const e of catalog.values()) {
    byStatus[e.status] = (byStatus[e.status] || 0) + 1;
    const j = byJournal[e.journal!] ||= { total: 0, pdf: 0, text: 0 };
    j.total++;
    if (e.files?.pdf) j.pdf++;
    if (e.files?.text) j.text++;
  }
  console.log(`\n${catalog.size} articles in catalog`);
  console.log('by status:', JSON.stringify(byStatus));
  console.log('per journal:');
  for (const [k, v] of Object.entries(byJournal).sort()) console.log(`  ${k.padEnd(12)} total ${String(v.total).padStart(5)}  pdf ${String(v.pdf).padStart(5)}  text ${String(v.text).padStart(5)}`);
}

// ---------- main ----------
async function main() {
  const phase = positional[0];
  const journalFilter = (flags.journal as string | undefined) ?? null;
  const limit = (flags.limit as number | undefined) ?? null;
  const full = flags.full as boolean;

  if (!PHASES.includes(phase)) {
    console.log(`Bruk: bun articles/harvest.ts <${PHASES.join('|')}> [flagg] — se --help`);
    process.exit(1);
  }

  ensure(join(DATA, 'state'));
  loadCatalog();
  process.on('SIGINT', () => { flushCatalog(true); process.exit(130); });
  process.on('SIGTERM', () => { flushCatalog(true); process.exit(143); });

  if (phase === 'status') { phaseStatus(); return; }
  if (phase === 'prune') { phasePrune(journalFilter); flushCatalog(true); phaseStatus(); return; }

  const state = loadState();
  const journals = CONFIG.journals.filter((j: Journal) => j.enabled && (!journalFilter || j.key === journalFilter));

  if (phase === 'meta' || phase === 'all') {
    for (const j of journals) {
      const st = state.journals[j.key] ||= {};
      // incremental: since last successful run, minus 2 days safety margin
      const since = !full && st.lastMetaRun ? new Date(Date.parse(st.lastMetaRun) - 2 * 86400000).toISOString().slice(0, 10) : null;
      console.log(`=== meta: ${j.key} (${j.name})${since ? ` since ${since}` : ' [full]'} ===`);
      const nCr = await harvestCrossref(j, since, limit);
      const nDo = await harvestDoaj(j, limit);
      console.log(`  crossref ${nCr}, doaj ${nDo}`);
      // a --limit run is a partial sweep — must not advance the incremental cursor
      if (!limit) { st.lastMetaRun = new Date().toISOString(); saveState(state); }
      flushCatalog(true);
    }
  }
  if (phase === 'pdf' || phase === 'all') {
    console.log(`=== pdf ===`);
    const n = await phasePdf(journalFilter, limit);
    console.log(`  ${n} PDFs downloaded`);
    flushCatalog(true);
  }
  if (phase === 'text' || phase === 'all') {
    console.log(`=== text ===`);
    const n = phaseText(journalFilter, limit);
    console.log(`  ${n} texts extracted`);
    flushCatalog(true);
  }
  phaseStatus();
  flushCatalog(true);
}

// Kjører bare når fila startes direkte. Uten vakten kjører jobben ved IMPORT —
// det er grunnen til at days.ts slettet data bare man lastet modulen (#108),
// og det gjør skriptene umulige å teste.
if (import.meta.main) {
    main().catch(e => { flushCatalog(true); console.error(e); process.exit(1); });
}
