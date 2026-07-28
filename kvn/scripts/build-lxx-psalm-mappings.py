#!/usr/bin/env python3
"""
Salme-mapping for moduler med septuaginta-/Vulgata-nummerering (issue #18).

47 moduler (Vulgata-latin, russisk synodal, georgisk, armensk, kirkeslavisk
tradisjon) nummererer Salmene ett kapittel lavere enn hebraisk fra og med
Sal 11. Verken den utledede mappingen eller lengde-screenen oppdaget det:
begge sammenligner samme kapittelnummer, så de leste helt andre salmer.

Metode: den dokumenterte hebraisk→LXX-korrespondansen brukes som hypotese,
og lengdekorrelasjon verifiserer den per modul og kapittel. Et kapittel
mappes bare når hypotesen slår identitet klart (margin under). Innenfor
kapitlet søkes et lite versforskyv (titteltelling varierer).

Bruk: python3 scripts/build-lxx-psalm-mappings.py --lengths <fil> [--dry-run]
"""
import json, math, os, sys

REPO = os.path.join(os.path.dirname(__file__), '..', '..')
M = os.path.join(REPO, 'kvn', 'mappings')
PART = 16; MAXV = 177; MAXC = 151; MV = MAXV * PART; MC = MAXC * MV
def enc(b, c, v): return b * MC + c * MV + v * PART
def dec(k):
    p = k % PART; r1 = (k - p) // PART; v = r1 % MAXV; r2 = (r1 - v) // MAXV
    return (r2 // MAXC, r2 % MAXC, v)

lengths = json.load(open(sys.argv[sys.argv.index('--lengths') + 1]))
dry = '--dry-run' in sys.argv
osm = lengths['osmain']

def lxx_target(c, v):
    """hebraisk (kapittel, vers) -> LXX (kapittel, vers)"""
    if c <= 8 or 148 <= c <= 150: return (c, v)
    if c == 9: return (9, v)
    if c == 10: return (9, v + 21)
    if 11 <= c <= 113: return (c - 1, v)
    if c == 114: return (113, v)
    if c == 115: return (113, v + 8)
    if c == 116: return (114, v) if v <= 9 else (115, v - 9)
    if 117 <= c <= 146: return (c - 1, v)
    if c == 147: return (146, v) if v <= 11 else (147, v - 11)
    return (c, v)

def corr(p):
    n = len(p)
    if n < 4: return 0.0
    ma = sum(x for x, _ in p) / n; mb = sum(y for _, y in p) / n
    cov = sum((x - ma) * (y - mb) for x, y in p)
    va = sum((x - ma) ** 2 for x, _ in p); vb = sum((y - mb) ** 2 for _, y in p)
    return cov / math.sqrt(va * vb) if va > 0 and vb > 0 else 0.0

def chapter_len(mod, c): return dict(lengths[mod].get(f'19:{c}') or [])

def score_hypothesis(mod, c, voff):
    """korrelasjon for LXX-hypotesen med versforskyv voff"""
    a = dict(osm.get(f'19:{c}') or [])
    pairs = []; cache = {}
    for v, l in a.items():
        tc, tv = lxx_target(c, v); tv += voff
        if tc not in cache: cache[tc] = chapter_len(mod, tc)
        if tv in cache[tc]: pairs.append((l, cache[tc][tv]))
    return corr(pairs), len(pairs), len(a)

def score_identity(mod, c):
    a = dict(osm.get(f'19:{c}') or []); b = chapter_len(mod, c)
    pairs = [(l, b[v]) for v, l in a.items() if v in b]
    return corr(pairs), len(pairs)

MODULES = json.load(open(os.path.join(REPO, 'kvn', 'data', 'lxx-psalm-modules.json')))
MARGIN = 0.15
report = {}
for mod in MODULES:
    p = os.path.join(M, f'{mod}.ukvn.json')
    if not os.path.exists(p) or mod not in lengths: continue
    m = json.load(open(p))
    bn = next((n for n, bid in m['bookNames'].items() if bid == 19), '19')
    mapped = []; rejected = []
    new_entries = []

    # Nummerering er en global egenskap ved modulen, ikke en tilfeldighet per
    # kapittel: når LXX-skjemaet først er fastslått, gjelder tabellen hele
    # salteret. Korrelasjonen brukes derfor til å finne modulens dominerende
    # versforskyv og til å fange kapitler som taler IMOT hypotesen — ikke som
    # krav om bevis per kapittel. (Sal 119 har 176 jevnlange vers og gir
    # aldri signal; identitetsfallback der ville pekt på feil salme.)
    votes = {}
    for c in range(11, 114):
        if not osm.get(f'19:{c}'): continue
        ranked = sorted((score_hypothesis(mod, c, v)[0], v) for v in (0, -1, 1)
                        if score_hypothesis(mod, c, v)[1] >= 5)
        if len(ranked) >= 2 and ranked[-1][0] - ranked[-2][0] >= 0.05:
            votes[ranked[-1][1]] = votes.get(ranked[-1][1], 0) + 1
    dominant = max(votes, key=votes.get) if votes else 0

    for c in range(1, 151):
        if not osm.get(f'19:{c}'): continue
        scored = [(score_hypothesis(mod, c, v)[0], v, score_hypothesis(mod, c, v)[1])
                  for v in (0, -1, 1)]
        ranked = sorted((s_, v) for s_, v, n in scored if n >= 5)
        best = (ranked[-1][0], ranked[-1][1]) if ranked else None
        idsc, idn = score_identity(mod, c)
        if best is not None and idsc > best[0] + MARGIN:
            rejected.append(c); continue          # data taler imot hypotesen
        mapped.append(c)
        # Stol på kapitlets eget forskyv når det skiller seg klart fra
        # nest beste; ellers modulens dominerende (jevnlange kapitler som
        # Sal 119 gir ingen forskjell mellom kandidatene).
        if len(ranked) >= 2 and ranked[-1][0] - ranked[-2][0] >= 0.05:
            voff = ranked[-1][1]
        else:
            voff = dominant
        targeted = set()
        for v, _ in osm[f'19:{c}']:
            tc, tv = lxx_target(c, v); tv += voff
            if tv not in chapter_len(mod, tc): continue
            targeted.add((tc, tv))
            if tc == c and tv == v: continue
            new_entries.append({'kvnFrom': enc(19, c, v), 'kvnTo': enc(19, c, v),
                'kvnRef': f'{bn} {c}:{v}', 'tkvnFrom': enc(19, tc, tv), 'tkvnTo': enc(19, tc, tv),
                'tkvnRef': f'{bn} {tc},{tv}', 'order': 0})
        # Modulen teller ofte overskriften som eget vers der osmain fletter
        # den inn i vers 1. Et slikt vers MÅ få en entry: uten den faller det
        # tilbake på identitet, som i en kapittelforskjøvet bok alltid peker
        # på feil salme. Modelleres som delvers (osnb gjør det samme med
        # Sal 19:1a/1b): del 1 = overskrift, del 2 = innhold. Helverset
        # beholder sin entry til innholdsverset, så forover-oppslag er
        # entydig og begge veier slår opp riktig.
        first_v = osm[f'19:{c}'][0][0]
        tc0, tv0 = lxx_target(c, first_v)
        for i, tv in enumerate(range(tv0, tv0 + voff)):
            if (tc0, tv) in targeted or tv not in chapter_len(mod, tc0): continue
            new_entries.append({'kvnFrom': enc(19, c, first_v) + i + 1, 'kvnTo': enc(19, c, first_v) + i + 1,
                'kvnRef': f'{bn} {c}:{first_v}{chr(97 + i)}', 'tkvnFrom': enc(19, tc0, tv), 'tkvnTo': enc(19, tc0, tv),
                'tkvnRef': f'{bn} {tc0},{tv}', 'order': 0})
            tail = enc(19, c, first_v) + i + 2
            new_entries.append({'kvnFrom': tail, 'kvnTo': tail,
                'kvnRef': f'{bn} {c}:{first_v}{chr(98 + i)}', 'tkvnFrom': enc(19, tc0, tv + 1), 'tkvnTo': enc(19, tc0, tv + 1),
                'tkvnRef': f'{bn} {tc0},{tv + 1}', 'order': 0})
    if not mapped: continue
    m['map'] = [e for e in m['map'] if dec(e['kvnFrom'])[0] != 19] + new_entries
    m['map'].sort(key=lambda e: (e['kvnFrom'], e['order']))
    m['stats']['totalMappingEntries'] = len(m['map'])
    m.setdefault('derived', {})['lxxPsalms'] = {'mappedChapters': len(mapped), 'rejectedChapters': rejected}
    if not dry: json.dump(m, open(p, 'w'), ensure_ascii=False, indent=2)
    report[mod] = {'mapped': len(mapped), 'rejected': len(rejected), 'entries': len(new_entries)}

tot_e = sum(r['entries'] for r in report.values())
print(f"{len(report)} moduler, {tot_e} salme-entries" + (' (dry-run)' if dry else ''))
for mod, r in sorted(report.items()):
    print(f"  {mod}: {r['mapped']} kapitler mappet, {r['rejected']} avvist, {r['entries']} entries")
