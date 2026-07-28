#!/usr/bin/env node
/**
 * Public-domain book harvester for the book→verse linking project (issue #16).
 * Same style as articles/harvest.mjs: tracked scripts here, data GITIGNORED in
 * external/books/ (never pushed). We harvest classic PD commentaries from the
 * Internet Archive as PLAIN TEXT (the OCR *_djvu.txt) — no PDFs needed, which
 * keeps disk tiny and gives the Bible-reference parser direct input. Frontend
 * only ever links out (archive.org details page; page-deep links possible later
 * via the _djvu.xml page structure if wanted).
 *
 * Data in external/books/:
 *   catalog.jsonl            one JSON line per book/volume (master catalog)
 *   meta/<shard>/<id>.json   COMPLETE raw records: search doc + full /metadata
 *                            response + text download provenance
 *   text/<shard>/<id>.txt    OCR text as downloaded
 *   state/harvest-state.json per-collection bookkeeping
 *
 * <id> = archive.org identifier (already unique + url-safe).
 * <shard> = first 2 hex chars of sha256(id).
 *
 * Usage:
 *   node books/harvest.mjs meta   [--collection key] [--limit N]
 *   node books/harvest.mjs text   [--collection key] [--limit N]
 *   node books/harvest.mjs all    [--collection key] [--limit N]
 *   node books/harvest.mjs status
 *
 * Idempotent + resumable like the articles harvester; re-run to pick up new
 * scans. settings.yearMax can gate text download by publication year (items
 * with year missing or above it get status 'year_unverified'); since
 * 2026-07-27 it is effectively off (9999) — we only link, never republish,
 * so anything archive.org freely serves is fair game.
 * Collections are curated archive.org queries in books/collections.json.
 */
import fs from 'fs';
import { join, dirname } from 'path';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..');
const DATA = join(REPO, 'external/books');
const CATALOG = join(DATA, 'catalog.jsonl');

const CONFIG = JSON.parse(fs.readFileSync(join(__dirname, 'collections.json'), 'utf8'));
const { email, apiDelayMs, textDelayMs, yearMax } = CONFIG.settings;
const UA = `free-bible-books/1.0 (https://github.com/flogvit/free-bible; mailto:${email})`;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const sha256 = s => createHash('sha256').update(s).digest('hex');
const shard = id => sha256(id).slice(0, 2);
const ensure = p => fs.mkdirSync(p, { recursive: true });
const metaPath = id => join(DATA, 'meta', shard(id), `${id}.json`);
const textPath = id => join(DATA, 'text', shard(id), `${id}.txt`);

function loadMeta(id) {
  try { return JSON.parse(fs.readFileSync(metaPath(id), 'utf8')); } catch { return { id, sources: {}, fetched: {} }; }
}
function saveMeta(m) { ensure(dirname(metaPath(m.id))); fs.writeFileSync(metaPath(m.id), JSON.stringify(m, null, 2) + '\n'); }

async function fetchWithRetry(url, opts = {}, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 120000);
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctl.signal, redirect: 'follow' });
      clearTimeout(t);
      if (res.status === 429 || res.status >= 500) { await sleep(5000 * (i + 1) * (i + 1)); continue; }
      return res;
    } catch (e) { if (i === tries - 1) throw e; await sleep(5000 * (i + 1)); }
  }
  throw new Error(`retries exhausted: ${url}`);
}
async function fetchJson(url) {
  const res = await fetchWithRetry(url);
  if (!res.ok) { const e = new Error(`HTTP ${res.status} ${url}`); e.status = res.status; throw e; }
  return res.json();
}

// ---------- catalog ----------
const catalog = new Map();
function loadCatalog() {
  if (!fs.existsSync(CATALOG)) return;
  for (const line of fs.readFileSync(CATALOG, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const e = JSON.parse(line); catalog.set(e.id, e);
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
function upsert(id, patch) {
  const e = catalog.get(id) || { id, status: 'meta_only' };
  Object.assign(e, patch);
  catalog.set(id, e);
  if (++dirty >= 50) flushCatalog();
  return e;
}

// ---------- phase: meta (gutendex, for collections with source: "gutenberg") ----------
// Project Gutenberg ids are prefixed pg- in the catalog so they never collide
// with archive.org identifiers. Everything Gutenberg publishes is cleared for
// US public domain, and their texts are hand-proofed — no OCR noise.
async function gutenbergMeta(c, limit) {
  let count = 0;
  let url = `https://gutendex.com/books/?topic=${encodeURIComponent(c.topic)}`;
  while (url) {
    let data;
    try { data = await fetchJson(url); }
    catch (e) { console.log(`  gutendex failed: ${e.message}`); break; }
    for (const b of data.results || []) {
      const id = `pg-${b.id}`;
      const m = loadMeta(id);
      m.collection = c.key;
      m.sources.gutendex = b; // raw record incl. formats map
      m.fetched.gutendex = new Date().toISOString();
      saveMeta(m);
      const existing = catalog.get(id) || {};
      upsert(id, {
        collection: existing.collection || c.key, // topics overlap; first collection wins
        title: b.title || null,
        authors: (b.authors || []).map(a => a.name),
        year: null,
        language: (b.languages || [])[0] || null,
        url_details: `https://www.gutenberg.org/ebooks/${b.id}`,
        licenseurl: null,
        pd_ok: true,
        status: existing.files?.text ? existing.status : (existing.status || 'meta_only'),
      });
      count++;
      if (limit && count >= limit) return count;
    }
    url = data.next;
    await sleep(apiDelayMs);
  }
  console.log(`  ${count} items`);
  flushCatalog(true);
  return count;
}

// ---------- phase: meta (archive.org advanced search) ----------
async function phaseMeta(collections, limit) {
  let total = 0;
  for (const c of collections) {
    console.log(`=== meta: ${c.key} (${c.name}) ===`);
    if (c.source === 'gutenberg') { total += await gutenbergMeta(c, limit); continue; }
    let page = 1, count = 0;
    while (true) {
      const params = new URLSearchParams({ q: c.query, rows: '100', page: String(page), output: 'json' });
      for (const f of ['identifier', 'title', 'creator', 'year', 'date', 'language', 'licenseurl', 'subject', 'downloads']) params.append('fl[]', f);
      params.append('sort[]', 'downloads desc'); // popular scans first = usually best OCR
      const url = `https://archive.org/advancedsearch.php?${params}`;
      let data;
      try { data = await fetchJson(url); }
      catch (e) { console.log(`  search failed p${page}: ${e.message}`); break; }
      const docs = data.response?.docs || [];
      for (const d of docs) {
        const id = d.identifier;
        if (!id) continue;
        const m = loadMeta(id);
        m.collection = c.key;
        m.sources.search = d; // raw search doc
        m.fetched.search = new Date().toISOString();
        saveMeta(m);
        const year = +(d.year || String(d.date || '').slice(0, 4)) || null;
        const pdOk = year !== null && year <= yearMax;
        const existing = catalog.get(id) || {};
        upsert(id, {
          collection: c.key,
          title: Array.isArray(d.title) ? d.title[0] : d.title || null,
          authors: [].concat(d.creator || []),
          year,
          language: [].concat(d.language || [])[0] || null,
          url_details: `https://archive.org/details/${id}`,
          licenseurl: d.licenseurl || null,
          pd_ok: pdOk,
          status: existing.files?.text ? existing.status : (pdOk ? existing.status || 'meta_only' : 'year_unverified'),
        });
        count++; total++;
        if (limit && count >= limit) break;
      }
      const found = data.response?.numFound ?? 0;
      if ((limit && count >= limit) || page * 100 >= found || docs.length === 0) break;
      page++;
      await sleep(apiDelayMs);
    }
    console.log(`  ${count} items`);
    flushCatalog(true);
    await sleep(apiDelayMs);
  }
  return total;
}

// ---------- phase: text (fetch OCR txt via /metadata file listing) ----------
async function phaseText(collections, limit) {
  const keys = new Set(collections.map(c => c.key));
  let done = 0;
  for (const entry of catalog.values()) {
    if (!keys.has(entry.collection)) continue;
    if (entry.files?.text || entry.status === 'no_text') continue;
    if (!entry.pd_ok) continue; // year_unverified items wait for human decision
    if ((entry.text_attempts || 0) >= 3) continue;
    if (limit && done >= limit) break;

    const m = loadMeta(entry.id);
    try {
      let url;
      if (entry.id.startsWith('pg-')) {
        const fmts = m.sources.gutendex?.formats || {};
        const key = Object.keys(fmts).find(k => k.startsWith('text/plain') && !fmts[k].endsWith('.zip'));
        if (!key) { upsert(entry.id, { status: 'no_text' }); continue; }
        url = fmts[key];
      } else {
        // full item metadata (files list) — keep raw, it is rich (page counts, formats, scan info)
        if (!m.sources.item) {
          m.sources.item = await fetchJson(`https://archive.org/metadata/${entry.id}`);
          m.fetched.item = new Date().toISOString();
          saveMeta(m);
          await sleep(apiDelayMs);
        }
        const files = m.sources.item.files || [];
        const txt = files.find(f => f.name?.endsWith('_djvu.txt')) || files.find(f => f.format === 'DjVuTXT');
        if (!txt) { upsert(entry.id, { status: 'no_text' }); continue; }
        url = `https://archive.org/download/${entry.id}/${encodeURIComponent(txt.name)}`;
      }
      const res = await fetchWithRetry(url, { timeoutMs: 300000 }, 2);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 5000) throw new Error(`suspiciously small (${buf.length}B)`);
      ensure(dirname(textPath(entry.id)));
      fs.writeFileSync(textPath(entry.id), buf);
      m.textDownload = { url, ts: new Date().toISOString(), bytes: buf.length, sha256: sha256(buf) };
      saveMeta(m);
      upsert(entry.id, {
        url_text: url,
        files: { ...(entry.files || {}), text: `text/${shard(entry.id)}/${entry.id}.txt`, text_sha256: m.textDownload.sha256, text_bytes: buf.length },
        status: 'text_ok',
      });
      done++;
      if (done % 25 === 0) console.log(`  text: ${done} downloaded...`);
    } catch (e) {
      console.log(`  text fail ${entry.id}: ${e.message.slice(0, 120)}`);
      upsert(entry.id, { text_attempts: (entry.text_attempts || 0) + 1, text_last_error: e.message.slice(0, 200) });
    }
    await sleep(textDelayMs);
  }
  return done;
}

// ---------- phase: status ----------
function phaseStatus() {
  const byStatus = {}, byColl = {};
  let bytes = 0;
  for (const e of catalog.values()) {
    byStatus[e.status] = (byStatus[e.status] || 0) + 1;
    const c = byColl[e.collection] ||= { total: 0, text: 0 };
    c.total++;
    if (e.files?.text) { c.text++; bytes += e.files.text_bytes || 0; }
  }
  console.log(`\n${catalog.size} books/volumes in catalog, ${(bytes / 1e9).toFixed(2)} GB text`);
  console.log('by status:', JSON.stringify(byStatus));
  for (const [k, v] of Object.entries(byColl).sort()) console.log(`  ${k.padEnd(18)} total ${String(v.total).padStart(5)}  text ${String(v.text).padStart(5)}`);
}

// ---------- main ----------
async function main() {
  const args = process.argv.slice(2);
  const phase = args[0];
  const flag = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
  const collFilter = flag('--collection');
  const limit = flag('--limit') ? +flag('--limit') : null;

  if (!['meta', 'text', 'all', 'status'].includes(phase)) {
    console.log('Usage: node books/harvest.mjs <meta|text|all|status> [--collection key] [--limit N]');
    process.exit(1);
  }
  ensure(join(DATA, 'state'));
  loadCatalog();
  process.on('SIGINT', () => { flushCatalog(true); process.exit(130); });
  process.on('SIGTERM', () => { flushCatalog(true); process.exit(143); });

  if (phase === 'status') { phaseStatus(); return; }
  const collections = CONFIG.collections.filter(c => !collFilter || c.key === collFilter);

  if (phase === 'meta' || phase === 'all') {
    const n = await phaseMeta(collections, limit);
    console.log(`meta: ${n} items total`);
  }
  if (phase === 'text' || phase === 'all') {
    console.log('=== text ===');
    const n = await phaseText(collections, limit);
    console.log(`  ${n} texts downloaded`);
  }
  flushCatalog(true);
  phaseStatus();
}

main().catch(e => { flushCatalog(true); console.error(e); process.exit(1); });
