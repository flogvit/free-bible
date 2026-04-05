# KVN — Kanonisk Versnummer

KVN er et kanonisk nummereringssystem for bibelvers. Hvert vers i Bibelen
får et unikt tall basert på osmain-koordinater (bok, kapittel, vers, del).

## osmain

osmain er masterbibeloversettelsen som definerer KVN-koordinatsystemet.
Den er bygget fra osnb2 (tanach/sblgnt) og utvidet med vers fra alle
kjente bibeltradisjoner. Teksten er på norsk bokmål.

- **31 069 vers** fra osnb2 (`source: tanach/sblgnt`)
- **56 oversatte vers** fra andre tradisjoner (`source: translated`)
- Nummerering følger flertallet av 1148 bibler (europeisk/protestantisk)
- Salmeoverskrifter er innbakt i vers 1 (norsk tradisjon)

osmain ligger i `generate/bibles_raw/osmain/`.

## KVN Encoding

KVN er et vanlig JavaScript-tall (BIGINT i MySQL):

```
KVN = book * M_ch + chapter * M_v + verse * PART_SIZE + part
```

Konstanter:
- `PART_SIZE = 16`
- `MAX_VERSE = 177`, `M_v = 177 * 16 = 2832`
- `MAX_CHAPTER = 151`, `M_ch = 151 * 2832 = 427632`

Part-feltet (0-15) er setningsposisjon: 0=helt vers, 1=a (1. setning), 2=b (2. setning), osv.

## Mappingfiler

Hver oversettelse har en mappingfil (`mappings/*.ukvn.json`) som beskriver
avvik fra osmain. Vers med identisk nummerering trenger ingen entry.

Entry-format:
```json
{
  "kvnFrom": 427648,
  "kvnTo": 427648,
  "kvnRef": "1 Mos 1:1",
  "tkvnFrom": 427648,
  "tkvnTo": 427648,
  "tkvnRef": "1 Mos 1,1",
  "order": 0
}
```

## Skript

### Bygge osmain

```bash
# 1. Analyser alle 1148 bibler, finn flertallsnummerering
npx tsx scripts/build-osnb3.ts

# 2. Kopier osnb2 → osmain med renummerering og placeholders
npx tsx scripts/create-osnb3.ts

# 3. Fyll boundary-shift-vers fra osnb2
npx tsx scripts/fix-osmain-boundaries.ts

# 4. Legg til source-felt (tanach/sblgnt) på alle vers
npx tsx scripts/add-source-field.ts

# 5. Fiks renummerering via Ollama (salmeoverskrifter, kapittelskift)
npx tsx scripts/fix-all-renumbering.ts

# 6. Oversett manglende vers via Claude API (krever ANTHROPIC_API_KEY i generate/.env)
npx tsx scripts/translate-missing.ts --translate
```

### Generere mappinger

```bash
# DNB 2011 (fra txt-fil)
npx tsx scripts/generate-mapping.ts --source dnb2011_nb --format txt

# NB88 (fra txt-fil)
npx tsx scripts/generate-mapping.ts --source nb88_nb --format txt

# Engelsk KJV (fra raw JSON)
npx tsx scripts/generate-mapping.ts --source english_kj --format raw

# Enkelt kapittel (for testing)
npx tsx scripts/generate-mapping.ts --source dnb2011_nb --format txt --chapter 19:3

# Dry run (vis hva som trengs uten å kjøre Ollama)
npx tsx scripts/generate-mapping.ts --source dnb2011_nb --format txt --dry-run

# Annen Ollama-modell
npx tsx scripts/generate-mapping.ts --source dnb2011_nb --format txt --model qwen3.5:122b
```

Mapping-generering bruker gemma4:31b (lokal Ollama) for bulk-matching.
Kapitler der gemma4 finner avvik (extra_content, merged, split, missing)
sendes automatisk til Claude API for verifisering.

Resume-støtte: Skriptet hopper over kapitler som allerede er prosessert
(sjekker `data/mapping-results/<source>/`). Trygt å stoppe og starte på nytt.

### Hjelpeskript

```bash
# Benchmark Ollama-modeller for mapping-kvalitet
npx tsx scripts/benchmark-mapping-models.ts --warmup

# Verifiser osmain-dekning mot alle bibler
npx tsx scripts/verify-osmain.ts

# Analyser spacing-behov (historisk, ikke lenger relevant)
npx tsx scripts/analyze-spacing.ts
```

## Gammel KVN (v1)

Det gamle 27-bit systemet (`book << 20 | chapter << 12 | verse << 4 | part`)
ligger i `src/kvn.ts` og `src/types.ts` med 204 tester. Det bruker osnb2 som
basis med en separat mappingfil for DNB 2011 (`mappings/dnb_2011_nb.kvn.json`).

Det nye systemet bruker osmain som basis og aritmetisk encoding uten bitpakking.

## Tester

```bash
npm test
```
