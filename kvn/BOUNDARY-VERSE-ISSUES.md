# Osmain Boundary Verse Issues

## Problem

osmain har flere vers enn osnb2 i ~60 kapitler. De ekstra versene er ved
kapittelgrensene — der flertallet av oversettelser plasserer et vers i et
annet kapittel enn hebraisk/gresk nummerering.

**Mange av disse ekstra versene har FEIL tekst.** Da osmain ble bygget,
ble teksten for grenseversene ofte hentet fra feil sted. Resultatet er at
osmain f.eks. har tekst fra 2 Mos 9:3 der det burde stått det som KJV har
som Exodus 8:30.

## Hva som gikk galt

Osmain ble bygget fra osnb2 med renummerering. For versene som skifter
kapittel mellom hebraisk og europeisk nummerering, trengs teksten fra osnb2
nabokappittel. Men byggescriptet kopierte feil vers i mange tilfeller.

## Hva som IKKE er feil

- Selve **versantallene** i osmain er korrekte (verifisert mot 1148 oversettelser)
- **osnb2** og **osnn1** er korrekte (1:1 med tanach/sblgnt)
- **Mapping-filene** (.ukvn.json) er korrekte for versifikasjonsforskjellene

## Typer grensevers

Det er to forskjellige mønstre for hvordan grenseversene fungerer:

### Type 1: Sekvensiell shift
osnb2 ch N+1 v1 → osmain ch N siste vers.
Eksempel: Jona 1:17 i osmain = osnb2 Jona 2:1 ("Herren lot en stor fisk sluke Jona")

### Type 2: Wrap-around
Versene i osmain kapittelet er omorganisert vs osnb2.
Eksempel: 2 Mos 8:29-32 i osmain. Her følger osmain en nummerering der hebraisk
7:26-29 (= "la mitt folk dra" osv.) legges på slutten av kapittel 8,
mens osnb2 har dem som 8:1-4. Riktig tekst for osmain 8:29-32 er
IKKE osnb2 9:1-4, men osnb2 8:1-4 (wrap-around innenfor kapittelet).

## Slik fikses det

Hvert vers må sjekkes manuelt mot:
1. **KJV** (som følger samme nummerering som osmain i de fleste tilfeller)
2. **tanach/sblgnt** (grunnteksten, som definerer hva innholdet faktisk er)
3. **osnb2** (for å finne riktig norsk oversettelse av det korrekte verset)

**IKKE bruk et script.** Scriptet vi prøvde antok alle var Type 1, men mange er Type 2.

## Fullstendig liste over vers med feil tekst

133 grensevers totalt, 131 med tekst som ikke matcher osnb2 neste-kapittelet.
Noen av disse 131 kan ha riktig tekst allerede (Type 2 der teksten riktig
hentes fra et annet sted), men alle bør verifiseres.

### 1 Mos
- 31:55 — har hoftesene-tekst (= 32:32 duplikat), burde være Labans avreise

### 2 Mos
- 8:30-32 — har frosker-tekst fra kap 8, burde ha innholdet KJV har for 8:30-32
- 22:31 — har "stjeler en okse" (= 22:1 i annen numm.), burde ha "hellige menn"

### 3 Mos
- 6:24-30 — har skyldoffer-tekst fra annet sted, burde ha lov om skyldofferet (KJV 7:1-7)

### 4 Mos
- 16:36-50 — har Aarons stav-tekst (kap 17), burde ha pest/soning-tekst (KJV 16:49-17:13)
- 29:40 — har feil tekst

### 5 Mos
- 12:32 — har "hør på Herren" fra kap 13, burde ha "alt jeg befaler" (KJV 12:32)
- 22:30 — har "din nestes kornåker" fra 23:25, burde ha "fars hustru" (KJV 22:30)
- 29:29 — har paktsord fra 29:1, burde ha velsignelse/forbannelse (KJV 30:1)

### 1 Sam
- 23:29 — feil tekst

### 2 Sam
- 18:33 — feil tekst

### 1 Kong
- 4:21-34 — 14 vers med feil tekst (har kap 5-tekst, burde ha Salomos visdom/rike)

### 2 Kong
- 11:21 — feil tekst

### 1 Krøn
- 6:67-81 — 15 vers med duplikat-tekst (gjentar Levi-genealogien), burde ha kap 7 tekst

### 2 Krøn
- 2:18 — feil tekst
- 14:15 — feil tekst

### Neh
- 4:18-23 — 6 vers med feil tekst
- 7:73 — feil tekst
- 9:38 — feil tekst

### Job
- 41:27-34 — 8 vers med feil tekst (har Leviatan-fortsettelse, burde ha Jobs svar/Guds tale)

### Fork (Forkynneren)
- 5:20 — feil tekst

### Høys (Høysangen)
- 6:13 — feil tekst

### Jes
- 9:21 — feil tekst
- 64:12 — feil tekst

### Jer
- 9:26 — feil tekst

### Esek
- 20:45-49 — 5 vers med feil tekst

### Dan
- 4:35-37 — 3 vers med feil tekst
- 5:31 — feil tekst

### Hos
- 1:10-11 — feil tekst
- 11:12 — feil tekst
- 13:16 — feil tekst

### Joel
- 2:28-30, 2:32 — 4 vers med feil tekst (duplikat av Joel 3:1-5)
- 3:6-21 — 16 vers (hele Joel kap 4 i hebraisk nummerering)

### Jona
- 1:17 — har "fisken spydde Jona" (= 2:10 duplikat), burde ha "fisken slukte Jona"

### Mi
- 5:15 — feil tekst

### Nah
- 1:15 — feil tekst

### Sak
- 1:18-21 — 4 vers med feil tekst

### Apg
- 19:41 — feil tekst

### Rom
- 16:25-27 — doksologien (kan være korrekt, men bør verifiseres)

### 2 Kor
- 13:14 — duplikat av 13:13
