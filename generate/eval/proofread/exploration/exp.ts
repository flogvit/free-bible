// Proofread experiment: run one method over seeded copies of the test chapters. Never writes bible data.
//
// Test set (seeds.json): 8 chapters, 198 verses of osnb/osnn, 24 known errors — 7 real ones found by
// readers or on inspection (five «honom», «baktallar», «utgrunnnet») and 17 planted (wrong number,
// dropped clause, dropped negation, wrong gender, swapped names). 2 Tim 1,7 «sjølvdisiplin» is a
// defensible rendering and must not be flagged. score.py counts a target fixed when the suggestion
// no longer carries the error; a few correct rewordings fail its string test and were checked by hand.
//
// 2026-09-23, claude-opus-5-5, errors fixed of 24 (hand-checked), $ per verse at list price:
//   current   (bible.ts prompt)  low 15, medium 16, high 17     $0.0021 / 0.0029 / 0.0036
//   revised   (this prompt)      low 22 ×3, medium 23 ×3       $0.0020 / 0.0029
//   retrans   (new translation + judge, taste allowed)  24, 21 $0.0042
//   retrans-strict (judge counts errors only)       23, 23, 24 $0.0039
// The current prompt misses all five «honom»: an earlier proofread introduced them, and its rule
// "NEVER suggest text that matches ANY previous version" forbids the fix. retrans-strict also finds
// real errors outside the test set that no proofread run found (Elska/Æra as imperatives, gjaldt in
// nynorsk, vart rettferdiggjort, a rhetorical question made a statement in Mark 4,21, blikk stille).
// bun generate/eval/proofread/run.ts <method> <effort> [model]   method: current | revised | retrans | retrans-strict
// effort: low | medium | high | default (the model's own default). RUN=<tag> suffixes the output file,
// TR_EFFORT sets the translation step's effort separately for retrans*.
import '../../../env.js';
import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';

const ROOT = `${import.meta.dir}/../../../bibles_raw`;
const HERE = import.meta.dir;
const [method, effort, model = 'claude-opus-5-5'] = process.argv.slice(2);
const PRICE: Record<string, [number, number]> = { 'claude-opus-5-5': [4, 20], 'claude-opus-5': [5, 25], 'claude-fable-5-1': [10, 50], 'claude-sonnet-5': [2, 10] };
const LANG: Record<string, string> = { osnb: 'Norwegian bokmål', osnn: 'Norwegian nynorsk' };
const client = new Anthropic({ maxRetries: 6 });

type V = { verseId: number; text: string; versions?: any[]; footnotes?: any[] };
const seeds: any[] = JSON.parse(fs.readFileSync(`${HERE}/seeds.json`, 'utf8'));
const chapters = [...new Set(seeds.map(s => `${s.t}/${s.b}/${s.c}`))].map(k => k.split('/'))
  .map(([t, b, c]) => ({ t, b: +b, c: +c }));
// 2 Tim 1 is in the set through its seed; 1,7 is the false-positive trap.

function loadChapter(t: string, b: number, c: number): V[] {
  const vs: V[] = JSON.parse(fs.readFileSync(`${ROOT}/${t}/${b}/${c}.json`, 'utf8'));
  for (const s of seeds.filter(s => s.t === t && s.b === b && s.c === c && !s.real)) {
    const v = vs.find(x => x.verseId === s.v)!;
    if (v.text.split(s.from).length !== 2) throw new Error(`seed not unique: ${t} ${b}:${c}:${s.v}`);
    v.text = v.text.replace(s.from, s.to);
  }
  return vs;
}
function source(b: number, c: number): V[] {
  return JSON.parse(fs.readFileSync(`${ROOT}/${b <= 39 ? 'hebrew' : 'sblgnt'}/${b}/${c}.json`, 'utf8'));
}

const usage = { in: 0, out: 0, calls: 0 };
async function ask(content: string, schema: object, eff: string = effort): Promise<any> {
  for (let attempt = 1; ; attempt++) {
    try {
      const params: any = {
        model, max_tokens: 32000, thinking: { type: 'adaptive' },
        messages: [{ role: 'user', content }],
        output_config: { format: { type: 'json_schema', schema }, ...(eff !== 'default' ? { effort: eff } : {}) },
      };
      const m = await client.messages.stream(params).finalMessage();
      usage.in += m.usage.input_tokens; usage.out += m.usage.output_tokens; usage.calls++;
      if (m.stop_reason !== 'end_turn') throw new Error(`stop_reason ${m.stop_reason}`);
      const text = (m.content.find((x: any) => x.type === 'text') as any).text;
      return JSON.parse(text);
    } catch (e) {
      if (attempt >= 4) throw e;
      console.log(`  retry ${attempt}: ${(e as Error).message.slice(0, 100)}`);
      await new Promise(r => setTimeout(r, 3000 * attempt));
    }
  }
}

// ---------- verbatim from generate/bible.ts (textOnly batch mode) ----------
const ISSUE = {
  type: 'object',
  properties: {
    verseId: { type: 'integer' },
    type: { type: 'string', enum: ['error', 'suggestion', 'theological', 'grammar'] },
    severity: { type: 'string', enum: ['critical', 'major', 'minor'] },
    original: { type: 'string' }, current: { type: 'string' }, suggested: { type: 'string' },
    explanation: { type: 'string' }, previousWasDefensible: { type: 'boolean' },
  },
  required: ['verseId', 'type', 'severity', 'original', 'current', 'suggested', 'explanation', 'previousWasDefensible'],
  additionalProperties: false,
};
const PROOFREAD_TEXT_SCHEMA = {
  type: 'object',
  properties: { issues: { type: 'array', items: ISSUE }, summary: { type: 'string' }, score: { type: 'integer' } },
  required: ['issues', 'summary', 'score'], additionalProperties: false,
};
const styleDescription = 'optimized for oral reading with natural rhythm and flow';
const CURRENT_PROMPT = (language: string) => `You are a Bible translation proofreader. You will receive:
1. The original biblical text (Hebrew/Greek)
2. A translation that should be ${language}, ${styleDescription}

Your task is to review the translation and identify:
- Translation errors or inaccuracies
- Awkward phrasing that could be improved
- Theological concerns
- Missing or added content
- Grammar or spelling errors

Set "previousWasDefensible" for every issue. This decides what the reader is shown:
- true  = the current reading was a legitimate way to render the source. Your suggestion is
          better, but the old one stays visible to the reader as a genuine alternative.
- false = the current reading was inaccurate, ungrammatical, or dropped or added content.
          It gets hidden from the reader rather than offered as a choice.
Judge the previous reading on its own merits, not by how much you prefer yours. A different
but defensible rendering is true; something a careful translator would call wrong is false.

IMPORTANT:
- The "suggested" field must contain the ENTIRE corrected verse, not just the changed phrase.
- Some verses have VERSION HISTORY showing previous revisions. Read the history carefully.
- NEVER suggest text that matches or is similar to ANY previous version in the history.
- NEVER undo a change that was intentionally made (check the "Reason for change").
- If a verse has 3+ revisions, it has been extensively reviewed - only suggest changes for CRITICAL errors.
- If the current version is acceptable, SKIP that verse entirely - do not include it in issues.
- Focus only on verses WITHOUT version history, or verses with genuine new errors.
- Some verses may already have footnotes. Review existing footnotes and only suggest new ones if they add value. Do not duplicate existing footnotes.
- NEVER mention specific Bible editions, Bible societies, or publishers (e.g., "NIV", "ESV", "KJV", "Bibelen 2011", "Bibelselskapet"). Write neutrally without referencing specific translations or organizations.

Score the chapter from 0 to 10, where 10 means the translation is faithful and reads well with nothing left to improve. Use the 0-10 scale only — not a percentage.

If there are no issues (or all issues are in well-reviewed verses), return an empty issues array.`;

function formatTranslation(vs: V[], withFootnotes: boolean): string {
  return vs.map(v => {
    let e = `${v.verseId}: ${v.text}`;
    if (withFootnotes && v.footnotes?.length) {
      e += `\n   EXISTING FOOTNOTES:`;
      for (const fn of v.footnotes) e += `\n   [${fn.source}] ${fn.text}`;
    }
    if (v.versions?.length) {
      e += `\n   VERSION HISTORY (${v.versions.length} previous revisions - DO NOT suggest any of these):`;
      v.versions.forEach((ver, i) => {
        const typeInfo = ver.type ? ` [${ver.type}/${ver.severity || 'unknown'}]` : '';
        e += `\n   ${i + 1}.${typeInfo} "${ver.text}"`;
        if (ver.explanation) e += `\n      Reason for change: ${ver.explanation}`;
      });
    }
    return e;
  }).join('\n');
}
function batches(vs: V[], src: V[], withFootnotes: boolean): V[][] {
  const out: V[][] = []; let cur: V[] = []; let size = 0;
  for (const v of vs) {
    const o = src.find(x => x.verseId === v.verseId);
    const s = (o ? `${o.verseId}: ${o.text}\n`.length : 0) + formatTranslation([v], withFootnotes).length;
    if (size + s > 10000 && cur.length) { out.push(cur); cur = []; size = 0; }
    cur.push(v); size += s;
  }
  if (cur.length) out.push(cur);
  return out;
}

// ---------- revised prompt ----------
const REVISED_PROMPT = (language: string) => `You are proofreading a Bible translation into ${language}, ${styleDescription}. You get the original text (Hebrew/Greek) and the current translation, verse by verse.

Check every verse against the original, in this order:
1. Faithfulness: nothing omitted, nothing added, the meaning preserved. Watch negations, numbers, names, who does what to whom, and tense where it changes the meaning.
2. Language: grammar, spelling and inflection by the current official written standard of ${language}. A form outside that standard is an error even if it occurs in older or dialect texts — archaic case forms of pronouns, forms belonging to another written standard, misspellings.
3. Readability: only where the wording is clearly unidiomatic or hard to read aloud. Do not rewrite a correct, natural verse into wording you happen to prefer.

Version history: some verses list earlier readings and why they were replaced. Do not swing a verse back to an earlier reading for taste. But an earlier change can itself have been wrong — if its stated reason is incorrect, restoring the earlier reading is the right fix.

For each issue:
- "suggested" is the ENTIRE corrected verse, not just the changed phrase.
- "previousWasDefensible": true if the current reading was a legitimate rendering (readers keep seeing it as an alternative); false if it was inaccurate, ungrammatical, or dropped or added content.
- "explanation": one sentence, in ${language}.
- "original" and "current": leave as empty strings.
Report only verses with issues. Never mention specific Bible editions, Bible societies or publishers.
Score the chapter 0–10, where 10 means faithful and reads well with nothing left to improve.`;

function formatRevised(vs: V[]): string {
  return vs.map(v => {
    let e = `${v.verseId}: ${v.text}`;
    if (v.versions?.length) {
      e += `\n   Earlier readings:`;
      v.versions.forEach((ver, i) => { e += `\n   ${i + 1}. "${ver.text}"${ver.explanation ? ` — replaced because: ${ver.explanation}` : ''}`; });
    }
    return e;
  }).join('\n');
}

// ---------- retranslate + judge ----------
const TRANSLATION_SCHEMA = {
  type: 'object',
  properties: { verses: { type: 'array', items: { type: 'object', properties: { bookId: { type: 'integer' }, chapterId: { type: 'integer' }, verseId: { type: 'integer' }, text: { type: 'string' } }, required: ['bookId', 'chapterId', 'verseId', 'text'], additionalProperties: false } } },
  required: ['verses'], additionalProperties: false,
};
const translatePrompt = (language: string, b: number, c: number, text: string) => `You will be given a bible text in the original language, and must return the translation.
Return a JSON object with a "verses" array containing each verse.

Translate the text to ${language} in a modern, adult language that flows well for both silent reading and oral reading.
Optimize for natural rhythm, clear flow, and readability. Allow flexibility from literal wording when it improves clarity or flow, but preserve the meaning of the text.
The translation must be theologically correct in line with Lutheran theology.
Do not make the language childish, explanatory, or paraphrased.

Book ID: ${b}, Chapter: ${c}

Text:
${text}`;
const JUDGE_SCHEMA = {
  type: 'object',
  properties: { verdicts: { type: 'array', items: { type: 'object', properties: { verseId: { type: 'integer' }, better: { type: 'string', enum: ['A', 'B'] }, reason: { type: 'string' }, otherDefensible: { type: 'boolean' } }, required: ['verseId', 'better', 'reason', 'otherDefensible'], additionalProperties: false } } },
  required: ['verdicts'], additionalProperties: false,
};
const judgePrompt = (language: string, body: string) => `You compare two translations of the same Bible chapter into ${language}, ${styleDescription}. For each verse you get the original (Hebrew/Greek) and two readings, A and B.

Report only verses where one reading is clearly better:
- it is more faithful to the original (the other omits, adds or changes meaning — watch negations, numbers, names), or
- the other has a grammar or spelling error by the current official written standard of ${language}, or
- it reads clearly better aloud while being equally faithful.
If both are acceptable and differ only in taste, skip the verse.

For each reported verse: "better" (A or B), "reason" (one sentence, in ${language}), and "otherDefensible" (true if the worse reading is still a legitimate rendering).

${body}`;

const strictJudgePrompt = (language: string, body: string) => `You compare two translations of the same Bible chapter into ${language}, ${styleDescription}. For each verse you get the original (Hebrew/Greek) and two readings, A and B.

Report only verses where one reading has an ERROR the other does not:
- it omits, adds or changes the meaning of the original (watch negations, numbers, names, who does what to whom, questions turned into statements), or
- it breaks the grammar, spelling or inflection of the current official written standard of ${language}.
If both readings are faithful and correct, skip the verse — even if one reads better. Differences of style or taste are not errors.

For each reported verse: "better" (A or B — the one without the error), "reason" (one sentence, in ${language}, naming the error), and "otherDefensible" (always false here unless the error is trivial).

${body}`;

// ---------- run ----------
const results: any[] = [];
await Promise.all(chapters.map(async ({ t, b, c }) => {
  const vs = loadChapter(t, b, c); const src = source(b, c); const language = LANG[t];
  const out: any = { t, b, c, issues: [] as any[] };
  if (method === 'current' || method === 'revised') {
    for (const batch of batches(vs, src, method === 'current')) {
      const ids = new Set(batch.map(v => v.verseId));
      const orig = src.filter(v => ids.has(v.verseId)).map(v => `${v.verseId}: ${v.text}`).join('\n');
      const content = method === 'current'
        ? `${CURRENT_PROMPT(language)}\n\nBook ID: ${b}, Chapter: ${c}\n\nOriginal text:\n${orig}\n\nCurrent translation (with version history and existing footnotes where available):\n${formatTranslation(batch, true)}`
        : `${REVISED_PROMPT(language)}\n\nBook ID: ${b}, Chapter: ${c}\n\nOriginal text:\n${orig}\n\nCurrent translation:\n${formatRevised(batch)}`;
      const r = await ask(content, PROOFREAD_TEXT_SCHEMA);
      out.issues.push(...r.issues.map((i: any) => ({ verseId: i.verseId, type: i.type, severity: i.severity, suggested: i.suggested, explanation: i.explanation, defensible: i.previousWasDefensible })));
      out.score = r.score;
    }
  } else if (method.startsWith('retrans')) {
    const tr = await ask(translatePrompt(language, b, c, src.map(v => `${v.verseId}: ${v.text}`).join('\n')), TRANSLATION_SCHEMA, process.env.TR_EFFORT || effort);
    const fresh = new Map<number, string>(tr.verses.map((v: any) => [v.verseId, v.text]));
    out.fresh = Object.fromEntries(fresh);
    const assign = new Map<number, boolean>(); // true = current is A
    const body = src.map(o => {
      const cur = vs.find(v => v.verseId === o.verseId)?.text ?? ''; const nw = fresh.get(o.verseId) ?? '';
      const curIsA = Math.random() < 0.5; assign.set(o.verseId, curIsA);
      return `${o.verseId}\nORIGINAL: ${o.text}\nA: ${curIsA ? cur : nw}\nB: ${curIsA ? nw : cur}`;
    }).join('\n\n');
    const j = await ask((method === 'retrans-strict' ? strictJudgePrompt : judgePrompt)(language, body), JUDGE_SCHEMA);
    for (const d of j.verdicts) {
      const newWins = (d.better === 'A') !== assign.get(d.verseId);
      if (newWins) out.issues.push({ verseId: d.verseId, suggested: fresh.get(d.verseId), explanation: d.reason, defensible: d.otherDefensible });
      else out.keptCurrent = (out.keptCurrent || 0) + 1;
    }
  }
  results.push(out);
  console.log(`${t} ${b}:${c} — ${out.issues.length} issues`);
}));
const [pin, pout] = PRICE[model];
const cost = usage.in / 1e6 * pin + usage.out / 1e6 * pout;
const verses = chapters.reduce((n, { t, b, c }) => n + loadChapter(t, b, c).length, 0);
const summary = { method, effort, model, usage, cost, verses, perVerse: cost / verses };
console.log(JSON.stringify(summary));
fs.mkdirSync(`${HERE}/out`, { recursive: true });
fs.writeFileSync(`${HERE}/out/${method}-${effort}-${model}${process.env.RUN ? "-" + process.env.RUN : ""}.json`, JSON.stringify({ summary, results }, null, 2));
