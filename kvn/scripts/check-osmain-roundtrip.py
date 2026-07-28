#!/usr/bin/env python3
"""
Rundturskontroll gjennom osmain — den egentlige korrekthetstesten.

Kryssmapping skal gå oversettelse -> osmain -> oversettelse. Hvis et vers
kommer tilbake til seg selv, er mappingen konsistent. (Rundturer gjennom
osnb tester i tillegg osnb sin egen mapping, og osnb er bare enda en
oversettelse — med egne hull.)

Et vers som ikke kommer tilbake betyr én av to ting:
  - verset finnes ikke i osmain  -> osmain må utvides (osmain er ment å
    være supersettet av alle oversettelsers vers)
  - flere osmain-vers peker på det -> flettet vers, reversen kan bare
    velge ett (ventet og ufarlig)

Bruk: python3 scripts/check-osmain-roundtrip.py [--modules a,b,c]
Skriver kvn/data/osmain-roundtrip-report.json
"""
import json, os, sys, collections

REPO = os.path.join(os.path.dirname(__file__), '..', '..')
M = os.path.join(REPO, 'kvn', 'mappings')
RAW = os.path.join(REPO, 'generate', 'bibles_raw')
PART = 16; MAXV = 177; MAXC = 151; MV = MAXV * PART; MC = MAXC * MV
def enc(b, c, v, p=0): return b * MC + c * MV + v * PART + p
def dec(k):
    p = k % PART; r1 = (k - p) // PART; v = r1 % MAXV; r2 = (r1 - v) // MAXV
    return (r2 // MAXC, r2 % MAXC, v, p)

only = None
if '--modules' in sys.argv:
    only = set(sys.argv[sys.argv.index('--modules') + 1].split(','))

def module_verses(mod):
    base = os.path.join(RAW, mod)
    if not os.path.isdir(base): return []
    out = []
    for book in os.listdir(base):
        bp = os.path.join(base, book)
        if not book.isdigit() or not os.path.isdir(bp): continue
        for ch in os.listdir(bp):
            if not ch.endswith('.json'): continue
            try:
                for x in json.load(open(os.path.join(bp, ch))):
                    out.append((int(book), int(ch[:-5]), x['verseId']))
            except Exception: pass
    return out

report = {}
missing_counter = collections.Counter()
for f in sorted(os.listdir(M)):
    if not f.endswith('.ukvn.json'): continue
    mod = f[:-10]
    if only and mod not in only: continue
    m = json.load(open(os.path.join(M, f)))
    fwd = {}; rev = {}
    for e in m['map']:
        fwd[e['kvnFrom']] = e['tkvnFrom']
        rev.setdefault(e['tkvnFrom'], e['kvnFrom'])
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
    verses = module_verses(mod)
    if not verses: continue
    bad = []
    merged = 0
    for b, c, v in verses:
        t = enc(b, c, v)
        k = to_kvn(t)
        back = to_tkvn(k)
        if back == t: continue
        # delvers: verset er flettet av flere osmain-vers og modellert med
        # part paa tkvn-siden (Apg 19,40a/b). Rundturen lander paa 19,40a,
        # altsaa samme vers — det er en treffende rundtur, ikke en feil.
        if back - back % PART == t: continue
        # flettet: flere osmain-vers peker hit -> reversen velger ett
        if sum(1 for kk, tt in fwd.items() if tt == t) > 1: merged += 1; continue
        bad.append((b, c, v))
        missing_counter[f'{b}:{c}'] += 1
    report[mod] = {'verses': len(verses), 'failed': len(bad), 'merged': merged,
                   'examples': [f'{b}:{c},{v}' for b, c, v in bad[:5]]}

tot_v = sum(r['verses'] for r in report.values())
tot_b = sum(r['failed'] for r in report.values())
clean = sum(1 for r in report.values() if r['failed'] == 0)
print(f'{len(report)} moduler, {tot_v} vers')
print(f'rundtur gjennom osmain feiler for {tot_b} vers ({tot_b/tot_v:.3%})')
print(f'{clean}/{len(report)} moduler helt rene')
print('verste kapitler:', missing_counter.most_common(10))
json.dump({'summary': {'modules': len(report), 'verses': tot_v, 'failed': tot_b, 'cleanModules': clean},
           'worstChapters': missing_counter.most_common(50),
           'modules': report},
          open(os.path.join(REPO, 'kvn', 'data', 'osmain-roundtrip-report.json'), 'w'),
          ensure_ascii=False, indent=1)
