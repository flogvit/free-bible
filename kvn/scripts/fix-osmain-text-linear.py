#!/usr/bin/env python3
"""
Reparer osmains grensevers-tekst ved lineær tilordning fra osnb.

BOUNDARY-VERSE-ISSUES.md: osmain ble bygget fra osnb med renummerering, og
byggescriptet hentet feil vers ved kapittelgrensene. Dokumentet foreskriver
manuell retting mot KJV, grunnteksten og osnb, og advarer mot script fordi
det forrige antok at alle var Type 1 (sekvensielt skift) mens mange er
Type 2 (wrap-around).

Denne metoden gjør ingen slik antakelse. osmain ER osnb-tekst med andre
kapittelgrenser, og innholdssekvensen er lineær: flater man ut hele boka i
begge, skal det i-te verset i osmain ha teksten fra det i-te verset i osnb,
uansett hvordan grensene faller. Ingen mønsterantakelse, samme språk, ingen
kryssspråklig gjetting.

Gjelder kun bøker der totalt versantall er likt i osnb og osmain (54 av 66).
De 12 andre (Est og Dan med greske tillegg, Sal med overskriftsfletting,
Rom/Neh/Jes/Apg/2 Kor med ekstra vers) har ikke 1:1-korrespondanse og må
håndteres for seg.

Validert mot dokumenterte feil: 2 Mos 8:30 gir «Moses gikk ut fra farao og
ba til Herren» (= webs "Moses went out from Pharaoh, and prayed"), og
2 Mos 22:31 gir «Dere skal være hellige mennesker for meg» (= "You shall be
holy men to me"). Begge står feil i osmain i dag.

Bruk: python3 scripts/fix-osmain-text-linear.py [--apply]
"""
import json, os, sys, collections
from difflib import SequenceMatcher

REPO = os.path.join(os.path.dirname(__file__), '..', '..')
RAW = os.path.join(REPO, 'generate', 'bibles_raw')
apply_ = '--apply' in sys.argv

def flat(mod, b):
    base = os.path.join(RAW, mod, str(b))
    if not os.path.isdir(base): return []
    out = []
    for c in sorted(int(f[:-5]) for f in os.listdir(base) if f.endswith('.json')):
        for x in json.load(open(os.path.join(base, f'{c}.json'))):
            out.append((c, x['verseId'], x['text']))
    return out

def sim(a, b):
    return SequenceMatcher(None, ' '.join(a.split())[:180], ' '.join(b.split())[:180]).ratio()

changes = collections.defaultdict(list)   # (bok, kapittel) -> [(vers, ny tekst, gammel)]
skipped_books = []
for b in range(1, 67):
    a = flat('osnb', b); o = flat('osmain', b)
    if not a or not o: continue
    if len(a) != len(o):
        skipped_books.append((b, len(a), len(o))); continue
    for (oc, ov, otext), (_, _, atext) in zip(o, a):
        if sim(otext, atext) < 0.9:
            changes[(b, oc)].append((ov, atext, otext))

total = sum(len(v) for v in changes.values())
print(f'{len(skipped_books)} bøker hoppet over (ulikt versantall): {[b for b,_,_ in skipped_books]}')
print(f'{total} vers i {len(changes)} kapitler får ny tekst')
by_book = collections.Counter(b for (b, c) in changes)
print('per bok:', dict(sorted(by_book.items())))
for (b, c), rows in sorted(changes.items())[:6]:
    for ov, new, old in rows[:2]:
        print(f'  {b}:{c},{ov}')
        print(f'     nå : {old[:66]}')
        print(f'     ny : {new[:66]}')

if apply_:
    for (b, c), rows in changes.items():
        p = os.path.join(RAW, 'osmain', str(b), f'{c}.json')
        data = json.load(open(p))
        by_id = {r[0]: r[1] for r in rows}
        for x in data:
            if x['verseId'] in by_id: x['text'] = by_id[x['verseId']]
        json.dump(data, open(p, 'w'), ensure_ascii=False, indent=2)
    print(f'skrevet: {total} vers i {len(changes)} kapitler')
json.dump({'changed': total, 'skippedBooks': skipped_books,
           'chapters': {f'{b}:{c}': [r[0] for r in rows] for (b, c), rows in changes.items()}},
          open(os.path.join(REPO, 'kvn', 'data', 'osmain-text-fixes.json'), 'w'),
          ensure_ascii=False, indent=1)
