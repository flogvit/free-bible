#!/usr/bin/env python3
"""
Fullstendig justering osmain <-> oversettelse for kapitler som ikke
kommer tilbake gjennom osmain (issue #18). Mål: 100 % rundtur.

STATUS: IKKE TATT I BRUK. Validering mot kjente kapitler viser at metoden
treffer der forskjellen er splitt/fletting inne i kapitlet (Sal 51,
1 Krøn 5), men bommer der osmain selv har feil tekst — Dan 4 i osmain har
hebraisk innhold på europeisk nummerering, en av de 133 grenseversene i
kvn/BOUNDARY-VERSE-ISSUES.md. En innholdsbasert justering kan ikke virke
mot en referanse med feil tekst. Grenseversene må fikses først (manuelt,
slik dokumentet foreskriver — et script ble prøvd og rullet tilbake fordi
det antok at alle var Type 1).

Et forsøk på semi-global justering over et kapittelvindu (for å fange
forskyvning over kapittelgrenser) gjorde det verre: frie ender lot
justeringen drive inn i nabokapitler og ødela Sal 51 og Jes 64, som var
riktige med varianten under.

Metoden er Gale-Church-justering på verselengder: en dynamisk programmering
som finner den monotone justeringen med lavest kostnad, der hvert steg kan
være 1:1, 1:2 (osmain-verset er delt i oversettelsen) eller 2:1 (osmain
fletter to). Lengdeforhold fungerer på tvers av språk fordi et langt vers
er langt i alle oversettelser; forholdet normaliseres per kapittel.

1:2-steg blir delvers-entries (part-feltet), som er den mekanismen README
beskriver for fletting. Ingen vers legges til osmain, og ingen eksisterende
entry i andre kapitler røres.

Kapitler dekket av tekstverifiserte dommer (alignment-verdicts.json) hoppes
over — en dom lest av et menneske slår en heuristikk.

Bruk: python3 scripts/align-chapters.py [--apply] [--limit N]
"""
import json, os, sys, collections

REPO = os.path.join(os.path.dirname(__file__), '..', '..')
M = os.path.join(REPO, 'kvn', 'mappings')
RAW = os.path.join(REPO, 'generate', 'bibles_raw')
apply_ = '--apply' in sys.argv
limit = int(sys.argv[sys.argv.index('--limit') + 1]) if '--limit' in sys.argv else None
PART = 16; MAXV = 177; MAXC = 151; MV = MAXV * PART; MC = MAXC * MV
def enc(b, c, v, p=0): return b * MC + c * MV + v * PART + p
def dec(k):
    p = k % PART; r1 = (k - p) // PART; v = r1 % MAXV; r2 = (r1 - v) // MAXV
    return (r2 // MAXC, r2 % MAXC, v, p)

def chapter(mod, b, c):
    p = os.path.join(RAW, mod, str(b), f'{c}.json')
    if not os.path.exists(p): return []
    try: return [(x['verseId'], len(x['text'])) for x in json.load(open(p))]
    except Exception: return []

_osm = {}
def osm(b, c):
    if (b, c) not in _osm: _osm[(b, c)] = chapter('osmain', b, c)
    return _osm[(b, c)]

def window(b, c):
    """osmain-vers for kapitlene c-1, c, c+1 som ((kapittel, vers), lengde)."""
    out = []
    for cc in (c - 1, c, c + 1):
        for v, l in osm(b, cc): out.append(((cc, v), l))
    return out

def align(O, T):
    """Gale-Church, semi-global: returnerer liste av (osNoekler, trVers).

    O er et vindu som spenner osmain-kapitlene c-1, c og c+1, og hvert
    element er ((kapittel, vers), lengde). Justeringen kan starte og slutte
    hvor som helst i vinduet uten kostnad, slik at et kapittel som ligger
    forskjovet over en kapittelgrense (Dan 4, Esek 21, Jer 9) treffer riktig
    — en ren 1:1-justering ville tvunget dem til aa ligne, og gjorde det
    feil i praksis."""
    n, m = len(O), len(T)
    if not n or not m: return None
    so = sum(l for _, l in O) or 1; st = sum(l for _, l in T) or 1
    r = st / so                                   # språkets ordrikhet
    INF = float('inf')
    D = [[INF] * (m + 1) for _ in range(n + 1)]
    B = [[None] * (m + 1) for _ in range(n + 1)]
    D[0][0] = 0
    def cost(ol, tl):
        exp = ol * r
        return abs(tl - exp) / (exp + 20)         # +20 demper korte vers
    for i in range(n + 1):
        for j in range(m + 1):
            if D[i][j] == INF: continue
            base = D[i][j]
            if i < n and j < m:                                    # 1:1
                c = base + cost(O[i][1], T[j][1])
                if c < D[i + 1][j + 1]: D[i + 1][j + 1] = c; B[i + 1][j + 1] = (i, j, 1, 1)
            if i < n and j + 1 < m:                                # 1:2 (splitt)
                c = base + cost(O[i][1], T[j][1] + T[j + 1][1]) + 0.35
                if c < D[i + 1][j + 2]: D[i + 1][j + 2] = c; B[i + 1][j + 2] = (i, j, 1, 2)
            if i + 1 < n and j < m:                                # 2:1 (fletting)
                c = base + cost(O[i][1] + O[i + 1][1], T[j][1]) + 0.35
                if c < D[i + 2][j + 1]: D[i + 2][j + 1] = c; B[i + 2][j + 1] = (i, j, 2, 1)
    if D[n][m] == INF: return None
    steps = []; i, j = n, m
    while (i, j) != (0, 0):
        if B[i][j] is None: return None
        pi, pj, di, dj = B[i][j]
        steps.append(([O[x][0] for x in range(pi, pi + di)], [T[y][0] for y in range(pj, pj + dj)]))
        i, j = pi, pj
    return list(reversed(steps))

# kapitler med tekstverifiserte dommer skal ikke røres
verdict_keys = set()
vp = os.path.join(REPO, 'kvn', 'data', 'alignment-verdicts.json')
if os.path.exists(vp):
    for v in json.load(open(vp)): verdict_keys.add(v['key'])

# finn feilende (modul, bok, kapittel)
failing = collections.defaultdict(list)   # (b,c,struktur) -> [moduler]
for f in sorted(os.listdir(M)):
    if not f.endswith('.ukvn.json'): continue
    mod = f[:-10]
    if not os.path.isdir(os.path.join(RAW, mod)): continue
    mp = json.load(open(os.path.join(M, f)))
    fwd = {e['kvnFrom']: e['tkvnFrom'] for e in mp['map']}
    rev = {}
    for e in mp['map']: rev.setdefault(e['tkvnFrom'], e['kvnFrom'])
    def rt_ok(t):
        k = rev.get(t)
        if k is None:
            p = t % PART
            k = rev[t - p] + p if p and (t - p) in rev else t
        return fwd.get(k, (fwd.get(k - (k % PART), k - (k % PART)) + (k % PART)) if k % PART else k) == t
    base = os.path.join(RAW, mod)
    for book in os.listdir(base):
        bp = os.path.join(base, book)
        if not book.isdigit() or not os.path.isdir(bp): continue
        for chf in os.listdir(bp):
            if not chf.endswith('.json'): continue
            b, c = int(book), int(chf[:-5])
            if f'{b}:{c}' in verdict_keys: continue
            T = chapter(mod, b, c)
            if not T: continue
            bad = [v for v, _ in T if not rt_ok(enc(b, c, v))]
            if bad: failing[(b, c, tuple(v for v, _ in T))].append(mod)

print(f'{len(failing)} (kapittel x struktur)-grupper feiler, {sum(len(v) for v in failing.values())} modul-kapitler')

groups = sorted(failing.items(), key=lambda kv: -len(kv[1]))
if limit: groups = groups[:limit]
touched = {}; made = skipped = 0
for (b, c, struct), mods in groups:
    O = osm(b, c)
    if not O: skipped += 1; continue
    rep = mods[0]
    steps = align(O, chapter(rep, b, c))
    if steps is None: skipped += 1; continue
    for mod in mods:
        p = os.path.join(M, f'{mod}.ukvn.json')
        mp = touched.get(mod) or json.load(open(p))
        bn = next((n for n, bid in mp['bookNames'].items() if bid == b), str(b))
        mp['map'] = [e for e in mp['map'] if dec(e['kvnFrom'])[:2] != (b, c)]
        for ovs, tvs in steps:
            if len(ovs) == 1 and len(tvs) == 1:
                ov, tv = ovs[0], tvs[0]
                if ov == tv: continue
                mp['map'].append({'kvnFrom': enc(b, c, ov), 'kvnTo': enc(b, c, ov),
                    'kvnRef': f'{bn} {c}:{ov}', 'tkvnFrom': enc(b, c, tv), 'tkvnTo': enc(b, c, tv),
                    'tkvnRef': f'{bn} {c},{tv}', 'order': 0})
            elif len(ovs) == 1:                      # osmain-vers delt i to
                ov = ovs[0]
                for idx, tv in enumerate(tvs):
                    mp['map'].append({'kvnFrom': enc(b, c, ov, idx + 1), 'kvnTo': enc(b, c, ov, idx + 1),
                        'kvnRef': f'{bn} {c}:{ov}{chr(97 + idx)}', 'tkvnFrom': enc(b, c, tv), 'tkvnTo': enc(b, c, tv),
                        'tkvnRef': f'{bn} {c},{tv}', 'order': 0})
                if tvs[0] != ov:
                    mp['map'].append({'kvnFrom': enc(b, c, ov), 'kvnTo': enc(b, c, ov),
                        'kvnRef': f'{bn} {c}:{ov}', 'tkvnFrom': enc(b, c, tvs[0]), 'tkvnTo': enc(b, c, tvs[0]),
                        'tkvnRef': f'{bn} {c},{tvs[0]}', 'order': 0})
            else:                                    # to osmain-vers flettet
                tv = tvs[0]
                for order, ov in enumerate(ovs):
                    if ov == tv and order == 0: continue
                    mp['map'].append({'kvnFrom': enc(b, c, ov), 'kvnTo': enc(b, c, ov),
                        'kvnRef': f'{bn} {c}:{ov}', 'tkvnFrom': enc(b, c, tv), 'tkvnTo': enc(b, c, tv),
                        'tkvnRef': f'{bn} {c},{tv}', 'order': order})
        touched[mod] = mp
    made += 1

if apply_:
    for mod, mp in touched.items():
        mp['map'].sort(key=lambda e: (e['kvnFrom'], e['order']))
        mp['stats']['totalMappingEntries'] = len(mp['map'])
        json.dump(mp, open(os.path.join(M, f'{mod}.ukvn.json'), 'w'), ensure_ascii=False, indent=2)
print(f'{made} grupper justert, {skipped} hoppet over, {len(touched)} moduler {"skrevet" if apply_ else "ville blitt skrevet"}')
