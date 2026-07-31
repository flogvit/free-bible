# Skriptreferanse

> Generert av `generate/build-script-docs.ts` fra kildekoden.
> **Ikke rediger for hånd** — kjør `bun generate/build-script-docs.ts`.

Flaggtabellene kommer fra `SPEC`-en i hvert skript, så de kan ikke drifte
fra koden. Standardverdien er tatt med fordi den er den eneste som ikke går
an å lese ut av kommandolinja i ettertid.

Rekkefølgen man kjører dem i står i [ny-oversettelse.md](ny-oversettelse.md)
og [tilleggsmateriale.md](tilleggsmateriale.md).

## Felles flagg

Disse betyr det samme i alle skript som har dem (#51, #52):

| flagg | type | standard | betydning |
|---|---|---|---|
| `--bible` | string | — | hvilken oversettelse, f.eks. osnb |
| `--language` | string | `nb` | språkkode, f.eks. nb |
| `--book` | range | — | bok eller bokintervall, f.eks. 1 eller 1-5 |
| `--chapter` | range | — | kapittel eller kapittelintervall |
| `--verse` | range | — | vers eller versintervall |
| `--ot` | boolean | — | bare Det gamle testamentet |
| `--nt` | boolean | — | bare Det nye testamentet |
| `--limit` | number | — | stopp etter N enheter |
| `--force` | boolean | — | kjør på nytt selv om resultatet finnes |
| `--local` | boolean | — | kjør mot lokal Ollama i stedet for Claude |
| `--dry-run` | boolean | — | vis hva som ville skjedd, uten å skrive |
| `--help` | boolean | — | vis denne teksten |

`--remote` er **fjernet**: den betydde det motsatte av `--local`, og uten
flagget kjøres jobben mot Claude. `--lang`, `--dry`, `--source` og `--n`
godtas fortsatt, men advarer.

Et ukjent flagg **kaster**. Den gamle oppførselen — stille ignorering —
betyr at en skrivefeil i et køskript gir en jobb som kjører med feil
innstilling uten å si fra.

## generate/

Oversettelse, korrektur og alt tilleggsmateriale.

### `generate/bible-persons.ts`

| flagg | type | standard | betydning |
|---|---|---|---|
| `--bible` | string | — | hvilken oversettelse, f.eks. osnb |
| `--book` | range | — | bok eller bokintervall, f.eks. 1 eller 1-5 |
| `--chapter` | range | — | kapittel eller kapittelintervall |
| `--ot` | boolean | — | bare Det gamle testamentet |
| `--nt` | boolean | — | bare Det nye testamentet |
| `--local` | boolean | — | kjør mot lokal Ollama i stedet for Claude |
| `--index` | boolean | — | skann bibelen for personnavn med Ollama og fest versreferanser |
| `--proofread` | boolean | — | korrekturles personprofilene som finnes |
| `--apply` | boolean | — | skriv korrekturens forslag tilbake (slår på tilbakekoblingssløyfa) |
| `--min-score` | number | `8` | laveste godtatte score, 0-10 |
| `--max-iter` | number | `3` | maks korrekturrunder per person |
| `--continue` | boolean | — | hopp over personer som alt har score >= --min-score og fotnoter |
| `--help` | boolean | — | vis denne teksten |

### `generate/bible.ts`

| flagg | type | standard | betydning |
|---|---|---|---|
| `--bible` | string | — | hvilken oversettelse, f.eks. osnb |
| `--book` | range | — | bok eller bokintervall, f.eks. 1 eller 1-5 |
| `--chapter` | range | — | kapittel eller kapittelintervall |
| `--verse` | range | — | korrekturles bare disse versene — hopper over oversettelsen |
| `--ot` | boolean | — | bare Det gamle testamentet |
| `--nt` | boolean | — | bare Det nye testamentet |
| `--force` | boolean | — | kjør på nytt selv om resultatet finnes |
| `--style` | string | — | oversettelsesstil; uten flagget hentes stilen fra oversettelsens oppsett |
| `--proofread` | boolean | — | korrekturles etter oversettelsen |
| `--apply` | boolean | — | skriv korrekturens forslag inn i teksten |
| `--batch` | boolean | — | korrekturles hele kapittelet i noen få kall med tilbakemeldingssløyfe (osnbs metode, 6,6× billigere) |
| `--text-only` | boolean | — | bare tekstfasen, hopp over fotnotene |
| `--skip-existing` | boolean | — | hopp over vers som alt er gjort (fotnoter finnes, eller textChecked i --text-only) |
| `--changed-only` | string | — | andregangs pass over vers som alt er endret; valgfri kommaliste av typer, f.eks. error,grammar |
| `--check-length` | string | — | andregangs pass over vers som er blitt mye kortere enn en tidligere versjon; valgfritt forholdstall (standard (fra koden)) |
| `--min-score` | number | `8` | laveste godtatte score, 0-10 |
| `--max-iter` | number | `3` | maks korrekturrunder per fase |
| `--help` | boolean | — | vis denne teksten |

### `generate/book-context.ts`

| flagg | type | standard | betydning |
|---|---|---|---|
| `--language` | string | `nb` | språkkode, f.eks. nb |
| `--book` | range | — | bok eller bokintervall, f.eks. 1 eller 1-5 |
| `--ot` | boolean | — | bare Det gamle testamentet |
| `--nt` | boolean | — | bare Det nye testamentet |
| `--force` | boolean | — | kjør på nytt selv om resultatet finnes |
| `--local` | boolean | — | kjør mot lokal Ollama i stedet for Claude |
| `--proofread` | boolean | — | kjør korrektur etter genereringen |
| `--apply` | boolean | — | skriv korrekturens reviderte kontekst tilbake til fila |
| `--help` | boolean | — | vis denne teksten |

### `generate/book-summary.ts`

| flagg | type | standard | betydning |
|---|---|---|---|
| `--language` | string | `nb` | språkkode, f.eks. nb |
| `--book` | range | — | bok eller bokintervall, f.eks. 1 eller 1-5 |
| `--ot` | boolean | — | bare Det gamle testamentet |
| `--nt` | boolean | — | bare Det nye testamentet |
| `--force` | boolean | — | kjør på nytt selv om resultatet finnes |
| `--local` | boolean | — | kjør mot lokal Ollama i stedet for Claude |
| `--proofread` | boolean | — | kjør korrektur etter genereringen |
| `--apply` | boolean | — | skriv korrekturens reviderte sammendrag tilbake til fila |
| `--help` | boolean | — | vis denne teksten |

### `generate/build-mapping-v1-osnb.ts`

| flagg | type | standard | betydning |
|---|---|---|---|
| `--use-ai` | boolean | — | la Claude matche versene som ikke lar seg mappe deterministisk |
| `--help` | boolean | — | vis denne teksten |

### `generate/build-missing-persons.ts`

| flagg | type | standard | betydning |
|---|---|---|---|
| `--limit` | number | — | stopp etter N enheter |
| `--dry-run` | boolean | — | vis hva som ville skjedd, uten å skrive |
| `--start` | number | `0` | hopp over de N første som mangler |
| `--help` | boolean | — | vis denne teksten |

### `generate/build-reading-plans.ts`

Unified reading plan generator Generates all reading plans from configuration Run with: bun build-reading-plans.ts Flaggene går gjennom den felles kontrakten i cli.ts; `--help` viser dem.

| flagg | type | standard | betydning |
|---|---|---|---|
| `--help` | boolean | — | vis denne teksten |

### `generate/build-sblgnt.ts`

| flagg | type | standard | betydning |
|---|---|---|---|
| `--help` | boolean | — | vis denne teksten |

### `generate/build-script-docs.ts`

Genererer `docs/skript.md` fra koden (#113).

| flagg | type | standard | betydning |
|---|---|---|---|
| `--check` | boolean | — | ikke skriv — feil hvis docs/skript.md er utdatert |
| `--help` | boolean | — | vis denne teksten |

### `generate/build-tanach.ts`

| flagg | type | standard | betydning |
|---|---|---|---|
| `--help` | boolean | — | vis denne teksten |

### `generate/build-translations-index.ts`

Build generate/translations/index.json — one merged record per translation, ready for a website to fetch once and use for both list and detail views.

| flagg | type | standard | betydning |
|---|---|---|---|
| `--help` | boolean | — | vis denne teksten |

### `generate/build-translations-meta.ts`

| flagg | type | standard | betydning |
|---|---|---|---|
| `--only` | string | — | bare disse oversettelsene, kommaseparert (f.eks. kjv,geneva) |
| `--force` | boolean | — | kjør på nytt selv om resultatet finnes |
| `--recount` | boolean | — | oppdater bare coverage/features på eksisterende meta.json, uten modellkall |
| `--no-web` | boolean | — | hopp over websøk-passet — bare pass 1 (billig prøvekjøring) |
| `--help` | boolean | — | vis denne teksten |

### `generate/chapter-context.ts`

| flagg | type | standard | betydning |
|---|---|---|---|
| `--language` | string | `nb` | språkkode, f.eks. nb |
| `--book` | range | — | bok eller bokintervall, f.eks. 1 eller 1-5 |
| `--chapter` | range | — | kapittel eller kapittelintervall |
| `--ot` | boolean | — | bare Det gamle testamentet |
| `--nt` | boolean | — | bare Det nye testamentet |
| `--force` | boolean | — | kjør på nytt selv om resultatet finnes |
| `--local` | boolean | — | kjør mot lokal Ollama i stedet for Claude |
| `--proofread` | boolean | — | kjør korrektur etter genereringen |
| `--apply` | boolean | — | skriv korrekturens reviderte kontekst tilbake til fila |
| `--help` | boolean | — | vis denne teksten |

### `generate/chapter-summary.ts`

| flagg | type | standard | betydning |
|---|---|---|---|
| `--language` | string | `nb` | språkkode, f.eks. nb |
| `--book` | range | — | bok eller bokintervall, f.eks. 1 eller 1-5 |
| `--chapter` | range | — | kapittel eller kapittelintervall |
| `--ot` | boolean | — | bare Det gamle testamentet |
| `--nt` | boolean | — | bare Det nye testamentet |
| `--force` | boolean | — | kjør på nytt selv om resultatet finnes |
| `--local` | boolean | — | kjør mot lokal Ollama i stedet for Claude |
| `--proofread` | boolean | — | kjør korrektur etter genereringen |
| `--apply` | boolean | — | skriv korrekturens reviderte sammendrag tilbake til fila |
| `--help` | boolean | — | vis denne teksten |

### `generate/chapter-tags.ts`

| flagg | type | standard | betydning |
|---|---|---|---|
| `--language` | string | `nb` | språkkode, f.eks. nb |
| `--bible` | string | — | hvilken oversettelse, f.eks. osnb |
| `--book` | range | — | bok eller bokintervall, f.eks. 1 eller 1-5 |
| `--chapter` | range | — | kapittel eller kapittelintervall |
| `--ot` | boolean | — | bare Det gamle testamentet |
| `--nt` | boolean | — | bare Det nye testamentet |
| `--local` | boolean | — | kjør mot lokal Ollama i stedet for Claude |
| `--force` | boolean | — | kjør på nytt selv om resultatet finnes |
| `--help` | boolean | — | vis denne teksten |

### `generate/convert-refs.ts`

convert-refs.ts — Convert plain-text Bible references to [ref:...|...] markup.

| flagg | type | standard | betydning |
|---|---|---|---|
| `--dry-run` | boolean | — | vis hva som ville skjedd, uten å skrive |
| `--stats` | boolean | — | skriv ut hvor mange referanser hver fil fikk |
| `--verify` | boolean | — | valider [ref:...]-markeringene som alt ligger på disk |
| `--path` | string | — | behandle bare filer under denne katalogen, relativt til generate/ |
| `--help` | boolean | — | vis denne teksten |

### `generate/day-tags.ts`

| flagg | type | standard | betydning |
|---|---|---|---|
| `--language` | string | `nb` | språkkode, f.eks. nb |
| `--bible` | string | — | hvilken oversettelse, f.eks. osnb |
| `--book` | range | — | bok eller bokintervall, f.eks. 1 eller 1-5 |
| `--chapter` | range | — | kapittel eller kapittelintervall |
| `--ot` | boolean | — | bare Det gamle testamentet |
| `--nt` | boolean | — | bare Det nye testamentet |
| `--local` | boolean | — | kjør mot lokal Ollama i stedet for Claude |
| `--force` | boolean | — | kjør på nytt selv om resultatet finnes |
| `--proofread` | boolean | — | kjør korrektur etter taggingen |
| `--apply` | boolean | — | skriv korrekturens reviderte tagger tilbake til fila |
| `--min-score` | number | `8` | laveste godtatte score 0-10 før korrekturen kjøres på nytt |
| `--max-iter` | number | `3` | flest korrekturrunder per kapittel |
| `--help` | boolean | — | vis denne teksten |

### `generate/days-mentions.ts`

| flagg | type | standard | betydning |
|---|---|---|---|
| `--bible` | string | — | hvilken oversettelse, f.eks. osnb |
| `--book` | range | — | bok eller bokintervall, f.eks. 1 eller 1-5 |
| `--chapter` | range | — | kapittel eller kapittelintervall (krever én enkelt bok) |
| `--ot` | boolean | — | bare Det gamle testamentet |
| `--nt` | boolean | — | bare Det nye testamentet |
| `--force` | boolean | — | kjør på nytt selv om resultatet finnes |
| `--help` | boolean | — | vis denne teksten |

### `generate/days.ts`

| flagg | type | standard | betydning |
|---|---|---|---|
| `--help` | boolean | — | vis denne teksten |

### `generate/eval-references.ts`

| flagg | type | standard | betydning |
|---|---|---|---|
| `--build-only` | boolean | — | bygg bare vektorene, hopp over verifiseringen |
| `--verify-only` | boolean | — | verifiser bare (evalueringen sender denne selv) |
| `--top-k` | number | — | antall kandidater per vers |
| `--threshold` | string | — | minste cosinuslikhet (bge-m3 gir beslektede vers 0.60–0.70) |
| `--neighbor-skip` | number | — | hopp over vers i samme kapittel innenfor N |
| `--theme` | boolean | — | la modellen oppsummere verset og søk også på oppsummeringen |
| `--concepts` | boolean | — | la modellen lage 4 fasettspørsmål og søk på hvert av dem |
| `--resume` | boolean | — | hopp over vers som alt er kjørt |
| `--skip-existing` | boolean | — | hopp over vers som alt har en referansefil |
| `--book` | range | — | bok eller bokintervall, f.eks. 1 eller 1-5 |
| `--chapter` | range | — | kapittel eller kapittelintervall |
| `--verse` | range | — | vers eller versintervall |
| `--force` | boolean | — | bygg vektorene på nytt |
| `--help` | boolean | — | vis denne teksten |

### `generate/glossary.ts`

Key-term consistency across a translation.

| flagg | type | standard | betydning |
|---|---|---|---|
| `--audit` | boolean | — | vis hvilke nøkkelbegreper som glir, og hvor minoritetsgjengivelsene står (standard) |
| `--write` | boolean | — | skriv glossary/<oversettelse>.json som bible.ts bruker i oversettelsesprompten |
| `--parallels` | boolean | — | sammenlikn parallellsteder: nær lik kilde, men oversettelser som har glidd fra hverandre |
| `--help` | boolean | — | vis denne teksten |

### `generate/headings.ts`

| flagg | type | standard | betydning |
|---|---|---|---|
| `--bible` | string | — | hvilken oversettelse, f.eks. osnb |
| `--book` | range | — | bok eller bokintervall, f.eks. 1 eller 1-5 |
| `--chapter` | range | — | kapittel eller kapittelintervall (krever én enkelt bok) |
| `--ot` | boolean | — | bare Det gamle testamentet |
| `--nt` | boolean | — | bare Det nye testamentet |
| `--no-local` | boolean | `true` | kjør mot lokal Ollama i stedet for Claude |
| `--no-local` | boolean | — | kjør mot Claude i stedet for lokal Ollama (het --remote før) |
| `--force` | boolean | — | kjør på nytt selv om resultatet finnes |
| `--help` | boolean | — | vis denne teksten |

### `generate/number-symbolism.ts`

| flagg | type | standard | betydning |
|---|---|---|---|
| `--language` | string | `nb` | språkkode, f.eks. nb |
| `--number` | range | — | tall eller tallintervall, f.eks. 7 eller 1-12 |
| `--all` | boolean | — | alle tall som alt har en fil, ellers de kjente symbolske |
| `--bible` | string | — | hvilken oversettelse, f.eks. osnb |
| `--scan` | boolean | — | bare tell forekomster i oversettelsen, uten å generere |
| `--index` | boolean | — | les hvert vers i oversettelsen og trekk ut tallene (krever --bible) |
| `--book` | range | — | bok eller bokintervall, f.eks. 1 eller 1-5 |
| `--chapter` | range | — | kapittel eller kapittelintervall |
| `--verse` | range | — | vers eller versintervall |
| `--ot` | boolean | — | bare Det gamle testamentet |
| `--nt` | boolean | — | bare Det nye testamentet |
| `--proofread` | boolean | — | kjør korrektur etter genereringen |
| `--apply` | boolean | — | skriv korrekturens forslag inn i fila (slår på tilbakekoblingssløyfa) |
| `--min-score` | number | `8` | godtatt korrekturscore, 0-10 |
| `--max-iter` | number | `3` | maks korrekturrunder per tall |
| `--force` | boolean | — | kjør på nytt selv om resultatet finnes |
| `--local` | boolean | — | kjør mot lokal Ollama i stedet for Claude |
| `--help` | boolean | — | vis denne teksten |

### `generate/parse-lesetekster.ts`

| flagg | type | standard | betydning |
|---|---|---|---|
| `--help` | boolean | — | vis denne teksten |

### `generate/persons-apply-context.ts`

| flagg | type | standard | betydning |
|---|---|---|---|
| `--dry-run` | boolean | — | vis hva som ville skjedd, uten å skrive |
| `--help` | boolean | — | vis denne teksten |

### `generate/persons-apply-reconcile.ts`

| flagg | type | standard | betydning |
|---|---|---|---|
| `--dry-run` | boolean | — | vis hva som ville skjedd, uten å skrive |
| `--help` | boolean | — | vis denne teksten |

### `generate/persons-audit.ts`

| flagg | type | standard | betydning |
|---|---|---|---|
| `--help` | boolean | — | vis denne teksten |

### `generate/persons-integrity.ts`

| flagg | type | standard | betydning |
|---|---|---|---|
| `--verbose` | boolean | — | list hvert avvik og hver uløst referanse, ikke bare tellingene |
| `--worklist` | string | — | skriv arbeidslista som JSON til denne stien |
| `--help` | boolean | — | vis denne teksten |

### `generate/persons-reconcile-context.ts`

| flagg | type | standard | betydning |
|---|---|---|---|
| `--help` | boolean | — | vis denne teksten |

### `generate/persons-reconcile.ts`

| flagg | type | standard | betydning |
|---|---|---|---|
| `--help` | boolean | — | vis denne teksten |

### `generate/persons-write-batch.ts`

| flagg | type | standard | betydning |
|---|---|---|---|
| `--help` | boolean | — | vis denne teksten |

### `generate/references-semantic.ts`

| flagg | type | standard | betydning |
|---|---|---|---|
| `--build-only` | boolean | — | bygg bare vektorene, hopp over verifiseringen |
| `--verify-only` | boolean | — | verifiser bare, forutsetter at vektorene finnes |
| `--top-k` | number | `10` | antall kandidater per vers |
| `--threshold` | string | `0.60` | minste cosinuslikhet (bge-m3 gir beslektede vers 0.60–0.70) |
| `--neighbor-skip` | number | `5` | hopp over vers i samme kapittel innenfor N |
| `--theme` | boolean | — | la modellen oppsummere verset og søk også på oppsummeringen |
| `--concepts` | boolean | — | la modellen lage 4 fasettspørsmål og søk på hvert av dem |
| `--resume` | boolean | — | hopp over vers som alt er kjørt (embeddings/<korpus>/semantic_progress.json) |
| `--skip-existing` | boolean | — | hopp over vers som alt har en referansefil |
| `--book` | range | — | bok eller bokintervall, f.eks. 1 eller 1-5 |
| `--chapter` | range | — | kapittel eller kapittelintervall |
| `--verse` | range | — | vers eller versintervall |
| `--force` | boolean | — | bygg vektorene på nytt (rører ikke referansefilene — fletting bevarer alltid det som finnes) |
| `--help` | boolean | — | vis denne teksten |

### `generate/references.ts`

| flagg | type | standard | betydning |
|---|---|---|---|
| `--language` | string | `nb` | språkkode, f.eks. nb |
| `--book` | range | — | bok eller bokintervall, f.eks. 1 eller 1-5 |
| `--chapter` | range | — | kapittel eller kapittelintervall |
| `--verse` | range | — | vers eller versintervall |
| `--ot` | boolean | — | bare Det gamle testamentet |
| `--nt` | boolean | — | bare Det nye testamentet |
| `--force` | boolean | — | kjør på nytt selv om resultatet finnes |
| `--local` | boolean | — | kjør mot lokal Ollama i stedet for Claude |
| `--proofread` | boolean | — | kjør korrektur etter genereringen |
| `--apply` | boolean | — | skriv korrekturens reviderte referanser tilbake til fila |
| `--validate` | boolean | — | sveip referansene som alt ligger på disk, uten å generere |
| `--fix` | boolean | — | fjern de døde adressene --validate finner |
| `--help` | boolean | — | vis denne teksten |

### `generate/scan-stories.ts`

| flagg | type | standard | betydning |
|---|---|---|---|
| `--book` | range | — | bok eller bokintervall, f.eks. 1 eller 1-5 |
| `--chapter` | range | — | kapittel eller kapittelintervall |
| `--ot` | boolean | — | bare Det gamle testamentet |
| `--nt` | boolean | — | bare Det nye testamentet |
| `--language` | string | `nb` | språkkode, f.eks. nb |
| `--limit` | number | — | stopp etter N enheter |
| `--dry-run` | boolean | — | kjør modellen, men ikke skriv forslagsfiler |
| `--no-local` | boolean | `true` | kjør mot Claude i stedet for lokal Ollama |
| `--include-poetic` | boolean | — | ta òg med Salmene, Ordspråkene, Forkynneren, Høysangen og Klagesangene |
| `--include-epistles` | boolean | — | ta òg med brevene i NT (Romerne–Judas) |
| `--resume` | boolean | — | hopp over kapitlene som alt står i .scan_state.json |
| `--proofread` | boolean | — | korrekturmodus i stedet for skanning |
| `--pool` | string | `proposed` | hvilke filer korrekturen leser: proposed, existing eller both |
| `--apply` | boolean | — | skriv resultatet av korrekturen; uten den logges bare dommene |
| `--min-score` | number | `8` | score på approve-dom som godkjenner fortellingen |
| `--reject-score` | number | `4` | score på reject-dom som forkaster fortellingen |
| `--max-iter` | number | `3` | maks antall korrekturrunder per fil |
| `--continue` | boolean | — | hopp over filer som alt er godkjent med score ≥ --min-score |
| `--help` | boolean | — | vis denne teksten |

### `generate/song-references.ts`

Map songs to Bible verse references using LLM.

| flagg | type | standard | betydning |
|---|---|---|---|
| `--language` | string | — | bare sanger på dette språket (nb, en, da-no-historic); uten flagget: alle |
| `--id` | string | — | bare denne sangen, f.eks. song-0217 |
| `--limit` | number | — | stopp etter N enheter |
| `--model` | string | — | pinn Ollama-modellen (uten flagget: (fra koden), eller en større som alt ligger i minnet) |
| `--force` | boolean | — | kjør på nytt selv om resultatet finnes |
| `--help` | boolean | — | vis denne teksten |

### `generate/stories.ts`

| flagg | type | standard | betydning |
|---|---|---|---|
| `--validate` | boolean | — | lokal kontroll av format og referanser, uten modellkall |
| `--proofread` | boolean | — | les korrektur på historiene mot osnb-teksten |
| `--apply` | boolean | — | skriv korrekturens reviderte historie tilbake til fila |
| `--generate` | boolean | — | generer ti nye historier som ikke finnes fra før |
| `--category` | string | — | begrens --generate til én kategori, f.eks. paulus |
| `--file` | string | — | behandle bare denne historien, oppgitt som slug |
| `--min-score` | number | `7` | bruk endringene bare når scoren er lavere enn dette |
| `--help` | boolean | — | vis denne teksten |

### `generate/triage.ts`

| flagg | type | standard | betydning |
|---|---|---|---|
| `--book` | range | — | bok eller bokintervall, f.eks. 1 eller 1-5 |
| `--chapter` | range | — | kapittel eller kapittelintervall |
| `--verse` | range | — | vers eller versintervall |
| `--ot` | boolean | — | bare Det gamle testamentet |
| `--nt` | boolean | — | bare Det nye testamentet |
| `--model` | string | — | pin den lokale modellen (uten flagget: (fra koden), eller en større som alt ligger i minnet; OLLAMA_MODEL overstyrer) |
| `--min-score` | number | `8` | flagg vers som scorer under dette (0-10) |
| `--drop` | boolean | — | pensjoner flagget tekst slik at bible.ts oversetter den på nytt (historikken beholdes) |
| `--recheck` | boolean | — | triager på nytt de versene som alt har en dom |
| `--peer` | string | — | oversettelse på samme språk, for lengde og ordvalg (uten flagget, per språk: ) |
| `--no-peer` | boolean | — | hopp over sammenlikningen mot samme språk |
| `--reference` | string | `osnb` | korrekturlest oversettelse på et annet språk, for mening |
| `--help` | boolean | — | vis denne teksten |

### `generate/verse-translation.ts`

| flagg | type | standard | betydning |
|---|---|---|---|
| `--book` | range | — | bok eller bokintervall, f.eks. 1 eller 1-5 |
| `--chapter` | range | — | kapittel eller kapittelintervall |
| `--ot` | boolean | — | bare Det gamle testamentet |
| `--nt` | boolean | — | bare Det nye testamentet |
| `--force` | boolean | — | kjør på nytt selv om resultatet finnes |
| `--proofread` | boolean | — | kjør korrektur etter genereringen |
| `--apply` | boolean | — | skriv korrekturens forslag inn i forklaringsfila |
| `--help` | boolean | — | vis denne teksten |

### `generate/word4word.ts`

| flagg | type | standard | betydning |
|---|---|---|---|
| `--bible` | string | — | kilden, som posisjonsargumentet: osnb, osnn, osen, tanach, sblgnt |
| `--language` | string | `nb` | språkkode, f.eks. nb |
| `--proofread` | boolean | — | kjør korrektur etter genereringen |
| `--apply` | boolean | — | skriv korrekturens forslag inn i fila |
| `--book` | range | — | bok eller bokintervall, f.eks. 1 eller 1-5 |
| `--chapter` | range | — | kapittel eller kapittelintervall |
| `--verse` | range | — | vers eller versintervall |
| `--ot` | boolean | — | bare Det gamle testamentet |
| `--nt` | boolean | — | bare Det nye testamentet |
| `--force` | boolean | — | kjør på nytt selv om resultatet finnes |
| `--help` | boolean | — | vis denne teksten |

## kvn/scripts/

Mappinger, osmain og tekstverifisering. Les `kvn/README.md` først.

### `kvn/scripts/add-source-field.ts`

Add "source" field to all osmain verses that came from osnb.

| flagg | type | standard | betydning |
|---|---|---|---|
| `--help` | boolean | — | vis denne teksten |

### `kvn/scripts/audit-ukvn-collisions.ts`

Kollisjonsaudit for ukvn-mappinger (issue #18).

| flagg | type | standard | betydning |
|---|---|---|---|
| `--help` | boolean | — | vis denne teksten |

### `kvn/scripts/batch-mappings.ts`

Generate KVN mappings for every open-licensed translation listed in docs/open-bibles/inventory.json, using qwen3.5:122b via build-mapping.ts (--fast --no-verify).

| flagg | type | standard | betydning |
|---|---|---|---|
| `--model` | string | `qwen3.5:122b` | Ollama-modellen build-mapping.ts skal bruke |
| `--only` | string | — | kommaseparert liste over oversettelser; uten flagget kjøres alle med kvn_ok i inventaret |
| `--help` | boolean | — | vis denne teksten |

### `kvn/scripts/build-derived-mappings.ts`

Deterministisk masseproduksjon av ukvn-mappinger (issue #17/#18).

| flagg | type | standard | betydning |
|---|---|---|---|
| `--fingerprints` | string | — | fil med versnummer-sett per oversettelse og kapittel (påkrevd) |
| `--dry-run` | boolean | — | vis hva som ville skjedd, uten å skrive |
| `--help` | boolean | — | vis denne teksten |

### `kvn/scripts/build-dnb2011-mapping.ts`

Build a universal KVN mapping for DNB 2011 by comparing against osnb.

| flagg | type | standard | betydning |
|---|---|---|---|
| `--help` | boolean | — | vis denne teksten |

### `kvn/scripts/build-gap-results.ts`

GPU-free pre-pass for KVN mapping generation.

| flagg | type | standard | betydning |
|---|---|---|---|
| `--only` | string | — | behandle bare disse oversettelsene, kommaseparert |
| `--help` | boolean | — | vis denne teksten |

### `kvn/scripts/build-mapping.ts`

| flagg | type | standard | betydning |
|---|---|---|---|
| `--bible` | string | `dnb2011_nb` | hvilken oversettelse, f.eks. osnb |
| `--format` | string | `raw` | 'raw' leser JSON-katalogene, 'txt' leser external/closed/<bibel>.txt |
| `--chapter` | string | — | bare dette kapittelet, som bok:kapittel, f.eks. 19:3 |
| `--model` | string | `gemma4:31b` | Ollama-modellen som gjør versmatchingen |
| `--dry-run` | boolean | — | list kapitlene som ville gått til Ollama, uten å kjøre dem |
| `--fast` | boolean | — | hopp over Ollama for kapitler med samme versnumre som osmain (uten flagget går alle gjennom, så tekstnivå-splitter og -sammenslåinger også fanges) |
| `--no-verify` | boolean | `true` | Claude-verifisering av flaggede kapitler; slått av markeres de «needsReview» i resultatfila i stedet |
| `--help` | boolean | — | vis denne teksten |

### `kvn/scripts/build-source-mappings.ts`

build-source-mappings.ts — utleder tanach- og sblgnt-mappingene fra osnb.

| flagg | type | standard | betydning |
|---|---|---|---|
| `--help` | boolean | — | vis denne teksten |

### `kvn/scripts/check-bible-integrity.ts`

Data-integrity check for translations in generate/bibles_raw/.

| flagg | type | standard | betydning |
|---|---|---|---|
| `--only` | string | — | bare disse oversettelsene, kommaseparert (f.eks. kjv,web) |
| `--all` | boolean | — | ta med de feilfrie oversettelsene i utskriften også |
| `--help` | boolean | — | vis denne teksten |

### `kvn/scripts/check-mapping-coverage.ts`

Strukturell dekningssjekk: finner osmain-vers som mappingen slår opp til et versnummer oversettelsen ikke har.

| flagg | type | standard | betydning |
|---|---|---|---|
| `--min` | float | `1` | rapporter bare oversettelser med minst N uoppnåelige vers |
| `--help` | boolean | — | vis denne teksten |

### `kvn/scripts/diagnose-boundary-verses.ts`

Diagnostic script: Cross-checks all osmain boundary verses against osnb mapping, KJV, and nb-2024 to identify wrong texts.

| flagg | type | standard | betydning |
|---|---|---|---|
| `--help` | boolean | — | vis denne teksten |

### `kvn/scripts/fix-all-renumbering.ts`

Fix all renumbered chapters in osmain using Ollama.

| flagg | type | standard | betydning |
|---|---|---|---|
| `--dry-run` | boolean | — | vis hva som ville skjedd, uten å skrive |
| `--help` | boolean | — | vis denne teksten |

### `kvn/scripts/fix-osmain-boundaries.ts`

Fix osmain boundary-shift placeholders by copying text from osnb.

| flagg | type | standard | betydning |
|---|---|---|---|
| `--help` | boolean | — | vis denne teksten |

### `kvn/scripts/patch-cross-chapter.ts`

Add same-book, adjacent-chapter cross-chapter entries to a built .ukvn.json.

| flagg | type | standard | betydning |
|---|---|---|---|
| `--help` | boolean | — | vis denne teksten |

### `kvn/scripts/review-mapping.ts`

Review helper: for a translation, print each real (non-identity) chapter with osmain text, translation text, and the proposed mapping from its result file, so a human can verify the alignment is correct.

| flagg | type | standard | betydning |
|---|---|---|---|
| `--help` | boolean | — | vis denne teksten |

### `kvn/scripts/screen-alignment.ts`

Lag 1 i mapping-verifiseringen (issue #18): lengdekorrelasjons-screen.

| flagg | type | standard | betydning |
|---|---|---|---|
| `--lengths` | string | — | lengdefila å screene mot (påkrevd) |
| `--apply` | boolean | — | skriv AUTOFIX-entries inn i mappingfilene |
| `--help` | boolean | — | vis denne teksten |

### `kvn/scripts/translate-missing.ts`

| flagg | type | standard | betydning |
|---|---|---|---|
| `--translate` | boolean | — | skriv oversettelsene; uten flagget kjøres bare skanningen |
| `--chapter` | string | — | bare dette kapitlet, som «bok:kapittel», f.eks. 39:4 |
| `--help` | boolean | — | vis denne teksten |

### `kvn/scripts/verify-mapping-anchors.ts`

Automated sanity check for a translation's mapping result files.

| flagg | type | standard | betydning |
|---|---|---|---|
| `--help` | boolean | — | vis denne teksten |

### `kvn/scripts/verify-mapping-coverage.ts`

Structural coverage check for a translation's mapping result files.

| flagg | type | standard | betydning |
|---|---|---|---|
| `--help` | boolean | — | vis denne teksten |

### `kvn/scripts/verify-osmain.ts`

Verify osmain coverage against all raw bibles.

| flagg | type | standard | betydning |
|---|---|---|---|
| `--verify` | boolean | — | kjør Ollama-verifiseringen; uten den bare skannes det |
| `--bible` | string | — | hvilken oversettelse, f.eks. osnb |
| `--chapter` | string | — | bare denne nøkkelen, på formen bok:kapittel, f.eks. 19:3 |
| `--help` | boolean | — | vis denne teksten |

### `kvn/scripts/verify-renumbering.ts`

Verify osmain renumbering using Ollama.

| flagg | type | standard | betydning |
|---|---|---|---|
| `--verify` | boolean | — | kjør Ollama-verifiseringen; uten den listes bare det som gjenstår |
| `--chapter` | string | — | bare denne nøkkelen, på formen bok:kapittel, f.eks. 19:3 |
| `--help` | boolean | — | vis denne teksten |

### `kvn/scripts/verify-text-report.ts`

Arbeidsliste fra tekstverifiseringen.

| flagg | type | standard | betydning |
|---|---|---|---|
| `--class` | string | — | bare én feilklasse: WRONG | MERGED | SHORT | UNRESOLVED |
| `--list` | boolean | — | skriv ut verstekstene, ikke bare sammendraget |
| `--limit` | number | `25` | hvor mange vers --list skriver ut |
| `--help` | boolean | — | vis denne teksten |

### `kvn/scripts/verify-text.ts`

Tekstverifisering av KVN-mappingene.

| flagg | type | standard | betydning |
|---|---|---|---|
| `--pass` | string | — | hvilket pass: prep | mech | judge1 | judge2 | verdict |
| `--priority` | string | — | prioritetsnivåer fra research/text-verification/priority.txt, f.eks. 1 eller 1,2 |
| `--concurrency` | number | — | parallelle kall (standard 4 for prep og mech, 1 for dommerne) |
| `--limit` | number | — | stopp etter N enheter |
| `--force` | boolean | — | kjør på nytt selv om resultatet finnes |
| `--help` | boolean | — | vis denne teksten |

## contrib/

Køen for eksterne bidrag.

### `contrib/check.ts`

| flagg | type | standard | betydning |
|---|---|---|---|
| `--id` | string | — | sjekk bare denne kø-id-en (contrib/queue/<id>.json) |
| `--target-lookup` | boolean | — | slå opp DOI mot Crossref og ISBN mot OpenLibrary |
| `--help` | boolean | — | vis denne teksten |

### `contrib/export.ts`

| flagg | type | standard | betydning |
|---|---|---|---|
| `--lookup` | boolean | — | hent tittel/forfattere/år fra Crossref (DOI) og OpenLibrary (ISBN) |
| `--help` | boolean | — | vis denne teksten |

### `contrib/review.ts`

| flagg | type | standard | betydning |
|---|---|---|---|
| `--list` | boolean | — | list køen: id, status, type, antall refs og target |
| `--llm` | boolean | — | la Claude skrive en anbefaling i review.note — setter aldri status |
| `--approve` | boolean | — | sett status approved (krever --id) |
| `--reject` | boolean | — | sett status rejected (krever --id) |
| `--needs-info` | boolean | — | sett status needs_info (krever --id og --note) |
| `--id` | string | — | kø-id å jobbe på (contrib/queue/<id>.json) |
| `--note` | string | — | notat som lagres i review.note |
| `--help` | boolean | — | vis denne teksten |

## articles/

Høsting av åpne forskningsartikler (#15).

### `articles/harvest.ts`

Open-access article harvester for the article→verse linking project (issue #15).

| flagg | type | standard | betydning |
|---|---|---|---|
| `--journal` | string | — | bare denne journalen (key i articles/journals.json) |
| `--limit` | number | — | stopp etter N enheter |
| `--full` | boolean | — | full sveip i stedet for inkrementell — ignorer lastMetaRun |
| `--help` | boolean | — | vis denne teksten |

## books/

Høsting av public-domain-bøker (#16).

### `books/harvest.ts`

Public-domain book harvester for the book→verse linking project (issue #16).

| flagg | type | standard | betydning |
|---|---|---|---|
| `--collection` | string | — | bare denne samlingen (key i books/collections.json) |
| `--limit` | number | — | stopp etter N enheter |
| `--help` | boolean | — | vis denne teksten |

## songs/

Høsting av salmer og sanger.

### `songs/harvest.ts`

PD song/hymn harvester for the song→verse linking project.

| flagg | type | standard | betydning |
|---|---|---|---|
| `--collection` | string | — | bare denne samlingen (key i songs/sources.json) |
| `--limit` | number | — | stopp etter N enheter |
| `--dry-run` | boolean | — | vis hva som ville skjedd, uten å skrive |
| `--help` | boolean | — | vis denne teksten |

## Biblioteker

Ikke kjørbare, og har derfor ingen flagg:

- `contrib/contrib-types.ts`
- `generate/cli.ts` — Felles flaggkontrakt for skriptene under generate/ (#51, #52, #53).
- `generate/constants.ts` — Oversettelseskode → språknavn.
- `generate/embeddings.ts`
- `generate/env.ts` — Laster `generate/.env`.
- `generate/lib.ts`
- `generate/llm.js`
- `generate/reading-plans-config.ts` — Configuration for all reading plans Plan types: - sequential: Read books in order, X chapters per day - distributed: Distribute all chapters evenly over X days - parallel: Read multiple book ranges in parallel (e.g., GT + NT) - custom: Manually defined daily readings bookRanges are defined in lib.js
- `generate/translations-schema.ts` — Schema and controlled vocabularies for translation metadata (meta.json).

---

68 av 68 skript bruker den felles flaggkontrakten.
