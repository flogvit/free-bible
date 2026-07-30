# Funn fra gjennomgangen av mappingene (juli 2026)

Dette er en oversikt over **problemene som ble funnet**, ikke en logg over arbeidet.
Formålet er at neste person skal kjenne igjen feilklassene og vite hvilke som
fortsatt står åpne.

Utgangspunktet var rundturskontrollen `scripts/check-osmain-roundtrip.py`:
oversettelse → osmain → tilbake. Den gikk fra 36 896 feilende vers og 329 rene
oversettelser til **1 feilende vers og 1157 av 1158 rene**.

## Det viktigste forbeholdet

**Rundturskontrollen måler tall, ikke tekst.** En mapping som er bijektiv består
den selv om den peker på feil vers. Flere av de groveste feilene som ble funnet
var usynlige for den:

- `norwegian1938` hadde `Apg 4:2 → 4,32` og `4:17 → 4,2` — ren forvirring, som
  besto kontrollen fint.
- `basque` sin Sal 110 pekte på osmain 110, men oversettelsens Sal 110 er osmain 111.
  Fire salmer i den oversettelsen var koblet til feil kapittel.
- `albanian` sin Åpenbaring 1–12 ligger ett vers ned hele veien. Ingenting av
  det synes i kontrollen.

Så «1157 av 1158 rene» betyr at *tallene* går opp, ikke at all tekst er
verifisert. Det som er lest, er lest; resten er ikke utelukket.

## 1. Feil i osmains egne data

osmain er norsk bokmål på **europeisk** versifisering. Den skal ligge så nær
flertallet av oversettelsene som mulig — det er hele grunnen til at den finnes,
siden hvert avvik koster poster i 1158 mappingfiler.

### 1a. Ombrutte kapitler (16 stykker)

Hebraisk innhold lå rotert inn på europeiske versnumre. `osmain 2 Mos 8,1` var
kjv 8,5; `Jes 9,1` var kjv 9,2; `Job 41,1` var kjv 41,9.

| Kapittel | Forskyvning | Kapittel | Forskyvning |
|---|---|---|---|
| 2 Mos 8 | 4 | Fork 5 | 1 |
| 2 Mos 22 | 1 | Jes 9 | 1 |
| 3 Mos 6 | 7 | Jer 9 | 1 |
| 5 Mos 29 | 1 | Esek 20,45–21,32 | 5 |
| 2 Krøn 2 | 1 | Dan 4 | 3 |
| 2 Krøn 14 | 1 | Mika 5 | 1 |
| Neh 4 | 6 | 1 Krøn 6 | 15 |
| Job 41 | 8 | | |

Alle er lest mot `kjv` vers for vers og satt i europeisk rekkefølge. Følgen var
at **190 300 mappingposter kunne fjernes** — de europeiske oversettelsene trenger
ingen poster i det hele tatt når osmain ligger riktig.

**Diagnosen som virker:** mappingen innenfor ett kapittel må bevare rekkefølgen.
En ekte versifiseringsforskjell er alltid ordensbevarende, så et ikke-monotont
kapittel betyr at osmain selv ligger rotert. Det pekte ut alle 13 gjenstående
tilfellene på én gang.

**Fallgruve:** en tidligere runde med slike rettelser ble rullet tilbake med
begrunnelsen at «mappingene koder osmains faktiske layout». Det er feil
slutning. At 600+ oversettelser har en ombrytningsblokk i samme kapittel er
*symptomet*, ikke fasiten.

### 1b. Duplisert tekst (fem vers)

Det sikreste tegnet på feil i osmain er at to vers har identisk tekst.

| Vers | Inneholdt | Skal være |
|---|---|---|
| 2 Kong 11,21 | 12,21 om igjen | «Joasj var sju år gammel da han ble konge» |
| 5 Mos 12,32 | 13,18 om igjen | «Alt det jeg befaler dere, skal dere holde og gjøre» |
| 1 Sam 23,29 | 24,22 om igjen | «David dro opp derfra … ved En-Gedi» |
| Høys 6,13 | 7,13 om igjen | «Vend tilbake, vend tilbake, Sjulammit!» |
| 4 Mos 25,18 | hadde «Etter plagen» hengende på; hører til 26,1 | |

### 1c. Manglende tekst

- `1 Sam 20,42` manglet andre halvdel («Så reiste han seg og gikk, og Jonatan
  dro tilbake til byen»), som osnb har som 21,1.
- `Sal 54,1` manglet første tittellinje.
- Tjue salmer manglet siste vers (Sal 5,13 / 9,21 / 18,51 / … / 140,14) og
  1 Krøn 12,41.

### 1d. Salmeoverskrifter (ti salmer)

Sal 13, 34, 40, 51, 54, 56, 58, 60, 61 og 63 hadde overskriften stående alene
som vers 1, og for å holde versantallet bar ett vers lenger ute to kjv-vers.
De 144 andre salmene hadde overskriften flettet inn i v1 slik europeisk
nummerering krever.

Rettingen gjorde at **4160 oversettelses-salmer ikke trenger poster i det hele tatt**
og 1008 får den vanlige hebraiske forskyvningen.

## 2. Feil i oversettelsenes kildedata

Disse kan **ikke** fikses med mappingposter. De har `derived.dataWarning` i sin
egen mappingfil og står i `data/data-quality-findings.json`.

| Oversettelse | Problem |
|---|---|
| `ukrainian2004` | Sal 73 mangler i høstingen; fra kapittel 72 ligger alt to forskjøvet i stedet for ett. Bekreftet på salmetitler: kap 72 = Sal 74, kap 75 = Sal 77, kap 76 = Sal 78 (72 vers). Salmemappingen er fjernet. |
| `lithuanian_kj` | Salmene er feilmontert i kildedataene (kap 22 = Sal 16, kap 23 = Sal 17, kap 51 = Sal 50). Fra før. |
| `albanian` | 3 Joh, Judas og Åp 1–12 er forskjøvet over bokgrensene. Oversettelsens 3 Joh 1,14 **er** Judas 1,1, og dens Judas 1,25 er Åp 1,1. Åp 13–22 er riktige — forskyvningen løser seg opp fordi albansk Åp 12 har 17 vers mot osmains 18. |

`albanian 3 Joh 1,14` er det ene verset som fortsatt feiler rundturen, og det
kan ikke løses i mappingen: verset tilhører en annen bok, og kvn har ingen
kryssbok-poster.

### Andre datafenomener som ikke er feil i mappingen

- **`***` som plassholder** for vers høstingen ikke fikk. 65 forekomster i
  `english_darby` alene, og i mange andre oversettelser. De har ingen motpart i osmain.
- **Oversettelser som bærer begge nummereringene.** `kvn`-referanseteksten,
  `armenian_nea`, `italian` og fire litauiske har grenseverset stående både som
  siste vers i det ene kapitlet og første i det neste. For referanseteksten er
  det med vilje. Løst med delvers `a`/`b` slik at begge adressene svarer til
  samme osmain-vers.
- **Forkortede utgaver.** `arabic2023` sin Esra 2 har 16 vers mot osmains 70 —
  dens 2,3 rommer osmain 2,3–5 i ett vers.

## 3. Feilklasser i mappingene

| Klasse | Kjennetegn | Eksempel |
|---|---|---|
| Vrakposter | Peker på et vers uten sammenheng | `latvian2012`: `4 Mos 16:23 → 15,1` |
| Ikke-monoton mapping | Bryter rekkefølgen i kapitlet | `norwegian1938`: `Apg 4:17 → 4,2` |
| Duplisert `kvnFrom` | Ett osmain-vers med to mål — gir ingen vei tilbake | `burmese2021`: `1 Krøn 5:3` tre ganger |
| Manglende grensepost | Oversettelsens første vers hører til forrige kapittel | `kvn`: 14 hebraiske kapittelgrenser |
| Manglende delvers | Oversettelsen deler eller fletter et osmain-vers | `spanish`: Dom 14,18 delt i to |
| Feil kapittelkobling | LXX-oversettelse koblet mot sitt eget nummer | `basque`: Sal 110 mot osmain 110 |
| Utdatert etter osmain-retting | Postene kodet den gamle layouten | `vietnamese_vie`: hele Job 41 åtte vers feil |

## 4. Diagnostikk som virker — og som ikke gjør det

**Virker:**

- **Duplisert tekst i osmain** — sikreste tegn på feil vers.
- **Ordensbrudd innenfor et kapittel** — sikreste tegn på ombrytning.
- **Siste versnummer, ikke antallet**, skiller hull i høstingen fra hebraisk
  forskyvning. En oversettelse med 28 vers i 5 Mos 29 kan være begge deler; `max(verseId)`
  avgjør. 115 oversettelses-kapitler hadde fått forskyvning de ikke skulle ha før dette
  ble skilt.
- **Identisk versstruktur som osmain ⇒ identitet.** 942 oversettelses-kapitler hadde
  poster som forskjøv et kapittel som var identisk med osmain.
- **Salmetitler og egennavn** til å avgjøre kapittelkobling i språk man ikke
  leser. «Om Salomo», «Jedutun/Asaf», «Betlehem Efrata» er entydige.

**Virker ikke:**

- **Automatisk kapitteljustering på versantall.** En DP-justering av hele
  salteret mot osmain ble prøvd på de 34 oversettelsene som feilet der; kostnaden lå
  mellom 25 og 142 for samtlige, og den ble avvist for alle. Oversettelser med hull i
  høstingen har ikke en versantallsprofil som lar seg matche.
- **Å velge kapittelkobling etter hva som får rundturen til å gå opp.** Prøvd og
  rullet tilbake. Kontrollen ser bare tall, så den godtar et vilkårlig valg som
  er bijektivt. Kapittelkoblingen må avgjøres på tekst.
- **`scripts/align-chapters.py` og `map-linear-books.py`** — begge merket
  `IKKE TATT I BRUK` med begrunnelse i sine egne docstrings. `map-linear-books.py`
  produserte «4 Mos 16:23 → 15,1» i 70 343 poster.

## 5. Fortsatt åpent

- **`albanian` bok 64–66 må rehøstes.** Ett vers feiler rundturen; hele Åp 1–12
  er forskjøvet uten at kontrollen ser det.
- **`ukrainian2004` og `lithuanian_kj` må rehøstes** før salmene kan mappes.
- **3 Joh 1,1–2 mangler helt** i `albanian` — de er ikke i korpuset.
- **Semantisk verifisering er ikke uttømmende.** Feilklassen «bijektiv, men peker
  på feil vers» ble funnet ved lesing i de oversettelsene som feilet på tall. De 1157
  rene oversettelsene er ikke gjennomlest. Ordensbrudd-sjekken (punkt 4) er den
  billigste måten å lete videre på.

## Se også

- `README.md` — hvordan kvn virker, Type A/B/C-avvikene i salmene, `part`- og
  `order`-feltene.
- `BOUNDARY-VERSE-ISSUES.md` — den opprinnelige beskrivelsen av grenseversene.
  De 16 ombrutte kapitlene i punkt 1a er nå rettet.
- `data/data-quality-findings.json` — maskinlesbar liste over funn i kildedata.
- `data/alignment-verdicts.json` — tekstverifiserte dommer, med regresjonstest.
