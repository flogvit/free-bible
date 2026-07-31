# Contributing

Pick the section that matches what you want to do. Each one ends where the work
is actually finished, not where the instructions run out.

- [I found an error in a verse](#i-found-an-error-in-a-verse) — 5 minutes
- [I want to run a job that is missing](#i-want-to-run-a-job-that-is-missing) — an evening
- [I want the Bible in a language it does not exist in](#a-new-translation) — weeks, and money
- [I want to change the code](#code)

---

## I found an error in a verse

Open an issue with the translation code (`osnb`, `osnn`, `osen`, `oses`), the
reference, the current text and what you think it should say.

**What happens next will probably surprise you: we usually do not replace the
text.** Most translation disagreements are two defensible readings of the same
Hebrew or Greek, and this project treats that as something the reader should see
rather than something an editor should settle. So the normal outcome is that your
reading is added to the verse as an alternative:

```jsonc
"versions": [
  { "text": "…your reading…", "type": "suggestion", "severity": "minor",
    "explanation": "why this rendering is defensible",
    "alternative": true }     // shown to the reader as a choice
]
```

An outright error — a dropped clause, a name rendered wrong, a verse that says
the opposite of the source — does get corrected. If that is what you found, say
so plainly in the issue, because it is handled differently.

---

## I want to run a job that is missing

[STATUS.md](STATUS.md) lists what is missing, how much of it there is, and the
command for each. Everything marked *local model* is free to run; everything
marked *Claude* costs money and needs an API key.

### Before you start: claim it

**Two people who clone this repository will otherwise do the same work.** Nothing
stops it: the scripts skip files that already exist, so overlapping runs are not
dangerous, but the second person's hours and electricity are simply wasted, and
two large pull requests over the same files are painful to merge.

So:

1. Find the issue for the job — it is linked from STATUS.md (`#31`, `#34`, …).
2. Comment with the **range** you are taking: *"Taking Genesis–Deuteronomy
   (books 1–5)."* Ranges, not "I'll help", so that two people can work at once.
3. Wait for a 👍 or an assignment before you start the long run.

A claim expires after **14 days without a pull request**. Say so if you need
longer — that is fine, and better than a range being quietly stuck.

### Running it

Everything runs through [Bun](https://bun.sh); there is no build step.

```bash
bun install
bun generate/important-words-chapter.ts --help    # every script explains itself
```

Local jobs need [Ollama](https://ollama.com) with the model the job asks for.
Which model, how much memory it needs, and what happens when two jobs want
different models is in [docs/running-jobs.md](docs/running-jobs.md) — worth
reading once before a long run, because a job can silently end up on a much
larger model than intended.

Always do one chapter or one book before the whole thing:

```bash
bun generate/important-words-chapter.ts --local --book 40 --chapter 17
```

Then open the file it wrote. A model that produces nonsense produces it quietly,
and 600 chapters of it is a bad thing to discover afterwards.

### Knowing when you are done

Jobs skip chapters that fail and carry on, so *"the script finished"* does not
mean *"the work is complete"*. Regenerate the status and read the missing list:

```bash
bun generate/build-status.ts --print | less
```

### Sending it back

One pull request per claimed range, titled with the range.

**Do not include `STATUS.md` in your pull request.** It is generated, it changes
on every run, and if every contributor regenerated it, every pull request would
conflict. It is regenerated after merge.

Data files are large. If your range produced thousands of them, say so in the
description — that is expected, not a mistake.

---

## A new translation

The whole point of the project: a Bible in a language that has no free one.

This is a project rather than a task. It costs around **$250** in API usage, runs
for weeks, and produces something that will carry your language's name — so it is
worth talking about before starting.

**Open an issue first**, saying which language and which style. The step-by-step
guide is [docs/new-translation.md](docs/new-translation.md).

Two things from it decide whether the result is usable at all, so they are
repeated here:

- **The chapter is the translation unit.** Sentences almost never cross a chapter
  boundary, so a chapter gives verses the context they need. Verse-by-verse
  translation produces text that is defensible in isolation and incoherent in
  sequence.
- **Every translation needs a KVN mapping**, or it cannot be cross-referenced
  against any other translation. See `kvn/README.md`.

---

## Code

```bash
bun install
bun run test        # typecheck, then the test suite
cd kvn && bun test  # the versification suite, 364,000 tests
```

Fork, branch, pull request. A few conventions that are not obvious from reading
the code:

- **`bun`, never `node`, `npx` or `tsx`.** Bun runs the TypeScript directly.
- **As few dependencies as possible, ideally none.** If a package would save a
  few lines, write the lines. The exception is a real client for an external API.
- **Do not reimplement verse numbering.** Use `CrossMapper` from
  `kvn/src/ukvn.ts`. Chapter and verse numbers differ between translations in
  ways that look like off-by-one bugs and are not.
- **Fix data by hand, not with a script.** Scripts run against the Bible data
  have caused more damage here than they have saved effort.

`docs/skript.md` lists every script and its flags, generated from the source.

---

## Reporting bugs and suggesting features

Ordinary GitHub issues. For a bug, include the command you ran and what happened
— the whole command line matters, because a missing `--local` or `--style`
changes what a job does without saying so.
