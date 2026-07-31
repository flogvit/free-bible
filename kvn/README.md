# KVN — Canonical Verse Number

KVN is a canonical numbering system for Bible verses. Every verse in the Bible
gets a unique number based on osmain coordinates (book, chapter, verse, part).

It solves the problem that different Bible translations number verses
differently. With one canonical numbering (osmain) that every translation maps
to, verses can be looked up across translations.

## Architecture

```
KJV verse ──→ KJV mapping ──→ osmain KVN ──→ DNB2024 mapping ──→ DNB2024 verse
               (toKvn)                          (toTkvn)
```

Each translation stores its text with **its own verse numbers** (not KVN).
Conversion between translations happens at runtime through `CrossMapper`, which
chains two mappings through osmain as the pivot. Map lookup is O(1), so
converting 1,000 verses takes under 1 ms.

Storing verses in the translation's own numbering rather than in KVN is a
deliberate choice:

- The data is self-explanatory and matches printed Bibles
- New translations can be added without migrating data
- Sub-verses (parts) need not be exposed to consumers
- The conversion is cheap enough to do on the fly

## osmain

osmain is the master translation that defines the KVN coordinate system. It is
built from osnb (tanach/sblgnt) and extended with verses from all known Bible
traditions. The text is in Norwegian bokmål.

- **31,069 verses** from osnb (`source: tanach/sblgnt`)
- **56 translated verses** from other traditions (`source: translated`)
- The numbering follows the majority of ~1,148 Bibles (European/Protestant)
- Psalm titles are folded into verse 1 (merged with the content)

osmain lives in `generate/bibles_raw/osmain/`.

### The relationship between osmain and osnb

osnb is the source Bible (Hebrew/Greek numbering). osmain is built from osnb but
renumbered to the majority numbering. The differences:

- **62 psalms**: osmain merges the title (osnb v1) with the content (osnb v2) into v1
- **33 Hebrew versification pairs**: verses move between neighbouring chapters
  (for example Exodus 7:26-29 → 8:1-4, and Joel's 3-chapter versus 4-chapter division)
- **8 merges**: osmain merges two osnb verses into one
  (for example Exodus 21:36+37, Nehemiah 10:1+2)

## KVN encoding (v2)

A KVN is an ordinary JavaScript number (BIGINT in MySQL):

```
KVN = book * M_ch + chapter * M_v + verse * PART_SIZE + part
```

Constants:

- `PART_SIZE = 16` — allows 16 sub-verses per verse
- `MAX_VERSE = 177`, `M_v = 177 * 16 = 2832`
- `MAX_CHAPTER = 151`, `M_ch = 151 * 2832 = 427632`

The part field (0-15): 0 = whole verse, 1 = a (first part), 2 = b (second part),
and so on.

Runtime functions: `ukvnEncode(book, ch, verse, part)` and `ukvnDecode(kvn)`.

## Mapping files

Every translation has a mapping file (`mappings/*.ukvn.json`) describing its
deviations from osmain. Verses with identical numbering need no entry — most
verses are identical, so the mapping files stay compact.

Available mappings:

| file | translation | entries | note |
|-----|-------------|---------|---------|
| `english_kj.ukvn.json` | King James Version | 30 | almost identical to osmain |
| `dnb2011_nb.ukvn.json` | Bibelselskapet 2011 (bokmål) | ~1239 | the reference for the Norwegian ones |
| `dnb2024_nb.ukvn.json` | Bibelselskapet 2024 (bokmål) | ~1214 | 7 chapters changed from 2011 |
| `dnb2024_nn.ukvn.json` | Bibelselskapet 2024 (nynorsk) | ~1214 | identical to nb-2024 |
| `dnb30.ukvn.json` | Bibelselskapet 1930 | ~1239 | identical to 2011 |
| `nb1978.ukvn.json` | Bibelselskapet 1978 | ~1241 | 2011 plus Numbers 25 |
| `nb88_nb.ukvn.json` | Norsk Bibel 1988 (bokmål) | ~1254 | 2011 plus the John 1:38 split |
| `nb94_nn.ukvn.json` | Norsk Bibel 1994 (nynorsk) | ~1254 | identical to NB88 |
| `osnb.ukvn.json` | osnb (Hebrew/Greek) | ~1090 | the source Bible |

Entry format:

```json
{
  "kvnFrom": 427648,    // osmain KVN
  "kvnTo": 427648,
  "kvnRef": "1 Mos 1:1",
  "tkvnFrom": 427648,   // the translation's KVN
  "tkvnTo": 427648,
  "tkvnRef": "1 Mos 1,1",
  "order": 0
}
```

### Sub-verse mapping (the part field)

When osmain merges several translation verses into one, the mapping uses the
part field to say which part of the osmain verse corresponds to each translation
verse.

Example: Psalm 92 — osmain merges the title and the content into v1:

| translation (e.g. osnb) | osmain | part |
|-----------------------------|--------|------|
| v1: "A psalm, a song for the Sabbath day." | v1a | 1 |
| v2: "It is good to give thanks to the LORD…" | v1b | 2 |
| v3: "to proclaim your steadfast love…" | v2 | 0 |

Three kinds of psalm deviation:

- **Type A** (25 psalms): v1 is identical in osmain and the translation, but the
  translation has extra verses at the end. No sub-verses needed.
- **Type B** (11 psalms): osmain v1 = the translation's v1+v2 merged. Needs
  sub-verses a/b.
- **Type C** (26 psalms): v1 is identical, but the translation has extra verses
  between v1 and v2 (an offset). Needs a verse-number shift, but no sub-verses.

Outside the Psalms there are 8 merges (Exodus 21:36, Numbers 25:18, 1 Kings
22:43, 1 Chronicles 5:1/3/4, 1 Chronicles 12:40, Nehemiah 10:1).

### Versification differences between translations

The Norwegian Bible Society translations (1930, 1978, 2011, 2024) are almost
identically versified. The main differences:

- **1978 vs 2011**: only Numbers 25 (1978 has 19 verses, 2011 has 18)
- **2024 vs 2011**: 7 chapters changed (Genesis 42/43, Numbers 25, Ezekiel 20/21,
  Romans 9, Ephesians 1)
- **NB88/NB94**: identical to 2011 except John 1 (52 vs 51 verses) and Acts 19
  (41 vs 40 verses)

The KJV is almost identical to osmain — only 3 differences:

- 1 Chronicles 5 (osmain 22 verses, KJV 26 — osmain merged verses)
- 3 John 1 (osmain 15 verses, KJV 14 — osmain split v14)
- Revelation 12/13 (osmain 18+18, KJV 17+18 — "the dragon on the sand" moved)

## Runtime library (v2)

The v2 modules are in `src/ukvn-*.ts`:

```typescript
import { UkvnMapper, CrossMapper, loadUkvnMapping, sliceVersePart, ukvnEncode } from './ukvn.js';

// Load mappings
const kjv = new UkvnMapper(loadUkvnMapping('english_kj'));
const dnb = new UkvnMapper(loadUkvnMapping('dnb2024_nb'));

// Cross-map from KJV to DNB2024
const cross = new CrossMapper(kjv, dnb);
const result = cross.map(ukvnEncode(19, 92, 2)); // KJV Psalm 92:2
// result.tkvn = DNB2024 Psalm 92:3
// result.partial = false

// When a verse is partial (a sub-verse), use the text slicer
const partialResult = cross.map(ukvnEncode(13, 5, 1)); // KJV 1 Chronicles 5:1
// partialResult.partial = true (KJV v1 is only part a of the osmain verse)
// Use sliceVersePart(osmainText, 1, 2) to get the right part of the text
```

### API

| class/function | description |
|----------------|-------------|
| `UkvnMapper` | maps between osmain and one translation |
| `CrossMapper` | chains two UkvnMappers for translation → translation |
| `sliceVersePart(text, part, totalParts, refTexts?)` | extracts sub-verse text from a merged verse |
| `loadUkvnMapping(name)` | loads a `.ukvn.json` mapping file |
| `listUkvnMappings()` | lists the available mappings |
| `ukvnEncode(book, ch, verse, part?)` | encodes to a KVN number |
| `ukvnDecode(kvn)` | decodes from a KVN number |

### CrossMapResult

```typescript
{
  tkvn: number;      // the verse in the target translation
  osmainKvn: number; // the intermediate osmain reference (may have part > 0)
  partial: boolean;  // true = only part of the osmain verse is covered
}
```

When `partial=true`, the source verse covers only part of the osmain verse. Use
`ukvnDecode(result.osmainKvn).part` to find out which part, and
`sliceVersePart()` to get the right slice of text.

## Scripts

### Building osmain

```bash
# 1. Analyse all 1,148 Bibles, find the majority numbering

# 2. Copy osnb → osmain with renumbering and placeholders

# 3. Fill boundary-shift verses from osnb
bun scripts/fix-osmain-boundaries.ts

# 4. Add the source field (tanach/sblgnt) to every verse
bun scripts/add-source-field.ts

# 5. Fix renumbering through Ollama (psalm titles, chapter shifts)
bun scripts/fix-all-renumbering.ts

# 6. Translate missing verses through the Claude API
#    (needs ANTHROPIC_API_KEY in generate/.env)
bun scripts/translate-missing.ts --translate
```

### Generating mappings

```bash
# From raw JSON (supports both external/closed/raw/ and generate/bibles_raw/)
bun scripts/build-mapping.ts --source dnb2011_nb --format txt
bun scripts/build-mapping.ts --source english_kj --format raw
bun scripts/build-mapping.ts --source osnb --format raw

# A single chapter, for testing
bun scripts/build-mapping.ts --source dnb2011_nb --format txt --chapter 19:3

# Dry run / a different model
bun scripts/build-mapping.ts --source dnb2011_nb --format txt --dry-run
bun scripts/build-mapping.ts --source dnb2011_nb --format txt --model qwen3.5:122b
```

Mapping generation uses gemma4 (local Ollama) for bulk matching. Chapters with
deviations are sent to the Claude API for verification.

Most of the Norwegian mappings (dnb30, nb1978, dnb2024, nb88 and so on) were made
by hand, comparing verse counts and content against dnb2011, because the
differences are small and predictable.

Resume support: the script skips chapters that have already been processed (it
checks `data/mapping-results/<source>/`).

### Verifying the mappings against the text

**One place to start — the script explains itself:**

```bash
cd kvn && ./scripts/run-verification.sh
```

With no arguments it prints the running order, the pitfalls and which models it
needs. You do not have to remember any of what follows; that is here to explain
*why*.

The round-trip check (`check-osmain-roundtrip.py`) counts **numbers**: a mapping
that is bijective passes even when it points at the wrong verse. `basque` Psalm
110 pointed at the wrong chapter and passed; `albanian` Revelation 1–12 sits one
verse low throughout and passes. "1,157 of 1,158 clean" is therefore a claim
about arithmetic, not about text.

The text verification reads the text. Run it in this order:

```bash
./scripts/run-verification.sh maal        # measure this machine's speed (~30 min)
./scripts/run-verification.sh struktur    # free, no model
./scripts/run-verification.sh pri1        # the 81 open translations
./scripts/run-verification.sh rapport --list
```

**`struktur` must go first.** `check-mapping-coverage.ts` finds osmain verses
that resolve to a verse number the translation does not have — 168,774 verses
across 1,119 translations on the first run. The cause is paraphrases that merge
verses and label the block with the first verse number (`norwegian2018` Genesis 1
has 17 verses numbered 1, 3, 6, 9, …), so the lookup returns nothing. Without
this pass, months of GPU time go into verses where the lookup cannot succeed at
all.

`verify-text.ts` runs five layers, OR-combined, in **five passes — one per
model**:

| pass | model | what |
|---|---|---|
| `prep` | bge-m3 | baselines and calibration examples per translation |
| `mech` | bge-m3 | similarity, length, clause coverage, punctuation per verse |
| `judge1` | gemma4:31b | a verdict, calibrated with the translation's own examples |
| `judge2` | granite4.1:30b | a different model family — halves the miss rate |
| `verdict` | — | pure arithmetic: the final verdict per verse |

The passes are split per model because two models resident at once causes
eviction and reloading between calls: measured at 11 s per verse against 3.5. Do
not run two passes at the same time. Everything resumes per chapter — Ctrl-C
costs nothing.

Log: `data/text-verification/<translation>/<book>/<chapter>.json`. Chapter level,
not per verse: 27.5 M files of ~150 bytes would occupy 110 GB on 4 KB blocks. The
log is gitignored — `_baseline.json` contains calibration examples with verse
text, and for the closed translations that text is copyrighted.

The verdict records a *type*, not merely yes/no, because the type points almost
unambiguously at the class of error: `DIFFERENT` → wrong verse (100% in the test
set), `B_EXTRA` → merging (99%), `B_MISSING` → truncated (85%). The work list
therefore arrives sorted by what has to be done: `WRONG` needs a shift, `MERGED`
needs a merge or sub-verse entry, `SHORT` needs someone to find out where the
rest of the text went.

Measured on 1,831 pairs from 12 languages: **miss rate 0.07%** (1 of 1,351, and
that one was a mislabelling in the test set), escalation 16.5%. Validated against
the 13 documented mapping errors in `FINDINGS.md`: 13 of 13 — no single layer
managed that alone.

The order of translations is in `research/text-verification/priority.txt`. The
research behind it — test set, benchmark, ensemble analysis — is in the same
directory; the scripts are tracked, the data is gitignored.

Caveat: the bge-m3 layers are measured on translations with cross-lingual
similarity 0.66–0.87. `hcv` sits at 0.573 and `maori` at 0.607, and they are
weaker there. Punctuation, length and the judges are unaffected. Not yet
measured.

## Old KVN (v1)

The old 27-bit system (`book << 20 | chapter << 12 | verse << 4 | part`) is in
`src/kvn.ts` and `src/types.ts` with 204 tests. It uses osnb as its basis, with a
separate mapping file for DNB 2011 (`mappings/dnb_2011_nb.kvn.json`).

The v2 system uses osmain as the basis and arithmetic encoding without bit
packing.

## Tests

```bash
bun test          # the whole suite
bun test tests/ukvn-integration.test.ts  # only the v2 integration tests
```
