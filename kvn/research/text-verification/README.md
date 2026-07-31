# Text verification — the research behind it

The instruments behind verifying the mappings against the **text**, not against
the numbers. The scripts are tracked; the data is gitignored.

The background: the round-trip check counts numbers, so a mapping that is
bijective passes even when it points at the wrong verse. `basque` Psalm 110
pointed at the wrong chapter and passed; `albanian` Revelation 1–12 sits one
verse low throughout and passes. "1,157 of 1,158 clean" is a claim about
arithmetic, not about text.

The production tool that came out of this is `kvn/scripts/verify-text.ts`, run
through `./scripts/run-verification.sh`. See `kvn/README.md` → *Verifying the
mappings against the text*.

## What each script measured

| script | the question | the answer |
|---|---|---|
| `matrix.ts` | the main measurement: four error types × every detector | no single component managed it alone — hence five layers, OR-combined |
| `bench.ts` | how good is the judge? | miss rate **0.07%** (1 of 1,351), escalation 16.5% |
| `real-errors.ts` | does it hold against REAL mapping errors, not synthetic ones? | **13 of 13** of the documented errors in `FINDINGS.md` |
| `ensemble.ts` | which combination of judges is best? | two model families halve the miss rate |
| `competence.ts` | is the judge any good on THIS translation? | the basis for per-translation calibration |
| `fewshot.ts` | do calibration examples help? | yes — `_baseline.json` per translation |
| `pivot.ts` | is Norwegian the wrong language to compare in? | |
| `backtranslate.ts` + `judge-nb.ts` | does cross-lingual comparison get better if made monolingual? | |
| `coverage.ts`, `punct.ts`, `rank.ts`, `strata.ts`, `joint.ts` | the mechanical signals: clause coverage, truncated sentence, ranking, miss rate by proportion moved | they make up the `mech` pass |
| `partzero.ts` | what should the whole-verse entry point at when sub-verses exist? | |
| `verdicts-analyse.ts` | are false alarms systematically `B_EXTRA`? | yes — osmain is terser than literal translations |
| `inspect.ts` | read the false alarms | |
| `run.ts` | runs one configuration over the test set, storing a verdict per pair | the engine the others build on |

`queue.sh` … `queue4.sh` are the run series. Five of the scripts have no queue
line — they are exploratory and run by hand when you want to know something.

## Status

This is an **archive with a living corner**. The conclusions are in
`kvn/README.md`, but the caveat there has not been discharged: the bge-m3 layers
are measured on translations with cross-lingual similarity 0.66–0.87, while `hcv`
sits at 0.573 and `maori` at 0.607. That measurement remains to be made, and it
needs these instruments.

They are therefore **not** aligned to the flag contract the production scripts
follow (`--n` rather than `--limit`): changing them would risk invalidating a
measurement that is documented. See #59.

See also `../kvn-design/`, the equivalent apparatus behind the KVN encoding
itself.
