/**
 * Tekstverifisering av KVN-mappingene.
 *
 * For hvert vers i en oversettelse: hent osmain-verset mappingen peker på, og
 * avgjør om teksten svarer til det mappingen påstår. Rundturskontrollen teller
 * tall; denne leser tekst.
 *
 * KJØR `check-mapping-coverage.ts` FØRST. Den finner gratis de versene der
 * oppslaget ikke kan lykkes i det hele tatt (168 774 ved første kjøring), og
 * uten den brukes måneder med GPU-tid på vers som er uoppnåelige uansett.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * NETTET
 *
 * Fem lag, ELLER-koblet: slår ett av dem ut, går verset til nærmere ettersyn.
 * Sammensetningen er ikke valgt etter hvor gode lagene er hver for seg, men
 * etter hva de bommer på i FELLESSKAP. Målt på 1 831 par fra 12 språk med fire
 * konstruerte feiltyper: bomrate 0,07 % (1 av 1 351, og den ene var en
 * feilmerking i testsettet), eskalering 16,5 %.
 *
 *   j1     gemma4:31b, kalibrert med mekanisk valgte eksempler   97 % / 100 % / 100 %
 *   j2     granite4.1:30b — annen modellfamilie, halverer bomraten
 *   punct  vers ender på komma der oversettelsen ellers ikke gjør det
 *   cov    et setningsledd i osmain-verset har ingen motpart i oversettelsens
 *   short  kortere enn oversettelsens egen normal for den verselengden
 *
 * Validert mot 13 dokumenterte mappingfeil i FUNN.md: 13 av 13. Ingen enkeltdel
 * klarte det — dommeren tok 11, de gratis lagene tok de to siste.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * PASS
 *
 * Ett pass per modell, så bare én stor modell er resident. På en 64 GB-maskin er
 * det ikke en optimalisering: kastes modellen ut og inn mellom kallene, går
 * farten fra 3,5 s/par til 11 s/par.
 *
 *   prep     bge-m3 på et utvalg → basislinjer og kalibreringseksempler per
 *            oversettelse. Eksemplene velges MEKANISK (høyest likhet, lengde
 *            nærmest normalen) — de kan ikke velges fra fasit, for fasiten er
 *            det vi skal fram til.
 *   mech     bge-m3 på alle vers → likhet, lengde, leddekning, tegnsetting
 *   judge1   gemma4:31b
 *   judge2   granite4.1:30b
 *   verdict  ren regning, ingen modell → endelig dom per vers
 *
 * Alle pass er gjenopptakbare per kapittel. Avbrudd koster ingenting.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * LOGG
 *
 * kvn/data/text-verification/<oversettelse>/<bok>/<kapittel>.json
 *
 * Kapittelnivå, ikke per vers: 27,5 M filer à ~150 byte legger beslag på 110 GB
 * på 4 KB-blokker. Kapittelfiler lander på ~4 KB — én blokk, null svinn — og
 * speiler bibles_raw én-til-én.
 *
 * Bruk:
 *   bun scripts/verify-text.ts --pass prep    --priority 1
 *   bun scripts/verify-text.ts --pass mech    --priority 1
 *   bun scripts/verify-text.ts --pass judge1  --priority 1
 *   bun scripts/verify-text.ts --pass judge2  --priority 1
 *   bun scripts/verify-text.ts --pass verdict --priority 1
 *
 *   ... eller navngi oversettelser i stedet for --priority.
 *   --force        ignorer gjenopptakelsesmarkører
 *   --concurrency  parallelle kall (standard 4 for bge-m3, 1 for dommerne)
 *   --help         hele flaggtabellen
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parseArgs, formatHelp, COMMON_FLAGS } from '../../generate/cli.js';
import type { FlagSpec } from '../../generate/cli.js';
import { loadUkvnMapping, listUkvnMappings } from '../src/ukvn-loader.js';
import { UkvnMapper } from '../src/ukvn-mapper.js';
import { ukvnEncode, ukvnDecode, ukvnFormat, UKVN_PART_SIZE } from '../src/ukvn-types.js';

const SPEC: Record<string, FlagSpec> = {
  pass: {kind: 'string', help: 'hvilket pass: prep | mech | judge1 | judge2 | verdict'},
  priority: {kind: 'string', help: 'prioritetsnivåer fra research/text-verification/priority.txt, f.eks. 1 eller 1,2'},
  concurrency: {kind: 'number', help: 'parallelle kall (standard 4 for prep og mech, 1 for dommerne)'},
  limit: COMMON_FLAGS.limit,
  force: COMMON_FLAGS.force,
  help: COMMON_FLAGS.help,
};

const {flags, positional} = parseArgs(process.argv.slice(2), SPEC);
if (flags.help) {
  console.log(formatHelp(
    'kvn/scripts/verify-text.ts',
    'tekstverifisering av KVN-mappingene: svarer verset til osmain-verset mappingen peker på',
    SPEC,
    [
      'bun kvn/scripts/verify-text.ts --pass prep --priority 1',
      'bun kvn/scripts/verify-text.ts --pass mech --priority 1',
      'bun kvn/scripts/verify-text.ts --pass judge1 kjv spanish',
      'bun kvn/scripts/verify-text.ts --pass verdict --limit 3 --force kjv',
      '',
      'Oversettelser navngis som posisjonsargumenter i stedet for --priority.',
      'Kjør check-mapping-coverage.ts FØRST — den finner gratis de versene der',
      'oppslaget ikke kan lykkes i det hele tatt.',
    ],
  ));
  process.exit(0);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '../..');
const RAW = join(REPO, 'generate/bibles_raw');
const OUT = join(REPO, 'kvn/data/text-verification');
const OLLAMA = process.env.OLLAMA_URL ?? 'http://localhost:11434';

const EMBED_MODEL = process.env.EMBED_MODEL ?? 'bge-m3';
const JUDGE1 = process.env.JUDGE1 ?? 'gemma4:31b';
const JUDGE2 = process.env.JUDGE2 ?? 'granite4.1:30b';

const PASS = (flags.pass as string | undefined) ?? '';
const FORCE = flags.force as boolean;
const PRIORITY = flags.priority as string | undefined;
/** Samtidigheten avhenger av passet, så standarden kan ikke stå i SPEC. */
const CONC = (flags.concurrency as number | undefined)
  ?? (PASS === 'mech' || PASS === 'prep' ? 4 : 1);
/** Røyktest / måling på en ny maskin: behandle bare de første N kapitlene. */
const LIMIT = (flags.limit as number | undefined) ?? 0;

if (!['prep', 'mech', 'judge1', 'judge2', 'verdict'].includes(PASS)) {
  console.error('--pass må være prep | mech | judge1 | judge2 | verdict');
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────── måltall
//
// Alle terskler er PERSENTILER I OVERSETTELSENS EGEN FORDELING, ikke absolutte.
// Medianen for lengderatio spriker fra 0,51 (koreansk) til 1,28 (burmesisk), og
// absolutt likhet fra 0,57 (haitisk kreol) til 0,87 (engelsk). En fast terskel
// straffer lavressursspråk uten å fange noe mer.
const TH = {
  /** lengde: 2. persentil. Målt 43 % av grensefeil ved 1,9 % falsk alarm. */
  shortPct: 0.02,
  /** lengde per lengdebånd: 3 % falsk alarm ga 54 % av grensefeilene. */
  bandPct: 0.03,
  /** leddekning: 1. persentil. 22 % av grensefeil, 59 % av feil vers. */
  covPct: 0.01,
  /**
   * Tegnsetting er informativ bare der oversettelsen normalt AVSLUTTER versene.
   * awadhi avslutter 79 % av sine ekte vers med komma, thai og amharisk 0 %.
   *
   * IKKE STRAM INN DENNE. Signalets falske alarm er omtrent lik basislinjen, så
   * 0,15 ser sløvt ut — `kjv` ligger på 0,14 og flagger hver sjuende vers uten
   * grunn. Men innstramming er målt til å være verre:
   *
   *     0,15 → bomrate 0,07 %, eskalering 16,5 %
   *     0,10 → bomrate 0,15 %, eskalering 15,4 %
   *     0,05 → bomrate 0,30 %, eskalering 14,8 %
   *
   * Å spare 1,7 prosentpoeng eskalering firedobler bomraten. Eskalering er
   * regnetid; bom er den eneste gale dommen.
   */
  punctMaxBase: 0.15,
  /** korte vers gir ustabil lengderatio og holdes utenfor basislinjen */
  minLenForStats: 40,
};

/** Skilletegn som IKKE avslutter en setning, på tvers av skriftsystemer. */
const OPEN_PUNCT = /[,;:،؛۔॥।၊、，；：]\s*$/;

/** Lengdebånd: et vers på 40 tegn tåler 50 % variasjon, et på 300 gjør ikke det. */
const BANDS: Array<[number, number]> = [[0, 80], [80, 160], [160, 320], [320, Infinity]];
const bandOf = (len: number) => BANDS.findIndex(([lo, hi]) => len >= lo && len < hi);

// ─────────────────────────────────────────────────────────────── data
interface Verse { bookId: number; chapterId: number; verseId: number; text: string }

const chapterCache = new Map<string, Verse[] | null>();
function loadChapter(tr: string, b: number, c: number): Verse[] | null {
  const key = `${tr}/${b}/${c}`;
  if (!chapterCache.has(key)) {
    const f = join(RAW, tr, String(b), `${c}.json`);
    let v: Verse[] | null = null;
    if (existsSync(f)) { try { v = JSON.parse(readFileSync(f, 'utf8')); } catch { v = null; } }
    if (chapterCache.size > 400) chapterCache.clear();
    chapterCache.set(key, v);
  }
  return chapterCache.get(key)!;
}

function chaptersOf(tr: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const root = join(RAW, tr);
  if (!existsSync(root)) return out;
  for (const bd of readdirSync(root)) {
    const b = Number(bd);
    if (!Number.isInteger(b) || b < 1 || b > 66) continue;
    for (const cf of readdirSync(join(root, bd))) {
      if (!cf.endsWith('.json')) continue;
      const c = Number(cf.slice(0, -5));
      if (Number.isInteger(c)) out.push([b, c]);
    }
  }
  return out.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
}

/** osmains numre ER den kanoniske nummereringen, så kvn = encode(bok,kap,vers). */
function osmainText(kvn: number): string | null {
  const base = kvn - (kvn % UKVN_PART_SIZE);
  const d = ukvnDecode(base);
  return loadChapter('osmain', d.book, d.chapter)?.find(v => v.verseId === d.verse)?.text ?? null;
}

// ─────────────────────────────────────────────────────────────── ollama
async function embed(texts: string[]): Promise<Float32Array[]> {
  const r = await fetch(`${OLLAMA}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // keep_alive er ikke valgfritt: uten det lastes modellen ut mellom kallene
    // og hver dom koster en ny innlasting — målt 11 s/par mot 3,5 s/par.
    body: JSON.stringify({ model: EMBED_MODEL, input: texts, keep_alive: '60m' }),
  });
  if (!r.ok) throw new Error(`embed ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const d = await r.json() as { embeddings: number[][] };
  return d.embeddings.map(v => {
    let s = 0;
    for (const x of v) s += x * x;
    s = Math.sqrt(s) || 1;
    const out = new Float32Array(v.length);
    for (let i = 0; i < v.length; i++) out[i] = v[i] / s;
    return out;
  });
}
const dot = (a: Float32Array, b: Float32Array) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

type Verdict = 'EQUIVALENT' | 'B_MISSING' | 'B_EXTRA' | 'DIFFERENT';
const JUDGE_SCHEMA = {
  type: 'object' as const,
  properties: { verdict: { type: 'string' as const, enum: ['EQUIVALENT', 'B_MISSING', 'B_EXTRA', 'DIFFERENT'] } },
  required: ['verdict'],
};

/**
 * Dommen. Formuleringen er målt mot seks alternativer.
 *
 * Å beskrive feiltypen for modellen («se om slutten mangler») ga 97 % gjenkall og
 * 56 % falsk alarm — den finner det den blir bedt om å finne. En forventning
 * («de fleste par er like») drepte følsomheten helt: 3 av 39. Nøytral
 * ekvivalensspørring er den eneste som virker.
 *
 * Kalibreringseksemplene er det som halverer falsk alarm, 21 % → 10 %. De viser
 * modellen hvor fri NETTOPP DENNE oversettelsen er, uten å avsløre feiltypen.
 */
function judgePrompt(A: string, B: string, shots: string | null): string {
  const head = 'A and B are two renderings of the same Bible verse in different languages.';
  const rubric = `Do they carry the same content?

EQUIVALENT — same content
B_MISSING   — B leaves out something A states
B_EXTRA     — B states something beyond A
DIFFERENT   — not the same passage`;
  if (!shots) return `${head}\n\nA: ${A}\nB: ${B}\n\n${rubric}`;
  return `${head}
B always comes from the same translation. Here is how that translation normally
renders a verse — these are the reference points for what counts as EQUIVALENT:

${shots}

Now judge this pair by the same standard.

A: ${A}
B: ${B}

${rubric}`;
}

async function judge(model: string, A: string, B: string, shots: string | null): Promise<Verdict | null> {
  try {
    const r = await fetch(`${OLLAMA}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model, prompt: judgePrompt(A, B, shots), stream: false, think: false,
        format: JUDGE_SCHEMA, keep_alive: '60m',
        options: { temperature: 0, num_predict: 64, num_ctx: shots ? 32768 : 8192 },
      }),
    });
    if (!r.ok) return null;
    return JSON.parse((await r.json() as { response: string }).response).verdict as Verdict;
  } catch { return null; }
}

// ─────────────────────────────────────────────────────────────── statistikk
const median = (a: number[]): number => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const mad = (a: number[], m: number) => 1.4826 * median(a.map(x => Math.abs(x - m))) || 1e-6;
const pct = (a: number[], p: number) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(s.length * p)))];
};

/**
 * Del i setningsledd.
 *
 * minLen = 30 for kryssspråklig sammenlikning. 15 var bedre enspråklig — korte
 * ledd bærer ofte nettopp det som mangler — men på tvers av språk finnes ingen
 * pålitelig motpart til et så kort ledd: kontrollfordelingen brer seg ut og
 * terskelen faller. Målt tok minLen=15 leddekningen fra 23 % til 3 % på grensefeil.
 */
function clauses(text: string, minLen = 30): string[] {
  const parts = text.split(/(?<=[,;:.!?।॥။၊、，；：])\s+/);
  const out: string[] = [];
  for (const p of parts) {
    if (out.length && out[out.length - 1].length < minLen) out[out.length - 1] += ' ' + p;
    else out.push(p);
  }
  while (out.length > 1 && out[out.length - 1].length < minLen) out[out.length - 2] += ' ' + out.pop()!;
  const trimmed = out.map(s => s.trim()).filter(s => s.length >= 8);
  if (trimmed.length >= 2) return trimmed;
  // Uten indre tegnsetting: del på lengde. Uten dette hoppes paret over, og
  // awadhi Rom 8,1 slapp gjennom nettopp fordi osmain-verset var udelbart.
  const t = text.trim();
  if (t.length < 2 * minLen) return trimmed.length ? trimmed : [t];
  const mid = Math.floor(t.length / 2);
  const sp = t.lastIndexOf(' ', mid);
  const cut = sp > minLen && t.length - sp > minLen ? sp : mid;
  return [t.slice(0, cut).trim(), t.slice(cut).trim()].filter(s => s.length >= 8);
}

// ─────────────────────────────────────────────────────────────── logg
interface Row {
  v: number;                       // versnummer i oversettelsen
  kvn: number;                     // osmain-verset mappingen peker på
  ref?: string;                    // lesbar osmain-referanse
  sim?: number | null;             // bge-m3 cosinus
  len?: number | null;             // lengderatio, normalisert mot oversettelsen
  lenZ?: number | null;            // samme, per lengdebånd
  cov?: number | null;             // dårligst dekkede setningsledd
  punct?: boolean | null;          // ender på ikke-avsluttende tegn (null = av)
  j1?: Verdict | null;
  j2?: Verdict | null;
  verdict?: string;                // OK | SHORT | MERGED | WRONG | UNRESOLVED
  flag?: string[];                 // hvilke lag som slo ut
  note?: string;                   // EMPTY | NO_OSMAIN | PART
}
interface ChapterFile {
  translation: string; book: number; chapter: number;
  marks: Record<string, string>;   // pass → gjenopptakelsesmarkør
  rows: Row[];
}

const outPath = (tr: string, b: number, c: number) => join(OUT, tr, String(b), `${c}.json`);

function loadOut(tr: string, b: number, c: number): ChapterFile | null {
  const f = outPath(tr, b, c);
  if (!existsSync(f)) return null;
  try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; }
}
function saveOut(cf: ChapterFile) {
  const f = outPath(cf.translation, cf.book, cf.chapter);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, JSON.stringify(cf));
}

/** Endrer kapitlet eller mappingen seg, må passet gjøres om. */
const markerFor = (verses: Verse[], mapper: UkvnMapper, b: number, c: number) =>
  `${verses.length}:${verses.reduce((s, v) => s + (v.text?.length ?? 0), 0)}:` +
  `${verses.reduce((s, v) => s + mapper.toKvn(ukvnEncode(b, c, v.verseId)), 0)}`;

// ─────────────────────────────────────────────────────────────── basislinje
interface Baseline {
  translation: string;
  model: string;
  simMedian: number;
  lenMedian: number;
  /** per lengdebånd: median og spredning for lengderatio */
  bands: Array<{ lm: number; ls: number } | null>;
  shortTh: number;                 // lengderatio under dette = kort
  bandTh: number;                  // z under -dette = kort for sin lengde
  covTh: number;                   // leddekning under dette
  punctBase: number;               // andel ekte vers som ender på komma
  punctActive: boolean;
  shots: string | null;            // kalibreringseksempler
  sampled: number;
}

const baselinePath = (tr: string) => join(OUT, tr, '_baseline.json');
const loadBaseline = (tr: string): Baseline | null => {
  const f = baselinePath(tr);
  if (!existsSync(f)) return null;
  try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; }
};

/**
 * prep: bygg basislinjer og kalibreringseksempler fra et utvalg.
 *
 * Utvalget spres over sjangre — lov, fortelling, poesi, profeti, evangelium,
 * brev — fordi lengde- og likhetsfordelingen skiller seg mye mellom dem.
 */
const PREP_CHAPTERS: Array<[number, number]> = [
  [1, 12], [2, 14], [3, 19], [5, 8], [6, 6], [9, 17], [11, 18], [13, 16],
  [18, 14], [19, 34], [19, 119], [20, 15], [21, 3], [23, 40], [24, 31],
  [26, 37], [27, 3], [40, 13], [41, 9], [42, 10], [43, 11], [44, 16],
  [45, 5], [46, 13], [49, 4], [58, 11], [60, 2], [66, 5],
];

async function prep(tr: string, mapper: UkvnMapper): Promise<Baseline | null> {
  const pairs: Array<{ A: string; B: string; sim?: number; ratio: number }> = [];
  /** Garantert ulike par: osmain vers n mot oversettelsens vers n+2. */
  const mismatched: Array<{ A: string; B: string }> = [];
  let punctN = 0, punctOpen = 0;

  for (const [b, c] of PREP_CHAPTERS) {
    const verses = loadChapter(tr, b, c);
    if (!verses) continue;
    const byId = new Map(verses.map(v => [v.verseId, v.text]));
    for (const v of verses) {
      if (!v.text?.trim()) continue;
      punctN++;
      if (OPEN_PUNCT.test(v.text)) punctOpen++;
      if (v.text.length < TH.minLenForStats) continue;
      const os = osmainText(mapper.toKvn(ukvnEncode(b, c, v.verseId)));
      if (!os || os.length < TH.minLenForStats) continue;
      pairs.push({ A: os, B: v.text, ratio: v.text.length / os.length });

      const other = byId.get(v.verseId + 2);
      if (other && other.length >= TH.minLenForStats && mismatched.length < 40) {
        mismatched.push({ A: os, B: other });
      }
    }
  }
  if (pairs.length < 30) return null;

  // likhet på utvalget
  for (let i = 0; i < pairs.length; i += 24) {
    const batch = pairs.slice(i, i + 24);
    try {
      const e = await embed(batch.flatMap(p => [p.A, p.B]));
      batch.forEach((p, j) => { p.sim = dot(e[2 * j], e[2 * j + 1]); });
    } catch { /* hopper over bolken */ }
  }
  const scored = pairs.filter(p => p.sim !== undefined) as Array<Required<typeof pairs[0]>>;
  if (scored.length < 30) return null;

  const lenMedian = median(scored.map(p => p.ratio));
  const normLens = scored.map(p => p.ratio / lenMedian);

  const bands = BANDS.map((_, bi) => {
    const s = scored.filter(p => bandOf(p.A.length) === bi).map(p => p.ratio);
    if (s.length < 15) return null;
    const lm = median(s);
    return { lm, ls: mad(s, lm) };
  });

  // leddekning på utvalget, til terskel
  const covs: number[] = [];
  for (const p of scored.slice(0, 120)) {
    const ca = clauses(p.A), cb = clauses(p.B);
    if (ca.length < 2 || !cb.length) continue;
    try {
      const e = await embed([...ca, ...cb]);
      const ea = e.slice(0, ca.length), eb = e.slice(ca.length);
      covs.push(Math.min(...ea.map(a => Math.max(...eb.map(x => dot(a, x))))));
    } catch { /* hopper over */ }
  }

  /**
   * Kalibreringseksempler, valgt MEKANISK.
   *
   * De må være par vi har god grunn til å tro er riktige — og det kan ikke
   * avgjøres fra fasit, for fasiten er det vi skal fram til. Høyest likhet med
   * lengde nærmest normalen er nesten sikkert riktige par. Målt: like god effekt
   * som å plukke dem fra fasiten (falsk alarm 10 % begge veier).
   *
   * Motvekten er nødvendig: med bare EQUIVALENT-eksempler blir modellen ja-skjev
   * og gjenkallet faller sammen (målt 3 av 39 med en slik skjevhet).
   *
   * Men motvekten må være et EKTE ulikt par. Å bruke det svakest skårende paret
   * blant de riktige — som forskningsversjonen gjorde — merker et likt par som
   * ulikt og lærer modellen noe galt. `kjv` fikk «Han la veden til rette,
   * parterte oksen…» mot «he put the wood in order, and cut the bullock in
   * pieces…» merket DIFFERENT. Vi konstruerer i stedet et par som garantert er
   * ulikt: osmain vers n mot oversettelsens vers n+2.
   */
  const ranked = [...scored]
    .map(p => ({ p, score: p.sim - 1.5 * Math.abs(p.ratio / lenMedian - 1) }))
    .sort((a, b) => b.score - a.score);
  const counter = mismatched.length
    ? mismatched[Math.floor(mismatched.length / 2)]
    : null;
  const shots = ranked.length >= 6 && counter
    ? [...ranked.slice(0, 3).map(x => `A: ${x.p.A}\nB: ${x.p.B}\n→ EQUIVALENT`),
       `A: ${counter.A}\nB: ${counter.B}\n→ DIFFERENT`].join('\n\n')
    : null;

  const punctBase = punctN ? punctOpen / punctN : 1;
  return {
    translation: tr,
    model: EMBED_MODEL,
    simMedian: +median(scored.map(p => p.sim)).toFixed(4),
    lenMedian: +lenMedian.toFixed(4),
    bands,
    shortTh: +pct(normLens, TH.shortPct).toFixed(4),
    bandTh: +Math.abs(pct(scored.map(p => {
      const bd = bands[bandOf(p.A.length)];
      return bd ? (p.ratio - bd.lm) / bd.ls : 0;
    }), TH.bandPct)).toFixed(3),
    covTh: covs.length >= 20 ? +pct(covs, TH.covPct).toFixed(4) : -1,
    punctBase: +punctBase.toFixed(3),
    punctActive: punctBase <= TH.punctMaxBase,
    shots,
    sampled: scored.length,
  };
}

// ─────────────────────────────────────────────────────────────── passene
async function runPass(tr: string): Promise<{ chapters: number; verses: number; skipped: number }> {
  let mapper: UkvnMapper;
  try { mapper = new UkvnMapper(loadUkvnMapping(tr)); } catch { return { chapters: 0, verses: 0, skipped: 0 }; }

  if (PASS === 'prep') {
    if (!FORCE && loadBaseline(tr)) return { chapters: 0, verses: 0, skipped: 1 };
    const b = await prep(tr, mapper);
    if (!b) { console.log(`  ${tr}: for lite data til basislinje`); return { chapters: 0, verses: 0, skipped: 0 }; }
    mkdirSync(dirname(baselinePath(tr)), { recursive: true });
    writeFileSync(baselinePath(tr), JSON.stringify(b, null, 1));
    console.log(
      `  ${tr.padEnd(24)} likhet ${b.simMedian.toFixed(3)}  lengde ${b.lenMedian.toFixed(2)}  ` +
      `tegnsetting ${b.punctActive ? 'på' : `av (${(100 * b.punctBase).toFixed(0)} % ender på komma)`}`
    );
    return { chapters: 0, verses: b.sampled, skipped: 0 };
  }

  const base = loadBaseline(tr);
  if (!base) { console.log(`  ${tr}: mangler basislinje — kjør --pass prep først`); return { chapters: 0, verses: 0, skipped: 0 }; }

  const chapters = LIMIT ? chaptersOf(tr).slice(0, LIMIT) : chaptersOf(tr);
  let nCh = 0, nV = 0, nSkip = 0, next = 0;

  await Promise.all(Array.from({ length: CONC }, async () => {
    while (true) {
      const i = next++;
      if (i >= chapters.length) return;
      const [b, c] = chapters[i];
      const verses = loadChapter(tr, b, c);
      if (!verses?.length) continue;

      const mark = markerFor(verses, mapper, b, c);
      let cf = loadOut(tr, b, c);
      if (cf && cf.marks?.[PASS] === mark && !FORCE) { nSkip++; continue; }

      // rader opprettes av første pass som treffer kapitlet
      if (!cf || cf.rows.length !== verses.length) {
        cf = { translation: tr, book: b, chapter: c, marks: {}, rows: [] };
        for (const v of verses) {
          const kvn = mapper.toKvn(ukvnEncode(b, c, v.verseId));
          const row: Row = { v: v.verseId, kvn };
          if (!v.text?.trim()) row.note = 'EMPTY';
          else if (!osmainText(kvn)) row.note = 'NO_OSMAIN';
          else if (kvn % UKVN_PART_SIZE > 0) row.note = 'PART';
          cf.rows.push(row);
        }
      }
      const byVerse = new Map(verses.map(v => [v.verseId, v.text]));

      try {
        if (PASS === 'mech') await mechChapter(cf, byVerse, base);
        else if (PASS === 'judge1') await judgeChapter(cf, byVerse, base, JUDGE1, 'j1');
        else if (PASS === 'judge2') await judgeChapter(cf, byVerse, base, JUDGE2, 'j2');
        else if (PASS === 'verdict') verdictChapter(cf, base);
      } catch (e) {
        console.log(`\n  ${tr} ${b}:${c} feilet: ${String(e).slice(0, 120)}`);
        continue;
      }

      cf.marks[PASS] = mark;
      saveOut(cf);
      nCh++; nV += cf.rows.length;
    }
  }));

  return { chapters: nCh, verses: nV, skipped: nSkip };
}

async function mechChapter(cf: ChapterFile, byVerse: Map<number, string>, base: Baseline) {
  const work = cf.rows.filter(r => !r.note || r.note === 'PART');
  if (!work.length) return;

  // likhet + lengde
  const texts: string[] = [];
  const pairs: Array<{ row: Row; A: string; B: string }> = [];
  for (const row of work) {
    const B = byVerse.get(row.v);
    const A = osmainText(row.kvn);
    if (!B || !A) continue;
    row.ref = ukvnFormat(row.kvn - (row.kvn % UKVN_PART_SIZE));
    row.len = +(B.length / A.length / base.lenMedian).toFixed(3);
    const bd = base.bands[bandOf(A.length)];
    row.lenZ = bd ? +((B.length / A.length - bd.lm) / bd.ls).toFixed(2) : null;
    row.punct = base.punctActive ? OPEN_PUNCT.test(B) : null;
    pairs.push({ row, A, B });
    texts.push(A, B);
  }
  if (!pairs.length) return;

  for (let i = 0; i < pairs.length; i += 24) {
    const batch = pairs.slice(i, i + 24);
    const e = await embed(batch.flatMap(p => [p.A, p.B]));
    batch.forEach((p, j) => { p.row.sim = +dot(e[2 * j], e[2 * j + 1]).toFixed(4); });
  }

  // leddekning — bare der terskelen finnes
  if (base.covTh > -1) {
    for (const p of pairs) {
      const ca = clauses(p.A), cb = clauses(p.B);
      if (ca.length < 2 || !cb.length) { p.row.cov = null; continue; }
      const e = await embed([...ca, ...cb]);
      const ea = e.slice(0, ca.length), eb = e.slice(ca.length);
      p.row.cov = +Math.min(...ea.map(a => Math.max(...eb.map(x => dot(a, x))))).toFixed(4);
    }
  }
}

async function judgeChapter(cf: ChapterFile, byVerse: Map<number, string>, base: Baseline, model: string, field: 'j1' | 'j2') {
  for (const row of cf.rows) {
    if (row.note && row.note !== 'PART') continue;
    const B = byVerse.get(row.v);
    const A = osmainText(row.kvn);
    if (!B || !A) continue;
    row[field] = await judge(model, A, B, base.shots);
  }
}

/**
 * Endelig dom. Ren regning — ingen modell.
 *
 * ELLER over fem lag. Klassifiseringen følger dommens type, som peker nesten
 * entydig på feilklassen: DIFFERENT → feil vers (100 % av dem), B_EXTRA →
 * fletting (99 %), B_MISSING → avkortet (85 %). Derfor skrives typen, ikke bare
 * ja/nei: arbeidslisten til fikserunden kommer ferdig sortert etter feilklasse.
 */
function verdictChapter(cf: ChapterFile, base: Baseline) {
  for (const row of cf.rows) {
    if (row.note && row.note !== 'PART') { row.verdict = row.note; row.flag = []; continue; }
    const flag: string[] = [];
    if (row.j1 && row.j1 !== 'EQUIVALENT') flag.push(`j1:${row.j1}`);
    if (row.j2 && row.j2 !== 'EQUIVALENT') flag.push(`j2:${row.j2}`);
    if (row.punct === true) flag.push('punct');
    if (row.len !== null && row.len !== undefined && row.len < base.shortTh) flag.push('short');
    if (row.lenZ !== null && row.lenZ !== undefined && row.lenZ < -base.bandTh) flag.push('shortForLength');
    if (base.covTh > -1 && row.cov !== null && row.cov !== undefined && row.cov < base.covTh) flag.push('coverage');

    row.flag = flag;
    if (!flag.length) { row.verdict = 'OK'; continue; }

    const v = row.j1 && row.j1 !== 'EQUIVALENT' ? row.j1
            : row.j2 && row.j2 !== 'EQUIVALENT' ? row.j2 : null;
    row.verdict = v === 'DIFFERENT' ? 'WRONG'
                : v === 'B_EXTRA' ? 'MERGED'
                : v === 'B_MISSING' ? 'SHORT'
                : 'UNRESOLVED';
  }
}

// ─────────────────────────────────────────────────────────────── kjøringen
function priorityList(tier: string): string[] {
  const f = join(REPO, 'kvn/research/text-verification/priority.txt');
  if (!existsSync(f)) { console.error(`fant ikke ${f}`); process.exit(1); }
  const want = new Set(tier.split(',').map(t => `pri${t.trim()}`));
  return readFileSync(f, 'utf8').split('\n')
    .map(l => l.split('#')[0].trim().split(/\s+/))
    .filter(p => p.length >= 2 && want.has(p[0]))
    .map(p => p[1]);
}

async function main() {
  let names = positional.length ? positional
    : PRIORITY ? priorityList(PRIORITY)
    : listUkvnMappings().filter(n => existsSync(join(RAW, n)));
  names = names.filter(n => n !== 'osmain' && existsSync(join(RAW, n)));

  console.log(`pass ${PASS} · ${names.length} oversettelser` +
    (PASS === 'judge1' ? ` · ${JUDGE1}` : PASS === 'judge2' ? ` · ${JUDGE2}` : PASS === 'verdict' ? '' : ` · ${EMBED_MODEL}`) +
    ` · samtidighet ${CONC}\n`);

  const t0 = Date.now();
  let totV = 0, totC = 0, totS = 0;
  for (let i = 0; i < names.length; i++) {
    const tr = names[i];
    const r = await runPass(tr);
    totV += r.verses; totC += r.chapters; totS += r.skipped;
    if (PASS === 'prep') continue;
    const el = (Date.now() - t0) / 1000;
    const done = i + 1;
    console.log(
      `[${String(done).padStart(4)}/${names.length}] ${tr.padEnd(26)} ` +
      `${String(r.chapters).padStart(4)} kap ${String(r.verses).padStart(6)} vers` +
      (r.skipped ? `  (${r.skipped} uendret)` : '') +
      `   ${(totV / el).toFixed(1)} vers/s   gjenstår ~${(((names.length - done) / done) * el / 3600).toFixed(1)} t`
    );
  }
  console.log(`\n${totC} kapitler · ${totV} vers · ${totS} uendret · ${((Date.now() - t0) / 3600e3).toFixed(2)} t`);
}

await main();
