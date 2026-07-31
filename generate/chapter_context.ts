import dotenv from 'dotenv'
import * as fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config()

import {books, normalizeLanguage, getLanguageCode, getBookName} from "./constants.js";
import {callWithRetry} from "./llm.js";
import type {Chapter} from '../kvn/src/bible-types.js';

let useLocal = false;

/**
 * Én funn-post fra korrekturen, slik `PROOFREAD_CONTEXT_SCHEMA` under krever.
 * Enum-verdiene er duplisert med vilje: JSON-skjemaet er avtalen med modellen,
 * typen er den samme avtalen for kompilatoren.
 */
interface ProofreadIssue {
    type: 'error' | 'suggestion' | 'factual' | 'grammar' | 'scope' | 'redundant';
    severity: 'critical' | 'major' | 'minor';
    current: string;
    suggested: string;
    explanation: string;
}

/** Svaret fra korrekturkallet — samme form som `PROOFREAD_CONTEXT_SCHEMA`. */
interface ProofreadContextResult {
    issues: ProofreadIssue[];
    summary: string;
    score: number;
    revisedContext: string;
}

/** Flaggene `parseArgs` under kjenner. */
interface Options {
    language: string;
    proofread: boolean;
    apply: boolean;
    ot: boolean;
    nt: boolean;
    bookStart: number | null;
    bookEnd: number | null;
    chapterStart: number | null;
    chapterEnd: number | null;
    force: boolean;
    help: boolean;
    /**
     * Valgfritt fordi feltet ikke står i initialiseringen: det finnes bare når
     * brukeren faktisk sender `--local`. Typen beskriver den oppførselen slik
     * den er i dag, den endrer den ikke.
     */
    local?: boolean;
}

const PROOFREAD_CONTEXT_SCHEMA = {
    type: "object",
    properties: {
        issues: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    type: {type: "string", enum: ["error", "suggestion", "factual", "grammar", "scope", "redundant"]},
                    severity: {type: "string", enum: ["critical", "major", "minor"]},
                    current: {type: "string"},
                    suggested: {type: "string"},
                    explanation: {type: "string"}
                },
                required: ["type", "severity", "current", "suggested", "explanation"],
                additionalProperties: false
            }
        },
        summary: {type: "string"},
        score: {type: "integer"},
        revisedContext: {type: "string"}
    },
    required: ["issues", "summary", "score", "revisedContext"],
    additionalProperties: false
};

// Get original source based on book ID
function getOriginalSource(bookId: number): string {
    return bookId <= 39 ? 'hebrew' : 'sblgnt';
}

// Read original chapter text from bibles_raw
function readOriginalChapter(bookId: number, chapterId: number): string | null {
    const source = getOriginalSource(bookId);
    const sourceFile = path.join(__dirname, `bibles_raw/${source}/${bookId}/${chapterId}.json`);

    if (!fs.existsSync(sourceFile)) {
        console.error(`Original source not found: ${sourceFile}`);
        return null;
    }

    const verses: Chapter = JSON.parse(fs.readFileSync(sourceFile, 'utf-8'));
    return verses.map(v => `${v.verseId}: ${v.text}`).join('\n');
}

// Read book-level context if it exists
function readBookContext(language: string, bookId: number): string | null {
    const langCode = getLanguageCode(language);
    const bookContextFile = path.join(__dirname, `book_context/${langCode}/${bookId}.md`);

    if (fs.existsSync(bookContextFile)) {
        return fs.readFileSync(bookContextFile, 'utf-8');
    }
    return null;
}

// Get chapter context generation prompt
function getContextPrompt(language: string, bookId: number, chapter: number, originalText: string, bookContext: string | null): string {
    const bookName = getBookName(bookId, language);
    const bibleRef = `${bookName} ${chapter}`;
    const langCode = getLanguageCode(language);
    const originalLanguage = bookId <= 39 ? 'hebraisk' : 'gresk';
    const originalLanguageEn = bookId <= 39 ? 'Hebrew' : 'Greek';

    const bookContextNote = bookContext
        ? `\n\nMerk: Generell bok-kontekst finnes allerede separat og inkluderer historisk ramme, litterær kontekst og kulturell bakgrunn for hele boken. Du skal IKKE gjenta denne informasjonen. Fokuser KUN på det som er spesifikt for dette kapittelet.`
        : '';

    const bookContextNoteNn = bookContext
        ? `\n\nMerk: Generell bok-kontekst finst allereie separat og inkluderer historisk ramme, litterær kontekst og kulturell bakgrunn for heile boka. Du skal IKKJE gjenta denne informasjonen. Fokuser KUN på det som er spesifikt for dette kapitlet.`
        : '';

    const bookContextNoteEn = bookContext
        ? `\n\nNote: General book-level context already exists separately and includes historical framework, literary context and cultural background for the entire book. Do NOT repeat this information. Focus ONLY on what is specific to this chapter.`
        : '';

    const structureNb = `Skriv kapittel-spesifikk historisk og kulturell kontekst for ${bibleRef} på norsk, bokmål.${bookContextNote}

VIKTIG: Inkluder KUN seksjoner som har relevant innhold for dette kapittelet. Hvis en seksjon ikke har kapittel-spesifikk informasjon, utelat den helt.

Mulige seksjoner (inkluder kun de som er relevante):

## Personer
Hvis kapittelet introduserer eller fokuserer på spesifikke personer:
- Hvem er de og hva er deres rolle?
- Historisk/arkeologisk informasjon om disse personene (hvis tilgjengelig)

## Steder
Hvis kapittelet nevner spesifikke steder:
- Geografisk informasjon og lokalisering
- Arkeologiske funn på stedet (hvis relevant)
- Stedets betydning i konteksten

## Hendelser og skikker
Hvis kapittelet beskriver spesifikke ritualer, lover, skikker eller hendelser:
- Kulturell bakgrunn og forklaring
- Paralleller i omkringliggende kulturer

## Nøkkelbegreper
Hvis kapittelet inneholder ord, uttrykk eller konsepter som trenger forklaring:
- Hebraiske/greske ord med spesiell betydning
- Kulturelle konsepter som kan være fremmede for moderne lesere

## Kapittel-spesifikke funn
Hvis det finnes arkeologiske funn eller historiske kilder som belyser akkurat dette kapittelets innhold:
- Beskriv funnet og hvordan det er relevant

Vær konkret og faktabasert. Skriv 1-2 avsnitt per seksjon du inkluderer.`;

    const structureNn = `Skriv kapittel-spesifikk historisk og kulturell kontekst for ${bibleRef} på norsk, nynorsk.${bookContextNoteNn}

VIKTIG: Inkluder KUN seksjonar som har relevant innhald for dette kapitlet. Dersom ein seksjon ikkje har kapittel-spesifikk informasjon, utelat han heilt.

Moglege seksjonar (inkluder berre dei som er relevante):

## Personar
Dersom kapitlet introduserer eller fokuserer på spesifikke personar:
- Kven er dei og kva er rolla deira?
- Historisk/arkeologisk informasjon om desse personane (om tilgjengeleg)

## Stader
Dersom kapitlet nemner spesifikke stader:
- Geografisk informasjon og lokalisering
- Arkeologiske funn på staden (om relevant)
- Staden si tyding i konteksten

## Hendingar og skikkar
Dersom kapitlet skildrar spesifikke ritual, lover, skikkar eller hendingar:
- Kulturell bakgrunn og forklaring
- Parallellar i omkringliggjande kulturar

## Nøkkelomgrep
Dersom kapitlet inneheld ord, uttrykk eller konsept som treng forklaring:
- Hebraiske/greske ord med spesiell tyding
- Kulturelle konsept som kan vere framande for moderne lesarar

## Kapittel-spesifikke funn
Dersom det finst arkeologiske funn eller historiske kjelder som kastar lys over akkurat dette kapitlet sitt innhald:
- Beskriv funnet og korleis det er relevant

Ver konkret og faktabasert. Skriv 1-2 avsnitt per seksjon du inkluderer.`;

    const structureEn = `Write chapter-specific historical and cultural context for ${bibleRef} in English.${bookContextNoteEn}

IMPORTANT: Include ONLY sections that have relevant content for this chapter. If a section has no chapter-specific information, omit it entirely.

Possible sections (include only those that are relevant):

## People
If the chapter introduces or focuses on specific people:
- Who are they and what is their role?
- Historical/archaeological information about these people (if available)

## Places
If the chapter mentions specific places:
- Geographical information and location
- Archaeological finds at the site (if relevant)
- The place's significance in context

## Events and Customs
If the chapter describes specific rituals, laws, customs or events:
- Cultural background and explanation
- Parallels in surrounding cultures

## Key Concepts
If the chapter contains words, expressions or concepts that need explanation:
- Hebrew/Greek words with special meaning
- Cultural concepts that may be foreign to modern readers

## Chapter-specific Finds
If there are archaeological finds or historical sources that illuminate this specific chapter's content:
- Describe the find and how it is relevant

Be concrete and fact-based. Write 1-2 paragraphs per section you include.`;

    const refFormatNb = `\nREFERANSEFORMAT:
Når du refererer til bibelsteder, bruk formatet: [ref:FORKORTELSE KAPITTEL:VERS|VISNINGSTEKST]
Eksempel: [ref:Joh 3:16|Johannes 3:16], [ref:1 Mos 1:1-3|1. Mosebok 1:1-3]
Bruk KVN-forkortelser (1 Mos, Sal, Joh, Åp osv.) i ref-delen og fullt boknavn i visningsteksten.`;

    const refFormatNn = `\nREFERANSEFORMAT:
Når du refererer til bibelstader, bruk formatet: [ref:FORKORTING KAPITTEL:VERS|VISNINGSTEKST]
Eksempel: [ref:Joh 3:16|Johannes 3:16], [ref:1 Mos 1:1-3|1. Mosebok 1:1-3]
Bruk KVN-forkortingar (1 Mos, Sal, Joh, Åp osv.) i ref-delen og fullt boknamn i visningsteksten.`;

    const refFormatEn = `\nREFERENCE FORMAT:
When referring to Bible passages, use the format: [ref:ABBREVIATION CHAPTER:VERSE|DISPLAY TEXT]
Example: [ref:Joh 3:16|John 3:16], [ref:1 Mos 1:1-3|Genesis 1:1-3]
Use KVN abbreviations (1 Mos, Sal, Joh, Åp etc.) in the ref part and full book name in the display text.`;

    if (langCode === 'nb') {
        return `${structureNb}
${refFormatNb}

Her er den ${originalLanguage}e originalteksten for kapittelet:
${originalText}`;
    } else if (langCode === 'nn') {
        return `${structureNn}
${refFormatNn}

Her er den ${originalLanguage}e originalteksten for kapitlet:
${originalText}`;
    } else {
        return `${structureEn}
${refFormatEn}

Here is the original ${originalLanguageEn} text for the chapter:
${originalText}`;
    }
}

// Proofread prompt for chapter context
function getProofreadPrompt(language: string, bookId: number, chapter: number, currentContext: string, originalText: string): string {
    const bookName = getBookName(bookId, language);
    const bibleRef = `${bookName} ${chapter}`;
    const langCode = getLanguageCode(language);
    const originalLanguage = bookId <= 39 ? 'hebraisk' : 'gresk';
    const originalLanguageEn = bookId <= 39 ? 'Hebrew' : 'Greek';

    let basePrompt: string;
    let structureReminder: string;

    if (langCode === 'nb') {
        basePrompt = `Du er en korrekturleser for bibelkontekst. Gå gjennom følgende kapittel-kontekst for ${bibleRef}.
Du får også den ${originalLanguage}e originalteksten for å verifisere nøyaktigheten.`;
        structureReminder = `VIKTIG: Kapittel-kontekst skal KUN inneholde kapittel-spesifikk informasjon.

Mulige seksjoner (kun de som er relevante):
- ## Personer
- ## Steder
- ## Hendelser og skikker
- ## Nøkkelbegreper
- ## Kapittel-spesifikke funn

Sjekk spesielt at:
1. Ingen generell bok-informasjon er inkludert (dette hører til book_context)
2. Alle fakta er korrekte
3. Informasjonen er faktisk relevant for dette kapittelet
4. Seksjoner uten innhold er utelatt
- ALDRI nevn spesifikke bibelutgaver, bibelselskap eller forlag (f.eks. "Bibelen 2011", "Bibelselskapet", "NIV", "ESV"). Skriv nøytralt uten referanse til bestemte oversettelser eller organisasjoner.`;
    } else if (langCode === 'nn') {
        basePrompt = `Du er ein korrekturlesar for bibelkontekst. Gå gjennom følgjande kapittel-kontekst for ${bibleRef}.
Du får også den ${originalLanguage}e originalteksten for å verifisere nøyaktigheita.`;
        structureReminder = `VIKTIG: Kapittel-kontekst skal KUN innehalde kapittel-spesifikk informasjon.

Moglege seksjonar (berre dei som er relevante):
- ## Personar
- ## Stader
- ## Hendingar og skikkar
- ## Nøkkelomgrep
- ## Kapittel-spesifikke funn

Sjekk spesielt at:
1. Ingen generell bok-informasjon er inkludert (dette høyrer til book_context)
2. Alle fakta er korrekte
3. Informasjonen er faktisk relevant for dette kapitlet
4. Seksjonar utan innhald er utelatne
- ALDRI nemn spesifikke bibelutgåver, bibelselskap eller forlag (t.d. "Bibelen 2011", "Bibelselskapet", "NIV", "ESV"). Skriv nøytralt utan referanse til bestemte omsetjingar eller organisasjonar.`;
    } else {
        basePrompt = `You are a proofreader for Bible context. Review the following chapter-context for ${bibleRef}.
You are also given the original ${originalLanguageEn} text to verify accuracy.`;
        structureReminder = `IMPORTANT: Chapter context should ONLY contain chapter-specific information.

Possible sections (only those that are relevant):
- ## People
- ## Places
- ## Events and Customs
- ## Key Concepts
- ## Chapter-specific Finds

Check especially that:
1. No general book-level information is included (this belongs in book_context)
2. All facts are correct
3. The information is actually relevant to this chapter
4. Sections without content are omitted
- NEVER mention specific Bible editions, Bible societies, or publishers (e.g., "NIV", "ESV", "KJV", "Bibelen 2011", "Bibelselskapet"). Write neutrally without referencing specific translations or organizations.`;
    }

    return `${basePrompt}

Your task is to review the context and identify:
- Factual errors or inaccuracies
- Information that belongs at book-level, not chapter-level
- Missing important chapter-specific information
- Awkward phrasing that could be improved
- Grammar or spelling errors
- Empty or unnecessary sections

${structureReminder}

REFERANSEFORMAT:
Bibelreferanser i teksten bruker formatet: [ref:FORKORTELSE KAPITTEL:VERS|VISNINGSTEKST]
Eksempel: [ref:Joh 3:16|Johannes 3:16]. Bevar dette formatet i revisedContext.
Bruk KVN-forkortelser (1 Mos, Sal, Joh, Åp osv.) i ref-delen og fullt boknavn i visningsteksten.

IMPORTANT:
- If the current context is good and has no issues, return an empty issues array and no revisedContext
- Focus on keeping context chapter-specific
- Flag any book-level information that should be removed

Original text:
${originalText}

Current context:
${currentContext}`;
}

function getOutputPath(language: string, bookId: number, chapterId: number): string {
    const langCode = getLanguageCode(language);
    return path.join(__dirname, `chapter_context/${langCode}/${bookId}-${chapterId}.md`);
}

function getProofreadPath(language: string, bookId: number, chapterId: number): string {
    const langCode = getLanguageCode(language);
    return path.join(__dirname, `proofread_chapter_context/${langCode}/${bookId}-${chapterId}.json`);
}

function fileExists(filepath: string): boolean {
    return fs.existsSync(filepath) && fs.statSync(filepath).size > 0;
}

async function generateChapterContext(language: string, bookId: number, chapter: number, filename: string): Promise<void> {
    const bookName = getBookName(bookId, language);

    // Read the original text
    const originalText = readOriginalChapter(bookId, chapter);
    if (!originalText) {
        console.log(`Skipping ${bookName} ${chapter} (no original text found)`);
        return;
    }

    // Read book context if available
    const bookContext = readBookContext(language, bookId);
    if (!bookContext) {
        console.log(`Note: No book context found for ${bookName}. Consider running book_context.mjs first.`);
    }

    const prompt = getContextPrompt(language, bookId, chapter, originalText, bookContext);

    console.log(`Generating context for ${bookName} ${chapter}...`);
    // Uten `schema` svarer `callWithRetry` med råtekst; påstanden sier bare
    // hvilken gren av `string | object` kallet allerede lå i.
    const text = await callWithRetry(prompt, {local: useLocal, context: `${bookId}:${chapter}`}) as string;

    const dir = path.dirname(filename);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, {recursive: true});
    }

    fs.writeFileSync(filename, text);
    console.log(`Saved: ${filename}`);
}

async function proofreadChapterContext(language: string, bookId: number, chapter: number, contextFilename: string, saveToFile: boolean = true): Promise<ProofreadContextResult | null> {
    if (!fileExists(contextFilename)) {
        console.log(`No context file found for ${bookId}:${chapter}`);
        return null;
    }

    const bookName = getBookName(bookId, language);

    // Read the original text for verification
    const originalText = readOriginalChapter(bookId, chapter);
    if (!originalText) {
        console.log(`Skipping proofread for ${bookName} ${chapter} (no original text found)`);
        return null;
    }

    const currentContext = fs.readFileSync(contextFilename, 'utf-8');

    console.log(`Proofreading context for ${bookName} ${chapter}...`);

    const prompt = getProofreadPrompt(language, bookId, chapter, currentContext, originalText);
    const result = await callWithRetry(prompt, {schema: PROOFREAD_CONTEXT_SCHEMA, local: useLocal, context: `proofread ${bookId}:${chapter}`}) as ProofreadContextResult;

    // Save proofread results if requested
    if (saveToFile) {
        const proofreadFile = getProofreadPath(language, bookId, chapter);
        const dir = path.dirname(proofreadFile);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, {recursive: true});
        }
        console.log("Writing proofread results to", proofreadFile);
        fs.writeFileSync(proofreadFile, JSON.stringify(result, null, 2));
    }

    // Print summary
    console.log(`\nProofread results for ${bookName} ${chapter}:`);
    if (result.score !== null && result.score !== undefined) {
        console.log(`Score: ${result.score}/10`);
    }
    console.log(`Summary: ${result.summary}`);
    if (result.issues && result.issues.length > 0) {
        console.log(`Issues found: ${result.issues.length}`);
        result.issues.forEach((issue: ProofreadIssue, i: number) => {
            console.log(`  ${i + 1}. [${issue.severity}] ${issue.type}`);
            console.log(`     ${issue.explanation}`);
        });
    }

    return result;
}

function applyProofreadChanges(language: string, bookId: number, chapter: number, contextFilename: string, proofreadResult: ProofreadContextResult | null = null): void {
    // Load proofread result from file if not provided
    if (!proofreadResult) {
        const proofreadFile = getProofreadPath(language, bookId, chapter);
        if (!fileExists(proofreadFile)) {
            console.log(`No proofread file found for ${bookId}:${chapter}`);
            return;
        }
        proofreadResult = JSON.parse(fs.readFileSync(proofreadFile, 'utf-8')) as ProofreadContextResult;
    }

    if (!fileExists(contextFilename)) {
        console.log(`No context file found for ${bookId}:${chapter}`);
        return;
    }

    // Check if there's a revised context to apply
    if (!proofreadResult.revisedContext || proofreadResult.revisedContext.trim() === '') {
        console.log(`No revisions needed for ${bookId}:${chapter}`);
        return;
    }

    // Write the revised context
    fs.writeFileSync(contextFilename, proofreadResult.revisedContext);
    const bookName = getBookName(bookId, language);
    console.log(`Applied revisions to ${bookName} ${chapter}`);
}

function printUsage(): void {
    console.log(`
Usage: node chapter_context.mjs [options]

Generates chapter-specific historical and cultural context for Bible chapters.
This complements book_context.mjs which provides book-level context.

IMPORTANT: Run book_context.mjs first to generate book-level context, then
run this script for chapter-specific details.

Options:
  --language <lang>  Language for context (default: nb)
                     Accepts codes (nb, nn, en, de, es, fr, sv, da) or full names
  --proofread        Run proofreading after generation
  --apply            Apply proofread suggestions (requires prior --proofread run)
  --ot               Process only Old Testament (books 1-39)
  --nt               Process only New Testament (books 40-66)
  --book <range>     Process book(s): single (43) or range (1-20)
  --chapter <range>  Process chapter(s): single (1) or range (1-10)
  --force            Force re-generation even if file exists
  --help             Show this help message

Output structure:
  chapter_context/<lang>/<book>-<chapter>.md
  e.g., chapter_context/nb/1-1.md (Genesis 1)

Examples:
  node chapter_context.mjs --nt                              # Generate NT chapter context
  node chapter_context.mjs --language nn --ot                # Generate OT context (nynorsk)
  node chapter_context.mjs --language en --book 43           # Generate John chapters (English)
  node chapter_context.mjs --book 1 --chapter 1-11           # Generate Genesis 1-11 context
  node chapter_context.mjs --nt --proofread --apply          # Generate → proofread → apply
  node chapter_context.mjs --book 1 --force                  # Re-generate Genesis context

Parallel processing (run in separate terminals):
  node chapter_context.mjs --book 1-20 &                     # terminal 1
  node chapter_context.mjs --book 21-39 &                    # terminal 2
`);
}

function parseRange(value: string): {start: number, end: number} {
    if (value.includes('-')) {
        const [start, end] = value.split('-').map((n: string) => parseInt(n, 10));
        return {start, end};
    }
    const num = parseInt(value, 10);
    return {start: num, end: num};
}

function parseArgs(args: string[]): Options {
    const options: Options = {
        language: 'Norwegian bokmål',
        proofread: false,
        apply: false,
        ot: false,
        nt: false,
        bookStart: null,
        bookEnd: null,
        chapterStart: null,
        chapterEnd: null,
        force: false,
        help: false
    };

    let i = 0;
    while (i < args.length) {
        const arg = args[i];

        if (arg === '--language' && i + 1 < args.length) {
            options.language = args[++i];
        } else if (arg === '--proofread') {
            options.proofread = true;
        } else if (arg === '--apply') {
            options.apply = true;
        } else if (arg === '--ot') {
            options.ot = true;
        } else if (arg === '--nt') {
            options.nt = true;
        } else if (arg === '--book' && i + 1 < args.length) {
            const range = parseRange(args[++i]);
            options.bookStart = range.start;
            options.bookEnd = range.end;
        } else if (arg === '--chapter' && i + 1 < args.length) {
            const range = parseRange(args[++i]);
            options.chapterStart = range.start;
            options.chapterEnd = range.end;
        } else if (arg === '--local') {
            options.local = true;
        } else if (arg === '--force') {
            options.force = true;
        } else if (arg === '--help') {
            options.help = true;
        }
        i++;
    }

    return options;
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const options = parseArgs(args);

    // Normalize language (accept both codes like 'nb' and full names like 'Norwegian bokmål')
    options.language = normalizeLanguage(options.language);
    useLocal = options.local || false;

    if (options.help) {
        printUsage();
        return;
    }

    // Determine book range
    let startBook = 1;
    let endBook = 66;

    if (options.bookStart !== null) {
        startBook = options.bookStart;
        // `bookEnd` settes alltid sammen med `bookStart` i `parseArgs`, så
        // grenen her kan ikke se `null`. Kompilatoren kan ikke se koblingen.
        endBook = options.bookEnd as number;
    } else if (options.ot && !options.nt) {
        startBook = 1;
        endBook = 39;
    } else if (options.nt && !options.ot) {
        startBook = 40;
        endBook = 66;
    }

    const modes = ['Generate'];
    if (options.proofread) modes.push('Proofread');
    if (options.apply) modes.push('Apply');

    console.log(`Language: ${options.language}`);
    console.log(`Mode: ${modes.join(' → ')}`);
    console.log(`Books: ${startBook}-${endBook}`);
    if (options.chapterStart !== null) {
        console.log(`Chapters: ${options.chapterStart}-${options.chapterEnd}`);
    }
    console.log('---');

    for (let bookId = startBook; bookId <= endBook; bookId++) {
        const book = books.find(b => b.id === bookId);
        if (!book) continue;

        const maxChapters = book.chapters;
        const startChapter = options.chapterStart || 1;
        const endChapter = Math.min(options.chapterEnd || maxChapters, maxChapters);

        for (let chapterId = startChapter; chapterId <= endChapter; chapterId++) {
            const filename = getOutputPath(options.language, bookId, chapterId);

            // Step 1: Generate (skip if file exists unless --force)
            if (!fileExists(filename) || options.force) {
                await generateChapterContext(options.language, bookId, chapterId, filename);
            } else {
                const bookName = getBookName(bookId, options.language);
                console.log(`Skipping ${bookName} ${chapterId} (already exists)`);
            }

            // Step 2: Proofread (if requested)
            let proofreadResult: ProofreadContextResult | null = null;
            if (options.proofread && fileExists(filename)) {
                const saveToFile = !options.apply;
                proofreadResult = await proofreadChapterContext(options.language, bookId, chapterId, filename, saveToFile);
            }

            // Step 3: Apply (if requested)
            if (options.apply) {
                applyProofreadChanges(options.language, bookId, chapterId, filename, proofreadResult);
            }
        }
    }

    console.log('Done!');
}

main().catch(console.error);
