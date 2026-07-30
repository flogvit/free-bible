import dotenv from 'dotenv'
import * as fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config()

import {books, normalizeLanguage, getLanguageCode, getBookName} from "./constants.js";
import {callWithRetry, callOllamaRaw} from "./llm.js";

let useLocal = false;

const GENRE_TAGS = ['law', 'narrative', 'poetry', 'prophecy', 'wisdom', 'epistle', 'apocalyptic', 'genealogy', 'psalm', 'parable'];
const SENTIMENT_TAGS = ['comfort', 'warning', 'praise', 'lament', 'teaching', 'judgment', 'promise', 'prayer'];
const THEME_TAGS = ['covenant', 'salvation', 'creation', 'sin', 'faith', 'love', 'justice', 'sacrifice', 'healing', 'prayer', 'holiness', 'mercy', 'kingdom', 'resurrection', 'repentance', 'obedience'];
const LITURGY_TAGS = ['advent', 'christmas', 'epiphany', 'lent', 'easter', 'ascension', 'pentecost', 'funeral', 'wedding', 'baptism', 'communion', 'confirmation', 'ordination'];

const GENRE_NAMES = {
    nb: {law: 'Lov', narrative: 'Fortelling', poetry: 'Poesi', prophecy: 'Profeti', wisdom: 'Visdom', epistle: 'Brev', apocalyptic: 'Apokalyptisk', genealogy: 'Slektstavle', psalm: 'Salme', parable: 'Lignelse'},
    en: {law: 'Law', narrative: 'Narrative', poetry: 'Poetry', prophecy: 'Prophecy', wisdom: 'Wisdom', epistle: 'Epistle', apocalyptic: 'Apocalyptic', genealogy: 'Genealogy', psalm: 'Psalm', parable: 'Parable'}
};

const GENRE_DESCRIPTIONS = {
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

const SENTIMENT_NAMES = {
    nb: {comfort: 'Trøst', warning: 'Advarsel', praise: 'Lovprisning', lament: 'Klage', teaching: 'Undervisning', judgment: 'Dom', promise: 'Løfte', prayer: 'Bønn'},
    en: {comfort: 'Comfort', warning: 'Warning', praise: 'Praise', lament: 'Lament', teaching: 'Teaching', judgment: 'Judgment', promise: 'Promise', prayer: 'Prayer'}
};

const SENTIMENT_DESCRIPTIONS = {
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

const THEME_NAMES = {
    nb: {covenant: 'Pakt', salvation: 'Frelse', creation: 'Skapelse', sin: 'Synd', faith: 'Tro', love: 'Kjærlighet', justice: 'Rettferdighet', sacrifice: 'Offer', healing: 'Helbredelse', prayer: 'Bønn', holiness: 'Hellighet', mercy: 'Barmhjertighet', kingdom: 'Guds rike', resurrection: 'Oppstandelse', repentance: 'Omvendelse', obedience: 'Lydighet'},
    en: {covenant: 'Covenant', salvation: 'Salvation', creation: 'Creation', sin: 'Sin', faith: 'Faith', love: 'Love', justice: 'Justice', sacrifice: 'Sacrifice', healing: 'Healing', prayer: 'Prayer', holiness: 'Holiness', mercy: 'Mercy', kingdom: 'Kingdom of God', resurrection: 'Resurrection', repentance: 'Repentance', obedience: 'Obedience'}
};

const THEME_DESCRIPTIONS = {
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

const LITURGY_NAMES = {
    nb: {advent: 'Advent', christmas: 'Jul', epiphany: 'Åpenbaring', lent: 'Faste', easter: 'Påske', ascension: 'Kristi himmelfartsdag', pentecost: 'Pinse', funeral: 'Begravelse', wedding: 'Bryllup', baptism: 'Dåp', communion: 'Nattverd', confirmation: 'Konfirmasjon', ordination: 'Ordinasjon'},
    en: {advent: 'Advent', christmas: 'Christmas', epiphany: 'Epiphany', lent: 'Lent', easter: 'Easter', ascension: 'Ascension', pentecost: 'Pentecost', funeral: 'Funeral', wedding: 'Wedding', baptism: 'Baptism', communion: 'Communion', confirmation: 'Confirmation', ordination: 'Ordination'}
};

const LITURGY_DESCRIPTIONS = {
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

function getOriginalSource(bookId) {
    return bookId <= 39 ? 'hebrew' : 'sblgnt';
}

function readOriginalChapter(bookId, chapterId) {
    const source = getOriginalSource(bookId);
    const sourceFile = path.join(__dirname, `bibles_raw/${source}/${bookId}/${chapterId}.json`);
    if (!fs.existsSync(sourceFile)) return null;
    const verses = JSON.parse(fs.readFileSync(sourceFile, 'utf-8'));
    return verses.map(v => `${v.verseId}: ${v.text}`).join('\n');
}

function readTranslatedChapter(bible, bookId, chapterId) {
    const file = path.join(__dirname, `bibles_raw/${bible}/${bookId}/${chapterId}.json`);
    if (!fs.existsSync(file)) return null;
    const verses = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return verses.map(v => `${v.verseId}: ${v.text}`).join('\n');
}

function getTagPrompt(language, bookId, chapterId, chapterText) {
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

function ensureDir(filepath) {
    const dir = path.dirname(filepath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, {recursive: true});
}

function addReference(tagDir, category, tagId, names, descriptions, bookId, chapterId) {
    const file = path.join(tagDir, category, `${tagId}.json`);
    let data;
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

function countChapters(bookStart, bookEnd, chapterStart, chapterEnd) {
    let total = 0;
    for (const book of books) {
        if (book.id < bookStart || book.id > bookEnd) continue;
        const startCh = (book.id === bookStart && chapterStart) ? chapterStart : 1;
        const endCh = (book.id === bookEnd && chapterEnd) ? Math.min(chapterEnd, book.chapters) : book.chapters;
        total += endCh - startCh + 1;
    }
    return total;
}

function printUsage() {
    console.log(`
Usage: node chapter_tags.mjs [options]

Options:
  --language <lang>    Language (default: nb)
  --bible <name>       Bible translation for readable text (e.g., osnb)
  --book <range>       Process book(s): single (43) or range (1-20)
  --chapter <range>    Process chapter(s): single (1) or range (1-10)
  --ot                 Process only Old Testament (books 1-39)
  --nt                 Process only New Testament (books 40-66)
  --local              Use Ollama instead of Claude
  --force              Re-tag even if chapter already tagged
  --help               Show this help message

Genre tags: ${GENRE_TAGS.join(', ')}
Sentiment tags: ${SENTIMENT_TAGS.join(', ')}

Output structure:
  tags/<lang>/genre/<tag>.json
  tags/<lang>/sentiment/<tag>.json

Examples:
  node chapter_tags.mjs --bible osnb --book 1                # Tag Genesis
  node chapter_tags.mjs --bible osnb --nt --local             # Tag NT with Ollama
  node chapter_tags.mjs --bible osnb --book 19 --chapter 23   # Tag Psalm 23
  node chapter_tags.mjs --bible osnb --force                  # Re-tag everything
`);
}

function parseRange(value) {
    if (value.includes('-')) {
        const [start, end] = value.split('-').map(n => parseInt(n, 10));
        return {start, end};
    }
    const num = parseInt(value, 10);
    return {start: num, end: num};
}

async function main() {
    const args = process.argv.slice(2);
    const options = {
        language: 'Norwegian bokmål',
        bible: null,
        bookStart: null,
        bookEnd: null,
        chapterStart: null,
        chapterEnd: null,
        local: false,
        force: false,
        help: false
    };

    let i = 0;
    while (i < args.length) {
        const arg = args[i];
        if (arg === '--language' && i + 1 < args.length) {
            options.language = args[++i];
        } else if (arg === '--bible' && i + 1 < args.length) {
            options.bible = args[++i];
        } else if (arg === '--book' && i + 1 < args.length) {
            const range = parseRange(args[++i]);
            options.bookStart = range.start;
            options.bookEnd = range.end;
        } else if (arg === '--chapter' && i + 1 < args.length) {
            const range = parseRange(args[++i]);
            options.chapterStart = range.start;
            options.chapterEnd = range.end;
        } else if (arg === '--ot') {
            options.bookStart = 1;
            options.bookEnd = 39;
        } else if (arg === '--nt') {
            options.bookStart = 40;
            options.bookEnd = 66;
        } else if (arg === '--local') {
            options.local = true;
        } else if (arg === '--force') {
            options.force = true;
        } else if (arg === '--help') {
            options.help = true;
        }
        i++;
    }

    options.language = normalizeLanguage(options.language);
    useLocal = options.local;

    if (options.help) {
        printUsage();
        return;
    }

    if (!options.bible) {
        console.error('--bible <name> is required (e.g., --bible osnb)');
        return;
    }

    const langCode = getLanguageCode(options.language);
    const tagDir = path.join(__dirname, 'tags', langCode);
    const genreNames = GENRE_NAMES[langCode] || GENRE_NAMES.en;
    const genreDescriptions = GENRE_DESCRIPTIONS[langCode] || GENRE_DESCRIPTIONS.en;
    const sentimentNames = SENTIMENT_NAMES[langCode] || SENTIMENT_NAMES.en;
    const sentimentDescriptions = SENTIMENT_DESCRIPTIONS[langCode] || SENTIMENT_DESCRIPTIONS.en;
    const themeNames = THEME_NAMES[langCode] || THEME_NAMES.en;
    const themeDescriptions = THEME_DESCRIPTIONS[langCode] || THEME_DESCRIPTIONS.en;
    const liturgyNames = LITURGY_NAMES[langCode] || LITURGY_NAMES.en;
    const liturgyDescriptions = LITURGY_DESCRIPTIONS[langCode] || LITURGY_DESCRIPTIONS.en;

    const bookStart = options.bookStart || 1;
    const bookEnd = options.bookEnd || 66;
    const chapterStart = options.chapterStart || null;
    const chapterEnd = options.chapterEnd || null;

    // Track which chapters are already tagged (for --force check)
    const taggedChapters = new Set();
    if (!options.force) {
        // Scan all existing tag files to find already-tagged chapters
        for (const category of ['genre', 'sentiment', 'theme', 'liturgy']) {
            const catDir = path.join(tagDir, category);
            if (!fs.existsSync(catDir)) continue;
            for (const file of fs.readdirSync(catDir).filter(f => f.endsWith('.json'))) {
                const data = JSON.parse(fs.readFileSync(path.join(catDir, file), 'utf-8'));
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
                const result = await callWithRetry(prompt, {schema: TAG_SCHEMA, local: useLocal, task: 'tags', context: `${book.id}:${chapterId}`});

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
                process.stdout.write(`\n  Error tagging ${bookName} ${chapterId}: ${error.message}\n`);
            }
        }
    }

    process.stdout.write('\r' + ''.padEnd(100) + '\r');
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(`\nDone in ${Math.floor(elapsed / 60)}m${elapsed % 60}s — ${tagged} tagged, ${skipped} skipped`);
}

main().catch(console.error);
