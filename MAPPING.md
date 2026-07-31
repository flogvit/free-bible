# Verse mapping — Bible translations

Different Bible translations divide verses differently. Our internal standard
follows the Hebrew (Tanach) and Greek (SBLGNT) original numbering through `osnb`.
To support another translation we need a mapping between its numbering and
osnb's.

> This describes the **v1** mapping route, which uses osnb as the basis. The
> current system (v2) uses osmain as the pivot — see [kvn/README.md](kvn/README.md)
> and `kvn/scripts/build-mapping.ts`.

## In short

1. Make a text file with one verse per line
2. Add the format to `generate/build-mapping-v1-osnb.ts`
3. Run the script to generate the mapping
4. The result lands in `generate/mappings/<id>.json`

## Step 1: prepare the text file

The file must have **one verse per line**, in the format:

```
BookName chapter,verse verse text
```

Example (Bibel 2011):

```
1 Mos 1,1 I begynnelsen skapte Gud himmelen og jorden.
1 Mos 1,2 Jorden var øde og tom, mørke lå over dypet, og Guds ånd svevde over vannet.
...
Åp 22,21 Herren Jesu nåde være med alle!
```

All 31,000+ verses must be present, from Genesis to Revelation.

## Step 2: add the format to the script

Open `generate/build-mapping-v1-osnb.ts` and add an entry to `KNOWN_FORMATS`:

```js
const KNOWN_FORMATS = {
  dnb_2011_nb: { /* ... existing ... */ },

  // New translation:
  myformat: {
    name: 'My translation',
    description: 'A description of the translation',
    lineRegex: /^(.+?)\s+(\d+),(\d+)\s+(.+)$/,
    bookNames: {
      'Gen': 1, 'Exod': 2, // ... all 66 books
      'Rev': 66,
    },
  },
};
```

`lineRegex` must have four groups: (book name) (chapter),(verse) (text).
`bookNames` maps book names as they appear in the file to book ids (1–66).

## Step 3: run the mapping script

```bash
cd generate/

# Step A: run without the LLM first, to see the differences
bun build-mapping-v1-osnb.ts /path/to/file.txt myformat

# Step B: run with the LLM to match the remaining chapters
bun build-mapping-v1-osnb.ts /path/to/file.txt myformat --use-llm
```

Without `--use-llm` the script resolves most differences deterministically
(simple chapter-boundary shifts). With `--use-llm` it uses the Claude API to
match verses in chapters where the differences are more complex.

The LLM matching needs `ANTHROPIC_API_KEY` in `generate/.env`.

## What the script does

1. **Parses** the text file and counts verses per book and chapter
2. **Compares** with the osnb JSON files in `bibles_raw/osnb/`
3. **Deterministic mapping** for:
   - Chapter-boundary shifts between two neighbouring chapters (e.g. Genesis 31–32)
   - Multi-chapter blocks where the total verse count matches (e.g. Job 38–41)
   - Overflow into chapters that do not exist (e.g. Malachi 4 → Malachi 3:19–24)
4. **LLM matching** (with `--use-llm`) for isolated differences where verses are
   not merely shifted but may have been merged or split

## Result format

The mapping is stored as JSON in `generate/mappings/<id>.json`:

```json
{
  "id": "dnb_2011_nb",
  "name": "Det Norske Bibelselskap 2011 Bokmål",
  "description": "The Bible Society's 2011 translation",
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
    { "bookId": 45, "srcRef": "16:25", "reason": "No match in osnb" }
  ]
}
```

- **bookNames**: book names in the source file → internal book id (1–66)
- **verseMap**: `"bookId-srcChapter-srcVerse"` → `"bookId-osnbChapter-osnbVerse"`.
  Verses not in the map have identical numbering.
- **unmapped**: verses in the source that do not exist in osnb (text-critical
  variants, missing data)

## Typical differences

| type | example | explanation |
|------|----------|------------|
| Chapter-boundary shift | Genesis 31:55 → 32:1 | the last verse of a chapter is the first verse of the next in Hebrew |
| Multi-chapter block | Job 38–41 | 4 chapters divided differently internally, but the same in total |
| Chapter split | Malachi 3+4 vs Malachi 3 | Bibel 2011 has Malachi 4:1–6, Hebrew has Malachi 3:19–24 |
| Isolated difference | Numbers 25 | osnb has 19 verses, Bibel 2011 has 18 (verse 19 is absorbed into the next chapter) |
| Text-critical variant | Romans 16:25–27 | the doxology is in some manuscripts but not in the SBLGNT |
| Missing data | Joel 3:6–26 → 4:1–21 | the mapping is ready, but osnb is missing Joel ch 4 |

## Tips

- Always run without `--use-llm` first, to see the extent of the differences
- Most translations have around 50–60 chapters with differences, mostly in the OT
- The NT has very few (often only Romans 16)
- The Bibel 2011 mapping can be used as a reference for other Norwegian
  translations, since most follow the same numbering
