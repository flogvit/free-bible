import "./env.js";
import * as fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';

import {parseArgs, formatHelp, COMMON_FLAGS} from './cli.js';
import type {FlagSpec, Range} from './cli.js';
import {books, normalizeLanguage, getLanguageCode, getBookName} from "./constants.js";
import {callWithRetry} from "./llm.js";

/**
 * Flaggkontrakten for dette skriptet (#51, #52, #53).
 *
 * `--local` sto ikke i den gamle bruksmeldingen selv om parseren tok imot det.
 * Uten flagget går hele jobben på Claude API, og valget havner ikke i de
 * genererte .md-filene — så en glemt `--local` kan ikke finnes i ettertid.
 * Nå står det i `--help` som alle de andre.
 *
 * Ingen `--chapter` her med vilje: bok-konteksten gjelder hele boka, og
 * kapittelnivået er chapter-context.ts sin jobb.
 */
const SPEC: Record<string, FlagSpec> = {
    language: COMMON_FLAGS.language,   // 'nb' → normalizeLanguage → 'Norwegian bokmål', som før
    book: COMMON_FLAGS.book,
    ot: COMMON_FLAGS.ot,
    nt: COMMON_FLAGS.nt,
    force: COMMON_FLAGS.force,
    local: COMMON_FLAGS.local,
    proofread: {kind: 'boolean', help: 'kjør korrektur etter genereringen'},
    apply: {kind: 'boolean', help: 'skriv korrekturens reviderte kontekst tilbake til fila'},
    help: COMMON_FLAGS.help,
};

const HELP_PURPOSE =
    'historisk og kulturell kontekst på boknivå for bibelbøkene. Gjelder hele ' +
    'boka; kapittel-spesifikk kontekst skrives av chapter-context.ts, som ' +
    'leser denne som bakgrunn.';

const HELP_EXAMPLES = [
    'bun generate/book-context.ts --nt                         # NT, norsk bokmål',
    'bun generate/book-context.ts --language nn --ot           # GT, nynorsk',
    'bun generate/book-context.ts --language en --book 43      # Johannes, engelsk',
    'bun generate/book-context.ts --book 1-5                   # Mosebøkene',
    'bun generate/book-context.ts --nt --proofread --apply     # generer → korrektur → skriv inn',
    'bun generate/book-context.ts --local --book 10-39         # lokal Ollama i stedet for Claude',
    'bun generate/book-context.ts --book 1 --force             # generer 1. Mosebok på nytt',
    '',
    'Filene havner i book_context/<språkkode>/<bok>.md,',
    'f.eks. book_context/nb/1.md (1. Mosebok).',
    '',
    'Parallellkjøring i hver sin terminal:',
    '  bun generate/book-context.ts --book 1-20 &',
    '  bun generate/book-context.ts --book 21-39 &',
];

/**
 * Hjelpesjekken står FØRST, før .env-lasting og før noe som helst arbeid: `--help`
 * skal svare selv om .env mangler eller datakatalogene ikke finnes.
 */
const {flags} = parseArgs(process.argv.slice(2), SPEC);
if (flags.help) {
    console.log(formatHelp('generate/book-context.ts', HELP_PURPOSE, SPEC, HELP_EXAMPLES));
    process.exit(0);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const useLocal = flags.local as boolean;

/**
 * Én funn-post fra korrekturen, slik `PROOFREAD_CONTEXT_SCHEMA` under krever.
 * Enum-verdiene er duplisert med vilje: JSON-skjemaet er avtalen med modellen,
 * typen er den samme avtalen for kompilatoren.
 */
interface ProofreadIssue {
    type: 'error' | 'suggestion' | 'factual' | 'grammar' | 'structure' | 'scope';
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

const PROOFREAD_CONTEXT_SCHEMA = {
    type: "object",
    properties: {
        issues: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    type: {type: "string", enum: ["error", "suggestion", "factual", "grammar", "structure", "scope"]},
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

// Get book context generation prompt
function getContextPrompt(language: string, bookId: number): string {
    const bookName = getBookName(bookId, language);
    const book = books.find(b => b.id === bookId);
    // `!` er en ren typepåstand: fantes ikke bok-id-en i `books`, kastet denne
    // linja på `.chapters` også før typene kom til.
    const chapterCount = book!.chapters;
    const langCode = getLanguageCode(language);

    const structureNb = `Skriv historisk og kulturell kontekst for hele ${bookName} (${chapterCount} kapitler) på norsk, bokmål.

VIKTIG: Dette er bok-nivå kontekst som gjelder for hele boken. Kapittel-spesifikk kontekst skrives separat. Fokuser på informasjon som er relevant for å forstå boken som helhet.

Bruk følgende struktur:

## Historisk ramme
Beskriv i 2-3 avsnitt:
- Bokens datering og forfatterskap (inkludert kildeteorier der relevant)
- Den historiske perioden boken beskriver vs. når den ble skrevet
- Politisk og religiøs situasjon i perioden

## Litterær kontekst
Beskriv i 1-2 avsnitt:
- Bokens sjanger og litterære stil
- Bokens plass i Bibelen og kanon
- Hvordan boken er strukturert

## Kulturell bakgrunn
Beskriv i 2-3 avsnitt:
- Samfunnsstruktur og dagligliv i perioden
- Religiøs praksis og verdensbilde
- Forholdet til omkringliggende kulturer og religioner

## Arkeologi og historiske kilder
List 3-5 viktige arkeologiske funn eller historiske kilder som belyser bokens periode eller innhold. For hvert funn, gi:
- Navn og datering
- Hvor det ble funnet
- Hvordan det belyser boken`;

    const structureNn = `Skriv historisk og kulturell kontekst for heile ${bookName} (${chapterCount} kapittel) på norsk, nynorsk.

VIKTIG: Dette er bok-nivå kontekst som gjeld for heile boka. Kapittel-spesifikk kontekst blir skrive separat. Fokuser på informasjon som er relevant for å forstå boka som heilskap.

Bruk følgjande struktur:

## Historisk ramme
Beskriv i 2-3 avsnitt:
- Boka si datering og forfattarskap (inkludert kjeldeteoriar der relevant)
- Den historiske perioden boka skildrar vs. når ho vart skriven
- Politisk og religiøs situasjon i perioden

## Litterær kontekst
Beskriv i 1-2 avsnitt:
- Boka sin sjanger og litterære stil
- Boka sin plass i Bibelen og kanon
- Korleis boka er strukturert

## Kulturell bakgrunn
Beskriv i 2-3 avsnitt:
- Samfunnsstruktur og daglegliv i perioden
- Religiøs praksis og verdsbilde
- Forholdet til omkringliggjande kulturar og religionar

## Arkeologi og historiske kjelder
List 3-5 viktige arkeologiske funn eller historiske kjelder som kastar lys over boka sin periode eller innhald. For kvart funn, gi:
- Namn og datering
- Kvar det vart funne
- Korleis det kastar lys over boka`;

    const structureEn = `Write historical and cultural context for the entire book of ${bookName} (${chapterCount} chapters) in English.

IMPORTANT: This is book-level context that applies to the entire book. Chapter-specific context is written separately. Focus on information relevant to understanding the book as a whole.

Use the following structure:

## Historical Framework
Describe in 2-3 paragraphs:
- The book's dating and authorship (including source theories where relevant)
- The historical period the book describes vs. when it was written
- Political and religious situation in the period

## Literary Context
Describe in 1-2 paragraphs:
- The book's genre and literary style
- The book's place in the Bible and canon
- How the book is structured

## Cultural Background
Describe in 2-3 paragraphs:
- Social structure and daily life in the period
- Religious practice and worldview
- Relationship to surrounding cultures and religions

## Archaeology and Historical Sources
List 3-5 important archaeological finds or historical sources that illuminate the book's period or content. For each find, provide:
- Name and dating
- Where it was found
- How it illuminates the book`;

    const refFormatNb = `\n\nREFERANSEFORMAT:
Når du refererer til bibelsteder, bruk formatet: [ref:FORKORTELSE KAPITTEL:VERS|VISNINGSTEKST]
Eksempel: [ref:Joh 3:16|Johannes 3:16], [ref:1 Mos 1:1-3|1. Mosebok 1:1-3]
Bruk KVN-forkortelser (1 Mos, Sal, Joh, Åp osv.) i ref-delen og fullt boknavn i visningsteksten.`;

    const refFormatNn = `\n\nREFERANSEFORMAT:
Når du refererer til bibelstader, bruk formatet: [ref:FORKORTING KAPITTEL:VERS|VISNINGSTEKST]
Eksempel: [ref:Joh 3:16|Johannes 3:16], [ref:1 Mos 1:1-3|1. Mosebok 1:1-3]
Bruk KVN-forkortingar (1 Mos, Sal, Joh, Åp osv.) i ref-delen og fullt boknamn i visningsteksten.`;

    const refFormatEn = `\n\nREFERENCE FORMAT:
When referring to Bible passages, use the format: [ref:ABBREVIATION CHAPTER:VERSE|DISPLAY TEXT]
Example: [ref:Joh 3:16|John 3:16], [ref:1 Mos 1:1-3|Genesis 1:1-3]
Use KVN abbreviations (1 Mos, Sal, Joh, Åp etc.) in the ref part and full book name in the display text.`;

    if (langCode === 'nb') {
        return structureNb + refFormatNb;
    } else if (langCode === 'nn') {
        return structureNn + refFormatNn;
    } else {
        return structureEn + refFormatEn;
    }
}

// Proofread prompt for book context
function getProofreadPrompt(language: string, bookId: number, currentContext: string): string {
    const bookName = getBookName(bookId, language);
    const langCode = getLanguageCode(language);

    let basePrompt: string;
    let structureReminder: string;

    if (langCode === 'nb') {
        basePrompt = `Du er en korrekturleser for bibelkontekst. Gå gjennom følgende bok-kontekst for ${bookName}.`;
        structureReminder = `VIKTIG: Konteksten MÅ beholde følgende struktur:
- ## Historisk ramme (2-3 avsnitt)
- ## Litterær kontekst (1-2 avsnitt)
- ## Kulturell bakgrunn (2-3 avsnitt)
- ## Arkeologi og historiske kilder (3-5 funn med detaljer)

Hvis konteksten mangler strukturen eller har faktafeil, må revisedContext korrigere dette.
- ALDRI nevn spesifikke bibelutgaver, bibelselskap eller forlag (f.eks. "Bibelen 2011", "Bibelselskapet", "NIV", "ESV"). Skriv nøytralt uten referanse til bestemte oversettelser eller organisasjoner.`;
    } else if (langCode === 'nn') {
        basePrompt = `Du er ein korrekturlesar for bibelkontekst. Gå gjennom følgjande bok-kontekst for ${bookName}.`;
        structureReminder = `VIKTIG: Konteksten MÅ behalde følgjande struktur:
- ## Historisk ramme (2-3 avsnitt)
- ## Litterær kontekst (1-2 avsnitt)
- ## Kulturell bakgrunn (2-3 avsnitt)
- ## Arkeologi og historiske kjelder (3-5 funn med detaljar)

Dersom konteksten manglar strukturen eller har faktafeil, må revisedContext korrigere dette.
- ALDRI nemn spesifikke bibelutgåver, bibelselskap eller forlag (t.d. "Bibelen 2011", "Bibelselskapet", "NIV", "ESV"). Skriv nøytralt utan referanse til bestemte omsetjingar eller organisasjonar.`;
    } else {
        basePrompt = `You are a proofreader for Bible context. Review the following book-level context for ${bookName}.`;
        structureReminder = `IMPORTANT: The context MUST maintain this structure:
- ## Historical Framework (2-3 paragraphs)
- ## Literary Context (1-2 paragraphs)
- ## Cultural Background (2-3 paragraphs)
- ## Archaeology and Historical Sources (3-5 finds with details)

If the context lacks the structure or has factual errors, revisedContext must correct this.
- NEVER mention specific Bible editions, Bible societies, or publishers (e.g., "NIV", "ESV", "KJV", "Bibelen 2011", "Bibelselskapet"). Write neutrally without referencing specific translations or organizations.`;
    }

    return `${basePrompt}

Your task is to review the context and identify:
- Factual errors or inaccuracies (dates, names, archaeological claims)
- Missing important information that should be included at book level
- Information that is too chapter-specific and should be moved to chapter context
- Awkward phrasing that could be improved
- Grammar or spelling errors
- Missing or incorrect structure

${structureReminder}

REFERANSEFORMAT:
Bibelreferanser i teksten bruker formatet: [ref:FORKORTELSE KAPITTEL:VERS|VISNINGSTEKST]
Eksempel: [ref:Joh 3:16|Johannes 3:16]. Bevar dette formatet i revisedContext.
Bruk KVN-forkortelser (1 Mos, Sal, Joh, Åp osv.) i ref-delen og fullt boknavn i visningsteksten.

IMPORTANT:
- If the current context is good and has no issues, return an empty issues array and no revisedContext
- The revisedContext MUST use the required structure
- Focus on accuracy and factual correctness
- Flag any claims that seem dubious or need verification

Current context:
${currentContext}`;
}

function getOutputPath(language: string, bookId: number): string {
    const langCode = getLanguageCode(language);
    return path.join(__dirname, `book_context/${langCode}/${bookId}.md`);
}

function getProofreadPath(language: string, bookId: number): string {
    const langCode = getLanguageCode(language);
    return path.join(__dirname, `proofread_book_context/${langCode}/${bookId}.json`);
}

function fileExists(filepath: string): boolean {
    return fs.existsSync(filepath) && fs.statSync(filepath).size > 0;
}

async function generateBookContext(language: string, bookId: number, filename: string): Promise<void> {
    const bookName = getBookName(bookId, language);
    const prompt = getContextPrompt(language, bookId);

    console.log(`Generating context for ${bookName}...`);
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

async function proofreadBookContext(language: string, bookId: number, contextFilename: string, saveToFile: boolean = true): Promise<ProofreadContextResult | null> {
    if (!fileExists(contextFilename)) {
        console.log(`No context file found for book ${bookId}`);
        return null;
    }

    const bookName = getBookName(bookId, language);
    const currentContext = fs.readFileSync(contextFilename, 'utf-8');

    console.log(`Proofreading context for ${bookName}...`);

    const prompt = getProofreadPrompt(language, bookId, currentContext);
    const result = await callWithRetry(prompt, {schema: PROOFREAD_CONTEXT_SCHEMA, local: useLocal, context: `proofread book ${bookId}`}) as ProofreadContextResult;

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

function applyProofreadChanges(language: string, bookId: number, contextFilename: string, proofreadResult: ProofreadContextResult | null = null): void {
    // Load proofread result from file if not provided
    if (!proofreadResult) {
        const proofreadFile = getProofreadPath(language, bookId);
        if (!fileExists(proofreadFile)) {
            console.log(`No proofread file found for book ${bookId}`);
            return;
        }
        proofreadResult = JSON.parse(fs.readFileSync(proofreadFile, 'utf-8')) as ProofreadContextResult;
    }

    if (!fileExists(contextFilename)) {
        console.log(`No context file found for book ${bookId}`);
        return;
    }

    // Check if there's a revised context to apply
    if (!proofreadResult.revisedContext || proofreadResult.revisedContext.trim() === '') {
        console.log(`No revisions needed for book ${bookId}`);
        return;
    }

    // Write the revised context
    fs.writeFileSync(contextFilename, proofreadResult.revisedContext);
    const bookName = getBookName(bookId, language);
    console.log(`Applied revisions to ${bookName}`);
}

/** Oversetter de tolkede flaggene til `Options`. */
function readOptions(parsed: typeof flags): Options {
    const book = parsed.book as Range | undefined;

    return {
        // Godtar både kode ('nb') og fullt navn ('Norwegian bokmål'), som før.
        language: normalizeLanguage(parsed.language as string),
        proofread: parsed.proofread as boolean,
        apply: parsed.apply as boolean,
        ot: parsed.ot as boolean,
        nt: parsed.nt as boolean,
        bookStart: book?.start ?? null,
        bookEnd: book?.end ?? null,
        force: parsed.force as boolean,
        local: parsed.local as boolean,
    };
}

async function main(): Promise<void> {
    const options = readOptions(flags);

    // Determine book range
    let startBook = 1;
    let endBook = 66;

    if (options.bookStart !== null) {
        startBook = options.bookStart;
        // `bookEnd` settes alltid sammen med `bookStart` — kontraktens `Range`
        // har begge feltene — så grenen her kan ikke se `null`. Kompilatoren
        // kan ikke se koblingen.
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
            await generateBookContext(options.language, bookId, filename);
        } else {
            const bookName = getBookName(bookId, options.language);
            console.log(`Skipping ${bookName} (already exists)`);
        }

        // Step 2: Proofread (if requested)
        let proofreadResult: ProofreadContextResult | null = null;
        if (options.proofread && fileExists(filename)) {
            const saveToFile = !options.apply;
            proofreadResult = await proofreadBookContext(options.language, bookId, filename, saveToFile);
        }

        // Step 3: Apply (if requested)
        if (options.apply) {
            applyProofreadChanges(options.language, bookId, filename, proofreadResult);
        }
    }

    console.log('Done!');
}

// Kjører bare når fila startes direkte. Uten vakten kjører jobben ved IMPORT —
// det er grunnen til at days.ts slettet data bare man lastet modulen (#108),
// og det gjør skriptene umulige å teste.
if (import.meta.main) {
    main().catch(console.error);
}
