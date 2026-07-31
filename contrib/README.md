# contrib — crowd-innsendte artikler/bøker med versreferanser

Brukere på bible.flogvit.com melder inn artikler/bøker/sanger som omtaler bibelvers
(issues #15/#16). Kontrakten er `verse-ref-contrib.schema.json`
(`free-bible-contrib/1`), eksempler i `examples/`.

**Arbeidsdeling:** bibel-appen eier databasen og alt som rører den; free-bible
ser bare filer. `contrib/queue/*.json` (gitignort) er stafettpinnen — filnavn =
bibel-DB-id, innholdet er skjemadokumentet.

**KVN-regelen:** bidragsyteren oppgir kun `raw` + `context_translation`.
`kvnFrom`/`kvnTo` er **bit-shift-`encode()`** fra `kvn/src/types.ts`
(Esra 3:1 = 15740944) — aldri `ukvnEncode`-verdiene. Oppløsningen går
`parseRef` (i oversettelsens nummerering) → ukvn-mapping → osmain → `encode`.

**PII:** e-post/konto-id blir i bibel-DB-en. Ved eksport publiseres aldri
`where.quote` (opphavsrett), aldri `raw`/`context_translation`, og navn kun
når `credit=true`.

## Runbook

```bash
# 1. Hent ventende innsendinger fra bibel (kjøres i bibel/):
CONTRIB_TOKEN=… bun scripts/contrib-pull.ts

# 2. Maskinsjekk: strukturvalidering + KVN-oppløsning + target-oppslag:
bun contrib/check.ts --target-lookup

# 3. Review — LLM-anbefaling i note, menneske setter status:
bun contrib/review.ts --llm
bun contrib/review.ts --list
bun contrib/review.ts --approve --id <id>
bun contrib/review.ts --needs-info --id <id> --note "spørsmål"

# 4. Eksporter godkjente til kuratert data (FØR apply):
bun contrib/export.ts --lookup        # → generate/verse_works/<workId>.json

# 5. Skriv status tilbake til bibel-DB og arkiver køfilene (i bibel/):
CONTRIB_TOKEN=… bun scripts/contrib-apply.ts

# 6. Synk inn i bibel-appen (i bibel/):
bun scripts/import-bible.ts
deploy/deploy-bibel-data.sh works work_verse_refs
```

Approve-vakten i `review.ts` håndhever skjemaets regel: godkjenning krever at
hver ref har `kvnFrom`/`kvnTo` og at target har en konkret id (DOI/ISBN/
OpenLibrary/katalog-id — fritekst/URL alene er ikke nok; for sang holder song_id
eller tittel, som export.ts slugger til `sang-<slug>`). `needs_info` sendes
tilbake til bidragsyteren i frontend-UI-et og blir `pending` igjen når de
svarer.

`CONTRIB_TOKEN` er delt hemmelighet med bibel-tjenesten (`bibel.env` i prod,
`bibel/.env` lokalt); uten den finnes ikke admin-endepunktene.
