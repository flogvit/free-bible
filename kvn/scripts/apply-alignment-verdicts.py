#!/usr/bin/env python3
"""
Appliserer tekstverifiserte justeringsdommer fra
kvn/data/alignment-verdicts.json på modulene i hver (kapittel ×
versstruktur)-gruppe (issue #18).

Verdikt-format (liste av objekter):
  { "key": "19:51", "trIds": [...],           # gruppe-signaturen
    "alignment": [[osV, trCh, trV], ...],     # tom liste = identitet
    "note": "..." }

Sikkerhet (lærdommer fra 2026-07-28):
 - osmain-familien (osnb/osnn/osen/oster) får ALDRI gruppedommer.
 - Originale (ikke-utledede) mappinger krever klar forbedring
   (ny score >= gammel + 0.05); utledede krever ny >= gammel - 0.02.
 - Mål som mangler i modulens data hoppes over.
Idempotent: kjøres på nytt etter køoppdateringer uten skade.
"""
import json, math, os

REPO = os.path.join(os.path.dirname(__file__), '..', '..')
M = os.path.join(REPO, 'kvn', 'mappings')

EXCLUDE = {'osnb', 'osnn', 'osen', 'oster'}
PART = 16; MAXV = 177; MAXC = 151
MV = MAXV * PART; MC = MAXC * MV
def enc(b, c, v): return b * MC + c * MV + v * PART
def dec(k):
    p = k % PART; r1 = (k - p) // PART; v = r1 % MAXV; r2 = (r1 - v) // MAXV
    return (r2 // MAXC, r2 % MAXC, v)

import sys
LENGTHS_FILE = sys.argv[sys.argv.index('--lengths') + 1]
lengths = json.load(open(LENGTHS_FILE))
verdicts = json.load(open(os.path.join(REPO, 'kvn', 'data', 'alignment-verdicts.json')))
queue = json.load(open(os.path.join(REPO, 'kvn', 'data', 'alignment-judgment-queue.json')))

# Køen er flat: ett innslag per (kapittel × versstruktur)-gruppe
qidx = {(e['key'], tuple(e['trIds'])): e['members'] for e in queue}

def corr(pairs):
    n = len(pairs)
    if n < 4: return 0.0
    ma = sum(p[0] for p in pairs) / n; mb = sum(p[1] for p in pairs) / n
    cov = sum((x - ma) * (y - mb) for x, y in pairs)
    va = sum((x - ma) ** 2 for x, _ in pairs); vb = sum((y - mb) ** 2 for _, y in pairs)
    return cov / math.sqrt(va * vb) if va > 0 and vb > 0 else 0.0

def chapter_score(mod, book, ch, entrymap):
    osl = dict(lengths['osmain'].get(f'{book}:{ch}') or [])
    pairs = []; cache = {}
    for v, l in osl.items():
        tc, tv = entrymap.get(v, (ch, v))
        tk = f'{book}:{tc}'
        if tk not in cache: cache[tk] = dict(lengths[mod].get(tk) or [])
        tl = cache[tk].get(tv)
        if tl is not None: pairs.append((l, tl))
    return corr(pairs), len(pairs)

fps_cache = {}
def tr_ids(mod, book, ch):
    k = (mod, book, ch)
    if k not in fps_cache:
        fps_cache[k] = {a for a, _ in (lengths.get(mod, {}).get(f'{book}:{ch}') or [])}
    return fps_cache[k]

applied = rejected = skipped = 0
touched = {}
for vd in verdicts:
    key = vd['key']; sig = tuple(vd['trIds'])
    members = qidx.get((key, sig))
    if not members: continue
    book, ch = map(int, key.split(':'))
    for mod in members:
        if mod in EXCLUDE or mod not in lengths: skipped += 1; continue
        p = os.path.join(M, f'{mod}.ukvn.json')
        m = touched.get(mod) or json.load(open(p))
        derived = bool(m.get('derived'))
        old_entries = [e for e in m['map'] if dec(e['kvnFrom'])[:2] == (book, ch)]
        old_map = {dec(e['kvnFrom'])[2]: (dec(e['tkvnFrom'])[1], dec(e['tkvnFrom'])[2]) for e in old_entries}
        old_score, _ = chapter_score(mod, book, ch, old_map)
        bn = next((n for n, bid in m['bookNames'].items() if bid == book), str(book))
        new_entries = []; new_map = {}
        for ov, tc, tv in vd['alignment']:
            if tv not in tr_ids(mod, book, tc): continue
            new_map[ov] = (tc, tv)
            if tc == ch and tv == ov: continue
            new_entries.append({'kvnFrom': enc(book, ch, ov), 'kvnTo': enc(book, ch, ov),
                'kvnRef': f'{bn} {ch}:{ov}', 'tkvnFrom': enc(book, tc, tv), 'tkvnTo': enc(book, tc, tv),
                'tkvnRef': f'{bn} {tc},{tv}', 'order': 0})
        new_score, np_ = chapter_score(mod, book, ch, new_map)
        bar = old_score + (0.05 if not derived else -0.02)
        if np_ < 4 or new_score < bar:
            rejected += 1; continue
        m['map'] = [e for e in m['map'] if dec(e['kvnFrom'])[:2] != (book, ch)] + new_entries
        touched[mod] = m
        applied += 1

for mod, m in touched.items():
    m['map'].sort(key=lambda e: (e['kvnFrom'], e['order']))
    m['stats']['totalMappingEntries'] = len(m['map'])
    json.dump(m, open(os.path.join(M, f'{mod}.ukvn.json'), 'w'), ensure_ascii=False, indent=2)

print(f'verdikter: {len(verdicts)} | applisert: {applied} celler | vaktavvist: {rejected} | hoppet: {skipped} | moduler skrevet: {len(touched)}')
