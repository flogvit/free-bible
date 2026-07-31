import "../../generate/env.js";
/**
 * Translate missing verses in osmain (books 1-66).
 *
 * For each [NEEDS_TRANSLATION] verse:
 * 1. Scan ALL raw bibles to find every translation that has this verse
 * 2. Send all translations to Claude to generate an original Norwegian translation
 * 3. Update osmain with the new text
 *
 * Flaggene går gjennom den felles kontrakten i generate/cli.ts; `--help` viser dem.
 */

import { readFileSync, readdirSync, existsSync, statSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { parseArgs, formatHelp, COMMON_FLAGS } from '../../generate/cli.js';
import type { FlagSpec } from '../../generate/cli.js';

const OSMAIN_DIR = join(import.meta.dirname, '../../generate/bibles_raw/osmain');
const RAW_DIR = join(import.meta.dirname, '../../external/closed/raw');
const RESULTS_DIR = join(import.meta.dirname, '../data/translate-results');

const ANTHROPIC_MODEL = 'claude-opus-4-6';
const MAX_TOKENS = 1024;

let anthropic: Anthropic | null = null;
function getAnthropic(): Anthropic {
  if (!anthropic) {
    anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return anthropic;
}

interface VerseData {
  bookId: number;
  chapterId: number;
  verseId: number;
  text: string;
  [key: string]: any;
}

// `--chapter` er ikke et kapittelintervall her, men nøkkelen «bok:kapittel»
// slik kapitlene grupperes internt. Derfor `string` og ikke COMMON_FLAGS.chapter.
const SPEC: Record<string, FlagSpec> = {
  translate: {kind: 'boolean', help: 'skriv oversettelsene; uten flagget kjøres bare skanningen'},
  chapter: {kind: 'string', help: 'bare dette kapitlet, som «bok:kapittel», f.eks. 39:4'},
  help: COMMON_FLAGS.help,
};

const HELP_EXAMPLES = [
  'bun kvn/scripts/translate-missing.ts',
  'bun kvn/scripts/translate-missing.ts --translate',
  'bun kvn/scripts/translate-missing.ts --translate --chapter 39:4',
];

// Deuterocanonical chapters to skip (will be added as "catholic" variant later)
const SKIP_CHAPTERS = new Set([
  '17:11', '17:12', '17:13', '17:14', '17:15', '17:16', // Ester additions
  '19:151',  // Salme 151
  '23:67',   // Jesaja 67
  '27:13',   // Daniel - Susanna
  '27:14',   // Daniel - Bel og dragen
]);

interface MissingVerse {
  book: number;
  chapter: number;
  verse: number;
}

// Katalogene under external/closed/raw leses først når de trengs, ikke ved
// import — ellers ville `--help` gått en tur på disk.
let rawBiblesCache: string[] | null = null;
function rawBibles(): string[] {
  rawBiblesCache ??= readdirSync(RAW_DIR).filter(d =>
    statSync(join(RAW_DIR, d)).isDirectory()
  );
  return rawBiblesCache;
}

function collectTranslations(book: number, chapter: number, verseIds: number[]): Map<number, Array<{ bible: string; text: string }>> {
  const result = new Map<number, Array<{ bible: string; text: string }>>();
  for (const v of verseIds) result.set(v, []);

  const verseSet = new Set(verseIds);

  for (const bible of rawBibles()) {
    const file = join(RAW_DIR, bible, String(book), `${chapter}.json`);
    if (!existsSync(file)) continue;

    try {
      const data: VerseData[] = JSON.parse(readFileSync(file, 'utf-8'));
      for (const v of data) {
        if (verseSet.has(v.verseId) && v.text?.trim()) {
          result.get(v.verseId)!.push({ bible, text: v.text.trim() });
        }
      }
    } catch { /* skip */ }
  }

  return result;
}

async function translateVerse(
  book: number, chapter: number, verse: number,
  translations: Array<{ bible: string; text: string }>,
  context: { prevVerse?: string; nextVerse?: string }
): Promise<string> {
  const translationList = translations
    .slice(0, 30)
    .map(t => `[${t.bible}] ${t.text}`)
    .join('\n');

  const contextStr = [
    context.prevVerse ? `Forrige vers: ${context.prevVerse}` : '',
    context.nextVerse ? `Neste vers: ${context.nextVerse}` : '',
  ].filter(Boolean).join('\n');

  const prompt = `Du skal oversette et bibelvers til norsk bokmål.
Under finner du oversettelser av samme vers fra ulike bibeloversettelser på forskjellige språk.
Lag en original norsk bokmål-oversettelse som fanger meningen trofast.
IKKE kopier noen enkelt oversettelse — lag din egen formulering basert på den samlede meningen.
Bruk moderne norsk bokmål. Match stilen til de omkringliggende versene hvis de er gitt.

Bok ${book}, Kapittel ${chapter}, Vers ${verse}

${contextStr ? `Kontekst:\n${contextStr}\n` : ''}
Tilgjengelige oversettelser:
${translationList}

Svar med KUN den norske oversettelsesteksten, ingenting annet.`;

  const client = getAnthropic();
  const completion = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: MAX_TOKENS,
    messages: [{ role: 'user', content: prompt }],
  });

  if (completion.stop_reason === 'max_tokens') {
    throw new Error('Response truncated');
  }

  const text = completion.content[0];
  if (text.type !== 'text') throw new Error('Unexpected response type');
  return text.text.trim();
}

async function main(): Promise<void> {
  // Hjelpen skal ut før noe leses fra eller skrives til disk.
  const { flags } = parseArgs(process.argv.slice(2), SPEC);
  if (flags.help) {
    console.log(formatHelp(
      'kvn/scripts/translate-missing.ts',
      'oversetter osmain-vers merket [NEEDS_TRANSLATION] ut fra alle andre oversettelser',
      SPEC,
      HELP_EXAMPLES,
    ));
    process.exit(0);
  }

  const doTranslate = flags.translate as boolean;
  const chapterFilter = (flags.chapter as string | undefined) ?? null;

  // === Find all missing verses in osmain (books 1-66) ===

  const missing: MissingVerse[] = [];

  const bookDirs = readdirSync(OSMAIN_DIR)
    .filter(d => /^\d+$/.test(d) && parseInt(d) <= 66 && statSync(join(OSMAIN_DIR, d)).isDirectory())
    .sort((a, b) => parseInt(a) - parseInt(b));

  for (const bookStr of bookDirs) {
    const bookDir = join(OSMAIN_DIR, bookStr);
    const files = readdirSync(bookDir).filter(f => f.endsWith('.json'));

    for (const f of files) {
      const chapter = parseInt(f.replace('.json', ''));
      const key = `${bookStr}:${chapter}`;
      if (chapterFilter && key !== chapterFilter) continue;
      if (SKIP_CHAPTERS.has(key)) continue;

      const verses: VerseData[] = JSON.parse(readFileSync(join(bookDir, f), 'utf-8'));
      for (const v of verses) {
        if (v.text === '[NEEDS_TRANSLATION]') {
          missing.push({ book: parseInt(bookStr), chapter, verse: v.verseId });
        }
      }
    }
  }

  console.log(`Found ${missing.length} verses needing translation in books 1-66\n`);

  if (missing.length === 0) {
    console.log('Nothing to translate!');
    return;
  }

  // Group by chapter for efficient processing
  const byChapter = new Map<string, MissingVerse[]>();
  for (const m of missing) {
    const key = `${m.book}:${m.chapter}`;
    if (!byChapter.has(key)) byChapter.set(key, []);
    byChapter.get(key)!.push(m);
  }

  console.log(`Spread across ${byChapter.size} chapters\n`);

  // === Scan report ===

  for (const [key, verses] of [...byChapter.entries()].sort()) {
    const [bookStr, chStr] = key.split(':');
    const book = parseInt(bookStr);
    const chapter = parseInt(chStr);
    const verseIds = verses.map(v => v.verse);

    const translations = collectTranslations(book, chapter, verseIds);

    console.log(`${key}: ${verseIds.length} verses to translate`);
    for (const [verseId, trans] of translations) {
      // Count languages
      const languages = new Set<string>();
      for (const t of trans) {
        if (t.bible.includes('norwegian') || t.bible.includes('nb') || t.bible.includes('nn')) languages.add('no');
        else if (t.bible.includes('english')) languages.add('en');
        else if (t.bible.includes('german')) languages.add('de');
        else if (t.bible.includes('french')) languages.add('fr');
        else if (t.bible.includes('spanish')) languages.add('es');
        else if (t.bible.includes('latin')) languages.add('la');
        else if (t.bible.includes('hebrew')) languages.add('he');
        else if (t.bible.includes('greek')) languages.add('el');
        else languages.add('other');
      }
      console.log(`  v${verseId}: ${trans.length} translations (${[...languages].join(',')})`);
    }
  }

  if (!doTranslate) {
    console.log('\nRun with --translate to generate translations');
    return;
  }

  // === Do translations ===

  mkdirSync(RESULTS_DIR, { recursive: true });

  let translated = 0;
  let failed = 0;

  for (const [key, verses] of [...byChapter.entries()].sort()) {
    const [bookStr, chStr] = key.split(':');
    const book = parseInt(bookStr);
    const chapter = parseInt(chStr);
    const verseIds = verses.map(v => v.verse).sort((a, b) => a - b);

    console.log(`\nTranslating ${key} (${verseIds.length} verses)...`);

    const translations = collectTranslations(book, chapter, verseIds);

    // Load osmain chapter for context and updating
    const osmainFile = join(OSMAIN_DIR, String(book), `${chapter}.json`);
    const osmainVerses: VerseData[] = JSON.parse(readFileSync(osmainFile, 'utf-8'));

    for (const verseId of verseIds) {
      const trans = translations.get(verseId) ?? [];

      if (trans.length === 0) {
        console.log(`  v${verseId}: NO TRANSLATIONS FOUND — skipping`);
        failed++;
        continue;
      }

      // Get context (previous and next verses in osmain)
      const prevV = osmainVerses.find(v => v.verseId === verseId - 1);
      const nextV = osmainVerses.find(v => v.verseId === verseId + 1);
      const context = {
        prevVerse: prevV && prevV.text !== '[NEEDS_TRANSLATION]' ? prevV.text : undefined,
        nextVerse: nextV && nextV.text !== '[NEEDS_TRANSLATION]' ? nextV.text : undefined,
      };

      try {
        const result = await translateVerse(book, chapter, verseId, trans, context);
        console.log(`  v${verseId}: "${result.slice(0, 80)}${result.length > 80 ? '...' : ''}"`);

        // Update osmain
        const target = osmainVerses.find(v => v.verseId === verseId);
        if (target) {
          target.text = result;
          (target as any).source = 'translated';  // not in tanach/sblgnt
          delete (target as any)._samples;
          translated++;
        }

        // Save result for audit
        const resultFile = join(RESULTS_DIR, `${book}-${chapter}-${verseId}.json`);
        writeFileSync(resultFile, JSON.stringify({
          book, chapter, verse: verseId,
          result,
          sourceCount: trans.length,
          sources: trans.slice(0, 10).map(t => ({ bible: t.bible, text: t.text.slice(0, 200) })),
          timestamp: new Date().toISOString(),
        }, null, 2));

      } catch (err: any) {
        console.error(`  v${verseId}: ERROR — ${err.message}`);
        failed++;
      }
    }

    // Save updated osmain chapter
    writeFileSync(osmainFile, JSON.stringify(osmainVerses, null, 2));
  }

  console.log(`\n=== TRANSLATION COMPLETE ===`);
  console.log(`Translated: ${translated}`);
  console.log(`Failed: ${failed}`);
  console.log(`Results saved to: ${RESULTS_DIR}`);
}

// Kjører bare når fila startes direkte, slik at import ikke har bivirkninger (#108).
if (import.meta.main) {
    await main();
}
