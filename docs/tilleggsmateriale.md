# Tilleggsmateriale for en ny oversettelse

Når bibelteksten er på plass ([ny-oversettelse.md](ny-oversettelse.md)),
gjenstår alt som gjør den brukbar i UI-et. Det er **36 utdatakataloger** under
`generate/`.

Flaggene står i [skript.md](skript.md). Hva som kjøres lokalt mot Ollama og hvor
mye som gjenstår, står i [lokale-jobber.md](lokale-jobber.md) — den er fasiten
for det, og skal leses før du planlegger en kjøring.

---

## To veier inn, og de forveksles lett

**Generering** lager innholdet på nytt, på oversettelsens eget språk, fra
bibelteksten. **Oversettelse** tar eksisterende norsk innhold og oversetter det
med `translate.ts`.

Hvilken vei du velger er ikke et fritt valg per katalog — det avhenger av om
innholdet er *utledet av teksten* (genereres) eller *skrevet om teksten*
(oversettes). Kryssreferanser genereres, fordi hvilke vers som henger sammen er
en egenskap ved teksten. Sammendrag oversettes, fordi de er prosa om innholdet.

### Oversettelsesveien

```bash
bun generate/translate.ts --language en --status      # hva som gjenstår
bun generate/translate.ts --language en --dry-run     # uten å skrive
bun generate/translate.ts --language en
```

Rekkefølgen er `CONTENT_DIRS` i `translate.ts`, og **`references` står sist med
vilje**: 10 000+ filer og flerdøgns kjøretid.

> ### Fella som brakk 1 869 personfiler
>
> `keepKeys` i `CONTENT_DIRS` lister felter som er **maskinverdier og ikke skal
> oversettes**. `relatedPersons`, `siblings` og `children` er ID-referanser, ikke
> navn — men de sto utenfor lista. Modellen oversatte dem til visningsnavn:
> `paulus` ble `Paul`, `johannes-apostel` ble `John the Apostle`.
>
> **1 869 av 2 029 engelske personfiler fikk referansefelt som ikke kunne slås
> opp.** `father`, `mother` og `spouse` sto i lista og var uskadd — det er
> forskjellen som avslørte det.
>
> Legger du til en katalog i `CONTENT_DIRS`: gå gjennom hvert felt og spør om
> det er noe et *menneske* leser, eller noe *kode* slår opp.

---

## Avhengigheter

Rekkefølgen er ikke fri. Det som må komme først:

| dette | før dette | fordi |
|---|---|---|
| `generate/days/` (`days.ts`) | `day_tags`, `days_mentions` | begge leser dagsdefinisjonene |
| embeddings (`embeddings.ts`) | `references_semantic` | semantisk søk trenger vektorene |
| bibeltekst ferdig | alt annet | alle leser `bibles_raw/<navn>/` |
| `persons` generert | `persons_reconcile*` | avstemming trenger noe å stemme av |
| KVN-mapping | `references` | referanseadresser valideres mot nummereringen |

> **Ikke kjør `bun generate/days.ts`** før #108 er løst: den sletter
> `references[]` fra `generate/days/` ved import, uten feilmelding.

---

## Katalogene

### Genereres fra bibelteksten

| katalog | skript | merknad |
|---|---|---|
| `references` | `references.ts` | kryssreferanser. #31: 20 349 vers igjen, 53 av 66 bøker urørt |
| `references` | `references_semantic.ts` | semantiske funn — bge-m3 + LLM-verifisering, finner paralleller som ikke står i standardverk |
| `tags` | `chapter_tags.ts` | kirkeårstagging. #32: 1 163 av 1 189 kapitler igjen |
| `day_tags` | `day_tags.ts` | dagstagging |
| `days_mentions` | `days_mentions.ts` | omtaler av dager/høytider per vers. #33: 648 kapitler igjen |
| `days` | `days.ts` | dagsdefinisjonene selv — **se advarselen over** |
| `persons` | `bible_persons.ts` | personprofiler |
| `persons` | `persons_reconcile*.ts` → `persons_audit.ts` → `persons_apply_*.ts` | avstemming: foreslå → menneske ser på → skriv |
| `stories` | `scan_stories.ts`, `stories.ts` | systematisk skanning, så generering |
| `number_symbolism` | `number_symbolism.ts` | tallsymbolikk |
| `important_words` | `important_words_chapter.ts` | nøkkelord. #34: 301 av 1 189 igjen |
| `word4word` | `word4word.ts` | ord-for-ord. **Kun korrekt for `tanach` og `sblgnt`** |
| `verse_translation` | `verse_translation.ts` | forklaringer per vers |
| `chapter_summaries`, `book_summaries` | `chapter_summary.ts`, `book_summary.ts` | ferdig for nb (1 189 / 66) |
| `chapter_context`, `book_context` | `chapter_context.ts`, `book_context.ts` | |
| `reading_plans` | `generate_reading_plans.ts` | konfigurasjon i `reading_plans_config.ts` |
| `songs` | `song_references.ts` | sang → vers. 383 av 5 910 gjort |

### Oversettes fra norsk

Alle katalogene i `CONTENT_DIRS`, i den rekkefølgen — se `translate.ts`.

### Har innhold, men ingen generator

Fem kataloger har filer på disk uten at jeg finner et skript som lager dem:

| katalog | filer | |
|---|---|---|
| `chapter_insights` | 193 | #39 |
| `timeline` | 112 | ikke i #39 |
| `verse_sermon` | 10 | #39 |
| `verse_prayer` | 8 | #39 |
| `daily_verse` | 4 | ikke i #39 |

**Alle fem står i `CONTENT_DIRS`** og blir altså oversatt, men kan ikke fylles
for et nytt språk uten at innholdet finnes på norsk først. `timeline` og
`daily_verse` er ikke nevnt i #39 — de bør legges til der.

### Ikke oversatt med vilje

`proofread_*`, `stories_proposed`, `stories_rejected` — interne
rørledningsartefakter.

---

## Hva som kan kjøres lokalt

`docs/lokale-jobber.md` er fasiten. To ting derfra som er lette å gå glipp av:

**De fleste skriptene går til Claude API hvis du glemmer `--local`.** Tre er
alltid lokale uansett: `song_references`, `days_mentions` og
`persons_reconcile*`.

**Lokal triage duger ikke til å bedømme oversettelseskvalitet.** Målt gjenkalling
mot Claudes faktiske rettelser var 31 % (qwen3.5:27b) og 8 % (qwen3.6:35b), og
begge bommer på nettopp den verdifulle klassen: hebraisk morfologi og
termkonsistens på tvers av vers. De **deterministiske** sjekkene — regex, lengde,
versantall — er der det lokale laget betaler seg.

**To jobber må aldri ville ha hver sin modell samtidig.** Ollama holder én
runner, og qwen3.5:122b (81 GB) og qwen3.5:27b (17 GB) får ikke plass side om
side på 128 GB — så den laster om ved *hvert kall*: målt 17–19 s for 122b-runneren.
`resolveLocalModel` i `llm.ts` løser det ved å adoptere modellen som allerede er
lastet, når den rangerer likt eller høyere enn oppgavens preferanse.

---

## Sjekkliste for et nytt språk

- [ ] bibelteksten ferdig og indeksert
- [ ] `days.ts` kjørt (eller bekreftet at dagsdefinisjonene finnes)
- [ ] embeddings bygget, hvis semantiske referanser skal med
- [ ] genererte kataloger fylt, i avhengighetsrekkefølge
- [ ] `translate.ts --status` viser null gjenstående
- [ ] `keepKeys` sjekket for hver nye katalog i `CONTENT_DIRS`
- [ ] `translations_index.ts` kjørt til slutt
