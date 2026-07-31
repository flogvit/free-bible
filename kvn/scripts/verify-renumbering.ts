/**
 * Verify osmain renumbering using Ollama.
 *
 * For chapters that were renumbered (boundary shifts, header merges),
 * send osmain verses + the original osnb verses to Ollama and ask
 * it to verify the mapping is correct.
 *
 * Flaggene går gjennom den felles kontrakten i generate/cli.ts; `--help` viser
 * dem. Jobben ligger i `main()` fordi loggfila ble lest på toppnivå — da var
 * `--help` allerede en fillesing før noe var tolket.
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { parseArgs, formatHelp, COMMON_FLAGS } from '../../generate/cli.js';
import type { FlagSpec } from '../../generate/cli.js';

const OSNB_DIR = join(import.meta.dirname, '../../generate/bibles_raw/osnb');
const OSMAIN_DIR = join(import.meta.dirname, '../../generate/bibles_raw/osmain');
const LOG_FILE = join(import.meta.dirname, '../data/osnb3-renumber-log.json');
const RESULTS_DIR = join(import.meta.dirname, '../data/verify-renumber');
const OLLAMA_URL = 'http://localhost:11434/api/generate';
const OLLAMA_MODEL = 'qwen3.5:122b';

interface VerseData {
  bookId: number;
  chapterId: number;
  verseId: number;
  text: string;
  source?: string;
  [key: string]: any;
}

/**
 * `--chapter` er IKKE `COMMON_FLAGS.chapter` her.
 *
 * Filteret sammenliknes mot loggnøkkelen `bok:kapittel` («19:3»). Som `range`
 * ville `parseInt` gjort «19:3» til kapittel 19, og filteret hadde stille
 * sluttet å treffe oppføringen det pekte på.
 */
const SPEC: Record<string, FlagSpec> = {
  verify: {kind: 'boolean', help: 'kjør Ollama-verifiseringen; uten den listes bare det som gjenstår'},
  chapter: {kind: 'string', help: 'bare denne nøkkelen, på formen bok:kapittel, f.eks. 19:3'},
  help: COMMON_FLAGS.help,
};

const HELP_EXAMPLES = [
  'bun kvn/scripts/verify-renumbering.ts',
  'bun kvn/scripts/verify-renumbering.ts --verify',
  'bun kvn/scripts/verify-renumbering.ts --verify --chapter 19:3',
];

function loadChapter(dir: string, book: number, chapter: number): VerseData[] {
  const file = join(dir, String(book), `${chapter}.json`);
  if (!existsSync(file)) return [];
  try { return JSON.parse(readFileSync(file, 'utf-8')); } catch { return []; }
}

// === Ollama verification ===

const responseSchema = {
  type: 'object' as const,
  properties: {
    chapter: { type: 'string' as const },
    correct: { type: 'boolean' as const },
    mappings: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          osmainVerse: { type: 'number' as const },
          osnbVerse: { type: 'number' as const },
          osnbChapter: { type: 'number' as const },
          match: { type: 'string' as const, enum: ['exact', 'partial', 'merged', 'wrong'] },
        },
        required: ['osmainVerse', 'osnbVerse', 'osnbChapter', 'match'],
      },
    },
    issues: {
      type: 'array' as const,
      items: { type: 'string' as const },
    },
  },
  required: ['chapter', 'correct', 'mappings', 'issues'],
};

async function askOllama(prompt: string): Promise<any> {
  const resp = await fetch(OLLAMA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      prompt,
      stream: false,
      think: false,
      format: responseSchema,
      options: { temperature: 0, num_predict: 4096 },
    }),
  });

  if (!resp.ok) throw new Error(`Ollama error: ${resp.status}`);
  const data = await resp.json() as { response: string };
  return JSON.parse(data.response);
}

async function main(): Promise<void> {
  // Hjelpen skal ut før loggfila leses.
  const { flags } = parseArgs(process.argv.slice(2), SPEC);
  if (flags.help) {
    console.log(formatHelp(
      'kvn/scripts/verify-renumbering.ts',
      'lar Ollama kontrollere at de omnummererte osmain-kapitlene stemmer med osnb',
      SPEC,
      HELP_EXAMPLES,
    ));
    process.exit(0);
  }

  const doVerify = flags.verify as boolean;
  // Filteret var `null` når flagget manglet, ikke `undefined`.
  const chapterFilter = (flags.chapter as string | undefined) ?? null;

  const log: Array<{ key: string; type: string; details: string }> =
    JSON.parse(readFileSync(LOG_FILE, 'utf-8'));

  // Only verify renumbered chapters in books 1-66
  const toVerify = log.filter(e => {
    const book = parseInt(e.key.split(':')[0]);
    return book <= 66 &&
      (e.type === 'renumber_boundary' || e.type === 'renumber_prepend' || e.type === 'renumber_mixed');
  });

  if (chapterFilter) {
    const filtered = toVerify.filter(e => e.key === chapterFilter);
    toVerify.length = 0;
    toVerify.push(...filtered);
  }

  console.log(`Chapters to verify: ${toVerify.length}\n`);

  if (!doVerify) {
    for (const entry of toVerify) {
      console.log(`  ${entry.key} [${entry.type}]: ${entry.details.slice(0, 80)}`);
    }
    console.log('\nRun with --verify to process through Ollama');
    process.exit(0);
  }

  mkdirSync(RESULTS_DIR, { recursive: true });

  let correct = 0;
  let issues = 0;
  let errors = 0;

  for (const entry of toVerify) {
    const [bookStr, chStr] = entry.key.split(':');
    const book = parseInt(bookStr);
    const chapter = parseInt(chStr);

    // Load osmain chapter and neighbors
    const osmainCh = loadChapter(OSMAIN_DIR, book, chapter);
    const osmainPrev = loadChapter(OSMAIN_DIR, book, chapter - 1);
    const osmainNext = loadChapter(OSMAIN_DIR, book, chapter + 1);

    // Load osnb chapter and neighbors
    const osnbCh = loadChapter(OSNB_DIR, book, chapter);
    const osnbPrev = loadChapter(OSNB_DIR, book, chapter - 1);
    const osnbNext = loadChapter(OSNB_DIR, book, chapter + 1);

    if (osmainCh.length === 0 || osnbCh.length === 0) {
      console.log(`  ${entry.key}: SKIP (missing data)`);
      continue;
    }

    // Build verse text lists
    const formatVerses = (verses: VerseData[], label: string) =>
      verses.map(v => `  ${label} ${v.verseId}: ${v.text.slice(0, 150)}`).join('\n');

    const osmainText = formatVerses(osmainCh, `v`);
    const osnbText = formatVerses(osnbCh, `v`);

    // Include neighbors for context
    let contextText = '';
    if (osnbPrev.length > 0) {
      const lastFew = osnbPrev.slice(-3);
      contextText += `\nosnb chapter ${chapter - 1} (last 3 verses):\n${formatVerses(lastFew, 'v')}\n`;
    }
    if (osnbNext.length > 0) {
      const firstFew = osnbNext.slice(0, 3);
      contextText += `\nosnb chapter ${chapter + 1} (first 3 verses):\n${formatVerses(firstFew, 'v')}\n`;
    }

    const prompt = `You are verifying Bible verse renumbering between two systems.
OSMAIN is the new master numbering. OSNB is the original (Hebrew/Tanach numbering).
Both texts are in Norwegian.

OSMAIN chapter ${chapter} (${osmainCh.length} verses):
${osmainText}

OSNB chapter ${chapter} (${osnbCh.length} verses):
${osnbText}
${contextText}
For each verse in OSMAIN, find the matching verse in OSNB.
The match may be in the same chapter or an adjacent chapter.
Report whether the renumbering is correct.

"exact" = same text content, just different verse number
"partial" = text partially matches (e.g. header merged into verse)
"merged" = multiple osnb verses merged into one osmain verse
"wrong" = text does not match at all`;

    process.stdout.write(`  ${entry.key} [${entry.type}]... `);

    try {
      const result = await askOllama(prompt);

      // Save result
      writeFileSync(
        join(RESULTS_DIR, `${book}-${chapter}.json`),
        JSON.stringify({ key: entry.key, type: entry.type, result, timestamp: new Date().toISOString() }, null, 2)
      );

      if (result.correct) {
        console.log(`✓ correct`);
        correct++;
      } else {
        const issueList = result.issues?.length ? result.issues.join('; ') : 'unknown issue';
        console.log(`✗ ISSUES: ${issueList.slice(0, 120)}`);
        issues++;
      }

      // Show any 'wrong' mappings
      const wrongMappings = (result.mappings ?? []).filter((m: any) => m.match === 'wrong');
      for (const m of wrongMappings) {
        console.log(`    → osmain v${m.osmainVerse} ≠ osnb ${m.osnbChapter}:${m.osnbVerse}`);
      }
    } catch (err: any) {
      console.log(`ERROR: ${err.message}`);
      errors++;
    }
  }

  console.log(`\n=== VERIFICATION SUMMARY ===`);
  console.log(`Correct: ${correct}`);
  console.log(`Issues: ${issues}`);
  console.log(`Errors: ${errors}`);
  console.log(`Total: ${toVerify.length}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
