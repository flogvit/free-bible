#!/usr/bin/env bun
// Per-context reconciliation for AMBIGUOUS bare names (jakob, josef, maria, ...)
// where the correct target depends on WHO references the slug. For each
// (referrer, field, slug) it gives the LLM the referrer's full context + the
// candidate persons and asks which one is meant. Writes proposals only.
//
// Usage: node persons_reconcile_context.mjs <worklist.json> <out.json>
import * as fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { callWithRetry } from './llm.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PERSONS_DIR = path.join(__dirname, 'persons', 'nb');
const [, , WORKLIST, OUT] = process.argv;
if (!WORKLIST || !OUT) { console.error('usage: node persons_reconcile_context.mjs <worklist.json> <out.json>'); process.exit(1); }

/**
 * En personprofil slik den ligger i generate/persons/nb/<slug>.json. Bare
 * feltene dette skriptet leser er tatt med; `id` er påkrevd fordi skriptet
 * bruker den som nøkkel (persons_integrity.mjs er den som leter etter
 * profiler uten id).
 */
interface PersonProfile {
  id: string;
  name: string;
  title?: string;
  era?: string;
  summary?: string;
}

/** Én profil som peker på en slug, og gjennom hvilket forhold. */
interface WorklistRefBy {
  by: string;
  rel: string;
}

/**
 * En oppføring i worklisten fra persons_integrity.mjs. `candidates` kommer fra
 * `ambiguous`-bolken, `candidate` fra `variant`-bolken.
 */
interface WorklistEntry {
  slug: string;
  count?: number;
  refBy: WorklistRefBy[];
  candidates?: string[];
  candidate?: string;
}

/** Worklisten slik persons_integrity.mjs --worklist skriver den. */
interface Worklist {
  references: {
    variant: WorklistEntry[];
    ambiguous: WorklistEntry[];
    missing?: WorklistEntry[];
  };
}

/** Ett (refererende person, felt, slug)-par med kandidatlista si. */
interface Pair {
  slug: string;
  referrer: string;
  field: string;
  cands: string[];
}

/** Hvor sikker modellen er på valget sitt — enum-et i SCHEMA. */
type Confidence = 'high' | 'medium' | 'low';

/** Svaret fra modellen, formen SCHEMA krever. */
interface ContextVerdict {
  match: string;
  confidence: Confidence;
  reason: string;
}

/** Ett forslag, slik det skrives til OUT. */
interface ContextProposal {
  referrer: string;
  field: string;
  slug: string;
  match: string;
  confidence: Confidence;
  reason: string;
}

const byId = new Map<string, PersonProfile>();
for (const f of fs.readdirSync(PERSONS_DIR).filter(f => f.endsWith('.json'))) {
  const d = JSON.parse(fs.readFileSync(path.join(PERSONS_DIR, f), 'utf-8')) as PersonProfile;
  byId.set(d.id, d);
}
const catalog = new Set(byId.keys());

function candLine(id: string): string {
  const d = byId.get(id);
  if (!d) return `  ${id}`;
  return `  ${id}  —  ${d.name}${d.title ? ', ' + d.title : ''} [${d.era || '?'}]`;
}
function referrerCtx(id: string): string {
  const d = byId.get(id);
  if (!d) return id;
  return `${d.name}${d.title ? ' (' + d.title + ')' : ''} [era: ${d.era || '?'}]. ${(d.summary || '').slice(0, 260)}`;
}

const work = JSON.parse(fs.readFileSync(WORKLIST, 'utf-8')) as Worklist;
const items = [...work.references.ambiguous, ...work.references.variant];

// expand to (referrer, field, slug) pairs; keep candidate list
const pairs: Pair[] = [];
for (const it of items) {
  const cands = it.candidates || (it.candidate ? [it.candidate] : []);
  for (const r of it.refBy) pairs.push({ slug: it.slug, referrer: r.by, field: r.rel, cands });
}

const SCHEMA = {
  type: 'object',
  properties: { match: { type: 'string' }, confidence: { type: 'string', enum: ['high', 'medium', 'low'] }, reason: { type: 'string' } },
  required: ['match', 'confidence', 'reason'], additionalProperties: false
};

const proposals: ContextProposal[] = [];
let i = 0;
for (const p of pairs) {
  i++;
  const candList = p.cands.map(candLine).join('\n') || '  (ingen)';
  const prompt = `Du avstemmer en tvetydig bibelsk person-referanse mot riktig person, ut fra KONTEKST.

Refererende person: ${referrerCtx(p.referrer)}
Denne personen har "${p.slug}" som sin relasjon: ${p.field}.

Mulige personer "${p.slug}" kan være:
${candList}

Oppgave: Velg hvilken av kandidatene "${p.slug}" sikter til I DENNE konteksten (bruk era, slekt og beskrivelse — f.eks. en person i patriark-tiden som har 'jakob' som far sikter til Jakob/Israel, mens en i Jesu tid sikter til en NT-Jakob).
- Sett match = id-en til riktig kandidat.
- Hvis ingen kandidat passer (personen finnes ikke): match = "NEW".
Returner JSON: { match, confidence, reason (kort) }.`;
  try {
    const r = await callWithRetry(prompt, { schema: SCHEMA, local: true, context: `${p.referrer}/${p.slug}` }) as ContextVerdict;
    const match = (r.match === 'NEW' || catalog.has(r.match)) ? r.match : 'NEW';
    proposals.push({ referrer: p.referrer, field: p.field, slug: p.slug, match, confidence: r.confidence, reason: r.reason });
  } catch (e) {
    proposals.push({ referrer: p.referrer, field: p.field, slug: p.slug, match: 'NEW', confidence: 'low', reason: 'ERROR: ' + (e as Error).message });
  }
  if (i % 25 === 0) { process.stderr.write(`  ${i}/${pairs.length}\n`); fs.writeFileSync(OUT, JSON.stringify(proposals, null, 1)); }
}
fs.writeFileSync(OUT, JSON.stringify(proposals, null, 1));
console.log(`context proposals: ${proposals.length} -> ${OUT}`);
