#!/usr/bin/env python3
"""
Klassifiser hvorfor vers ikke kommer tilbake gjennom osmain (issue #18).

Mål: 100 % rundtur. For hvert vers som feiler avgjøres hvilken av tre
løsninger som trengs — i denne rekkefølgen, siden de to første ikke rører
osmain og ikke ugyldiggjør noen eksisterende entry:

  UNCLAIMED   det finnes en ledig osmain-posisjon i samme kapittel som
              ingen entry peker på. Trenger bare en entry.
  PART        osmain har innholdet flettet inn i et annet vers. Trenger
              en delvers-entry (part-feltet, slik README beskriver for
              Sal 92 — det er den sanksjonerte mekanismen for fletting).
  NEEDS_SLOT  osmain har ingen posisjon igjen i kapitlet. Da må osmain
              utvides. Deles i 'append' (etter siste vers — renummererer
              ingenting) og 'insert' (krever renummerering og oppdatering
              av mappingene som peker forbi innsettingspunktet).

Bruk: python3 scripts/classify-roundtrip-failures.py
Skriver kvn/data/roundtrip-failure-classes.json
"""
import json, os, collections

REPO = os.path.join(os.path.dirname(__file__), '..', '..')
M = os.path.join(REPO, 'kvn', 'mappings')
RAW = os.path.join(REPO, 'generate', 'bibles_raw')
PART = 16; MAXV = 177; MAXC = 151; MV = MAXV * PART; MC = MAXC * MV
def enc(b, c, v, p=0): return b * MC + c * MV + v * PART + p
def dec(k):
    p = k % PART; r1 = (k - p) // PART; v = r1 % MAXV; r2 = (r1 - v) // MAXV
    return (r2 // MAXC, r2 % MAXC, v, p)

def chapter(mod, b, c):
    p = os.path.join(RAW, mod, str(b), f'{c}.json')
    if not os.path.exists(p): return {}
    return {x['verseId']: x['text'] for x in json.load(open(p))}

osmain_cache = {}
def osm(b, c):
    if (b, c) not in osmain_cache: osmain_cache[(b, c)] = chapter('osmain', b, c)
    return osmain_cache[(b, c)]

classes = collections.Counter()
detail = collections.defaultdict(lambda: collections.Counter())
examples = {}

for f in sorted(os.listdir(M)):
    if not f.endswith('.ukvn.json'): continue
    mod = f[:-10]
    if not os.path.isdir(os.path.join(RAW, mod)): continue
    m = json.load(open(os.path.join(M, f)))
    fwd = {}; rev = {}
    for e in m['map']:
        fwd[e['kvnFrom']] = e['tkvnFrom']
        rev.setdefault(e['tkvnFrom'], e['kvnFrom'])
    claimed = collections.defaultdict(set)   # osmain-vers som en entry bruker
    for k in fwd:
        b, c, v, p = dec(k)
        claimed[(b, c)].add(v)
    def to_kvn(t):
        if t in rev: return rev[t]
        p = t % PART
        if p and (t - p) in rev: return rev[t - p] + p
        return t
    def to_tkvn(k):
        if k in fwd: return fwd[k]
        p = k % PART
        if p and (k - p) in fwd: return fwd[k - p] + p
        return k

    base = os.path.join(RAW, mod)
    for book in os.listdir(base):
        bp = os.path.join(base, book)
        if not book.isdigit() or not os.path.isdir(bp): continue
        for chf in os.listdir(bp):
            if not chf.endswith('.json'): continue
            b, c = int(book), int(chf[:-5])
            try: verses = [x['verseId'] for x in json.load(open(os.path.join(bp, chf)))]
            except Exception: continue
            o = osm(b, c)
            for v in verses:
                t = enc(b, c, v)
                if to_tkvn(to_kvn(t)) == t: continue
                # er osmain-posisjonen i samme kapittel ledig?
                free = [ov for ov in o if ov not in claimed[(b, c)] and enc(b, c, ov) not in fwd]
                if v in o and v not in claimed[(b, c)]:
                    cls = 'UNCLAIMED'
                elif free:
                    cls = 'UNCLAIMED'
                elif o:
                    cls = 'PART'
                else:
                    cls = 'NEEDS_SLOT'
                classes[cls] += 1
                detail[cls][f'{b}:{c}'] += 1
                examples.setdefault(f'{cls}|{b}:{c}', f'{mod} {b}:{c},{v}')

print('klasser:', dict(classes))
for cls in classes:
    print(f'\n{cls} — verste kapitler:')
    for key, n in detail[cls].most_common(8):
        print(f'   {key}: {n} vers   (f.eks. {examples.get(f"{cls}|{key}")})')
json.dump({'classes': dict(classes),
           'byChapter': {k: dict(v) for k, v in detail.items()},
           'examples': examples},
          open(os.path.join(REPO, 'kvn', 'data', 'roundtrip-failure-classes.json'), 'w'),
          ensure_ascii=False, indent=1)
