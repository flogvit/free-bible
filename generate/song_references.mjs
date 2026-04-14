#!/usr/bin/env node

/**
 * Map songs to Bible verse references using LLM.
 *
 * Two-step process per song:
 *   1. Ask LLM to suggest Bible references from the song text
 *   2. Look up actual verses from osmain, send back for verification
 *
 * Results are saved in ./generate/songs/{song-id}.json (no lyrics stored).
 * Resumable: skips songs that already have a result file.
 *
 * Usage:
 *   node song_references.mjs                    # Process all songs
 *   node song_references.mjs --lang nb           # Only Norwegian bokmål
 *   node song_references.mjs --lang en           # Only English
 *   node song_references.mjs --id song-0217      # Process one specific song
 *   node song_references.mjs --limit 50          # Process max 50 songs
 *   node song_references.mjs --model gemma4:31b  # Use specific model
 *   node song_references.mjs --force             # Re-process even if result exists
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ollamaBaseUrl, getOllamaConfig, bookNames, books } from './constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SONGS_DIR = path.join(__dirname, '..', 'external', 'songs', 'master');
const OUTPUT_DIR = path.join(__dirname, 'songs');
const OSMAIN_DIR = path.join(__dirname, 'bibles_raw', 'osmain');

// Default model — override with --model
let ollamaModel = 'gemma4:31b';

// ── Helpers ──────────────────────────────────────────────────────────────────

function getSongText(song) {
    return song.verses.map(v => v.text).join('\n\n');
}

/** Look up a verse from osmain. Returns null if not found. */
function lookupVerse(bookId, chapter, verse) {
    const chapterFile = path.join(OSMAIN_DIR, String(bookId), `${chapter}.json`);
    if (!fs.existsSync(chapterFile)) return null;
    const data = JSON.parse(fs.readFileSync(chapterFile, 'utf-8'));
    const v = data.find(d => d.verseId === verse);
    return v ? v.text : null;
}

/** Look up a range of verses. */
function lookupVerses(bookId, chapter, verseStart, verseEnd) {
    const chapterFile = path.join(OSMAIN_DIR, String(bookId), `${chapter}.json`);
    if (!fs.existsSync(chapterFile)) return [];
    const data = JSON.parse(fs.readFileSync(chapterFile, 'utf-8'));
    return data
        .filter(d => d.verseId >= verseStart && d.verseId <= verseEnd)
        .map(d => ({ verse: d.verseId, text: d.text }));
}

/** Map book name (various formats) to bookId. */
function parseBookName(name) {
    const n = name.trim();

    // Direct bookId number
    if (/^\d+$/.test(n)) return parseInt(n, 10);

    // Try Norwegian names
    const nbNames = bookNames.nb;
    for (const [id, bname] of Object.entries(nbNames)) {
        if (bname.toLowerCase() === n.toLowerCase()) return parseInt(id, 10);
    }

    // Try English names
    for (const b of books) {
        if (b.name.toLowerCase() === n.toLowerCase()) return b.id;
    }

    // Common abbreviations
    const abbrevMap = {
        'matt': 40, 'mat': 40, 'mk': 41, 'mark': 41, 'luk': 42, 'lk': 42,
        'joh': 43, 'jn': 43, 'apg': 44, 'rom': 45, '1 kor': 46, '2 kor': 47,
        'gal': 48, 'ef': 49, 'fil': 50, 'kol': 51, '1 tess': 52, '2 tess': 53,
        '1 tim': 54, '2 tim': 55, 'tit': 56, 'filem': 57, 'hebr': 58, 'heb': 58,
        'jak': 59, '1 pet': 60, '2 pet': 61, '1 joh': 62, '2 joh': 63, '3 joh': 64,
        'jud': 65, 'åp': 66, 'rev': 66, 'sal': 19, 'ords': 20, 'fork': 21,
        'jes': 23, 'jer': 24, 'klag': 25, 'esek': 26, 'dan': 27, 'hos': 28,
        'am': 30, 'ob': 31, 'mi': 33, 'nah': 34, 'hab': 35, 'sef': 36,
        'hag': 37, 'sak': 38, 'mal': 39,
        '1 mos': 1, '2 mos': 2, '3 mos': 3, '4 mos': 4, '5 mos': 5,
        'jos': 6, 'dom': 7, 'rut': 8, '1 sam': 9, '2 sam': 10,
        '1 kong': 11, '2 kong': 12, '1 krøn': 13, '2 krøn': 14,
        'esra': 15, 'neh': 16, 'est': 17, 'job': 18, 'høys': 22,
        'gen': 1, 'ex': 2, 'lev': 3, 'num': 4, 'deut': 5,
        'josh': 6, 'judg': 7, 'ruth': 8, '1 sam': 9, '2 sam': 10,
        '1 kgs': 11, '2 kgs': 12, 'ezra': 15, 'neh': 16, 'esth': 17,
        'ps': 19, 'prov': 20, 'eccl': 21, 'song': 22, 'isa': 23,
        'lam': 25, 'ezek': 26, 'joel': 29, 'amos': 30, 'obad': 31,
        'jonah': 32, 'mic': 33, 'zeph': 36, 'zech': 38,
        'acts': 44, 'jas': 59, '1 pet': 60, '2 pet': 61, 'jude': 65,
        'psalm': 19, 'psalms': 19, 'salmene': 19, 'proverbs': 20,
        'isaiah': 23, 'jeremiah': 24, 'revelation': 66,
        'matthew': 40, 'john': 43, 'luke': 42, 'romans': 45,
        'hebrews': 58, 'james': 59, 'genesis': 1, 'exodus': 2,
    };
    const lower = n.toLowerCase().replace(/\./g, '');
    if (abbrevMap[lower]) return abbrevMap[lower];

    // Fuzzy: try prefix match
    for (const [abbr, id] of Object.entries(abbrevMap)) {
        if (lower.startsWith(abbr)) return id;
    }

    return null;
}

/** Parse a reference string like "Matt 6:28-30" into structured form. */
function parseReference(ref) {
    // Pattern: "Book Chapter:VerseStart-VerseEnd" or "Book Chapter:Verse"
    const m = ref.match(/^(.+?)\s+(\d+):(\d+)(?:\s*-\s*(\d+))?$/);
    if (!m) return null;

    const bookId = parseBookName(m[1]);
    if (!bookId) return null;

    return {
        bookId,
        chapter: parseInt(m[2], 10),
        verseStart: parseInt(m[3], 10),
        verseEnd: m[4] ? parseInt(m[4], 10) : parseInt(m[3], 10),
    };
}

// ── LLM calls ────────────────────────────────────────────────────────────────

async function callOllama(prompt, retries = 2) {
    const config = getOllamaConfig(ollamaModel);
    const body = {
        model: ollamaModel,
        prompt: config.noThinkPrefix + prompt,
        stream: false,
        options: { ...config.options, num_predict: 8192 },
    };
    if (config.jsonFormat) body.format = 'json';
    if (config.thinkParam) body.think = false;

    for (let attempt = 0; attempt <= retries; attempt++) {
        const response = await fetch(`${ollamaBaseUrl}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(300000), // 5 min timeout
        });
        const data = await response.json();
        const text = (data.response || '').trim();

        // Try to extract JSON from response (may be wrapped in ```json blocks)
        try {
            return JSON.parse(text);
        } catch {}

        const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (m) {
            try { return JSON.parse(m[1].trim()); } catch {}
        }
        const m2 = text.match(/[\[{][\s\S]*[\]}]/);
        if (m2) {
            try { return JSON.parse(m2[0]); } catch {}
        }

        if (attempt < retries) continue;
        throw new Error(`Could not parse JSON from LLM response: ${text.substring(0, 200)}`);
    }
}

/** Normalize step 1 result: ensure { references: [...], themes: [...] } */
function normalizeStep1(result) {
    // If result is an array, it's probably the references directly
    if (Array.isArray(result)) {
        return { references: result, themes: [] };
    }
    // Find references under alternative keys
    if (!Array.isArray(result.references)) {
        for (const [key, val] of Object.entries(result)) {
            if (Array.isArray(val) && val.length > 0 && val[0]?.verse) {
                result.references = val;
                break;
            }
        }
    }
    if (!Array.isArray(result.references)) result.references = [];
    if (!Array.isArray(result.themes)) {
        // Look for themes under alternative keys
        for (const [key, val] of Object.entries(result)) {
            if (key !== 'references' && Array.isArray(val) && val.length > 0 && typeof val[0] === 'string') {
                result.themes = val;
                break;
            }
        }
    }
    if (!Array.isArray(result.themes)) result.themes = [];
    return result;
}

/** Normalize step 2 result: ensure { references: [...], themes: [...] } */
function normalizeStep2(result) {
    // If result is an array, it's the references directly
    if (Array.isArray(result)) {
        return { references: result, themes: [] };
    }
    // Find references under alternative keys
    if (!Array.isArray(result.references)) {
        for (const [key, val] of Object.entries(result)) {
            if (Array.isArray(val) && val.length > 0 && val[0]?.bookId != null) {
                result.references = val;
                break;
            }
        }
    }
    if (!Array.isArray(result.references)) result.references = [];
    if (!Array.isArray(result.themes)) {
        for (const [key, val] of Object.entries(result)) {
            if (key !== 'references' && Array.isArray(val) && val.length > 0 && typeof val[0] === 'string') {
                result.themes = val;
                break;
            }
        }
    }
    if (!Array.isArray(result.themes)) result.themes = [];
    return result;
}

// ── Step 1: Get initial references ───────────────────────────────────────────

const step1Schema = {
    type: 'object',
    properties: {
        references: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    line: { type: 'string' },
                    verse: { type: 'string' },
                    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
                    reason: { type: 'string' },
                },
                required: ['verse', 'confidence', 'reason'],
            },
        },
        themes: { type: 'array', items: { type: 'string' } },
    },
    required: ['references', 'themes'],
};

async function step1_identifyReferences(song) {
    const text = getSongText(song);
    const lang = song.language === 'en' ? 'English' : 'Norwegian';

    const prompt = `Du er en bibelkyndig. Analyser denne ${lang} salmen/sangen og identifiser bibelversreferanser.

For hver referanse, oppgi:
- "line": den relevante linjen/linjene fra sangen
- "verse": bibelreferansen i formatet "Bok Kapittel:Vers" eller "Bok Kapittel:VersStart-VersSlutt"
- "confidence": "high" (direkte sitat/allusjon), "medium" (tematisk), eller "low" (mulig)
- "reason": kort forklaring på norsk av sammenhengen

Bruk standard boknavn (f.eks. "Matt 6:28", "Sal 23:1", "Jes 40:6", "Åp 21:4").

Ekstraher også de viktigste bibelske temaene i sangen (på norsk).

Sangtittel: "${song.title}"
${song.author ? `Forfatter: ${song.author}` : ''}

Tekst:
${text}

Svar med JSON i dette eksakte formatet:
{"references":[{"line":"eksempel linje","verse":"Sal 23:1","confidence":"high","reason":"forklaring"}],"themes":["tema1","tema2"]}`;

    const raw = await callOllama(prompt);
    return normalizeStep1(raw);
}

// ── Step 2: Verify with actual verses ────────────────────────────────────────

const step2Schema = {
    type: 'object',
    properties: {
        references: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    bookId: { type: 'number' },
                    chapter: { type: 'number' },
                    verseStart: { type: 'number' },
                    verseEnd: { type: 'number' },
                    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
                    reason: { type: 'string' },
                },
                required: ['bookId', 'chapter', 'verseStart', 'verseEnd', 'confidence', 'reason'],
            },
        },
        themes: { type: 'array', items: { type: 'string' } },
    },
    required: ['references', 'themes'],
};

async function step2_verifyReferences(song, step1Result) {
    const text = getSongText(song);

    // Look up actual verse texts for each reference
    const verseLookups = [];
    for (const ref of step1Result.references) {
        if (!ref.verse) continue;
        const parsed = parseReference(ref.verse);
        if (!parsed) {
            verseLookups.push({
                ref: ref.verse,
                error: 'Could not parse reference',
                confidence: ref.confidence,
                reason: ref.reason,
                line: ref.line,
            });
            continue;
        }

        const verses = lookupVerses(parsed.bookId, parsed.chapter, parsed.verseStart, parsed.verseEnd);
        const bookName = bookNames.nb[parsed.bookId] || `Book ${parsed.bookId}`;

        verseLookups.push({
            ref: ref.verse,
            bookId: parsed.bookId,
            chapter: parsed.chapter,
            verseStart: parsed.verseStart,
            verseEnd: parsed.verseEnd,
            bookName,
            verseTexts: verses,
            found: verses.length > 0,
            confidence: ref.confidence,
            reason: ref.reason,
            line: ref.line,
        });
    }

    // Build verification prompt with actual verse texts
    const verseContext = verseLookups
        .filter(v => v.found)
        .map(v => {
            const texts = v.verseTexts.map(vt => `  ${v.bookName} ${v.chapter}:${vt.verse}: ${vt.text}`).join('\n');
            return `${v.ref} (foreslått fordi: ${v.reason}):\n${texts}`;
        })
        .join('\n\n');

    const notFound = verseLookups.filter(v => !v.found && !v.error);

    const lang = song.language === 'en' ? 'English' : 'Norwegian';
    const prompt = `Du er en bibelkyndig som verifiserer sang-til-bibel-koblinger.

Under er en ${lang} sang og foreslåtte bibelversreferanser med de FAKTISKE verstekstene fra Bibelen.

Din oppgave:
1. Fjern referanser som ikke faktisk matcher sangen når du ser den virkelige teksten
2. Juster confidence basert på hvor godt den faktiske teksten matcher
3. Fiks eventuelle versområder (f.eks. hvis bare vers 28 matcher, ikke 28-30)
4. Legg til åpenbare referanser som ble oversett
5. Behold temaene, juster om nødvendig (på norsk)

Bruk bookId-nummer (1=1. Mosebok...66=Åpenbaringen). Skriv reason på norsk.

Sang: "${song.title}"
${song.author ? `Forfatter: ${song.author}` : ''}

Tekst:
${text}

Foreslåtte referanser med faktisk bibeltekst:
${verseContext}

${notFound.length > 0 ? `\nReferanser som ikke ble funnet i Bibelen (sannsynligvis feil): ${notFound.map(v => v.ref).join(', ')}` : ''}

Tidligere temaer: ${(step1Result.themes || []).join(', ')}

Svar med JSON i dette eksakte formatet:
{"references":[{"bookId":19,"chapter":23,"verseStart":1,"verseEnd":1,"confidence":"high","reason":"forklaring"}],"themes":["tema1","tema2"]}`;

    const raw = await callOllama(prompt);
    return normalizeStep2(raw);
}

// ── Main ─────────────────────────────────────────────────────────────────────

function parseArgs() {
    const args = process.argv.slice(2);
    const options = { lang: null, id: null, limit: null, force: false };

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--lang' && i + 1 < args.length) {
            options.lang = args[++i];
        } else if (args[i] === '--id' && i + 1 < args.length) {
            options.id = args[++i];
        } else if (args[i] === '--limit' && i + 1 < args.length) {
            options.limit = parseInt(args[++i], 10);
        } else if (args[i] === '--model' && i + 1 < args.length) {
            ollamaModel = args[++i];
        } else if (args[i] === '--force') {
            options.force = true;
        } else if (args[i] === '--help') {
            console.log(`Usage: node song_references.mjs [options]
  --lang <nb|en|da-no-historic>  Filter by language
  --id <song-XXXX>               Process one song
  --limit <n>                    Max songs to process
  --model <name>                 Ollama model (default: gemma4:31b)
  --force                        Re-process existing results
  --help                         Show this help`);
            process.exit(0);
        }
    }
    return options;
}

async function main() {
    const options = parseArgs();

    // Load song index
    const files = fs.readdirSync(SONGS_DIR).filter(f => f.endsWith('.json')).sort();
    console.log(`Model: ${ollamaModel}`);
    console.log(`Songs available: ${files.length}`);

    // Filter songs
    let songs = [];
    for (const f of files) {
        const song = JSON.parse(fs.readFileSync(path.join(SONGS_DIR, f), 'utf-8'));

        if (options.id && song.id !== options.id) continue;
        if (options.lang && song.language !== options.lang) continue;

        // Skip songs with no/minimal text
        const text = getSongText(song);
        if (text.length < 20) continue;

        // Skip if already processed (unless --force)
        const outFile = path.join(OUTPUT_DIR, `${song.id}.json`);
        if (!options.force && fs.existsSync(outFile)) continue;

        songs.push(song);
    }

    if (options.limit) songs = songs.slice(0, options.limit);

    console.log(`Songs to process: ${songs.length}`);
    if (songs.length === 0) {
        console.log('Nothing to do.');
        return;
    }
    console.log('---');

    let processed = 0;
    let errors = 0;

    for (const song of songs) {
        const outFile = path.join(OUTPUT_DIR, `${song.id}.json`);
        try {
            // Step 1: identify references
            process.stdout.write(`${song.id}: "${song.title}" ... `);
            const step1 = await step1_identifyReferences(song);
            const refCount = step1.references?.length || 0;
            if (process.env.DEBUG) {
                console.log('\nStep 1 refs:', JSON.stringify(step1.references, null, 2));
            }
            process.stdout.write(`${refCount} refs -> `);

            // Step 2: verify with actual verse texts
            let result;
            if (refCount > 0) {
                result = await step2_verifyReferences(song, step1);
                process.stdout.write(`${result.references?.length || 0} verified\n`);
            } else {
                result = { references: [], themes: step1.themes || [] };
                process.stdout.write(`no refs\n`);
            }

            // Save result (no lyrics!)
            const output = {
                id: song.id,
                title: song.title,
                language: song.language,
                references: result.references || [],
                themes: result.themes || [],
                model: ollamaModel,
                processedAt: new Date().toISOString().split('T')[0],
            };
            if (song.author) output.author = song.author;

            fs.writeFileSync(outFile, JSON.stringify(output, null, 2), 'utf-8');
            processed++;
        } catch (err) {
            console.error(`\n  ERROR: ${err.message}`);
            errors++;
        }
    }

    console.log('---');
    console.log(`Done. Processed: ${processed}, Errors: ${errors}`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
