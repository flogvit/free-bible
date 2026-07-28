#!/usr/bin/env python3
"""
Mapping mellom osmain og prosjektets egne oversettelser (issue #18).

osnb/osnn/osen har ett ekstra vers i 58 salmer der osmain fletter to vers
sammen — på varierende posisjon (Sal 108 helt til slutt, Sal 61 midt i).
Kapitlene sto helt umappet, og siden osnb er navet all kryssmapping går
gjennom, forplantet feilen seg til alle andre oversettelser.

osmain og osnb/osnn er samme språk (bokmål/nynorsk), så justeringen finnes
med direkte tekstlikhet i stedet for lengdekorrelasjon — langt mer presist.
osen (engelsk) arver osnb sin justering, siden de deler versifikasjon.

Modulens ekstra vers modelleres som delvers (osmain v -> tr v og v+1), slik
at både forover- og reversoppslag blir entydige.

Bruk: python3 scripts/align-osmain-family.py [--dry-run]
"""
import json, os, sys
from difflib import SequenceMatcher

REPO = os.path.join(os.path.dirname(__file__), '..', '..')
RAW = os.path.join(REPO, 'generate', 'bibles_raw')
M = os.path.join(REPO, 'kvn', 'mappings')
dry = '--dry-run' in sys.argv
PART = 16; MAXV = 177; MAXC = 151; MV = MAXV * PART; MC = MAXC * MV
def enc(b, c, v): return b * MC + c * MV + v * PART
def dec(k):
    p = k % PART; r1 = (k - p) // PART; v = r1 % MAXV; r2 = (r1 - v) // MAXV
    return (r2 // MAXC, r2 % MAXC, v)

def verses(mod, b, c):
    p = os.path.join(RAW, mod, str(b), f'{c}.json')
    if not os.path.exists(p): return {}
    return {x['verseId']: x['text'] for x in json.load(open(p))}

def sim(a, b):
    return SequenceMatcher(None, a[:160], b[:160]).ratio()

def align(src, tgt):
    """Grådig 1:1-justering fra tekstlikhet; returnerer {osVers: trVers}."""
    out = {}; ti = min(tgt)
    for v in sorted(src):
        best = (0.0, None)
        for cand in range(ti, ti + 3):
            if cand in tgt:
                s = sim(src[v], tgt[cand])
                if s > best[0]: best = (s, cand)
        if best[1] is None or best[0] < 0.5: return None
        out[v] = best[1]; ti = best[1] + 1
    return out

report = {}
for mod, source in [('osnb', 'osnb'), ('osnn', 'osnn'), ('osen', 'osnb')]:
    path = os.path.join(M, f'{mod}.ukvn.json')
    m = json.load(open(path))
    covered = set()
    for e in m['map']:
        covered.add(dec(e['kvnFrom'])[:2]); covered.add(dec(e['tkvnFrom'])[:2])
    bn = next((n for n, bid in m['bookNames'].items() if bid == 19), 'Sal')
    new_entries = []; fixed = []; unresolved = []
    for c in range(1, 151):
        o = verses('osmain', 19, c); t = verses(mod, 19, c)
        if not o or not t or set(o) == set(t) or (19, c) in covered: continue
        # osen (engelsk) arver osnb sin justering. osnn prøver nynorsk mot
        # bokmåls-osmain først, og faller tilbake på osnb der ordvalget
        # skiller for mye til at tekstlikhet avgjør.
        a = align(o, t) if source == mod else None
        if a is None:
            a = align(verses('osmain', 19, c), verses('osnb', 19, c))
        if a is None: unresolved.append(c); continue
        if all(v == tv for v, tv in a.items()) and len(t) == len(o):
            continue
        for v, tv in a.items():
            if tv not in t: continue
            if tv != v:
                new_entries.append({'kvnFrom': enc(19, c, v), 'kvnTo': enc(19, c, v),
                    'kvnRef': f'{bn} {c}:{v}', 'tkvnFrom': enc(19, c, tv), 'tkvnTo': enc(19, c, tv),
                    'tkvnRef': f'{bn} {c},{tv}', 'order': 0})
        # modulens vers uten motstykke: heng dem på forrige osmain-vers som delvers
        used = set(a.values()); prev = None
        for tv in sorted(t):
            if tv in used: prev = next((v for v, x in a.items() if x == tv), prev); continue
            if prev is None: continue
            new_entries.append({'kvnFrom': enc(19, c, prev) + 1, 'kvnTo': enc(19, c, prev) + 1,
                'kvnRef': f'{bn} {c}:{prev}b', 'tkvnFrom': enc(19, c, tv), 'tkvnTo': enc(19, c, tv),
                'tkvnRef': f'{bn} {c},{tv}', 'order': 0})
        fixed.append(c)
    if new_entries:
        m['map'] = m['map'] + new_entries
        m['map'].sort(key=lambda e: (e['kvnFrom'], e['order']))
        m['stats']['totalMappingEntries'] = len(m['map'])
        if not dry: json.dump(m, open(path, 'w'), ensure_ascii=False, indent=2)
    report[mod] = {'chapters': len(fixed), 'entries': len(new_entries), 'unresolved': unresolved}
    print(f"{mod}: {len(fixed)} kapitler, {len(new_entries)} entries" +
          (f", uavklart: {unresolved}" if unresolved else ""))
