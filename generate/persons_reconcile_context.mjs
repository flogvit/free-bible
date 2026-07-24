#!/usr/bin/env node
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

const byId = new Map();
for (const f of fs.readdirSync(PERSONS_DIR).filter(f => f.endsWith('.json'))) {
  const d = JSON.parse(fs.readFileSync(path.join(PERSONS_DIR, f), 'utf-8'));
  byId.set(d.id, d);
}
const catalog = new Set(byId.keys());

function candLine(id) {
  const d = byId.get(id);
  if (!d) return `  ${id}`;
  return `  ${id}  —  ${d.name}${d.title ? ', ' + d.title : ''} [${d.era || '?'}]`;
}
function referrerCtx(id) {
  const d = byId.get(id);
  if (!d) return id;
  return `${d.name}${d.title ? ' (' + d.title + ')' : ''} [era: ${d.era || '?'}]. ${(d.summary || '').slice(0, 260)}`;
}

const work = JSON.parse(fs.readFileSync(WORKLIST, 'utf-8'));
const items = [...work.references.ambiguous, ...work.references.variant];

// expand to (referrer, field, slug) pairs; keep candidate list
const pairs = [];
for (const it of items) {
  const cands = it.candidates || (it.candidate ? [it.candidate] : []);
  for (const r of it.refBy) pairs.push({ slug: it.slug, referrer: r.by, field: r.rel, cands });
}

const SCHEMA = {
  type: 'object',
  properties: { match: { type: 'string' }, confidence: { type: 'string', enum: ['high', 'medium', 'low'] }, reason: { type: 'string' } },
  required: ['match', 'confidence', 'reason'], additionalProperties: false
};

const proposals = [];
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
    const r = await callWithRetry(prompt, { schema: SCHEMA, local: true, context: `${p.referrer}/${p.slug}` });
    const match = (r.match === 'NEW' || catalog.has(r.match)) ? r.match : 'NEW';
    proposals.push({ referrer: p.referrer, field: p.field, slug: p.slug, match, confidence: r.confidence, reason: r.reason });
  } catch (e) {
    proposals.push({ referrer: p.referrer, field: p.field, slug: p.slug, match: 'NEW', confidence: 'low', reason: 'ERROR: ' + e.message });
  }
  if (i % 25 === 0) { process.stderr.write(`  ${i}/${pairs.length}\n`); fs.writeFileSync(OUT, JSON.stringify(proposals, null, 1)); }
}
fs.writeFileSync(OUT, JSON.stringify(proposals, null, 1));
console.log(`context proposals: ${proposals.length} -> ${OUT}`);
