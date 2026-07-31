#!/usr/bin/env bun
// First-pass reconciliation proposer. For each unresolved reference slug it asks
// the local LLM to pick the canonical person id from a similarity shortlist, or
// say NEW (genuinely missing). Output is a PROPOSAL to be audited by a human —
// it writes nothing to persons data.
//
// Usage: node persons_reconcile.mjs <worklist.json> <out-proposals.json>
import * as fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { callWithRetry } from './llm.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PERSONS_DIR = path.join(__dirname, 'persons', 'nb');
const [, , WORKLIST, OUT] = process.argv;
if (!WORKLIST || !OUT) { console.error('usage: node persons_reconcile.mjs <worklist.json> <out.json>'); process.exit(1); }

/** Personprofilen i generate/persons/nb/<slug>.json — bare feltene katalogen bruker. */
interface PersonProfile {
  id: string;
  name: string;
  title?: string;
  aliases?: string[];
}

/** Katalogoppføringen, med tomme standardverdier for de valgfrie feltene. */
interface CatalogEntry {
  name: string;
  title: string;
  aliases: string[];
}

/** Hvor sikker LLM-en var. Verdiene er enum-en i `SCHEMA` nedenfor. */
type Confidence = 'high' | 'medium' | 'low';

/** Hvilken bøtte i arbeidslista slugen kom fra. */
type RefKind = 'variant' | 'ambiguous' | 'missing';

/** Én profil som peker på slugen, og gjennom hvilket forhold. */
interface RefBy {
  by: string;
  rel: string;
}

/** En urørt slug i arbeidslista fra persons_integrity.ts. */
interface WorklistEntry {
  slug: string;
  count: number;
  refBy: RefBy[];
}

/** Arbeidslista slik `--worklist` i persons_integrity.ts skriver den. */
interface Worklist {
  references: {
    variant: WorklistEntry[];
    ambiguous: WorklistEntry[];
    missing: WorklistEntry[];
  };
}

/** En arbeidslisteoppføring merket med bøtta den kom fra. */
interface WorkItem extends WorklistEntry {
  kind: RefKind;
}

/** Svaret fra LLM-en, formet av `SCHEMA`. */
interface ReconcileResult {
  match: string;
  confidence: Confidence;
  reason: string;
}

/**
 * Ett forslag, slik det skrives til proposals.json og leses av persons_audit.ts.
 *
 * `match` er en eksisterende person-id, eller strengen `"NEW"` når slugen er en
 * genuint manglende profil — den doble betydningen er grunnen til at feltet er
 * `string` og ikke en id-type.
 */
interface Proposal {
  slug: string;
  count: number;
  kind: RefKind;
  match: string;
  confidence: Confidence;
  reason: string;
  shortlist: string[];
  refBy: RefBy[];
}

// catalog
const catalog = new Map<string, CatalogEntry>(); // id -> {name, title, aliases}
for (const f of fs.readdirSync(PERSONS_DIR).filter(f => f.endsWith('.json'))) {
  const d: PersonProfile = JSON.parse(fs.readFileSync(path.join(PERSONS_DIR, f), 'utf-8'));
  catalog.set(d.id, { name: d.name, title: d.title || '', aliases: d.aliases || [] });
}
const ids = [...catalog.keys()];
const base = (s: string) => String(s).toLowerCase().replace(/\s*\([^)]*\)/g, '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

function editDist(a: string, b: string): number {
  const m = a.length, n = b.length; if (Math.abs(m - n) > 3) return 99;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    dp[i][j] = Math.min(dp[i-1][j]+1, dp[i][j-1]+1, dp[i-1][j-1]+(a[i-1]===b[j-1]?0:1));
  return dp[m][n];
}

// precompute base slugs of catalog (id, name, and each alias) so known
// equivalences with a different name (Kefas=Peter, Jerubbaal=Gideon) also match
const catBase = ids.map(id => ({
  id,
  keys: [base(id), base(catalog.get(id)!.name), ...catalog.get(id)!.aliases.map(base)].filter(Boolean),
}));

function shortlist(slug: string): string[] {
  const sb = base(slug);
  const scored: { id: string; d: number }[] = [];
  for (const c of catBase) {
    let best = Math.min(...c.keys.map(k => editDist(sb, k)));
    // prefix / contained on any key
    if (c.id === slug || c.id.startsWith(slug + '-') || c.keys.some(k => k.startsWith(sb) || sb.startsWith(k))) best = Math.min(best, 1);
    if (best <= 2) scored.push({ id: c.id, d: best });
  }
  scored.sort((a, b) => a.d - b.d);
  return scored.slice(0, 12).map(x => x.id);
}

const work: Worklist = JSON.parse(fs.readFileSync(WORKLIST, 'utf-8'));
const all: WorkItem[] = [
  ...work.references.variant.map<WorkItem>(x => ({ ...x, kind: 'variant' })),
  ...work.references.ambiguous.map<WorkItem>(x => ({ ...x, kind: 'ambiguous' })),
  ...work.references.missing.map<WorkItem>(x => ({ ...x, kind: 'missing' })),
];

const SCHEMA = {
  type: 'object',
  properties: {
    match: { type: 'string' }, // an existing id, or "NEW"
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    reason: { type: 'string' }
  },
  required: ['match', 'confidence', 'reason'],
  additionalProperties: false
};

const proposals: Proposal[] = [];
let i = 0;
for (const item of all) {
  i++;
  const cands = shortlist(item.slug);
  const candLines = cands.map(id => `  ${id}  —  ${catalog.get(id)!.name}${catalog.get(id)!.title ? ' ('+catalog.get(id)!.title+')' : ''}`).join('\n') || '  (none)';
  const ctx = item.refBy.slice(0, 4).map(r => `${catalog.get(r.by)?.name || r.by} [${r.rel}]`).join('; ');
  const prompt = `Du avstemmer en bibelsk person-referanse mot en katalog av eksisterende personer.

Referert slug: "${item.slug}"
Denne slugen er brukt som relasjon (${item.refBy[0]?.rel}) av: ${ctx}

Kandidater (eksisterende personer, id — navn):
${candLines}

Oppgave: Avgjør hvilken EKSISTERENDE person slugen sikter til. Slugen er ofte en skrivemåte-/translitterasjonsvariant (f.eks. "aaron"→"aron", "serubbabel"→"serubabel", "ham"→"kam").
- Hvis den klart er samme person som en kandidat: sett match = den kandidatens id.
- Hvis ingen kandidat er samme person (genuint manglende profil): sett match = "NEW".
- ALDRI slå sammen to forskjellige personer som tilfeldigvis ligner (f.eks. Ham/Noahs sønn er IKKE Immer; Chileab/Kilab er IKKE Kaleb; NT-Manaen er IKKE kong Menahem).
- Bruk konteksten (hvem som refererer og relasjonstypen) til å skille.

Returner JSON: { match, confidence, reason (kort) }.`;
  try {
    // `callWithRetry` er typet `object | string`; med skjema er det skjemaets form.
    const r = await callWithRetry(prompt, { schema: SCHEMA, local: true, context: item.slug }) as ReconcileResult;
    const match = r.match && (r.match === 'NEW' || catalog.has(r.match)) ? r.match : 'NEW';
    proposals.push({ slug: item.slug, count: item.count, kind: item.kind, match, confidence: r.confidence, reason: r.reason, shortlist: cands, refBy: item.refBy.slice(0, 5) });
  } catch (e) {
    proposals.push({ slug: item.slug, count: item.count, kind: item.kind, match: 'NEW', confidence: 'low', reason: 'ERROR: ' + (e as Error).message, shortlist: cands, refBy: item.refBy.slice(0, 5) });
  }
  if (i % 25 === 0) { process.stderr.write(`  ${i}/${all.length}\n`); fs.writeFileSync(OUT, JSON.stringify(proposals, null, 1)); }
}
fs.writeFileSync(OUT, JSON.stringify(proposals, null, 1));
console.log(`proposals: ${proposals.length} -> ${OUT}`);
const nEW = proposals.filter(p => p.match === 'NEW').length;
console.log(`  matched existing: ${proposals.length - nEW}  |  NEW (missing): ${nEW}`);
