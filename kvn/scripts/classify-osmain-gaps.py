#!/usr/bin/env python3
"""
Klassifiser hull i osmain: flettet innhold vs. ekte manglende vers.

osmain skal være supersettet av alle oversettelsers vers. Når en modul har
et vers osmain ikke har nummer for, er det to muligheter:

  FLETTET   innholdet finnes i osmain, inne i et naboverset. Da er
            delvers-mapping riktig (osmain v -> tr v og v+1) og osmain
            trenger ingen nye vers.
  MANGLER   innholdet finnes ikke i osmain i det hele tatt. Da må osmain
            utvides — ellers kan verset aldri refereres kanonisk.

Skillet avgjøres på tekst, ikke på versantall: modulens ekstra vers
sammenlignes mot alle osmain-vers i kapitlet. osnb brukes som kilde siden
den deler språk med osmain (bokmål), slik at likhet er meningsfull.

MANGLER deles videre i 'append' (verset ligger sist i kapitlet — kan legges
til uten å renummerere noe) og 'insert' (midt i — renummerering ville
ugyldiggjort alle eksisterende mappinger, så det krever egen håndtering).

Bruk: python3 scripts/classify-osmain-gaps.py
Skriver kvn/data/osmain-gap-classification.json
"""
import json, os
from difflib import SequenceMatcher

REPO = os.path.join(os.path.dirname(__file__), '..', '..')
RAW = os.path.join(REPO, 'generate', 'bibles_raw')

def verses(mod, b, c):
    p = os.path.join(RAW, mod, str(b), f'{c}.json')
    if not os.path.exists(p): return {}
    return {x['verseId']: x['text'] for x in json.load(open(p))}

def contained(needle, haystack):
    """Er needle-teksten en del av haystack (flettet vers)?"""
    n = ' '.join(needle.split()); h = ' '.join(haystack.split())
    if n and n in h: return True
    # tåler små redaksjonelle forskjeller
    best = 0.0
    for size in (len(n),):
        for i in range(0, max(1, len(h) - size + 1), 24):
            best = max(best, SequenceMatcher(None, n, h[i:i + size]).ratio())
    return best >= 0.75

cands = json.load(open(os.path.join(REPO, 'kvn', 'data', 'osmain-extension-candidates.json')))
out = {'merged': [], 'missing_append': [], 'missing_insert': [], 'unknown': []}
for c in cands['trolig_ekte']:
    book, ch = map(int, c['chapter'].split(':'))
    o = verses('osmain', book, ch); n = verses('osnb', book, ch)
    if not o or not n: out['unknown'].append(c); continue
    # Grensevers ligger i osmains NABOKAPITTEL (Jes 8,23 = osmain Jes 9,1),
    # så innholdet må søkes der også — ellers ser det ut som et hull.
    neighbours = {}
    for nc in (ch - 1, ch + 1):
        for ov, ot in verses('osmain', book, nc).items():
            neighbours[(nc, ov)] = ot
    for v in c['missingVerseNumbers']:
        if v not in n: out['unknown'].append({**c, 'verse': v}); continue
        text = n[v]
        in_neighbour = next((k for k, ot in neighbours.items() if contained(text, ot)), None)
        if in_neighbour:
            out.setdefault('chapter_division', []).append(
                {'chapter': c['chapter'], 'verse': v, 'modules': c['modules'],
                 'osmainLocation': f'{book}:{in_neighbour[0]},{in_neighbour[1]}', 'text': text})
            continue
        merged_into = next((ov for ov, ot in o.items() if contained(text, ot)), None)
        row = {'chapter': c['chapter'], 'verse': v, 'modules': c['modules'], 'text': text}
        if merged_into:
            row['mergedInto'] = merged_into
            out['merged'].append(row)
        elif v > max(o):
            out['missing_append'].append(row)
        else:
            out['missing_insert'].append(row)

json.dump({'_om': 'Klassifisering av hull i osmain. FLETTET = innholdet finnes inne i et osmain-vers (delvers-mapping er riktig). MANGLER = innholdet finnes ikke; append kan legges til uten renummerering, insert krever det.',
           'sist_oppdatert': '2026-07-28', **out},
          open(os.path.join(REPO, 'kvn', 'data', 'osmain-gap-classification.json'), 'w'),
          ensure_ascii=False, indent=1)
for k in ('merged', 'chapter_division', 'missing_append', 'missing_insert', 'unknown'):
    print(f'{k}: {len(out.get(k, []))}')
    for r in out.get(k, [])[:4]:
        print(f"   {r.get('chapter')},{r.get('verse')}: {str(r.get('text',''))[:64]}")
