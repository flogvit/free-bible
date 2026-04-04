# KVN — Kanonisk Versnummer

KVN er et kanonisk nummereringssystem for bibelvers. Hvert vers i Bibelen
får et unikt tall som koder bok, kapittel, vers og delvers i ett enkelt
JavaScript-tall (27 bit).

## Bit-layout

```
book (7 bit) | chapter (8 bit) | verse (8 bit) | part (4 bit)
```

- **book**: 1–127 (1–66 brukes, 1 Mos=1 ... Åp=66)
- **chapter**: 0–255
- **verse**: 0–255
- **part**: 0–15 (0=helt vers, 1=a, 2=b, 3=c)

Encoding: `(book << 20) | (chapter << 12) | (verse << 4) | part`

### Eksempler

| Vers | Encoding |
|------|----------|
| 1 Mos 1:1 | `(1 << 20) \| (1 << 12) \| (1 << 4)` = 1052688 |
| 2 Mos 8:1 | `(2 << 20) \| (8 << 12) \| (1 << 4)` = 2129936 |
| Mika 5:1a | `(33 << 20) \| (5 << 12) \| (1 << 4) \| 1` = 34623505 |

## kvn og tkvn

- **kvn** = basis-referanse. Direkte 1:1 med osnb2 (tanach/sblgnt) koordinater.
  Hvert vers i osnb2 har nøyaktig én kvn, og den er simpelthen de encodede koordinatene.
- **tkvn** = translation KVN. Oversettelsens koordinater (f.eks. DNB 2011),
  encodet med samme bit-layout.

osnb2 er master — kvn er bare en encoding av osnb2-koordinater, ingen mapping
involvert. Mappingfilen beskriver kun hvordan en oversettelse avviker fra basis.

De fleste vers har samme posisjon i basis og oversettelse (kvn = tkvn).
Mappingfilen inneholder bare vers som er forskjellige.

### Eksempel på forskjeller

Ulike bibeloversettelser nummererer noen vers forskjellig:

| osnb2 (kvn) | DNB 2011 (tkvn) | Forklaring |
|-------------|-------------------|------------|
| 2 Mos 8:1 | 2 Mos 7:26 | Backward shift: 4 vers fra kap 8 til kap 7 |
| 2 Mos 8:5 | 2 Mos 8:1 | Chain shift: resten forskyves ned |
| 1 Mos 32:1 | 1 Mos 32:2 | Forward shift: +1 pga phantom-vers |
| Neh 7:69 | Neh 7:68 | Same-chapter backward |

## Mappingfil

```json
{
  "version": 1,
  "system": "dnb_2011_nb",
  "name": "DNB 2011",
  "bookNames": { "1 Mos": 1, "2 Mos": 2, ... },
  "map": [
    [kvn, tkvn, "kvn-lesbar", "tkvn-lesbar"],
    ...
  ],
  "extraVerses": [
    [tkvn, "lesbar", afterKvn],
    ...
  ]
}
```

- **map**: Vers der kvn != tkvn. 4-tuple: `[kvn, tkvn, "2 Mos 8:1", "2 Mos 7:26"]`
- **extraVerses**: Vers som bare finnes i oversettelsen (f.eks. Rom 16:25–27).
  `afterKvn` angir hvilken basis-kvn verset kommer etter.

## KVNConverter

```typescript
import { KVNConverter } from './src/kvn.js';
import { loadKvnMapping } from './src/load-mapping.js';

const mapping = loadKvnMapping();
const converter = new KVNConverter(mapping);

// Basis → oversettelse
converter.toTkvn(kvn)       // Returnerer tkvn (identity hvis ikke i map)

// Oversettelse → basis
converter.toKvn(tkvn)       // Returnerer kvn, eller null for ekstravers

// Sjekk ekstravers
converter.isExtra(tkvn)     // true for vers uten basis-ekvivalent

// Ekstravers-posisjonering
converter.getAfterKvn(tkvn)    // Returnerer afterKvn for ekstravers, null ellers
converter.toSortableKvn(tkvn)  // Sorterbar kvn (bruker part-bits for ekstravers)

// Kollisjonsoppslag
converter.isCollision(kvn)           // true hvis identitetsposisjon er okkupert
converter.getCollisionSource(kvn)    // Returnerer kilde-kvn ved kollisjon, null ellers
```

### toSortableKvn

For ekstravers (f.eks. Rom 16:25–27 som ikke finnes i basis) gir `toSortableKvn`
en sorterbar verdi som plasserer dem etter basis-verset de hører til:

```typescript
const rom16_25 = encode(45, 16, 25);  // Ekstravers
converter.toSortableKvn(rom16_25)      // → encode(45, 16, 24, 1) — etter vers 24
```

### getCollisionSource

Noen kvn-posisjoner er "okkupert" av en annen mappings tkvn. `getCollisionSource`
returnerer hvilken kvn som mapper dit:

```typescript
const gen32_33 = encode(1, 32, 33);
converter.getCollisionSource(gen32_33)  // → encode(1, 32, 32)  (fordi 32:32 → 32:33)
```

## Referanseparsing

```typescript
import { parseRef, refsToKvn, formatRefs, convertRef } from './src/kvn.js';

// Enkle referanser
parseRef("Ordsp 8,1-2.22-31")
parseRef("Mika 5,1-4a")        // Sub-vers (a = første del)
parseRef("1 Mos 1,1-31")

// Semikolon for flere kapitler
parseRef("Apg 13,1–4;14,22–23")

// Krysskapittel-ranges (krever maxVerse-callback)
parseRef("Joh 18,1–19,42", { maxVerse: getMaxVerse })
parseRef("Jes 8,23b–9,6", { maxVerse: getMaxVerse })

// "og/eller" normaliseres til range
parseRef("Apg 17,22–25 og/eller 26–31")  // → 17,22–31

// Konverter til kvn-tall
const kvns = refsToKvn(parseRef("Joh 3,16-21"));

// Formater tilbake til lesbar streng
formatRefs(kvns)  // "Joh 3,16–21"

// Flerbok-output
formatRefs([...refsToKvn(parseRef("1 Mos 50,1-3")),
            ...refsToKvn(parseRef("2 Mos 1,1-3"))])
// → "1 Mos 50,1–3; 2 Mos 1,1–3"

// Konverter referanse mellom systemer
convertRef("2 Mos 8,1-4", converter, 'toTkvn')  // Basis → DNB 2011
convertRef("2 Mos 7,26-29", converter, 'toKvn')  // DNB 2011 → basis
```

### MaxVerseProvider

Krysskapittel-ranges krever en callback som returnerer maks versnummer per kapittel.
Uten callback kastes en feil.

```typescript
import type { MaxVerseProvider } from './src/types.js';

const maxVerse: MaxVerseProvider = (book, chapter) => getMaxVerse(book, chapter);
parseRef("Joh 18,1–19,42", { maxVerse })
```

### Referanseformat

```
Bok kapittel,vers[-vers][.vers[-vers]]
```

- Komma skiller kapittel fra vers: `8,1`
- Bindestrek/tankestrek for rekkevidde: `1-10` eller `1–10`
- Punktum for flere segmenter: `1-2.22-31`
- Bokstav for delvers: `4a`, `6b`
- Semikolon for flere kapitler: `13,1-4;14,22-23`
- Krysskapittel med maxVerse: `1,26–2,2`
- "og/eller" → range: `22–25 og/eller 26–31` → `22–31`

## Laste mappingfiler

```typescript
import { loadKvnMapping, listMappingSystems } from './src/load-mapping.js';

// Standard: laster dnb_2011_nb
const mapping = loadKvnMapping();

// Last med systemnavn
const mapping2 = loadKvnMapping('dnb_2011_nb');

// Last fra full sti
const mapping3 = loadKvnMapping('/path/to/custom.kvn.json');

// List tilgjengelige systemer
listMappingSystems()  // → ["dnb_2011_nb"]
```

## Tester

```bash
npm test
```

6 testfiler med 156 tester:
- **mapping-integrity** — Validerer mappingfilens struktur
- **kvn-library** — Tester KVNConverter med kuraterte testcases
- **kvn-verses** — Verifiserer mot osnb2-kildefiler
- **kvn-references** — Roundtrip-tester med bibelreferanser
- **kvn-lesetekster** — Parser og roundtripper alle 780 DNK-lesetekster
- **kvn-parseref-enhanced** — Utvidet parseRef, formatRefs, nye KVNConverter-metoder
