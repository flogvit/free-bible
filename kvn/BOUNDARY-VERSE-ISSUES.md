# Osmain boundary verse issues

> **Status July 2026:** the 16 rotated chapters (Type 2 below) have been fixed,
> and osmain now sits in European order in all of them. See `FINDINGS.md` for the
> full overview of what was found.
>
> Two claims below did not hold: **the mapping files were not correct** for the
> versification differences — 190,300 entries encoded osmain's rotation and could
> be deleted once it was fixed — and **osmain's verse counts were not uniformly
> correct**: five verses had duplicated text and several were missing content.

## The problem

osmain has more verses than osnb in about 60 chapters. The extra verses are at
the chapter boundaries — where the majority of translations place a verse in a
different chapter from the Hebrew/Greek numbering.

**Many of these extra verses have the WRONG text.** When osmain was built, the
text for the boundary verses was often taken from the wrong place. The result is
that osmain has, for example, text from Exodus 9:3 where it should have what the
KJV has as Exodus 8:30.

## What went wrong

osmain was built from osnb with renumbering. For the verses that change chapter
between Hebrew and European numbering, the text is needed from osnb's
neighbouring chapter. But the build script copied the wrong verse in many cases.

## What is NOT wrong

- The **verse counts** in osmain are correct (verified against 1,148 translations)
- **osnb** and **osnn** are correct (1:1 with tanach/sblgnt)
- The **mapping files** (`.ukvn.json`) are correct for the versification
  differences

## Types of boundary verse

There are two distinct patterns for how boundary verses behave:

### Type 1: sequential shift

osnb ch N+1 v1 → osmain ch N's last verse.
Example: Jonah 1:17 in osmain = osnb Jonah 2:1 ("The LORD had a great fish
swallow Jonah").

### Type 2: wrap-around

The verses in the osmain chapter are rearranged relative to osnb.
Example: Exodus 8:29-32 in osmain. Here osmain follows a numbering in which
Hebrew 7:26-29 (= "let my people go", and so on) is placed at the end of chapter
8, while osnb has them as 8:1-4. The correct text for osmain 8:29-32 is therefore
NOT osnb 9:1-4 but osnb 8:1-4 — a wrap-around within the chapter.

## How to fix it

Every verse has to be checked by hand against:

1. **KJV**, which follows the same numbering as osmain in most cases
2. **tanach/sblgnt**, the original text, which defines what the content actually is
3. **osnb**, to find the correct Norwegian rendering of the correct verse

**Do NOT use a script.** The script we tried assumed everything was Type 1, and
many are Type 2.

## Full list of verses with wrong text

133 boundary verses in total, 131 with text that does not match osnb's next
chapter. Some of those 131 may already have the right text (Type 2, where the
text is correctly taken from elsewhere), but all should be verified.

### Genesis
- 31:55 — has the sinew text (a duplicate of 32:32); should be Laban's departure

### Exodus
- 8:30-32 — has frog text from ch 8; should have what the KJV has for 8:30-32
- 22:31 — has "steals an ox" (= 22:1 in the other numbering); should have "holy men"

### Leviticus
- 6:24-30 — has guilt-offering text from elsewhere; should have the law of the guilt offering (KJV 7:1-7)

### Numbers
- 16:36-50 — has the Aaron's-staff text (ch 17); should have the plague/atonement text (KJV 16:49-17:13)
- 29:40 — wrong text

### Deuteronomy
- 12:32 — has "listen to the LORD" from ch 13; should have "everything I command" (KJV 12:32)
- 22:30 — has "your neighbour's grainfield" from 23:25; should have "father's wife" (KJV 22:30)
- 29:29 — has covenant words from 29:1; should have blessing/curse (KJV 30:1)

### 1 Samuel
- 23:29 — wrong text

### 2 Samuel
- 18:33 — wrong text

### 1 Kings
- 4:21-34 — 14 verses with wrong text (has ch 5 text; should have Solomon's wisdom and realm)

### 2 Kings
- 11:21 — wrong text

### 1 Chronicles
- 6:67-81 — 15 verses of duplicated text (repeats the Levi genealogy); should have ch 7 text

### 2 Chronicles
- 2:18 — wrong text
- 14:15 — wrong text

### Nehemiah
- 4:18-23 — 6 verses with wrong text
- 7:73 — wrong text
- 9:38 — wrong text

### Job
- 41:27-34 — 8 verses with wrong text (has the Leviathan continuation; should have Job's answer / God's speech)

### Ecclesiastes
- 5:20 — wrong text

### Song of Songs
- 6:13 — wrong text

### Isaiah
- 9:21 — wrong text
- 64:12 — wrong text

### Jeremiah
- 9:26 — wrong text

### Ezekiel
- 20:45-49 — 5 verses with wrong text

### Daniel
- 4:35-37 — 3 verses with wrong text
- 5:31 — wrong text

### Hosea
- 1:10-11 — wrong text
- 11:12 — wrong text
- 13:16 — wrong text

### Joel
- 2:28-30, 2:32 — 4 verses with wrong text (duplicates of Joel 3:1-5)
- 3:6-21 — 16 verses (all of Joel ch 4 in Hebrew numbering)

### Jonah
- 1:17 — has "the fish vomited Jonah" (a duplicate of 2:10); should have "the fish swallowed Jonah"

### Micah
- 5:15 — wrong text

### Nahum
- 1:15 — wrong text

### Zechariah
- 1:18-21 — 4 verses with wrong text

### Acts
- 19:41 — wrong text

### Romans
- 16:25-27 — the doxology (may be correct, but should be verified)

### 2 Corinthians
- 13:14 — a duplicate of 13:13
