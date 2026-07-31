# Tekstverifisering — forskningsgrunnlaget

Måleapparatet bak verifiseringen av mappingene mot **teksten**, ikke mot
tallene. Skriptene er sporet, dataene gitignorert.

Bakgrunnen: rundturskontrollen teller tall, så en mapping som er bijektiv
består den selv om den peker på feil vers. `basque` Sal 110 pekte på feil
kapittel og besto; `albanian` Åp 1–12 ligger ett vers ned hele veien og består.
«1 157 av 1 158 rene» er en påstand om aritmetikk, ikke om tekst.

Driftsverktøyet som kom ut av dette er `kvn/scripts/verify-text.ts`, kjørt via
`./scripts/run-verification.sh`. Se `kvn/README.md` → *Verifisere mappingene mot
teksten*.

## Hva hvert skript målte

| skript | spørsmålet | svaret |
|---|---|---|
| `matrix.ts` | hovedmålingen: fire feiltyper × alle detektorer | ingen enkeltdel klarte det alene — derfor fem lag, ELLER-koblet |
| `bench.ts` | hvor god er dommeren? | bomrate **0,07 %** (1 av 1 351), eskalering 16,5 % |
| `real-errors.ts` | holder det mot EKTE mappingfeil, ikke syntetiske? | **13 av 13** dokumenterte feil i `FUNN.md` |
| `ensemble.ts` | hvilken kombinasjon av dommere er best? | to modellfamilier halverer bomraten |
| `competence.ts` | duger dommeren på DENNE oversettelsen? | grunnlaget for kalibrering per oversettelse |
| `fewshot.ts` | hjelper kalibreringseksempler? | ja — `_baseline.json` per oversettelse |
| `pivot.ts` | er norsk feil sammenlikningsspråk? | |
| `backtranslate.ts` + `judge-nb.ts` | blir kryssspråklig sammenlikning bedre enspråklig? | |
| `coverage.ts`, `punct.ts`, `rank.ts`, `strata.ts`, `joint.ts` | de mekaniske signalene: leddekning, avbrutt setning, rangering, bomrate etter flyttet andel | inngår i `mech`-passet |
| `partzero.ts` | hva skal helvers-posten peke på når delvers finnes? | |
| `verdicts-analyse.ts` | er falsk alarm systematisk `B_EXTRA`? | ja — osmain er tersere enn ordrette oversettelser |
| `inspect.ts` | les de falske alarmene | |
| `run.ts` | kjører én konfigurasjon over testsettet, lagrer dom per par | motoren de andre bygger på |

`queue.sh` … `queue4.sh` er kjøreseriene. Fem av skriptene har ingen kø-linje —
de er utforskende og kjøres for hånd når man vil vite noe.

## Status

Dette er **arkiv med et levende hjørne**. Konklusjonene står i `kvn/README.md`,
men forbeholdet der er ikke innfridd: de bge-m3-baserte lagene er målt på
oversettelser med kryssspråklig likhet 0,66–0,87, mens `hcv` ligger på 0,573 og
`maori` på 0,607. Den målingen gjenstår, og da trengs instrumentene.

De er derfor **ikke** ensrettet under flaggkontrakten som driftsskriptene
(`--n` framfor `--limit`): å endre dem ville risikert å ugyldiggjøre en måling
som er dokumentert. Se #59.

Se også `../kvn-design/`, som er det tilsvarende apparatet bak selve
KVN-encodingen.
