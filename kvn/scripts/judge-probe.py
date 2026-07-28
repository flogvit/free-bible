#!/usr/bin/env python3
"""
Probe for tekstdom av justerings-varianter (issue #18).

Viser osmain-kapitlet kompakt + for hver variant i køen: id-settet og
representant-modulens tekst ved diskriminerende vers (første, andre,
midt, siste). Dommeren (Claude i sesjon) skriver verdikter til
kvn/data/alignment-verdicts.json; apply-alignment-verdicts.py appliserer.

Bruk: python3 scripts/judge-probe.py <bok:kap> [maxVarianter]
"""
import json, sys, os

REPO = os.path.join(os.path.dirname(__file__), '..', '..')
RAW = os.path.join(REPO, 'generate', 'bibles_raw')

key = sys.argv[1]
maxv = int(sys.argv[2]) if len(sys.argv) > 2 else 25
book, ch = key.split(':')

def get(mod):
    p = os.path.join(RAW, mod, book, f'{ch}.json')
    if not os.path.exists(p): return {}
    return {x['verseId']: x['text'] for x in json.load(open(p))}

queue = json.load(open(os.path.join(REPO, 'kvn', 'data', 'alignment-judgment-queue.json')))
entry = next(e for e in queue if e['key'] == key)

os_ = get('osmain')
print(f'===== osmain {key}: {len(os_)} vers')
for v in sorted(os_):
    print(f'  os{v}: {os_[v][:56]}')

done = set()
try:
    verdicts = json.load(open(os.path.join(REPO, 'kvn', 'data', 'alignment-verdicts.json')))
    done = {(v['key'], tuple(v['trIds'])) for v in verdicts}
except FileNotFoundError:
    pass

for i, var in enumerate(entry['variants'][:maxv]):
    ids = var['trIds']
    mark = ' [DØMT]' if (key, tuple(ids)) in done else ''
    print(f"\n--- variant {i}: n={var['n']} rep={var['rep']}{mark}")
    if not ids:
        print('   (tom — kapittel mangler i data)')
        continue
    holes = sorted(set(range(ids[0], ids[-1] + 1)) - set(ids))
    print(f"   ids {ids[0]}..{ids[-1]} ({len(ids)} vers){' hull=' + str(holes) if holes else ''}")
    tr = get(var['rep'])
    probes = sorted({ids[0], ids[min(1, len(ids)-1)], ids[len(ids)//2], ids[-1]})
    for v in probes:
        print(f'   tr{v}: {str(tr.get(v, "?"))[:56]}')
