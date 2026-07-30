# Open Bibles — license inventory

Translations we are allowed to publish, with their license. Source of truth: **`inventory.json`** (and `inventory.csv`).

## Summary

70 translations across 35 languages are published — all commercially usable
(Public Domain or CC BY-SA with attribution):

| Count | License | Usage |
|------:|---------|-------|
| 57 | Public Domain | No restrictions. |
| 13 | CC BY-SA | Attribution required; derived/combined output stays CC BY-SA. |

66 of the 70 have a KVN mapping; the other 4 (`wlc`, `oster`, `martin`, `rv_1909_strongs`)
have Psalm-title / Hebrew versification differences and are pending. A further **13
translations were removed for data-quality problems** (corrupt or missing content) — see
[`DATA-QUALITY.md`](DATA-QUALITY.md).

All 70 allow commercial use and KVN renumbering. Each translation directory carries a
`license.json` with the full statement and terms. These are exact code-matches against catalogs
that publish per-translation license text (BibleSuperSearch, openbible.com, eBible.org).
Classification is driven by the **license statement text**, not BSS's `copyright` flag — that
flag is unreliable (e.g. the NET Bible has `copyright=0` but reads "© … used with permission").

## Not in this list

- **7 CC BY-NC-ND** — matched and free-ish, but **NonCommercial + NoDerivatives**: incompatible
  with a freemium/commercial platform. Excluded (`jv_jvn`, `so_jimale`, `tg_tgk`, `bo_ntb`,
  `ur_geo`, `wo_kyg`, `wo_wol_nt_2010`).
- **14 excluded** — confirmed copyrighted / permission-only (NET Bible, NVI, several national
  Bible-society editions).
- **1041 unmatched** — the bulk of the downloaded collection. Their descriptive translation names
  (`afrikaans1983`, `spanish_nvi`, `amharic_dawro_dfblvl`) don't match catalog codes, so their
  license is unverified. At least 289 are clearly modern (year ≥ 1950) and copyright-risky.
  **None may be published until individually verified** — tracked as a separate license-audit task.

## Columns

| Column | Meaning |
|--------|---------|
| `translation` | local translation id (matches `generate/bibles_raw/<translation>/`) |
| `name`, `language` | translation title and language |
| `license` | Public Domain / CC BY / CC BY-SA |
| `attribution` | whether attribution is required (all CC) |
| `kvn_ok` | whether KVN verse-renumbering is allowed (true for all 83) |
| `status`, `raw_added`, `kvn_mapping` | per-translation progress trackers |
| `source` | catalog the license was confirmed from |

Each translation directory also contains a `license.json` with the full license statement.
