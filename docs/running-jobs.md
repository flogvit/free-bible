# Running jobs

What a job needs to run, and the traps that make a run produce nothing, cost
money you did not intend to spend, or take four times longer than it should.

**What is missing, and how much of it, is in [STATUS.md](../STATUS.md)** — that
file is generated from the data, so it is the only place those numbers are
correct. This page is about *how* to run, not *what*.

---

## Claude or a local model

Both exist, and which one you get is not always obvious.

**Most scripts go to the Claude API if you forget `--local`.** That is the
default, not the exception. `bun generate/important-words-chapter.ts` uses Claude
and costs money; the same command with `--local` uses Ollama and costs nothing.

Two scripts are the other way round and take `--remote` instead, because local is
their default: `translate.ts` and `headings.ts`. Three have no switch at all and
are always local: `song-references.ts`, `days-mentions.ts` and
`persons-reconcile.ts`.

Every script prints the model it chose on its first line. Read it before letting
a job run overnight.

`--book` and `--chapter` are **ranges**, not starting points: `--book 66
--chapter 3` means Revelation 3 and nothing else. "From Matthew to the end" is
`--book 40-66`.

---

## Which local model a job gets

Each task has a *preferred* model, set in `taskModels` in
`generate/constants.ts` — small models for per-verse yes/no work so the machine
stays usable, the large one for prose.

**The preference is not a promise.** Before each call, `resolveLocalModel` asks
Ollama what is already loaded, and uses a larger resident model instead of
loading a second one. One runner shared by two jobs is far faster than two that
evict each other.

**And the substitution keeps itself alive.** It is decided per call, and every
call refreshes Ollama's five-minute keep-alive on the model it used. So it is
enough that the large model was resident *at the moment your job started*: the
rest of the run stays on it, long after the job that loaded it has finished.
Falling back would take five minutes with no calls at all, which never happens
mid-run.

This is not theoretical. A keyword run that asked for a 27b model spent its
entire run on a 122b one, and nothing in the output records which model wrote
which file.

```bash
curl -s localhost:11434/api/ps                              # what is loaded now
OLLAMA_NO_ADOPT=1 bun generate/<script>.ts --local          # ignore what is resident
OLLAMA_MODEL=qwen3.5:27b bun generate/<script>.ts --local   # force one model
```

### Never let two jobs want different models

Ollama keeps one runner. A 122b model (81 GB) and a 27b model (17 GB) do not fit
side by side on 128 GB, so it reloads on **every call**: measured at 17–19
seconds for the large runner and about 6 for the small one, with a cold prompt
cache each time. A translation job that normally takes seconds per file took 179
seconds per file while a tagging job ran beside it.

Run them one after the other. That is faster in wall-clock time than running both
at once.

### The exception: closed schemas

A job whose answers are constrained — an enum, a fixed set of fields — can share
a runner with a job that prefers a different model, because `gemma4` is held back
only from *open* generation: unbounded arrays and free-text fields.
`isClosedSchema` in `generate/llm.ts` draws the line, and the test suite covers
it.

In practice, while song references (gemma4) are running:

| job | schema | shares the runner |
|---|---|---|
| KVN text verification | four-value enum → closed | yes |
| Triage | array with free-text detail → open | no |
| Cross references | array with explanations → open | no |

---

## Hardware

| memory | what fits | when |
|---|---|---|
| 64 GB | models up to about 23 GB — the ≤31b class | anytime |
| 128 GB | `qwen3.5:122b` (81 GB) | when you are not using the machine |

Model sizes as downloaded:

| model | size | used for |
|---|---|---|
| `bge-m3` | 1.2 GB | embeddings — semantic references, text verification |
| `qwen3.5:27b` | 17 GB | triage, key words, osmain verification |
| `granite4.1:30b` | 17 GB | second judge in text verification |
| `gemma4:31b` | 19 GB | first judge, mapping generation, song references |
| `qwen3.5:122b` | 81 GB | translation, cross references, tagging |

If you only have the smaller class, every job in STATUS.md marked *local model*
that asks for a 27b or 31b model is available to you. Song references is the
largest of them.

---

## What local models cannot do here

**They cannot judge translation quality.** Measured against Claude's actual
corrections, local triage caught 31% of them (`qwen3.5:27b`) and 8%
(`qwen3.6:35b`) — and both missed exactly the valuable class: Hebrew morphology
and consistency of terms across verses. The deterministic part of that layer
(regular expressions, length checks, verse counts) is what pays off; the
judgement part does not.

**They cannot write the encyclopedic prose.** Person profiles are written by
Claude for the same reason.

Translation and proofreading of the Bible text itself have no `--local` at all.
That is not an oversight.

---

## Before a long run

```bash
bun generate/<script>.ts --help                            # flags and defaults
bun generate/<script>.ts --local --book 40 --chapter 1     # one chapter first
```

Then open the file it wrote. A model that produces nonsense produces it quietly.

Scripts must be run with `bun`, never `node` — they import the KVN layer, which
is TypeScript. Under `node` you get `ERR_MODULE_NOT_FOUND: kvn/src/ukvn-types.js`,
which looks like a missing file and is a wrong runtime.

Jobs are resumable: they skip units that already have output, so interrupting one
costs at most the unit in flight. A unit that *fails* is skipped in the same way,
without stopping the run — which is why a script finishing is not the same as the
work being done. Check with:

```bash
bun generate/build-status.ts --print
```

A chapter that failed once tends to fail again — an unparseable answer, an empty
answer — so run the stragglers one at a time and look at what comes out.

---

## The two long ones

Two jobs are large enough to be projects rather than runs, and both are
documented where they belong rather than here:

- **KVN text verification** checks that every mapping points at corresponding
  *text*, not merely at a valid verse number. Run `kvn/scripts/run-verification.sh`
  with no arguments and it explains its own order. The structural pass must come
  first: it finds, for free, the lookups that cannot succeed at all, and skipping
  it spends GPU time on verses that do not exist. One pass at a time — two models
  resident at once takes throughput from 3.5 seconds per verse to 11.
- **Supporting material into a new language** is `translate.ts`, described in
  `docs/supporting-material.md`. Cross references come last in its
  order on purpose: more than ten thousand files, and it runs for days.
