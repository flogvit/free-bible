import dotenv from 'dotenv';
import * as fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config();

import {books, getBookName} from './constants.js';
import {callWithRetry} from './llm.js';

const OSNB2_DIR = path.join(__dirname, 'bibles_raw', 'osnb2');
const STORIES_DIR_BASE = path.join(__dirname, 'stories');
const PROPOSED_DIR_BASE = path.join(__dirname, 'stories_proposed');
const REJECTED_DIR_BASE = path.join(__dirname, 'stories_rejected');

const VALID_CATEGORIES = [
    "skapelsen", "patriarkene", "moses", "oerkenvandringen", "landnaam",
    "dommerne", "kongetiden", "profetene", "eksil", "visdomslitteratur",
    "jesus-liv", "jesu-mirakler", "jesu-lignelser", "jesu-lidelse",
    "urkirken", "paulus"
];

// Books with little or no narrative content. Skipped by default.
// 19 Salmene, 20 Ordspråkene, 21 Forkynneren, 22 Høysangen, 25 Klagesangene
// 45-65 NT epistles (Romans through Jude)
const POETIC_BOOK_IDS = new Set([19, 20, 21, 22, 25]);
const EPISTLE_BOOK_IDS = new Set([45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65]);

const STORY_SCHEMA = {
    type: "object",
    properties: {
        slug: {type: "string"},
        title: {type: "string"},
        keywords: {type: "array", items: {type: "string"}},
        description: {type: "string"},
        category: {type: "string"},
        references: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    bookId: {type: "integer"},
                    startChapter: {type: "integer"},
                    startVerse: {type: "integer"},
                    endChapter: {type: "integer"},
                    endVerse: {type: "integer"}
                },
                required: ["bookId", "startChapter", "startVerse", "endChapter", "endVerse"],
                additionalProperties: false
            }
        }
    },
    required: ["slug", "title", "keywords", "description", "category", "references"],
    additionalProperties: false
};

const SCAN_SCHEMA = {
    type: "object",
    properties: {
        stories: {
            type: "array",
            items: STORY_SCHEMA
        }
    },
    required: ["stories"],
    additionalProperties: false
};

const CATEGORY_RESOLVE_SCHEMA = {
    type: "object",
    properties: {
        action: {type: "string", enum: ["use_existing", "create_new"]},
        category: {type: "string"},
        reasoning: {type: "string"}
    },
    required: ["action", "category", "reasoning"],
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
                    field: {type: "string"},
                    type: {type: "string", enum: ["error", "suggestion", "theological", "grammar", "missing", "duplicate", "out-of-scope"]},
                    severity: {type: "string", enum: ["critical", "major", "minor"]},
                    explanation: {type: "string"}
                },
                required: ["field", "type", "severity", "explanation"],
                additionalProperties: false
            }
        },
        revised: {
            type: "object",
            properties: {
                slug: {type: "string"},
                title: {type: "string"},
                keywords: {type: "array", items: {type: "string"}},
                description: {type: "string"},
                category: {type: "string"},
                references: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            bookId: {type: "integer"},
                            startChapter: {type: "integer"},
                            startVerse: {type: "integer"},
                            endChapter: {type: "integer"},
                            endVerse: {type: "integer"}
                        },
                        required: ["bookId", "startChapter", "startVerse", "endChapter", "endVerse"],
                        additionalProperties: false
                    }
                }
            },
            required: ["slug", "title", "keywords", "description", "category", "references"],
            additionalProperties: false
        },
        verdict: {type: "string", enum: ["approve", "revise", "reject", "merge"]},
        rejection_reason: {type: "string"},
        duplicate_of: {type: "string"},
        merge_with: {type: "array", items: {type: "string"}},
        merge_suggestion: {
            type: "object",
            properties: {
                title: {type: "string"},
                description: {type: "string"},
                keywords: {type: "array", items: {type: "string"}},
                category: {type: "string"},
                references: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            bookId: {type: "integer"},
                            startChapter: {type: "integer"},
                            startVerse: {type: "integer"},
                            endChapter: {type: "integer"},
                            endVerse: {type: "integer"}
                        },
                        required: ["bookId", "startChapter", "startVerse", "endChapter", "endVerse"],
                        additionalProperties: false
                    }
                },
                reasoning: {type: "string"}
            },
            required: ["title", "description", "keywords", "category", "references", "reasoning"],
            additionalProperties: false
        },
        score: {type: "integer"},
        summary: {type: "string"}
    },
    required: ["issues", "revised", "verdict", "score", "summary"],
    additionalProperties: false
};

// --- File helpers ---

function fileExists(filepath) {
    return fs.existsSync(filepath) && fs.statSync(filepath).size > 0;
}

function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, {recursive: true});
}

function loadChapter(bookId, chapterId) {
    const file = path.join(OSNB2_DIR, String(bookId), `${chapterId}.json`);
    if (!fileExists(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

function loadExistingStories(lang) {
    const dir = path.join(STORIES_DIR_BASE, lang);
    if (!fs.existsSync(dir)) return [];
    const out = [];
    for (const file of fs.readdirSync(dir)) {
        if (!file.endsWith('.json')) continue;
        try {
            out.push(JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8')));
        } catch (e) {
            console.error(`  warn: could not parse ${file}: ${e.message}`);
        }
    }
    return out;
}

function loadProposedStories(lang) {
    const dir = path.join(PROPOSED_DIR_BASE, lang);
    if (!fs.existsSync(dir)) return [];
    const out = [];
    for (const file of fs.readdirSync(dir)) {
        if (!file.endsWith('.json') || file.startsWith('.')) continue;
        try {
            out.push(JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8')));
        } catch {
            // ignore
        }
    }
    return out;
}

// --- Reference utilities ---

// Encode a verse position as a single comparable integer:
// bookId * 1e7 + chapter * 1e4 + verse  (chapters/verses fit comfortably).
function encodePos(bookId, chapter, verse) {
    return bookId * 10_000_000 + chapter * 10_000 + verse;
}

function refToInterval(ref) {
    return {
        start: encodePos(ref.bookId, ref.startChapter, ref.startVerse),
        end: encodePos(ref.bookId, ref.endChapter, ref.endVerse),
        bookId: ref.bookId
    };
}

function intervalsOverlap(a, b) {
    if (a.bookId !== b.bookId) return 0;
    const lo = Math.max(a.start, b.start);
    const hi = Math.min(a.end, b.end);
    if (hi < lo) return 0;
    return hi - lo + 1;
}

function intervalSize(iv) {
    return iv.end - iv.start + 1;
}

// Check if a proposed story's references heavily overlap an existing/proposed story.
// Returns the slug of the overlapping story, or null.
function findReferenceOverlap(candidate, existingStories, threshold = 0.6) {
    const candIntervals = candidate.references.map(refToInterval);
    if (candIntervals.length === 0) return null;
    const candTotal = candIntervals.reduce((s, iv) => s + intervalSize(iv), 0);

    for (const existing of existingStories) {
        if (!existing.references || existing.references.length === 0) continue;
        const exIntervals = existing.references.map(refToInterval);
        let overlap = 0;
        for (const a of candIntervals) {
            for (const b of exIntervals) {
                overlap += intervalsOverlap(a, b);
            }
        }
        if (overlap === 0) continue;
        const exTotal = exIntervals.reduce((s, iv) => s + intervalSize(iv), 0);
        const candCoverage = overlap / candTotal;
        const exCoverage = overlap / exTotal;
        if (candCoverage >= threshold || exCoverage >= threshold) {
            return existing.slug || existing.title;
        }
    }
    return null;
}

// Find existing stories that touch a given chapter (used for context to LLM).
function storiesTouchingChapter(stories, bookId, chapterId) {
    const chapterStart = encodePos(bookId, chapterId, 1);
    const chapterEnd = encodePos(bookId, chapterId, 9999);
    const chapterIv = {start: chapterStart, end: chapterEnd, bookId};
    return stories.filter(s => {
        if (!s.references) return false;
        return s.references.some(r => intervalsOverlap(refToInterval(r), chapterIv) > 0);
    });
}

// --- Slug helpers ---

function slugify(input) {
    return String(input)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/æ/g, 'ae').replace(/ø/g, 'o').replace(/å/g, 'aa')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
}

// --- Prompt ---

function buildChapterText(chapterVerses, bookName, chapterId) {
    const lines = chapterVerses.map(v => `${chapterId}:${v.verseId} ${v.text}`);
    return `${bookName} kapittel ${chapterId}\n` + lines.join('\n');
}

function buildPrompt(bookName, bookId, chapterId, chapterText, existingStoriesForChapter, lastChapterInBook) {
    const categoriesList = VALID_CATEGORIES.join(', ');

    const existingBlock = existingStoriesForChapter.length > 0
        ? existingStoriesForChapter.map(s => {
            const refs = s.references.map(r =>
                `${getBookName(r.bookId, 'Norwegian bokmål')} ${r.startChapter}:${r.startVerse}-${r.endChapter}:${r.endVerse}`
            ).join('; ');
            return `- "${s.title}" (slug: ${s.slug}) — ${refs}`;
        }).join('\n')
        : '(ingen)';

    return `Du er en bibelekspert som skanner Bibelen kapittel for kapittel for å finne avgrensede fortellinger som mangler i en database.

KAPITTELET DU SKAL SKANNE:
${chapterText}

EKSISTERENDE FORTELLINGER SOM ALLEREDE DEKKER DETTE KAPITTELET:
${existingBlock}

BOKKONTEKST:
- Bok: ${bookName} (bookId=${bookId})
- Kapittel som vurderes: ${chapterId}
- Siste kapittel i boka: ${lastChapterInBook}

OPPGAVE:
Identifiser fortellinger som STARTER i dette kapittelet og som IKKE allerede er dekket av listen over.
- En fortelling skal ha tydelig start- og sluttvers (kan strekke seg over flere kapitler).
- Hvis en fortelling spenner over flere kapitler, sett endChapter > startChapter ut fra din bibelkunnskap, men aldri høyere enn ${lastChapterInBook}.
- Hopp over fortellinger hvis hovedinnhold allerede er i listen.
- Hvis kapittelet er rent poetisk/didaktisk uten avgrensede fortellinger, returner en tom stories-array.
- Foreslå normalt 0-3 fortellinger per kapittel. Bare ta med fortellinger som er virkelig viktige eller tydelig avgrensede.

For hver foreslått fortelling, generer:
- slug: URL-vennlig identifikator med bindestreker, på norsk (uten æ/ø/å)
- title: Tittel på norsk bokmål
- keywords: 5-10 relevante søkeord (lowercase, norsk)
- description: 1-2 setningers oppsummering på norsk bokmål
- category: En av: ${categoriesList}
- references: Array med bibelreferanser. bookId må være ${bookId} for fortellinger fra denne boka.

REFERANSEFORMAT i description:
[ref:FORKORTELSE KAPITTEL:VERS|VISNINGSTEKST]
Eksempel: [ref:1 Mos 12:1-9|1. Mosebok 12:1-9]
Bruk KVN-forkortelser og fullt boknavn i visningsteksten.

VIKTIG:
- bookId SKAL være ${bookId}.
- startChapter SKAL være ${chapterId}.
- ALDRI nevn spesifikke bibelutgaver, bibelselskap eller forlag.`;
}

// --- Category resolution ---

async function resolveCategory(story, invalidCategory, cache, useLocal) {
    if (cache.has(invalidCategory)) {
        return cache.get(invalidCategory);
    }

    const prompt = `Du gjennomgår en kategori for en bibelsk fortelling som ikke matcher våre eksisterende kategorier.

Fortelling:
- Tittel: ${story.title}
- Beskrivelse: ${story.description || '(ingen)'}
- Foreslått kategori: ${invalidCategory}

Eksisterende kategorier:
${VALID_CATEGORIES.map(c => `- ${c}`).join('\n')}

Avgjør:
1. Hvis den foreslåtte kategorien bare er en variant/synonym av en eksisterende kategori (f.eks. "jesu-liv" → "jesus-liv", "kongene" → "kongetiden"), returner action: "use_existing" og det eksisterende kategorinavnet.
2. Hvis den representerer et reelt nytt tematisk område som mangler i listen (f.eks. "endetiden" for apokalyptiske tekster, "peter" som parallell til "paulus"), returner action: "create_new" og et normalisert navn (lowercase, bindestreker, uten æ/ø/å) — kan være den opprinnelige eller en bedre versjon.

Velg "use_existing" hvis det er noen som helst rimelig match. Bare velg "create_new" hvis fortellingen klart ikke passer noen av kategoriene.`;

    let result;
    try {
        result = await callWithRetry(prompt, {
            schema: CATEGORY_RESOLVE_SCHEMA,
            local: useLocal,
            context: `category resolve "${invalidCategory}"`
        });
    } catch (e) {
        result = null;
    }

    // Defensive: if create_new but name matches existing, treat as use_existing
    if (result && result.action === 'create_new' && VALID_CATEGORIES.includes(result.category)) {
        result.action = 'use_existing';
    }
    // Defensive: if use_existing but name not in list, mark as failure
    if (result && result.action === 'use_existing' && !VALID_CATEGORIES.includes(result.category)) {
        result = null;
    }

    cache.set(invalidCategory, result);
    return result;
}

function logNewCategory(lang, info) {
    const dir = path.join(PROPOSED_DIR_BASE, lang);
    ensureDir(dir);
    const file = path.join(dir, '.new_categories.json');
    let log = [];
    if (fileExists(file)) {
        try { log = JSON.parse(fs.readFileSync(file, 'utf-8')); } catch {}
    }
    log.push(info);
    fs.writeFileSync(file, JSON.stringify(log, null, 2));
}

// --- Proofread proposed stories against actual chapter text ---

// Load the actual verse text covered by a story's references.
function loadReferencedText(refs) {
    const sections = [];
    for (const ref of refs) {
        const book = books.find(b => b.id === ref.bookId);
        if (!book) continue;
        const bookName = getBookName(ref.bookId, 'Norwegian bokmål');
        for (let ch = ref.startChapter; ch <= ref.endChapter; ch++) {
            const verses = loadChapter(ref.bookId, ch);
            if (!verses) continue;
            const fromV = (ch === ref.startChapter) ? ref.startVerse : 1;
            const toV = (ch === ref.endChapter) ? ref.endVerse : 9999;
            const slice = verses.filter(v => v.verseId >= fromV && v.verseId <= toV);
            if (slice.length === 0) continue;
            const lines = slice.map(v => `${ch}:${v.verseId} ${v.text}`).join('\n');
            sections.push(`${bookName} ${ch}:${fromV}-${ch === ref.endChapter ? ref.endVerse : 'slutt'}\n${lines}`);
        }
    }
    return sections.join('\n\n');
}

function buildProofreadPrompt(proposal, referencedText, neighboringStories) {
    const proposalJson = JSON.stringify({
        slug: proposal.slug,
        title: proposal.title,
        keywords: proposal.keywords,
        description: proposal.description,
        category: proposal.category,
        references: proposal.references
    }, null, 2);

    const neighborsBlock = neighboringStories.length > 0
        ? neighboringStories.map(s => {
            const refs = s.references.map(r =>
                `${getBookName(r.bookId, 'Norwegian bokmål')} ${r.startChapter}:${r.startVerse}-${r.endChapter}:${r.endVerse}`
            ).join('; ');
            return `- "${s.title}" (slug: ${s.slug}) — ${refs}\n  Beskrivelse: ${s.description}`;
        }).join('\n')
        : '(ingen)';

    let versionContext = '';
    if (proposal.versions && proposal.versions.length > 0) {
        const entries = proposal.versions.map((v, i) =>
            `  Versjon ${i + 1}: title="${v.title}", score=${v.score}, issues="${(v.reason || '').substring(0, 200)}"`
        ).join('\n');
        versionContext = `\n\nTIDLIGERE REVISJONER (ikke foreslå tekst som ligner på disse):\n${entries}\n`;
    }

    return `Du er en korrekturleser som vurderer et forslag om en bibelsk fortelling som er hentet ut automatisk fra et kapittelsøk. Du skal sammenligne forslaget med den faktiske bibelteksten det refererer til, og avgjøre om det skal godkjennes, revideres eller forkastes.

FORSLAGET:
${proposalJson}

FAKTISK BIBELTEKST FOR DE REFERERTE VERSENE:
${referencedText || '(ingen tekst funnet for referansene — kan tyde på ugyldig referanse)'}

EKSISTERENDE FORTELLINGER SOM RØRER SAMME TEKST (for duplikat-sjekk):
${neighborsBlock}

VURDER:
1. **Referanser**: Stemmer vers-spennet med innholdet? Dekker det fortellingen som er beskrevet, uten å være for vidt eller for snevert?
2. **Tittel**: Er den presis og beskrivende?
3. **Beskrivelse**: Er den faktisk korrekt mot bibelteksten? Ikke oppdiktet?
4. **Avgrenset fortelling**: Er dette en tydelig avgrenset narrativ (med begynnelse/utvikling/slutt), eller bare et tema/setning/lignelse uten narrativ struktur?
5. **Duplikat**: Overlapper det vesentlig med en eksisterende fortelling? Hvis ja, sett duplicate_of til slug-en.
6. **Kategori**: Passer kategorien? Må være en av: ${VALID_CATEGORIES.join(', ')}.
7. **Slug**: Lowercase, bindestreker, uten æ/ø/å.

VERDICT:
- **approve**: God kvalitet (score ≥ 8), avgrenset narrativ, korrekt mot teksten, ingen kritiske problemer. revised kan være identisk med originalen.
- **revise**: Inneholder fiksbare problemer (referanse-justering, tittel/beskrivelse-forbedring, kategori-fiks). Returner forbedret versjon i revised.
- **reject**: Ikke en reell avgrenset fortelling, eller alvorlig feil i referansene. Forklar i rejection_reason. Bruk IKKE reject for duplikater — bruk merge eller sett duplicate_of.
- **merge**: Denne historien dekker samme narrativ som én eller flere eksisterende fortellinger, men ikke 100% likt. De bør slås sammen til én. Sett merge_with til en liste av slugs (fra nabo-listen) den bør slås sammen med. Fyll ut merge_suggestion med din anbefalte kombinerte versjon (tittel, beskrivelse, keywords, kategori, referanser samlet fra alle som skal slås sammen) og en kort reasoning.

VIKTIG:
- revised MÅ alltid være utfylt (med dine forbedringer, eller identisk med original hvis approve/merge).
- score er heltall 0-10.
- ALDRI nevn spesifikke bibelutgaver, bibelselskap eller forlag.
- Hvis ${proposal.versions?.length || 0} tidligere revisjoner er gjort, vær strengere.${versionContext}`;
}

function storiesOverlappingProposal(stories, proposal) {
    const propIntervals = proposal.references.map(refToInterval);
    return stories.filter(s => {
        if (!s.references) return false;
        const sIntervals = s.references.map(refToInterval);
        return propIntervals.some(p => sIntervals.some(si => intervalsOverlap(p, si) > 0));
    });
}

async function proofreadProposal(proposalFile, existingStories, useLocal) {
    const proposal = JSON.parse(fs.readFileSync(proposalFile, 'utf-8'));
    const referencedText = loadReferencedText(proposal.references || []);
    const neighborsRaw = storiesOverlappingProposal(existingStories, proposal);
    const neighbors = neighborsRaw.filter(s => s.slug !== proposal.slug);
    const prompt = buildProofreadPrompt(proposal, referencedText, neighbors);

    let result;
    try {
        result = await callWithRetry(prompt, {
            schema: PROOFREAD_SCHEMA,
            local: useLocal,
            context: `proofread ${proposal.slug}`
        });
    } catch (e) {
        console.error(`    ERROR proofreading ${proposal.slug}: ${e.message}`);
        return null;
    }

    process.stdout.write(`    Score: ${result.score}/10 | Verdict: ${result.verdict}`);
    if (result.issues && result.issues.length > 0) {
        process.stdout.write(` | Issues: ${result.issues.length}`);
    }
    if (result.duplicate_of) {
        process.stdout.write(` | duplicate-of: ${result.duplicate_of}`);
    }
    process.stdout.write('\n');
    for (const issue of result.issues || []) {
        console.log(`      [${issue.severity}] ${issue.field}: ${issue.explanation}`);
    }
    return result;
}

function applyProofread(proposalFile, proofreadResult) {
    const data = JSON.parse(fs.readFileSync(proposalFile, 'utf-8'));
    const revised = proofreadResult.revised;
    if (!revised) return false;

    const fields = ['slug', 'title', 'description', 'category'];
    let changed = false;
    for (const f of fields) {
        if (data[f] !== revised[f]) { changed = true; break; }
    }
    if (!changed) {
        changed = JSON.stringify(data.keywords || []) !== JSON.stringify(revised.keywords || []);
    }
    if (!changed) {
        changed = JSON.stringify(data.references || []) !== JSON.stringify(revised.references || []);
    }

    if (!changed) return false;

    if (!data.versions) data.versions = [];
    data.versions.push({
        title: data.title,
        description: data.description,
        category: data.category,
        score: proofreadResult.score,
        verdict: proofreadResult.verdict,
        reason: (proofreadResult.issues || []).map(i => `[${i.severity}] ${i.field}: ${i.explanation}`).join('; '),
        date: new Date().toISOString().split('T')[0]
    });

    data.slug = revised.slug;
    data.title = revised.title;
    data.keywords = revised.keywords;
    data.description = revised.description;
    data.category = revised.category;
    data.references = revised.references;

    fs.writeFileSync(proposalFile, JSON.stringify(data, null, 2));
    return true;
}

function finalizeApprove(proposalFile, lang, proofreadResult) {
    const data = JSON.parse(fs.readFileSync(proposalFile, 'utf-8'));
    // Strip proofread-only fields when promoting
    const promoted = {
        slug: data.slug,
        title: data.title,
        keywords: data.keywords,
        description: data.description,
        category: data.category,
        references: data.references
    };
    if (data.footnotes) promoted.footnotes = data.footnotes;
    const outDir = path.join(STORIES_DIR_BASE, lang);
    ensureDir(outDir);
    const outFile = path.join(outDir, `${data.slug}.json`);
    if (fileExists(outFile)) {
        console.log(`    WARN: ${data.slug}.json already exists in stories/${lang}/ — keeping proposal, manual merge needed`);
        return false;
    }
    fs.writeFileSync(outFile, JSON.stringify(promoted, null, 2));
    fs.unlinkSync(proposalFile);
    console.log(`    APPROVED -> stories/${lang}/${data.slug}.json`);
    return true;
}

function logMergeCandidate(lang, entry) {
    const dir = path.join(PROPOSED_DIR_BASE, lang);
    ensureDir(dir);
    const file = path.join(dir, '.merge_candidates.json');
    let log = [];
    if (fileExists(file)) {
        try { log = JSON.parse(fs.readFileSync(file, 'utf-8')); } catch {}
    }
    log.push(entry);
    fs.writeFileSync(file, JSON.stringify(log, null, 2));
}

function logFlaggedExisting(lang, entry) {
    const dir = path.join(STORIES_DIR_BASE, lang);
    ensureDir(dir);
    const file = path.join(dir, '.flagged_existing.json');
    let log = [];
    if (fileExists(file)) {
        try { log = JSON.parse(fs.readFileSync(file, 'utf-8')); } catch {}
    }
    log.push(entry);
    fs.writeFileSync(file, JSON.stringify(log, null, 2));
}

function pushVersionEntry(file, result) {
    const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (!data.versions) data.versions = [];
    data.versions.push({
        title: data.title,
        description: data.description,
        category: data.category,
        score: result.score,
        verdict: result.verdict,
        reason: (result.issues || []).map(i => `[${i.severity}] ${i.field}: ${i.explanation}`).join('; '),
        date: new Date().toISOString().split('T')[0]
    });
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function finalizeReject(proposalFile, lang, proofreadResult) {
    const data = JSON.parse(fs.readFileSync(proposalFile, 'utf-8'));
    data.rejection = {
        reason: proofreadResult.rejection_reason || (proofreadResult.issues || []).map(i => `[${i.severity}] ${i.explanation}`).join('; '),
        duplicate_of: proofreadResult.duplicate_of || null,
        score: proofreadResult.score,
        date: new Date().toISOString().split('T')[0]
    };
    const outDir = path.join(REJECTED_DIR_BASE, lang);
    ensureDir(outDir);
    const outFile = path.join(outDir, path.basename(proposalFile));
    fs.writeFileSync(outFile, JSON.stringify(data, null, 2));
    fs.unlinkSync(proposalFile);
    console.log(`    REJECTED -> stories_rejected/${lang}/${path.basename(proposalFile)}`);
    return true;
}

// --- Scan ---

async function scanChapter({bookId, chapterId, lang, existingStories, proposedStories, categoryCache, useLocal, dryRun}) {
    const bookName = getBookName(bookId, 'Norwegian bokmål');
    const verses = loadChapter(bookId, chapterId);
    if (!verses || verses.length === 0) {
        console.log(`  ${bookName} ${chapterId}: skip (no osnb2 text)`);
        return {proposed: 0, skipped: 0};
    }

    const book = books.find(b => b.id === bookId);
    const lastChapter = book ? book.chapters : chapterId;

    const chapterText = buildChapterText(verses, bookName, chapterId);
    const touching = storiesTouchingChapter([...existingStories, ...proposedStories], bookId, chapterId);

    const prompt = buildPrompt(bookName, bookId, chapterId, chapterText, touching, lastChapter);

    const result = await callWithRetry(prompt, {
        schema: SCAN_SCHEMA,
        local: useLocal,
        context: `scan ${bookId}/${chapterId}`
    });

    if (!result || !Array.isArray(result.stories)) {
        console.log(`  ${bookName} ${chapterId}: no result`);
        return {proposed: 0, skipped: 0};
    }

    const outDir = path.join(PROPOSED_DIR_BASE, lang);
    ensureDir(outDir);

    const existingSlugs = new Set(existingStories.map(s => s.slug).filter(Boolean));
    const existingTitles = new Set(existingStories.map(s => s.title?.toLowerCase()).filter(Boolean));
    const proposedSlugs = new Set(proposedStories.map(s => s.slug).filter(Boolean));
    const proposedTitles = new Set(proposedStories.map(s => s.title?.toLowerCase()).filter(Boolean));

    let proposed = 0;
    let skipped = 0;

    for (const story of result.stories) {
        if (!story.slug || !story.title) {
            skipped++;
            continue;
        }
        let slug = slugify(story.slug || story.title);
        if (!slug) {
            skipped++;
            continue;
        }
        story.slug = slug;

        // Validate references
        if (!Array.isArray(story.references) || story.references.length === 0) {
            console.log(`    skip "${story.title}" (no references)`);
            skipped++;
            continue;
        }
        let refsOk = true;
        for (const ref of story.references) {
            const refBook = books.find(b => b.id === ref.bookId);
            if (!refBook) { refsOk = false; break; }
            if (ref.startChapter < 1 || ref.startChapter > refBook.chapters) { refsOk = false; break; }
            if (ref.endChapter < 1 || ref.endChapter > refBook.chapters) { refsOk = false; break; }
            if (ref.endChapter < ref.startChapter) { refsOk = false; break; }
            if (ref.startChapter === ref.endChapter && ref.endVerse < ref.startVerse) { refsOk = false; break; }
        }
        if (!refsOk) {
            console.log(`    skip "${story.title}" (invalid references)`);
            skipped++;
            continue;
        }

        // Category — accept directly, or ask LLM to remap / propose new
        if (!VALID_CATEGORIES.includes(story.category)) {
            const original = story.category;
            const resolved = await resolveCategory(story, original, categoryCache, useLocal);
            if (!resolved) {
                console.log(`    skip "${story.title}" (invalid category: ${original}, no resolution)`);
                skipped++;
                continue;
            }
            if (resolved.action === 'use_existing') {
                console.log(`    remap category "${original}" -> "${resolved.category}" for "${story.title}"`);
                story.category = resolved.category;
            } else {
                console.log(`    new category candidate "${resolved.category}" (from "${original}") for "${story.title}"`);
                story.category = resolved.category;
                if (!dryRun) {
                    logNewCategory(lang, {
                        category: resolved.category,
                        originalCategory: original,
                        title: story.title,
                        slug,
                        reasoning: resolved.reasoning,
                        bookId,
                        chapterId,
                        at: new Date().toISOString()
                    });
                }
            }
        }

        // Slug/title duplicates
        if (existingSlugs.has(slug) || proposedSlugs.has(slug)) {
            console.log(`    skip "${story.title}" (slug "${slug}" already exists)`);
            skipped++;
            continue;
        }
        if (existingTitles.has(story.title.toLowerCase()) || proposedTitles.has(story.title.toLowerCase())) {
            console.log(`    skip "${story.title}" (title already exists)`);
            skipped++;
            continue;
        }

        // Reference overlap
        const overlapWith = findReferenceOverlap(story, existingStories) || findReferenceOverlap(story, proposedStories);
        if (overlapWith) {
            console.log(`    skip "${story.title}" (refs overlap with "${overlapWith}")`);
            skipped++;
            continue;
        }

        // Save
        const outFile = path.join(outDir, `${slug}.json`);
        if (fileExists(outFile)) {
            console.log(`    skip "${story.title}" (proposed file exists)`);
            skipped++;
            continue;
        }

        if (dryRun) {
            console.log(`    [dry-run] would propose "${story.title}" (${slug})`);
        } else {
            fs.writeFileSync(outFile, JSON.stringify(story, null, 2));
            console.log(`    proposed: ${slug} — ${story.title}`);
        }
        proposed++;

        // Update tracking sets so later proposals in same run don't duplicate
        proposedSlugs.add(slug);
        proposedTitles.add(story.title.toLowerCase());
        proposedStories.push(story);
    }

    return {proposed, skipped};
}

// --- Skip-list ---

function shouldSkipBook(bookId, opts) {
    if (POETIC_BOOK_IDS.has(bookId) && !opts.includePoetic) return 'poetic';
    if (EPISTLE_BOOK_IDS.has(bookId) && !opts.includeEpistles) return 'epistle';
    return null;
}

// --- CLI ---

function parseArgs(args) {
    const opts = {
        bookStart: null,
        bookEnd: null,
        chapterStart: null,
        chapterEnd: null,
        lang: 'nb',
        includePoetic: false,
        includeEpistles: false,
        useLocal: true,
        limit: null,
        resume: false,
        dryRun: false,
        help: false,
        proofread: false,
        apply: false,
        minScore: 8,
        rejectScore: 4,
        maxIter: 3,
        continue_: false,
        source: 'proposed'
    };
    let i = 0;
    while (i < args.length) {
        const a = args[i];
        if (a === '--book' && i + 1 < args.length) {
            const r = parseRange(args[++i]);
            opts.bookStart = r.start;
            opts.bookEnd = r.end;
        }
        else if (a === '--chapter' && i + 1 < args.length) {
            const r = parseRange(args[++i]);
            opts.chapterStart = r.start;
            opts.chapterEnd = r.end;
        }
        else if (a === '--ot') { opts.bookStart = 1; opts.bookEnd = 39; }
        else if (a === '--nt') { opts.bookStart = 40; opts.bookEnd = 66; }
        else if (a === '--lang' && i + 1 < args.length) opts.lang = args[++i];
        else if (a === '--include-poetic') opts.includePoetic = true;
        else if (a === '--include-epistles') opts.includeEpistles = true;
        else if (a === '--remote') opts.useLocal = false;
        else if (a === '--local') opts.useLocal = true;
        else if (a === '--limit' && i + 1 < args.length) opts.limit = parseInt(args[++i], 10);
        else if (a === '--resume') opts.resume = true;
        else if (a === '--dry-run') opts.dryRun = true;
        else if (a === '--proofread') opts.proofread = true;
        else if (a === '--apply') opts.apply = true;
        else if (a === '--min-score' && i + 1 < args.length) opts.minScore = parseInt(args[++i], 10);
        else if (a === '--reject-score' && i + 1 < args.length) opts.rejectScore = parseInt(args[++i], 10);
        else if (a === '--max-iter' && i + 1 < args.length) opts.maxIter = parseInt(args[++i], 10);
        else if (a === '--continue') opts.continue_ = true;
        else if (a === '--source' && i + 1 < args.length) opts.source = args[++i];
        else if (a === '--help' || a === '-h') opts.help = true;
        i++;
    }
    return opts;
}

function parseRange(value) {
    if (value.includes('-')) {
        const [start, end] = value.split('-').map(n => parseInt(n, 10));
        return {start, end};
    }
    const num = parseInt(value, 10);
    return {start: num, end: num};
}

function printUsage() {
    console.log(`
Usage: node scan_stories.mjs [options]

Scan mode (default): systematically scan the Bible chapter by chapter and propose
new stories not yet covered by stories/<lang>/*.json. Proposals land in
stories_proposed/<lang>/.

Proofread mode (--proofread): proofread proposals in stories_proposed/<lang>/ against
the actual chapter text. Approved -> stories/<lang>/. Rejected -> stories_rejected/<lang>/.
Borderline cases stay in stories_proposed/<lang>/ with versions[] history.

Scan options:
  --book <range>       Scan book(s): single (40) or range (40-66).
  --chapter <range>    Scan chapter(s): single (3) or range (3-10). Requires --book.
  --ot                 Books 1-39 (Old Testament).
  --nt                 Books 40-66 (New Testament).
  --include-poetic     Also scan Salmer/Ordspråk/Forkynneren/Høysangen/Klagesangene.
  --include-epistles   Also scan NT epistles (Romerne–Judas).
  --limit <n>          Stop after processing this many chapters.
  --resume             Skip chapters already in .scan_state.json.
  --dry-run            Run the LLM but do not write proposal files.

Proofread options:
  --proofread          Switch to proofread mode.
  --source <kind>      proposed (default) | existing | both. existing = stories/<lang>/,
                       proposed = stories_proposed/<lang>/. Existing files are never
                       auto-moved; reject becomes flag (logged to .flagged_existing.json).
  --apply              Apply revisions and finalize. Without --apply, proofread runs
                       read-only and only logs verdicts.
  --min-score <n>      Score >= n on approve verdict -> finalize (default: 8).
  --reject-score <n>   Score <= n on reject verdict -> finalize (default: 4).
  --max-iter <n>       Max proofread iterations per file (default: 3).
  --continue           Skip files whose last version score >= min-score with approve verdict.
                       Merge candidates: flagged to .merge_candidates.json — never auto-merged.

Common options:
  --lang <code>        Language code (default: nb).
  --remote             Use Anthropic Claude (default: local Ollama).
  --help               Show this help.

Examples:
  node scan_stories.mjs                             # Scan all narrative books
  node scan_stories.mjs --book 1 --chapter 12       # Scan Genesis 12
  node scan_stories.mjs --proofread --apply                       # Proofread proposals, apply
  node scan_stories.mjs --proofread --source existing --apply     # Proofread existing stories
  node scan_stories.mjs --proofread --source both --apply         # Both proposed and existing
  node scan_stories.mjs --proofread --apply --continue            # Resume
  node scan_stories.mjs --proofread --book 41                     # Mark only, dry-run
`);
}

function loadState(lang) {
    const file = path.join(PROPOSED_DIR_BASE, lang, '.scan_state.json');
    if (!fileExists(file)) return {processed: {}};
    try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return {processed: {}}; }
}

function saveState(lang, state) {
    const dir = path.join(PROPOSED_DIR_BASE, lang);
    ensureDir(dir);
    fs.writeFileSync(path.join(dir, '.scan_state.json'), JSON.stringify(state, null, 2));
}

function collectProofreadFiles(opts, lang, sourceDir) {
    if (!fs.existsSync(sourceDir)) return [];
    let files = fs.readdirSync(sourceDir).filter(f => f.endsWith('.json') && !f.startsWith('.')).sort();
    if (opts.bookStart !== null) {
        const bs = opts.bookStart, be = opts.bookEnd ?? bs;
        files = files.filter(f => {
            try {
                const d = JSON.parse(fs.readFileSync(path.join(sourceDir, f), 'utf-8'));
                return (d.references || []).some(r => r.bookId >= bs && r.bookId <= be);
            } catch { return false; }
        });
    }
    return files;
}

async function proofreadOneFile({file, sourceDir, sourceKind, lang, existingStories, opts, counters}) {
    const filePath = path.join(sourceDir, file);
    if (!fileExists(filePath)) return;

    if (opts.continue_) {
        try {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            const last = data.versions?.[data.versions.length - 1];
            if (last?.score >= opts.minScore && last?.verdict === 'approve') {
                counters.skipped++;
                return;
            }
        } catch {}
    }

    const startData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    counters.processed++;
    console.log(`\n[${counters.processed}] [${sourceKind}] ${startData.slug} — ${startData.title}`);

    let iter = 0;
    while (iter < opts.maxIter) {
        iter++;
        if (iter > 1) console.log(`  Iteration ${iter}/${opts.maxIter}`);
        const result = await proofreadProposal(filePath, existingStories, opts.useLocal);
        if (!result) { counters.errored++; break; }

        // MERGE path — never auto-merge, only log
        if (result.verdict === 'merge') {
            const targets = (result.merge_with || []).filter(s => s && s !== startData.slug);
            if (targets.length === 0) {
                console.log(`    merge verdict with no merge_with targets — treating as borderline`);
                if (opts.apply) pushVersionEntry(filePath, result);
                counters.borderline++;
                break;
            }
            console.log(`    MERGE candidate with: ${targets.join(', ')}`);
            if (opts.apply) {
                logMergeCandidate(lang, {
                    source: sourceKind,
                    slugs: [startData.slug, ...targets],
                    merge_with: targets,
                    suggestion: result.merge_suggestion || null,
                    reasoning: (result.issues || []).map(i => `[${i.severity}] ${i.field}: ${i.explanation}`).join('; '),
                    score: result.score,
                    date: new Date().toISOString().split('T')[0]
                });
                pushVersionEntry(filePath, result);
            } else {
                console.log(`    would FLAG MERGE`);
            }
            counters.merges++;
            break;
        }

        // APPROVE path
        if (result.verdict === 'approve' && result.score >= opts.minScore) {
            if (opts.apply) {
                applyProofread(filePath, result);
                if (sourceKind === 'proposed') {
                    if (finalizeApprove(filePath, lang, result)) counters.approved++;
                } else {
                    // For existing files, just keep in place; pushVersionEntry already happened via applyProofread if changed
                    if (!fs.existsSync(filePath)) {
                        counters.approved++;
                    } else {
                        // make sure a version entry exists so --continue can skip next time
                        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
                        const last = data.versions?.[data.versions.length - 1];
                        if (!last || last.score !== result.score) {
                            pushVersionEntry(filePath, result);
                        }
                        counters.approved++;
                        console.log(`    APPROVED (existing — kept in place)`);
                    }
                }
            } else {
                console.log(`    would APPROVE`);
                counters.approved++;
            }
            break;
        }

        // REJECT path — differs by source
        if (result.verdict === 'reject' && result.score <= opts.rejectScore) {
            if (sourceKind === 'proposed') {
                if (opts.apply) {
                    if (finalizeReject(filePath, lang, result)) counters.rejected++;
                } else {
                    console.log(`    would REJECT (${result.rejection_reason || 'low score'})`);
                    counters.rejected++;
                }
            } else {
                // existing: never auto-move out of stories/; flag instead
                console.log(`    FLAGGED (existing — kept in place; reason: ${result.rejection_reason || 'reject verdict'})`);
                if (opts.apply) {
                    logFlaggedExisting(lang, {
                        slug: startData.slug,
                        title: startData.title,
                        reason: result.rejection_reason || (result.issues || []).map(i => `[${i.severity}] ${i.explanation}`).join('; '),
                        duplicate_of: result.duplicate_of || null,
                        score: result.score,
                        date: new Date().toISOString().split('T')[0]
                    });
                    pushVersionEntry(filePath, result);
                }
                counters.flagged++;
            }
            break;
        }

        // REVISE path — apply if --apply, then re-proofread
        if (opts.apply) {
            const changed = applyProofread(filePath, result);
            if (!changed && result.verdict !== 'approve') {
                console.log(`    no changes applied — leaving for manual review`);
                counters.borderline++;
                break;
            }
        } else {
            console.log(`    would REVISE`);
            counters.borderline++;
            break;
        }

        if (iter >= opts.maxIter) {
            console.log(`    max iterations reached — leaving in place`);
            counters.borderline++;
        }
    }
}

async function runProofread(opts) {
    const lang = opts.lang;
    const existingStories = loadExistingStories(lang);

    const source = opts.source;
    if (!['proposed', 'existing', 'both'].includes(source)) {
        console.error(`Unknown --source ${source}. Use proposed|existing|both.`);
        process.exit(1);
    }

    const proposedDir = path.join(PROPOSED_DIR_BASE, lang);
    const existingDir = path.join(STORIES_DIR_BASE, lang);

    const proposedFiles = (source === 'proposed' || source === 'both')
        ? collectProofreadFiles(opts, lang, proposedDir) : [];
    const existingFiles = (source === 'existing' || source === 'both')
        ? collectProofreadFiles(opts, lang, existingDir) : [];

    console.log(`Loaded ${existingStories.length} existing stories (${lang})`);
    console.log(`LLM: ${opts.useLocal ? 'local (Ollama)' : 'remote (Anthropic)'}`);
    console.log(`Source: ${source} | proposed=${proposedFiles.length}, existing=${existingFiles.length}`);
    console.log(`Settings: min-score=${opts.minScore}, reject-score=${opts.rejectScore}, max-iter=${opts.maxIter}`);
    if (!opts.apply) console.log('(dry-run — no files moved or modified; use --apply to finalize)');
    console.log('---');

    const counters = {approved: 0, rejected: 0, flagged: 0, merges: 0, borderline: 0, skipped: 0, errored: 0, processed: 0};

    const queue = [
        ...proposedFiles.map(f => ({file: f, sourceDir: proposedDir, sourceKind: 'proposed'})),
        ...existingFiles.map(f => ({file: f, sourceDir: existingDir, sourceKind: 'existing'}))
    ];

    for (const item of queue) {
        if (opts.limit !== null && counters.processed >= opts.limit) break;
        await proofreadOneFile({...item, lang, existingStories, opts, counters});
    }

    console.log(`\nDone. Approved: ${counters.approved}, Rejected: ${counters.rejected}, Flagged (existing): ${counters.flagged}, Merge candidates: ${counters.merges}, Borderline: ${counters.borderline}, Skipped: ${counters.skipped}, Errored: ${counters.errored}`);
    if (counters.merges > 0) {
        console.log(`Review merge candidates in stories_proposed/${lang}/.merge_candidates.json`);
    }
    if (counters.flagged > 0) {
        console.log(`Review flagged existing in stories/${lang}/.flagged_existing.json`);
    }
}

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.help) { printUsage(); return; }
    if (opts.proofread) {
        await runProofread(opts);
        return;
    }
    if (opts.chapterStart !== null && opts.bookStart === null) {
        console.error('--chapter requires --book');
        process.exit(1);
    }

    const lang = opts.lang;
    const existingStories = loadExistingStories(lang);
    const proposedStories = loadProposedStories(lang);
    console.log(`Loaded ${existingStories.length} existing stories, ${proposedStories.length} previous proposals (${lang})`);
    console.log(`LLM: ${opts.useLocal ? 'local (Ollama)' : 'remote (Anthropic)'}`);

    const state = loadState(lang);

    // Build chapter list
    const targets = [];
    const bookExplicit = opts.bookStart !== null;
    const bs = opts.bookStart ?? 1;
    const be = opts.bookEnd ?? (bookExplicit ? bs : 66);
    const bookList = books.filter(b => b.id >= bs && b.id <= be);
    if (bookExplicit && bookList.length === 0) {
        console.error(`No books in range ${bs}-${be}`);
        process.exit(1);
    }
    for (const book of bookList) {
        const skipReason = shouldSkipBook(book.id, opts);
        if (skipReason && !bookExplicit) {
            // Silent skip for default full-bible run
            continue;
        }
        if (skipReason && bookExplicit && bs === be) {
            console.log(`Note: book ${book.id} (${book.name}) is normally skipped (${skipReason}); proceeding because --book was specified.`);
        }
        const cs = opts.chapterStart ?? 1;
        const ce = opts.chapterEnd ?? (opts.chapterStart !== null ? cs : book.chapters);
        const chapters = [];
        for (let c = cs; c <= Math.min(ce, book.chapters); c++) chapters.push(c);
        for (const ch of chapters) {
            targets.push({bookId: book.id, chapterId: ch});
        }
    }

    let totalProposed = 0;
    let totalSkipped = 0;
    let processed = 0;
    const categoryCache = new Map();

    for (const t of targets) {
        const key = `${t.bookId}:${t.chapterId}`;
        if (opts.resume && state.processed[key]) continue;
        if (opts.limit !== null && processed >= opts.limit) break;

        const bookName = getBookName(t.bookId, 'Norwegian bokmål');
        console.log(`\n[${processed + 1}] ${bookName} ${t.chapterId} ...`);

        try {
            const {proposed, skipped} = await scanChapter({
                bookId: t.bookId,
                chapterId: t.chapterId,
                lang,
                existingStories,
                proposedStories,
                categoryCache,
                useLocal: opts.useLocal,
                dryRun: opts.dryRun
            });
            totalProposed += proposed;
            totalSkipped += skipped;
            console.log(`  -> proposed: ${proposed}, skipped: ${skipped}`);
        } catch (e) {
            console.error(`  ERROR ${bookName} ${t.chapterId}: ${e.message}`);
        }

        state.processed[key] = {at: new Date().toISOString()};
        if (!opts.dryRun) saveState(lang, state);
        processed++;
    }

    console.log(`\nDone. Chapters processed: ${processed}. Proposed: ${totalProposed}. Skipped: ${totalSkipped}.`);
    console.log(`Review proposals in: ${path.relative(__dirname, path.join(PROPOSED_DIR_BASE, lang))}/`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
