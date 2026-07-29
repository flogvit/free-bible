# Free Bibles

This project strives to give free versions of the Bible in as many languages as possible.

It uses Claude (Anthropic) to translate from already free versions of the Bible.

## Goals

1. Create free Bible translations in multiple languages
2. Create free software for Bible studies that can be run online or on your own computer
3. Generate encyclopedic content: word-for-word translations, cross references, summaries, and more

## Preview

View the current state at: https://bible.flogvit.com

## Bible Source Texts

| Testament | Source | URL |
|-----------|--------|-----|
| Old Testament | Tanach | https://tanach.us |
| New Testament | SBLGNT | https://sblgnt.com |

## Translations

| Code | Language | Status |
|------|----------|--------|
| OSNB1 | Norwegian Bokmål (v1) | CHECKING |
| OSNB | Norwegian Bokmål (v2, oral style) | IN PROGRESS |
| OSNN | Norwegian Nynorsk | IN PROGRESS |

## Features

### Bible Translation
Full Bible translations with two style options:
- **Standard**: Modern, easy to read, theologically correct
- **Oral**: Optimized for reading aloud with natural rhythm and flow

### Chapter Summaries
AI-generated summaries for each chapter in multiple languages.

### Book Summaries
Overview and context for each book of the Bible.

### Word-for-Word Translation
Detailed word-by-word translation from Hebrew (OT) and Greek (NT) with:
- Original word
- Transliteration
- Grammar information
- Translation

### Chapter Context
Historical, literary, and theological context for each chapter.

### Book Context
Background information for each book including author, date, setting, and themes.

### Verse Translation Explanations
Detailed explanations of translation choices for each verse.

### Cross References
Reference lists connecting related verses throughout the Bible. Two complementary scripts:
- `references.mjs` — LLM-knowledge-based (Claude or Ollama generates references from training data)
- `references_semantic.mjs` — Semantic discovery (bge-m3 embeddings + LLM verification finds parallels not in standard cross-reference works)

### Reading Plans
36 different reading plans for Bible study (see Developer section for full list).

### Bible Persons
Encyclopedia of people mentioned in the Bible.

---

## Developer

### Requirements

Node.js 18 or higher:
```bash
nvm use 18
```

Create `.env` file in `generate/` with:
```
ANTHROPIC_API_KEY=your-api-key
```

### Generate Folder Structure

```
generate/
├── bibles_raw/          # Source texts (Tanach, SBLGNT)
├── book_context/        # Generated book context
├── book_summaries/      # Generated book summaries
├── chapter_context/     # Generated chapter context
├── chapter_summaries/   # Generated chapter summaries
├── persons/             # Bible persons encyclopedia
├── proofread/           # Proofread results
├── reading_plans/       # Generated reading plan JSON files (per language: nb/, en/, ...)
├── references/          # Cross references
├── embeddings/          # Cached vector embeddings (per corpus)
├── verse_translation/   # Verse translation explanations
├── word4word/           # Word-for-word translations
├── number_symbolism/    # Biblical number symbolism
└── [scripts]            # Generation scripts
```

### Scripts Overview

| Script | Description |
|--------|-------------|
| `bible.mjs` | Main Bible translation script |
| `chapter_summary.mjs` | Generate chapter summaries |
| `book_summary.mjs` | Generate book summaries |
| `chapter_context.mjs` | Generate chapter context |
| `book_context.mjs` | Generate book context |
| `word4word.mjs` | Generate word-for-word translations |
| `verse_translation.mjs` | Generate verse translation explanations |
| `bible_persons.mjs` | Generate Bible persons encyclopedia |
| `generate_reading_plans.mjs` | Generate reading plans |
| `references.mjs` | Generate cross references (LLM-knowledge based) |
| `references_semantic.mjs` | Semantic cross references via embeddings + LLM verify |
| `number_symbolism.mjs` | Generate and index biblical number symbolism |
| `stories.mjs` | Generate Bible story summaries |
| `scan_stories.mjs` | Systematically scan Bible chapter-by-chapter for missing stories (proposals to `stories_proposed/`) |
| `convert-refs.mjs` | Convert plain-text references to `[ref:...\|...]` markup |
| `translate.mjs` | Translate generated content (summaries, context, insights) from nb to other languages with local Ollama |
| `make_tanach.mjs` | Process Tanach source files |
| `make_sblgnt.mjs` | Process SBLGNT source files |

### Shared Libraries

| File | Description |
|------|-------------|
| `constants.js` | Book definitions, language mappings, model config |
| `lib.js` | Shared utilities: `bookRanges`, `getChaptersForRange()`, `getChaptersForBooks()`, `resolveBookRange()` |
| `llm.js` | Shared LLM module — supports both Claude (Anthropic) and Ollama |
| `embeddings.js` | Reusable embedding library — `buildEmbeddings`, `loadEmbeddings`, `topK`, `embedQuery` (corpus-agnostic; works for verses, songs, etc.) |
| `reading_plans_config.js` | Configuration for all 36 reading plans |

---

## Running Scripts

All scripts are run from the `generate/` directory:
```bash
cd generate
```

### Bible Translation

```bash
# Translate entire NT with oral style
node bible.mjs osnb --style oral --nt

# Translate specific books
node bible.mjs osnb --style oral --book 1-20

# Translate specific chapters
node bible.mjs osnb --book 43 --chapter 1-11

# Translate, proofread, and apply corrections
node bible.mjs osnb --nt --proofread --apply

# Force re-translation
node bible.mjs osnb --book 1 --force
```

**Options:**
- `--style <standard|oral>` - Translation style (default: standard)
- `--ot` / `--nt` - Process Old/New Testament only
- `--book <n|n-m>` - Process specific book(s)
- `--chapter <n|n-m>` - Process specific chapter(s)
- `--proofread` - Run proofreading after translation
- `--apply` - Apply proofread suggestions
- `--force` - Re-translate even if file exists

### Chapter Summaries

```bash
# Generate NT summaries (Norwegian bokmål)
node chapter_summary.mjs --nt

# Generate OT summaries in nynorsk
node chapter_summary.mjs --language nn --ot

# Generate for specific book in English
node chapter_summary.mjs --language en --book 43

# Generate specific chapters
node chapter_summary.mjs --book 43 --chapter 1-11

# Generate, proofread, and apply
node chapter_summary.mjs --nt --proofread --apply
```

### Book Summaries

```bash
# Generate NT book summaries
node book_summary.mjs --nt

# Generate for specific books
node book_summary.mjs --book 1-5

# Generate with proofreading
node book_summary.mjs --nt --proofread --apply
```

### Chapter Context

```bash
# Generate NT chapter context
node chapter_context.mjs --nt

# Generate for specific book/chapters
node chapter_context.mjs --book 1 --chapter 1-11

# With language option
node chapter_context.mjs --language en --book 43
```

### Book Context

```bash
# Generate NT book context
node book_context.mjs --nt

# Generate for specific books
node book_context.mjs --book 1-5
```

### Word-for-Word Translation

```bash
# From Bible translation (uses existing translation)
node word4word.mjs osnb --nt
node word4word.mjs osnb --book 43 --chapter 1 --verse 1-11

# Direct from source texts (generates fresh translation)
node word4word.mjs tanach --ot                    # Hebrew OT → Norwegian
node word4word.mjs tanach --language en --book 1  # Hebrew OT → English
node word4word.mjs sblgnt --nt                    # Greek NT → Norwegian
```

### Verse Translation Explanations

```bash
# Explain translation choices
node verse_translation.mjs osnb --book 1 --chapter 1
node verse_translation.mjs osnb --book 43
node verse_translation.mjs osnb --nt
```

### Bible Persons

```bash
# Generate specific person
node bible_persons.mjs abraham
node bible_persons.mjs "Set (Adams sønn)"

# Generate all persons
node bible_persons.mjs all
```

### Number Symbolism

```bash
# Generate symbolism for a specific number
node number_symbolism.mjs --number 7

# Index entire bible — extract numbers from every verse with Ollama
node number_symbolism.mjs --bible osnb --index

# Index specific book/chapter
node number_symbolism.mjs --bible osnb --index --book 11 --chapter 10

# Proofread existing data
node number_symbolism.mjs --all --proofread --apply
```

### Reading Plans

```bash
# Generate all reading plans
node generate_reading_plans.mjs
```

### Content Translation

`translate.mjs` translates generated content from `<dir>/nb/` to `<dir>/<lang>/` using the local Ollama model (free, ~20-60 s per file). Unlike re-generating per language, translation keeps the content identical across languages.

**Convention:** content is generated in Norwegian (`nb/`) and translated to other languages. For dirs covered by translate.mjs, do not run the generator scripts with `--language en` directly - a generated `en/` file would be untracked by the translation state and overwritten on the next translate run.

Covered dirs (processed in this order; see `CONTENT_DIRS` in the script): `chapter_summaries`, `book_summaries`, `chapter_context`, `book_context`, `chapter_insights`, `days`, `day_tags`, `tags`, `themes`, `timeline`, `stories`, `persons`, `number_symbolism`, `prophecies`, `important_words`, `verse_prayer`, `verse_sermon`, `reading_plans`, `daily_verse`, `gospel_parallels`, and `references` last (10k+ files, plan for multi-day runtime). Handles `.md`, `.json` (structure-validated, machine keys preserved) and `.txt`. Not translated on purpose: internal pipeline artifacts (`proofread_*`, `stories_proposed`, `stories_rejected`).

```bash
# Show status per dir (current / stale / untracked / missing)
node translate.mjs --language en --status

# List what would be translated
node translate.mjs --language en --dry-run

# Translate everything missing or stale
node translate.mjs --language en

# Pilot run: one dir, one book, limited count
node translate.mjs --language en --dirs chapter_summaries --book 43 --limit 10
```

**Change tracking:** the sha256 of each nb source file is recorded in `translate_state/<lang>.json` when translated. If the nb file later changes, the next run marks it `stale` and re-translates it automatically — no manual bookkeeping. Earlier versions (hash, model, timestamp) are kept in a `history` list per file. State is saved after every file, so interrupted runs resume where they left off.

**Key flags:**
- `--language <lang>` — Target language (required); codes or full names from `constants.js`
- `--source <lang>` — Source language code (default: nb)
- `--dirs <a,b,c>` — Restrict to specific content dirs
- `--book <n|n-m>` — Restrict to specific book(s)
- `--limit <n>` — Max files this run (for pilots)
- `--force` — Re-translate even if source is unchanged
- `--status` / `--dry-run` — Inspect without translating

**Quality safeguards:** markdown structure (headings/bullets/bold) is fingerprint-compared against the source and mismatches are logged as warnings in the state file; JSON files are validated for identical structure (keys, array lengths, numbers) and machine values like `"type"` are copied from the source untouched; « » quotes are converted to target-language style deterministically after translation. Bible quotes inside the texts are translated as plain wording — the model is instructed not to reproduce ESV/NIV/KJV phrasing (and since this is original prose, it has no canonical English text to fall back on).

### Semantic Cross References

`references_semantic.mjs` finds cross references via vector search over osnb verse embeddings, then LLM-verifies each candidate. Complements `references.mjs` (which generates from LLM knowledge) by surfacing parallels that don't appear in standard cross-reference works.

**Pipeline:** bge-m3 embeddings + LLM theme summary + LLM concept questions → unique candidate set → qwen3.5:122b verifies each → merged into `references/nb/<book>/<chapter>/<verse>.json`.

**Recommended production command:**
```bash
node references_semantic.mjs --top-k 30 --threshold 0.65 --theme --concepts --resume
```

This config was chosen by evaluating 9 variants on 10 test verses with Claude as independent judge:
- 75% high-quality (≥4/5) accepted, ~5.6 good refs added per verse
- ~14 min per verse on local qwen3.5:122b
- Projection for full osnb (31 167 verses): ~175 000 good refs, ~73 days

**Setup:**
```bash
ollama pull bge-m3
ollama pull qwen3.5:122b   # or already pulled
node references_semantic.mjs --build-only   # one-time: build embeddings (128 MB, ~15 min)
```

**Key flags:**
- `--top-k <n>` — Vector candidates per verse (default 10; tested 30 is sweet spot)
- `--threshold <x>` — Min cosine similarity (default 0.60; 0.65 recommended for bge-m3)
- `--theme` — Add LLM-generated thematic summary as additional embed query
- `--concepts` — Add 4 LLM-generated facet queries (different angles on the verse)
- `--resume` — Skip already-processed verses (tracked in `embeddings/osnb/semantic_progress.json`); essential for multi-day runs that get interrupted
- `--skip-existing` — Skip verses that already have a references file (don't augment manual refs)
- `--book <range>` / `--chapter <range>` / `--verse <range>` — Scope to subset

**Resume behavior:** progress file is updated after each verse completes. Ctrl+C is safe — restart with `--resume` and it picks up from the next unprocessed verse. Delete `embeddings/osnb/semantic_progress.json` to start fresh.

**Known limitations:**
- Prophecy → fulfillment (e.g. Gen 3:15 → Rom 16:20) — fulfillment language is too different from prophetic language for embedding similarity to find it
- Famous short verses (e.g. Ps 23:1) — too little text to embed meaningfully
- For these, fall back to `references.mjs` (LLM-knowledge based)

---

## Local Model (Ollama)

All generation scripts support `--local` to use a local Ollama model instead of Claude:

```bash
node references.mjs --book 43 --chapter 1 --local
node chapter_summary.mjs --nt --local
```

Configuration in `constants.js`:
- `ollamaModel` — default: `qwen3.5:122b`
- `ollamaBaseUrl` — default: `http://localhost:11434`

The `number_symbolism.mjs --index` mode always uses Ollama for verse scanning regardless of `--local`.

---

## Parallel Processing

For faster processing, run multiple instances in separate terminals:

```bash
# Terminal 1
node bible.mjs osnb --book 1-20 &

# Terminal 2
node bible.mjs osnb --book 21-39 &
```

---

## Proofreading Workflow

All main scripts support a three-step workflow:

1. **Generate**: Create initial content
2. **Proofread**: AI reviews and suggests corrections
3. **Apply**: Apply approved corrections

```bash
# All in one command
node bible.mjs osnb --nt --proofread --apply

# Or separately
node bible.mjs osnb --nt
node bible.mjs osnb --nt --proofread
node bible.mjs osnb --nt --apply
```

Proofread results are saved in `proofread/<bible>/<book>/<chapter>.json`.

---

## Reading Plans

36 reading plans organized by category:

**Short (under 35 days):** Peters brev, Påskeplan, Romerbrevet, Bergprekenen, Åpenbaringen, Jesu lignelser, Adventsplan, Johannes' skrifter, Apostlenes gjerninger, Korinterbrevene, Salmene-30, Evangeliene-30, Paulus-brev-30, NT-30, Ordspråkene-31, Visdomslitteratur, De små profetene, Allmenne brev, Bønner i Bibelen

**Medium (35-100 days):** Messianske profetier, Fasteplan, Pinseplan, Jobs bok, Jesu liv kronologisk, Mosebøkene, NT-9-uker, Jesaja, Davidssalmene, Historiske bøker, Profetene, Paulus' brev, Evangeliene

**Long (100+ days):** Salmene-150, Bibelen på ett år, GT på ett år

**Intensive:** Hele Bibelen på 30 dager

### Adding New Reading Plans

Edit `reading_plans_config.js`:

```javascript
{
  id: "my-plan",
  name: "My Reading Plan",
  description: "Description",
  category: "kort",  // kort, middels, tematisk, lang, intensiv
  type: "sequential",  // sequential, distributed, parallel, repeat, custom
  bookRange: "evangelier",  // or: books: [40, 41, 42, 43]
  chaptersPerDay: 2
}
```

Then run:
```bash
node generate_reading_plans.mjs
```

---

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on:

- Reporting bugs
- Suggesting features
- Submitting translation corrections
- Code contributions

## Support

Donations welcome - each translation costs approximately $100, encyclopedias cost more.

## People

**Founder:** Vegard Hanssen (Vegard.Hanssen@menneske.no)

## License

MIT License - Copyright (c) 2023-2025 Vegard Hanssen

See [LICENSE](LICENSE) for details.
