#!/usr/bin/env python3
"""
Finn osmain-vers med feil tekst — ved å følge mappingen, ikke posisjonen.

Lærdom fra 2026-07-28: å sammenligne osmain direkte mot en europeisk
oversettelse på samme versnummer er FEIL test. osmain følger ikke
europeisk rekkefølge internt i alle kapitler; mappingfilene er det som
definerer hva et osmain-nummer betyr, og de sier f.eks.
«osmain 2 Mos 8:1 -> kjv 8,5». Osmain-teksten der er riktig.

Riktig test: følg mappingen fra osmain til en referanseoversettelse og
sammenlign TEKST. Referansene er norske (dnb2011, dnb30, norwegian1921),
så sammenligningen er på samme språk og meningsfull — ingen kryssspråklig
gjetting.

Et avvik betyr at osmains tekst ikke er det mappingen hevder den er.
Terskelen er lav med vilje: ulike oversettelser formulerer seg ulikt, så
bare grove avvik (helt annet innhold) skal slå ut.

Bruk: python3 scripts/check-osmain-text-consistency.py [--ref NAVN]
Skriver kvn/data/osmain-text-inconsistencies.json
"""
import json, os, sys, collections
from difflib import SequenceMatcher

REPO = os.path.join(os.path.dirname(__file__), '..', '..')
RAW = os.path.join(REPO, 'generate', 'bibles_raw')
M = os.path.join(REPO, 'kvn', 'mappings')
PART = 16; MAXV = 177; MAXC = 151; MV = MAXV * PART; MC = MAXC * MV
def enc(b, c, v): return b * MC + c * MV + v * PART
def dec(k):
    p = k % PART; r1 = (k - p) // PART; v = r1 % MAXV; r2 = (r1 - v) // MAXV
    return (r2 // MAXC, r2 % MAXC, v, p)

REFS = sys.argv[sys.argv.index('--ref') + 1].split(',') if '--ref' in sys.argv \
       else ['dnb2011_nb', 'dnb30', 'norwegian1921', 'norwegian1938']

def chapter(mod, b, c):
    p = os.path.join(RAW, mod, str(b), f'{c}.json')
    if not os.path.exists(p): return {}
    try: return {x['verseId']: x['text'] for x in json.load(open(p))}
    except Exception: return {}

def sim(a, b):
    return SequenceMatcher(None, ' '.join(a.split())[:200], ' '.join(b.split())[:200]).ratio()

mappers = {}
for r in REFS:
    p = os.path.join(M, f'{r}.ukvn.json')
    if os.path.exists(p):
        mappers[r] = {e['kvnFrom']: e['tkvnFrom'] for e in json.load(open(p))['map']}

bad = []
osdir = os.path.join(RAW, 'osmain')
for book in sorted((int(x) for x in os.listdir(osdir) if x.isdigit())):
    bp = os.path.join(osdir, str(book))
    for chf in sorted(os.listdir(bp), key=lambda f: int(f[:-5]) if f.endswith('.json') else 0):
        if not chf.endswith('.json'): continue
        c = int(chf[:-5])
        o = chapter('osmain', book, c)
        for v, text in o.items():
            scores = []
            for r, fwd in mappers.items():
                k = enc(book, c, v)
                t = fwd.get(k, k)
                tb, tc, tv, _ = dec(t)
                rt = chapter(r, tb, tc).get(tv)
                if rt: scores.append((sim(text, rt), r, f'{tc},{tv}', rt))
            if not scores: continue
            best = max(scores)
            if best[0] < 0.35:      # helt annet innhold, ikke bare annen ordlyd
                bad.append({'ref': f'{book}:{c},{v}', 'osmain': text[:110],
                            'via': best[1], 'refVerse': best[2], 'refText': best[3][:110],
                            'sim': round(best[0], 2)})

by_ch = collections.Counter(x['ref'].rsplit(',', 1)[0] for x in bad)
print(f'{len(bad)} osmain-vers der teksten ikke stemmer med det mappingen hevder')
print('verste kapitler:', by_ch.most_common(12))
json.dump(bad, open(os.path.join(REPO, 'kvn', 'data', 'osmain-text-inconsistencies.json'), 'w'),
          ensure_ascii=False, indent=1)
