# KVN Redesign: Universal Verse Numbering

## Background

The current KVN system uses osnb (which follows Hebrew/Tanach numbering) as the "basis" coordinate system. Other translations are mapped relative to osnb. This creates problems:

- **Extra verses**: Verses that exist in a translation but not in osnb (e.g., Joel 3:6-26, Rom 16:25-27, Neh 7:68) need special handling as "extraVerses"
- **Collisions**: When two osnb verses map to the same translation verse (e.g., 4 Mos 25:19 + 26:1 → b2011 26:1), the system needs collision detection
- **Basis-centric**: The whole system breaks down if a translation has content that osnb doesn't cover

## Proposed New Approach

Build KVN as a **universal superset** of all verse numbering systems, not tied to any single translation.

### Core Idea

1. Download/collect many Bible translations (Norwegian and others)
2. Analyze all verse numbering schemes across translations
3. Build a KVN coordinate system that is the **union** of all verse positions
4. Each translation then simply declares which KVN positions it has text for

### Benefits

- No more "extra verses" concept - every verse from any translation has a proper KVN coordinate
- No more collisions - each verse position is unique in the KVN space
- Simpler per-translation mapping: just a set of which KVN positions the translation covers, plus any verse number differences
- Adding a new translation is easier - just map its verse numbers to KVN
- More robust and future-proof

### Challenges to Solve

1. **Chapter structure**: Hebrew Joel has 4 chapters (3+4 in some numbering), European has 3. Malaki 3 vs 3+4. Which structure does KVN use? Options:
   - Use the structure with the MOST chapters/verses (superset)
   - Use a neutral numbering that doesn't match any specific tradition
   - Use the Hebrew structure as base but extend it where other traditions have more

2. **Verse splits/merges**: When one translation has 25:19 as a separate verse and another merges it into 26:1:
   - KVN should have BOTH positions (25:19 AND 26:1)
   - Translations that merge them would map both KVN positions to the same verse text
   - Need a way to express "these KVN positions share text in this translation"

3. **Data collection**: Need enough translations to discover all numbering variants. Key sources:
   - Norwegian: osnb, Bibel 2011, NB88, etc.
   - English: KJV, NIV, ESV, NASB (different verse numbering traditions)
   - Hebrew: Tanach/BHS (original Hebrew numbering)
   - Greek: LXX, NA28 (Septuagint and critical text numbering)

4. **Encoding**: Current KVN uses 27 bits: (book << 20) | (chapter << 12) | (verse << 4) | part. This allows:
   - 127 books, 255 chapters, 255 verses, 15 parts
   - Should be sufficient for a universal system
   - The "part" field (4 bits) represents sentence position within a verse - this must NOT be repurposed

5. **Migration**: The existing mapping (dnb_2011_nb.kvn.json) and tests would need updating once the new basis is established.

## Current State (2026-02-11)

### What was completed in this session:
- Rebuilt the dnb_2011_nb.kvn.json mapping from scratch
- **826 map entries** (non-identity verse number differences between osnb and Bibel 2011)
- **25 extra verses** (b2011-only: 1 Neh 7:68, 21 Joel 3:6-26, 3 Rom 16:25-27)
- All verified against actual Bible text content (both osnb and dnb2011_nb.txt)
- All 154 tests passing across 6 test suites

### Mapping patterns discovered:
1. **24 paired chapter boundary shifts** - adjacent chapters where b2011 and osnb split the chapter boundary differently (e.g., Hebrew Exodus 7 has 29 verses while European has 25, with the extra 4 being the start of European chapter 8)
2. **Job 38-41 cascade** - 4-chapter chain where verse counts differ and shifts accumulate across chapters (91 map entries)
3. **Within-chapter shifts** - Neh 7 (+1 from v68), 1 Krøn 12 (-1 from v5), Dan 10 (-1 from v19) - caused by verse merge/split differences
4. **Cross-chapter collision** - 4 Mos 25:19 → b2011 26:1 (osnb has a short verse that b2011 merges into the next chapter's first verse)
5. **Genuine extras** - Joel 3:6-26 (Hebrew tradition only has 5 verses in Joel 3), Rom 16:25-27 (doxology not in all traditions), Neh 7:68 (horses/mules verse not in Hebrew)

### Key files:
- `kvn/mappings/dnb_2011_nb.kvn.json` - The corrected mapping file
- `kvn/src/kvn.ts` - KVNConverter class (toTkvn, toKvn, isExtra, isCollision, etc.)
- `kvn/src/types.ts` - encode/decode, BOOK_IDS, BOOK_NAMES, type definitions
- `kvn/data/test-references.json` - Curated test cases
- `external/closed/dnb2011_nb.txt` - Bibel 2011 source text
- `generate/bibles_raw/osnb/` - osnb verse data (JSON per chapter)
- `generate/bibles_raw/tanach/` - Hebrew Tanach text

### Known issue:
- `toSortableKvn` function misuses the part bits to sort extra verses. The part field is for sentence number within a verse and must NOT be repurposed. This function needs redesign or removal.

## Next Steps

1. Decide on the universal KVN approach vs keeping osnb as basis
2. If universal: collect multiple translations and analyze all verse numbering variants
3. Design the universal KVN coordinate system (chapter structure, verse positions)
4. Build mappings from each translation to the universal KVN
5. Update the codebase to use the new system
