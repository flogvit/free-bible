#!/usr/bin/env python3
"""Compare chapter:verse number pairs between source and rendering. Book names differ by
language, so only the numbers are compared — enough to catch 2:4 becoming 4:4."""
import re, sys
from collections import Counter
def pairs(path):
    t = open(path, encoding="utf-8").read()
    return Counter(f"{a},{b}" for a, b in re.findall(r"(?<![\d])(\d{1,3})\s*[:,]\s*(\d{1,3})(?![\d])", t))
a, b = pairs(sys.argv[1]), pairs(sys.argv[2])
missing, extra = a - b, b - a
print(f"{sys.argv[2]}: {sum(a.values())} pairs in source, {sum(b.values())} in rendering")
if missing: print("  missing in rendering:", dict(missing))
if extra: print("  not in source:", dict(extra))
if not missing and not extra: print("  references match")
