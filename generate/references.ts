import "./env.js";
import * as fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import {books, normalizeLanguage, getLanguageCode, getBookName} from "./constants.js";
import {getOriginalVerse, getOriginalChapter, getRef, getOsnb2VerseRange} from "./lib.js";
import {callWithRetry} from "./llm.js";
import {parseArgs, formatHelp, COMMON_FLAGS} from './cli.js';
import type {FlagSpec, Range} from './cli.js';
import type {Chapter} from '../kvn/src/bible-types.js';

/**
 * En kryssreferanse slik den kommer ut av modellen og slik den ligger på disk.
 *
 * Alle felter er valgfrie med vilje: `normalizeReferences` retter opp `verseId`
 * i stedet for `fromVerseId` og fyller inn `toVerseId`, og `checkTarget` er
 * porten som forkaster det som fortsatt mangler. Typen beskriver derfor
 * inndataene, ikke det ferdig normaliserte resultatet.
 */
export interface RawReference {
    bookId?: number;
    chapterId?: number;
    fromVerseId?: number;
    toVerseId?: number;
    /** Modellen skriver av og til `verseId` der `fromVerseId` skal stå. */
    verseId?: number;
    text?: string;
}

/**
 * Måladressen etter at `checkTarget` har fått lov til å anta at feltene finnes.
 * Kontrollene i funksjonen er de som faktisk håndhever det.
 */
interface ReferenceTarget {
    bookId: number;
    chapterId: number;
    fromVerseId: number;
    toVerseId: number;
}

/** Utfallet av adressekontrollen — se `checkTarget`. */
export interface TargetCheck {
    verdict: 'ok' | 'renumber' | 'drop';
    reason?: string;
}

/** Fila på disk: `references/<lang>/<bok>/<kapittel>/<vers>.json`. */
interface ReferenceFile {
    bookId: number;
    chapterId: number;
    verseId: number;
    references: RawReference[];
}

/** Svaret på REFERENCE_SCHEMA. */
interface ReferenceResult {
    references: RawReference[];
}

/** Ett funn fra korrekturen — jf. REFERENCE_PROOFREAD_SCHEMA. */
interface ProofreadIssue {
    type: string;
    severity: string;
    reference?: string;
    explanation: string;
}

/**
 * Én retting fra korrekturen — en operasjon mot lista modellen fikk, ikke en ny liste.
 *
 * `index` er 1-basert og peker på `[N]`-numrene i prompten. Se `applyCorrections`
 * for hvorfor det er operasjoner og ikke en omskrevet liste.
 */
export interface Correction {
    op: 'remove' | 'rewrite' | 'add';
    /** 1-basert, mot lista korrekturen fikk. Kreves for remove og rewrite. */
    index?: number;
    /** Adressefeltene: påkrevd for add, valgfrie for rewrite (bare det som skal endres). */
    bookId?: number;
    chapterId?: number;
    fromVerseId?: number;
    toVerseId?: number;
    /** Forklaringsteksten. Påkrevd for add, valgfri for rewrite. */
    text?: string;
    reason?: string;
}

/** Det `applyCorrections` fikk utført — og det den lot være. */
export interface CorrectionResult {
    references: RawReference[];
    removed: number;
    rewritten: number;
    added: number;
    /** Operasjoner som ikke kunne utføres, med grunn. */
    skipped: string[];
    changed: boolean;
}

/** Svaret på REFERENCE_PROOFREAD_SCHEMA. */
interface ProofreadResult {
    issues?: ProofreadIssue[];
    summary?: string;
    score?: number | null;
    corrections?: Correction[];
    /** Bare i korrekturfiler fra før #121 — se `applyProofreadChanges`. */
    revisedReferences?: RawReference[];
}

/** Slår opp et kapittel, eller gir null om det ikke finnes. */
type ChapterLoader = (bookId: number, chapterId: number) => Chapter | null;

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
    verseStart: number | null;
    verseEnd: number | null;
    force: boolean;
    validate: boolean;
    fix: boolean;
    /** Alltid satt nå — kontrakten initialiserer boolske flagg til `false`. */
    local: boolean;
}

/**
 * Flaggkontrakten for dette skriptet (#51, #52, #53).
 *
 * `--local` sto ikke i den gamle bruksmeldingen selv om parseren tok imot det,
 * og docs/running-jobs.md måtte skrive det opp som en felle: uten flagget går
 * hele jobben på Claude API. Nå står det i `--help` som alle de andre.
 */
const SPEC: Record<string, FlagSpec> = {
    language: COMMON_FLAGS.language,   // 'nb' → normalizeLanguage → 'Norwegian bokmål', som før
    book: COMMON_FLAGS.book,
    chapter: COMMON_FLAGS.chapter,
    verse: COMMON_FLAGS.verse,
    ot: COMMON_FLAGS.ot,
    nt: COMMON_FLAGS.nt,
    force: COMMON_FLAGS.force,
    local: COMMON_FLAGS.local,
    proofread: {kind: 'boolean', help: 'kjør korrektur etter genereringen'},
    apply: {kind: 'boolean', help: 'utfør korrekturens rettinger på referansefila'},
    validate: {kind: 'boolean', help: 'sveip referansene som alt ligger på disk, uten å generere'},
    fix: {kind: 'boolean', help: 'fjern de døde adressene --validate finner'},
    help: COMMON_FLAGS.help,
};

let useLocal = false;

const REFERENCE_SCHEMA = {
    type: "object",
    properties: {
        references: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    bookId: {type: "integer"},
                    chapterId: {type: "integer"},
                    fromVerseId: {type: "integer"},
                    toVerseId: {type: "integer"},
                    text: {type: "string"}
                },
                required: ["bookId", "chapterId", "fromVerseId", "toVerseId", "text"],
                additionalProperties: false
            }
        }
    },
    required: ["references"],
    additionalProperties: false
};

/**
 * Korrekturens svarform.
 *
 * Feltet het `revisedReferences` og var hele lista på nytt. Modellen leste det som
 * «lista», ikke «lista etter retting», og leverte input tilbake: 139 av 140 filer
 * adresselikt med det de fikk, 0 referanser fjernet, mens de samme filene meldte
 * 578 funn (#121). Skjemaet krevde feltet, så det ble alltid fylt — med input.
 *
 * `corrections` er operasjoner mot indeksene i lista modellen fikk. Da finnes det
 * ingen liste å ekko, og feilmodusen er borte i stedet for promptet bort.
 */
export const REFERENCE_PROOFREAD_SCHEMA = {
    type: "object",
    properties: {
        issues: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    type: {type: "string", enum: ["error", "missing", "irrelevant", "text", "self-reference"]},
                    severity: {type: "string", enum: ["critical", "major", "minor"]},
                    reference: {type: "string"},
                    explanation: {type: "string"}
                },
                required: ["type", "severity", "explanation"],
                additionalProperties: false
            }
        },
        summary: {type: "string"},
        score: {type: "integer"},
        corrections: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    op: {type: "string", enum: ["remove", "rewrite", "add"]},
                    index: {type: "integer"},
                    bookId: {type: "integer"},
                    chapterId: {type: "integer"},
                    fromVerseId: {type: "integer"},
                    toVerseId: {type: "integer"},
                    text: {type: "string"},
                    reason: {type: "string"}
                },
                required: ["op", "reason"],
                additionalProperties: false
            }
        }
    },
    required: ["issues", "summary", "score", "corrections"],
    additionalProperties: false
};

function getReferencePrompt(language: string, bookId: number, chapterId: number, verseId: number, originalText: string): string {
    const bookName = getBookName(bookId, language);
    const ref = `${bookName} ${chapterId}:${verseId}`;
    const langCode = getLanguageCode(language);
    const originalLanguage = bookId <= 39 ? 'hebraisk' : 'gresk';
    const originalLanguageEn = bookId <= 39 ? 'Hebrew' : 'Greek';

    const bookList = books.map(b => `${b.id}=${b.name}`).join(', ');

    const strictNb = useLocal ? `
KVALITETSKRAV:
- Inkluder KUN referanser med sterk, direkte kobling til kildeverset
- Maks 5-8 referanser. Kvalitet over kvantitet.
- Hver referanse må dele et spesifikt tema, nøkkelord eller motiv med kildeverset
- Ikke inkluder generelle tematiske koblinger (f.eks. «handler også om tro»)

BOOK ID-LISTE (bruk ALLTID denne for å finne riktig bookId):
${bookList}
` : '';

    const strictEn = useLocal ? `
QUALITY REQUIREMENTS:
- Include ONLY references with a strong, direct connection to the source verse
- Maximum 5-8 references. Quality over quantity.
- Each reference must share a specific theme, keyword or motif with the source verse
- Do not include generic thematic connections (e.g. "also about faith")

BOOK ID LIST (ALWAYS use this to find the correct bookId):
${bookList}
` : '';

    if (langCode === 'nb') {
        return `Skriv kryssreferanser for ${ref} på norsk bokmål.
GT-referanser er fra tanach, og NT er fra SBLGNT.

Den ${originalLanguage}e originalteksten for verset er:
${originalText}
${strictNb}
REFERANSEFORMAT:
Når du refererer til bibelsteder i text-feltet, bruk formatet: [ref:FORKORTELSE KAPITTEL:VERS|VISNINGSTEKST]
Eksempel: [ref:Joh 3:16|Johannes 3:16], [ref:1 Mos 1:1-3|1. Mosebok 1:1-3]
Bruk KVN-forkortelser (1 Mos, Sal, Joh, Åp osv.) i ref-delen og fullt boknavn i visningsteksten.

Returner et JSON-objekt med en 'references'-array. Hvert element har: bookId (tall), chapterId (tall), fromVerseId (tall), toVerseId (tall), text (forklar hvorfor dette er en kryssreferanse, men ikke start med "Dette er en kryssreferanse fordi"). Hvis du ikke finner kryssreferanser, bruk tom array.`;
    } else if (langCode === 'nn') {
        return `Skriv kryssreferansar for ${ref} på norsk nynorsk.
GT-referansar er frå tanach, og NT er frå SBLGNT.

Den ${originalLanguage}e originalteksten for verset er:
${originalText}

REFERANSEFORMAT:
Når du refererer til bibelstader i text-feltet, bruk formatet: [ref:FORKORTING KAPITTEL:VERS|VISNINGSTEKST]
Eksempel: [ref:Joh 3:16|Johannes 3:16], [ref:1 Mos 1:1-3|1. Mosebok 1:1-3]
Bruk KVN-forkortingar (1 Mos, Sal, Joh, Åp osv.) i ref-delen og fullt boknamn i visningsteksten.

Returner eit JSON-objekt med ein 'references'-array. Kvart element har: bookId (tal), chapterId (tal), fromVerseId (tal), toVerseId (tal), text (forklar kvifor dette er ein kryssreferanse, men ikkje start med "Dette er ein kryssreferanse fordi"). Dersom du ikkje finn kryssreferansar, bruk tom array.`;
    } else {
        return `Write cross-references for ${ref} in ${language}.
OT references are from tanach, and NT is from SBLGNT.

The original ${originalLanguageEn} text for the verse is:
${originalText}
${strictEn}
REFERENCE FORMAT:
When referring to Bible passages in the text field, use the format: [ref:ABBREVIATION CHAPTER:VERSE|DISPLAY TEXT]
Example: [ref:Joh 3:16|John 3:16], [ref:1 Mos 1:1-3|Genesis 1:1-3]
Use KVN abbreviations (1 Mos, Sal, Joh, Åp etc.) in the ref part and full book name in the display text.

Return a JSON object with a 'references' array. Each element has: bookId (number), chapterId (number), fromVerseId (number), toVerseId (number), text (explain why this is a cross-reference, but do not start with "This is a cross-reference because"). If you find no cross-references, use an empty array.`;
    }
}

/**
 * Build context text for each cross-reference by looking up ±2 verses from osnb.
 * Returns a formatted string showing the actual Bible text around each referenced verse.
 */
function buildReferenceContext(currentReferences: RawReference[]): string {
    const CONTEXT_RANGE = 2; // ±2 verses
    const sections: string[] = [];

    // Referansene som når hit har vært gjennom normalizeReferences/checkTarget,
    // så adressefeltene er på plass.
    for (const ref of currentReferences as ReferenceTarget[]) {
        const refBookId = ref.bookId;
        const refChapter = ref.chapterId;
        const fromVerse = ref.fromVerseId;
        const toVerse = ref.toVerseId || ref.fromVerseId;

        const rangeStart = Math.max(1, fromVerse - CONTEXT_RANGE);
        const rangeEnd = toVerse + CONTEXT_RANGE;

        const verses = getOsnb2VerseRange(refBookId, refChapter, rangeStart, rangeEnd);
        if (verses.length === 0) {
            sections.push(`  [${refBookId}:${refChapter}:${fromVerse}-${toVerse}] — vers ikke funnet i osnb`);
            continue;
        }

        const bookName = getBookName(refBookId, 'Norwegian bokmål');
        const lines = verses.map(v => {
            const marker = (v.verseId >= fromVerse && v.verseId <= toVerse) ? '>>>' : '   ';
            return `  ${marker} ${bookName} ${refChapter}:${v.verseId}: ${v.text}`;
        });
        sections.push(lines.join('\n'));
    }

    return sections.join('\n\n');
}

function getProofreadPrompt(language: string, bookId: number, chapterId: number, verseId: number, originalText: string, currentReferences: RawReference[]): string {
    const bookName = getBookName(bookId, language);
    const ref = `${bookName} ${chapterId}:${verseId}`;
    const langCode = getLanguageCode(language);
    const originalLanguage = bookId <= 39 ? 'hebraisk' : 'gresk';
    const originalLanguageEn = bookId <= 39 ? 'Hebrew' : 'Greek';

    // Nummerert, fordi rettingene peker tilbake hit med `index`.
    const refsJson = currentReferences.map((r, i) => `[${i + 1}] ${JSON.stringify(r)}`).join('\n');

    let basePrompt: string;
    let taskDescription: string;

    if (langCode === 'nb') {
        basePrompt = `Du er en korrekturleser for bibelske kryssreferanser. Gå gjennom følgende kryssreferanser for ${ref}.
Du får den ${originalLanguage}e originalteksten for å verifisere nøyaktigheten.`;
        taskDescription = `Din oppgave er å verifisere kryssreferansene og identifisere:
- Feil bookId, chapterId, fromVerseId eller toVerseId (sjekk at de refererte versene faktisk finnes)
- Kryssreferanser som ikke er relevante eller har svak kobling til kildeverset
- Viktige kryssreferanser som mangler
- Unøyaktige eller misvisende forklaringstekster
- Selvhenvisninger (referanser tilbake til kildeverset selv)
- ALDRI nevn spesifikke bibelutgaver, bibelselskap eller forlag (f.eks. "Bibelen 2011", "Bibelselskapet", "NIV", "ESV"). Skriv nøytralt uten referanse til bestemte oversettelser eller organisasjoner.`;
    } else if (langCode === 'nn') {
        basePrompt = `Du er ein korrekturlesar for bibelske kryssreferansar. Gå gjennom følgjande kryssreferansar for ${ref}.
Du får den ${originalLanguage}e originalteksten for å verifisere nøyaktigheita.`;
        taskDescription = `Di oppgåve er å verifisere kryssreferansane og identifisere:
- Feil bookId, chapterId, fromVerseId eller toVerseId (sjekk at dei refererte versa faktisk finst)
- Kryssreferansar som ikkje er relevante eller har svak kopling til kjeldeverset
- Viktige kryssreferansar som manglar
- Unøyaktige eller misvisande forklaringstekstar
- Sjølvhenvisingar (referansar tilbake til kjeldeverset sjølv)
- ALDRI nemn spesifikke bibelutgåver, bibelselskap eller forlag (t.d. "Bibelen 2011", "Bibelselskapet", "NIV", "ESV"). Skriv nøytralt utan referanse til bestemte omsetjingar eller organisasjonar.`;
    } else {
        basePrompt = `You are a proofreader for biblical cross-references. Review the following cross-references for ${ref}.
You are given the original ${originalLanguageEn} text to verify accuracy.`;
        taskDescription = `Your task is to verify the cross-references and identify:
- Incorrect bookId, chapterId, fromVerseId or toVerseId (check that referenced verses actually exist)
- Cross-references that are not relevant or have weak connection to the source verse
- Important cross-references that are missing
- Inaccurate or misleading explanation texts
- Self-references (references back to the source verse itself)
- NEVER mention specific Bible editions, Bible societies, or publishers (e.g., "NIV", "ESV", "KJV", "Bibelen 2011", "Bibelselskapet"). Write neutrally without referencing specific translations or organizations.`;
    }

    return `${basePrompt}

${taskDescription}

REFERANSEFORMAT:
Bibelreferanser i text-feltet bruker formatet: [ref:FORKORTELSE KAPITTEL:VERS|VISNINGSTEKST]
Eksempel: [ref:Joh 3:16|Johannes 3:16]. Bevar dette formatet når du skriver ny tekst.
Bruk KVN-forkortelser (1 Mos, Sal, Joh, Åp osv.) i ref-delen og fullt boknavn i visningsteksten.

${useLocal ? `VIKTIG FOR KVALITETSKONTROLL:
- Fjern KUN referanser som er direkte feil (feil bookId/chapterId/verseId) eller helt irrelevante
- IKKE legg til nye referanser ("add") — det gjøres i et eget steg
- IKKE fjern referanser bare fordi de er "svake" — behold alt som har en rimelig kobling
- Maks 5 issues. Fokuser på det viktigste.
- score skal være 0-10 (0 = helt feil, 10 = perfekt)
` : ''}RETTINGER (corrections):
Du retter IKKE ved å skrive lista på nytt. Du svarer med operasjoner mot numrene
[N] i lista under. Hvert funn i issues som lar seg rette skal ha en operasjon:
- {"op": "remove", "index": N, "reason": "..."} — fjern referanse [N]
- {"op": "rewrite", "index": N, "text": "ny forklaring", "reason": "..."} — bytt teksten.
  Skal adressen rettes, ta med feltene som endres: bookId, chapterId, fromVerseId, toVerseId.
- {"op": "add", "bookId": .., "chapterId": .., "fromVerseId": .., "toVerseId": .., "text": "...", "reason": "..."}

IMPORTANT:
- index refers to the [N] numbers below, counted from 1. Never renumber them.
- If nothing needs changing, return an empty issues array and an empty corrections array
- bookId values: OT books 1-39, NT books 40-66
- Focus on accuracy: are these real, meaningful cross-references?

Original text:
${originalText}

Current cross-references:
${refsJson}

FAKTISK BIBELTEKST FOR REFERANSENE (±2 vers fra osnb):
Linjer merket med >>> er de refererte versene. Sjekk om referansen peker til riktig vers,
eller om et nabovers er et bedre treff. Hvis et vers ikke finnes, er referansen sannsynligvis feil.
${buildReferenceContext(currentReferences)}`;
}

function getOutputPath(language: string, bookId: number, chapterId: number, verseId: number): string {
    const langCode = getLanguageCode(language);
    return path.join(__dirname, `references/${langCode}/${bookId}/${chapterId}/${verseId}.json`);
}

function getProofreadPath(language: string, bookId: number, chapterId: number, verseId: number): string {
    const langCode = getLanguageCode(language);
    return path.join(__dirname, `proofread_references/${langCode}/${bookId}/${chapterId}/${verseId}.json`);
}

function fileExists(filepath: string): boolean {
    return fs.existsSync(filepath) && fs.statSync(filepath).size > 0;
}

function ensureDir(filepath: string): void {
    const dir = path.dirname(filepath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, {recursive: true});
    }
}

/**
 * Peker referansen på et vers som faktisk finnes?
 *
 * Kildesiden har alltid vært avgrenset — løkka i main() går ikke forbi
 * `book.chapters`. Måladressen bestemmer modellen, og der fantes ingen port:
 * 560 referanser i prod pekte på et kapittel målboka ikke har (#26).
 *
 * Men en adresse som ikke finnes hos oss er ikke uten videre feil. Vi følger
 * hebraisk/gresk versnummerering; modellen svarer ofte i den europeiske. «Mal 4:5»
 * finnes ikke — Malaki har 3 kapitler her — men det ER Mal 3:23, og referansen er
 * riktig. Målt på nb: 182 av de ugyldige er gyldige osmain-adresser, 556 finnes i
 * ingen nummerering. Bare de siste er bokforvekslingen #26 beskriver (`Høy 105:33`
 * for `Sal 105:33`). Derfor to utfall: 'renumber' skal rettes gjennom KVN,
 * 'drop' skal bort.
 *
 * Merk at dette bare fanger de som lander UTENFOR rekkevidde. En forvekslet bok
 * der kapittel og vers tilfeldigvis finnes gir en levende lenke til et urelatert
 * vers, og den gruppa er trolig større. Å fange den krever at man leser målverset
 * og sammenlikner med beskrivelsen — se punkt 3 i #26.
 *
 * @returns {{verdict: 'ok'|'renumber'|'drop', reason?: string}}
 */
export function checkTarget(ref: RawReference): TargetCheck {
    // Feltene er ikke garantert til stede — Number.isInteger-portene under er
    // nettopp der for å fange det, så typen får anta at de er tall.
    const {bookId, chapterId, fromVerseId, toVerseId} = ref as ReferenceTarget;
    const drop = (reason: string): TargetCheck => ({verdict: 'drop', reason});

    if (!Number.isInteger(bookId)) return drop(`bookId ${bookId} er ikke et heltall`);
    const book = books.find(b => b.id === bookId);
    if (!book) return drop(`bok ${bookId} finnes ikke`);

    if (!Number.isInteger(chapterId)) return drop(`chapterId ${chapterId} er ikke et heltall`);
    if (!Number.isInteger(fromVerseId)) return drop(`fromVerseId ${fromVerseId} er ikke et heltall`);
    const to = Number.isInteger(toVerseId) ? toVerseId : fromVerseId;
    if (to < fromVerseId) return drop(`toVerseId ${to} er mindre enn fromVerseId ${fromVerseId}`);

    if (chapterId >= 1 && chapterId <= book.chapters) {
        const present = versesIn(getOriginalChapter, bookId, chapterId);
        if (present && present.has(fromVerseId) && present.has(to)) return {verdict: 'ok'};
    }

    // Finnes adressen i osmain, er den riktig — bare skrevet i europeisk nummerering.
    const euro = versesIn(getOsmainChapter, bookId, chapterId);
    if (euro && euro.has(fromVerseId) && euro.has(to)) {
        return {
            verdict: 'renumber',
            reason: `${book.name} ${chapterId}:${fromVerseId} finnes bare i europeisk nummerering`
        };
    }

    return drop(chapterId > book.chapters
        ? `${book.name} har ${book.chapters} kapitler, referansen peker på ${chapterId}`
        : `${book.name} ${chapterId} har ikke vers ${fromVerseId}${to !== fromVerseId ? `-${to}` : ''}`);
}

/** Versnumrene i et kapittel, eller null om kapittelet ikke finnes. */
function versesIn(loader: ChapterLoader, bookId: number, chapterId: number): Set<number> | null {
    try {
        const verses = loader(bookId, chapterId);
        if (!verses || !verses.length) return null;
        return new Set(verses.map(v => +v.verseId));
    } catch {
        return null;
    }
}

/** Nøkkelen er det absolutte filnavnet, så oppslaget er dynamisk og trenger `Record`. */
const osmainCache: Record<string, Chapter | null> = {};

/** osmain følger den europeiske nummereringen, og er fasiten for «er dette en gyldig adresse der». */
function getOsmainChapter(bookId: number, chapterId: number): Chapter | null {
    const file = path.join(__dirname, 'bibles_raw', 'osmain', `${bookId}`, `${chapterId}.json`);
    if (!(file in osmainCache)) {
        osmainCache[file] = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf-8')) : null;
    }
    return osmainCache[file];
}

/**
 * Retter feltnavn og forkaster referanser som peker på et vers som ikke finnes.
 * Begge skriveveiene — generering og anvendt korrektur — går gjennom her.
 */
function normalizeReferences(refs: RawReference[], context = ''): RawReference[] {
    const kept: RawReference[] = [];
    for (const ref of refs) {
        normalizeFields(ref);

        const {verdict, reason} = checkTarget(ref);
        const where = context ? ` i ${context}` : '';
        if (verdict === 'drop') {
            console.log(`  forkastet referanse${where}: ${reason}`);
            continue;
        }
        if (verdict === 'renumber') {
            // Riktig referanse, feil nummerering. Den beholdes — å slette den er å
            // miste en god kryssreferanse — men den skal gjennom KVN.
            console.log(`  NB${where}: ${reason}`);
        }
        kept.push(ref);
    }
    return kept;
}

/** Retter feltnavnene modellen bommer på, på plass i objektet. */
function normalizeFields(ref: RawReference): RawReference {
    // Fix common issue: verseId instead of fromVerseId
    if (ref.verseId !== undefined && ref.fromVerseId === undefined) {
        ref.fromVerseId = ref.verseId;
        delete ref.verseId;
    }
    // Ensure toVerseId defaults to fromVerseId
    if (ref.toVerseId === undefined && ref.fromVerseId !== undefined) {
        ref.toVerseId = ref.fromVerseId;
    }
    return ref;
}

/** Adressen som tekst, til logglinjer og duplikatnøkler. */
function targetKey(ref: RawReference): string {
    return `${ref.bookId}:${ref.chapterId}:${ref.fromVerseId}-${ref.toVerseId ?? ref.fromVerseId}`;
}

/**
 * Utfører korrekturens rettinger på referanselista.
 *
 * Hele poenget med at rettingene er operasjoner og ikke en omskrevet liste står i
 * `REFERENCE_PROOFREAD_SCHEMA`: en liste kan ekkoes, en `remove` kan ikke.
 *
 * Tre ting den ikke gjør, med vilje:
 * - Indeksene tolkes mot lista korrekturen FIKK, ikke mot en liste som forskyver
 *   seg mens rettingene utføres. Derfor markeres fjerningene først og filtreres til slutt.
 * - Bare det som endres går gjennom `checkTarget`. En referanse ingen rettet på
 *   blir stående selv om adressen er død — den er `--validate --fix` sin jobb, og å
 *   rydde den her ville gjort en korrekturkjøring til en stille datasletting.
 * - En `add` med en adresse som alt står i lista er ikke en retting. Uten den porten
 *   ville et svar som ramser opp hele lista på nytt doblet den.
 */
export function applyCorrections(refs: RawReference[], corrections: Correction[], context = ''): CorrectionResult {
    const next = refs.map(r => ({...r}));
    const removed = new Set<number>();
    const added: RawReference[] = [];
    const skipped: string[] = [];
    const where = context ? ` i ${context}` : '';
    let rewritten = 0;

    const skip = (c: Correction, reason: string) => skipped.push(`${c.op}${c.index !== undefined ? ` [${c.index}]` : ''}: ${reason}`);

    /** Gyldig 1-basert indeks inn i lista korrekturen fikk, ellers null. */
    const resolve = (c: Correction): number | null => {
        if (!Number.isInteger(c.index) || c.index! < 1 || c.index! > next.length) {
            skip(c, `indeks ${c.index} finnes ikke i lista på ${next.length}`);
            return null;
        }
        return c.index! - 1;
    };

    for (const c of corrections || []) {
        if (c.op === 'remove') {
            const i = resolve(c);
            if (i !== null) removed.add(i);
            continue;
        }

        if (c.op === 'rewrite') {
            const i = resolve(c);
            if (i === null) continue;

            const fields = (['bookId', 'chapterId', 'fromVerseId', 'toVerseId'] as const)
                .filter(f => Number.isInteger(c[f]));
            if (!fields.length && (c.text === undefined || c.text === next[i].text)) {
                skip(c, 'ingen endring i teksten eller adressen');
                continue;
            }

            const candidate = normalizeFields({...next[i]});
            for (const f of fields) candidate[f] = c[f];
            if (c.text !== undefined) candidate.text = c.text;

            if (fields.length) {
                // Rettet adresse er en ny påstand om hvor teksten ligger, og skal
                // gjennom samme port som en generert referanse.
                const {verdict, reason} = checkTarget(candidate);
                if (verdict === 'drop') {
                    skip(c, `ny adresse forkastet — ${reason}`);
                    continue;
                }
                if (verdict === 'renumber') console.log(`  NB${where}: ${reason}`);
            }

            next[i] = candidate;
            rewritten++;
            continue;
        }

        if (c.op === 'add') {
            const candidate = normalizeFields({
                bookId: c.bookId, chapterId: c.chapterId,
                fromVerseId: c.fromVerseId, toVerseId: c.toVerseId,
                text: c.text,
            });
            if (!candidate.text) {
                skip(c, 'mangler forklaringstekst');
                continue;
            }
            const {verdict, reason} = checkTarget(candidate);
            if (verdict === 'drop') {
                skip(c, `forkastet — ${reason}`);
                continue;
            }
            if (verdict === 'renumber') console.log(`  NB${where}: ${reason}`);

            const key = targetKey(candidate);
            if (next.some(r => targetKey(r) === key) || added.some(r => targetKey(r) === key)) {
                skip(c, `${key} står allerede i lista`);
                continue;
            }
            added.push(candidate);
            continue;
        }

        skip(c, `ukjent operasjon «${c.op}»`);
    }

    const references = next.filter((_, i) => !removed.has(i)).concat(added);
    return {
        references,
        removed: removed.size,
        rewritten,
        added: added.length,
        skipped,
        changed: removed.size > 0 || rewritten > 0 || added.length > 0,
    };
}

async function generateReferences(language: string, bookId: number, chapterId: number, verseId: number, filename: string): Promise<void> {
    const bookName = getBookName(bookId, language);
    const verseOrg = getOriginalVerse(bookId, chapterId, verseId);
    if (!verseOrg) {
        console.log(`Skipping ${bookName} ${chapterId}:${verseId} (no original text found)`);
        return;
    }

    const prompt = getReferencePrompt(language, bookId, chapterId, verseId, verseOrg.text);

    console.log(`Generating references for ${bookName} ${chapterId}:${verseId}...`);
    const result = await callWithRetry(prompt, {schema: REFERENCE_SCHEMA, local: useLocal, task: 'references', context: `${bookId}:${chapterId}:${verseId}`}) as ReferenceResult;

    const references = normalizeReferences(result.references, `${bookName} ${chapterId}:${verseId}`);

    const verse: ReferenceFile = {
        bookId,
        chapterId,
        verseId,
        references
    };

    ensureDir(filename);
    fs.writeFileSync(filename, JSON.stringify(verse, null, 2));
    console.log(`  Saved: ${filename} (${references.length} references)`);
}

async function proofreadReferences(language: string, bookId: number, chapterId: number, verseId: number, refFilename: string, saveToFile = true): Promise<ProofreadResult | null> {
    if (!fileExists(refFilename)) {
        console.log(`No reference file found for ${bookId}:${chapterId}:${verseId}`);
        return null;
    }

    const bookName = getBookName(bookId, language);
    const verseOrg = getOriginalVerse(bookId, chapterId, verseId);
    if (!verseOrg) {
        console.log(`Skipping proofread for ${bookName} ${chapterId}:${verseId} (no original text found)`);
        return null;
    }

    const currentData = JSON.parse(fs.readFileSync(refFilename, 'utf-8')) as ReferenceFile;
    const currentReferences = currentData.references || [];

    if (currentReferences.length === 0) {
        console.log(`Skipping proofread for ${bookName} ${chapterId}:${verseId} (no references to proofread)`);
        return null;
    }

    console.log(`Proofreading references for ${bookName} ${chapterId}:${verseId}...`);

    const prompt = getProofreadPrompt(language, bookId, chapterId, verseId, verseOrg.text, currentReferences);
    const result = await callWithRetry(prompt, {schema: REFERENCE_PROOFREAD_SCHEMA, local: useLocal, task: 'references', context: `proofread ${bookId}:${chapterId}:${verseId}`}) as ProofreadResult;

    // Save proofread results if requested
    if (saveToFile) {
        const proofreadFile = getProofreadPath(language, bookId, chapterId, verseId);
        ensureDir(proofreadFile);
        fs.writeFileSync(proofreadFile, JSON.stringify(result, null, 2));
    }

    // Print summary
    if (result.score !== null && result.score !== undefined) {
        process.stdout.write(`  Score: ${result.score}/10`);
    }
    if (result.issues && result.issues.length > 0) {
        console.log(` | Issues: ${result.issues.length}`);
        result.issues.forEach((issue: ProofreadIssue, i: number) => {
            console.log(`    ${i + 1}. [${issue.severity}] ${issue.type}: ${issue.explanation}`);
        });
    } else {
        console.log(' | No issues');
    }

    return result;
}

function applyProofreadChanges(language: string, bookId: number, chapterId: number, verseId: number, refFilename: string, proofreadResult: ProofreadResult | null = null): void {
    // Load proofread result from file if not provided
    if (!proofreadResult) {
        const proofreadFile = getProofreadPath(language, bookId, chapterId, verseId);
        if (!fileExists(proofreadFile)) {
            console.log(`No proofread file found for ${bookId}:${chapterId}:${verseId}`);
            return;
        }
        proofreadResult = JSON.parse(fs.readFileSync(proofreadFile, 'utf-8')) as ProofreadResult;
    }

    if (!fileExists(refFilename)) {
        console.log(`No reference file found for ${bookId}:${chapterId}:${verseId}`);
        return;
    }

    const bookName = getBookName(bookId, language);
    const ref = `${bookName} ${chapterId}:${verseId}`;

    if (!proofreadResult.corrections) {
        // Korrekturfiler fra før #121 har bare `revisedReferences`, og den er input
        // uendret i 139 av 140 målte filer. Å skrive den tilbake er per definisjon
        // en no-op; å late som den ble anvendt er verre. Kjør korrekturen på nytt.
        if (proofreadResult.revisedReferences) {
            console.log(`  ${ref}: korrekturfila er fra før rettingene ble operasjoner — kjør --proofread på nytt`);
        }
        return;
    }

    if (proofreadResult.corrections.length === 0) return;

    const currentData = JSON.parse(fs.readFileSync(refFilename, 'utf-8')) as ReferenceFile;
    const result = applyCorrections(currentData.references || [], proofreadResult.corrections, `${ref} (korrektur)`);

    for (const reason of result.skipped) console.log(`  hoppet over retting i ${ref}: ${reason}`);
    if (!result.changed) return;

    currentData.references = result.references;
    fs.writeFileSync(refFilename, JSON.stringify(currentData, null, 2));
    console.log(`  Applied to ${ref}: ${result.removed} fjernet, ${result.rewritten} omskrevet, ${result.added} lagt til (${result.references.length} referanser)`);
}

const HELP_EXAMPLES = [
    'bun generate/references.ts --nt                              # NT, norsk bokmål',
    'bun generate/references.ts --language nn --ot                # GT, nynorsk',
    'bun generate/references.ts --language en --book 43           # Johannes, engelsk',
    'bun generate/references.ts --book 43 --chapter 1 --verse 1-14',
    'bun generate/references.ts --nt --proofread --apply          # generer → korrektur → skriv inn',
    'bun generate/references.ts --local --book 10-39              # lokal Ollama i stedet for Claude',
    'bun generate/references.ts --validate --fix                  # rydd døde adresser på disk',
    '',
    'Filene havner i references/<språkkode>/<bok>/<kapittel>/<vers>.json,',
    'f.eks. references/nb/43/1/1.json.',
];

/** Oversetter de tolkede flaggene til `Options`. */
function readOptions(flags: ReturnType<typeof parseArgs>['flags']): Options {
    const book = flags.book as Range | undefined;
    const chapter = flags.chapter as Range | undefined;
    const verse = flags.verse as Range | undefined;

    return {
        language: normalizeLanguage(flags.language as string),
        proofread: flags.proofread as boolean,
        apply: flags.apply as boolean,
        ot: flags.ot as boolean,
        nt: flags.nt as boolean,
        bookStart: book?.start ?? null,
        bookEnd: book?.end ?? null,
        chapterStart: chapter?.start ?? null,
        chapterEnd: chapter?.end ?? null,
        verseStart: verse?.start ?? null,
        verseEnd: verse?.end ?? null,
        force: flags.force as boolean,
        validate: flags.validate as boolean,
        fix: flags.fix as boolean,
        local: flags.local as boolean,
    };
}

/**
 * Sveiper referansefilene som alt ligger på disk med samme port som skrivingen.
 * Rapporterer som standard; `--fix` fjerner de ugyldige.
 */
function validateExisting(options: Options): void {
    const langCode = getLanguageCode(options.language);
    const root = path.join(__dirname, 'references', langCode);
    if (!fs.existsSync(root)) {
        console.log(`Ingen referanser for ${langCode} (${root} finnes ikke)`);
        return;
    }

    const bookDirs = fs.readdirSync(root).filter(n => /^\d+$/.test(n)).map(Number).sort((a, b) => a - b);
    let files = 0, total = 0, dropped = 0, renumber = 0, filesTouched = 0;
    const deadTargets = new Map<string, number>();
    /** Nøkkelen er boknavnet, med bok-id-en som reserve når boka ikke finnes. */
    const renumberBooks = new Map<string | number, number>();

    for (const bookId of bookDirs) {
        for (const chapterName of fs.readdirSync(path.join(root, `${bookId}`))) {
            const chapterDir = path.join(root, `${bookId}`, chapterName);
            if (!fs.statSync(chapterDir).isDirectory()) continue;
            for (const verseFile of fs.readdirSync(chapterDir).filter(n => n.endsWith('.json'))) {
                const file = path.join(chapterDir, verseFile);
                const data = JSON.parse(fs.readFileSync(file, 'utf-8')) as ReferenceFile;
                if (!Array.isArray(data.references)) continue;
                files++;
                total += data.references.length;

                const kept: RawReference[] = [];
                for (const ref of data.references) {
                    const {verdict, reason} = checkTarget(ref);
                    const src = `${getBookName(data.bookId, options.language)} ${data.chapterId}:${data.verseId}`;
                    if (verdict === 'ok') {
                        kept.push(ref);
                        continue;
                    }
                    if (verdict === 'renumber') {
                        renumber++;
                        const book = books.find(b => b.id === ref.bookId);
                        renumberBooks.set(book?.name ?? ref.bookId!, (renumberBooks.get(book?.name ?? ref.bookId!) || 0) + 1);
                        kept.push(ref);   // riktig referanse — skal rettes, ikke slettes
                        continue;
                    }
                    dropped++;
                    const key = `${ref.bookId}:${ref.chapterId}`;
                    deadTargets.set(key, (deadTargets.get(key) || 0) + 1);
                    console.log(`  ${src} → ${reason}`);
                }

                if (kept.length !== data.references.length) {
                    filesTouched++;
                    if (options.fix) {
                        data.references = kept;
                        fs.writeFileSync(file, JSON.stringify(data, null, 2));
                    }
                }
            }
        }
    }

    console.log('---');
    console.log(`${langCode}: ${total} referanser i ${files} filer`);
    console.log(`${dropped} døde adresser i ${filesTouched} filer, ${deadTargets.size} unike døde mål`);
    if (renumber) {
        const top = [...renumberBooks.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
            .map(([name, n]) => `${name} ${n}`).join(', ');
        console.log(`${renumber} i europeisk nummerering — BEHOLDT, skal rettes gjennom KVN (${top})`);
    }
    if (dropped && !options.fix) console.log('Kjør med --fix for å fjerne de døde.');
}

async function main(): Promise<void> {
    // Hjelpen skal ut før noe leses fra disk eller sendes over nettet.
    const {flags} = parseArgs(process.argv.slice(2), SPEC);
    if (flags.help) {
        console.log(formatHelp(
            'generate/references.ts',
            'kryssreferanser per vers, generert og korrekturlest av en modell',
            SPEC,
            HELP_EXAMPLES,
        ));
        process.exit(0);
    }

    const options = readOptions(flags);
    useLocal = options.local;

    if (options.validate) {
        validateExisting(options);
        return;
    }

    // Determine book range
    let startBook = 1;
    let endBook = 66;

    if (options.bookStart !== null) {
        startBook = options.bookStart;
        // parseArgs setter alltid bookEnd sammen med bookStart, men `!== null` på
        // bookStart forteller ikke typesystemet det.
        endBook = options.bookEnd!;
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
    if (options.verseStart !== null) {
        console.log(`Verses: ${options.verseStart}-${options.verseEnd}`);
    }
    console.log('---');

    for (let bookId = startBook; bookId <= endBook; bookId++) {
        const book = books.find(b => b.id === bookId);
        if (!book) continue;

        const maxChapters = book.chapters;
        const startChapter = options.chapterStart || 1;
        const endChapter = Math.min(options.chapterEnd || maxChapters, maxChapters);

        for (let chapterId = startChapter; chapterId <= endChapter; chapterId++) {
            const verses = getOriginalChapter(bookId, chapterId);
            if (!verses || verses.length === 0) continue;

            const startVerse = options.verseStart || 1;
            const endVerse = options.verseEnd || verses[verses.length - 1].verseId;

            for (const verse of verses) {
                const verseId = verse.verseId;
                if (verseId < startVerse || verseId > endVerse) continue;

                const filename = getOutputPath(options.language, bookId, chapterId, verseId);

                // Step 1: Generate (skip if file exists unless --force)
                if (!fileExists(filename) || options.force) {
                    await generateReferences(options.language, bookId, chapterId, verseId, filename);
                } else {
                    const bookName = getBookName(bookId, options.language);
                    console.log(`Skipping ${bookName} ${chapterId}:${verseId} (already exists)`);
                }

                // Step 2: Proofread (if requested)
                // Funnene lagres alltid, også med --apply: sporet og rettingen er
                // samme svar, og `saveToFile = !options.apply` gjorde at man fikk
                // det ene eller det andre, aldri begge (#121).
                let proofreadResult: ProofreadResult | null = null;
                if (options.proofread && fileExists(filename)) {
                    proofreadResult = await proofreadReferences(options.language, bookId, chapterId, verseId, filename);
                }

                // Step 3: Apply (if requested)
                if (options.apply) {
                    applyProofreadChanges(options.language, bookId, chapterId, verseId, filename, proofreadResult);
                }
            }
        }
    }

    console.log('Done!');
}

// Guard slik at checkTarget kan importeres (av tester, eller av et annet skript)
// uten at hele genereringen starter. Samme mønster som build-translations-meta.ts.
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
    // Avslutt med kode 1, ikke 0: et ukjent flagg skal stoppe et køskript, ikke
    // bare skrive en linje det ingen leser. Samme mønster som
    // references-semantic.ts. Tidligere var dette `.catch(console.error)`.
    main().catch(err => {
        console.error(err);
        process.exit(1);
    });
}
