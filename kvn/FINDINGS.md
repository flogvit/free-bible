# Findings from the mapping review (July 2026)

This is an overview of the **problems that were found**, not a log of the work.
The purpose is that the next person recognises the classes of error and knows
which ones are still open.

The starting point was the round-trip check
`scripts/check-osmain-roundtrip.py`: translation → osmain → back. It went from
36,896 failing verses and 329 clean translations to **1 failing verse and 1,157
of 1,158 clean**.

## The most important caveat

**The round-trip check measures numbers, not text.** A mapping that is bijective
passes even when it points at the wrong verse. Several of the worst errors found
were invisible to it:

- `norwegian1938` had `Acts 4:2 → 4,32` and `4:17 → 4,2` — plain confusion, which
  passed the check comfortably.
- `basque` Psalm 110 pointed at osmain 110, but that translation's Psalm 110 is
  osmain 111. Four psalms in it were tied to the wrong chapter.
- `albanian` Revelation 1–12 sits one verse low throughout. None of it shows in
  the check.

So "1,157 of 1,158 clean" means the *numbers* add up, not that all text has been
verified. What has been read has been read; the rest is not ruled out.

## 1. Errors in osmain's own data

osmain is Norwegian bokmål in **European** versification. It should sit as close
to the majority of translations as possible — that is the whole reason it
exists, since every deviation costs entries in 1,158 mapping files.

### 1a. Rotated chapters (16 of them)

Hebrew content had been rotated onto European verse numbers. `osmain Exodus 8:1`
was KJV 8:5; `Isaiah 9:1` was KJV 9:2; `Job 41:1` was KJV 41:9.

| chapter | shift | chapter | shift |
|---|---|---|---|
| Exodus 8 | 4 | Ecclesiastes 5 | 1 |
| Exodus 22 | 1 | Isaiah 9 | 1 |
| Leviticus 6 | 7 | Jeremiah 9 | 1 |
| Deuteronomy 29 | 1 | Ezekiel 20:45–21:32 | 5 |
| 2 Chronicles 2 | 1 | Daniel 4 | 3 |
| 2 Chronicles 14 | 1 | Micah 5 | 1 |
| Nehemiah 4 | 6 | 1 Chronicles 6 | 15 |
| Job 41 | 8 | | |

All were read against `kjv` verse by verse and put into European order. The
consequence was that **190,300 mapping entries could be deleted** — the European
translations need no entries at all once osmain sits correctly.

**The diagnostic that works:** a mapping within one chapter must preserve order.
A genuine versification difference is always order-preserving, so a non-monotone
chapter means osmain itself is rotated. That identified all 13 remaining cases at
once.

**The trap:** an earlier round of such corrections was rolled back, on the
grounds that "the mappings encode osmain's actual layout". That is the wrong
inference. That 600+ translations have a rotation block in the same chapter is
the *symptom*, not the authority.

### 1b. Duplicated text (five verses)

The surest sign of an error in osmain is two verses with identical text.

| verse | contained | should be |
|---|---|---|
| 2 Kings 11:21 | 12:21 again | "Joash was seven years old when he became king" |
| Deuteronomy 12:32 | 13:18 again | "Everything I command you, you shall keep and do" |
| 1 Samuel 23:29 | 24:22 again | "David went up from there … at En-gedi" |
| Song of Songs 6:13 | 7:13 again | "Return, return, O Shulammite!" |
| Numbers 25:18 | had "After the plague" attached; it belongs to 26:1 | |

### 1c. Missing text

- `1 Samuel 20:42` was missing its second half ("Then he rose and departed, and
  Jonathan went into the city"), which osnb has as 21:1.
- `Psalm 54:1` was missing the first title line.
- Twenty psalms were missing their last verse (Psalm 5:13 / 9:21 / 18:51 / … /
  140:14), as was 1 Chronicles 12:41.

### 1d. Psalm titles (ten psalms)

Psalms 13, 34, 40, 51, 54, 56, 58, 60, 61 and 63 had the title standing alone as
verse 1, and to keep the verse count one verse further down carried two KJV
verses. The other 144 psalms had the title folded into v1, as European numbering
requires.

Fixing this meant **4,160 translation psalms need no entries at all**, and 1,008
get the ordinary Hebrew shift.

## 2. Errors in the translations' source data

These **cannot** be fixed with mapping entries. They carry `derived.dataWarning`
in their own mapping file and are listed in `data/data-quality-findings.json`.

| translation | problem |
|---|---|
| `ukrainian2004` | Psalm 73 is missing from the harvest; from chapter 72 onwards everything is two out rather than one. Confirmed on psalm titles: ch 72 = Psalm 74, ch 75 = Psalm 77, ch 76 = Psalm 78 (72 verses). The psalm mapping has been removed. |
| `lithuanian_kj` | The psalms are mis-assembled in the source data (ch 22 = Psalm 16, ch 23 = Psalm 17, ch 51 = Psalm 50). Pre-existing. |
| `albanian` | 3 John, Jude and Revelation 1–12 are shifted across the book boundaries. That translation's 3 John 1:14 **is** Jude 1:1, and its Jude 1:25 is Revelation 1:1. Revelation 13–22 are correct — the shift resolves itself because Albanian Revelation 12 has 17 verses against osmain's 18. |

`albanian 3 John 1:14` is the one verse that still fails the round trip, and it
cannot be solved in the mapping: the verse belongs to a different book, and KVN
has no cross-book entries.

### Other data phenomena that are not mapping errors

- **`***` as a placeholder** for verses the harvest did not get. 65 occurrences in
  `english_darby` alone, and in many other translations. They have no counterpart
  in osmain.
- **Translations carrying both numberings.** The `kvn` reference text,
  `armenian_nea`, `italian` and four Lithuanian ones have the boundary verse
  present both as the last verse of one chapter and the first of the next. For
  the reference text that is deliberate. Solved with sub-verses `a`/`b` so that
  both addresses resolve to the same osmain verse.
- **Abridged editions.** `arabic2023` Ezra 2 has 16 verses against osmain's 70 —
  its 2:3 holds osmain 2:3–5 in a single verse.

## 3. Classes of error in the mappings

| class | signature | example |
|---|---|---|
| Junk entries | point at an unrelated verse | `latvian2012`: `Numbers 16:23 → 15,1` |
| Non-monotone mapping | breaks the order within a chapter | `norwegian1938`: `Acts 4:17 → 4,2` |
| Duplicated `kvnFrom` | one osmain verse with two targets — leaves no way back | `burmese2021`: `1 Chronicles 5:3` three times |
| Missing boundary entry | the translation's first verse belongs to the previous chapter | `kvn`: 14 Hebrew chapter boundaries |
| Missing sub-verse | the translation splits or merges an osmain verse | `spanish`: Judges 14:18 split in two |
| Wrong chapter link | an LXX translation tied to its own number | `basque`: Psalm 110 against osmain 110 |
| Stale after an osmain fix | the entries encoded the old layout | `vietnamese_vie`: all of Job 41 eight verses out |

## 4. Diagnostics that work — and that do not

**Work:**

- **Duplicated text in osmain** — the surest sign of a wrong verse.
- **A break in order within a chapter** — the surest sign of rotation.
- **The last verse number, not the count**, separates a gap in the harvest from a
  Hebrew shift. A translation with 28 verses in Deuteronomy 29 could be either;
  `max(verseId)` decides. 115 translation chapters had been given a shift they
  should not have had before this was separated out.
- **Verse structure identical to osmain ⇒ identity.** 942 translation chapters
  had entries shifting a chapter that was identical to osmain.
- **Psalm titles and proper names** to decide chapter linkage in languages you do
  not read. "Of Solomon", "Jeduthun/Asaph", "Bethlehem Ephrathah" are
  unambiguous.

**Do not work:**

- **Automatic chapter alignment on verse counts.** A dynamic-programming
  alignment of the whole psalter against osmain was tried on the 34 translations
  that failed there; the cost came out between 25 and 142 for every one of them,
  and it was rejected for all. Translations with gaps in the harvest do not have
  a verse-count profile that can be matched.
- **Choosing the chapter linkage by what makes the round trip add up.** Tried and
  rolled back. The check only sees numbers, so it accepts any arbitrary choice
  that is bijective. Chapter linkage has to be decided on text.
- **`scripts/align-chapters.py` and `map-linear-books.py`** — both marked NOT IN
  USE with reasons in their own docstrings. `map-linear-books.py` produced
  "Numbers 16:23 → 15,1" in 70,343 entries.

## 5. Still open

- **`albanian` books 64–66 must be re-harvested.** One verse fails the round trip;
  all of Revelation 1–12 is shifted without the check seeing it.
- **`ukrainian2004` and `lithuanian_kj` must be re-harvested** before their psalms
  can be mapped.
- **3 John 1:1–2 are missing entirely** from `albanian` — they are not in the
  corpus.
- **Semantic verification is not exhaustive.** The class "bijective but pointing
  at the wrong verse" was found by reading the translations that failed on
  numbers. The 1,157 clean translations have not been read through. The
  order-break check in section 4 is the cheapest way to keep looking.

## See also

- `README.md` — how KVN works, the Type A/B/C psalm deviations, the `part` and
  `order` fields.
- `BOUNDARY-VERSE-ISSUES.md` — the original description of the boundary verses.
  The 16 rotated chapters in section 1a are now fixed.
- `data/data-quality-findings.json` — a machine-readable list of source-data
  findings.
- `data/alignment-verdicts.json` — text-verified verdicts, with a regression test.
