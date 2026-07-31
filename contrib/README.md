# contrib — crowd-submitted articles and books with verse references

Users on bible.flogvit.com submit articles, books and songs that discuss Bible
verses (issues #15 and #16). The contract is `verse-ref-contrib.schema.json`
(`free-bible-contrib/1`), with examples in `examples/`.

**Division of labour:** the bible app owns the database and everything touching
it; free-bible only ever sees files. `contrib/queue/*.json` (gitignored) is the
baton — the filename is the bible database id, the content is the schema
document.

**The KVN rule:** the contributor supplies only `raw` and
`context_translation`. `kvnFrom` and `kvnTo` are the **bit-shift `encode()`**
from `kvn/src/types.ts` (Ezra 3:1 = 15740944) — never the `ukvnEncode` values.
Resolution goes `parseRef` (in the translation's own numbering) → ukvn mapping →
osmain → `encode`.

**Personal data:** email addresses and account ids stay in the bible database. On
export, `where.quote` is never published (copyright), nor are `raw` and
`context_translation`, and names only when `credit=true`.

## Runbook

```bash
# 1. Fetch pending submissions from the bible app (run inside bibel/):
CONTRIB_TOKEN=… bun scripts/contrib-pull.ts

# 2. Machine check: structural validation, KVN resolution, target lookup:
bun contrib/check.ts --target-lookup

# 3. Review — an LLM writes a recommendation into the note, a human sets status:
bun contrib/review.ts --llm
bun contrib/review.ts --list
bun contrib/review.ts --approve --id <id>
bun contrib/review.ts --needs-info --id <id> --note "question"

# 4. Export the approved ones to curated data (BEFORE apply):
bun contrib/export.ts --lookup        # → generate/verse_works/<workId>.json

# 5. Write status back to the bible database and archive the queue files (in bibel/):
CONTRIB_TOKEN=… bun scripts/contrib-apply.ts

# 6. Sync into the bible app (in bibel/):
bun scripts/import-bible.ts
deploy/deploy-bibel-data.sh works work_verse_refs
```

The approve guard in `review.ts` enforces the schema's rule: approval requires
every reference to have `kvnFrom` and `kvnTo`, and the target to have a concrete
id — DOI, ISBN, OpenLibrary or catalogue id. Free text or a bare URL is not
enough; for a song, a `song_id` or a title is sufficient, and `export.ts` slugs
the title to `sang-<slug>`. `needs_info` is sent back to the contributor in the
frontend and returns to `pending` when they answer.

`CONTRIB_TOKEN` is a shared secret with the bible service (`bibel.env` in
production, `bibel/.env` locally); without it the admin endpoints do not exist.
