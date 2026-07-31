# KVN — Kanonisk Versnummer

KVN er et kanonisk nummereringssystem for bibelvers. Hvert vers i Bibelen
får et unikt tall basert på osmain-koordinater (bok, kapittel, vers, del).

Systemet løser problemet med at ulike bibeloversettelser nummererer vers
forskjellig. Ved å ha én kanonisk nummerering (osmain) som alle oversettelser
mappes til, kan man slå opp vers på tvers av oversettelser.

## Arkitektur

```
KJV vers ──→ KJV-mapping ──→ osmain KVN ──→ DNB2024-mapping ──→ DNB2024 vers
              (toKvn)                         (toTkvn)
```

Hver oversettelse lagrer tekst med sine **egne versnummer** (ikke KVN).
Konvertering mellom oversettelser skjer i runtime via `CrossMapper`,
som kjeder to mappinger gjennom osmain som pivot. Map-lookup er O(1),
så konvertering av 1000 vers tar under 1ms.

Å lagre i oversettelsens originalnummer (ikke KVN) er et bevisst valg:
- Dataene er selvforklarende og matcher trykte bibler
- Nye oversettelser kan legges til uten datamigrering
- Sub-vers (parts) trenger ikke eksponeres til konsumenter
- Konverteringen er billig nok til å gjøres on-the-fly

## osmain

osmain er masterbibeloversettelsen som definerer KVN-koordinatsystemet.
Den er bygget fra osnb (tanach/sblgnt) og utvidet med vers fra alle
kjente bibeltradisjoner. Teksten er på norsk bokmål.

- **31 069 vers** fra osnb (`source: tanach/sblgnt`)
- **56 oversatte vers** fra andre tradisjoner (`source: translated`)
- Nummerering følger flertallet av ~1148 bibler (europeisk/protestantisk)
- Salmeoverskrifter er innbakt i vers 1 (slått sammen med innholdet)

osmain ligger i `generate/bibles_raw/osmain/`.

### Forholdet mellom osmain og osnb

osnb er kildebibelen (hebraisk/gresk nummerering). osmain er bygget
fra osnb men renummerert til flertallsnummereringen. Forskjellene:

- **62 salmer**: osmain slår sammen overskrift (osnb v1) med innhold (osnb v2) i v1
- **33 hebraiske versifikasjonspar**: vers flyttes mellom nabokapitler
  (f.eks. 2 Mos 7:26-29 → 8:1-4, Joel 3-kapitlers vs 4-kapitlers inndeling)
- **8 sammenslåinger**: osmain slår sammen to osnb-vers til ett
  (f.eks. 2 Mos 21:36+37, Neh 10:1+2)

## KVN Encoding (v2)

KVN er et vanlig JavaScript-tall (BIGINT i MySQL):

```
KVN = book * M_ch + chapter * M_v + verse * PART_SIZE + part
```

Konstanter:
- `PART_SIZE = 16` — gir 16 mulige sub-vers per vers
- `MAX_VERSE = 177`, `M_v = 177 * 16 = 2832`
- `MAX_CHAPTER = 151`, `M_ch = 151 * 2832 = 427632`

Part-feltet (0-15): 0=helt vers, 1=a (første del), 2=b (andre del), osv.

Runtime-funksjoner: `ukvnEncode(book, ch, verse, part)` og `ukvnDecode(kvn)`.

## Mappingfiler

Hver oversettelse har en mappingfil (`mappings/*.ukvn.json`) som beskriver
avvik fra osmain. Vers med identisk nummerering trenger ingen entry —
de fleste vers er identiske, så mappingfilene er kompakte.

Tilgjengelige mappinger:

| Fil | Oversettelse | Entries | Merknad |
|-----|-------------|---------|---------|
| `english_kj.ukvn.json` | King James Version | 30 | Nesten identisk med osmain |
| `dnb2011_nb.ukvn.json` | Bibelselskapets 2011 (bokmål) | ~1239 | Referanse for norske |
| `dnb2024_nb.ukvn.json` | Bibelselskapets 2024 (bokmål) | ~1214 | 7 kap endret fra 2011 |
| `dnb2024_nn.ukvn.json` | Bibelselskapets 2024 (nynorsk) | ~1214 | Identisk med nb-2024 |
| `dnb30.ukvn.json` | Bibelselskapets 1930 | ~1239 | Identisk med 2011 |
| `nb1978.ukvn.json` | Bibelselskapets 1978 | ~1241 | 2011 + 4 Mos 25 |
| `nb88_nb.ukvn.json` | Norsk Bibel 1988 (bokmål) | ~1254 | 2011 + Joh 1:38 split |
| `nb94_nn.ukvn.json` | Norsk Bibel 1994 (nynorsk) | ~1254 | Identisk med NB88 |
| `osnb.ukvn.json` | osnb (hebraisk/gresk) | ~1090 | Kildebibelen |

Entry-format:
```json
{
  "kvnFrom": 427648,    // osmain KVN
  "kvnTo": 427648,
  "kvnRef": "1 Mos 1:1",
  "tkvnFrom": 427648,   // oversettelsens KVN
  "tkvnTo": 427648,
  "tkvnRef": "1 Mos 1,1",
  "order": 0
}
```

### Sub-vers mapping (part-feltet)

Når osmain slår sammen flere oversettelsesvers til ett, bruker mappingen
part-feltet for å angi hvilken del av osmain-verset som tilsvarer hvert
oversettelsesvers.

Eksempel: Sal 92 — osmain slår sammen overskrift og innhold i v1:

| Oversettelse (f.eks. osnb) | osmain | part |
|-----------------------------|--------|------|
| v1: "En salme, en sang for sabbatsdagen." | v1a | 1 |
| v2: "Det er godt å takke Herren..." | v1b | 2 |
| v3: "å forkynne din godhet..." | v2 | 0 |

Tre typer salme-avvik:

- **Type A** (25 salmer): Identisk v1 i osmain og oversettelsen, men oversettelsen har ekstra vers på slutten. Ingen sub-vers nødvendig.
- **Type B** (11 salmer): osmain v1 = oversettelsens v1+v2 sammenslått. Trenger sub-vers a/b.
- **Type C** (26 salmer): Identisk v1, men oversettelsen har ekstra vers mellom v1 og v2 (offset). Trenger versnummer-forskyvning men ikke sub-vers.

Utenfor Salmene finnes 8 sammenslåinger (f.eks. 2 Mos 21:36, 4 Mos 25:18,
1 Kong 22:43, 1 Krøn 5:1/3/4, 1 Krøn 12:40, Neh 10:1).

### Versifikasjonsforskjeller mellom oversettelser

De norske bibelselskaps-oversettelsene (1930, 1978, 2011, 2024) har nesten
identisk versifisering. Hovedforskjellene:

- **1978 vs 2011**: Kun 4 Mos 25 (1978 har 19v, 2011 har 18v)
- **2024 vs 2011**: 7 kapitler endret (1 Mos 42/43, 4 Mos 25, Esek 20/21, Rom 9, Ef 1)
- **NB88/NB94**: Identisk med 2011 unntatt Joh 1 (52v vs 51v) og Apg 19 (41v vs 40v)

KJV er nesten identisk med osmain — kun 3 forskjeller:
- 1 Krøn 5 (osmain 22v, KJV 26v — osmain slo sammen vers)
- 3 Joh 1 (osmain 15v, KJV 14v — osmain splittet v14)
- Åp 12/13 (osmain 18+18v, KJV 17+18v — "dragen på sanden" flyttet)

## Runtime-bibliotek (v2)

Nye moduler i `src/ukvn-*.ts`:

```typescript
import { UkvnMapper, CrossMapper, loadUkvnMapping, sliceVersePart, ukvnEncode } from './ukvn.js';

// Last mappinger
const kjv = new UkvnMapper(loadUkvnMapping('english_kj'));
const dnb = new UkvnMapper(loadUkvnMapping('dnb2024_nb'));

// Kryss-mapp fra KJV til DNB2024
const cross = new CrossMapper(kjv, dnb);
const result = cross.map(ukvnEncode(19, 92, 2)); // KJV Sal 92:2
// result.tkvn = DNB2024 Sal 92:3
// result.partial = false

// Når et vers er delvis (sub-vers), bruk TextSlicer
const partialResult = cross.map(ukvnEncode(13, 5, 1)); // KJV 1 Krøn 5:1
// partialResult.partial = true (KJV v1 = bare del a av osmain v1)
// Bruk sliceVersePart(osmainText, 1, 2) for å hente riktig tekstdel
```

### API

| Klasse/funksjon | Beskrivelse |
|----------------|-------------|
| `UkvnMapper` | Mapper mellom osmain og én oversettelse |
| `CrossMapper` | Kjeder to UkvnMapper for oversettelse→oversettelse |
| `sliceVersePart(text, part, totalParts, refTexts?)` | Kutter ut sub-vers-tekst fra sammenslått vers |
| `loadUkvnMapping(name)` | Laster en `.ukvn.json` mappingfil |
| `listUkvnMappings()` | Lister tilgjengelige mappinger |
| `ukvnEncode(book, ch, verse, part?)` | Enkoder til KVN-tall |
| `ukvnDecode(kvn)` | Dekoder fra KVN-tall |

### CrossMapResult

```typescript
{
  tkvn: number;      // Verset i mål-oversettelsen
  osmainKvn: number; // Mellomliggende osmain-referanse (kan ha part > 0)
  partial: boolean;  // true = bare del av osmain-verset dekkes
}
```

Når `partial=true`, dekker kilde-verset bare en del av osmain-verset.
Bruk `ukvnDecode(result.osmainKvn).part` for å vite hvilken del,
og `sliceVersePart()` for å hente riktig tekst-utsnitt.

## Skript

### Bygge osmain

```bash
# 1. Analyser alle 1148 bibler, finn flertallsnummerering

# 2. Kopier osnb → osmain med renummerering og placeholders

# 3. Fyll boundary-shift-vers fra osnb
bun scripts/fix-osmain-boundaries.ts

# 4. Legg til source-felt (tanach/sblgnt) på alle vers
bun scripts/add-source-field.ts

# 5. Fiks renummerering via Ollama (salmeoverskrifter, kapittelskift)
bun scripts/fix-all-renumbering.ts

# 6. Oversett manglende vers via Claude API (krever ANTHROPIC_API_KEY i generate/.env)
bun scripts/translate-missing.ts --translate
```

### Generere mappinger

```bash
# Fra raw JSON (støtter både external/closed/raw/ og generate/bibles_raw/)
bun scripts/generate-mapping.ts --source dnb2011_nb --format txt
bun scripts/generate-mapping.ts --source english_kj --format raw
bun scripts/generate-mapping.ts --source osnb --format raw

# Enkelt kapittel (for testing)
bun scripts/generate-mapping.ts --source dnb2011_nb --format txt --chapter 19:3

# Dry run / annen modell
bun scripts/generate-mapping.ts --source dnb2011_nb --format txt --dry-run
bun scripts/generate-mapping.ts --source dnb2011_nb --format txt --model qwen3.5:122b
```

Mapping-generering bruker gemma4 (lokal Ollama) for bulk-matching.
Kapitler med avvik sendes til Claude API for verifisering.

De fleste norske mappinger (dnb30, nb1978, dnb2024, nb88 osv.) ble laget
manuelt ved å sammenligne versantall og innhold mot dnb2011, siden
forskjellene er små og forutsigbare.

Resume-støtte: Skriptet hopper over kapitler som allerede er prosessert
(sjekker `data/mapping-results/<source>/`).

### Verifisere mappingene mot teksten

**Ett sted å starte — skriptet forklarer seg selv:**

```bash
cd kvn && ./scripts/run-verification.sh
```

Uten argumenter skriver det ut kjørerekkefølgen, fallgruvene og hvilke modeller
som trengs. Du behøver ikke huske noe av det som står nedenfor; det er der for å
forklare *hvorfor*.

Rundturskontrollen (`check-osmain-roundtrip.py`) teller **tall**: en mapping som
er bijektiv består den selv om den peker på feil vers. `basque` Sal 110 pekte på
feil kapittel og besto; `albanian` Åp 1–12 ligger ett vers ned hele veien og
består. «1157 av 1158 rene» er derfor en påstand om aritmetikk, ikke om tekst.

Tekstverifiseringen leser teksten. Kjør i denne rekkefølgen:

```bash
./scripts/run-verification.sh maal        # mål farten på maskinen (~30 min)
./scripts/run-verification.sh struktur    # gratis, ingen modell
./scripts/run-verification.sh pri1        # de 81 åpne oversettelsene
./scripts/run-verification.sh rapport --list
```

**`struktur` må gå først.** `check-mapping-coverage.ts` finner osmain-vers som
slås opp til et versnummer oversettelsen ikke har — 168 774 vers i 1 119
oversettelser ved første kjøring. Årsaken er parafraser som fletter vers og
merker blokken med det første versnummeret (`norwegian2018` 1 Mos 1 har 17 vers
med numrene 1,3,6,9,…), så oppslaget returnerer ingenting. Uten denne runden
brukes måneder med GPU-tid på vers der oppslaget ikke kan lykke uansett.

`verify-text.ts` kjører fem lag, ELLER-koblet, i **fem pass — ett per modell**:

| pass | modell | hva |
|---|---|---|
| `prep` | bge-m3 | basislinjer og kalibreringseksempler per oversettelse |
| `mech` | bge-m3 | likhet, lengde, leddekning, tegnsetting for hvert vers |
| `judge1` | gemma4:31b | dom, kalibrert med oversettelsens egne eksempler |
| `judge2` | granite4.1:30b | annen modellfamilie — halverer bomraten |
| `verdict` | — | ren regning: endelig dom per vers |

Passene er delt per modell fordi to modeller i minnet samtidig gir utkasting og
innlasting mellom kallene: målt 11 s/vers mot 3,5. Ikke kjør to pass samtidig.
Alt er gjenopptakbart per kapittel — Ctrl-C koster ingenting.

Logg: `data/text-verification/<oversettelse>/<bok>/<kapittel>.json`. Kapittelnivå,
ikke per vers: 27,5 M filer à ~150 byte legger beslag på 110 GB på 4 KB-blokker.
Loggen er gitignorert — `_baseline.json` inneholder kalibreringseksempler med
verstekst, og for de lukkede oversettelsene er det opphavsrettsbeskyttet.

Dommen skrives, ikke bare ja/nei, fordi typen peker nesten entydig på feilklassen:
`DIFFERENT` → feil vers (100 % i testsettet), `B_EXTRA` → fletting (99 %),
`B_MISSING` → avkortet (85 %). Arbeidslisten kommer derfor sortert etter hva som
må gjøres: `WRONG` trenger en forskyvning, `MERGED` en flettings- eller
delverspost, `SHORT` at man finner ut hvor resten av teksten ble av.

Målt på 1 831 par fra 12 språk: **bomrate 0,07 %** (1 av 1 351, og den ene var en
feilmerking i testsettet), eskalering 16,5 %. Validert mot de 13 dokumenterte
mappingfeilene i `FUNN.md`: 13 av 13 — ingen enkeltdel klarte det alene.

Rekkefølgen på oversettelsene står i `research/text-verification/priority.txt`.
Forskningsgrunnlaget — testsett, benchmark, ensemble-analyse — ligger i samme
katalog; skriptene er sporet, dataene gitignorert.

Forbehold: de bge-m3-baserte lagene er målt på oversettelser med kryssspråklig
likhet 0,66–0,87. `hcv` ligger på 0,573 og `maori` på 0,607, og der er de
svakere. Tegnsetting, lengde og dommerne er upåvirket. Ikke målt ennå.

## Gammel KVN (v1)

Det gamle 27-bit systemet (`book << 20 | chapter << 12 | verse << 4 | part`)
ligger i `src/kvn.ts` og `src/types.ts` med 204 tester. Det bruker osnb som
basis med en separat mappingfil for DNB 2011 (`mappings/dnb_2011_nb.kvn.json`).

Det nye v2-systemet bruker osmain som basis og aritmetisk encoding uten bitpakking.

## Tester

```bash
bun test          # kjør hele suiten
bun test tests/ukvn-integration.test.ts  # kun v2 integrasjonstester
```
