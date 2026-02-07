# Verse Mapping – Bibeloversettelser

Forskjellige bibeloversettelser har ulik versinndeling. Vår interne standard følger
den hebraiske (Tanach) og greske (SBLGNT) originalnummereringen via `osnb2`.
For å støtte andre oversettelser trenger vi en mapping mellom deres nummerering og osnb2.

## Kort oversikt

1. Lag en tekstfil med ett vers per linje
2. Legg til formatet i `generate/generate-verse-mapping.mjs`
3. Kjør skriptet for å generere mapping
4. Resultat havner i `generate/mappings/<id>.json`

## Steg 1: Forbered tekstfilen

Filen skal ha **ett vers per linje** i formatet:

```
BokNavn kapittel,vers verstekst
```

Eksempel (Bibel 2011):
```
1 Mos 1,1 I begynnelsen skapte Gud himmelen og jorden.
1 Mos 1,2 Jorden var øde og tom, mørke lå over dypet, og Guds ånd svevde over vannet.
...
Åp 22,21 Herren Jesu nåde være med alle!
```

Alle 31 000+ vers skal være med, fra 1. Mosebok til Åpenbaringen.

## Steg 2: Legg til format i skriptet

Åpne `generate/generate-verse-mapping.mjs` og legg til en ny oppføring i `KNOWN_FORMATS`:

```js
const KNOWN_FORMATS = {
  bibel2011: { /* ... eksisterende ... */ },

  // Ny oversettelse:
  mittformat: {
    name: 'Min oversettelse',
    description: 'Beskrivelse av oversettelsen',
    lineRegex: /^(.+?)\s+(\d+),(\d+)\s+(.+)$/,
    bookNames: {
      'Gen': 1, 'Exod': 2, // ... alle 66 bøker
      'Rev': 66,
    },
  },
};
```

`lineRegex` må ha fire grupper: (boknavn) (kapittel),(vers) (tekst).
`bookNames` mapper boknavn slik de forekommer i filen til book ID (1–66).

## Steg 3: Kjør mapping-skriptet

```bash
cd generate/

# Steg A: Kjør uten AI først for å se forskjellene
node generate-verse-mapping.mjs /sti/til/fil.txt mittformat

# Steg B: Kjør med AI for å matche gjenværende kapitler
node generate-verse-mapping.mjs /sti/til/fil.txt mittformat --use-ai
```

Uten `--use-ai` løser skriptet de fleste forskjellene deterministisk
(enkle kapittelsgrense-skift). Med `--use-ai` bruker det Claude API til å
matche vers i kapitler der forskjellene er mer komplekse.

AI krever `ANTHROPIC_API_KEY` i `generate/.env`.

## Hva skriptet gjør

1. **Parser** tekstfilen og teller vers per bok/kapittel
2. **Sammenligner** med osnb2 JSON-filene i `bibles_raw/osnb2/`
3. **Deterministisk mapping** for:
   - Kapittelsgrense-skift mellom to nabokaptiler (f.eks. 1 Mos 31–32)
   - Flerkaptittel-blokker der totalt versantall matcher (f.eks. Job 38–41)
   - Overflow til ikke-eksisterende kapitler (f.eks. Mal 4 → Mal 3:19–24)
4. **AI-matching** (med `--use-ai`) for isolerte forskjeller der vers ikke
   bare er forskjøvet men kan være slått sammen eller splittet

## Resultatformat

Mappingen lagres som JSON i `generate/mappings/<id>.json`:

```json
{
  "id": "bibel2011",
  "name": "Bibel 2011",
  "description": "Bibelselskapets oversettelse 2011",
  "bookNames": {
    "1 Mos": 1,
    "2 Mos": 2,
    "...": "..."
  },
  "verseMap": {
    "1-31-55": "1-32-1",
    "1-32-1": "1-32-2",
    "39-4-1": "39-3-19"
  },
  "unmapped": [
    { "bookId": 45, "srcRef": "16:25", "reason": "No match in osnb2" }
  ]
}
```

- **bookNames**: Boknavn i kildefilen → intern book ID (1–66)
- **verseMap**: `"bookId-srcKapittel-srcVers"` → `"bookId-osnb2Kapittel-osnb2Vers"`.
  Vers som ikke er i mappen har identisk nummerering.
- **unmapped**: Vers i kilden som ikke finnes i osnb2 (tekstkritiske varianter, manglende data)

## Typiske forskjeller

| Type | Eksempel | Forklaring |
|------|----------|------------|
| Kapittelsgrense-skift | 1 Mos 31:55 → 32:1 | Siste vers i et kapittel er første vers i neste i hebraisk |
| Flerkaptittel-blokk | Job 38–41 | 4 kapitler med ulik intern inndeling, men totalt likt |
| Kapittel-split | Mal 3+4 vs Mal 3 | Bibel2011 har Mal 4:1–6, hebraisk har Mal 3:19–24 |
| Isolert forskjell | 4 Mos 25 | osnb2 har 19 vers, Bibel2011 har 18 (vers 19 er absorbert i neste kapittel) |
| Tekstkritisk variant | Rom 16:25–27 | Doksologien finnes i noen manuskripter men ikke i SBLGNT |
| Manglende data | Joel 3:6–26 → 4:1–21 | Mapping er klar, men osnb2 mangler Joel kap 4 |

## Tips

- Kjør alltid uten `--use-ai` først for å se omfanget av forskjellene
- De fleste oversettelser har ca. 50–60 kapitler med forskjeller, primært i GT
- NT har svært få forskjeller (ofte bare Rom 16)
- Bibel2011-mappingen kan brukes som referanse for andre norske oversettelser
  da de fleste følger samme nummerering
