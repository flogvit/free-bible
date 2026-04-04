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

## Pågående

- [ ] number_symbolism.mjs — fullindeksering av osnb2 med Ollama 122b

## Ferdig

- [x] Felles LLM-modul (llm.js) med støtte for både Claude og Ollama
- [x] --local flag på alle genereringsskript (references, chapter_summary, book_summary, chapter_context, book_context, number_symbolism)
- [x] Tallekstraksjon med Ollama (number_symbolism --index)
- [x] Prompt-optimalisering for qwen3.5:122b (sammensatte tallord, mengdeangivelser)
