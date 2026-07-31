import "./env.js";
import * as fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import {books, normalizeLanguage, getLanguageCode, getBookName} from "./constants.js";
import {callWithRetry, callOllamaRaw} from "./llm.js";
import {parseArgs, formatHelp, COMMON_FLAGS} from './cli.js';
import type {FlagSpec, Range} from './cli.js';
import type {Chapter} from '../kvn/src/bible-types.js';

let useLocal = false;

/**
 * `as const` er en ren typepåstand: den fryser listene til literal-unioner
 * (`GenreTag` og vennene under) slik at oppslagstabellene under må dekke
 * nøyaktig de samme taggene. Kjøretidsverdien er den samme arrayen som før.
 */
const GENRE_TAGS = ['law', 'narrative', 'poetry', 'prophecy', 'wisdom', 'epistle', 'apocalyptic', 'genealogy', 'psalm', 'parable'] as const;
const SENTIMENT_TAGS = ['comfort', 'warning', 'praise', 'lament', 'teaching', 'judgment', 'promise', 'prayer'] as const;
const THEME_TAGS = ['covenant', 'salvation', 'creation', 'sin', 'faith', 'love', 'justice', 'sacrifice', 'healing', 'prayer', 'holiness', 'mercy', 'kingdom', 'resurrection', 'repentance', 'obedience'] as const;
const LITURGY_TAGS = ['advent', 'christmas', 'epiphany', 'lent', 'easter', 'ascension', 'pentecost', 'funeral', 'wedding', 'baptism', 'communion', 'confirmation', 'ordination'] as const;

type GenreTag = typeof GENRE_TAGS[number];
type SentimentTag = typeof SENTIMENT_TAGS[number];
type ThemeTag = typeof THEME_TAGS[number];
type LiturgyTag = typeof LITURGY_TAGS[number];

/**
 * Språkene taggnavn og -beskrivelser finnes på. Andre språkkoder faller
 * tilbake på `en` — se oppslagene i `main()`.
 */
type TagLang = 'nb' | 'en';

const GENRE_NAMES: Record<TagLang, Record<GenreTag, string>> = {
    nb: {law: 'Lov', narrative: 'Fortelling', poetry: 'Poesi', prophecy: 'Profeti', wisdom: 'Visdom', epistle: 'Brev', apocalyptic: 'Apokalyptisk', genealogy: 'Slektstavle', psalm: 'Salme', parable: 'Lignelse'},
    en: {law: 'Law', narrative: 'Narrative', poetry: 'Poetry', prophecy: 'Prophecy', wisdom: 'Wisdom', epistle: 'Epistle', apocalyptic: 'Apocalyptic', genealogy: 'Genealogy', psalm: 'Psalm', parable: 'Parable'}
};

const GENRE_DESCRIPTIONS: Record<TagLang, Record<GenreTag, string>> = {
    nb: {
        law: 'Lovtekster, forskrifter og bud fra Gud til sitt folk',
        narrative: 'Fortellende tekst som beskriver historiske hendelser og personers liv',
        poetry: 'Poetisk tekst med billedspråk, parallellismer og rytmisk struktur',
        prophecy: 'Profetisk tekst med budskap fra Gud om fremtid, dom eller gjenopprettelse',
        wisdom: 'Visdomslitteratur med refleksjoner over livets mening, moral og gudsfrykt',
        epistle: 'Brevform med undervisning, formaning og oppmuntring til menigheter eller enkeltpersoner',
        apocalyptic: 'Apokalyptisk tekst med symboler, visjoner og åpenbaringer om endetiden',
        genealogy: 'Slektstavler og ætterekker som knytter personer og hendelser sammen',
        psalm: 'Salmer og sanger brukt i tilbedelse, bønn og lovprisning',
        parable: 'Lignelser og billedtaler som formidler åndelige sannheter gjennom hverdagslige bilder'
    },
    en: {
        law: 'Legal texts, regulations and commandments from God to his people',
        narrative: 'Narrative text describing historical events and the lives of persons',
        poetry: 'Poetic text with imagery, parallelisms and rhythmic structure',
        prophecy: 'Prophetic text with messages from God about the future, judgment or restoration',
        wisdom: 'Wisdom literature with reflections on the meaning of life, morality and the fear of God',
        epistle: 'Letter form with teaching, exhortation and encouragement to churches or individuals',
        apocalyptic: 'Apocalyptic text with symbols, visions and revelations about the end times',
        genealogy: 'Genealogies and lineages connecting persons and events',
        psalm: 'Psalms and songs used in worship, prayer and praise',
        parable: 'Parables and figurative speech conveying spiritual truths through everyday images'
    }
};

const SENTIMENT_NAMES: Record<TagLang, Record<SentimentTag, string>> = {
    nb: {comfort: 'Trøst', warning: 'Advarsel', praise: 'Lovprisning', lament: 'Klage', teaching: 'Undervisning', judgment: 'Dom', promise: 'Løfte', prayer: 'Bønn'},
    en: {comfort: 'Comfort', warning: 'Warning', praise: 'Praise', lament: 'Lament', teaching: 'Teaching', judgment: 'Judgment', promise: 'Promise', prayer: 'Prayer'}
};

const SENTIMENT_DESCRIPTIONS: Record<TagLang, Record<SentimentTag, string>> = {
    nb: {
        comfort: 'Trøst og oppmuntring i vanskelige tider, forsikring om Guds nærhet og omsorg',
        warning: 'Advarsel mot synd, frafall eller ulydighet, med oppfordring til omvendelse',
        praise: 'Lovprisning og takk til Gud for hans vesen, gjerninger og trofasthet',
        lament: 'Klage og sorg over lidelse, urettferdighet eller avstand fra Gud',
        teaching: 'Undervisning om tro, liv og Guds vilje for sitt folk',
        judgment: 'Dom og straff over synd, urettferdighet eller fiender av Guds folk',
        promise: 'Løfter fra Gud om velsignelse, frelse, gjenopprettelse eller fremtid',
        prayer: 'Bønn til Gud med takk, forbønn, bekjennelse eller rop om hjelp'
    },
    en: {
        comfort: 'Comfort and encouragement in difficult times, assurance of God\'s presence and care',
        warning: 'Warning against sin, apostasy or disobedience, with a call to repentance',
        praise: 'Praise and thanks to God for his nature, works and faithfulness',
        lament: 'Lament and grief over suffering, injustice or distance from God',
        teaching: 'Teaching about faith, life and God\'s will for his people',
        judgment: 'Judgment and punishment for sin, injustice or enemies of God\'s people',
        promise: 'Promises from God about blessing, salvation, restoration or the future',
        prayer: 'Prayer to God with thanks, intercession, confession or cries for help'
    }
};

const THEME_NAMES: Record<TagLang, Record<ThemeTag, string>> = {
    nb: {covenant: 'Pakt', salvation: 'Frelse', creation: 'Skapelse', sin: 'Synd', faith: 'Tro', love: 'Kjærlighet', justice: 'Rettferdighet', sacrifice: 'Offer', healing: 'Helbredelse', prayer: 'Bønn', holiness: 'Hellighet', mercy: 'Barmhjertighet', kingdom: 'Guds rike', resurrection: 'Oppstandelse', repentance: 'Omvendelse', obedience: 'Lydighet'},
    en: {covenant: 'Covenant', salvation: 'Salvation', creation: 'Creation', sin: 'Sin', faith: 'Faith', love: 'Love', justice: 'Justice', sacrifice: 'Sacrifice', healing: 'Healing', prayer: 'Prayer', holiness: 'Holiness', mercy: 'Mercy', kingdom: 'Kingdom of God', resurrection: 'Resurrection', repentance: 'Repentance', obedience: 'Obedience'}
};

const THEME_DESCRIPTIONS: Record<TagLang, Record<ThemeTag, string>> = {
    nb: {
        covenant: 'Guds pakt med sitt folk — løfter, betingelser og tegn på paktsforholdet',
        salvation: 'Frelse fra synd, død og fortapelse gjennom Guds inngripen',
        creation: 'Guds skaperverk, naturens orden og menneskets plass i skaperverket',
        sin: 'Synd, fall, fristelse og menneskets opprør mot Gud',
        faith: 'Tro på Gud, tillit til hans løfter og troens liv',
        love: 'Guds kjærlighet til mennesker og kjærlighetsbudet mellom mennesker',
        justice: 'Guds rettferdighet, sosial rettferd og rett dom',
        sacrifice: 'Offer og soning — fra dyreofre til Kristi endelige offer',
        healing: 'Helbredelse av sykdom, både fysisk og åndelig gjenopprettelse',
        prayer: 'Bønn som kommunikasjon med Gud i ulike livssituasjoner',
        holiness: 'Guds hellighet og kallet til å leve hellig',
        mercy: 'Guds barmhjertighet, nåde og tilgivelse mot syndere',
        kingdom: 'Guds rike, dets komme og kjennetegn',
        resurrection: 'Oppstandelse fra de døde og håpet om evig liv',
        repentance: 'Omvendelse, anger og tilbakevending til Gud',
        obedience: 'Lydighet mot Guds vilje, bud og kall'
    },
    en: {
        covenant: 'God\'s covenant with his people — promises, conditions and signs of the covenant relationship',
        salvation: 'Salvation from sin, death and perdition through God\'s intervention',
        creation: 'God\'s creation, the order of nature and humanity\'s place in creation',
        sin: 'Sin, the fall, temptation and humanity\'s rebellion against God',
        faith: 'Faith in God, trust in his promises and the life of faith',
        love: 'God\'s love for humanity and the command to love one another',
        justice: 'God\'s righteousness, social justice and righteous judgment',
        sacrifice: 'Sacrifice and atonement — from animal sacrifices to Christ\'s final sacrifice',
        healing: 'Healing of illness, both physical and spiritual restoration',
        prayer: 'Prayer as communication with God in various life situations',
        holiness: 'God\'s holiness and the call to live a holy life',
        mercy: 'God\'s mercy, grace and forgiveness toward sinners',
        kingdom: 'The kingdom of God, its coming and characteristics',
        resurrection: 'Resurrection from the dead and the hope of eternal life',
        repentance: 'Repentance, remorse and returning to God',
        obedience: 'Obedience to God\'s will, commandments and calling'
    }
};

const LITURGY_NAMES: Record<TagLang, Record<LiturgyTag, string>> = {
    nb: {advent: 'Advent', christmas: 'Jul', epiphany: 'Åpenbaring', lent: 'Faste', easter: 'Påske', ascension: 'Kristi himmelfartsdag', pentecost: 'Pinse', funeral: 'Begravelse', wedding: 'Bryllup', baptism: 'Dåp', communion: 'Nattverd', confirmation: 'Konfirmasjon', ordination: 'Ordinasjon'},
    en: {advent: 'Advent', christmas: 'Christmas', epiphany: 'Epiphany', lent: 'Lent', easter: 'Easter', ascension: 'Ascension', pentecost: 'Pentecost', funeral: 'Funeral', wedding: 'Wedding', baptism: 'Baptism', communion: 'Communion', confirmation: 'Confirmation', ordination: 'Ordination'}
};

const LITURGY_DESCRIPTIONS: Record<TagLang, Record<LiturgyTag, string>> = {
    nb: {
        advent: 'Tekster knyttet til adventstiden — venting, forberedelse og lengsel etter Messias',
        christmas: 'Tekster knyttet til Jesu fødsel og inkarnasjonen',
        epiphany: 'Tekster knyttet til Jesu åpenbaring for verden — vismennene, dåpen, undere',
        lent: 'Tekster knyttet til fastetiden — bot, selvransakelse og forberedelse til påske',
        easter: 'Tekster knyttet til påsken — Jesu lidelse, død og oppstandelse',
        ascension: 'Tekster knyttet til Jesu himmelfart og hans herredømme',
        pentecost: 'Tekster knyttet til pinsen — Den Hellige Ånds komme og kirkens fødsel',
        funeral: 'Tekster som er egnet for begravelser — trøst, håp og oppstandelse',
        wedding: 'Tekster som er egnet for bryllup — kjærlighet, pakt og samliv',
        baptism: 'Tekster knyttet til dåpen — gjenfødelse, pakt og tilhørighet',
        communion: 'Tekster knyttet til nattverden — Kristi legeme og blod, fellesskap og forsoning',
        confirmation: 'Tekster som er egnet for konfirmasjon — tro, valg og velsignelse',
        ordination: 'Tekster knyttet til ordinasjon og kall til tjeneste'
    },
    en: {
        advent: 'Texts related to Advent — waiting, preparation and longing for the Messiah',
        christmas: 'Texts related to the birth of Jesus and the incarnation',
        epiphany: 'Texts related to Jesus\' revelation to the world — the Magi, baptism, miracles',
        lent: 'Texts related to Lent — penance, self-examination and preparation for Easter',
        easter: 'Texts related to Easter — Jesus\' suffering, death and resurrection',
        ascension: 'Texts related to Jesus\' ascension and his lordship',
        pentecost: 'Texts related to Pentecost — the coming of the Holy Spirit and the birth of the church',
        funeral: 'Texts suitable for funerals — comfort, hope and resurrection',
        wedding: 'Texts suitable for weddings — love, covenant and life together',
        baptism: 'Texts related to baptism — rebirth, covenant and belonging',
        communion: 'Texts related to communion — Christ\'s body and blood, fellowship and reconciliation',
        confirmation: 'Texts suitable for confirmation — faith, choice and blessing',
        ordination: 'Texts related to ordination and the call to ministry'
    }
};

const TAG_SCHEMA = {
    type: "object",
    properties: {
        genres: {type: "array", items: {type: "string", enum: GENRE_TAGS}},
        sentiments: {type: "array", items: {type: "string", enum: SENTIMENT_TAGS}},
        themes: {type: "array", items: {type: "string", enum: THEME_TAGS}},
        liturgy: {type: "array", items: {type: "string", enum: LITURGY_TAGS}}
    },
    required: ["genres", "sentiments", "themes", "liturgy"],
    additionalProperties: false
};

function getOriginalSource(bookId: number): string {
    return bookId <= 39 ? 'hebrew' : 'sblgnt';
}

function readOriginalChapter(bookId: number, chapterId: number): string | null {
    const source = getOriginalSource(bookId);
    const sourceFile = path.join(__dirname, `bibles_raw/${source}/${bookId}/${chapterId}.json`);
    if (!fs.existsSync(sourceFile)) return null;
    const verses: Chapter = JSON.parse(fs.readFileSync(sourceFile, 'utf-8'));
    return verses.map(v => `${v.verseId}: ${v.text}`).join('\n');
}

function readTranslatedChapter(bible: string, bookId: number, chapterId: number): string | null {
    const file = path.join(__dirname, `bibles_raw/${bible}/${bookId}/${chapterId}.json`);
    if (!fs.existsSync(file)) return null;
    const verses: Chapter = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return verses.map(v => `${v.verseId}: ${v.text}`).join('\n');
}

function getTagPrompt(language: string, bookId: number, chapterId: number, chapterText: string): string {
    const bookName = getBookName(bookId, language);
    const langCode = getLanguageCode(language);
    const ref = `${bookName} ${chapterId}`;

    if (langCode === 'nb') {
        return `Klassifiser ${ref} med tagger i fire kategorier.

SJANGRE (velg 1-3 som passer best):
${GENRE_TAGS.map(t => `- ${t}: ${GENRE_NAMES.nb[t]}`).join('\n')}

SENTIMENT/TONE (velg 1-3 som passer best):
${SENTIMENT_TAGS.map(t => `- ${t}: ${SENTIMENT_NAMES.nb[t]}`).join('\n')}

TEMAER (velg 1-4 sentrale temaer):
${THEME_TAGS.map(t => `- ${t}: ${THEME_NAMES.nb[t]}`).join('\n')}

LITURGISK BRUK (velg 0-3 — kun hvis kapitlet tydelig passer til en kirkelig anledning):
${LITURGY_TAGS.map(t => `- ${t}: ${LITURGY_NAMES.nb[t]}`).join('\n')}

Velg bare tagger som tydelig passer. Bedre å velge for få enn for mange. Liturgi-tagger kan være tom array.

Teksten:
${chapterText}`;
    } else {
        return `Classify ${ref} with tags in four categories.

GENRES (pick 1-3 that fit best):
${GENRE_TAGS.map(t => `- ${t}: ${GENRE_NAMES.en[t]}`).join('\n')}

SENTIMENTS (pick 1-3 that fit best):
${SENTIMENT_TAGS.map(t => `- ${t}: ${SENTIMENT_NAMES.en[t]}`).join('\n')}

THEMES (pick 1-4 central themes):
${THEME_TAGS.map(t => `- ${t}: ${THEME_NAMES.en[t]}`).join('\n')}

LITURGICAL USE (pick 0-3 — only if the chapter clearly fits a church occasion):
${LITURGY_TAGS.map(t => `- ${t}: ${LITURGY_NAMES.en[t]}`).join('\n')}

Only pick tags that clearly fit. Better too few than too many. Liturgy tags can be an empty array.

Text:
${chapterText}`;
    }
}

function ensureDir(filepath: string): void {
    const dir = path.dirname(filepath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, {recursive: true});
}

/** Ett kapittel utpekt av bok-id og kapittelnummer, slik det ligger i en taggfil. */
interface TagChapterRef {
    bookId: number;
    chapterId: number;
}

/** Innholdet i `tags/<lang>/<kategori>/<tagg>.json`. */
interface TagFile {
    id: string;
    category: string;
    name: string;
    description: string;
    references: TagChapterRef[];
}

/**
 * `names`/`descriptions` er `Record<string, string>` og ikke den smalere
 * tagg-unionen: funksjonen kalles med alle fire kategoriene, som har hver sin
 * union av nøkler.
 */
function addReference(
    tagDir: string,
    category: string,
    tagId: string,
    names: Record<string, string>,
    descriptions: Record<string, string>,
    bookId: number,
    chapterId: number
): boolean {
    const file = path.join(tagDir, category, `${tagId}.json`);
    let data: TagFile;
    if (fs.existsSync(file)) {
        data = JSON.parse(fs.readFileSync(file, 'utf-8'));
    } else {
        data = {
            id: tagId,
            category,
            name: names[tagId] || tagId,
            description: descriptions[tagId] || '',
            references: []
        };
    }

    const refKey = `${bookId}:${chapterId}`;
    const exists = data.references.some(r => `${r.bookId}:${r.chapterId}` === refKey);
    if (exists) return false;

    data.references.push({bookId, chapterId});
    ensureDir(file);
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    return true;
}

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
 * Skriptet tar nøyaktig de samme flaggene som før — den gamle bruksmeldingen og
 * den gamle parseren var enige om listen. Forskjellen er at et ukjent flagg nå
 * stopper jobben i stedet for å bli ignorert, og at `--help` kommer ut før noe
 * leses fra disk.
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
    help: COMMON_FLAGS.help,
};

const HELP_EXAMPLES = [
    'bun generate/chapter_tags.ts --bible osnb --book 1                # tagg 1. Mosebok',
    'bun generate/chapter_tags.ts --bible osnb --nt --local            # tagg NT med lokal Ollama',
    'bun generate/chapter_tags.ts --bible osnb --book 19 --chapter 23  # tagg Salme 23',
    'bun generate/chapter_tags.ts --bible osnb --force                 # tagg alt på nytt',
    '',
    'Taggene havner i tags/<språkkode>/<kategori>/<tagg>.json, med kategoriene',
    'genre, sentiment, theme og liturgy.',
    '',
    `Sjangre:    ${GENRE_TAGS.join(', ')}`,
    `Sentiment:  ${SENTIMENT_TAGS.join(', ')}`,
    `Temaer:     ${THEME_TAGS.join(', ')}`,
    `Liturgi:    ${LITURGY_TAGS.join(', ')}`,
];

/** Flaggene skriptet kjenner. `null` = ikke oppgitt, ikke «tom». */
interface TagOptions {
    language: string;
    bible: string | null;
    bookStart: number | null;
    bookEnd: number | null;
    chapterStart: number | null;
    chapterEnd: number | null;
    local: boolean;
    force: boolean;
}

/**
 * Leser kommandolinja gjennom den felles kontrakten og oversetter til `TagOptions`.
 *
 * `--ot`/`--nt` satte bok-intervallet direkte i den gamle parseren, så det
 * flagget som sto sist på linja vant over `--book`. Rekkefølgen finnes ikke i
 * kontrakten, og et eksplisitt `--book` er det mest presise ønsket — derfor
 * vinner det her. Samme presedens som references.ts.
 */
function readOptions(flags: ReturnType<typeof parseArgs>['flags']): TagOptions {
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
    };
}

/** Svaret fra modellen, dekodet mot `TAG_SCHEMA`. */
interface TagResult {
    genres: GenreTag[];
    sentiments: SentimentTag[];
    themes: ThemeTag[];
    liturgy: LiturgyTag[];
}

async function main(): Promise<void> {
    // Hjelpen skal ut før noe leses fra disk eller sendes over nettet.
    const {flags} = parseArgs(process.argv.slice(2), SPEC);
    if (flags.help) {
        console.log(formatHelp(
            'generate/chapter_tags.ts',
            'sjanger-, sentiment-, tema- og liturgitagger per kapittel',
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
    const tagDir = path.join(__dirname, 'tags', langCode);
    // `getLanguageCode` gir en vilkårlig språkkode, og bare `nb`/`en` finnes i
    // tabellene. `as TagLang` lar oppslaget kompilere; `|| …en` er fallbacken
    // som alt fanget de andre kodene før typene kom til.
    const genreNames = GENRE_NAMES[langCode as TagLang] || GENRE_NAMES.en;
    const genreDescriptions = GENRE_DESCRIPTIONS[langCode as TagLang] || GENRE_DESCRIPTIONS.en;
    const sentimentNames = SENTIMENT_NAMES[langCode as TagLang] || SENTIMENT_NAMES.en;
    const sentimentDescriptions = SENTIMENT_DESCRIPTIONS[langCode as TagLang] || SENTIMENT_DESCRIPTIONS.en;
    const themeNames = THEME_NAMES[langCode as TagLang] || THEME_NAMES.en;
    const themeDescriptions = THEME_DESCRIPTIONS[langCode as TagLang] || THEME_DESCRIPTIONS.en;
    const liturgyNames = LITURGY_NAMES[langCode as TagLang] || LITURGY_NAMES.en;
    const liturgyDescriptions = LITURGY_DESCRIPTIONS[langCode as TagLang] || LITURGY_DESCRIPTIONS.en;

    const bookStart = options.bookStart || 1;
    const bookEnd = options.bookEnd || 66;
    const chapterStart = options.chapterStart || null;
    const chapterEnd = options.chapterEnd || null;

    // Track which chapters are already tagged (for --force check)
    const taggedChapters = new Set<string>();
    if (!options.force) {
        // Scan all existing tag files to find already-tagged chapters
        for (const category of ['genre', 'sentiment', 'theme', 'liturgy']) {
            const catDir = path.join(tagDir, category);
            if (!fs.existsSync(catDir)) continue;
            for (const file of fs.readdirSync(catDir).filter(f => f.endsWith('.json'))) {
                const data: TagFile = JSON.parse(fs.readFileSync(path.join(catDir, file), 'utf-8'));
                for (const ref of data.references || []) {
                    taggedChapters.add(`${ref.bookId}:${ref.chapterId}`);
                }
            }
        }
    }

    const totalChapters = countChapters(bookStart, bookEnd, chapterStart, chapterEnd);
    console.log(`Tagging ${totalChapters} chapters from ${options.bible} (${useLocal ? 'Ollama' : 'Claude'})...`);
    if (bookStart !== 1 || bookEnd !== 66) console.log(`  Books: ${bookStart}-${bookEnd}`);
    if (chapterStart) console.log(`  Chapters: ${chapterStart}-${chapterEnd}`);
    console.log('');

    let processed = 0;
    let tagged = 0;
    let skipped = 0;
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
            const rate = processed / elapsed;
            const remaining = Math.round((totalChapters - processed) / rate);
            const mins = Math.floor(remaining / 60);
            const secs = remaining % 60;
            process.stdout.write(`\r  [${pct}%] ${processed}/${totalChapters} — ${bookName} ${chapterId} — ${tagged} tagged — ~${mins}m${secs}s left${''.padEnd(10)}`);

            // Skip if already tagged
            if (!options.force && taggedChapters.has(`${book.id}:${chapterId}`)) {
                skipped++;
                continue;
            }

            // Prefer translated text, fall back to original
            let chapterText = readTranslatedChapter(options.bible, book.id, chapterId);
            if (!chapterText) {
                chapterText = readOriginalChapter(book.id, chapterId);
            }
            if (!chapterText) continue;

            const prompt = getTagPrompt(options.language, book.id, chapterId, chapterText);

            try {
                // `callWithRetry` er typet `object | string`; med skjema er det
                // det dekodede objektet. Påstanden navngir formen skjemaet krever.
                const result = await callWithRetry(prompt, {schema: TAG_SCHEMA, local: useLocal, task: 'tags', context: `${book.id}:${chapterId}`}) as TagResult;

                for (const genre of result.genres) {
                    addReference(tagDir, 'genre', genre, genreNames, genreDescriptions, book.id, chapterId);
                }
                for (const sentiment of result.sentiments) {
                    addReference(tagDir, 'sentiment', sentiment, sentimentNames, sentimentDescriptions, book.id, chapterId);
                }
                for (const theme of result.themes) {
                    addReference(tagDir, 'theme', theme, themeNames, themeDescriptions, book.id, chapterId);
                }
                for (const lit of result.liturgy) {
                    addReference(tagDir, 'liturgy', lit, liturgyNames, liturgyDescriptions, book.id, chapterId);
                }
                tagged++;
            } catch (error) {
                process.stdout.write(`\n  Error tagging ${bookName} ${chapterId}: ${(error as Error).message}\n`);
            }
        }
    }

    process.stdout.write('\r' + ''.padEnd(100) + '\r');
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(`\nDone in ${Math.floor(elapsed / 60)}m${elapsed % 60}s — ${tagged} tagged, ${skipped} skipped`);
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
