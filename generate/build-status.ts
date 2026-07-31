#!/usr/bin/env bun

/**
 * Genererer `STATUS.md` — hva som finnes, hva som gjenstår, og kommandoen som
 * gjør noe med det.
 *
 * To valg er verdt å forklare, for begge er tatt etter å ha gjort det motsatte:
 *
 * **Tallene genereres.** Håndskrevne dekningstall var feil samme dag de ble
 * skrevet — `docs/running-jobs.md` sa 911 av 1 189 kapitler mens tallet var
 * 1 178, og en issue-tittel sier 301 den dag i dag. Tall om tilstand hører
 * hjemme i kode, ikke i prosa.
 *
 * **Fila sjekkes inn.** Den som lurer på om det er noe å bidra med står på
 * github.com uten klone, uten bun og uten de 21 GB-ene med data. En kommando
 * er ikke et svar for hen; en fil i repoet er det.
 *
 * Derfor er den heller ikke gatet i testene slik `skript.md` er: statusen
 * endrer seg hver gang en jobb skriver en fil, og en `--check` ville vært rød
 * hele natta mens jobbene går. Den regenereres når du committer.
 *
 * Utdata er engelsk fordi det er bidragsyterens dokument, ikke vårt.
 *
 * Bruk:
 *   bun generate/build-status.ts            # skriv STATUS.md
 *   bun generate/build-status.ts --print    # skriv til skjerm i stedet
 */

import {readdirSync, readFileSync, writeFileSync, existsSync} from 'fs';
import {dirname, join} from 'path';
import {fileURLToPath} from 'url';

import {getBookName, languageNames} from './constants.js';
import {parseArgs, formatHelp, COMMON_FLAGS} from './cli.js';
import type {FlagSpec} from './cli.js';

const SPEC: Record<string, FlagSpec> = {
    print: {kind: 'boolean', help: 'skriv til skjerm i stedet for å oppdatere STATUS.md'},
    help: COMMON_FLAGS.help,
};

const GENERATE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(GENERATE, '..');

/** Oversettelsen alt tilleggsmateriale måles mot. */
const BASIS = 'osnb';

/** Oversettelsene dette prosjektet selv har laget. Resten er høstet inn. */
const VÅRE_OVERSETTELSER = ['osnb', 'osnn', 'osen', 'oses'];

/**
 * Katalogene som skrives på norsk og oversettes derfra.
 *
 * Leses fra disken — enhver katalog med en `nb/` under seg — framfor å
 * importere `CONTENT_DIRS` fra `translate.ts`. Det følger samme regel som
 * `build-script-docs.ts`: dokumentasjon skal ikke laste skript som gjør arbeid.
 * Bivirkningen er at en ny katalog kommer med av seg selv.
 */
function språkkataloger(): string[] {
    return readdirSync(GENERATE, {withFileTypes: true})
        .filter(e => e.isDirectory() && existsSync(join(GENERATE, e.name, 'nb')))
        .map(e => e.name)
        .sort();
}

// === Måling ===

/** Alle kapitler i basisoversettelsen, som `bokId-kapittelId`. */
function alleKapitler(): string[] {
    const rot = join(GENERATE, 'bibles_raw', BASIS);
    const ut: string[] = [];
    for (const bok of readdirSync(rot).filter(d => /^\d+$/.test(d))) {
        for (const fil of readdirSync(join(rot, bok))) {
            const kap = fil.replace(/\.json$/, '');
            if (/^\d+$/.test(kap)) ut.push(`${bok}-${kap}`);
        }
    }
    return ut.sort(sorterKapittel);
}

function sorterKapittel(a: string, b: string): number {
    const [ab, ak] = a.split('-').map(Number);
    const [bb, bk] = b.split('-').map(Number);
    return ab - bb || ak - bk;
}

/** Antall vers i basisoversettelsen. Kapittelfilene er arrayer av vers. */
function alleVers(): number {
    const rot = join(GENERATE, 'bibles_raw', BASIS);
    let n = 0;
    for (const bok of readdirSync(rot).filter(d => /^\d+$/.test(d)))
        for (const fil of readdirSync(join(rot, bok)).filter(f => f.endsWith('.json')))
            n += (JSON.parse(readFileSync(join(rot, bok, fil), 'utf-8')) as unknown[]).length;
    return n;
}

/**
 * Kapitlene en katalog dekker.
 *
 * De to utformingene finnes side om side i `generate/` og er ikke verdt å
 * rette opp i nå — men de må kjennes her, ellers teller vi null.
 */
type Utforming = 'bok-kapittel' | 'bok/kapittel';

function dekkedeKapitler(dir: string, utforming: Utforming, ext = '.json'): Set<string> {
    const abs = join(GENERATE, dir);
    const ut = new Set<string>();
    if (!existsSync(abs)) return ut;

    if (utforming === 'bok-kapittel') {
        for (const f of readdirSync(abs)) {
            const m = f.match(/^(\d+)-(\d+)\./);
            if (m && f.endsWith(ext)) ut.add(`${m[1]}-${m[2]}`);
        }
        return ut;
    }

    for (const bok of readdirSync(abs).filter(d => /^\d+$/.test(d))) {
        for (const f of readdirSync(join(abs, bok))) {
            const kap = f.replace(new RegExp(`\\${ext}$`), '');
            if (/^\d+$/.test(kap)) ut.add(`${bok}-${kap}`);
        }
    }
    return ut;
}

/** Alle filer med endelsen, hvor dypt de enn ligger. Tom endelse = alle. */
function tellFiler(dir: string, ext = '.json'): number {
    const abs = join(GENERATE, dir);
    if (!existsSync(abs)) return 0;
    let n = 0;
    const gå = (p: string) => {
        for (const e of readdirSync(p, {withFileTypes: true})) {
            if (e.isDirectory()) gå(join(p, e.name));
            else if (e.name.endsWith(ext)) n++;
        }
    };
    gå(abs);
    return n;
}

function tellBøker(dir: string, ext: string): number {
    const abs = join(GENERATE, dir);
    if (!existsSync(abs)) return 0;
    return readdirSync(abs).filter(f => /^\d+\./.test(f) && f.endsWith(ext)).length;
}

/** «Ps 5», «Matt 11» — kapittelnøkkelen som et menneske leser. */
function kapittelNavn(nøkkel: string): string {
    const [bok, kap] = nøkkel.split('-');
    return `${getBookName(Number(bok), 'en')} ${kap}`;
}

// === Hva vi rapporterer ===

type Motor = 'local model' | 'Claude (costs money)' | 'no script yet';

interface Post {
    /** Overskriften, slik en bidragsyter ville spurt etter tingen. */
    tittel: string;
    /** Hva det ER, og hvorfor noen bryr seg. To–tre setninger, ikke flere. */
    hva: string;
    /** Måling: hvor mange finnes, av hvor mange mulige. */
    mål: () => {har: number; av?: number; mangler?: string[]};
    enhet: string;
    motor: Motor;
    /** Kommandoen som gjør noe med det som gjenstår. */
    kommando?: string[];
    /** Ting som er lett å gå på en smell med. Én setning. */
    merk?: string;
    issue?: string;
}

function poster(): Post[] {
    const kapitler = alleKapitler();
    const antallKapitler = kapitler.length;
    const antallVers = alleVers();

    const mangler = (dekket: Set<string>) => kapitler.filter(k => !dekket.has(k));
    // `har` telles som snittet mot kapitlene som finnes, ikke som antall filer.
    // Ellers kan en katalog ha 1 189 filer, mangle Joel 4, og rapportere «ferdig»
    // — det skjedde med kapittelsammendragene.
    const kapittelMål = (dir: string, utforming: Utforming, ext = '.json') => () => {
        const dekket = dekkedeKapitler(dir, utforming, ext);
        const savnet = mangler(dekket);
        return {har: antallKapitler - savnet.length, av: antallKapitler, mangler: savnet.map(kapittelNavn)};
    };

    return [
        {
            tittel: 'The Bible texts',
            hva: 'The translations themselves, one JSON document per chapter. This is what '
                + 'most people come here for, and all four are complete.',
            mål: () => {
                const rot = join(GENERATE, 'bibles_raw');
                const våre = VÅRE_OVERSETTELSER.filter(t => existsSync(join(rot, t)));
                return {har: våre.length, av: VÅRE_OVERSETTELSER.length};
            },
            enhet: 'complete translations',
            motor: 'Claude (costs money)',
            merk: 'Making a new one is a project of its own: see `docs/new-translation.md`. '
                + 'Around $250 and several weeks.',
        },
        {
            tittel: 'Cross references',
            hva: 'Which other verses a verse connects to, and one sentence on why. This is '
                + 'the largest single job left in the repository.',
            mål: () => ({har: tellFiler('references/nb'), av: antallVers}),
            enhet: 'verses',
            motor: 'local model',
            kommando: ['bun generate/references.ts --local --book 10-19'],
            merk: 'Without `--local` this goes to Claude and costs money.',
            issue: '#31',
        },
        {
            tittel: 'Word-for-word',
            hva: 'Every Hebrew and Greek word with transliteration, grammar and gloss — what '
                + 'lets a reader check the translation against the source themselves.',
            mål: () => ({har: tellFiler('word4word/tanach') + tellFiler('word4word/sblgnt'), av: antallVers}),
            enhet: 'verses',
            motor: 'Claude (costs money)',
            kommando: ['bun generate/word4word.ts tanach --ot', 'bun generate/word4word.ts sblgnt --nt'],
            merk: 'Only `tanach` and `sblgnt` are correct sources here; older output from other '
                + 'translations was wrong and was deleted.',
        },
        {
            tittel: 'Key words per chapter',
            hva: 'The words a reader needs explained — «grace», «covenant», «Son of Man» — '
                + 'with a sentence on each. Shown beside the chapter text.',
            mål: kapittelMål('important_words/nb', 'bok-kapittel'),
            enhet: 'chapters',
            motor: 'local model',
            kommando: [
                'bun generate/important-words-chapter.ts --local',
                'bun generate/important-words-chapter.ts --local --book 40 --chapter 17   # one chapter',
            ],
            merk: 'A chapter that fails is skipped without stopping the run, so the list of '
                + 'missing chapters above is the only way to know you are done.',
            issue: '#34',
        },
        {
            tittel: 'Day mentions',
            hva: 'Verses that mention a day or a feast — Passover, Sabbath, Tabernacles — with '
                + 'the quote and the Hebrew or Greek term. The basis for showing «today is '
                + 'named in these verses».',
            mål: kapittelMål('days_mentions/osnb', 'bok/kapittel'),
            enhet: 'chapters',
            motor: 'local model',
            kommando: ['bun generate/days-mentions.ts --bible osnb --book 40-66'],
            merk: 'Pass 1 writes free-text names. Pass 2, which ties them to the day definitions, '
                + 'does not exist yet — worth writing before the rest is scanned.',
            issue: '#33',
        },
        {
            tittel: 'Chapter summaries',
            hva: 'One paragraph on what happens in the chapter. Written in Norwegian; other '
                + 'languages get them by translation, not by generating again.',
            mål: kapittelMål('chapter_summaries/nb', 'bok-kapittel', '.md'),
            enhet: 'chapters',
            motor: 'local model',
            kommando: ['bun generate/chapter-summary.ts --local --book 29 --chapter 4'],
        },
        {
            tittel: 'Chapter context',
            hva: 'Historical, literary and theological background for the chapter.',
            mål: kapittelMål('chapter_context/nb', 'bok-kapittel', '.md'),
            enhet: 'chapters',
            motor: 'local model',
            kommando: ['bun generate/chapter-context.ts --local --book 29 --chapter 4'],
        },
        {
            tittel: 'Book summaries and book context',
            hva: 'The same for each of the 66 books: what it is about, who wrote it, when, '
                + 'and to whom.',
            mål: () => ({har: tellBøker('book_summaries/nb', '.md') + tellBøker('book_context/nb', '.md'), av: 132}),
            enhet: 'documents',
            motor: 'local model',
            kommando: ['bun generate/book-summary.ts --local', 'bun generate/book-context.ts --local'],
        },
        {
            tittel: 'Translation notes per verse',
            hva: 'Why this particular wording was chosen for this particular verse. Barely '
                + 'started — one book exists.',
            mål: () => ({har: tellFiler(`verse_translation/${BASIS}`), av: antallVers}),
            enhet: 'verses',
            motor: 'Claude (costs money)',
            kommando: ['bun generate/verse-translation.ts osnb --book 1'],
        },
        {
            tittel: 'People',
            hva: 'An encyclopedia of the people in the Bible, with family links and the verses '
                + 'they appear in.',
            mål: () => ({har: tellFiler('persons/nb')}),
            enhet: 'people',
            motor: 'Claude (costs money)',
            merk: 'The profiles are written by Claude — local models are not good enough for this '
                + 'kind of prose (#12).',
        },
        {
            tittel: 'Song references',
            hva: 'Which verses a hymn or song is built on. The corpus is 6,076 songs, and this '
                + 'is the largest job that fits on an ordinary machine.',
            mål: () => ({har: tellFiler('songs'), av: 6076}),
            enhet: 'songs',
            motor: 'local model',
            kommando: ['bun generate/song-references.ts'],
            merk: 'The song corpus lives in `external/` and is not part of the repository — ask '
                + 'before starting this one.',
            issue: '#8',
        },
        {
            tittel: 'Stories',
            hva: 'The narrative units of the Bible, named and summarised, across chapter '
                + 'boundaries.',
            mål: () => ({har: tellFiler('stories/nb')}),
            enhet: 'stories',
            motor: 'local model',
            kommando: ['bun generate/scan-stories.ts --local', 'bun generate/stories.ts --local'],
        },
        {
            tittel: 'Section headings',
            hva: 'Headings inside the chapters. The script exists but has never been run — the '
                + 'output directory is not there.',
            mål: () => ({har: tellFiler('headings'), av: antallKapitler}),
            enhet: 'chapters',
            motor: 'local model',
            kommando: ['bun generate/headings.ts'],
            issue: '#36',
        },
        {
            tittel: 'Chapter insights, verse prayer, verse sermon',
            hva: 'Files exist, but none of these has a generator script in the repository. They '
                + 'cannot be filled in for a new chapter or a new language.',
            mål: () => ({
                har: tellFiler('chapter_insights/nb', '')
                    + tellFiler('verse_prayer/nb', '')
                    + tellFiler('verse_sermon/nb', ''),
            }),
            enhet: 'files',
            motor: 'no script yet',
            issue: '#39',
        },
    ];
}

/** Oversettelsen av tilleggsmaterialet til andre språk, målt mot norsk. */
function språkstatus(): Array<{språk: string; har: number; av: number}> {
    const kataloger = språkkataloger();
    const tell = (lang: string) => kataloger.reduce((n, d) => n + tellFiler(`${d}/${lang}`, ''), 0);

    // …men bare hvis navnet er et språk. `gospel_parallels/temp_verify` er en
    // arbeidskatalog, ikke spansk.
    const språk = new Set<string>();
    for (const d of kataloger) {
        const abs = join(GENERATE, d);
        if (!existsSync(abs)) continue;
        for (const e of readdirSync(abs, {withFileTypes: true}))
            if (e.isDirectory() && e.name !== 'nb' && languageNames[e.name]) språk.add(e.name);
    }

    const nb = tell('nb');
    return [...språk].sort().map(s => ({språk: s, har: tell(s), av: nb}));
}

// === Utskrift ===

function tall(n: number): string {
    return n.toLocaleString('en-GB');
}

function bygg(): string {
    const alle = poster();
    const målinger = alle.map(p => ({post: p, m: p.mål()}));

    const ut: string[] = [
        '# What exists, and what is missing',
        '',
        '> Generated by `generate/build-status.ts`. **Do not edit by hand** — these numbers',
        '> were maintained by hand once, and were wrong the same day they were written.',
        '',
        `Measured against \`${BASIS}\`, the Norwegian bokmål translation everything else is`,
        'keyed to. A snapshot: jobs add files while they run, so run',
        '`bun generate/build-status.ts` for current numbers before planning anything.',
        '',
        'If you want to help with any of this — including how to avoid doing the same work',
        'as someone else — see [CONTRIBUTING.md](CONTRIBUTING.md).',
        '',
        '| what | coverage | missing | runs on |',
        '|---|---|---|---|',
    ];

    for (const {post, m} of målinger) {
        const dekning = m.av ? `${tall(m.har)} / ${tall(m.av)}` : tall(m.har);
        const igjen = m.av
            ? (m.av - m.har > 0 ? `**${tall(m.av - m.har)}** ${post.enhet}` : 'complete')
            : '—';
        ut.push(`| [${post.tittel}](#${anker(post.tittel)}) | ${dekning} ${post.enhet} | ${igjen} | ${post.motor} |`);
    }

    const språk = språkstatus();
    if (språk.length) {
        ut.push('', '## Supporting material in other languages', '',
            'Content *about* the text is written in Norwegian and translated from there — it is',
            'not generated again per language, so that the same material says the same thing in',
            'every language. Counted as files relative to Norwegian.', '');
        ut.push('| language | files | missing |', '|---|---|---|');
        for (const s of språk)
            ut.push(`| ${languageNames[s.språk] ?? s.språk} (\`${s.språk}\`) | ${tall(s.har)} / ${tall(s.av)} | ${tall(Math.max(0, s.av - s.har))} |`);

        const størst = [...språk].sort((a, b) => (b.av - b.har) - (a.av - a.har))[0]!;
        ut.push('', 'Runs on a local model, so it costs nothing but time:', '',
            '```',
            `bun generate/translate.ts --language ${størst.språk} --status`,
            `bun generate/translate.ts --language ${størst.språk}`,
            '```');
    }

    for (const {post, m} of målinger) {
        const ferdig = m.av !== undefined && m.har >= m.av;
        ut.push('', `## ${post.tittel}`, '', post.hva, '');

        ut.push(m.av
            ? `**${tall(m.har)} of ${tall(m.av)} ${post.enhet}.**${ferdig ? ' Complete.' : ''}`
            : `**${tall(m.har)} ${post.enhet}.**`);

        if (m.mangler?.length && m.mangler.length <= 40) {
            ut.push('', `Missing: ${m.mangler.join(', ')}`);
        } else if (m.mangler?.length) {
            ut.push('', `Missing ${tall(m.mangler.length)} chapters, from ${m.mangler[0]} onwards.`);
        }

        if (post.kommando?.length && !ferdig) {
            ut.push('', '```', ...post.kommando, '```');
        }
        if (post.merk) ut.push('', post.merk);
        if (post.issue) ut.push('', `Issue: ${post.issue}`);
    }

    ut.push('', '---', '',
        'Which machine and which model a job needs is in',
        '[docs/running-jobs.md](docs/running-jobs.md). The flags every script takes are in',
        '[docs/skript.md](docs/skript.md), generated from the source.', '');

    return ut.join('\n');
}

/** GitHub-anker for en overskrift: små bokstaver, mellomrom til bindestrek. */
function anker(tittel: string): string {
    return tittel.toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-');
}

function main(): void {
    const {flags} = parseArgs(process.argv.slice(2), SPEC);
    if (flags.help) {
        console.log(formatHelp('generate/build-status.ts',
            'måler hva som finnes under generate/ og skriver STATUS.md',
            SPEC,
            ['bun generate/build-status.ts', 'bun generate/build-status.ts --print']));
        return;
    }

    const innhold = bygg() + '\n';
    if (flags.print) {
        console.log(innhold);
        return;
    }
    writeFileSync(join(ROOT, 'STATUS.md'), innhold);
    console.log('STATUS.md oppdatert.');
}

if (import.meta.main) {
    main();
}
