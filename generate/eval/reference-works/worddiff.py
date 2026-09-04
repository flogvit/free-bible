#!/usr/bin/env python3
"""Word-level diff of source vs modernized text. Prints each replaced/inserted/deleted span."""
import difflib, re, sys
a = re.findall(r"\S+", open(sys.argv[1], encoding="utf-8").read())
b = re.findall(r"\S+", open(sys.argv[2], encoding="utf-8").read())
sm = difflib.SequenceMatcher(a=a, b=b, autojunk=False)
n = 0
for op, i1, i2, j1, j2 in sm.get_opcodes():
    if op == "equal":
        continue
    n += 1
    print(f"{op:8} {' '.join(a[i1:i2])!r:50} -> {' '.join(b[j1:j2])!r}")
print(f"\n{n} edits, {len(a)} source words, {len(b)} output words, ratio {sm.ratio():.2f}")
