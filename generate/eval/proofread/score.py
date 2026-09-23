#!/usr/bin/env python3
"""Score experiment outputs against seeds.json. A target counts as fixed when the verse is
flagged and the suggestion no longer contains the error (seeded: the original fragment is
back, or the error fragment is gone; real: the bad word is gone)."""
import json, sys, glob, os
HERE = os.path.dirname(os.path.abspath(__file__))  # run: python3 generate/eval/proofread/score.py [-v]
seeds = json.load(open(f"{HERE}/seeds.json"))
REAL_BAD = {(45, 4, 3): "honom", (45, 4, 22): "honom", (45, 4, 23): "honom", (48, 3, 6): "honom",
            (19, 98, 1): "honom", (60, 2, 12): "baktallar", (23, 40, 13): "utgrunnnet"}
verbose = "-v" in sys.argv
rows = []
for f in sorted(glob.glob(f"{HERE}/out/*.json")):
    d = json.load(open(f)); s = d["summary"]
    issues = {(r["b"], r["c"], i["verseId"]): i for r in d["results"] for i in r["issues"]}
    fixed, flagged_only, missed, by_kind = [], [], [], {}
    for sd in seeds:
        k = (sd["b"], sd["c"], sd["v"]); i = issues.get(k)
        kind = ("real-" if sd.get("real") else "") + sd["kind"]
        ok = False
        if i:
            sug = i["suggested"] or ""
            if sd.get("real"): ok = REAL_BAD[k] not in sug
            else: ok = sd["to"] not in sug or sd["from"] in sug
            if sd.get("key"): ok = sd["key"] in sug
        (fixed if ok else flagged_only if i else missed).append(k)
        by_kind.setdefault(kind, [0, 0]); by_kind[kind][1] += 1; by_kind[kind][0] += ok
    targets = {(sd["b"], sd["c"], sd["v"]) for sd in seeds}
    other = [k for k in issues if k not in targets]
    trap = issues.get((55, 1, 7))
    rows.append((os.path.basename(f), len(fixed), len(seeds), len(other), s["cost"], s["perVerse"], by_kind, trap, missed, flagged_only))
    if verbose:
        print(f"\n### {os.path.basename(f)}")
        for k in missed: print("  MISSED", k)
        for k in flagged_only: print("  FLAGGED-NOT-FIXED", k, issues[k]["suggested"][:120])
        for k in other: print("  OTHER", k, issues[k].get("type"), issues[k].get("defensible"), "|", issues[k]["suggested"][:150], "|", issues[k]["explanation"][:150])
print(f"\n{'run':45} fixed  other  $/verse   $bible(31k)")
for r in rows:
    print(f"{r[0]:45} {r[1]:2}/{r[2]}  {r[3]:4}  {r[5]:.5f}  {r[5]*31167:7.0f}   trap2Tim1:7={'no' if not r[7] else 'defensible' if r[7]['defensible'] else 'ERROR'}")
    print("      ", {k: f"{a}/{b}" for k, (a, b) in sorted(r[6].items())})
