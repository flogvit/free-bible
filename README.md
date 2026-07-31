# Free Bibles

Bible translations made with large language models, released under CC BY, plus a
canonical verse-numbering layer that lets any translation be cross-referenced
against any other.

This is not an attempt to produce *the correct* translation. It is a
transparency layer over the source text: the reader can bring up the Hebrew or
Greek, see it explained, and judge the rendering for themselves. Any translation
is only one of the versions you could produce, so where a verse was changed, the
earlier reading and the reason are kept in the data rather than discarded.

Read it at **[bible.flogvit.com](https://bible.flogvit.com)**. The web frontend
is a separate repository; this one holds the texts, the material around them,
and the scripts that produce both.

## What you can use today

| translation | language | style | licence |
|---|---|---|---|
| `osnb` | Norwegian bokmål | spoken | CC BY 4.0 |
| `osnn` | Norwegian nynorsk | spoken | CC BY 4.0 |
| `osen` | English | spoken | CC BY 4.0 |
| `oses` | Spanish | spoken | CC BY 4.0 |

All four are complete: 66 books, 1,189 chapters, translated from the Hebrew
(Leningrad Codex, [tanach.us](https://www.tanach.us)) and the Greek
([SBLGNT](https://sblgnt.com)) — not from another translation.

One JSON document per chapter, an array of verses:

```
generate/bibles_raw/osnb/1/1.json          # Genesis 1
```

```jsonc
{
  "bookId": 1, "chapterId": 1, "verseId": 2,
  "text": "…",
  "versions": [                     // other defensible readings, newest last
    { "text": "…", "explanation": "…", "alternative": true }
  ],
  "footnotes": [ { "text": "…", "source": "oversettelse" } ]
}
```

**Attribution:** our own work needs no credit, but the source texts do — the
SBLGNT is CC BY 4.0, which carries over to these translations and to anything
derived from them. The exact wording is in each translation's `license.json`.

Around 80 further translations, harvested from open sources rather than made
here, are also in `generate/bibles_raw/` with their own licences. Check the
`license.json` before using one; they are not all as permissive.

## Can you trust a Bible made by a language model?

That question deserves a real answer rather than reassurance, and it is in
[docs/how-the-text-is-made.md](docs/how-the-text-is-made.md): how a chapter is
translated, what the proofreading does and does not catch, what is known to be
weak, and how to check any single verse against the source yourself.

## Want to help?

[**STATUS.md**](STATUS.md) lists what exists and what is missing — measured, not
estimated — with the command that does something about each gap. Some of it runs
on a local model and costs nothing.

[CONTRIBUTING.md](CONTRIBUTING.md) covers how to claim a piece of work so two
people do not do the same job, what to do if you found an error in a verse, and
how to propose a translation into a new language.

## Verse numbering, as a library

Psalm titles, Joel's chapters, Jonah 1:17 — translations disagree about verse
numbers in ways that look like off-by-one bugs and are not. `kvn/` is a canonical
numbering layer with mappings for every translation here, and it is useful on its
own if you have that problem:

```ts
import {CrossMapper} from './kvn/src/ukvn.ts';
```

See [kvn/README.md](kvn/README.md).

## Running the scripts

```bash
bun install                                  # Bun 1.3+, no build step
bun generate/build-status.ts --print         # what is missing
bun generate/<script>.ts --help              # every script explains itself
```

Generation needs either an `ANTHROPIC_API_KEY` in `generate/.env` or a local
[Ollama](https://ollama.com), depending on the job. Every script and every flag
is listed in [docs/skript.md](docs/skript.md), generated from the source.

## Licence

Code: MIT. Translations made here: CC BY 4.0. Harvested translations: see each
`license.json`.

Copyright (c) 2023-2026 Vegard Hanssen · Vegard.Hanssen@menneske.no

Donations welcome — a translation costs about $250 in API usage, and the
encyclopedic material costs more.
