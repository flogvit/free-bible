# Making a new Bible translation

From nothing to a publishable translation. The order below is the one `osen` was
actually made in (commit `7fc76c25c`, 2026-07-26) — 31,167 verses in 66 books.

The flags mentioned here are described in [skript.md](skript.md). The supporting
material — summaries, context, cross references, people — belongs to
[supporting-material.md](supporting-material.md); this recipe stops when the
Bible text itself is finished and indexed.

## What it costs, before you start

Measured with Claude Opus 5, per verse and for the whole Bible:

| step | per verse | whole Bible |
|---|---|---|
| translation | $0.0022 | $70 |
| batch proofread, stops at score 8 | $0.0055 | $171 |
| batch, 3 forced rounds | $0.0168 | $524 |
| per verse, text only | $0.0364 | $1,135 |

**Translating a verse again costs about 1/16 of proofreading it.** Worth
remembering when you weigh an extra proofreading round against simply running
the translation again.

---

## Step 0 — Decide the style, and write it down

The style lives in `generate/constants.ts` → `bibleStyles`, not in a CLI
default:

```ts
export const bibleStyles: Record<string, string> = {
    osnb: "oral",
    osnn: "oral",
    osen: "oral",
    oses: "oral",
};
```

**This is not a detail.** A script run without `--style` falls back to
`"standard"`, and the style is **not** stored in the verse data. A translation
produced against the wrong brief therefore cannot be identified afterwards — you
only see text that reads a little differently from the rest, with no way to know
why.

Add the new translation to `bibleStyles` **before** running anything.

## Step 1 — Name it

The base form is the language code: `osnb`, `osnn`, `osen`, `oses`. Variants take
a suffix (`osnb-child`). **Never a running number** — `osnb2`, `osnn1` and
`osnb1` were renamed away on 2026-07-26 because they say nothing about what
distinguishes them.

## Step 2 — Translate

```bash
bun generate/bible.ts <name> --style oral --ot      # Old Testament
bun generate/bible.ts <name> --style oral --nt      # New Testament
bun generate/bible.ts <name> --style oral --book 1-5
```

**The chapter is the translation unit**, and the reason is a good one: sentences
almost never cross a chapter boundary, so a chapter gives the verses the context
they need. Do not try to translate book by book or verse by verse.

The source is the original-language text in `generate/bibles_raw/tanach/` and
`.../sblgnt/`, imported from `external/bibles/` by `build-tanach.ts` and
`build-sblgnt.ts`.

## Step 3 — Proofread

**Use `--batch`.** It sends the chapter in a few calls and gets back only the
findings, in a feedback loop until the chapter reaches `--min-score` or the
rounds run out.

```bash
bun generate/bible.ts <name> --proofread --batch --apply --min-score 8
```

This is the method that produced `osnb` — 99.2% of its chapters were proofread
this way — and it is **6.6× cheaper** than per verse.

Per-verse mode (without `--batch`) reviews each verse together with its
neighbours, in two phases: text, then footnotes. More thorough, and expensive.
`--text-only` skips the footnote phase.

## Step 4 — The targeted second passes

Both are **free to re-run**, because they write resume markers.

```bash
bun generate/bible.ts <name> --proofread --check-length --apply
bun generate/bible.ts <name> --proofread --changed-only --apply
```

**`--check-length` catches a real and repeated failure.** The model sometimes
returns only the phrase it was focused on in `suggested`, dropping the rest of
the verse. **97 verses in `osen` were truncated this way**, including the entire
divine speech in Genesis 28:13. A length guard (`MIN_LENGTH_RATIO`) now rejects
such suggestions at write time, but the pass exists because it happened.

`--changed-only` revisits verses that have already been changed, optionally
filtered by type. Targets pull in their neighbours, marked `[context only]` in
the prompt.

### The resume markers

`checked` is `versions.length:text.length`, for example `"3:214"`. Anything that
changes the verse invalidates the marker, so a verse that has been emptied is
re-checked automatically when it needs to be. That is why you can run the second
passes as often as you like without paying for work already done.

## Step 5 — KVN mapping

If the translation follows **Hebrew/Greek versification** — Joel has 4 chapters,
Jonah 1 has 16 verses — it shares a mapping with `osnb` and `osnn`, and you do
not need a new one. That was the case for `osen`.

If it follows European numbering, you have to make one:

```bash
bun kvn/scripts/build-mapping.ts --source <name> --format raw
```

Read [`kvn/README.md`](../kvn/README.md) first. The mapping goes through `osmain`
as its hub — not through `osnb`.

## Step 6 — `meta.json` and `license.json`

Both live in `generate/bibles_raw/<name>/`.

**`license.json` is not optional.** Without it the translation is **silently**
left out of `translations/index.json` — no error, it simply does not exist for
consumers. The fields:

```json
{
  "translation": "osen",
  "name": "Open Source English",
  "language": "English",
  "license": "CC BY",
  "spdx": "CC-BY-4.0",
  "attribution_required": true,
  "noncommercial": false,
  "kvn_renumber_ok": true,
  "source": "manual",
  "statement": "..."
}
```

`statement` must carry forward the obligations of the source text. The SBLGNT is
CC BY 4.0, and **that obligation is inherited by everything translated from it** —
including this translation and anything derived from it in turn.

`meta.json` has the fields `translation`, `name`, `abbreviation`, `language`,
`philosophy`, `tradition`, `textual_basis`, `body`, `work`, `links`, `legacy`,
`coverage`, `features`, `provenance`. `coverage` is computed from the data — do
not write it by hand.

## Step 7 — Regenerate the index

```bash
bun generate/build-translations-index.ts
```

**Run this after any change to `meta.json` or `license.json`.** It builds
`generate/translations/index.json`, which is what consumers read.

---

## Checklist

- [ ] the name follows the convention (language code, optionally with a suffix — never a running number)
- [ ] the style is in `constants.ts` → `bibleStyles`
- [ ] translated with an explicit `--style`
- [ ] proofread with `--batch`
- [ ] `--check-length` has been run
- [ ] a KVN mapping exists, or it is confirmed that it shares an existing one
- [ ] `meta.json` and `license.json` are in place
- [ ] `build-translations-index.ts` has been run, and the translation appears in `index.json`
- [ ] `bun run test` is green
