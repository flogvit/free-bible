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

**Resident memory is not the download size.** What Ollama holds includes the
KV cache, and that scales with the context window: `qwen3.6:35b` is 23 GB
downloaded and **28.8 GB** resident under a production prompt. Size a machine
from `ollama list` and you undercount by a quarter or more.

| memory | what fits | when |
|---|---|---|
| 64 GB | `qwen3.6:35b` (28.8 GB resident) with `bge-m3` beside it; `qwen3.5:27b` (35.0 GB) or `granite4.1:30b` (52.6 GB) on their own | anytime |
| 128 GB | `qwen3.5:122b` (81 GB downloaded) | when you are not using the machine |

**Parameter count no longer predicts either number.** `qwen3.6:35b` is
mixture-of-experts — 35B parameters with a fraction of them active per token — so
it is both smaller resident and faster than the dense `qwen3.6:27b`. A rule of
the form "this machine takes models up to 31 billion parameters" sorts them wrong
in both directions; read the measured columns instead.

| model | downloaded | resident | used for |
|---|---|---|---|
| `bge-m3` | 1.2 GB | — | embeddings — semantic references, text verification |
| `qwen3.5:27b` | 17 GB | 35.0 GB | triage, key words, osmain verification |
| `granite4.1:30b` | 17 GB | 52.6 GB | second judge in text verification |
| `gemma4:31b` | 19 GB | — | first judge, mapping generation, song references |
| `qwen3.6:35b` | 23 GB | 28.8 GB | judging semantic cross-reference candidates |
| `qwen3.5:122b` | 81 GB | — | translation, cross references, tagging |

A blank in `resident` means nobody has measured it, not that it is small. The
figures that are there were measured under the cross-reference prompt, below.

Every job in STATUS.md marked *local model* that asks for a 27b or 31b model runs
on 64 GB. Song references is the largest of them.

### Which judge fits the machine

A *judge* reads a source verse and a candidate verse side by side and answers
whether the connection between them is real — the second half of
`generate/references-semantic.ts`, and the most model-hungry loop here. Measured
2026-08-01 on Ollama, warm runner, 13 candidates, the production prompt and
schema verbatim:

| model | resident | s/verse | precision | verdict |
|---|---|---|---|---|
| **`qwen3.6:35b`** | **28.8 GB** | **17** | 100% | fastest and smallest — the judge a 64 GB machine can run |
| `qwen3.5:27b` | 35.0 GB | 65 | 100% | same acceptance rate over 19 verses / 750 candidates |
| `qwen3.6:27b` | 35.0 GB | 63 | — | slower *and* larger than the 35b — dense against MoE |
| `granite4.1:30b` | 52.6 GB | 57 | — | fills a 64 GB machine on its own |
| `qwen3.5:122b` | — | 96 | — | what `taskModels.references` asks for, and 5.6× slower |
| `aya:35b` | — | — | 54–71% | out: accepted nearly everything, 8 192-token context |
| `gemma4:31b` | — | — | — | out on open schemas: see `ollamaModelConfig` in `generate/constants.ts` |

**The precision column is thinner than it looks.** Both 100% figures come from 72
references over two verses, scored by Claude. The 19-verse run that would have
settled it failed on an expired API key, so its 549 accepted references have
never been scored. `qwen3.6:35b` had the higher mean in the small sample (4.71
against 4.33), and that is the whole basis for preferring it — if a larger run
ever shows `qwen3.5:27b` making fewer errors, speed does not outweigh that.

Re-measure whenever a new model appears:

```bash
bun generate/eval-judges.ts --models qwen3.6:35b,<the-new-one> --verses 10
```

It touches no reference files and spends no Claude credit. **Measure the old
model in the same call as the new one** — seconds are only comparable inside a
single run. Same model, same prompt, two consecutive days: 27 s/verse on a quiet
machine, 122 s/verse with an IDE at 265% CPU and a load average of 11. No
throttling, no battery — just contention. Ratios within a run survive that;
absolute numbers do not.

Pin the judge with `OLLAMA_MODEL`. That returns before the adoption logic in
`resolveLocalModel`, and therefore before the `openSchema` guard as well — so
pinning can put a model on a schema the guard would have refused it. How to run
the pass itself is in `docs/cross-references.md`.

---

## What local models can and cannot do here

**Where the knowledge comes from decides whether a small model is enough.** When
the corpus supplies the material and the model only passes a verdict on it, a
28.8 GB model is the equal of an 81 GB one: the judge above reads both verses in
the prompt, and matched the acceptance rate of a model twice its size while
running 5.6× faster than the default. When the answer has to come out of the
model's own parameters instead — Hebrew morphology, a term rendered differently
four chapters earlier — there is nothing in the prompt to lean on, and the size
it does not have is exactly what is missing.

**So they cannot judge translation quality.** Measured against Claude's actual
corrections, local triage caught 31% of them (`qwen3.5:27b`) and 8%
(`qwen3.6:35b`) — and both missed exactly the valuable class: Hebrew morphology
and consistency of terms across verses. That 8% is the same `qwen3.6:35b` that
tops the judge table; the task changed, not the model. The deterministic part of
that layer (regular expressions, length checks, verse counts) is what pays off;
the judgement part does not.

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

## The long ones

Three jobs are large enough to be projects rather than runs, and all three are
documented where they belong rather than here:

- **Cross references** are built by two scripts that write to the same files —
  `references.ts` asks the model, `references-semantic.ts` searches with vectors
  and merges what it finds. Which order, which flags, and what the proofread step
  does and does not do is in `docs/cross-references.md`.
- **KVN text verification** checks that every mapping points at corresponding
  *text*, not merely at a valid verse number. Run `kvn/scripts/run-verification.sh`
  with no arguments and it explains its own order. The structural pass must come
  first: it finds, for free, the lookups that cannot succeed at all, and skipping
  it spends GPU time on verses that do not exist. One pass at a time — two models
  resident at once takes throughput from 3.5 seconds per verse to 11.
- **Supporting material into a new language** is `translate.ts`, described in
  `docs/supporting-material.md`. Cross references come last in its
  order on purpose: more than ten thousand files, and it runs for days.
