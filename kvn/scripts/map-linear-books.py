#!/usr/bin/env python3
"""
Mapping ved lineær bok-korrespondanse (issue #18). Mål: 100 % rundtur.

Innsikten: oversettelser er uenige om hvor kapittel- og versgrensene går,
men ikke om rekkefølgen på innholdet. Har en modul like mange vers som
osmain i en bok, er tilordningen entydig bestemt — det i-te verset i modulen
svarer til den i-te posisjonen i osmain, uansett hvordan grensene faller.
Ingen lengdeheuristikk, ingen språkantakelse, ingen mønsterantakelse.

Det gjelder 74 % av alle (modul, bok)-par.

STATUS: IKKE TATT I BRUK — for grov slik den står.

Prøvd 2026-07-28: 70 343 entries i 276 moduler. Rundturen falt fra 36 896
til 34 751, men testsuiten fanget 45 ekte feil, blant dem
«4 Mos 16:23 -> 4 Mos 15,1». Lik boktotal garanterer ikke lik
innholdssekvens: mangler kilden et vers tidlig og har et ekstra senere,
stemmer totalen mens alt imellom forskyves. Korrelasjonsvakt over hele boka
er for grov til å fange det.

For å tas i bruk må vakten flyttes til kapittelnivå: hvert kapittel
verifiseres for seg, og bare de som består skrives. Rullet tilbake.

Kapitler med tekstverifiserte dommer røres ikke.

Bruk: python3 scripts/map-linear-books.py [--apply] [--book N]
"""
import json, os, sys, math, collections

REPO = os.path.join(os.path.dirname(__file__), '..', '..')
M = os.path.join(REPO, 'kvn', 'mappings')
RAW = os.path.join(REPO, 'generate', 'bibles_raw')
apply_ = '--apply' in sys.argv
only_book = int(sys.argv[sys.argv.index('--book') + 1]) if '--book' in sys.argv else None
PART = 16; MAXV = 177; MAXC = 151; MV = MAXV * PART; MC = MAXC * MV
def enc(b, c, v, p=0): return b * MC + c * MV + v * PART + p
def dec(k):
    p = k % PART; r1 = (k - p) // PART; v = r1 % MAXV; r2 = (r1 - v) // MAXV
    return (r2 // MAXC, r2 % MAXC, v, p)

def flat(mod, b):
    base = os.path.join(RAW, mod, str(b))
    if not os.path.isdir(base): return []
    out = []
    for c in sorted(int(f[:-5]) for f in os.listdir(base) if f.endswith('.json')):
        try:
            for x in json.load(open(os.path.join(base, f'{c}.json'))):
                out.append((c, x['verseId'], len(x['text'])))
        except Exception: return []
    return out

_osm = {}
def osm_flat(b):
    if b not in _osm: _osm[b] = flat('osmain', b)
    return _osm[b]

def corr(pairs):
    n = len(pairs)
    if n < 4: return 0.0
    ma = sum(x for x, _ in pairs) / n; mb = sum(y for _, y in pairs) / n
    cov = sum((x - ma) * (y - mb) for x, y in pairs)
    va = sum((x - ma) ** 2 for x, _ in pairs); vb = sum((y - mb) ** 2 for _, y in pairs)
    return cov / math.sqrt(va * vb) if va > 0 and vb > 0 else 0.0

verdict_keys = set()
vp = os.path.join(REPO, 'kvn', 'data', 'alignment-verdicts.json')
if os.path.exists(vp):
    for v in json.load(open(vp)): verdict_keys.add(v['key'])

written = collections.Counter(); rejected = collections.Counter(); touched = {}
for f in sorted(os.listdir(M)):
    if not f.endswith('.ukvn.json'): continue
    mod = f[:-10]
    if not os.path.isdir(os.path.join(RAW, mod)): continue
    mp = None
    for b in ([only_book] if only_book else range(1, 67)):
        O = osm_flat(b); T = flat(mod, b)
        if not O or not T or len(O) != len(T): continue
        pairs = list(zip(O, T))
        # kapitler der modulen ikke ligger på samme (kapittel, vers) som osmain
        diffs = [(o, t) for o, t in pairs if (o[0], o[1]) != (t[0], t[1])]
        if not diffs: continue
        chapters = {t[0] for _, t in diffs}
        if any(f'{b}:{c}' in verdict_keys for c in chapters): continue
        # vakt: lengdekorrelasjon for den utledede justeringen
        score = corr([(o[2], t[2]) for o, t in pairs])
        if score < 0.5: rejected[b] += 1; continue
        if mp is None: mp = touched.get(mod) or json.load(open(os.path.join(M, f)))
        bn = next((n for n, bid in mp['bookNames'].items() if bid == b), str(b))
        mp['map'] = [e for e in mp['map']
                     if not (dec(e['kvnFrom'])[0] == b and dec(e['tkvnFrom'])[1] in chapters)]
        for (oc, ov, _), (tc, tv, _) in diffs:
            mp['map'].append({'kvnFrom': enc(b, oc, ov), 'kvnTo': enc(b, oc, ov),
                'kvnRef': f'{bn} {oc}:{ov}', 'tkvnFrom': enc(b, tc, tv), 'tkvnTo': enc(b, tc, tv),
                'tkvnRef': f'{bn} {tc},{tv}', 'order': 0})
        written[b] += len(diffs)
        touched[mod] = mp

if apply_:
    for mod, mp in touched.items():
        mp['map'].sort(key=lambda e: (e['kvnFrom'], e['order']))
        mp['stats']['totalMappingEntries'] = len(mp['map'])
        json.dump(mp, open(os.path.join(M, f'{mod}.ukvn.json'), 'w'), ensure_ascii=False, indent=2)

print(f'{sum(written.values())} entries i {len(touched)} moduler {"skrevet" if apply_ else "ville blitt skrevet"}')
print('per bok:', dict(sorted(written.items())))
print('avvist av vakten (modul,bok):', sum(rejected.values()))
