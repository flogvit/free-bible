# Removed translations — data quality

These translations were **removed from `generate/bibles_raw/`** because their source data
(from the original BSS/openbible download) is missing content or corrupt. The uploaded
`external/closed/raw/<translation>/` sources are kept (gitignored), so any of these can be
**reinstated after re-downloading from a clean source** (e.g. eBible.org) and passing the
integrity check.

Detection: a full scan for (a) duplicated verse IDs within a chapter, (b) fully-empty
chapters, and (c) empty Old-Testament verses (the OT has no textual-variant omissions, so a
blank OT verse is a real gap; blank NT verses at the ~16 known textual-variant locations are
benign and were **not** grounds for removal).

## Severe (corruption / whole chapters / large gaps)

| Translation | Name | Language | License | Issue |
|--------|------|----------|---------|-------|
| `afri` | Afrikaans 1953 | Afrikaans | Public Domain | 4 chapters with duplicated verses (corrupt) |
| `ta_oitce` | திறந்தநிலை தமிழ் சமகால பதிப்பு | Tamil | CC BY-SA | 1 chapters with duplicated verses (corrupt) |
| `luther` | Luther Bible (1545) | German | Public Domain | 21 fully-empty chapters; 624 empty OT verses |
| `ug_ara` | مۇقېددېس‭ ‬كالام (‭‬يەنگى‭ ‬يېزىق‭ ‬ ) | Uighur, Uyghur | CC BY-SA | 3 fully-empty chapters; 172 empty OT verses |
| `korean` | Korean | Korean | Public Domain | 2 fully-empty chapters; 136 empty OT verses |
| `karoli` | Karoli | Hungarian | Public Domain | 35 empty OT verses |
| `polbg` | Polska Biblia Gdanska | Polish | Public Domain | 25 empty OT verses |
| `stve` | Staten Vertaling | Dutch | Public Domain | 21 empty OT verses |
| `bkr` | Bible Kralicka | Czech | Public Domain | 20 empty OT verses |

## Minor (a few scattered OT gaps — reinstate once filled)

| Translation | Name | Language | License | Issue |
|--------|------|----------|---------|-------|
| `bishops` | Bishops Bible | English | Public Domain | 6 empty OT verses |
| `blivre` | Biblia Livre | Portuguese | CC BY | 2 empty OT verses |
| `ne_ulb` | अनलक शाब्दिक बाइबल | Nepali | CC BY-SA | 2 empty OT verses |
| `turkish` | Turkish | Turkish | Public Domain | 1 empty OT verses |

## Kept despite blank verses (benign)

`chinese_union_simp`, `chinese_union_trad`, `tr`, `trparsed`, `opt` — one blank NT
textual-variant verse each; no missing content.

_13 translations removed; 70 remain published._
