#!/usr/bin/env python3
"""
Mapping ved lineær bok-korrespondanse, verifisert per kapittel (issue #18).

Oversettelser er uenige om hvor kapittel- og versgrensene går, men ikke om
rekkefølgen på innholdet. Har en modul like mange vers som osmain i en bok,
er tilordningen entydig: det i-te verset i modulen svarer til den i-te
posisjonen i osmain.

Forrige forsøk (map-linear-books.py) skrev dette rett ut med én
korrelasjonsvakt for hele boka, og produserte «4 Mos 16:23 -> 15,1»:
mangler kilden et vers tidlig og har et ekstra senere, stemmer boktotalen
mens alt imellom er forskjøvet. Testsuiten fanget 45 slike.

Her verifiseres HVERT KAPITTEL for seg før det skrives:
  - lengdekorrelasjonen for den utledede justeringen må være god
  - og minst like god som den mappingen kapitlet har fra før
  - kapitlet må ikke sprike mer enn ett kapittel fra osmain (en modul som
    lander tre kapitler unna er et symptom på hull i kilden, ikke en
    versifikasjonsforskjell)
Kapitler som ikke består, skrives ikke. Kapitler med tekstverifiserte
dommer røres ikke.

Forutsetter at osmains egen tekst er korrekt — grenseversene ble rettet
for hånd 2026-07-28 (43 duplikater -> 0).

Bruk: python3 scripts/map-linear-chapters.py [--apply]
"""
import json, os, sys, math, collections

REPO = os.path.join(os.path.dirname(__file__), '..', '..')
M = os.path.join(REPO, 'kvn', 'mappings')
RAW = os.path.join(REPO, 'generate', 'bibles_raw')
apply_ = '--apply' in sys.argv
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
    if n < 5: return None
    ma = sum(x for x, _ in pairs) / n; mb = sum(y for _, y in pairs) / n
    cov = sum((x - ma) * (y - mb) for x, y in pairs)
    va = sum((x - ma) ** 2 for x, _ in pairs); vb = sum((y - mb) ** 2 for _, y in pairs)
    return cov / math.sqrt(va * vb) if va > 0 and vb > 0 else None

verdict_keys = set()
vp = os.path.join(REPO, 'kvn', 'data', 'alignment-verdicts.json')
if os.path.exists(vp):
    for v in json.load(open(vp)): verdict_keys.add(v['key'])

MIN_CORR = 0.6
written = collections.Counter(); rejected = collections.Counter(); touched = {}
for f in sorted(os.listdir(M)):
    if not f.endswith('.ukvn.json'): continue
    mod = f[:-10]
    if not os.path.isdir(os.path.join(RAW, mod)): continue
    mp = None
    for b in range(1, 67):
        O = osm_flat(b); T = flat(mod, b)
        if not O or not T or len(O) != len(T): continue
        # grupper parene per modulkapittel
        per_ch = collections.defaultdict(list)
        for (oc, ov, ol), (tc, tv, tl) in zip(O, T):
            per_ch[tc].append(((oc, ov, ol), (tc, tv, tl)))
        for tc, rows in per_ch.items():
            if f'{b}:{tc}' in verdict_keys: continue
            if all((o[0], o[1]) == (t[0], t[1]) for o, t in rows): continue
            if any(abs(o[0] - t[0]) > 1 for o, t in rows):
                rejected['kapittelsprik'] += 1; continue
            new_score = corr([(o[2], t[2]) for o, t in rows])
            if new_score is None or new_score < MIN_CORR:
                rejected['svak korrelasjon'] += 1; continue
            # sammenlign med det kapitlet har fra før (identitet der ingen entry finnes)
            if mp is None: mp = touched.get(mod) or json.load(open(os.path.join(M, f)))
            cur = {}
            for e in mp['map']:
                kb, kc, kv, kp = dec(e['kvnFrom']); tb, tcc, tvv, _ = dec(e['tkvnFrom'])
                if kb == b and tcc == tc and not kp: cur[(kc, kv)] = tvv
            tl_by_v = {t[1]: t[2] for _, t in rows}
            ol_by = {(o[0], o[1]): o[2] for o, _ in rows}
            old_pairs = []
            for (oc, ov), ol in ol_by.items():
                tv = cur.get((oc, ov), ov if oc == tc else None)
                if tv in tl_by_v: old_pairs.append((ol, tl_by_v[tv]))
            old_score = corr(old_pairs)
            if old_score is not None and new_score < old_score:
                rejected['ikke bedre'] += 1; continue
            bn = next((n for n, bid in mp['bookNames'].items() if bid == b), str(b))
            mp['map'] = [e for e in mp['map']
                         if not (dec(e['kvnFrom'])[0] == b and dec(e['tkvnFrom'])[1] == tc)]
            for (oc, ov, _), (_, tv, _) in rows:
                if (oc, ov) == (tc, tv): continue
                mp['map'].append({'kvnFrom': enc(b, oc, ov), 'kvnTo': enc(b, oc, ov),
                    'kvnRef': f'{bn} {oc}:{ov}', 'tkvnFrom': enc(b, tc, tv), 'tkvnTo': enc(b, tc, tv),
                    'tkvnRef': f'{bn} {tc},{tv}', 'order': 0})
            written[b] += 1
            touched[mod] = mp

if apply_:
    for mod, mp in touched.items():
        mp['map'].sort(key=lambda e: (e['kvnFrom'], e['order']))
        mp['stats']['totalMappingEntries'] = len(mp['map'])
        json.dump(mp, open(os.path.join(M, f'{mod}.ukvn.json'), 'w'), ensure_ascii=False, indent=2)

print(f'{sum(written.values())} kapitler i {len(touched)} moduler {"skrevet" if apply_ else "ville blitt skrevet"}')
print('avvist:', dict(rejected))
