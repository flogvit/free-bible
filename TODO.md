# TODO - Generering

## Lokal modell (Ollama) — nye oppgaver

- [ ] Sjanger-klassifisering per kapittel (lov, profeti, poesi, narrativ, brev, apokalyptisk)
- [ ] Sentiment/tone per kapittel (trøst, advarsel, lovprisning, klage, undervisning)
- [ ] Stedsnavnekstraksjon — finn alle geografiske steder per kapittel, bygg indeks

## Lokal modell — flytte fra Claude

- [ ] important_words_chapter.mjs — nøkkelordekstraksjon kan gjøres lokalt
- [ ] generate-verse-mapping.mjs — versemapping er mekanisk sammenligning

## Lokal modell — mulig med Claude proofread

- [ ] bible_persons.mjs — strukturert faktaekstraksjon, men trenger verifisering

## Ideer

- [ ] Sangreferanser per vers — koble bibelvers til sanger (salmer, lovsanger, klassisk kirkemusikk) som er basert på eller inspirert av verset. Norsk Salmebok-numre, internasjonale hymner, eventuelt Spotify-lenker. Eksempel: Salme 23 → "Herren er min hyrde" (NoS 480).
- [ ] Quiz per kapittel — generer flervalgsquiz (1 riktig + 3 gale svar) basert direkte på kapittelteksten. Spørsmålene må være fakta fra teksten (hvem sa/gjorde hva, hva skjedde, hvilke steder/tall nevnes), ikke teologisk tolkning eller synsing. Eksempel: "Hvem møtte Jesus ved brønnen i Sykar?" a) Maria Magdalena b) En samaritansk kvinne c) Marta d) Lydia. Lagres som `quiz/<lang>/<bookId>/<chapterId>.json`.

## Pågående

- [ ] number_symbolism.mjs — fullindeksering av osnb2 med Ollama 122b

## Ferdig

- [x] Felles LLM-modul (llm.js) med støtte for både Claude og Ollama
- [x] --local flag på alle genereringsskript (references, chapter_summary, book_summary, chapter_context, book_context, number_symbolism)
- [x] Tallekstraksjon med Ollama (number_symbolism --index)
- [x] Prompt-optimalisering for qwen3.5:122b (sammensatte tallord, mengdeangivelser)
