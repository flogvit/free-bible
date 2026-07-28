#!/usr/bin/env python3
"""
Generisk deteksjon av kapittelnummererings-tradisjoner (issue #18).

Salme-funnet (47 moduler med LXX-nummerering) viste at både den utledede
byggeren og lengde-screenen er blinde for kapittelforskyv: begge
sammenligner samme kapittelnummer. Samme feilklasse kan finnes i andre
bøker med kjente tradisjoner (Joel 3/4, Malaki 3/4, ...).

Metode: for hver modul × bok samples kapitler spredt gjennom boka, og
osmain-kapitlet sammenlignes med modulens kapittel c-2..c+2 på
lengdekorrelasjon. Vinner et forskyv ulikt 0 konsistent, flagges
(modul, bok) for nærmere analyse.

Bruk: python3 scripts/detect-chapter-offsets.py --lengths <fil> [--book N]
Skriver kvn/data/chapter-offset-findings.json
"""
import json, math, os, sys

REPO = os.path.join(os.path.dirname(__file__), '..', '..')
lengths = json.load(open(sys.argv[sys.argv.index('--lengths') + 1]))
only_book = int(sys.argv[sys.argv.index('--book') + 1]) if '--book' in sys.argv else None
osm = lengths['osmain']

# Salmene er allerede håndtert av build-lxx-psalm-mappings for disse
lxx = set(json.load(open(os.path.join(REPO, 'kvn', 'data', 'lxx-psalm-modules.json'))))

def corr(p):
    n = len(p)
    if n < 5: return None
    ma = sum(x for x, _ in p) / n; mb = sum(y for _, y in p) / n
    cov = sum((x - ma) * (y - mb) for x, y in p)
    va = sum((x - ma) ** 2 for x, _ in p); vb = sum((y - mb) ** 2 for _, y in p)
    return cov / math.sqrt(va * vb) if va > 0 and vb > 0 else None

# indekser osmain per bok
osm_books = {}
for key, vs in osm.items():
    b, c = key.split(':')
    osm_books.setdefault(int(b), {})[int(c)] = dict(vs)

mod_index = {}
for mod, fp in lengths.items():
    if mod == 'osmain': continue
    d = {}
    for key, vs in fp.items():
        b, c = key.split(':')
        d.setdefault(int(b), {})[int(c)] = dict(vs)
    mod_index[mod] = d

def best_offset(osch, modbook, c):
    """beste kapittelforskyv for osmain-kapittel c"""
    a = osch
    scores = []
    for off in (-2, -1, 0, 1, 2):
        b = modbook.get(c + off)
        if not b: continue
        # tolerer lite versforskyv innad i kapitlet
        best = None
        for voff in (0, -1, 1):
            s = corr([(l, b[v + voff]) for v, l in a.items() if v + voff in b])
            if s is not None and (best is None or s > best): best = s
        if best is not None: scores.append((best, off))
    if len(scores) < 2: return None
    scores.sort()
    return scores[-1], scores[-2]

findings = []
books = [only_book] if only_book else sorted(osm_books)
for mod, mb in mod_index.items():
    for book in books:
        if book not in mb or book not in osm_books: continue
        if book == 19 and mod in lxx: continue      # allerede fikset
        chapters = sorted(osm_books[book])
        if len(chapters) <= 5: sample = chapters
        else: sample = [chapters[int(len(chapters) * f)] for f in (0.15, 0.35, 0.55, 0.75, 0.95)]
        votes = {}
        for c in sample:
            r = best_offset(osm_books[book][c], mb[book], c)
            if not r: continue
            (s1, off1), (s2, _) = r
            if s1 - s2 >= 0.15: votes[off1] = votes.get(off1, 0) + 1
        if not votes: continue
        win = max(votes, key=votes.get)
        if win != 0 and votes[win] >= max(2, len(sample) // 2):
            findings.append({'module': mod, 'book': book, 'offset': win,
                             'votes': votes[win], 'sampled': len(sample)})

out = os.path.join(REPO, 'kvn', 'data', 'chapter-offset-findings.json')
json.dump(findings, open(out, 'w'), indent=1)
bybook = {}
for f in findings: bybook.setdefault(f['book'], []).append(f)
print(f'{len(findings)} (modul, bok)-funn med kapittelforskyv')
for b in sorted(bybook, key=lambda x: -len(bybook[x])):
    offs = {}
    for f in bybook[b]: offs[f['offset']] = offs.get(f['offset'], 0) + 1
    print(f'  bok {b}: {len(bybook[b])} moduler, forskyv {offs}')
