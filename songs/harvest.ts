#!/usr/bin/env bun
/**
 * PD song/hymn harvester for the song→verse linking project.
 * Same layout rule as articles/ and books/: scripts TRACKED here, data
 * GITIGNORED in external/songs/ (never pushed). The original 2026-04 scrapers
 * lived inside external/songs/<collection>/ and were lost — only
 * hymnary-landstad/scrape.mjs survived. This harvester replaces them and must
 * stay in songs/ so that never happens again.
 *
 * NOTE hymnary.org is no longer scriptable (Bunny Shield JS challenge, 403 for
 * non-browsers since ~mid 2026), so this harvester covers sources with real
 * APIs instead:
 *   wikisource — MediaWiki API, category crawl → wikitext → stanzas
 *   kalliope   — kalliope.org JSON API + __NEXT_DATA__ text pages
 *
 * Data in external/songs/:
 *   harvest/<collection>/<id>.json  parsed song + raw source text (provenance)
 *   state/harvest-state.json        per-collection bookkeeping
 *   master/song-NNNN.json           merged corpus (existing, extended by merge)
 *   index.json                      master index (existing, extended by merge)
 *
 * Usage:
 *   bun songs/harvest.ts scrape [--collection key] [--limit N]
 *   bun songs/harvest.ts merge  [--dry-run]
 *   bun songs/harvest.ts status
 *
 * Idempotent + resumable: scrape skips songs whose file exists; merge skips
 * songs already in index.json (by collection+file source, and by normalized
 * title against the whole corpus so re-runs and cross-source duplicates are
 * not re-added). merge backs up index.json to index.json.bak once per run.
 */
import fs from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parseArgs, formatHelp, COMMON_FLAGS } from '../generate/cli.js';
import type { FlagSpec, ParsedArgs } from '../generate/cli.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Flaggkontrakten kjører FØRST — før sources.json leses og før external/songs/
// røres. `--help` skal svare uten å lese en eneste fil.
const SPEC: Record<string, FlagSpec> = {
  collection: { kind: 'string', help: 'bare denne samlingen (key i songs/sources.json)' },
  limit: COMMON_FLAGS.limit,
  // Het `--dry` før. Kontrakten godtar fortsatt det navnet, men advarer (#52).
  'dry-run': COMMON_FLAGS['dry-run'],
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

const COMMANDS = ['scrape', 'merge', 'status'];

if (flags.help) {
  console.log(formatHelp(
    'songs/harvest.ts',
    'høster salmer/dikt fra wikisource og kalliope, og fletter dem inn i sangkorpuset',
    SPEC,
    [
      'bun songs/harvest.ts scrape --collection kalliope-kingo --limit 50',
      'bun songs/harvest.ts merge --dry-run',
      'bun songs/harvest.ts status',
    ],
  ));
  console.log(`\nKommando (første posisjonsargument): ${COMMANDS.join(' | ')}`);
  console.log('  --collection og --limit gjelder scrape; --dry-run gjelder merge.');
  process.exit(0);
}

const REPO = join(__dirname, '..');
const DATA = join(REPO, 'external/songs');
const HARVEST = join(DATA, 'harvest');
const STATE_FILE = join(DATA, 'state', 'harvest-state.json');
const INDEX = join(DATA, 'index.json');
const MASTER = join(DATA, 'master');

const CONFIG: Config = JSON.parse(fs.readFileSync(join(__dirname, 'sources.json'), 'utf8'));
const { email, delayMs } = CONFIG.settings;
const UA = `free-bible-songs/1.0 (https://github.com/flogvit/free-bible; mailto:${email})`;

// ---------- types ----------
// Formene under beskriver JSON-en dette skriptet leser og skriver: sources.json,
// de høstede sangfilene, korpusets index.json, og svarene fra MediaWiki og
// kalliope.org. Bare feltene koden faktisk rører er med — hele råteksten
// (wikitext/HTML) lagres ved siden av, så dette er et utvalg.

interface CollectionBase {
  language: string;
  comment?: string;
  enabled?: boolean;
}

/** Kategorikryp på en MediaWiki-instans. */
interface WikisourceCollection extends CollectionBase {
  type: 'wikisource';
  site: string;
  category: string;
  recurseSubcats?: boolean;
}

/** Én dikter på kalliope.org. */
interface KalliopeCollection extends CollectionBase {
  type: 'kalliope';
  poet: string;
}

type SourceCollection = WikisourceCollection | KalliopeCollection;

interface Config {
  settings: {
    email: string;
    delayMs: number;
  };
  collections: Record<string, SourceCollection>;
}

/** `fetchJson`/`fetchText` henger HTTP-statusen på feilen. */
interface HttpError extends Error {
  status?: number;
}

/** state/harvest-state.json: siste kjøring per samling. */
interface HarvestState {
  collections: Record<string, { lastRun?: string }>;
}

/** Ett vers/strofe slik den lagres. */
interface SongVerse {
  tag: string;
  text: string;
}

/** harvest/<collection>/<id>.json: parset sang + råkilde for reparse. */
interface HarvestedSong {
  harvestId: string;
  collection: string;
  title: string;
  author: string;
  language: string;
  verses: SongVerse[];
  keywords?: string[];
  source: {
    site?: string;
    category?: string;
    pageid?: number;
    poet?: string;
    workId?: string;
    year?: number | null;
    url: string;
    fetched: string;
    notes?: string[];
  };
  raw?: { wikitext: string; renderedHtml?: string };
}

/** En post i korpusets index.json. */
interface IndexEntry {
  id: string;
  title: string;
  author: string;
  language: string;
  textQuality: string;
  sources?: { collection: string; file: string }[];
}

interface WikiCategoryMember {
  pageid: number;
  ns: number;
  title: string;
}

interface WikiCategoryResponse {
  query: { categorymembers: WikiCategoryMember[] };
  continue?: { cmcontinue: string };
}

interface WikiParseResponse {
  parse?: {
    wikitext?: { '*'?: string };
    text?: { '*'?: string };
  };
}

/**
 * En linje i en kalliope-blokk er enten teksten alene, eller et par
 * [tekst, metadata] der metadata markerer at linja er rå HTML.
 */
type KalliopeLine = string | null | [string | null, { html?: boolean } | null];

interface KalliopeBlock {
  type?: string;
  lines?: KalliopeLine[];
}

interface KalliopeText {
  id: string;
  title: string;
  work_id?: string;
  keywords?: string[];
  blocks?: KalliopeBlock[];
  notes?: (string | { content_html?: string })[];
}

interface KalliopeTextsResponse {
  lines?: KalliopeText[];
  poet?: { name?: { fullname?: string; firstname?: string; lastname?: string } };
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const ensure = (p: string) => fs.mkdirSync(p, { recursive: true });

function loadState(): HarvestState {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return { collections: {} }; }
}
function saveState(s: HarvestState) { ensure(dirname(STATE_FILE)); fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2) + '\n'); }

async function fetchWithRetry(url: string, tries = 3): Promise<Response> {
  for (let i = 0; i < tries; i++) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 60000);
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctl.signal, redirect: 'follow' });
      clearTimeout(t);
      if (res.status === 429 || res.status >= 500) { await sleep(5000 * (i + 1) * (i + 1)); continue; }
      return res;
    } catch (e) { if (i === tries - 1) throw e; await sleep(5000 * (i + 1)); }
  }
  throw new Error(`retries exhausted: ${url}`);
}
async function fetchJson<T = any>(url: string): Promise<T> {
  const res = await fetchWithRetry(url);
  if (!res.ok) { const e = new Error(`HTTP ${res.status} ${url}`) as HttpError; e.status = res.status; throw e; }
  return res.json();
}
async function fetchText(url: string): Promise<string> {
  const res = await fetchWithRetry(url);
  if (!res.ok) { const e = new Error(`HTTP ${res.status} ${url}`) as HttpError; e.status = res.status; throw e; }
  return res.text();
}

function songFile(collection: string, id: string): string { return join(HARVEST, collection, `${id}.json`); }
function saveSong(collection: string, song: HarvestedSong) {
  ensure(join(HARVEST, collection));
  fs.writeFileSync(songFile(collection, song.harvestId), JSON.stringify(song, null, 2) + '\n');
}

// ---------- wikisource ----------

async function wikisourceListPages(site: string, category: string, recurse: boolean | undefined): Promise<WikiCategoryMember[]> {
  const pages: WikiCategoryMember[] = [];
  const seenCats = new Set<string>();
  const queue: string[] = [category];
  while (queue.length) {
    // `!`: while-betingelsen over garanterer at køen ikke er tom.
    const cat = queue.shift()!;
    if (seenCats.has(cat)) continue;
    seenCats.add(cat);
    let cont = '';
    do {
      const url = `https://${site}/w/api.php?action=query&list=categorymembers&cmtitle=${encodeURIComponent(cat)}&cmlimit=500&format=json${cont}`;
      const d: WikiCategoryResponse = await fetchJson(url);
      for (const m of d.query.categorymembers) {
        if (m.ns === 0) pages.push(m);
        else if (recurse && m.title.match(/^Kategori:/)) queue.push(m.title);
      }
      cont = d.continue ? `&cmcontinue=${encodeURIComponent(d.continue.cmcontinue)}` : '';
      await sleep(delayMs);
    } while (cont);
  }
  return pages;
}

/** Best-effort wikitext → stanzas. Raw wikitext is kept in the file for reparse. */
function parseWikitext(wikitext: string): { author: string; verses: SongVerse[] } {
  let t = wikitext;
  const author = ((t.match(/\|\s*forfatter\s*=\s*([^\n|}]+)/i) || t.match(/\[\[\s*Forfatter:([^|\]]+)/i) || [])[1] || '')
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1').replace(/<[^>]+>/g, '').trim();
  // unwrap poem tags, drop templates/tables/headers/comments/refs
  t = t.replace(/<\/?poem[^>]*>/gi, '\n');
  t = t.replace(/<!--.*?-->/gs, '');
  t = t.replace(/<ref[^>]*\/>/gi, '').replace(/<ref[^>]*>.*?<\/ref>/gis, '');
  for (let i = 0; i < 5 && /\{\{[^{}]*\}\}/s.test(t); i++) t = t.replace(/\{\{[^{}]*\}\}/gs, '');
  t = t.replace(/^\{\|[\s\S]*?^\|\}/gm, '');
  t = t.replace(/^(==+).*?\1\s*$/gm, '');
  t = t.replace(/^__\w+__\s*$/gm, '');
  t = t.replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1');
  t = t.replace(/'''?/g, '');
  t = t.replace(/<br\s*\/?>/gi, '\n');
  t = t.replace(/<\/?(div|span|center|section|includeonly|noinclude|onlyinclude)[^>]*>/gi, '');
  t = t.replace(/^[:;*#]+\s?/gm, '');
  const stanzas = t.split(/\n\s*\n+/)
    .map(s => s.split('\n').map(l => l.trim()).filter(l => l && !/Forfatter:/i.test(l)).join('\n'))
    .filter(s => s.length > 0);
  // leading stanza of pure metadata (author line, category leftovers) is common — drop 1-liners that end with ':' or are ALL-CAPS labels
  const verses = stanzas.filter(s => !(s.split('\n').length === 1 && (s.endsWith(':') || /^Kategori:/i.test(s))));
  return { author, verses: verses.map((text, i) => ({ tag: `V${i + 1}`, text })) };
}

/** Rendered-HTML → stanzas, for pages built by <pages index=.../> transclusion. */
function parseRenderedHtml(html: string): SongVerse[] {
  let t = html;
  t = t.replace(/<style[^>]*>.*?<\/style>/gis, '');
  t = t.replace(/<table[^>]*>.*?<\/table>/gis, '');           // header/license boxes
  t = t.replace(/<span[^>]*class="[^"]*pagenum[^"]*"[^>]*>.*?<\/span>/gis, '');
  const stanzas: string[] = [];
  for (const m of t.matchAll(/<p[^>]*>(.*?)<\/p>/gis)) {
    let s = m[1].replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');
    s = s.replace(/&#160;|&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
         .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'");
    s = s.split('\n').map(l => l.trim()).filter(Boolean).join('\n');
    if (s) stanzas.push(s);
  }
  return stanzas.map((text, i) => ({ tag: `V${i + 1}`, text }));
}

async function scrapeWikisource(key: string, cfg: WikisourceCollection, limit: number | null) {
  const { site, category, recurseSubcats } = cfg;
  console.log(`[${key}] listing ${category} on ${site}...`);
  const pages = await wikisourceListPages(site, category, recurseSubcats);
  console.log(`[${key}] ${pages.length} pages`);
  let done = 0, skipped = 0, failed = 0;
  for (const p of pages) {
    const id = `ws-${p.pageid}`;
    if (fs.existsSync(songFile(key, id))) { skipped++; continue; }
    if (limit && done >= limit) break;
    try {
      const url = `https://${site}/w/api.php?action=parse&pageid=${p.pageid}&prop=wikitext&format=json`;
      const d: WikiParseResponse = await fetchJson(url);
      const wikitext = d.parse?.wikitext?.['*'] || '';
      let { author, verses } = parseWikitext(wikitext);
      let renderedHtml: string | null = null;
      if (/<pages\s+index=/i.test(wikitext)) {
        const dh: WikiParseResponse = await fetchJson(`https://${site}/w/api.php?action=parse&pageid=${p.pageid}&prop=text&format=json`);
        renderedHtml = dh.parse?.text?.['*'] || '';
        verses = parseRenderedHtml(renderedHtml);
      }
      saveSong(key, {
        harvestId: id, collection: key,
        title: p.title, author, language: cfg.language,
        verses,
        source: { site, category, pageid: p.pageid, url: `https://${site}/wiki/${encodeURIComponent(p.title.replace(/ /g, '_'))}`, fetched: new Date().toISOString() },
        raw: renderedHtml ? { wikitext, renderedHtml } : { wikitext }
      });
      done++;
      if (done % 25 === 0) console.log(`[${key}] ${done} scraped...`);
    } catch (e: any) { console.log(`[${key}] FAIL ${p.title}: ${e.message}`); failed++; }
    await sleep(delayMs);
  }
  console.log(`[${key}] scraped ${done}, skipped ${skipped} existing, failed ${failed}`);
}

// ---------- kalliope ----------

function parseKalliopeBlocks(blocks: KalliopeBlock[] | undefined): SongVerse[] {
  const stanzas: string[] = [];
  let cur: string[] = [];
  const flush = () => { if (cur.length) { stanzas.push(cur.join('\n')); cur = []; } };
  for (const b of blocks || []) {
    if (b.type !== 'poetry') continue;
    for (const entry of b.lines || []) {
      const [text, meta] = Array.isArray(entry) ? entry : [entry, null];
      if (text == null || text === '') { flush(); continue; }
      if (meta?.html) {
        if (/<versenum>/i.test(text)) flush();       // stanza number marker
        continue;                                     // never keep raw html lines
      }
      cur.push(String(text).replace(/<[^>]+>/g, '').trim());
    }
    flush();
  }
  return stanzas.filter(Boolean).map((text, i) => ({ tag: `V${i + 1}`, text }));
}

async function scrapeKalliope(key: string, cfg: KalliopeCollection, limit: number | null) {
  const { poet } = cfg;
  console.log(`[${key}] listing texts for ${poet}...`);
  const d: KalliopeTextsResponse = await fetchJson(`https://kalliope.org/api/${poet}/texts.json`);
  const texts = d.lines || [];
  const n: { fullname?: string; firstname?: string; lastname?: string } = d.poet?.name || {};
  const fullname = n.fullname || [n.firstname, n.lastname].filter(Boolean).join(' ') || poet;
  console.log(`[${key}] ${texts.length} texts`);
  let done = 0, skipped = 0, failed = 0;
  for (const t of texts) {
    const id = t.id;
    if (fs.existsSync(songFile(key, id))) { skipped++; continue; }
    if (limit && done >= limit) break;
    try {
      const html = await fetchText(`https://kalliope.org/da/text/${id}`);
      const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s);
      if (!m) throw new Error('no __NEXT_DATA__');
      const pp: { text?: KalliopeText; work?: { year?: number | null } } = JSON.parse(m[1]).props?.pageProps || {};
      const text = pp.text;
      if (!text) throw new Error('no text in pageProps');
      const verses = parseKalliopeBlocks(text.blocks);
      saveSong(key, {
        harvestId: id, collection: key,
        title: text.title || t.title, author: fullname, language: cfg.language,
        verses,
        keywords: text.keywords || [],
        source: {
          poet, workId: t.work_id, year: pp.work?.year || null,
          url: `https://kalliope.org/da/text/${id}`, fetched: new Date().toISOString(),
          notes: (text.notes || []).map(n => typeof n === 'string' ? n : n?.content_html || '').filter(Boolean)
        }
      });
      done++;
    } catch (e: any) { console.log(`[${key}] FAIL ${id}: ${e.message}`); failed++; }
    await sleep(delayMs);
  }
  console.log(`[${key}] scraped ${done}, skipped ${skipped} existing, failed ${failed}`);
}

// ---------- merge ----------

const normTitle = (s: string | null | undefined): string => (s || '').toLowerCase().normalize('NFC')
  .replace(/[«»"'".,!?;:()\[\]]/g, '').replace(/\s+/g, ' ').trim();

function mergeIntoMaster(dry: boolean) {
  const index: IndexEntry[] = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
  const knownTitles = new Set(index.map(s => normTitle(s.title)));
  const knownSources = new Set(index.flatMap(s => (s.sources || []).map(src => `${src.collection}/${src.file}`)));
  let nextNum = Math.max(...index.map(s => parseInt(s.id.replace('song-', ''), 10))) + 1;

  const additions: { key: string; f: string; srcKey: string; song: HarvestedSong }[] = [];
  for (const key of fs.existsSync(HARVEST) ? fs.readdirSync(HARVEST) : []) {
    const dir = join(HARVEST, key);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json'))) {
      const song: HarvestedSong = JSON.parse(fs.readFileSync(join(dir, f), 'utf8'));
      const srcKey = `harvest/${key}/${f}`;
      if (knownSources.has(srcKey)) continue;
      if (!song.verses?.length) continue;
      if (knownTitles.has(normTitle(song.title))) { continue; }
      additions.push({ key, f, srcKey, song });
      knownTitles.add(normTitle(song.title));
    }
  }

  console.log(`${additions.length} new songs to merge (corpus now ${index.length})`);
  if (dry) {
    for (const a of additions.slice(0, 30)) console.log(`  + [${a.key}] ${a.song.title} (${a.song.verses.length} verses)`);
    if (additions.length > 30) console.log(`  ... and ${additions.length - 30} more`);
    return;
  }
  if (!additions.length) return;

  const bak = INDEX + '.bak';
  if (!fs.existsSync(bak)) fs.copyFileSync(INDEX, bak);

  for (const a of additions) {
    const id = `song-${String(nextNum++).padStart(4, '0')}`;
    fs.writeFileSync(join(MASTER, `${id}.json`), JSON.stringify({
      id, title: a.song.title, author: a.song.author || '', verses: a.song.verses
    }, null, 2) + '\n');
    index.push({
      id, title: a.song.title, author: a.song.author || '',
      language: a.song.language, textQuality: 'good',
      sources: [{ collection: 'harvest/' + a.key, file: a.f }]
    });
  }
  const tmp = INDEX + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(index, null, 1) + '\n');
  fs.renameSync(tmp, INDEX);
  console.log(`merged ${additions.length} songs, corpus now ${index.length} (backup: index.json.bak)`);
}

// ---------- status ----------

function status() {
  if (!fs.existsSync(HARVEST)) { console.log('nothing harvested yet'); return; }
  const index: IndexEntry[] = fs.existsSync(INDEX) ? JSON.parse(fs.readFileSync(INDEX, 'utf8')) : [];
  const merged = new Set(index.flatMap(s => (s.sources || []).map(src => `${src.collection}/${src.file}`)));
  for (const key of fs.readdirSync(HARVEST)) {
    const dir = join(HARVEST, key);
    if (!fs.statSync(dir).isDirectory()) continue;
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    let withText = 0, inMaster = 0;
    for (const f of files) {
      const s: HarvestedSong = JSON.parse(fs.readFileSync(join(dir, f), 'utf8'));
      if (s.verses?.length) withText++;
      if (merged.has(`harvest/${key}/${f}`)) inMaster++;
    }
    console.log(`  ${key.padEnd(24)} files ${String(files.length).padStart(5)}  withText ${String(withText).padStart(5)}  merged ${String(inMaster).padStart(5)}`);
  }
  console.log(`corpus: ${index.length} songs in index.json`);
}

// ---------- main ----------

async function main() {
  const cmd = positional[0];
  if (cmd === 'status') return status();
  if (cmd === 'merge') return mergeIntoMaster(flags['dry-run'] as boolean);
  if (cmd !== 'scrape') {
    console.log(`Bruk: bun songs/harvest.ts <${COMMANDS.join('|')}> [flagg] — se --help`);
    process.exit(1);
  }
  const only = (flags.collection as string | undefined) ?? null;
  const limit = (flags.limit as number | undefined) ?? null;
  const state = loadState();
  for (const [key, cfg] of Object.entries(CONFIG.collections)) {
    if (only && key !== only) continue;
    if (cfg.enabled === false) continue;
    try {
      if (cfg.type === 'wikisource') await scrapeWikisource(key, cfg, limit);
      else if (cfg.type === 'kalliope') await scrapeKalliope(key, cfg, limit);
      // `as`: unionen dekker bare de to kjente typene, så `cfg` er `never` her.
      // Grenen finnes nettopp for en tredje type i sources.json.
      else console.log(`[${key}] unknown type ${(cfg as SourceCollection).type}`);
      state.collections[key] = { ...state.collections[key], lastRun: new Date().toISOString() };
      saveState(state);
    } catch (e: any) { console.log(`[${key}] collection failed: ${e.message}`); }
  }
}

// Kjører bare når fila startes direkte. Uten vakten kjører jobben ved IMPORT —
// det er grunnen til at days.ts slettet data bare man lastet modulen (#108),
// og det gjør skriptene umulige å teste.
if (import.meta.main) {
    main().catch(e => { console.error('Fatal:', e); process.exit(1); });
}
