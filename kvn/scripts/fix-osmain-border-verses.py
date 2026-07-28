#!/usr/bin/env python3
"""
Reparer osmains grensevers med feil tekst (kvn/BOUNDARY-VERSE-ISSUES.md).

osmain følger europeisk kapittelinndeling. Ved grensene trengs teksten fra
osnbs nabokapittel (hebraisk inndeling), men byggescriptet kopierte feil
vers. Resultatet er at osmain har samme tekst to steder — f.eks. 4 Mos
16,40 som er en kopi av 17,3, mens web har noe helt annet på 16,40.

Fiksen henter riktig tekst via osnb-mappingen, som er verifisert korrekt
for versifikasjonsforskjellene, og godtar den bare når to uavhengige
kontroller stemmer:
  1. teksten er IKKE lik den osmain allerede har (ellers er det ingen feil)
  2. lengden ligger nær det europeisk-nummererte oversettelser har på
     samme posisjon (web/kjv/norwegian1921/dnb2011) — fanger at vi henter
     fra riktig sted, på tvers av språk

Kjør uten flagg for tørrkjøring; --apply skriver.
"""
import json, os, sys, statistics
from difflib import SequenceMatcher

REPO = os.path.join(os.path.dirname(__file__), '..', '..')
RAW = os.path.join(REPO, 'generate', 'bibles_raw')
apply = '--apply' in sys.argv
PART = 16; MAXV = 177; MAXC = 151; MV = MAXV * PART; MC = MAXC * MV
def enc(b, c, v): return b * MC + c * MV + v * PART
def dec(k):
    p = k % PART; r1 = (k - p) // PART; v = r1 % MAXV; r2 = (r1 - v) // MAXV
    return (r2 // MAXC, r2 % MAXC, v)

def verses(mod, b, c):
    p = os.path.join(RAW, mod, str(b), f'{c}.json')
    if not os.path.exists(p): return {}
    return {x['verseId']: x['text'] for x in json.load(open(p))}

osnb_map = json.load(open(os.path.join(REPO, 'kvn', 'mappings', 'osnb.ukvn.json')))
fwd = {e['kvnFrom']: e['tkvnFrom'] for e in osnb_map['map']}
def to_osnb(b, c, v):
    k = enc(b, c, v)
    return dec(fwd[k]) if k in fwd else (b, c, v)

REFS = ['web', 'kjv', 'norwegian1921', 'dnb2011_nb']
S = os.path.join(os.path.dirname(__file__), '..', 'data')
dups = json.load(open(os.path.join(REPO, 'kvn', 'data', 'osmain-border-duplicates.json')))

fixes = []; skipped = []
for d in dups:
    for loc in d['locations']:
        b, c, v = loc
        cur = verses('osmain', b, c).get(v)
        ob, oc, ov = to_osnb(b, c, v)
        cand = verses('osnb', ob, oc).get(ov)
        if not cur or not cand: continue
        if SequenceMatcher(None, cur[:150], cand[:150]).ratio() > 0.9: continue  # allerede riktig
        # kontroll 2: lengden skal ligne det europeiske oversettelser har her
        ref_lens = [len(verses(m, b, c).get(v, '')) for m in REFS]
        ref_lens = [x for x in ref_lens if x]
        if len(ref_lens) < 2: skipped.append((loc, 'for få referanser')); continue
        med = statistics.median(ref_lens)
        if not (0.5 * med <= len(cand) <= 1.9 * med):
            skipped.append((loc, f'lengde {len(cand)} vs referanse {med:.0f}')); continue
        fixes.append({'location': loc, 'from': cur[:70], 'to': cand[:70],
                      'osnbSource': [ob, oc, ov], 'refMedian': med, 'text': cand})

print(f'{len(fixes)} grensevers med feil tekst kan repareres, {len(skipped)} avvist av kontrollene')
for f in fixes[:10]:
    print(f"  osmain {f['location']} <- osnb {f['osnbSource']}")
    print(f"      nå:  {f['from']}")
    print(f"      ny:  {f['to']}")
for s in skipped[:5]: print(f'  avvist {s[0]}: {s[1]}')

if apply:
    byfile = {}
    for f in fixes: byfile.setdefault(tuple(f['location'][:2]), []).append(f)
    for (b, c), rows in byfile.items():
        p = os.path.join(RAW, 'osmain', str(b), f'{c}.json')
        data = json.load(open(p))
        for x in data:
            for r in rows:
                if x['verseId'] == r['location'][2]: x['text'] = r['text']
        json.dump(data, open(p, 'w'), ensure_ascii=False, indent=2)
    print(f'skrevet: {len(fixes)} vers i {len(byfile)} kapitler')
json.dump(fixes, open(os.path.join(REPO, 'kvn', 'data', 'osmain-border-fixes.json'), 'w'),
          ensure_ascii=False, indent=1)
