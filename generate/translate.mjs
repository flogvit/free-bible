import dotenv from 'dotenv'
import * as fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {fileURLToPath} from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config()

import {normalizeLanguage, getLanguageCode, getTaskModel, anthropicModel, bibles, getBookName} from "./constants.js";
import {callWithRetry} from "./llm.js";

// Directories under generate/ with translatable content in <dir>/<lang>/
// keepKeys: JSON keys whose values are machine values and must not be translated.
// Order matters: dirs are processed top to bottom (references last - 10k+ files).
// Not listed on purpose: proofread_*, stories_proposed, stories_rejected
// (internal pipeline artifacts, not published content).
const CONTENT_DIRS = {
    'chapter_summaries': {ext: '.md'},
    'book_summaries': {ext: '.md'},
    'chapter_context': {ext: '.md'},
    'book_context': {ext: '.md'},
    'chapter_insights': {ext: '.json', keepKeys: ['type', 'personId']},
    'days': {ext: '.json', keepKeys: ['id', 'category', 'relevance']},
    'day_tags': {ext: '.json', keepKeys: ['id', 'relevance', 'date']},
    'tags': {ext: '.json', keepKeys: ['id', 'category']},
    'themes': {ext: '.json', keepKeys: ['id']},
    'timeline': {ext: '.json', keepKeys: ['id', 'importance', 'period', 'section', 'color', 'eventsFile']},
    'stories': {ext: '.json', keepKeys: ['slug', 'id', 'category', 'verdict', 'date']},
    // relatedPersons/siblings/children er ID-REFERANSER, ikke navn. De sto
    // utenfor keepKeys, og modellen oversatte dem til visningsnavn: «paulus» ble
    // «Paul», «johannes-apostel» ble «John the Apostle». 1869 av 2029 engelske
    // personfiler hadde dermed referansefelt som ikke kunne slås opp. father,
    // mother og spouse sto i lista og var derfor uskadd — det er forskjellen som
    // avslørte det.
    'persons': {ext: '.json', keepKeys: ['id', 'era', 'source', 'father', 'mother', 'spouse', 'date', 'relatedPersons', 'siblings', 'children']},
    'number_symbolism': {ext: '.json', keepKeys: ['id', 'source', 'date']},
    'prophecies': {ext: '.json', keepKeys: ['id', 'category']},
    // Både ord og forklaring skal oversettes, derfor tom keepKeys.
    'important_words': {ext: '.json', keepKeys: []},
    'verse_prayer': {ext: '.txt'},
    'verse_sermon': {ext: '.txt'},
    'reading_plans': {ext: '.json', keepKeys: ['id', 'category']},
    'daily_verse': {ext: '.json', keepKeys: ['date', 'ref']},
    'gospel_parallels': {ext: '.json', keepKeys: ['id', 'section']},
    'references': {ext: '.json', keepKeys: []},
};

// Target-language quote style. « » in the source is converted to these after
// translation. null = keep « » as-is.
const QUOTE_STYLES = {
    en: {open: '"', close: '"'},   // straight quotes — matches what the model produces when it converts on its own
    es: {open: '«', close: '»'},   // « » (RAE standard; also normalizes any “ ” the model produces)
    de: {open: '„', close: '“'},   // „ “
    sv: {open: '”', close: '”'},   // ” ”
    da: {open: '»', close: '«'},   // » «
    fr: null,
    nn: null,
};

// Per-language examples of published Bible translations the model must not
// reproduce verbatim when translating quoted verses
const BIBLE_TRANSLATION_EXAMPLES = {
    en: 'ESV, NIV, KJV',
    es: 'Reina-Valera, NVI, Dios Habla Hoy',
    de: 'Lutherbibel, Elberfelder, Einheitsübersetzung',
    fr: 'Louis Segond, TOB',
    sv: 'Bibel 2000, Svenska Folkbibeln',
    da: 'Bibelen 1992',
};

function translationExamples(langCode) {
    return BIBLE_TRANSLATION_EXAMPLES[langCode] || 'ESV, NIV, KJV';
}

// Project Bible translation per language code (en → osen, es → oses, ...), derived
// from constants so a new translation is picked up without touching this file
const BIBLE_TRANSLATIONS = Object.fromEntries(
    Object.entries(bibles).map(([translation, language]) => [getLanguageCode(language), translation])
);

const bibleChapterCache = new Map();

function loadBibleChapter(translation, bookId, chapterId) {
    const key = `${translation}/${bookId}/${chapterId}`;
    if (!bibleChapterCache.has(key)) {
        const chapterPath = path.join(__dirname, 'bibles_raw', translation, String(bookId), `${chapterId}.json`);
        bibleChapterCache.set(key, fs.existsSync(chapterPath) ? JSON.parse(fs.readFileSync(chapterPath, 'utf-8')) : null);
    }
    return bibleChapterCache.get(key);
}

// Verse reference objects anywhere in a JSON tree (the stories/themes shape:
// bookId + startChapter/startVerse, optionally endChapter/endVerse)
function collectVerseRefs(obj, out = []) {
    if (Array.isArray(obj)) {
        obj.forEach(v => collectVerseRefs(v, out));
    } else if (obj !== null && typeof obj === 'object') {
        if (Number.isInteger(obj.bookId) && Number.isInteger(obj.startChapter) && Number.isInteger(obj.startVerse)) {
            out.push(obj);
        } else {
            Object.values(obj).forEach(v => collectVerseRefs(v, out));
        }
    }
    return out;
}

// Keeps the prompt well inside num_ctx even for stories spanning several chapters
const MAX_QUOTE_CONTEXT_CHARS = 8000;

// The current file's Bible text for quoted passages, set per file in the main
// loop (same pattern as useRemote). null = no project Bible for the language,
// no quotes in the source, or no way to tell which verses are quoted.
let quoteContext = null;

// Quoted Bible text in study material should match the project's own Bible for
// the target language: the reader meets the same wording here as in the Bible
// text itself, and the model cannot drift into a published translation. The
// verses are found via the file's own references (JSON) or its book-chapter
// filename (markdown/txt); book-level files are skipped - a whole book does
// not fit in the prompt.
function buildQuoteContext(item, langCode, language) {
    const translation = BIBLE_TRANSLATIONS[langCode];
    if (!translation || !item.sourceText.includes('«')) return null;

    let refs;
    if (item.config.ext === '.json') {
        refs = collectVerseRefs(JSON.parse(item.sourceText));
    } else {
        const bookId = bookIdOf(item.filename);
        const chapterId = chapterIdOf(item.filename);
        if (Number.isNaN(bookId) || chapterId === null) return null;
        refs = [{bookId, startChapter: chapterId, startVerse: 1}];
    }

    const seen = new Set();
    let block = '';
    for (const ref of refs) {
        const endChapter = ref.endChapter ?? ref.startChapter;
        for (let ch = ref.startChapter; ch <= endChapter; ch++) {
            const verses = loadBibleChapter(translation, ref.bookId, ch);
            if (!verses) continue;
            for (const v of verses) {
                if (ch === ref.startChapter && v.verseId < ref.startVerse) continue;
                if (ch === endChapter && ref.endVerse !== undefined && v.verseId > ref.endVerse) continue;
                const verseKey = `${ref.bookId}:${ch}:${v.verseId}`;
                if (seen.has(verseKey)) continue;
                seen.add(verseKey);
                const line = `${getBookName(ref.bookId, language)} ${ch}:${v.verseId} ${v.text}\n`;
                if (block.length + line.length > MAX_QUOTE_CONTEXT_CHARS) return block.trimEnd() || null;
                block += line;
            }
        }
    }
    return block.trimEnd() || null;
}

// The quote rule for the prompts: with a project Bible available the quoted
// text must follow it; without one the old behavior (free, natural wording)
function quotePromptParts(language) {
    const langCode = getLanguageCode(language);
    if (!quoteContext) {
        return {
            rule: `- Translate quoted Bible phrases into natural, plain ${language} wording. Do NOT reproduce the exact wording of any specific published Bible translation (such as ${translationExamples(langCode)}).`,
            block: ''
        };
    }
    return {
        rule: `- Quoted Bible text (inside « ») must follow the wording of the project's own ${language} Bible translation given under "Bible text for quoted passages", adjusted only where the surrounding sentence requires it. Do NOT reproduce the wording of any other published Bible translation (such as ${translationExamples(langCode)}).`,
        block: `\nBible text for quoted passages:\n${quoteContext}\n`
    };
}

// Hebrew/Greek with vowel points tokenizes very expensively - long
// chapter_context files can exceed 16k total tokens and get truncated
const OLLAMA_OPTIONS = {num_ctx: 32768};

const TASK = 'translate';

function getStatePath(langCode) {
    return path.join(__dirname, `translate_state/${langCode}.json`);
}

function loadState(langCode) {
    const statePath = getStatePath(langCode);
    if (fs.existsSync(statePath)) {
        return JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    }
    return {};
}

function saveState(langCode, state) {
    const statePath = getStatePath(langCode);
    const dir = path.dirname(statePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, {recursive: true});
    }
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

function contentHash(text) {
    return crypto.createHash('sha256').update(text).digest('hex');
}

/**
 * Resume-markøren for en kildefil. Dekker DET SOM OVERSETTES, ikke hele fila.
 *
 * Hele fila var feil grunnlag: keepKeys sier at en verdi er en maskinverdi og
 * ikke skal oversettes, men en endring i nøyaktig de verdiene gjorde likevel
 * oversettelsen foreldet. Da person-id-ene ble rettet (#25) endret 229 nb-filer
 * seg i `id` og i referansefeltene — alt maskinverdier — og 154 oversettelser
 * ble stale uten at ett oversettbart tegn hadde flyttet seg.
 *
 * collectStringPaths er samme funksjon som bestemmer hva som SENDES til modellen,
 * så hashen og arbeidet kan ikke drive fra hverandre. Stien er med i hashen, ikke
 * bare teksten: dukker det opp et nytt oversettbart felt, må fila oversettes selv
 * om de gamle strengene står urørt.
 */
function sourceHash(sourceText, config) {
    if (config.ext !== '.json') return contentHash(sourceText);
    let parsed;
    try {
        parsed = JSON.parse(sourceText);
    } catch {
        return contentHash(sourceText);   // ugyldig JSON: fall tilbake til hele fila
    }
    const items = collectStringPaths(parsed, config.keepKeys || []);
    return contentHash(items.map(i => `${i.path.join('.')}\t${i.text}`).join('\n'));
}

// Natural sort: "1-2.md" before "1-10.md", "books/2.json" before "books/10.json"
function sortNatural(a, b) {
    return a.localeCompare(b, undefined, {numeric: true});
}

// Lists files recursively; returns paths relative to <dir>/<sourceLang>/
// (e.g. "1-1.md" or "books/1.json" for nested dirs like timeline)
function listSourceFiles(dir, ext, sourceLang) {
    const srcDir = path.join(__dirname, dir, sourceLang);
    if (!fs.existsSync(srcDir)) return [];
    const result = [];
    const walk = (sub) => {
        for (const entry of fs.readdirSync(path.join(srcDir, sub), {withFileTypes: true})) {
            if (entry.name.startsWith('.')) continue; // hidden internal artifacts (.flagged_existing.json)
            const rel = sub ? `${sub}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
                walk(rel);
            } else if (entry.name.endsWith(ext)) {
                result.push(rel);
            }
        }
    };
    walk('');
    return result.sort(sortNatural);
}

// Book id from "43.md", "2-3.md" or nested "40/7.json" (book = first dir).
// NaN for non-numeric layouts (e.g. timeline/books/...) - the filters skip those.
function bookIdOf(filename) {
    const firstSegment = filename.split('/')[0];
    return parseInt(/^\d/.test(firstSegment) ? firstSegment : path.basename(filename), 10);
}

// Chapter from "2-3.md" (second number) or nested "40/7.json" (basename);
// null for book-level files like "43.md"
function chapterIdOf(filename) {
    if (filename.includes('/')) {
        const base = parseInt(path.basename(filename), 10);
        return Number.isNaN(base) ? null : base;
    }
    const m = path.basename(filename).match(/^\d+-(\d+)\./);
    return m ? parseInt(m[1], 10) : null;
}

let useRemote = false;

// Havner i translate_state per fil. taskModels.translate ligger øverst i
// localModelRanking, så adopsjonen i resolveLocalModel kan ikke bytte den ut —
// senkes den noen gang, må denne hente den faktisk brukte modellen i stedet.
function activeModel() {
    return useRemote ? anthropicModel : getTaskModel(TASK);
}

function getMarkdownPrompt(language, sourceText) {
    const quote = quotePromptParts(language);
    return `You are a professional translator. Translate the following Norwegian (bokmål) Bible study material into ${language}.

Rules:
- Preserve the markdown structure exactly (same headings, same bullets, same bold/italic markup).
- Keep all Hebrew and Greek words/phrases exactly as they are, untranslated. Keep transliterations in parentheses as they are.
- Use standard ${language} Bible book names in headings and running text, and convert scripture reference abbreviations to the standard ${language} abbreviations.
${quote.rule}
- Keep « » quotation marks exactly as in the source; they are converted automatically afterwards.
- Never mention specific Bible editions, Bible societies or publishers.
- Output ONLY the translated markdown, nothing else.
${quote.block}
Norwegian source:
${sourceText}`;
}

// Strip ```markdown / ``` fences if the model wrapped its output
function stripFences(text) {
    let result = text.trim();
    const fenceMatch = result.match(/^```[a-z]*\n([\s\S]*)\n```$/);
    if (fenceMatch) {
        result = fenceMatch[1];
    }
    return result;
}

// Normalizes both « » from the source and “ ” that the model sometimes
// produces on its own, so the whole corpus ends up with one quote style
function convertQuotes(text, langCode) {
    const style = QUOTE_STYLES[langCode];
    if (!style) return text;
    return text
        .replaceAll('«', style.open).replaceAll('»', style.close)
        .replaceAll('“', style.open).replaceAll('”', style.close);
}

// Structural fingerprint of a markdown document, used to warn about
// translations that dropped or invented structure
function markdownFingerprint(text) {
    const lines = text.split('\n');
    return {
        headings: lines.filter(l => /^#{1,6} /.test(l)).length,
        bullets: lines.filter(l => /^\s*[-*] /.test(l)).length,
        boldMarkers: (text.match(/\*\*/g) || []).length,
    };
}

// The model sometimes converts « » itself despite instructions, so quotes are
// checked after conversion: the final text must contain at least as many
// target-style quote marks as the source has « » marks
function quoteWarnings(sourceText, finalText, langCode) {
    const srcQuotes = (sourceText.match(/[«»]/g) || []).length;
    if (srcQuotes === 0) return [];
    const style = QUOTE_STYLES[langCode];
    const chars = style ? [...new Set([style.open, style.close])] : ['«', '»'];
    let count = 0;
    for (const char of chars) {
        count += finalText.split(char).length - 1;
    }
    if (count < srcQuotes) {
        return [`quotes: source has ${srcQuotes} « » marks, translation has ${count} quote marks`];
    }
    return [];
}

function compareMarkdown(source, translated) {
    const src = markdownFingerprint(source);
    const dst = markdownFingerprint(translated);
    const warnings = [];
    for (const key of Object.keys(src)) {
        if (src[key] !== dst[key]) {
            warnings.push(`${key}: source ${src[key]}, translation ${dst[key]}`);
        }
    }
    return warnings;
}

// Collect every translatable string value in a JSON tree, with its path.
// Machine-value keys (keepKeys) are skipped; for array elements the nearest
// named ancestor key decides (so keepKeys: ['refs'] skips all strings in a
// refs array). Empty strings are skipped.
// Pure ISO dates are never translatable, whatever key they sit under
// (the days files even use year numbers as keys)
function isTranslatable(value, key, keepKeys) {
    return !keepKeys.includes(key) && value.trim() !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(value);
}

function collectStringPaths(obj, keepKeys, path = [], lastKey = '', out = []) {
    if (Array.isArray(obj)) {
        obj.forEach((v, i) => collectStringPaths(v, keepKeys, [...path, i], lastKey, out));
    } else if (obj !== null && typeof obj === 'object') {
        for (const [key, value] of Object.entries(obj)) {
            if (typeof value === 'string') {
                if (isTranslatable(value, key, keepKeys)) {
                    out.push({path: [...path, key], key, text: value});
                }
            } else {
                collectStringPaths(value, keepKeys, [...path, key], key, out);
            }
        }
    } else if (typeof obj === 'string' && isTranslatable(obj, lastKey, keepKeys)) {
        // bare string in an array (e.g. stories keywords)
        out.push({path, key: lastKey, text: obj});
    }
    return out;
}

function setPath(obj, path, value) {
    let target = obj;
    for (let i = 0; i < path.length - 1; i++) {
        target = target[path[i]];
    }
    target[path[path.length - 1]] = value;
}

const BATCH_SCHEMA = {
    type: 'object',
    properties: {translations: {type: 'array', items: {type: 'string'}}},
    required: ['translations']
};

function getBatchPrompt(language, items) {
    const quote = quotePromptParts(language);
    const list = items.map(it => ({key: it.key, text: it.text}));
    return `You are a professional translator. Translate the "text" value of each entry below from Norwegian (bokmål) into ${language}.

Rules:
- Return JSON: {"translations": [...]} with EXACTLY ${items.length} strings, in the same order as the input entries.
- The "key" field is context only (what the string is used for) - never include it in the output.
- Keep all Hebrew and Greek words/phrases exactly as they are, untranslated.
- Use standard ${language} Bible book names and person names, and convert scripture reference abbreviations to the standard ${language} abbreviations.
${quote.rule}
- Keep « » quotation marks as in the source; they are converted automatically afterwards.
- Preserve any markdown markup inside the strings.
${quote.block}
Input entries:
${JSON.stringify(list, null, 1)}`;
}

// Max strings per LLM call - small lists keep the model's counting reliable
const BATCH_SIZE = 15;

// A chunk that comes back miscounted is bisected and each half retried -
// this always converges, ending at single strings which fall back to plain
// text translation if even a one-element array fails
async function translateStringChunk(language, langCode, items, context) {
    const prompt = getBatchPrompt(language, items);
    const valid = out => out && Array.isArray(out.translations)
        && out.translations.length === items.length
        && out.translations.every(s => typeof s === 'string');

    const out = await callWithRetry(prompt, {schema: BATCH_SCHEMA, local: !useRemote, task: TASK, think: false, ollamaOptions: OLLAMA_OPTIONS, context});
    if (valid(out)) {
        return out.translations;
    }
    if (items.length === 1) {
        console.log(`  single-item batch failed, translating as plain text...`);
        return [await translateLongString(language, langCode, items[0].text, context)];
    }
    console.log(`  batch of ${items.length} miscounted, bisecting...`);
    const mid = Math.ceil(items.length / 2);
    return [
        ...await translateStringChunk(language, langCode, items.slice(0, mid), `${context}a`),
        ...await translateStringChunk(language, langCode, items.slice(mid), `${context}b`)
    ];
}

// Long strings break the model's ability to return a correctly counted
// array, so they are translated one by one as plain text instead
const LONG_STRING_CHARS = 500;

async function translateLongString(language, langCode, text, context) {
    const prompt = getTextPrompt(language, text);
    let raw = await callWithRetry(prompt, {local: !useRemote, task: TASK, think: false, ollamaOptions: OLLAMA_OPTIONS, context});
    if (looksTruncated(stripFences(raw))) {
        console.log(`  long string looks truncated, retrying with temperature...`);
        raw = await callWithRetry(prompt, {local: !useRemote, task: TASK, think: false, ollamaOptions: {...OLLAMA_OPTIONS, temperature: 0.4}, context});
    }
    return stripFences(raw);
}

async function translateStringBatch(language, langCode, items, context) {
    // Identical strings (repeated year labels, region names, ...) are
    // translated once and fanned back out - repetition inside a chunk makes
    // the model merge entries, and this also saves tokens
    const unique = new Map();
    for (const item of items) {
        if (!unique.has(item.text)) {
            unique.set(item.text, {key: item.key, text: item.text, translation: null});
        }
    }
    const uniqueItems = [...unique.values()];

    const longs = uniqueItems.filter(u => u.text.length > LONG_STRING_CHARS);
    const shorts = uniqueItems.filter(u => u.text.length <= LONG_STRING_CHARS);

    for (let i = 0; i < longs.length; i++) {
        longs[i].translation = await translateLongString(language, langCode, longs[i].text, `${context} [long ${i + 1}]`);
    }
    for (let i = 0; i < shorts.length; i += BATCH_SIZE) {
        const chunk = shorts.slice(i, i + BATCH_SIZE);
        const translated = await translateStringChunk(language, langCode, chunk, `${context} [${i + 1}-${i + chunk.length}]`);
        chunk.forEach((u, k) => { u.translation = translated[k]; });
    }
    return items.map(item => unique.get(item.text).translation);
}

// Restore bold on bullet keywords. The model reliably drops ** around bullets
// whose keyword is a quoted phrase (- **«X»:** becomes - "X": or even - "X" text).
// Bullets are matched against the source by position, so bold is only restored
// where the source bullet actually was bold; separator (colon/dash) follows the
// translation, falling back to the source's colon when the model dropped it too.
function restoreBulletBold(sourceText, text, langCode) {
    const style = QUOTE_STYLES[langCode] || {open: '«', close: '»'};
    const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const isBullet = l => /^\s*- /.test(l);

    const srcBullets = sourceText.split('\n').filter(isBullet);
    const lines = text.split('\n');
    const bulletLineNos = [];
    lines.forEach((line, i) => { if (isBullet(line)) bulletLineNos.push(i); });
    if (srcBullets.length !== bulletLineNos.length) return text;

    const keywordRe = new RegExp(
        `^(\\s*- )(${esc(style.open)}[^${esc(style.close)}\\n]+${esc(style.close)}(?: \\([^)\\n]*\\))?)\\s*(:|[–—-])?\\s*(.*)$`
    );

    bulletLineNos.forEach((lineNo, k) => {
        const src = srcBullets[k];
        const line = lines[lineNo];
        if (!/^\s*- \*\*/.test(src) || /^\s*- \*\*/.test(line)) return;

        const m = line.match(keywordRe);
        if (!m) return;
        const [, pre, keyword, sep, rest] = m;
        if (sep === ':' || (!sep && /:\*\*/.test(src))) {
            lines[lineNo] = `${pre}**${keyword}:** ${rest}`.trimEnd();
        } else if (sep) {
            lines[lineNo] = `${pre}**${keyword}** ${sep} ${rest}`.trimEnd();
        } else {
            lines[lineNo] = `${pre}**${keyword}** ${rest}`.trimEnd();
        }
    });
    return lines.join('\n');
}

// A markdown document that stops without terminal punctuation was cut short.
// At temperature 0 this is deterministic (the model can emit EOS mid-word on
// rare token sequences, e.g. Hebrew with vowel points), so the retry needs a
// bit of temperature to escape it.
function looksTruncated(text) {
    const lastLine = text.trimEnd().split('\n').filter(l => l.trim()).pop() || '';
    return !/[.!?»"”\)\]:*]$/.test(lastLine.trim());
}

// Restore bold around quoted keywords inside paragraphs (chapter_context style:
// "Uttrykket **«X»** (hebrew, v. 5) ..." loses its ** in translation). Non-empty
// lines are paired positionally, and within each line pair the quoted phrases
// are paired by index - a quote that is bold in the source gets its bold back
// in the translation. Skips any line where the quote counts do not match.
function restoreQuotedInlineBold(sourceText, text, langCode) {
    const style = QUOTE_STYLES[langCode] || {open: '«', close: '»'};
    const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const srcLines = sourceText.split('\n').filter(l => l.trim());
    const lines = text.split('\n');
    const dstLineNos = [];
    lines.forEach((l, i) => { if (l.trim()) dstLineNos.push(i); });
    if (srcLines.length !== dstLineNos.length) return text;

    const findQuotes = (line, open, close) => {
        const re = new RegExp(`${esc(open)}[^${esc(close)}\\n]+${esc(close)}`, 'g');
        const result = [];
        let m;
        while ((m = re.exec(line)) !== null) {
            const bold = line.slice(Math.max(0, m.index - 2), m.index) === '**';
            result.push({index: m.index, text: m[0], bold});
        }
        return result;
    };

    dstLineNos.forEach((lineNo, k) => {
        const srcQuotes = findQuotes(srcLines[k], '«', '»');
        if (!srcQuotes.some(q => q.bold)) return;
        let dst = lines[lineNo];
        const dstQuotes = findQuotes(dst, style.open, style.close);
        if (srcQuotes.length !== dstQuotes.length) return;

        // right to left so earlier indices stay valid while inserting
        for (let i = dstQuotes.length - 1; i >= 0; i--) {
            if (srcQuotes[i].bold && !dstQuotes[i].bold) {
                const q = dstQuotes[i];
                dst = dst.slice(0, q.index) + '**' + q.text + '**' + dst.slice(q.index + q.text.length);
            }
        }
        lines[lineNo] = dst;
    });
    return lines.join('\n');
}

async function translateMarkdown(language, langCode, sourceText, keepKeys, context) {
    const prompt = getMarkdownPrompt(language, sourceText);
    let raw = await callWithRetry(prompt, {local: !useRemote, task: TASK, think: false, ollamaOptions: OLLAMA_OPTIONS, context});
    if (looksTruncated(stripFences(raw))) {
        console.log(`  output looks truncated, retrying with temperature...`);
        raw = await callWithRetry(prompt, {local: !useRemote, task: TASK, think: false, ollamaOptions: {...OLLAMA_OPTIONS, temperature: 0.4}, context});
        if (looksTruncated(stripFences(raw))) {
            throw new Error('output truncated after temperature retry');
        }
    }
    let text = convertQuotes(stripFences(raw), langCode);

    // the model occasionally bolds the quote marks instead of the phrase:
    // **"**X**"** → **"X"**
    const style = QUOTE_STYLES[langCode];
    if (style) {
        const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const brokenBold = new RegExp(`\\*\\*${esc(style.open)}\\*\\*([^*\\n]+)\\*\\*${esc(style.close)}\\*\\*`, 'g');
        text = text.replace(brokenBold, `**${style.open}$1${style.close}**`);
    }

    const srcBold = markdownFingerprint(sourceText).boldMarkers;
    if (markdownFingerprint(text).boldMarkers < srcBold) {
        text = restoreBulletBold(sourceText, text, langCode);
    }
    if (markdownFingerprint(text).boldMarkers < srcBold) {
        text = restoreQuotedInlineBold(sourceText, text, langCode);
    }

    text += '\n';
    const warnings = [...compareMarkdown(sourceText, text), ...quoteWarnings(sourceText, text, langCode)];
    return {text, warnings};
}

function getTextPrompt(language, sourceText) {
    const quote = quotePromptParts(language);
    return `You are a professional translator. Translate the following Norwegian (bokmål) Bible study text into ${language}.

Rules:
- Keep the line structure exactly: each line in the source corresponds to one line in the translation, including blank lines.
- Keep all Hebrew and Greek words/phrases exactly as they are, untranslated.
- Use standard ${language} Bible book names, and convert scripture reference abbreviations to the standard ${language} abbreviations.
${quote.rule}
- Keep « » quotation marks exactly as in the source; they are converted automatically afterwards.
- Output ONLY the translated text, nothing else.
${quote.block}
Norwegian source:
${sourceText}`;
}

async function translateTxt(language, langCode, sourceText, keepKeys, context) {
    const prompt = getTextPrompt(language, sourceText);
    let raw = await callWithRetry(prompt, {local: !useRemote, task: TASK, think: false, ollamaOptions: OLLAMA_OPTIONS, context});
    if (looksTruncated(stripFences(raw))) {
        console.log(`  output looks truncated, retrying with temperature...`);
        raw = await callWithRetry(prompt, {local: !useRemote, task: TASK, think: false, ollamaOptions: {...OLLAMA_OPTIONS, temperature: 0.4}, context});
        if (looksTruncated(stripFences(raw))) {
            throw new Error('output truncated after temperature retry');
        }
    }
    const text = convertQuotes(stripFences(raw), langCode) + '\n';

    const countLines = t => t.split('\n').filter(l => l.trim()).length;
    const srcLines = countLines(sourceText);
    const dstLines = countLines(text);
    const warnings = srcLines === dstLines ? []
        : [`lines: source ${srcLines}, translation ${dstLines}`];
    return {text, warnings: [...warnings, ...quoteWarnings(sourceText, text, langCode)]};
}

async function translateJson(language, langCode, sourceText, keepKeys, context) {
    // Strings are extracted, translated as a batch, and reinserted - the
    // model never reproduces the JSON itself, so structure, keys, numbers
    // and machine values are correct by construction.
    const source = JSON.parse(sourceText);
    const result = JSON.parse(sourceText);
    const items = collectStringPaths(source, keepKeys || []);

    if (items.length > 0) {
        const translations = await translateStringBatch(language, langCode, items, context);
        // quote conversion happens per string BEFORE serialization -
        // converting after would inject unescaped quotes into the JSON text
        items.forEach((item, i) => setPath(result, item.path, convertQuotes(translations[i], langCode)));
    }

    const text = JSON.stringify(result, null, 2) + '\n';
    return {text, warnings: []};
}

function collectWork(options, state) {
    const work = [];
    for (const dir of options.dirs) {
        const config = CONTENT_DIRS[dir];
        if (!config) {
            console.error(`Unknown content dir: ${dir} (known: ${Object.keys(CONTENT_DIRS).join(', ')})`);
            process.exit(1);
        }
        for (const filename of listSourceFiles(dir, config.ext, options.sourceLang)) {
            if (options.bookStart !== null) {
                const bookId = bookIdOf(filename);
                if (bookId < options.bookStart || bookId > options.bookEnd) continue;
            }
            if (options.chapterStart !== null) {
                const chapterId = chapterIdOf(filename);
                if (chapterId === null || chapterId < options.chapterStart || chapterId > options.chapterEnd) continue;
            }
            const srcPath = path.join(__dirname, dir, options.sourceLang, filename);
            const outPath = path.join(__dirname, dir, options.langCode, filename);
            const key = `${dir}/${filename}`;
            const sourceText = fs.readFileSync(srcPath, 'utf-8');
            const srcHash = sourceHash(sourceText, config);

            let status;
            if (!fs.existsSync(outPath)) {
                status = 'missing';
            } else if (!state[key]) {
                status = 'untracked';
            } else if (state[key].srcHash !== srcHash) {
                status = 'stale';
            } else {
                status = 'current';
            }

            work.push({dir, filename, key, srcPath, outPath, sourceText, srcHash, status, config});
        }
    }
    return work;
}

function printStatus(work) {
    const byDir = {};
    for (const item of work) {
        byDir[item.dir] = byDir[item.dir] || {missing: 0, untracked: 0, stale: 0, current: 0};
        byDir[item.dir][item.status]++;
    }
    console.log('dir                    total  current  stale  untracked  missing');
    for (const [dir, counts] of Object.entries(byDir)) {
        const total = counts.missing + counts.untracked + counts.stale + counts.current;
        console.log(
            dir.padEnd(23) + String(total).padStart(5) + String(counts.current).padStart(9) +
            String(counts.stale).padStart(7) + String(counts.untracked).padStart(11) +
            String(counts.missing).padStart(9)
        );
    }
}

// Untranslated Norwegian left in a translation shows up as a cluster of
// Norwegian function words. Single hits are noise (a Norwegian slug quoted in
// a review note, a liturgical day name), so both an absolute and a relative
// threshold must be met. Only words with no English/Spanish homograph.
const NORWEGIAN_WORDS = /\b(ikke|også|både|være|blir|gjennom|mellom|hvordan|derfor|fordi|kapittel|kapitlet|verset|dette|denne|disse|sier|svarte|hadde|gikk|jeg|dere|når|herren|sønn|sønner)\b/gi;

function norwegianRemnants(text) {
    const hits = text.match(NORWEGIAN_WORDS) || [];
    const words = text.split(/\s+/).filter(Boolean).length;
    if (hits.length >= 3 && hits.length / Math.max(words, 1) >= 0.01) {
        const sample = [...new Set(hits.map(h => h.toLowerCase()))].slice(0, 5);
        return [`norwegian: ${hits.length} Norwegian words in ${words} (${sample.join(', ')})`];
    }
    return [];
}

// Deterministic re-check of an existing translation against its source.
// hard = the translation is wrong (untranslated Norwegian, broken structure)
// and worth re-translating; soft = formatting drift (bold markers, quote
// counts) that a re-translation would not reliably improve.
function checkTranslatedFile(item, langCode) {
    const text = fs.readFileSync(item.outPath, 'utf-8');
    const hard = [];
    const soft = [];

    if (item.config.ext === '.json') {
        let parsed;
        try {
            parsed = JSON.parse(text);
        } catch (error) {
            return {hard: [`invalid JSON: ${error.message}`], soft};
        }
        const keepKeys = item.config.keepKeys || [];
        const srcPaths = collectStringPaths(JSON.parse(item.sourceText), keepKeys).map(s => s.path.join('.'));
        const dstItems = collectStringPaths(parsed, keepKeys);
        if (srcPaths.join('\n') !== dstItems.map(s => s.path.join('.')).join('\n')) {
            hard.push(`structure: translatable strings differ from source (${srcPaths.length} vs ${dstItems.length})`);
        }
        hard.push(...norwegianRemnants(dstItems.map(s => s.text).join(' ')));
    } else if (item.config.ext === '.txt') {
        const countLines = t => t.split('\n').filter(l => l.trim()).length;
        const srcLines = countLines(item.sourceText);
        const dstLines = countLines(text);
        if (srcLines !== dstLines) {
            hard.push(`lines: source ${srcLines}, translation ${dstLines}`);
        }
        hard.push(...norwegianRemnants(text));
        soft.push(...quoteWarnings(item.sourceText, text, langCode));
    } else {
        hard.push(...norwegianRemnants(text));
        soft.push(...compareMarkdown(item.sourceText, text), ...quoteWarnings(item.sourceText, text, langCode));
    }
    return {hard, soft};
}

function runCheck(work, state, options) {
    const missing = work.filter(item => item.status === 'missing');
    const notCurrent = work.filter(item => item.status === 'stale' || item.status === 'untracked');
    const flagged = [];
    const softFindings = [];
    let checked = 0;

    for (const item of work) {
        if (item.status === 'missing') continue;
        checked++;
        const {hard, soft} = checkTranslatedFile(item, options.langCode);
        if (hard.length > 0) {
            flagged.push(item);
            console.log(`${item.key}: ${hard.join('; ')}`);
        }
        if (soft.length > 0) {
            softFindings.push({key: item.key, soft});
        }
    }

    console.log('---');
    console.log(`Checked ${checked} translated files: ${flagged.length} with hard findings, ${softFindings.length} with formatting drift`);
    if (missing.length > 0 || notCurrent.length > 0) {
        console.log(`Not checked: ${missing.length} missing; ${notCurrent.length} stale/untracked (a normal run picks all of these up)`);
    }
    if (softFindings.length > 0 && softFindings.length <= 50) {
        console.log('Formatting drift (informational, not invalidated):');
        for (const {key, soft} of softFindings) {
            console.log(`  ${key}: ${soft.join('; ')}`);
        }
    }

    if (options.invalidate && flagged.length > 0) {
        for (const item of flagged) {
            delete state[item.key];
        }
        saveState(options.langCode, state);
        console.log(`Cleared state for ${flagged.length} file(s) - the next normal run re-translates them`);
    } else if (flagged.length > 0) {
        console.log(`Run with --check --invalidate to re-translate the ${flagged.length} flagged file(s) on the next normal run`);
    }
}

function printUsage() {
    console.log(`
Usage: node translate.mjs --language <lang> [options]

Translates content under <dir>/${'<source>'}/ to <dir>/<lang>/ using the local
Ollama model (${getTaskModel(TASK)}). Tracks the source hash of every translated file in
translate_state/<lang>.json, so files whose source changes are re-translated
on the next run.

Options:
  --language <lang>  Target language (required). Accepts codes (en, de, es, fr,
                     sv, da) or full names
  --source <lang>    Source language code (default: nb)
  --dirs <a,b,c>     Content dirs to translate (default: all)
                     Known: ${Object.keys(CONTENT_DIRS).join(', ')}
  --book <range>     Only files for book(s): single (43) or range (1-39)
  --chapter <range>  Only chapter file(s): single (3) or range (1-10); skips book-level files
  --remote           Use Claude (Anthropic API) instead of local Ollama - for
                     files the local model cannot handle
  --limit <n>        Translate at most n files (for pilot runs)
  --force            Re-translate even if source is unchanged
  --dry-run          List what would be translated, then exit
  --status           Show translation status per dir, then exit
  --check            Verify existing translations (untranslated Norwegian, broken
                     structure), then exit. No LLM calls
  --invalidate       With --check: clear state for flagged files so the next
                     normal run re-translates them
  --help             Show this help message

When the target language has a project Bible (${Object.entries(BIBLE_TRANSLATIONS).map(([code, translation]) => `: `).join(', ')}),
quoted Bible text is translated with the wording of that Bible, looked up via the
file's verse references or its book-chapter filename.

Examples:
  node translate.mjs --language en --status
  node translate.mjs --language en --dirs chapter_summaries --limit 10
  node translate.mjs --language en --book 43
  node translate.mjs --language en                # translate everything missing/stale
  node translate.mjs --language en --check        # verify existing translations
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

function parseArgs(args) {
    const options = {
        language: null,
        sourceLang: 'nb',
        dirs: Object.keys(CONTENT_DIRS),
        bookStart: null,
        bookEnd: null,
        chapterStart: null,
        chapterEnd: null,
        remote: false,
        limit: null,
        force: false,
        dryRun: false,
        status: false,
        check: false,
        invalidate: false,
        help: false
    };

    let i = 0;
    while (i < args.length) {
        const arg = args[i];

        if (arg === '--language' && i + 1 < args.length) {
            options.language = args[++i];
        } else if (arg === '--source' && i + 1 < args.length) {
            options.sourceLang = args[++i];
        } else if (arg === '--dirs' && i + 1 < args.length) {
            options.dirs = args[++i].split(',').map(d => d.trim());
        } else if (arg === '--book' && i + 1 < args.length) {
            const range = parseRange(args[++i]);
            options.bookStart = range.start;
            options.bookEnd = range.end;
        } else if (arg === '--chapter' && i + 1 < args.length) {
            const range = parseRange(args[++i]);
            options.chapterStart = range.start;
            options.chapterEnd = range.end;
        } else if (arg === '--remote') {
            options.remote = true;
        } else if (arg === '--limit' && i + 1 < args.length) {
            options.limit = parseInt(args[++i], 10);
        } else if (arg === '--force') {
            options.force = true;
        } else if (arg === '--dry-run') {
            options.dryRun = true;
        } else if (arg === '--status') {
            options.status = true;
        } else if (arg === '--check') {
            options.check = true;
        } else if (arg === '--invalidate') {
            options.invalidate = true;
        } else if (arg === '--help') {
            options.help = true;
        }
        i++;
    }

    return options;
}

async function main() {
    const args = process.argv.slice(2);
    const options = parseArgs(args);

    if (options.help || !options.language) {
        printUsage();
        return;
    }

    options.language = normalizeLanguage(options.language);
    options.langCode = getLanguageCode(options.language);
    useRemote = options.remote;

    if (options.langCode === options.sourceLang) {
        console.error(`Target language equals source language (${options.sourceLang})`);
        process.exit(1);
    }

    const state = loadState(options.langCode);
    const work = collectWork(options, state);

    if (options.status) {
        printStatus(work);
        return;
    }

    if (options.check) {
        runCheck(work, state, options);
        return;
    }

    let pending = work.filter(item => options.force || item.status !== 'current');
    if (options.limit !== null) {
        pending = pending.slice(0, options.limit);
    }

    console.log(`Language: ${options.language} (${options.langCode})`);
    console.log(`Model: ${activeModel()}`);
    console.log(`Dirs: ${options.dirs.join(', ')}`);
    console.log(`Files: ${pending.length} to translate (${work.length} total)`);
    console.log('---');

    if (options.dryRun) {
        for (const item of pending) {
            console.log(`${item.status.padEnd(10)} ${item.key}`);
        }
        return;
    }

    const startTime = Date.now();
    let done = 0;
    let failed = 0;

    for (const item of pending) {
        const label = `[${done + failed + 1}/${pending.length}] ${item.key}`;
        try {
            quoteContext = buildQuoteContext(item, options.langCode, options.language);
            const translator = {'.json': translateJson, '.txt': translateTxt}[item.config.ext] || translateMarkdown;
            const {text, warnings} = await translator(
                options.language, options.langCode, item.sourceText, item.config.keepKeys, item.key
            );

            const outDir = path.dirname(item.outPath);
            if (!fs.existsSync(outDir)) {
                fs.mkdirSync(outDir, {recursive: true});
            }
            fs.writeFileSync(item.outPath, text);

            const previous = state[item.key];
            state[item.key] = {
                srcHash: item.srcHash,
                model: activeModel(),
                translatedAt: new Date().toISOString(),
                warnings,
                history: previous
                    ? [...(previous.history || []), {srcHash: previous.srcHash, model: previous.model, translatedAt: previous.translatedAt}]
                    : []
            };
            saveState(options.langCode, state);

            done++;
            const elapsed = (Date.now() - startTime) / 1000;
            const rate = elapsed / done;
            const etaMin = Math.round((pending.length - done - failed) * rate / 60);
            console.log(`${label} ok (${Math.round(rate)}s/file, ~${etaMin} min left)` +
                (quoteContext ? ` [bible quotes: ${quoteContext.split('\n').length} verses]` : '') +
                (warnings.length > 0 ? ` WARNINGS: ${warnings.join('; ')}` : ''));
        } catch (error) {
            failed++;
            console.error(`${label} FAILED: ${error.message}`);
        }
    }

    console.log('---');
    console.log(`Done: ${done} translated, ${failed} failed`);
    const withWarnings = pending.filter(item => state[item.key] && state[item.key].warnings?.length > 0);
    if (withWarnings.length > 0) {
        console.log(`Files with structure warnings (check manually):`);
        for (const item of withWarnings) {
            console.log(`  ${item.key}: ${state[item.key].warnings.join('; ')}`);
        }
    }
}

// Kjør bare som program. Migreringsskriptet for resume-markørene importerer
// sourceHash og collectStringPaths herfra framfor å duplisere dem.
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
    main().catch(console.error);
}

export {sourceHash, contentHash, collectStringPaths, CONTENT_DIRS};
