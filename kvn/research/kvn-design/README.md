# KVN-design — måleapparatet bak encodingen

Disse fem skriptene svarte på spørsmål som er **avgjort**. De ligger her, og
ikke i `kvn/scripts/`, fordi de ikke er driftsverktøy: de kjøres igjen bare
hvis beslutningen skal opp på nytt.

| skript | spørsmålet | svaret ble |
|---|---|---|
| `analyze-spacing.ts` | hvor mye plass trenger KVN-encodingen? | `PART_SIZE = 16`, `MAX_VERSE = 177`, `MAX_CHAPTER = 151` — se `kvn/README.md` |
| `analyze-verse-structures.ts` | hvordan ser versstrukturen ut i 1 147 oversettelser? | samme encoding-beslutning |
| `analyze-sentence-splits.ts` | følger versdeling setningsgrenser? | part-feltet, og Type A/B/C-inndelingen av salmeavvikene |
| `benchmark-models.ts` | hvilken lokal modell matcher vers best? | gemma4 for bulk-matching |
| `benchmark-mapping-models.ts` | samme, over alle modellene | samme |

De laster store modeller og skanner hele bibelkorpuset. Ikke kjør dem for å
«se hva de gjør» — `--help` forteller det, og den er trygg.

Se også `../text-verification/`, som er det tilsvarende apparatet bak
tekstverifiseringen (#59).
