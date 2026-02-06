# Free Bibles

This project strives to give free versions of the Bible in as many languages as possible.

It uses Claude (Anthropic) to translate from already free versions of the Bible.

## Goals

1. Create free Bible translations in multiple languages
2. Create free software for Bible studies that can be run online or on your own computer
3. Generate encyclopedic content: word-for-word translations, cross references, summaries, and more

## Preview

View the current state at: https://bibel.flogvit.no

## Bible Source Texts

| Testament | Source | URL |
|-----------|--------|-----|
| Old Testament | Tanach | https://tanach.us |
| New Testament | SBLGNT | https://sblgnt.com |

## Translations

| Code | Language | Status |
|------|----------|--------|
| OSNB1 | Norwegian Bokmål (v1) | CHECKING |
| OSNB2 | Norwegian Bokmål (v2, oral style) | IN PROGRESS |
| OSNN1 | Norwegian Nynorsk | IN PROGRESS |

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
Reference lists connecting related verses throughout the Bible.

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
├── reading_plans/       # Generated reading plan JSON files
├── references/          # Cross references
├── verse_translation/   # Verse translation explanations
├── word4word/           # Word-for-word translations
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
| `references.mjs` | Generate cross references |
| `make_tanach.mjs` | Process Tanach source files |
| `make_sblgnt.mjs` | Process SBLGNT source files |

### Shared Libraries

| File | Description |
|------|-------------|
| `constants.js` | Book definitions, language mappings, model config |
| `lib.js` | Shared utilities: `bookRanges`, `getChaptersForRange()`, `getChaptersForBooks()`, `resolveBookRange()` |
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
node bible.mjs osnb2 --style oral --nt

# Translate specific books
node bible.mjs osnb2 --style oral --book 1-20

# Translate specific chapters
node bible.mjs osnb2 --book 43 --chapter 1-11

# Translate, proofread, and apply corrections
node bible.mjs osnb2 --nt --proofread --apply

# Force re-translation
node bible.mjs osnb2 --book 1 --force
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
node word4word.mjs osnb2 --nt
node word4word.mjs osnb2 --book 43 --chapter 1 --verse 1-11

# Direct from source texts (generates fresh translation)
node word4word.mjs tanach --ot                    # Hebrew OT → Norwegian
node word4word.mjs tanach --language en --book 1  # Hebrew OT → English
node word4word.mjs sblgnt --nt                    # Greek NT → Norwegian
```

### Verse Translation Explanations

```bash
# Explain translation choices
node verse_translation.mjs osnb2 --book 1 --chapter 1
node verse_translation.mjs osnb2 --book 43
node verse_translation.mjs osnb2 --nt
```

### Bible Persons

```bash
# Generate specific person
node bible_persons.mjs abraham
node bible_persons.mjs "Set (Adams sønn)"

# Generate all persons
node bible_persons.mjs all
```

### Reading Plans

```bash
# Generate all reading plans
node generate_reading_plans.mjs
```

---

## Parallel Processing

For faster processing, run multiple instances in separate terminals:

```bash
# Terminal 1
node bible.mjs osnb2 --book 1-20 &

# Terminal 2
node bible.mjs osnb2 --book 21-39 &
```

---

## Proofreading Workflow

All main scripts support a three-step workflow:

1. **Generate**: Create initial content
2. **Proofread**: AI reviews and suggests corrections
3. **Apply**: Apply approved corrections

```bash
# All in one command
node bible.mjs osnb2 --nt --proofread --apply

# Or separately
node bible.mjs osnb2 --nt
node bible.mjs osnb2 --nt --proofread
node bible.mjs osnb2 --nt --apply
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
