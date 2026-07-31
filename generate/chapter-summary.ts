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
    chapterStart: number | null;
    chapterEnd: number | null;
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
 */
const SPEC: Record<string, FlagSpec> = {
    language: COMMON_FLAGS.language,   // 'nb' → normalizeLanguage → 'Norwegian bokmål', som før
    book: COMMON_FLAGS.book,
    chapter: COMMON_FLAGS.chapter,
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

// Get summary generation prompt
function getSummaryPrompt(language: string, bookId: number, chapter: number, originalText: string): string {
    const bookName = getBookName(bookId, language);
    const bibleRef = `${bookName} ${chapter}`;
    const langCode = getLanguageCode(language);
    const originalLanguage = bookId <= 39 ? 'hebraisk' : 'gresk';
    const originalLanguageEn = bookId <= 39 ? 'Hebrew' : 'Greek';

    const structureNb = `Bruk følgende struktur:

**Hovedtema:** Én setning som oppsummerer hva kapitlet handler om.

**Innhold:** Ett kort avsnitt (maks 3-5 setninger) som oppsummerer hovedinnholdet. Vær konsis – ikke gjenfortell hele kapitlet vers for vers. Referer til versgrupper i parentes, f.eks. (v. 1-3). Hvis innholdet er naturlig sekvensielt (som skapelsesdagene eller de ti bud), kan du bruke en kort nummerert liste i stedet.

**Nøkkelord/bilder:** 3-5 viktige begreper, symboler eller bilder i teksten med kort forklaring (én setning hver).`;

    const structureNn = `Bruk følgjande struktur:

**Hovudtema:** Éi setning som oppsummerer kva kapitlet handlar om.

**Innhald:** Eitt kort avsnitt (maks 3-5 setningar) som oppsummerer hovudinnhaldet. Ver kortfatta – ikkje gjenfortell heile kapitlet vers for vers. Referer til versgrupper i parentes, t.d. (v. 1-3). Dersom innhaldet er naturleg sekvensielt (som skapingsdagane eller dei ti boda), kan du bruke ei kort nummerert liste i staden.

**Nøkkelord/bilete:** 3-5 viktige omgrep, symbol eller bilete i teksten med kort forklaring (éi setning kvar).`;

    const structureEn = `Use the following structure:

**Main theme:** One sentence summarizing what the chapter is about.

**Content:** One short paragraph (max 3-5 sentences) summarizing the main content. Be concise – do not retell the entire chapter verse by verse. Reference verse groups in parentheses, e.g. (v. 1-3). If the content is naturally sequential (like the days of creation or the ten commandments), you may use a short numbered list instead.

**Key words/images:** 3-5 important concepts, symbols or images in the text with brief explanation (one sentence each).`;

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
        return `Lag et sammendrag av ${bibleRef} på norsk, bokmål.

${structureNb}

${refFormatNb}

Her er den ${originalLanguage}e originalteksten:
${originalText}`;
    } else if (langCode === 'nn') {
        return `Lag eit samandrag av ${bibleRef} på norsk, nynorsk.

${structureNn}

${refFormatNn}

Her er den ${originalLanguage}e originalteksten:
${originalText}`;
    } else {
        return `Write a summary of ${bibleRef} in ${language}.

${structureEn}

${refFormatEn}

Here is the original ${originalLanguageEn} text:
${originalText}`;
    }
}

// Proofread prompt for summaries
function getProofreadPrompt(language: string, bookId: number, chapter: number, currentSummary: string, originalText: string): string {
    const bookName = getBookName(bookId, language);
    const bibleRef = `${bookName} ${chapter}`;
    const langCode = getLanguageCode(language);
    const originalLanguage = bookId <= 39 ? 'hebraisk' : 'gresk';
    const originalLanguageEn = bookId <= 39 ? 'Hebrew' : 'Greek';

    let basePrompt: string;
    let structureReminder: string;

    if (langCode === 'nb') {
        basePrompt = `Du er en korrekturleser for bibelsammendrag. Gå gjennom følgende sammendrag av ${bibleRef}.
Du får også den ${originalLanguage}e originalteksten for å verifisere nøyaktigheten.`;
        structureReminder = `VIKTIG: Sammendraget MÅ beholde følgende struktur og lengde:
- **Hovedtema:** (én setning)
- **Innhold:** (maks 3-5 setninger – vær konsis, ikke gjenfortell vers for vers)
- **Nøkkelord/bilder:** (3-5 begreper med én setning forklaring hver)

Hvis det nåværende sammendraget mangler strukturen eller er for langt, må revisedSummary korrigere dette.
- ALDRI nevn spesifikke bibelutgaver, bibelselskap eller forlag (f.eks. "Bibelen 2011", "Bibelselskapet", "NIV", "ESV"). Skriv nøytralt uten referanse til bestemte oversettelser eller organisasjoner.`;
    } else if (langCode === 'nn') {
        basePrompt = `Du er ein korrekturlesar for bibelsamandrag. Gå gjennom følgjande samandrag av ${bibleRef}.
Du får også den ${originalLanguage}e originalteksten for å verifisere nøyaktigheita.`;
        structureReminder = `VIKTIG: Samandraget MÅ behalde følgjande struktur og lengd:
- **Hovudtema:** (éi setning)
- **Innhald:** (maks 3-5 setningar – ver kortfatta, ikkje gjenfortell vers for vers)
- **Nøkkelord/bilete:** (3-5 omgrep med éi setning forklaring kvar)

Dersom det noverande samandraget manglar strukturen eller er for langt, må revisedSummary korrigere dette.
- ALDRI nemn spesifikke bibelutgåver, bibelselskap eller forlag (t.d. "Bibelen 2011", "Bibelselskapet", "NIV", "ESV"). Skriv nøytralt utan referanse til bestemte omsetjingar eller organisasjonar.`;
    } else {
        basePrompt = `You are a proofreader for Bible summaries. Review the following summary of ${bibleRef}.
You are also given the original ${originalLanguageEn} text to verify accuracy.`;
        structureReminder = `IMPORTANT: The summary MUST maintain this structure and length:
- **Main theme:** (one sentence)
- **Content:** (max 3-5 sentences – be concise, do not retell verse by verse)
- **Key words/images:** (3-5 concepts with one sentence explanation each)

If the current summary lacks the structure or is too long, revisedSummary must correct this.
- NEVER mention specific Bible editions, Bible societies, or publishers (e.g., "NIV", "ESV", "KJV", "Bibelen 2011", "Bibelselskapet"). Write neutrally without referencing specific translations or organizations.`;
    }

    return `${basePrompt}

Your task is to review the summary and identify:
- Factual errors or inaccuracies compared to the original text
- Missing important points that should be included
- Awkward phrasing that could be improved
- Grammar or spelling errors
- Theological concerns
- Missing or incorrect structure

${structureReminder}

REFERANSEFORMAT:
Bibelreferanser i teksten bruker formatet: [ref:FORKORTELSE KAPITTEL:VERS|VISNINGSTEKST]
Eksempel: [ref:Joh 3:16|Johannes 3:16]. Bevar dette formatet i revisedSummary.
Bruk KVN-forkortelser (1 Mos, Sal, Joh, Åp osv.) i ref-delen og fullt boknavn i visningsteksten.

IMPORTANT:
- If the current summary is good and has no issues, return an empty issues array and no revisedSummary
- The revisedSummary MUST use the required structure (Hovedtema/Innhold/Nøkkelord)
- Focus on accuracy and faithfulness to the biblical text

Original text:
${originalText}

Current summary:
${currentSummary}`;
}

function getOutputPath(language: string, bookId: number, chapterId: number): string {
    const langCode = getLanguageCode(language);
    return path.join(__dirname, `chapter_summaries/${langCode}/${bookId}-${chapterId}.md`);
}

function getProofreadPath(language: string, bookId: number, chapterId: number): string {
    const langCode = getLanguageCode(language);
    return path.join(__dirname, `proofread_summaries/${langCode}/${bookId}-${chapterId}.json`);
}

function fileExists(filepath: string): boolean {
    return fs.existsSync(filepath) && fs.statSync(filepath).size > 0;
}

async function generateChapterSummary(language: string, bookId: number, chapter: number, filename: string): Promise<void> {
    const bookName = getBookName(bookId, language);

    // Read the original text
    const originalText = readOriginalChapter(bookId, chapter);
    if (!originalText) {
        console.log(`Skipping ${bookName} ${chapter} (no original text found)`);
        return;
    }

    const prompt = getSummaryPrompt(language, bookId, chapter, originalText);

    console.log(`Generating summary for ${bookName} ${chapter}...`);
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

async function proofreadChapterSummary(language: string, bookId: number, chapter: number, summaryFilename: string, saveToFile: boolean = true): Promise<ProofreadSummaryResult | null> {
    if (!fileExists(summaryFilename)) {
        console.log(`No summary file found for ${bookId}:${chapter}`);
        return null;
    }

    const bookName = getBookName(bookId, language);

    // Read the original text for verification
    const originalText = readOriginalChapter(bookId, chapter);
    if (!originalText) {
        console.log(`Skipping proofread for ${bookName} ${chapter} (no original text found)`);
        return null;
    }

    const currentSummary = fs.readFileSync(summaryFilename, 'utf-8');

    console.log(`Proofreading summary for ${bookName} ${chapter}...`);

    const prompt = getProofreadPrompt(language, bookId, chapter, currentSummary, originalText);
    const result = await callWithRetry(prompt, {schema: PROOFREAD_SUMMARY_SCHEMA, local: useLocal, context: `proofread ${bookId}:${chapter}`}) as ProofreadSummaryResult;

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

function applyProofreadChanges(language: string, bookId: number, chapter: number, summaryFilename: string, proofreadResult: ProofreadSummaryResult | null = null): void {
    // Load proofread result from file if not provided
    if (!proofreadResult) {
        const proofreadFile = getProofreadPath(language, bookId, chapter);
        if (!fileExists(proofreadFile)) {
            console.log(`No proofread file found for ${bookId}:${chapter}`);
            return;
        }
        proofreadResult = JSON.parse(fs.readFileSync(proofreadFile, 'utf-8')) as ProofreadSummaryResult;
    }

    if (!fileExists(summaryFilename)) {
        console.log(`No summary file found for ${bookId}:${chapter}`);
        return;
    }

    // Check if there's a revised summary to apply
    if (!proofreadResult.revisedSummary || proofreadResult.revisedSummary.trim() === '') {
        console.log(`No revisions needed for ${bookId}:${chapter}`);
        return;
    }

    // Write the revised summary
    fs.writeFileSync(summaryFilename, proofreadResult.revisedSummary);
    const bookName = getBookName(bookId, language);
    console.log(`Applied revisions to ${bookName} ${chapter}`);
}

const HELP_EXAMPLES = [
    'bun generate/chapter-summary.ts --nt                              # NT, norsk bokmål',
    'bun generate/chapter-summary.ts --language nn --ot                # GT, nynorsk',
    'bun generate/chapter-summary.ts --language en --book 43           # Johannes, engelsk',
    'bun generate/chapter-summary.ts --book 43 --chapter 1-11          # Johannes 1-11',
    'bun generate/chapter-summary.ts --nt --proofread --apply          # generer → korrektur → skriv inn',
    'bun generate/chapter-summary.ts --book 1 --force                  # lag 1. Mosebok på nytt',
    'bun generate/chapter-summary.ts --local --book 1-20               # lokal Ollama i stedet for Claude',
    '',
    'Sammendragene havner i chapter_summaries/<språkkode>/<bok>-<kapittel>.md,',
    'f.eks. chapter_summaries/nb/43-1.md. Korrekturen legges i',
    'proofread_summaries/<språkkode>/<bok>-<kapittel>.json når --apply ikke er med.',
];

/** Oversetter de tolkede flaggene til `Options`. */
function readOptions(flags: ReturnType<typeof parseArgs>['flags']): Options {
    const book = flags.book as Range | undefined;
    const chapter = flags.chapter as Range | undefined;

    return {
        // Godtar både koder ('nb') og fulle navn ('Norwegian bokmål'), som før.
        language: normalizeLanguage(flags.language as string),
        proofread: flags.proofread as boolean,
        apply: flags.apply as boolean,
        ot: flags.ot as boolean,
        nt: flags.nt as boolean,
        bookStart: book?.start ?? null,
        bookEnd: book?.end ?? null,
        chapterStart: chapter?.start ?? null,
        chapterEnd: chapter?.end ?? null,
        force: flags.force as boolean,
        local: flags.local as boolean,
    };
}

async function main(): Promise<void> {
    // Hjelpen skal ut før noe leses fra disk eller sendes over nettet.
    const {flags} = parseArgs(process.argv.slice(2), SPEC);
    if (flags.help) {
        console.log(formatHelp(
            'generate/chapter-summary.ts',
            'sammendrag per kapittel, generert og korrekturlest av en modell',
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
                await generateChapterSummary(options.language, bookId, chapterId, filename);
            } else {
                const bookName = getBookName(bookId, options.language);
                console.log(`Skipping ${bookName} ${chapterId} (already exists)`);
            }

            // Step 2: Proofread (if requested)
            let proofreadResult: ProofreadSummaryResult | null = null;
            if (options.proofread && fileExists(filename)) {
                const saveToFile = !options.apply;
                proofreadResult = await proofreadChapterSummary(options.language, bookId, chapterId, filename, saveToFile);
            }

            // Step 3: Apply (if requested)
            if (options.apply) {
                applyProofreadChanges(options.language, bookId, chapterId, filename, proofreadResult);
            }
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
