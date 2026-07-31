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

/** Hvor sentral teksten er for dagen. Engelske identifikatorer, som i skjemaene. */
type Relevance = 'primary' | 'secondary';

/**
 * En henvisning fra en dagdefinisjon til et versintervall.
 *
 * Samme dag kan ha flere oppføringer i samme kapittel — se `getTagPrompt`.
 */
interface DayReference {
    bookId: number;
    chapterId: number;
    fromVerseId: number;
    toVerseId: number;
    relevance: Relevance;
    reason: string;
}

/**
 * Innholdet i `days/<lang>/<dagId>.json`.
 *
 * `dates` er årstall → ISO-dato for de bevegelige dagene; nøklene er år, så
 * oppslaget er dynamisk og trenger `Record`.
 */
interface DayDefinition {
    id: string;
    name: string;
    description: string;
    category?: string;
    biblicalBasis?: string;
    significance?: string;
    liturgicalContext?: string;
    history?: string;
    otConnections?: string;
    dates?: Record<string, string>;
    references?: DayReference[];
}

/** Én kobling kapittel → dag, slik modellen svarer den (`DAY_TAG_SCHEMA`). */
interface DayTag {
    id: string;
    fromVerseId: number;
    toVerseId: number;
    relevance: Relevance;
    reason: string;
}

/** En tidligere runde med tagging, lagret av korrektur-løkka. */
interface DayTagVersion {
    days: DayTag[];
    score: number;
    reason: string;
    date: string;
}

/** Innholdet i `day_tags/<lang>/<bookId>/<chapterId>.json`. */
interface ChapterDayTags {
    days: DayTag[];
    _versions?: DayTagVersion[];
}

/** Ett funn fra korrekturen (`PROOFREAD_SCHEMA`). */
interface ProofreadIssue {
    type: 'false_positive' | 'missing' | 'wrong_relevance' | 'bad_reason';
    dayId: string;
    severity: 'critical' | 'major' | 'minor';
    explanation: string;
}

/** Svaret fra korrekturen (`PROOFREAD_SCHEMA`). */
interface ProofreadResult {
    issues: ProofreadIssue[];
    score: number;
    revised: DayTag[];
}

// === Load day definitions ===

function loadDays(langCode: string): DayDefinition[] {
    const dayDir = path.join(__dirname, 'days', langCode);
    if (!fs.existsSync(dayDir)) {
        console.error(`Day directory not found: ${dayDir}`);
        return [];
    }
    const files = fs.readdirSync(dayDir).filter(f => f.endsWith('.json'));
    return files.map(f => JSON.parse(fs.readFileSync(path.join(dayDir, f), 'utf-8')));
}

// === Schema for LLM response ===

const DAY_TAG_SCHEMA = {
    type: "object",
    properties: {
        days: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    id: {type: "string"},
                    fromVerseId: {type: "integer"},
                    toVerseId: {type: "integer"},
                    relevance: {type: "string", enum: ["primary", "secondary"]},
                    reason: {type: "string"}
                },
                required: ["id", "fromVerseId", "toVerseId", "relevance", "reason"],
                additionalProperties: false
            }
        }
    },
    required: ["days"],
    additionalProperties: false
};

const PROOFREAD_SCHEMA = {
    type: "object",
    properties: {
        issues: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    type: {type: "string", enum: ["false_positive", "missing", "wrong_relevance", "bad_reason"]},
                    dayId: {type: "string"},
                    severity: {type: "string", enum: ["critical", "major", "minor"]},
                    explanation: {type: "string"}
                },
                required: ["type", "dayId", "severity", "explanation"],
                additionalProperties: false
            }
        },
        score: {type: "integer"},
        revised: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    id: {type: "string"},
                    fromVerseId: {type: "integer"},
                    toVerseId: {type: "integer"},
                    relevance: {type: "string", enum: ["primary", "secondary"]},
                    reason: {type: "string"}
                },
                required: ["id", "fromVerseId", "toVerseId", "relevance", "reason"],
                additionalProperties: false
            }
        }
    },
    required: ["issues", "score", "revised"],
    additionalProperties: false
};

// === Read chapter text ===

function readTranslatedChapter(bible: string, bookId: number, chapterId: number): string | null {
    const file = path.join(__dirname, `bibles_raw/${bible}/${bookId}/${chapterId}.json`);
    if (!fs.existsSync(file)) return null;
    const verses: Chapter = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return verses.map(v => `${v.verseId}: ${v.text}`).join('\n');
}

function readOriginalChapter(bookId: number, chapterId: number): string | null {
    const source = bookId <= 39 ? 'hebrew' : 'sblgnt';
    const file = path.join(__dirname, `bibles_raw/${source}/${bookId}/${chapterId}.json`);
    if (!fs.existsSync(file)) return null;
    const verses: Chapter = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return verses.map(v => `${v.verseId}: ${v.text}`).join('\n');
}

// === Prompts ===

function getTagPrompt(langCode: string, bookName: string, chapterId: number, chapterText: string, days: DayDefinition[]): string {
    const dayList = days.map(d => {
        let entry = `### ${d.id}: ${d.name}\n${d.description}`;
        if (d.biblicalBasis) entry += `\nBibelske tekster: ${d.biblicalBasis}`;
        if (d.significance) entry += `\nBetydning: ${d.significance}`;
        if (d.otConnections) entry += `\nGT-forbilder: ${d.otConnections}`;
        return entry;
    }).join('\n\n');

    if (langCode === 'nb') {
        return `Hvilke av disse kirkelige/bibelske dagene er ${bookName} ${chapterId} relevant for?

DAGER:
${dayList}

REGLER:
- Velg kun dager der teksten har DIREKTE relevans — ikke vage tematiske koblinger
- Angi nøyaktig hvilke vers som er relevante med fromVerseId og toVerseId
- Samme dag kan ha flere oppføringer hvis ulike versgrupper er relevante av ulike grunner
- "primary": versene er en sentral tekst for denne dagen (f.eks. korsfestelsesberetningen for Langfredag)
- "secondary": versene har tydelig relevans men er ikke blant hovedtekstene
- Bedre å velge for få enn for mange. Tom liste er helt greit.
- Skriv en kort begrunnelse (reason) for hver kobling

Teksten:
${chapterText}`;
    } else {
        return `Which of these church/biblical days is ${bookName} ${chapterId} relevant for?

DAYS:
${dayList}

RULES:
- Only select days where the text has DIRECT relevance — not vague thematic connections
- Specify exactly which verses are relevant with fromVerseId and toVerseId
- The same day can have multiple entries if different verse groups are relevant for different reasons
- "primary": the verses are a central text for this day (e.g. the crucifixion narrative for Good Friday)
- "secondary": the verses have clear relevance but are not among the main texts
- Better too few than too many. An empty list is fine.
- Write a short reason for each connection

Text:
${chapterText}`;
    }
}

function getProofreadPrompt(langCode: string, bookName: string, chapterId: number, chapterText: string, currentTags: ChapterDayTags, days: DayDefinition[]): string {
    const dayList = days.map(d => `- ${d.id}: ${d.name} — ${d.description}`).join('\n');
    // Proofread uses compact day list (full context already informed the initial tagging)
    const tagsJson = JSON.stringify(currentTags, null, 2);

    // Build version history context
    let versionContext = '';
    if (currentTags._versions && currentTags._versions.length > 0) {
        const history = currentTags._versions.map((v, i) =>
            `  Versjon ${i + 1}: ${v.days.map(d => d.id).join(', ')} (score: ${v.score})`
        ).join('\n');

        if (langCode === 'nb') {
            versionContext = `\n\nTIDLIGERE VERSJONER (ikke foreslå lignende resultat):
${history}\n`;
        } else {
            versionContext = `\n\nPREVIOUS VERSIONS (do not suggest similar result):
${history}\n`;
        }
    }

    if (langCode === 'nb') {
        return `Du er korrekturleser for dag-tagging av bibelkapitler. Gå gjennom taggingen av ${bookName} ${chapterId}.

TILGJENGELIGE DAGER:
${dayList}

NÅVÆRENDE TAGGING:
${tagsJson}

KONTROLLER:
- Er noen dager feilaktig koblet (false_positive)?
- Mangler det åpenbare koblinger (missing)?
- Er versreferansene (fromVerseId/toVerseId) presise — dekker de riktige vers, ikke for bredt?
- Er relevans-nivået riktig (primary vs secondary)?
- Er begrunnelsene (reason) presise og korrekte?

VIKTIG:
- Kun foreslå endringer ved reelle feil. Ikke endre for å endre.
- score: 0-10 (10 = perfekt)
- revised: den korrigerte listen (kan være identisk med nåværende)
- Hvis ${currentTags._versions?.length || 0} tidligere versjoner finnes, vær strengere
- ALDRI nevn spesifikke bibelutgaver, bibelselskap eller forlag (f.eks. "Bibelen 2011", "Bibelselskapet", "NIV", "ESV"). Skriv nøytralt uten referanse til bestemte oversettelser eller organisasjoner.${versionContext}

Teksten:
${chapterText}`;
    } else {
        return `You are a proofreader for day-tagging of Bible chapters. Review the tagging of ${bookName} ${chapterId}.

AVAILABLE DAYS:
${dayList}

CURRENT TAGGING:
${tagsJson}

CHECK:
- Are any days incorrectly linked (false_positive)?
- Are obvious connections missing (missing)?
- Are the verse references (fromVerseId/toVerseId) precise — covering the right verses, not too broad?
- Is the relevance level correct (primary vs secondary)?
- Are the reasons precise and correct?

IMPORTANT:
- Only suggest changes for real errors. Don't change for the sake of change.
- score: 0-10 (10 = perfect)
- revised: the corrected list (can be identical to current)
- If ${currentTags._versions?.length || 0} previous versions exist, be stricter
- NEVER mention specific Bible editions, Bible societies, or publishers (e.g., "NIV", "ESV", "KJV", "Bibelen 2011", "Bibelselskapet"). Write neutrally without referencing specific translations or organizations.${versionContext}

Text:
${chapterText}`;
    }
}

// === File I/O ===

function ensureDir(filepath: string): void {
    const dir = path.dirname(filepath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, {recursive: true});
}

function getTagFile(langCode: string, bookId: number, chapterId: number): string {
    return path.join(__dirname, `day_tags/${langCode}/${bookId}/${chapterId}.json`);
}

function getProofreadFile(langCode: string, bookId: number, chapterId: number): string {
    return path.join(__dirname, `proofread_day_tags/${langCode}/${bookId}/${chapterId}.json`);
}

// === Update day files with references ===

function updateDayReferences(langCode: string, bookId: number, chapterId: number, dayTags: DayTag[]): void {
    const dayDir = path.join(__dirname, 'days', langCode);

    for (const tag of dayTags) {
        const file = path.join(dayDir, `${tag.id}.json`);
        if (!fs.existsSync(file)) continue;

        const day: DayDefinition = JSON.parse(fs.readFileSync(file, 'utf-8'));
        if (!day.references) day.references = [];

        const refKey = `${bookId}:${chapterId}:${tag.fromVerseId}:${tag.toVerseId}`;
        const exists = day.references.some(r =>
            `${r.bookId}:${r.chapterId}:${r.fromVerseId}:${r.toVerseId}` === refKey
        );
        if (exists) continue;

        day.references.push({
            bookId,
            chapterId,
            fromVerseId: tag.fromVerseId,
            toVerseId: tag.toVerseId,
            relevance: tag.relevance,
            reason: tag.reason
        });

        fs.writeFileSync(file, JSON.stringify(day, null, 2));
    }
}

// Remove old references for a chapter before re-tagging
function removeDayReferences(langCode: string, bookId: number, chapterId: number): void {
    const dayDir = path.join(__dirname, 'days', langCode);
    if (!fs.existsSync(dayDir)) return;

    const files = fs.readdirSync(dayDir).filter(f => f.endsWith('.json'));
    const refKey = `${bookId}:${chapterId}`;

    for (const f of files) {
        const filePath = path.join(dayDir, f);
        const day: DayDefinition = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        if (!day.references) continue;

        const before = day.references.length;
        day.references = day.references.filter(r => `${r.bookId}:${r.chapterId}` !== refKey);
        if (day.references.length < before) {
            fs.writeFileSync(filePath, JSON.stringify(day, null, 2));
        }
    }
}

// === Tag a single chapter ===

// `Partial` fordi standardverdien er `{}`: funksjonen leser bare `language`
// (og `apply` i korrekturen), mens kallerne sender hele flaggobjektet.
async function tagChapter(langCode: string, bible: string, bookId: number, chapterId: number, days: DayDefinition[], options: Partial<DayTagOptions> = {}): Promise<ChapterDayTags | null> {
    const bookName = getBookName(bookId, options.language || 'Norwegian bokmål');

    let chapterText = readTranslatedChapter(bible, bookId, chapterId);
    if (!chapterText) chapterText = readOriginalChapter(bookId, chapterId);
    if (!chapterText) return null;

    const prompt = getTagPrompt(langCode, bookName, chapterId, chapterText, days);
    // `callWithRetry` er typet `object | string`; med skjema er det det dekodede
    // objektet. Påstanden navngir formen `DAY_TAG_SCHEMA` krever.
    const result = await callWithRetry(prompt, {schema: DAY_TAG_SCHEMA, local: useLocal, context: `${bookId}:${chapterId}`}) as ChapterDayTags;

    // Filter out invalid day ids
    const validIds = new Set(days.map(d => d.id));
    result.days = result.days.filter(d => validIds.has(d.id));

    // Save per-chapter tag file
    const tagFile = getTagFile(langCode, bookId, chapterId);
    ensureDir(tagFile);
    fs.writeFileSync(tagFile, JSON.stringify(result, null, 2));

    // Update day reference files
    if (result.days.length > 0) {
        removeDayReferences(langCode, bookId, chapterId);
        updateDayReferences(langCode, bookId, chapterId, result.days);
    }

    return result;
}

// === Proofread ===

async function proofreadChapter(langCode: string, bible: string, bookId: number, chapterId: number, days: DayDefinition[], options: Partial<DayTagOptions> = {}): Promise<ProofreadResult | null> {
    const tagFile = getTagFile(langCode, bookId, chapterId);
    if (!fs.existsSync(tagFile)) return null;

    const currentTags: ChapterDayTags = JSON.parse(fs.readFileSync(tagFile, 'utf-8'));
    if (!currentTags.days || currentTags.days.length === 0) return {score: 10, issues: [], revised: []};

    const bookName = getBookName(bookId, options.language || 'Norwegian bokmål');
    let chapterText = readTranslatedChapter(bible, bookId, chapterId);
    if (!chapterText) chapterText = readOriginalChapter(bookId, chapterId);
    if (!chapterText) return null;

    const prompt = getProofreadPrompt(langCode, bookName, chapterId, chapterText, currentTags, days);
    const result = await callWithRetry(prompt, {schema: PROOFREAD_SCHEMA, local: useLocal, context: `proofread ${bookId}:${chapterId}`}) as ProofreadResult;

    if (!options.apply) {
        const proofFile = getProofreadFile(langCode, bookId, chapterId);
        ensureDir(proofFile);
        fs.writeFileSync(proofFile, JSON.stringify(result, null, 2));
    }

    return result;
}

function applyProofreadChanges(langCode: string, bookId: number, chapterId: number, proofreadResult: ProofreadResult): void {
    const tagFile = getTagFile(langCode, bookId, chapterId);
    if (!fs.existsSync(tagFile)) return;

    const currentTags: ChapterDayTags = JSON.parse(fs.readFileSync(tagFile, 'utf-8'));

    // Check if anything changed
    const currentIds = (currentTags.days || []).map(d => d.id).sort().join(',');
    const revisedIds = (proofreadResult.revised || []).map(d => d.id).sort().join(',');

    if (currentIds !== revisedIds || JSON.stringify(currentTags.days) !== JSON.stringify(proofreadResult.revised)) {
        // Save version history
        if (!currentTags._versions) currentTags._versions = [];
        currentTags._versions.push({
            days: currentTags.days,
            score: proofreadResult.score,
            reason: proofreadResult.issues?.map(i => `[${i.severity}] ${i.explanation}`).join('; ') || '',
            date: new Date().toISOString().split('T')[0]
        });

        currentTags.days = proofreadResult.revised;
        fs.writeFileSync(tagFile, JSON.stringify(currentTags, null, 2));

        // Update day files
        removeDayReferences(langCode, bookId, chapterId);
        if (currentTags.days.length > 0) {
            updateDayReferences(langCode, bookId, chapterId, currentTags.days);
        }
    }
}

// === CLI ===

function countChapters(bookStart: number, bookEnd: number, chapterStart: number | null, chapterEnd: number | null): number {
    let total = 0;
    for (const book of books) {
        if (book.id < bookStart || book.id > bookEnd) continue;
        const startCh = (book.id === bookStart && chapterStart) ? chapterStart : 1;
        const endCh = (book.id === bookEnd && chapterEnd) ? Math.min(chapterEnd, book.chapters) : book.chapters;
        total += endCh - startCh + 1;
    }
    return total;
}

/**
 * Flaggkontrakten for dette skriptet (#51, #52, #53).
 *
 * Samme liste som den gamle bruksmeldingen og den gamle parseren var enige om.
 * `--min-score` og `--max-iter` er skriptets egne — de styrer korrekturløkka —
 * og beholder navnene og standardverdiene de hadde.
 */
const SPEC: Record<string, FlagSpec> = {
    language: COMMON_FLAGS.language,   // 'nb' → normalizeLanguage → 'Norwegian bokmål', som før
    bible: COMMON_FLAGS.bible,
    book: COMMON_FLAGS.book,
    chapter: COMMON_FLAGS.chapter,
    ot: COMMON_FLAGS.ot,
    nt: COMMON_FLAGS.nt,
    local: COMMON_FLAGS.local,
    force: COMMON_FLAGS.force,
    proofread: {kind: 'boolean', help: 'kjør korrektur etter taggingen'},
    apply: {kind: 'boolean', help: 'skriv korrekturens reviderte tagger tilbake til fila'},
    'min-score': {kind: 'number', help: 'laveste godtatte score 0-10 før korrekturen kjøres på nytt', default: 8},
    'max-iter': {kind: 'number', help: 'flest korrekturrunder per kapittel', default: 3},
    help: COMMON_FLAGS.help,
};

const HELP_EXAMPLES = [
    'bun generate/day-tags.ts --bible osnb --book 43                # tagg Johannes',
    'bun generate/day-tags.ts --bible osnb --nt --local             # tagg NT med lokal Ollama',
    'bun generate/day-tags.ts --bible osnb --book 40 --chapter 27   # tagg Matteus 27',
    'bun generate/day-tags.ts --bible osnb --nt --proofread --apply # tagg → korrektur → skriv inn',
    'bun generate/day-tags.ts --bible osnb --force --book 43        # tagg Johannes på nytt',
    '',
    'Taggene havner i day_tags/<språkkode>/<bok>/<kapittel>.json, og',
    'days/<språkkode>/<dagId>.json oppdateres med referansene.',
];

/** Flaggene skriptet kjenner. `null` = ikke oppgitt, ikke «tom». */
interface DayTagOptions {
    language: string;
    bible: string | null;
    bookStart: number | null;
    bookEnd: number | null;
    chapterStart: number | null;
    chapterEnd: number | null;
    local: boolean;
    force: boolean;
    proofread: boolean;
    apply: boolean;
    minScore: number;
    maxIterations: number;
}

/**
 * Leser kommandolinja gjennom den felles kontrakten og oversetter til `DayTagOptions`.
 *
 * `--ot`/`--nt` satte bok-intervallet direkte i den gamle parseren, så det
 * flagget som sto sist på linja vant over `--book`. Rekkefølgen finnes ikke i
 * kontrakten, og et eksplisitt `--book` er det mest presise ønsket — derfor
 * vinner det her. Samme presedens som references.ts.
 */
function readOptions(flags: ReturnType<typeof parseArgs>['flags']): DayTagOptions {
    const book = flags.book as Range | undefined;
    const chapter = flags.chapter as Range | undefined;

    let bookStart = book?.start ?? null;
    let bookEnd = book?.end ?? null;
    if (book === undefined) {
        if (flags.ot && !flags.nt) {
            bookStart = 1;
            bookEnd = 39;
        } else if (flags.nt && !flags.ot) {
            bookStart = 40;
            bookEnd = 66;
        }
    }

    return {
        language: normalizeLanguage(flags.language as string),
        bible: (flags.bible as string | undefined) ?? null,
        bookStart,
        bookEnd,
        chapterStart: chapter?.start ?? null,
        chapterEnd: chapter?.end ?? null,
        local: flags.local as boolean,
        force: flags.force as boolean,
        proofread: flags.proofread as boolean,
        apply: flags.apply as boolean,
        minScore: flags['min-score'] as number,
        maxIterations: flags['max-iter'] as number,
    };
}

async function main(): Promise<void> {
    // Hjelpen skal ut før noe leses fra disk eller sendes over nettet — `loadDays`
    // under leser hele days/<språkkode>/.
    const {flags} = parseArgs(process.argv.slice(2), SPEC);
    if (flags.help) {
        console.log(formatHelp(
            'generate/day-tags.ts',
            'kobler kapitler til kirkelige og bibelske dager, med korrekturløkke',
            SPEC,
            HELP_EXAMPLES,
        ));
        process.exit(0);
    }

    const options = readOptions(flags);
    useLocal = options.local;

    if (!options.bible) {
        console.error('--bible <name> is required (e.g., --bible osnb)');
        return;
    }

    const langCode = getLanguageCode(options.language);
    const days = loadDays(langCode);
    if (days.length === 0) {
        console.error(`No day definitions found for language: ${langCode}`);
        return;
    }

    const bookStart = options.bookStart || 1;
    const bookEnd = options.bookEnd || 66;
    const chapterStart = options.chapterStart || null;
    const chapterEnd = options.chapterEnd || null;

    // Find already-tagged chapters
    const taggedChapters = new Set<string>();
    if (!options.force) {
        const tagDir = path.join(__dirname, 'day_tags', langCode);
        if (fs.existsSync(tagDir)) {
            for (const bookDir of fs.readdirSync(tagDir)) {
                const bookPath = path.join(tagDir, bookDir);
                if (!fs.statSync(bookPath).isDirectory()) continue;
                for (const chFile of fs.readdirSync(bookPath).filter(f => f.endsWith('.json'))) {
                    taggedChapters.add(`${bookDir}:${chFile.replace('.json', '')}`);
                }
            }
        }
    }

    const totalChapters = countChapters(bookStart, bookEnd, chapterStart, chapterEnd);
    const modes = ['Tag'];
    if (options.proofread) modes.push('Proofread');
    if (options.apply) modes.push('Apply');

    console.log(`Day tagging: ${totalChapters} chapters from ${options.bible} (${useLocal ? 'Ollama' : 'Claude'})`);
    console.log(`Mode: ${modes.join(' → ')}`);
    console.log(`Days loaded: ${days.length}`);
    if (bookStart !== 1 || bookEnd !== 66) console.log(`Books: ${bookStart}-${bookEnd}`);
    if (chapterStart) console.log(`Chapters: ${chapterStart}-${chapterEnd}`);
    if (options.proofread && options.apply) {
        console.log(`Feedback loop: min score ${options.minScore}/10, max ${options.maxIterations} iterations`);
    }
    console.log('');

    let processed = 0;
    let tagged = 0;
    let skipped = 0;
    let totalDayTags = 0;
    const startTime = Date.now();

    for (const book of books) {
        if (book.id < bookStart || book.id > bookEnd) continue;

        const bookName = getBookName(book.id, options.language);
        const startCh = (book.id === bookStart && chapterStart) ? chapterStart : 1;
        const endCh = (book.id === bookEnd && chapterEnd) ? Math.min(chapterEnd, book.chapters) : book.chapters;

        for (let chapterId = startCh; chapterId <= endCh; chapterId++) {
            processed++;
            const pct = Math.round((processed / totalChapters) * 100);
            const elapsed = (Date.now() - startTime) / 1000;
            const rate = processed / elapsed || 1;
            const remaining = Math.round((totalChapters - processed) / rate);
            const mins = Math.floor(remaining / 60);
            const secs = remaining % 60;
            process.stdout.write(`\r  [${pct}%] ${processed}/${totalChapters} — ${bookName} ${chapterId} — ${tagged} tagged (${totalDayTags} days) — ~${mins}m${secs}s left${''.padEnd(10)}`);

            // Skip if already tagged
            if (!options.force && taggedChapters.has(`${book.id}:${chapterId}`)) {
                skipped++;
                continue;
            }

            try {
                // Step 1: Tag
                const result = await tagChapter(langCode, options.bible, book.id, chapterId, days, options);
                if (!result) continue;
                tagged++;
                totalDayTags += result.days.length;

                // Step 2: Proofread loop
                if (options.proofread && result.days.length > 0) {
                    let iteration = 0;
                    let lastScore = 0;

                    while (iteration < options.maxIterations) {
                        iteration++;
                        const proofResult = await proofreadChapter(langCode, options.bible, book.id, chapterId, days, options);
                        if (!proofResult) break;

                        lastScore = proofResult.score ?? 10;

                        if (options.apply && proofResult) {
                            applyProofreadChanges(langCode, book.id, chapterId, proofResult);
                        }

                        if (lastScore >= options.minScore) break;

                        if (iteration < options.maxIterations) {
                            process.stdout.write(`\n  Score ${lastScore}/10 < ${options.minScore} — re-proofreading (${iteration + 1}/${options.maxIterations})...`);
                        }
                    }
                }
            } catch (error) {
                process.stdout.write(`\n  Error: ${bookName} ${chapterId}: ${(error as Error).message}\n`);
            }
        }
    }

    process.stdout.write('\r' + ''.padEnd(120) + '\r');
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(`\nDone in ${Math.floor(elapsed / 60)}m${elapsed % 60}s — ${tagged} tagged (${totalDayTags} day connections), ${skipped} skipped`);
}

// Avslutt med kode 1, ikke 0: et ukjent flagg skal stoppe et køskript, ikke bare
// skrive en linje ingen leser. Tidligere var dette `.catch(console.error)`.
// Kjører bare når fila startes direkte. Uten vakten kjører jobben ved IMPORT —
// det er grunnen til at days.ts slettet data bare man lastet modulen (#108),
// og det gjør skriptene umulige å teste.
if (import.meta.main) {
    main().catch(err => {
    console.error(err);
    process.exit(1);
});
}
