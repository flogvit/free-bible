# free-bible

Bible translations produced with LLMs, plus a canonical verse-numbering layer (KVN) that
lets any translation be cross-referenced against any other.

## What this project is — and is not

free-bible is **not** trying to produce *the correct* translation. It is a transparency
layer over the source text: the web interface lets a reader bring up the Hebrew/Greek,
see it explained, and judge for themselves. Any translation is only *one of the versions*
you could produce.

Consequences that are easy to get wrong:

- **Variation between renderings is a feature, not drift.** Two valid ways to render the
  same Hebrew are two things a reader can choose between. Do not build glossaries or
  cross-chapter term-consistency enforcement — that removes the product.
- **`versions[]` on a verse is user-facing depth**, not internal bookkeeping. It holds the
  alternatives. It also stops the proofread swinging back and forth, so entries stay even
  when the earlier reading was wrong — `versions[].alternative` decides what readers see.
- **The only quality metric is faithfulness to the source, per verse, in chapter context.**
- **Chapter is the translation unit** and the reason is good: sentences almost never cross
  a chapter boundary, so a chapter gives the coherence verses need. Don't propose
  book-level or corpus-level units.

## Translations

| module | language | style | notes |
|---|---|---|---|
| `osnb` | Norwegian bokmål | oral | |
| `osnn` | Norwegian nynorsk | oral | |
| `osen` | English | oral | |

Naming: the base form is the language code. Variants take a suffix (`osnb-child`). Never a
running number — `osnb2`/`osnn1`/`osnb1` were renamed away 2026-07-26 and osnb1 deleted.

Style lives in `constants.js` → `bibleStyles`, not in a CLI default. A forgotten `--style`
would silently produce text against the wrong brief, and the style is not recorded in the
verse data, so the mistake could not be found afterwards.

All three follow **Hebrew/Greek versification** (Joel has 4 chapters, Jonah 1 has 16
verses), not the common European numbering. Their KVN mappings are therefore identical.

## Data layout

```
generate/bibles_raw/<module>/<book>/<chapter>.json   verses, 1..66 / 1..n
generate/bibles_raw/<module>/meta.json               editorial metadata
generate/bibles_raw/<module>/license.json            licence — required, or the module is
                                                     silently left out of translations/index.json
kvn/mappings/<module>.ukvn.json                      canonical numbering ↔ this module
```

A verse:

```jsonc
{
  "bookId": 1, "chapterId": 1, "verseId": 2,
  "text": "...",
  "versions": [                    // earlier readings, newest last
    { "text": "...", "type": "suggestion", "severity": "minor",
      "explanation": "...",
      "alternative": true }        // true = a valid choice to show the reader
  ],
  "footnotes": [ { "text": "...", "source": "oversettelse" } ],
  "textChecked": true,             // per-verse proofread resume marker
  "checked": { "length": "3:214", "changed": "3:214" }   // batch proofread resume markers
}
```

Resume markers are `versions.length:text.length`. Anything that changes the verse
invalidates them, so a cleared verse is re-checked automatically when it needs to be.

Footnote `source` values are Norwegian (`oversettelse`, `lingvistisk`, …) in **every**
language. They are shared identifiers, not display text — the footnote *text* is written in
the translation's own language. Most other enums are English (`type`, `severity`, `era`).

## Pipeline

`generate/bible.mjs` — translate, then proofread. Two proofread modes:

- **`--batch`** sends the chapter in a few calls and gets back only the findings, in a
  feedback loop until the chapter scores `--min-score` or the rounds run out. **This is
  the method that produced osnb** (99.2% of its chapters predate per-verse mode) and it is
  6.6× cheaper. Prefer it.
- default (per-verse) reviews each verse with its neighbours, in two phases (text, then
  footnotes). Thorough but expensive; `--text-only` skips the footnote phase.

Measured with Claude Opus 5 ($5/$25 per MTok), per verse and for the whole bible:

| step | per verse | bible |
|---|---|---|
| translation | $0.0022 | $70 |
| batch proofread, stops at score 8 | $0.0055 | $171 |
| batch, 3 forced rounds | $0.0168 | $524 |
| per-verse, text only | $0.0364 | $1,135 |

Re-translating a verse is ~1/16 the cost of proofreading it. Batch API (untried) would
halve any of these.

Targeted second passes, both free to re-run because they write resume markers:

- `--check-length` re-examines verses whose text is now much shorter than an earlier
  version. **This catches a real and repeated failure**: the model returns only the phrase
  it was focused on in `suggested`, dropping the rest of the verse. 97 verses in osen were
  truncated this way, including the whole divine speech in Genesis 28:13. A length guard
  (`MIN_LENGTH_RATIO`) now rejects such suggestions at write time.
- `--changed-only [types]` re-examines verses already changed, optionally filtered by
  type. Targets pull in their neighbours, marked `[context only]` in the prompt.

## KVN

`kvn/` is the canonical verse-numbering layer. A mapping maps **canonical → that
translation's numbering**: `kvnFrom` "1 Mos 31:55" → `tkvnFrom` "1 Mos 32,1" for a
translation following the Hebrew. Use `CrossMapper` from `kvn/src/ukvn.ts` — do not
reimplement versification. Scripts that need it must run under `tsx`.

`kvn/tests` (6,400+) is the safety net; run `npx vitest run` in `kvn/` after touching
mappings or data.

`tests/mapping-integrity.test.ts` checks **structure only** — valid book ids, no
duplicates, no cross-book maps. Nothing verifies that a mapped entry points at
corresponding *text*. That gap is real: osnn's mapping was missing 21 of 26 Joel entries
and pointed Jonah 1:17 at the wrong verse, and every structural test passed.

## Scripts: live, one-off, and dead

Live and used regularly: `bible.mjs`, `translate.mjs`, `references.mjs`,
`references_semantic.mjs`, `chapter_tags.mjs`, `bible_persons.mjs`, `translations_index.mjs`
(regenerate after any `meta.json`/`license.json` change), `glossary.mjs`, `triage.mjs`.

Known stale, do not trust without reading:

- `kvn/scripts/build-osnb-mapping.ts` — **produces an identity mapping**, i.e. wipes the
  real one. Its comparison function `loadRawBible` is defined but never called. It does not
  use `osmain`, which is the canonical reference it would need. Back up before running.
- `generate/word4word/` is only correct for `tanach` and `sblgnt`. The `osnb1` directory
  was wrong and was deleted.

Local models: `constants.js` → `taskModels` sets a default per task; `OLLAMA_MODEL`
overrides. Small models handle per-verse yes/no work so the machine stays usable; the large
one is for overnight jobs. `gemma*` is unusable for anything needing structured output
(`jsonFormat: false`).

**Local triage does not work for judging translation quality** — measured recall against
Claude's actual corrections was 31% (qwen3.5:27b) and 8% (qwen3.6:35b). Both miss exactly
the valuable class: Hebrew morphology, cross-verse term consistency. Deterministic checks
(regex, length, verse counts) are the part of the local layer that pays off.

## Conventions

- `tsx`, never `ts-node`.
- Never `cp`/`mv` over an existing file without asking.
- Data fixes: prefer fixing them by hand over writing a script — scripts against bible data
  have repeatedly caused errors here.
- Docker is off limits; the local database is started manually.
