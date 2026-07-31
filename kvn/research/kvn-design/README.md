# KVN design — the measurements behind the encoding

These five scripts answered questions that have been **settled**. They live here
rather than in `kvn/scripts/` because they are not production tools: they are run
again only if the decision is reopened.

| script | the question | the answer was |
|---|---|---|
| `analyze-spacing.ts` | how much room does the KVN encoding need? | `PART_SIZE = 16`, `MAX_VERSE = 177`, `MAX_CHAPTER = 151` — see `kvn/README.md` |
| `analyze-verse-structures.ts` | what does verse structure look like across 1,147 translations? | the same encoding decision |
| `analyze-sentence-splits.ts` | does verse division follow sentence boundaries? | the part field, and the Type A/B/C division of the psalm deviations |
| `benchmark-models.ts` | which local model matches verses best? | gemma4 for bulk matching |
| `benchmark-mapping-models.ts` | the same, across every model | the same |

They load large models and scan the whole Bible corpus. Do not run them to "see
what they do" — `--help` tells you that, and it is safe.

See also `../text-verification/`, the equivalent apparatus behind the text
verification (#59).
