#!/usr/bin/env python3
"""
Utvid osmain med vers som mangler (issue #18).

osmain skal være supersettet av alle oversettelsers vers, slik at enhver
referanse kan oversettes til enhver annen oversettelse. 13 salmer mangler
sitt siste vers i osmain — bekreftet fraværende ved søk gjennom hele boka,
ikke bare kapitlet. Teksten hentes fra osnb, som osmain er bygget fra.

Alle 13 ligger SIST i kapitlet, så de legges til uten at noe eksisterende
vers renummereres — ingen eksisterende mapping-entry blir ugyldig.

Kjør med --apply for å skrive. Uten flagg vises bare hva som ville skjedd.
"""
import json, os, sys

REPO = os.path.join(os.path.dirname(__file__), '..', '..')
RAW = os.path.join(REPO, 'generate', 'bibles_raw')
apply = '--apply' in sys.argv
src = sys.argv[sys.argv.index('--verses') + 1]
rows = json.load(open(src))

changed = 0
for r in rows:
    book, ch = map(int, r['chapter'].split(':'))
    v = r['verse']
    op = os.path.join(RAW, 'osmain', str(book), f'{ch}.json')
    data = json.load(open(op))
    ids = {x['verseId'] for x in data}
    if v in ids:
        print(f'  {book}:{ch},{v} finnes allerede — hopper over')
        continue
    if v != max(ids) + 1:
        print(f'  {book}:{ch},{v} ligger ikke rett etter siste vers ({max(ids)}) — hopper over')
        continue
    data.append({'bookId': book, 'chapterId': ch, 'verseId': v, 'text': r['text']})
    data.sort(key=lambda x: x['verseId'])
    if apply:
        json.dump(data, open(op, 'w'), ensure_ascii=False, indent=2)
    changed += 1
    print(f"  {book}:{ch},{v} lagt til: {r['text'][:60]}")

print(f"\n{changed} vers {'lagt til' if apply else 'ville blitt lagt til'} i osmain")
