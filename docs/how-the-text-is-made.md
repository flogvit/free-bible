# How the text is made

A Bible translated by a language model invites one question before any other:
can it be trusted? This page is the honest answer — the method, what it catches,
what it does not, and how to check any single verse yourself without taking our
word for anything.

## Where the text comes from

Every verse is translated from the original languages, never from another
translation:

| | source |
|---|---|
| Old Testament | Unicode/XML Leningrad Codex, [tanach.us](https://www.tanach.us) |
| New Testament | [SBLGNT](https://sblgnt.com) (Michael W. Holmes, ed.) |

This matters more than it sounds. An early experiment translated Norwegian into
English with a local model, and on famous verses it reproduced the ESV almost
word for word — the model had memorised a copyrighted translation and handed it
back. Translating from Hebrew and Greek is what keeps the result genuinely free
as well as genuinely independent.

## The unit is the chapter

The model is given a whole chapter, not a verse and not a book.

Sentences almost never cross a chapter boundary, so a chapter contains what a
verse needs to be understood — the pronoun's antecedent, who is speaking, where
the argument started. Verse-by-verse translation produces text that is
defensible line by line and incoherent read aloud. Book-level context does not
fit, and gains nothing a chapter does not already give.

The model is Claude Opus, and each translation has a written style brief. All
four translations here use a spoken-language brief: they are meant to be read
out loud, with natural rhythm, at the cost of some formality.

## Proofreading

After translation, a second pass reviews the chapter against the source. There
are two modes, and the difference is worth knowing because it decides how much
of a given translation has been examined how closely:

- **Batch** sends the chapter for review and gets back only the findings, in a
  feedback loop until the chapter reaches a score threshold or the rounds run
  out. This produced `osnb`, and it is about six times cheaper.
- **Per verse** reviews each verse with its neighbours in two phases, text and
  then footnotes. More thorough, and expensive enough that it has been used on
  very little.

There are also targeted second passes: one re-examines verses whose text became
much shorter than an earlier version, and one re-examines verses already changed.

**A proposed change does not overwrite the old reading.** It is kept in the
verse's `versions[]` list with the reason, so the history of every changed verse
is in the data you download. Entries marked `alternative` are readings a reader
can switch between rather than corrections.

## What is known to be weak

Measured across the four translations, today:

| | verses | footnotes | verses with revision history |
|---|---|---|---|
| `osnb` | 31,167 | 4,321 | 8,732 |
| `osnn` | 31,167 | 98 | 8,444 |
| `osen` | 31,167 | 1,033 | 4,287 |
| `oses` | 31,167 | 0 | 4,097 |

Read that table as a map of where the work is uneven rather than as statistics:

**Footnotes are unevenly present.** `osnb` has 4,321; `osnn` has 98 and `oses`
none at all. A missing footnote does not make the verse wrong, but where `osnb`
tells you a Hebrew word is ambiguous, the nynorsk and Spanish texts pass over it
in silence.

**`oses` has not been fully proofread.** 831 of 1,189 chapters have been through
it, at an average score of 8.86. The remaining 358 chapters have been translated
and not reviewed.

**A specific failure mode has occurred and is now guarded against.** In one
review mode the model would return only the phrase it had been focusing on, and
that phrase replaced the whole verse — 97 verses in `osen` were truncated this
way, including an entire divine speech in Genesis 28:13. The verses were
restored, and a length check now rejects such a suggestion at write time. It is
mentioned here because it is the kind of error that is invisible unless you are
looking for it, and because it argues for reading the source alongside anything
important.

**No human has reviewed the text.** The translations' metadata says so:
`"review": "none"`. Everything above is a model checking a model.

**We do not enforce consistency between chapters.** A Hebrew word rendered one
way in Genesis may be rendered differently in Isaiah. This is deliberate — two
valid renderings are two things a reader can choose between, and a glossary that
forced one of them would remove exactly what this project is for. It does mean
you cannot assume a term is a stable index across the whole text.

## Checking a verse yourself

The point of the project is that you do not have to trust it. For any verse:

1. **Read the original.** `generate/word4word/tanach/` and
   `generate/word4word/sblgnt/` give every Hebrew and Greek word with
   transliteration, grammar and gloss, verse by verse.
2. **Read the revision history.** If the verse has `versions[]`, you can see what
   it said before, what was changed, and the reason given.
3. **Compare with other translations.** Around 80 harvested translations are in
   `generate/bibles_raw/`, and `kvn/` maps verse numbers between them, so the
   comparison lands on the same verse even where the numbering disagrees.

If a comparison convinces you that a rendering is wrong, or that a different
reading is equally defensible, open an issue — see
[CONTRIBUTING.md](../CONTRIBUTING.md). A second defensible reading is usually
added to the verse rather than replacing it.

## What this project is not claiming

It is not claiming to be the correct translation, or a replacement for one made
by scholars over decades. It is claiming something narrower and checkable: that
the text was made from the original languages by a documented method, that where
it was changed the change is recorded, and that everything needed to disagree
with it is in the same download.
