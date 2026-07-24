# Open Bibles — license inventory

Translations we are allowed to publish, with their license. Source of truth: **`inventory.json`** (and `inventory.csv`).

## Summary

90 translations across 50 languages are cleared for publishing:

| Tier | Count | License | Usage |
|------|------:|---------|-------|
| **A** | 83 | Public Domain (66), CC BY-SA (16), CC BY (1) | Publish + KVN renumbering. CC requires attribution; CC BY-SA output stays BY-SA. |
| **B** | 7 | CC BY-ND | Publish verbatim + reformat OK. KVN **renumbering is a legal grey area** (NoDerivatives) — keep original numbering canonical, KVN as optional overlay only. |

These 90 are exact code-matches against catalogs that publish per-translation license text
(BibleSuperSearch, openbible.com, eBible.org). Classification is driven by the **license
statement text**, not BSS's `copyright` flag — that flag is unreliable (e.g. the NET Bible has
`copyright=0` but reads "© … used with permission" and is therefore **excluded**).

## Not in this list

- **14 excluded** — confirmed copyrighted / permission-only (NET Bible, NVI, several national
  Bible-society editions).
- **1041 unmatched** — the bulk of the downloaded collection. Their descriptive module names
  (`afrikaans1983`, `spanish_nvi`, `amharic_dawro_dfblvl`) don't match catalog codes, so their
  license is unverified. At least 289 are clearly modern (year ≥ 1950) and copyright-risky.
  **None may be published until individually verified** — tracked as a separate license-audit task.

## Columns

| Column | Meaning |
|--------|---------|
| `module` | local module id (matches `external/closed/raw/<module>/`) |
| `name`, `language` | translation title and language |
| `license` | Public Domain / CC BY / CC BY-SA / CC BY-ND |
| `tier` | A (free incl. KVN) or B (verbatim, KVN uncertain) |
| `kvn_ok` | whether KVN verse-renumbering is safe under the license |
| `attribution` | whether attribution is required (all CC) |
| `source` | catalog the license was confirmed from |
