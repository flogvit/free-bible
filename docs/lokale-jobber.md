# Lokale LLM-jobber — hva finnes, hva gjenstår, hvor det kan kjøre

Målt 2026-07-30. Alle tall i dette dokumentet er talt opp fra data på disk, ikke
anslått. Kommandoene som gir dem står under [Måle på nytt](#måle-på-nytt) — kjør
dem heller enn å stole på tallene når det har gått noen uker.

Dokumentet dekker **bare arbeid som kan gjøres av lokale modeller.** Oversettelse
og korrektur av selve bibeltekstene går på Claude API og står bare i
[Går ikke lokalt](#går-ikke-lokalt), som avgrensning.

---

## Maskinene

| maskin | minne | kan kjøre | når |
|---|---|---|---|
| hovedmaskin | 128 GB | ≤31b-klassen | på dagen, ved siden av eget arbeid |
| hovedmaskin | 128 GB | qwen3.5:122b (81 GB) | om natta |
| MacBook Pro M1 Max | 64 GB | ≤31b-klassen (≤23 GB) | døgnet rundt |

Modellene som er lastet ned, med faktisk størrelse:

| modell | størrelse | 64 GB-maskin | brukes til |
|---|---|---|---|
| `bge-m3` | 1,2 GB | ja | embeddings (semantiske referanser, tekstverifisering) |
| `qwen3.5:9b` | 6,6 GB | ja | — (rangert, ikke i bruk) |
| `qwen3.5:27b` | 17 GB | ja | triage, nøkkelord, osmain-verifisering |
| `granite4.1:30b` | 17 GB | ja | dommer 2 i tekstverifiseringen |
| `gemma4:31b` | 19 GB | ja | dommer 1, mappinggenerering, sangreferanser |
| `qwen3.6:35b` | 23 GB | ja | — (målt til 8 % gjenkall på triage, ikke i bruk) |
| `gpt-oss:120b` | 65 GB | nei | — (rangert, ikke i bruk) |
| `qwen3.5:122b` | 81 GB | nei | oversettelse, referanser, tagging |

---

## Tre ting som avgjør om du treffer riktig modell

**1. De fleste skriptene går til Claude API hvis du glemmer `--local`.** Det er
standarden, ikke unntaket. `bun important-words-chapter.ts` bruker Claude og
koster penger; `bun important-words-chapter.ts --local` bruker Ollama. Skriptet
sier hvilken modell det valgte i første linje — les den før du lar en jobb stå
over natta.

To skript er motsatt og har `--remote` i stedet, fordi lokalt er standarden der:
`translate.ts` og `headings.mjs`. Tre skript har ingen bryter i det hele tatt og
er alltid lokale: `song-references.mjs`, `days-mentions.mjs` og
`persons-reconcile*.ts`.

**2. `triage.mjs` må kjøres med `bun`, ikke `node`.** Den importerer
KVN-laget, som er TypeScript. Med `node` får du
`ERR_MODULE_NOT_FOUND: kvn/src/ukvn-types.js` — som ser ut som en manglende fil,
men er feil kjøremåte. Samme gjelder alt under `kvn/scripts/*.ts`.

**3. `OLLAMA_MODEL` pinner modellen for alt** og slår av adopsjonen. Nyttig når
maskinen er opptatt og du vil tvinge en jobb ned på 27b:
`OLLAMA_MODEL=qwen3.5:27b bun important-words-chapter.ts --local`.

---

## Jobblisten

Sortert etter hvor den kan kjøre. «Gjenstår» er målte tall per 2026-07-30.

### Kan kjøre på 64 GB-maskinen døgnet rundt (≤31b)

| jobb | kommando (fra `generate/`, der ikke annet står) | modell | gjenstår | issue |
|---|---|---|---|---|
| Sangreferanser | `bun song-references.ts` | gemma4:31b | **5 622 av 6 076 sanger** | #8 |
| KVN-tekstverifisering | `kvn/scripts/run-verification.sh pri1` | bge-m3 + gemma4:31b + granite4.1:30b | **så godt som alt** — 138 oversettelser i prioritetslista, 5 filer produsert | #35 |
| Nøkkelord per kapittel | `bun important-words-chapter.ts --local` | qwen3.5:27b | **278 av 1 189 kapitler** | #34 |
| Triage av korrektur | `bun triage.mjs osnb` | qwen3.5:27b | etter behov (mekanisk lag, ikke en køjobb) | — |
| osmain-verifisering | `bun kvn/scripts/verify-osmain.ts` | qwen3.5:27b | etter behov | — |
| Mappinggenerering | `bun kvn/scripts/build-mapping.ts --source <navn>` | gemma4:31b | etter behov for nye oversettelser | — |

### Krever hovedmaskinen om natta (qwen3.5:122b)

| jobb | kommando (fra `generate/`) | gjenstår | issue |
|---|---|---|---|
| Tilleggsmateriale nb→es | `bun translate.ts --language es` | **18 247 filer** — alt | #29 |
| Tilleggsmateriale nb→en | `bun translate.ts --language en --dirs references` | **591 referansefiler**, resten er ferdig | #30 |
| Kryssreferanser | `bun references.ts --local --book 10-39` | **20 349 vers** — 13 av 66 bøker er gjort | #31, #26 |
| Semantiske referanser | `bun references-semantic.ts --verify-only --resume` | osnb-vektorene finnes; kandidatverifisering gjenstår | — |
| Kapitteltagging | `bun chapter-tags.ts --local --bible osnb` | ferdig for nb/en (16 tagsett) | #2, #3 |

`translate.ts` er lokal som standard — `--remote` er bryteren dit, ikke hit.
`references.mjs` godtar `--local`, men **nevner det ikke i `--help`**; uten flagget
går den til Claude API.

### Faller til 122b uten at noen har bestemt det

Disse skriptene sender verken `task:` eller `model:`, og treffer derfor
`ollamaModel` (= qwen3.5:122b) i `generate/constants.js:34`. **Det er ikke en
vurdering av at de trenger den store modellen** — det er samme dødkonfigurasjon
som `chapter-tags.mjs` hadde til tabellen ble rettet (se kommentaren
`constants.js:49-52`). Hvor mye de faktisk trenger er **ikke målt**.

| jobb | kommando (fra `generate/`) | gjenstår | trolig klasse | issue |
|---|---|---|---|---|
| Kirkeårstagging | `bun day-tags.ts --local --bible osnb --book 41-66` | **1 163 av 1 189 kapitler** (bare Matteus gjort) | ja/nei per kapittel → 27b-kandidat | #32 |
| Dagsomtaler pass 1 | `bun days-mentions.ts --bible osnb --nt` *(alltid lokal)* | **648 av 1 189 kapitler** (1. Mos–Salmene gjort) | ja/nei per vers → 27b-kandidat | #33 |
| Personavstemming | `bun persons-reconcile.ts` / `persons-reconcile-context.ts` *(alltid lokal)* | etter behov | klassifisering → 27b-kandidat | #37 |
| Personprofiler som mangler | `bun generate/build-missing-persons.ts` *(Claude — qwen duger ikke, se #12)* | etter behov | prosa | #12 |
| Personavstemming: gjennomgang | `bun generate/persons-audit.ts` (read-only) → `persons-apply-reconcile.ts` / `persons-apply-context.ts` | etter avstemmingen | — | #12 |
| Dagsdefinisjoner | `bun generate/days.ts` — **skriver over `generate/days/`** | når dagsdefinisjonene endres | — | — |
| Lesetekster (DNK) | `bun generate/parse-lesetekster.ts` | ny årgang | — | — |
| Evaluering av semantiske referanser | `bun generate/eval-references.ts` *(Claude som dommer)* | når innstillingen endres | prosa | #31 |
| Historieskanning | `bun scan-stories.ts --local` | 1 forslag, 1 avvist i kø | klassifisering → 27b-kandidat | #37 |
| Tallsymbolikk | `bun number-symbolism.ts --local` | 326 tall dekket | blandet — ja/nei-kall + prosa | #37 |
| Kapittel-/bokresymé | `bun chapter-summary.ts --local`, `bun book-summary.ts --local` | ferdig (1 189 / 66) | prosa → behold 122b | — |
| Kapittel-/bokkontekst | `bun chapter-context.ts --local`, `bun book-context.ts --local` | ferdig (1 188 / 66) | prosa → behold 122b | — |
| Overskrifter | `bun headings.ts` *(lokal som standard; `--remote` gir Claude)* | **alt** — `generate/headings/` finnes ikke, ingenting er kjørt | prosa → behold 122b | #36 |
| Personprofiler | `bun bible-persons.ts --local` | 2 029 personer | profilene skrives av Claude, ikke lokalt | — |

Å flytte en av disse ned er én linje i `taskModels` — men gjør det etter en
måling, ikke på antakelse. `triage.mjs`-erfaringen (31 % gjenkall på 27b mot
Claude) viser at nedflytting kan koste stille. Samlet i **#37**.

### Jobber uten skript

Disse er bestilt, men det finnes ingen kode som gjør dem. Bare høsting er bygget.

| jobb | datagrunnlag | status | issue |
|---|---|---|---|
| Finne versreferanser i artikler | 13 226 hentede artikkeltekster i `external/articles/text/` | **skript mangler** — `articles/harvest.mjs` henter bare | #15 |
| Finne versreferanser i bøker | 2 357 boktekster i `external/books/text/` | **skript mangler** — `books/harvest.mjs` henter bare | #16 |
| Dagsomtaler pass 2 (dedupe) | 541 kapittelfiler i `generate/days_mentions/osnb/` | **skript mangler** | #33 |
| Kapittelinnsikter | 96 av 1 189 filer finnes | **generatorskript finnes ikke i repoet** — bare `translate.ts` kjenner katalogen | #39 |
| Versbønn / verspreken | 4 og 5 filer | **generatorskript finnes ikke i repoet** | #39 |

---

## Detaljer per jobb

### Sangreferanser — 454 av 6 076

```
bun generate/song-references.ts
```

Korpuset er `external/songs/master/` (6 076 sanger). Utdata `generate/songs/<id>.json`,
uten tekst. Skriptet resolver modellen selv og lagrer navnet i resultatet, så
kjøringer med ulik modell kan skilles fra hverandre.

Dette er den største rene 31b-jobben som ligger klar. 5 622 sanger igjen.

### KVN-tekstverifisering — så godt som ikke startet

```
kvn/scripts/run-verification.sh maal        # mål farten på DENNE maskinen først
kvn/scripts/run-verification.sh struktur    # gratis, ingen GPU — kjør før noe annet
kvn/scripts/run-verification.sh pri1        # de 81 åpne oversettelsene
```

`kvn/data/text-verification/` inneholder 5 filer, altså bare målekjøringen på kjv.
Prioritetslista har 138 oversettelser.

To ting som er lette å gjøre feil, begge dokumentert i `kvn/README.md`:

- **`struktur` må kjøres først.** Den finner gratis de 168 774 oppslagene som ikke
  kan lykkes uansett hva teksten sier. Hopper man over den, brukes måneder med
  GPU-tid på vers som ikke finnes.
- **Ett pass om gangen.** To modeller i minnet samtidig tar farten fra 3,5 s/vers
  til 11.

Dette er jobben som passer best på 64 GB-maskinen: den er lang, gjenopptakbar per
kapittel, og alle tre modellene får plass.

### Tilleggsmateriale nb→es — alt gjenstår

```
bun generate/translate.ts --language es --status     # gjeldende tall
bun generate/translate.ts --language es
```

18 247 filer. De største postene: referanser 10 818, personer 2 029, historier
1 357, kapittelresymé 1 189, kapittelkontekst 1 188, nøkkelord 888.

Merk at dette er *tilleggsmaterialet*. Selve `oses`-bibelteksten er oversatt og
ligger i `generate/bibles_raw/oses/` (1 189 kapitler).

### Tilleggsmateriale nb→en — 591 filer igjen

```
bun generate/translate.ts --language en --status
```

Alt annet enn referanser er `current`. De 591 manglende referansefilene er
merket `missing`, ikke `stale` — de er aldri oversatt, ikke utdaterte.

### Kryssreferanser — 13 av 66 bøker

```
bun generate/references.ts --local --book 10-39
```

10 818 versfiler under `generate/references/nb/`, i bøkene 1–9 (1. Mos–1. Sam) og
40–43 (evangeliene). Det er 92 % av versene i nettopp de bøkene, og 35 % av bibelen.
20 349 vers gjenstår.

`--local` står ikke i `--help` for dette skriptet, men parseren tar imot det
(`references.mjs:588`). Uten flagget går hele jobben på Claude API.

### Nøkkelord per kapittel — 911 av 1 189

```
bun generate/important-words-chapter.ts --local
```

278 kapitler igjen. Går på qwen3.5:27b med vilje (`constants.js:53-56`), så den
kan stå på 64 GB-maskinen.

`--book`/`--chapter` er INTERVALLER, som i alle andre skript (#51): `--book 66
--chapter 3` er Åp 3 og ingenting annet. Fram til flaggkontrakten var de
startpunkter — samme kommando gikk da fra Åp 3 og ut bibelen. «Fra Matteus og
ut» skrives nå `--book 40-66`. Posisjonsformen `<språk> <bok> <kapittel>` er
borte; bruk `--language`/`--book`/`--chapter`.

Utdata er `important_words/<språk>/<bok>-<kapittel>.json`, en array:

```json
[
  { "word": "Gud", "explanation": "Den allmektige skaperen som ..." }
]
```

Array og ikke et objekt nøklet på ord: fem engelske filer har samme ord to
ganger, og en nøkkel ville stille kastet den ene. Formatet var `.txt` med
`ord: forklaring` per linje fram til 2026-07-31 — og skrev vekselvis `Gud:` og
`Himmel: `, uten kontrakt for hva som var ord og hva som var mellomrom.

---

## Går ikke lokalt

`generate/bible.mjs` — oversettelse og korrektur av bibeltekstene — har ingen
`--local`. Den går på Claude API, og hører derfor ikke hjemme i planlegginga over.
Tatt med her fordi det er lett å tro noe annet.

Status per 2026-07-30, målt på markørene i verstekstene:

| oversettelse | kapitler | vers m/`versions[]` | fotnoter | korrektur |
|---|---|---|---|---|
| `osnb` | 1 189 | 8 732 | 858 | ferdig (batch, før markørene fantes) |
| `osnn` | 1 189 | 8 444 | 21 | ferdig — men **fotnotene mangler nesten helt** |
| `osen` | 1 189 | 4 287 | 195 | ferdig |
| `oses` | 1 189 | 4 097 | 0 | **831 av 1 189 kapitler** i `proofread/oses/state.json`, snittscore 8,86 |

`oses` har altså 358 kapitler igjen på korrektur (**#27**), og ingen fotnoter i det
hele tatt. `osnn`s 21 fotnoter mot `osnb`s 858 er trolig også en jobb, ikke et
valg (**#28**).

---

## Planleggingsregler

**Modelladopsjon flytter jobber oppover, aldri nedover.** `resolveLocalModel`
(`generate/llm.js:60`) bruker en større modell som allerede ligger i minnet
framfor å kaste den ut. Kjører du nøkkelordjobben ved siden av en
122b-oversettelse, får nøkkelordjobben 122b. Det er meningen — én runner er
raskere enn to som kaster hverandre ut. Men det betyr at «denne kan kjøre på 27b»
betyr «på 27b **alene**».

`OLLAMA_NO_ADOPT=1` slår av adopsjonen. `OLLAMA_MODEL=<navn>` pinner alt.

**To jobber med ulik modell er verre enn å kjøre dem etter hverandre.** Ollama
holder én runner. qwen3.5:122b (81 GB) og qwen3.5:27b (17 GB) får ikke plass ved
siden av hverandre på 128 GB, så den laster om for hvert kall: 17–19 s for
122b-runneren, ~6 s for 27b, med kald promptcache hver gang.

**gemma4:31b deler runner med lukkede skjemajobber, men ikke med åpne.** Skillet
går på skjemaets form, ikke på modellen (**#38**, rettet 2026-07-30). `openSchema:
false` i `ollamaModelConfig` stenger gemma4 ute bare når kallet dekoder mot et
*åpent* skjema — ubegrensede arrays eller fritekstfelter. `isClosedSchema` i
`llm.js` avgjør, og `bun test` dekker grensen.

I praksis, mens sangreferansene (gemma4) kjører:

| jobb | skjema | deler runner |
|---|---|---|
| KVN-tekstverifisering (`verify-text.ts`) | `verdict`: enum × 4 → lukket | ja |
| Triage (`triage.mjs`) | array med fritekst `detail` → åpent | nei |
| Kryssreferanser (`references.mjs`) | array med `explanation` → åpent | nei |

Det gamle flagget het `jsonFormat` og kom inn 2026-04-14 fra én observasjon på
`REFERENCE_PROOFREAD_SCHEMA`. Generaliseringen holdt ikke: gemma4 leverte 64/64
gyldige svar på enum-skjemaet i `verify-text.ts`, med *bedre* treff med skjema
enn uten (37/39 mot 33/39, 3/25 falsk alarm).

---

## Måle på nytt

```sh
cd generate

# oversettelsesstatus for tilleggsmateriale
bun translate.ts --language en --status
bun translate.ts --language es --status

# dekning per datatype
find references/nb -type f | wc -l          # kryssreferanser, per vers
ls important_words/nb | wc -l               # nøkkelord, per kapittel
find days_mentions/osnb -type f | wc -l     # dagsomtaler, per kapittel
find day_tags/nb -type f | wc -l            # kirkeår, per kapittel
ls songs | wc -l                            # sangreferanser (av 6076)

# korrekturstatus for oses
bun -e 'console.log(Object.keys(await Bun.file("./proofread/oses/state.json").json()).length)'

# KVN-tekstverifisering
find ../kvn/data/text-verification -name '*.json' | wc -l
```
