# Supporting material for a new translation

Once the Bible text is in place ([new-translation.md](new-translation.md)),
everything that makes it usable in the interface is still missing. That is **36
output directories** under `generate/`.

**How much of it is missing is in [STATUS.md](../STATUS.md)**, generated from the
data — coverage numbers should not be written by hand anywhere, including here.
The flags are in [skript.md](skript.md), and how to run a job is in
[running-jobs.md](running-jobs.md).

---

## Two ways in, and they are easy to confuse

**Generating** produces the content afresh, in the translation's own language,
from the Bible text. **Translating** takes existing Norwegian content and
translates it with `translate.ts`.

Which one applies is not a free choice per directory — it depends on whether the
content is *derived from the text* (generate) or *written about the text*
(translate). Cross references are generated, because which verses belong together
is a property of the text. Summaries are translated, because they are prose about
the content.

### The translation route

```bash
bun generate/translate.ts --language en --status      # what is left
bun generate/translate.ts --language en --dry-run     # without writing
bun generate/translate.ts --language en
```

The order is `CONTENT_DIRS` in `translate.ts`, and **`references` is last on
purpose**: 10,000+ files and a multi-day run.

> ### The trap that broke 1,869 person files
>
> `keepKeys` in `CONTENT_DIRS` lists the fields that are **machine values and
> must not be translated**. `relatedPersons`, `siblings` and `children` are id
> references, not names — but they were not in the list. The model translated
> them into display names: `paulus` became `Paul`, `johannes-apostel` became
> `John the Apostle`.
>
> **1,869 of 2,029 English person files ended up with reference fields that could
> not be looked up.** `father`, `mother` and `spouse` were in the list and were
> undamaged — that difference is what exposed it.
>
> If you add a directory to `CONTENT_DIRS`: go through every field and ask
> whether it is something a *human* reads or something *code* looks up.

---

## Dependencies

The order is not free. What has to come first:

| this | before this | because |
|---|---|---|
| `generate/days/` (`days.ts`) | `day-tags`, `days-mentions` | both read the day definitions |
| embeddings (`embeddings.ts`) | `references-semantic` | semantic search needs the vectors |
| the Bible text, finished | everything else | they all read `bibles_raw/<name>/` |
| `persons` generated | `persons-reconcile*` | reconciliation needs something to reconcile |
| the KVN mapping | `references` | reference addresses are validated against the numbering |

> **`bun generate/days.ts` deletes `references[]`.** The script writes each of
> the 48 day files in full, with only the ten fields it knows about. 31 of them
> have an eleventh — `references[]`, 103 references in all — that **no generator
> produces**: they arrived in `2bf7bdc8e` and exist only on disk. A run is
> therefore not a regeneration but a deletion without an error message, and it
> propagates to `days/en/` the next time `translate.ts` runs.
>
> Issue #108 fixed this happening merely on *import*. That a deliberate run still
> does it is unresolved — the warning is in `--help`, but the script does not
> preserve the field.

---

## The directories

### Generated from the Bible text

| directory | script | note |
|---|---|---|
| `references` | `references.ts` | cross references (#31) |
| `references` | `references-semantic.ts` | semantic finds — bge-m3 plus LLM verification, surfacing parallels that are not in the standard reference works |
| `tags` | `chapter-tags.ts` | chapter tagging (#32) |
| `day-tags` | `day-tags.ts` | day tagging |
| `days-mentions` | `days-mentions.ts` | mentions of days and feasts per verse (#33) |
| `days` | `days.ts` | the day definitions themselves — **see the warning above** |
| `persons` | `bible-persons.ts` | person profiles |
| `persons` | `persons-reconcile*.ts` → `persons-audit.ts` → `persons-apply-*.ts` | reconciliation: propose → a human looks → write |
| `stories` | `scan-stories.ts`, `stories.ts` | systematic scan, then generation |
| `number-symbolism` | `number-symbolism.ts` | number symbolism |
| `important_words` | `important-words-chapter.ts` | key words (#34) |
| `word4word` | `word4word.ts` | word-for-word. **Only correct for `tanach` and `sblgnt`** |
| `verse-translation` | `verse-translation.ts` | notes per verse |
| `chapter_summaries`, `book_summaries` | `chapter-summary.ts`, `book-summary.ts` | |
| `chapter-context`, `book-context` | `chapter-context.ts`, `book-context.ts` | |
| `reading_plans` | `build-reading-plans.ts` | configuration in `reading-plans-config.ts` |
| `songs` | `song-references.ts` | song → verse (#8) |

### Translated from Norwegian

Every directory in `CONTENT_DIRS`, in that order — see `translate.ts`.

### Has content, but no generator

Five directories have files on disk without any script that produces them:

| directory | files | |
|---|---|---|
| `chapter_insights` | 193 | #39 |
| `timeline` | 112 | not in #39 |
| `verse_sermon` | 10 | #39 |
| `verse_prayer` | 8 | #39 |
| `daily_verse` | 4 | not in #39 |

**All five are in `CONTENT_DIRS`** and are therefore translated, but they cannot
be filled in for a new language unless the Norwegian content exists first.
`timeline` and `daily_verse` are not mentioned in #39 — they should be added
there.

### Deliberately not translated

`proofread_*`, `stories_proposed`, `stories_rejected` — internal pipeline
artefacts.

---

## What can run locally

`docs/running-jobs.md` is the reference. Two things from it that are easy to
miss:

**Most scripts go to the Claude API if you forget `--local`.** Three are always
local regardless: `song-references`, `days-mentions` and `persons-reconcile*`.

**Local triage is not good enough to judge translation quality.** Measured recall
against Claude's actual corrections was 31% (qwen3.5:27b) and 8% (qwen3.6:35b),
and both miss exactly the valuable class: Hebrew morphology and consistency of
terms across verses. The **deterministic** checks — regular expressions, length,
verse counts — are where the local layer pays off.

**Two jobs must never want different models at the same time.** Ollama keeps one
runner, and qwen3.5:122b (81 GB) and qwen3.5:27b (17 GB) do not fit side by side
on 128 GB — so it reloads on *every call*: measured at 17–19 s for the 122b
runner. `resolveLocalModel` in `llm.ts` handles this by adopting the model that
is already loaded, when it ranks at or above the task's preference.

---

## Checklist for a new language

- [ ] the Bible text is finished and indexed
- [ ] `days.ts` has been run (or the day definitions are confirmed to exist)
- [ ] embeddings built, if semantic references are wanted
- [ ] generated directories filled, in dependency order
- [ ] `translate.ts --status` shows nothing remaining
- [ ] `keepKeys` checked for every new directory in `CONTENT_DIRS`
- [ ] `build-translations-index.ts` run at the end
