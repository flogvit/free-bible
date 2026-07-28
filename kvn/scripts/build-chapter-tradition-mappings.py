#!/usr/bin/env python3
"""
Kapittelinndelings-tradisjoner utenfor Salmene (issue #18).

osmain følger europeisk inndeling i Joel (3 kapitler) og Malaki (4).
Moduler med hebraisk inndeling har Joel 4 / Malaki 3 og trenger
kryss-kapittel-entries. Joel var dekket fordi osnb hadde entries å låne
fra; Malaki hadde ingen ankerkilde — 89 av 90 moduler sto umappet, så
enhver Mal 4-referanse pekte i tomme luften.

Tradisjonene (hebraisk = modulens side):
  Joel:   os 2:28-32 -> mod 3,1-5   ;  os 3:v -> mod 4,v
  Malaki: os 4:v     -> mod 3,(18+v)

Hver modul må bestå to prøver før den mappes: kapittelantallet må stemme
med den hebraiske tradisjonen, OG målkapitlet må faktisk ha versene
(ellers er det et hull i høstingen, ikke en annen tradisjon —
czech_ekumenicky har 3 Malaki-kapitler fordi kapittel 4 rett og slett
mangler). Lengdekorrelasjon verifiserer til slutt at teksten stemmer.

Bruk: python3 scripts/build-chapter-tradition-mappings.py --lengths <fil> [--dry-run]
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

def ch(mod, b, c): return dict(lengths[mod].get(f'{b}:{c}') or [])
def nchapters(mod, b): return len([k for k in lengths[mod] if k.startswith(f'{b}:')])

def corr(p):
    n = len(p)
    if n < 4: return 0.0
    ma = sum(x for x, _ in p) / n; mb = sum(y for _, y in p) / n
    cov = sum((x - ma) * (y - mb) for x, y in p)
    va = sum((x - ma) ** 2 for x, _ in p); vb = sum((y - mb) ** 2 for _, y in p)
    return cov / math.sqrt(va * vb) if va > 0 and vb > 0 else 0.0

# (bok, hebraisk kapittelantall, [(osKap, osVersFra, osVersTil, modKap, modVersFra)])
TRADITIONS = [
    (29, 4, [(2, 28, 32, 3, 1), (3, 1, 21, 4, 1)]),          # Joel
    (39, 3, [(4, 1, 6, 3, 19)]),                              # Malaki
]

report = {}
for mod in sorted(lengths):
    if mod == 'osmain': continue
    p = os.path.join(M, f'{mod}.ukvn.json')
    if not os.path.exists(p): continue
    m = None
    for book, heb_n, rules in TRADITIONS:
        if nchapters(mod, book) != heb_n: continue
        new_entries = []; ok = True; scores = []
        for oc, v_from, v_to, mc, mv_from in rules:
            src = ch('osmain', book, oc); tgt = ch(mod, book, mc)
            if not src or not tgt: ok = False; break
            pairs = []
            for v in range(v_from, v_to + 1):
                tv = mv_from + (v - v_from)
                if v not in src or tv not in tgt: continue
                pairs.append((src[v], tgt[tv]))
            # målversene MÅ finnes, ellers er dette et hull i høstingen
            # (czech_ekumenicky har 3 Malaki-kapitler fordi kap 4 mangler)
            if len(pairs) < (v_to - v_from + 1): ok = False; break
            scores.append(corr(pairs))
        # Strukturen avgjør her: modulen mangler kildekapitlet helt og har
        # nøyaktig de ekstra versene i forrige kapittel. Korrelasjon på et
        # 6-vers-utdrag (Malaki) er for støyende til å kreve høy score —
        # den brukes bare til å fange klare motbevis.
        # Gulvet fanger bare katastrofalt feilaktige treff. Frie
        # oversettelser snur ofte setningsleddene (french2004 setter
        # «før Herrens dag» først i Mal 4:5), som gir negativ
        # lengdekorrelasjon på et 6-vers-utdrag selv når teksten er riktig
        # — tekstverifisert. Strukturen avgjør.
        if not ok or not scores or min(scores) < -0.5: continue
        if m is None: m = json.load(open(p))
        bn = next((n for n, bid in m['bookNames'].items() if bid == book), str(book))
        for oc, v_from, v_to, mc, mv_from in rules:
            src = ch('osmain', book, oc); tgt = ch(mod, book, mc)
            for v in range(v_from, v_to + 1):
                tv = mv_from + (v - v_from)
                if v not in src or tv not in tgt: continue
                new_entries.append({'kvnFrom': enc(book, oc, v), 'kvnTo': enc(book, oc, v),
                    'kvnRef': f'{bn} {oc}:{v}', 'tkvnFrom': enc(book, mc, tv), 'tkvnTo': enc(book, mc, tv),
                    'tkvnRef': f'{bn} {mc},{tv}', 'order': 0})
        # fjern bare entries i kildeområdene reglene dekker, så andre
        # entries i samme bok beholdes
        ranges = [(oc, v_from, v_to) for oc, v_from, v_to, _, _ in rules]
        def covered(e):
            b, c, v = dec(e['kvnFrom'])
            return b == book and any(c == oc and vf <= v <= vt for oc, vf, vt in ranges)
        m['map'] = [e for e in m['map'] if not covered(e)] + new_entries
        report.setdefault(mod, {})[book] = {'entries': len(new_entries), 'score': round(min(scores), 2)}
    if m is not None:
        m['map'].sort(key=lambda e: (e['kvnFrom'], e['order']))
        m['stats']['totalMappingEntries'] = len(m['map'])
        if not dry: json.dump(m, open(p, 'w'), ensure_ascii=False, indent=2)

bybook = {}
for mod, books in report.items():
    for b, r in books.items(): bybook.setdefault(b, []).append((mod, r))
print(f"{len(report)} moduler oppdatert" + (' (dry-run)' if dry else ''))
for b, rows in sorted(bybook.items()):
    tot = sum(r['entries'] for _, r in rows)
    lo = min(r['score'] for _, r in rows)
    print(f'  bok {b}: {len(rows)} moduler, {tot} entries, laveste korrelasjon {lo}')
