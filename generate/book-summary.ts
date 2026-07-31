import "./env.js";
import * as fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import {books, normalizeLanguage, getLanguageCode, getBookName} from "./constants.js";
import {callWithRetry} from "./llm.js";
import {parseArgs, formatHelp, COMMON_FLAGS} from './cli.js';
import type {FlagSpec, Range} from './cli.js';
import type {Chapter} from '../kvn/src/bible-types.js';

let useLocal = false;

/**
 * Én funn-post fra korrekturen, slik `PROOFREAD_SUMMARY_SCHEMA` under krever.
 * Enum-verdiene er duplisert med vilje: JSON-skjemaet er avtalen med modellen,
 * typen er den samme avtalen for kompilatoren.
 */
interface ProofreadIssue {
    type: 'error' | 'suggestion' | 'theological' | 'grammar' | 'missing' | 'structure';
    severity: 'critical' | 'major' | 'minor';
    current: string;
    suggested: string;
    explanation: string;
}

/** Svaret fra korrekturkallet — samme form som `PROOFREAD_SUMMARY_SCHEMA`. */
interface ProofreadSummaryResult {
    issues: ProofreadIssue[];
    summary: string;
    score: number;
    revisedSummary: string;
}

/** Flaggene fra kommandolinja, etter at `parseArgs` har tolket dem. */
interface Options {
    language: string;
    proofread: boolean;
    apply: boolean;
    ot: boolean;
    nt: boolean;
    bookStart: number | null;
    bookEnd: number | null;
    force: boolean;
    /** Alltid satt nå — kontrakten initialiserer boolske flagg til `false`. */
    local: boolean;
}

/**
 * Flaggkontrakten for dette skriptet (#51, #52, #53).
 *
 * `--local` sto ikke i den gamle bruksmeldingen selv om parseren tok imot det,
 * og docs/running-jobs.md måtte skrive det opp separat: uten flagget går hele
 * jobben på Claude API. Nå står det i `--help` som alle de andre.
 *
 * Skriptet har ingen `--chapter`: enheten her er hele boka.
 */
const SPEC: Record<string, FlagSpec> = {
    language: COMMON_FLAGS.language,   // 'nb' → normalizeLanguage → 'Norwegian bokmål', som før
    book: COMMON_FLAGS.book,
    ot: COMMON_FLAGS.ot,
    nt: COMMON_FLAGS.nt,
    force: COMMON_FLAGS.force,
    local: COMMON_FLAGS.local,
    proofread: {kind: 'boolean', help: 'kjør korrektur etter genereringen'},
    apply: {kind: 'boolean', help: 'skriv korrekturens reviderte sammendrag tilbake til fila'},
    help: COMMON_FLAGS.help,
};

const PROOFREAD_SUMMARY_SCHEMA = {
    type: "object",
    properties: {
        issues: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    type: {type: "string", enum: ["error", "suggestion", "theological", "grammar", "missing", "structure"]},
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
        revisedSummary: {type: "string"}
    },
    required: ["issues", "summary", "score", "revisedSummary"],
    additionalProperties: false
};

// Get original source based on book ID
function getOriginalSource(bookId: number): string {
    return bookId <= 39 ? 'hebrew' : 'sblgnt';
}

// Read all chapters of a book from bibles_raw
function readOriginalBook(bookId: number): string | null {
    const source = getOriginalSource(bookId);
    const book = books.find(b => b.id === bookId);
    if (!book) return null;

    const chapters: string[] = [];
    for (let chapterId = 1; chapterId <= book.chapters; chapterId++) {
        const sourceFile = path.join(__dirname, `bibles_raw/${source}/${bookId}/${chapterId}.json`);
        if (fs.existsSync(sourceFile)) {
            const verses: Chapter = JSON.parse(fs.readFileSync(sourceFile, 'utf-8'));
            const chapterText = verses.map(v => `${v.verseId}: ${v.text}`).join('\n');
            chapters.push(`Kapittel ${chapterId}:\n${chapterText}`);
        }
    }
    return chapters.join('\n\n');
}

// Get book summary generation prompt
function getSummaryPrompt(language: string, bookId: number, originalText: string): string {
    const bookName = getBookName(bookId, language);
    const book = books.find(b => b.id === bookId);
    // `!` er en ren typepåstand: fantes ikke bok-id-en i `books`, kastet denne
    // linja på `.chapters` også før typene kom til.
    const chapterCount = book!.chapters;
    const langCode = getLanguageCode(language);
    const originalLanguage = bookId <= 39 ? 'hebraisk' : 'gresk';

    const structureNb = `Bruk følgende struktur:

**Om boken:** Et kort avsnitt (2-3 setninger) som introduserer boken – forfatter (hvis kjent), historisk kontekst, og bokens plass i Bibelen.

**Hovedtema:** Én setning som oppsummerer bokens overordnede budskap eller tema.

**Innholdsoversikt:** En liste med hovedoverskrifter som dekker bokens innhold. Hver overskrift skal ha kapittelnummer i parentes og en kort beskrivelse. Grupper kapitler der det er naturlig.

**Nøkkeltemaer:** 3-5 sentrale temaer i boken med kort forklaring (én setning hver).`;

    const structureNn = `Bruk følgjande struktur:

**Om boka:** Eit kort avsnitt (2-3 setningar) som introduserer boka – forfattar (om kjend), historisk kontekst, og boka sin plass i Bibelen.

**Hovudtema:** Éi setning som oppsummerer boka sitt overordna bodskap eller tema.

**Innhaldsoversikt:** Ei liste med hovudoverskrifter som dekker innhaldet i boka. Kvar overskrift skal ha kapitteltal i parentes og ei kort skildring. Grupper kapittel der det er naturleg.

**Nøkkeltema:** 3-5 sentrale tema i boka med kort forklaring (éi setning kvar).`;

    const structureEn = `Use the following structure:

**About the book:** A short paragraph (2-3 sentences) introducing the book – author (if known), historical context, and the book's place in the Bible.

**Main theme:** One sentence summarizing the book's overarching message or theme.

**Content overview:** A list of main headings covering the book's content. Each heading should have chapter numbers in parentheses and a brief description. Group chapters where natural.

**Key themes:** 3-5 central themes in the book with brief explanation (one sentence each).`;

    const refFormatNb = `REFERANSEFORMAT:
Når du refererer til bibelsteder, bruk formatet: [ref:FORKORTELSE KAPITTEL:VERS|VISNINGSTEKST]
Eksempel: [ref:Joh 3:16|Johannes 3:16], [ref:1 Mos 1:1-3|1. Mosebok 1:1-3]
Bruk KVN-forkortelser (1 Mos, Sal, Joh, Åp osv.) i ref-delen og fullt boknavn i visningsteksten.`;

    const refFormatNn = `REFERANSEFORMAT:
Når du refererer til bibelstader, bruk formatet: [ref:FORKORTING KAPITTEL:VERS|VISNINGSTEKST]
Eksempel: [ref:Joh 3:16|Johannes 3:16], [ref:1 Mos 1:1-3|1. Mosebok 1:1-3]
Bruk KVN-forkortingar (1 Mos, Sal, Joh, Åp osv.) i ref-delen og fullt boknamn i visningsteksten.`;

    const refFormatEn = `REFERENCE FORMAT:
When referring to Bible passages, use the format: [ref:ABBREVIATION CHAPTER:VERSE|DISPLAY TEXT]
Example: [ref:Joh 3:16|John 3:16], [ref:1 Mos 1:1-3|Genesis 1:1-3]
Use KVN abbreviations (1 Mos, Sal, Joh, Åp etc.) in the ref part and full book name in the display text.`;

    if (langCode === 'nb') {
        return `Lag et sammendrag av ${bookName} (${chapterCount} kapitler) på norsk, bokmål.

${structureNb}

${refFormatNb}

Her er den ${originalLanguage}e originalteksten for hele boken:
${originalText}`;
    } else if (langCode === 'nn') {
        return `Lag eit samandrag av ${bookName} (${chapterCount} kapittel) på norsk, nynorsk.

${structureNn}

${refFormatNn}

Her er den ${originalLanguage}e originalteksten for heile boka:
${originalText}`;
    } else {
        return `Write a summary of ${bookName} (${chapterCount} chapters) in ${language}.

${structureEn}

${refFormatEn}

Here is the original ${bookId <= 39 ? 'Hebrew' : 'Greek'} text for the entire book:
${originalText}`;
    }
}

// Token estimation: Hebrew/Greek text tokenizes at ~0.8 chars per token (each character ≈ 1.25 tokens)
const ESTIMATED_CHARS_PER_TOKEN = 0.8;
const MAX_PROMPT_TOKENS = 180000; // Leave room for response within 200K limit
const PROMPT_OVERHEAD_TOKENS = 3000; // Approximate tokens for prompt instructions

// Read condensed version of a book (first verse of each chapter)
function readCondensedBook(bookId: number): string | null {
    const source = getOriginalSource(bookId);
    const book = books.find(b => b.id === bookId);
    if (!book) return null;

    const chapters: string[] = [];
    for (let chapterId = 1; chapterId <= book.chapters; chapterId++) {
        const sourceFile = path.join(__dirname, `bibles_raw/${source}/${bookId}/${chapterId}.json`);
        if (fs.existsSync(sourceFile)) {
            const verses: Chapter = JSON.parse(fs.readFileSync(sourceFile, 'utf-8'));
            const firstVerse = verses[0] ? `1: ${verses[0].text}` : '';
            const lastVerse = verses.length > 1 ? `${verses[verses.length - 1].verseId}: ${verses[verses.length - 1].text}` : '';
            chapters.push(`Kapittel ${chapterId} (${verses.length} vers):\n${firstVerse}${lastVerse ? '\n...\n' + lastVerse : ''}`);
        }
    }
    return chapters.join('\n\n');
}

// Proofread prompt for book summaries
function getProofreadPrompt(language: string, bookId: number, currentSummary: string, originalText: string): string {
    const bookName = getBookName(bookId, language);
    const langCode = getLanguageCode(language);
    const originalLanguage = bookId <= 39 ? 'hebraisk' : 'gresk';

    // Estimate if full text fits within token limits
    const summaryTokens = Math.ceil(currentSummary.length / ESTIMATED_CHARS_PER_TOKEN);
    const originalTokens = Math.ceil(originalText.length / ESTIMATED_CHARS_PER_TOKEN);
    const totalEstimate = summaryTokens + originalTokens + PROMPT_OVERHEAD_TOKENS;
    const textTooLarge = totalEstimate > MAX_PROMPT_TOKENS;

    // `readCondensedBook` kan gi `null`, og gjorde det før typene også — det
    // ender i så fall som «null» i teksten. Typen beskriver, den endrer ikke.
    let referenceText: string | null;
    let referenceNote: string;
    if (textTooLarge) {
        referenceText = readCondensedBook(bookId);
        if (langCode === 'nb') {
            referenceNote = `(Merk: Originalteksten er forkortet til første og siste vers per kapittel pga. størrelse. Bruk din kunnskap om ${bookName} for å verifisere nøyaktigheten.)`;
        } else if (langCode === 'nn') {
            referenceNote = `(Merk: Originalteksten er forkorta til fyrste og siste vers per kapittel pga. storleik. Bruk kunnskapen din om ${bookName} for å verifisere nøyaktigheita.)`;
        } else {
            referenceNote = `(Note: The original text has been condensed to first and last verse per chapter due to size. Use your knowledge of ${bookName} to verify accuracy.)`;
        }
        console.log(`  Note: Original text too large (~${originalTokens} tokens), using condensed version for proofreading`);
    } else {
        referenceText = originalText;
        referenceNote = '';
    }

    let basePrompt: string;
    let structureReminder: string;

    if (langCode === 'nb') {
        basePrompt = `Du er en korrekturleser for bibelsammendrag. Gå gjennom følgende sammendrag av ${bookName}.
Du får også den ${originalLanguage}e originalteksten for å verifisere nøyaktigheten.`;
        structureReminder = `VIKTIG: Sammendraget MÅ beholde følgende struktur:
- **Om boken:** (2-3 setninger)
- **Hovedtema:** (én setning)
- **Innholdsoversikt:** (liste med hovedoverskrifter og kapittelnummer)
- **Nøkkeltemaer:** (3-5 temaer med én setning forklaring hver)

Hvis sammendraget mangler strukturen eller har feil, må revisedSummary korrigere dette.
- ALDRI nevn spesifikke bibelutgaver, bibelselskap eller forlag (f.eks. "Bibelen 2011", "Bibelselskapet", "NIV", "ESV"). Skriv nøytralt uten referanse til bestemte oversettelser eller organisasjoner.`;
    } else if (langCode === 'nn') {
        basePrompt = `Du er ein korrekturlesar for bibelsamandrag. Gå gjennom følgjande samandrag av ${bookName}.
Du får også den ${originalLanguage}e originalteksten for å verifisere nøyaktigheita.`;
        structureReminder = `VIKTIG: Samandraget MÅ behalde følgjande struktur:
- **Om boka:** (2-3 setningar)
- **Hovudtema:** (éi setning)
- **Innhaldsoversikt:** (liste med hovudoverskrifter og kapitteltal)
- **Nøkkeltema:** (3-5 tema med éi setning forklaring kvar)

Dersom samandraget manglar strukturen eller har feil, må revisedSummary korrigere dette.
- ALDRI nemn spesifikke bibelutgåver, bibelselskap eller forlag (t.d. "Bibelen 2011", "Bibelselskapet", "NIV", "ESV"). Skriv nøytralt utan referanse til bestemte omsetjingar eller organisasjonar.`;
    } else {
        basePrompt = `You are a proofreader for Bible summaries. Review the following summary of ${bookName}.
You are also given the original ${bookId <= 39 ? 'Hebrew' : 'Greek'} text to verify accuracy.`;
        structureReminder = `IMPORTANT: The summary MUST maintain this structure:
- **About the book:** (2-3 sentences)
- **Main theme:** (one sentence)
- **Content overview:** (list of main headings with chapter numbers)
- **Key themes:** (3-5 themes with one sentence explanation each)

If the summary lacks the structure or has errors, revisedSummary must correct this.
- NEVER mention specific Bible editions, Bible societies, or publishers (e.g., "NIV", "ESV", "KJV", "Bibelen 2011", "Bibelselskapet"). Write neutrally without referencing specific translations or organizations.`;
    }

    return `${basePrompt}
${referenceNote ? '\n' + referenceNote : ''}

Your task is to review the summary and identify:
- Factual errors or inaccuracies compared to the original text
- Missing important content or themes
- Incorrect chapter groupings
- Awkward phrasing that could be improved
- Grammar or spelling errors
- Missing or incorrect structure

${structureReminder}

REFERANSEFORMAT:
Bibelreferanser i teksten bruker formatet: [ref:FORKORTELSE KAPITTEL:VERS|VISNINGSTEKST]
Eksempel: [ref:Joh 3:16|Johannes 3:16]. Bevar dette formatet i revisedSummary.
Bruk KVN-forkortelser (1 Mos, Sal, Joh, Åp osv.) i ref-delen og fullt boknavn i visningsteksten.

IMPORTANT:
- If the current summary is good and has no issues, return an empty issues array and no revisedSummary
- The revisedSummary MUST use the required structure
- Focus on accuracy and faithfulness to the biblical text

Original text:
${referenceText}

Current summary:
${currentSummary}`;
}

function getOutputPath(language: string, bookId: number): string {
    const langCode = getLanguageCode(language);
    return path.join(__dirname, `book_summaries/${langCode}/${bookId}.md`);
}

function getProofreadPath(language: string, bookId: number): string {
    const langCode = getLanguageCode(language);
    return path.join(__dirname, `proofread_book_summaries/${langCode}/${bookId}.json`);
}

function fileExists(filepath: string): boolean {
    return fs.existsSync(filepath) && fs.statSync(filepath).size > 0;
}

async function generateBookSummary(language: string, bookId: number, filename: string): Promise<void> {
    const bookName = getBookName(bookId, language);

    // Read the original text
    const originalText = readOriginalBook(bookId);
    if (!originalText) {
        console.log(`Skipping ${bookName} (no original text found)`);
        return;
    }

    const prompt = getSummaryPrompt(language, bookId, originalText);

    console.log(`Generating summary for ${bookName}...`);
    // Uten `schema` svarer `callWithRetry` med råtekst; påstanden sier bare
    // hvilken gren av `string | object` kallet allerede lå i.
    const text = await callWithRetry(prompt, {local: useLocal, context: `book ${bookId}`}) as string;

    const dir = path.dirname(filename);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, {recursive: true});
    }

    fs.writeFileSync(filename, text);
    console.log(`Saved: ${filename}`);
}

async function proofreadBookSummary(language: string, bookId: number, summaryFilename: string, saveToFile: boolean = true): Promise<ProofreadSummaryResult | null> {
    if (!fileExists(summaryFilename)) {
        console.log(`No summary file found for book ${bookId}`);
        return null;
    }

    const bookName = getBookName(bookId, language);

    // Read the original text for verification
    const originalText = readOriginalBook(bookId);
    if (!originalText) {
        console.log(`Skipping proofread for ${bookName} (no original text found)`);
        return null;
    }

    const currentSummary = fs.readFileSync(summaryFilename, 'utf-8');

    console.log(`Proofreading summary for ${bookName}...`);

    const prompt = getProofreadPrompt(language, bookId, currentSummary, originalText);
    const result = await callWithRetry(prompt, {schema: PROOFREAD_SUMMARY_SCHEMA, local: useLocal, context: `proofread book ${bookId}`}) as ProofreadSummaryResult;

    // Save proofread results if requested
    if (saveToFile) {
        const proofreadFile = getProofreadPath(language, bookId);
        const dir = path.dirname(proofreadFile);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, {recursive: true});
        }
        console.log("Writing proofread results to", proofreadFile);
        fs.writeFileSync(proofreadFile, JSON.stringify(result, null, 2));
    }

    // Print summary
    console.log(`\nProofread results for ${bookName}:`);
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

function applyProofreadChanges(language: string, bookId: number, summaryFilename: string, proofreadResult: ProofreadSummaryResult | null = null): void {
    // Load proofread result from file if not provided
    if (!proofreadResult) {
        const proofreadFile = getProofreadPath(language, bookId);
        if (!fileExists(proofreadFile)) {
            console.log(`No proofread file found for book ${bookId}`);
            return;
        }
        proofreadResult = JSON.parse(fs.readFileSync(proofreadFile, 'utf-8')) as ProofreadSummaryResult;
    }

    if (!fileExists(summaryFilename)) {
        console.log(`No summary file found for book ${bookId}`);
        return;
    }

    // Check if there's a revised summary to apply
    if (!proofreadResult.revisedSummary || proofreadResult.revisedSummary.trim() === '') {
        console.log(`No revisions needed for book ${bookId}`);
        return;
    }

    // Write the revised summary
    fs.writeFileSync(summaryFilename, proofreadResult.revisedSummary);
    const bookName = getBookName(bookId, language);
    console.log(`Applied revisions to ${bookName}`);
}

const HELP_EXAMPLES = [
    'bun generate/book-summary.ts --nt                              # NT, norsk bokmål',
    'bun generate/book-summary.ts --language nn --ot                # GT, nynorsk',
    'bun generate/book-summary.ts --language en --book 43           # Johannes, engelsk',
    'bun generate/book-summary.ts --book 1-5                        # Mosebøkene',
    'bun generate/book-summary.ts --nt --proofread --apply          # generer → korrektur → skriv inn',
    'bun generate/book-summary.ts --book 1 --force                  # lag 1. Mosebok på nytt',
    'bun generate/book-summary.ts --local --book 1-20               # lokal Ollama i stedet for Claude',
    '',
    'Sammendragene havner i book_summaries/<språkkode>/<bok>.md, f.eks.',
    'book_summaries/nb/43.md. Korrekturen legges i',
    'proofread_book_summaries/<språkkode>/<bok>.json når --apply ikke er med.',
];

/** Oversetter de tolkede flaggene til `Options`. */
function readOptions(flags: ReturnType<typeof parseArgs>['flags']): Options {
    const book = flags.book as Range | undefined;

    return {
        // Godtar både koder ('nb') og fulle navn ('Norwegian bokmål'), som før.
        language: normalizeLanguage(flags.language as string),
        proofread: flags.proofread as boolean,
        apply: flags.apply as boolean,
        ot: flags.ot as boolean,
        nt: flags.nt as boolean,
        bookStart: book?.start ?? null,
        bookEnd: book?.end ?? null,
        force: flags.force as boolean,
        local: flags.local as boolean,
    };
}

async function main(): Promise<void> {
    // Hjelpen skal ut før noe leses fra disk eller sendes over nettet.
    const {flags} = parseArgs(process.argv.slice(2), SPEC);
    if (flags.help) {
        console.log(formatHelp(
            'generate/book-summary.ts',
            'sammendrag per bok, generert og korrekturlest av en modell',
            SPEC,
            HELP_EXAMPLES,
        ));
        process.exit(0);
    }

    const options = readOptions(flags);
    useLocal = options.local;

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
    console.log('---');

    for (let bookId = startBook; bookId <= endBook; bookId++) {
        const book = books.find(b => b.id === bookId);
        if (!book) continue;

        const filename = getOutputPath(options.language, bookId);

        // Step 1: Generate (skip if file exists unless --force)
        if (!fileExists(filename) || options.force) {
            await generateBookSummary(options.language, bookId, filename);
        } else {
            const bookName = getBookName(bookId, options.language);
            console.log(`Skipping ${bookName} (already exists)`);
        }

        // Step 2: Proofread (if requested)
        let proofreadResult: ProofreadSummaryResult | null = null;
        if (options.proofread && fileExists(filename)) {
            const saveToFile = !options.apply;
            proofreadResult = await proofreadBookSummary(options.language, bookId, filename, saveToFile);
        }

        // Step 3: Apply (if requested)
        if (options.apply) {
            applyProofreadChanges(options.language, bookId, filename, proofreadResult);
        }
    }

    console.log('Done!');
}

// Avslutt med kode 1, ikke 0: et ukjent flagg skal stoppe et køskript, ikke
// bare skrive en linje det ingen leser. Tidligere var dette
// `.catch(console.error)`, som lot skallet tro at jobben gikk bra.
// Kjører bare når fila startes direkte. Uten vakten kjører jobben ved IMPORT —
// det er grunnen til at days.ts slettet data bare man lastet modulen (#108),
// og det gjør skriptene umulige å teste.
if (import.meta.main) {
    main().catch(err => {
    console.error(err);
    process.exit(1);
});
}
