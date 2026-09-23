// Translator's notes grounded in the original text: a sample, not a pipeline. Writes nothing to
// bible data. 144 verses (Joh 3, Mark 6, Sal 23, Jes 43 in osnb; 2 Tim 1 in osnn), 20 per call.
//   bun generate/eval/translation-notes/explain.ts <out-name> [effort]
//
// 2026-09-23, claude-opus-5-5 (results in this directory):
//   medium (default): 350 choices, 2.4 per verse, $0.013/verse ≈ $406 per translation at list price
//   low:              213 choices, 1.5 per verse, $0.0059/verse ≈ $183 — needs the "one entry for
//                     every verse" line; without it low effort skipped 27 of 144 verses.
// Every quoted Hebrew/Greek word and every quoted phrase of our translation was found in the
// verse it was quoted from (the check's few misses were the check's own normalization), and no
// note named another Bible edition.
import '../../env.js';
import fs from 'fs';
import {configureRun, doAnthropicCallWithRetry, readOriginalText, usageTotals, usageCost} from '../../bible.js';

const [tag, effort] = process.argv.slice(2);
configureRun({model: 'claude-opus-5-5', effort});
const RAW = `${import.meta.dir}/../../bibles_raw`;
const LANG: Record<string, string> = {osnb: 'Norwegian bokmål', osnn: 'Norwegian nynorsk'};
const CHAPTERS: [string, number, number][] = [['osnb', 43, 3], ['osnb', 41, 6], ['osnb', 19, 23], ['osnn', 55, 1], ['osnb', 23, 43]];

const SCHEMA = {
  type: 'object',
  properties: {
    notes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          verseId: {type: 'integer'},
          noRealChoice: {type: 'boolean'},
          choices: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                rendering: {type: 'string'}, original: {type: 'string'}, transliteration: {type: 'string'},
                meaning: {type: 'string'}, why: {type: 'string'}, alternatives: {type: 'array', items: {type: 'string'}},
              },
              required: ['rendering', 'original', 'transliteration', 'meaning', 'why', 'alternatives'],
              additionalProperties: false,
            },
          },
        },
        required: ['verseId', 'noRealChoice', 'choices'],
        additionalProperties: false,
      },
    },
  },
  required: ['notes'],
  additionalProperties: false,
};

const prompt = (language: string, orig: string, ours: string) => `You write translator's notes for a Bible translation into ${language}, made for reading aloud. A reader opens the note to see why a verse reads the way it does, with the original language beside it.

For each verse, pick the places where the original allows more than one reasonable rendering — a word with a range of meanings, a tense or construction that can be read two ways, an idiom, a word order — and for each:
- "rendering": the words in OUR translation, copied exactly as they stand in the verse below.
- "original": the Hebrew/Greek word or words, copied exactly as they stand in the original verse below.
- "transliteration" and "meaning": the basic sense of the original.
- "why": why this rendering was chosen, argued from the original and the context. Be concrete.
- "alternatives": other renderings a translator could defend, each with what it would emphasize.
One to four choices per verse, most important first. If the verse follows the original so closely that there is no real choice, set "noRealChoice" and give at most one short note instead of inventing a choice.

Return exactly one entry for every verse number in OUR TRANSLATION, in order — also for the verses with no real choice.

Never mention or compare with other Bible translations, editions, publishers or Bible societies. Write the notes in ${language}, plainly, for an interested lay reader.

ORIGINAL:
${orig}

OUR TRANSLATION:
${ours}`;

const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f\u0591-\u05c7\u05f3\u05f4\u2e00-\u2e0f]/g, '').replace(/[^\p{L}\s]/gu, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
const EDITION = /bibel ?20\d\d|bibelselskap|norsk bibel|\bniv\b|\besv\b|\bkjv\b|1930|1978|2011|luther/i;

const out: any[] = [];
let origOk = 0, origAll = 0, rendOk = 0, rendAll = 0, editions = 0, verses = 0, choices = 0, noChoice = 0;
await Promise.all(CHAPTERS.map(async ([t, b, c]) => {
  const ours: {verseId: number; text: string}[] = JSON.parse(fs.readFileSync(`${RAW}/${t}/${b}/${c}.json`, 'utf8'));
  const orig = readOriginalText(b, c, []);
  for (let i = 0; i < ours.length; i += 20) {
    const part = ours.slice(i, i + 20);
    const ids = new Set(part.map(v => v.verseId));
    const r = await doAnthropicCallWithRetry<any>(prompt(LANG[t], orig.filter(v => ids.has(+v.verseId)).map(v => `${v.verseId}: ${v.text}`).join('\n'), part.map(v => `${v.verseId}: ${v.text}`).join('\n')), SCHEMA, `explain ${b}:${c}`, false);
    for (const n of r.notes) {
      const src = norm(orig.find(v => +v.verseId === +n.verseId)?.text ?? '');
      const our = (ours.find(v => v.verseId === +n.verseId)?.text ?? '').toLowerCase();
      verses++; if (n.noRealChoice) noChoice++;
      for (const ch of n.choices) {
        choices++;
        const words = norm(ch.original).split(' ').filter(Boolean);
        origAll++; const ok = words.length > 0 && words.every(w => src.split(' ').includes(w)); if (ok) origOk++; ch._originalFound = ok;
        rendAll++; const rok = our.includes(ch.rendering.toLowerCase()); if (rok) rendOk++; ch._renderingFound = rok;
        if (EDITION.test(JSON.stringify(ch))) editions++;
      }
      out.push({t, b, c, ...n, ourText: ours.find(v => v.verseId === +n.verseId)?.text, original: orig.find(v => +v.verseId === +n.verseId)?.text});
    }
  }
}));
out.sort((x, y) => x.t.localeCompare(y.t) || x.b - y.b || x.c - y.c || x.verseId - y.verseId);
const cost = usageCost()!;
const summary = {tag, effort: effort ?? 'default', verses, choices, noChoice, originalFound: `${origOk}/${origAll}`, renderingFound: `${rendOk}/${rendAll}`, mentionsEditions: editions, cost, perVerse: cost / verses, usage: usageTotals};
console.log(JSON.stringify(summary));
fs.writeFileSync(`${import.meta.dir}/${tag}.json`, JSON.stringify({summary, notes: out}, null, 2));
