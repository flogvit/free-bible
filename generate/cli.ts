/**
 * Felles flaggkontrakt for skriptene under generate/ (#51, #52, #53).
 *
 * Før denne fantes rullet hvert skript sin egen `parseArgs`, og de hadde
 * drevet fra hverandre på tre måter som alle er stille i drift:
 *
 *   1. `--local` og `--remote` uttrykte SAMME akse med motsatt fortegn.
 *      Elleve skript brukte `--local`, tre `--remote`, og `scan-stories`
 *      godtok begge. Glemmer du flagget, kjører jobben på feil modell — og
 *      valget havner ikke i dataene, så feilen kan ikke finnes i ettertid.
 *      Det er samme feilform som en glemt `--style` i bible.ts.
 *   2. Samme begrep, ulikt navn: `--lang`/`--language`, `--dry`/`--dry-run`,
 *      `--bible`/`--source`/posisjonsargument, `--n`/`--limit`.
 *   3. Ukjente flagg ble stille ignorert, og et felt som ble tilordnet uten
 *      å stå i initialiseringen (`options.local = true`) fantes bare hvis
 *      brukeren tilfeldigvis sendte flagget.
 *
 * Kontrakten her løser alle tre: ett navn per begrep, ukjente flagg feiler
 * høyt, og standardverdien står i hjelpeteksten fordi det er den som er
 * usynlig.
 */

/**
 * `number` er heltall (`parseInt`). Bruk `float` for desimaltall.
 *
 * Skillet er ikke pedanteri: `parseInt('0.60')` gir `0`, som er falsy. En
 * terskel på 0.60 ville blitt til «ingen terskel» uten at noe klaget.
 */
export type FlagKind = 'boolean' | 'string' | 'number' | 'float' | 'range';

export interface FlagSpec {
    kind: FlagKind;
    /** Vises i --help. Skriv hva flagget gjør, ikke hva det heter. */
    help: string;
    /** Standardverdien SKAL med når den ikke er `false`/`undefined`. */
    default?: string | number | boolean;
    /** Gammelt navn som fortsatt godtas, men som advarer. */
    aliasOf?: string;
}

/** Et intervall, fra `--book 1-5` eller `--book 3`. */
export interface Range {
    start: number;
    end: number;
}

/**
 * Flaggene som betyr det samme i alle skript. Et skript legger til sine egne
 * i tillegg, men skal aldri gi disse en annen betydning.
 */
export const COMMON_FLAGS: Record<string, FlagSpec> = {
    bible: {kind: 'string', help: 'hvilken oversettelse, f.eks. osnb'},
    language: {kind: 'string', help: 'språkkode, f.eks. nb', default: 'nb'},
    book: {kind: 'range', help: 'bok eller bokintervall, f.eks. 1 eller 1-5'},
    chapter: {kind: 'range', help: 'kapittel eller kapittelintervall'},
    verse: {kind: 'range', help: 'vers eller versintervall'},
    ot: {kind: 'boolean', help: 'bare Det gamle testamentet'},
    nt: {kind: 'boolean', help: 'bare Det nye testamentet'},
    limit: {kind: 'number', help: 'stopp etter N enheter'},
    force: {kind: 'boolean', help: 'kjør på nytt selv om resultatet finnes'},
    local: {kind: 'boolean', help: 'kjør mot lokal Ollama i stedet for Claude'},
    'dry-run': {kind: 'boolean', help: 'vis hva som ville skjedd, uten å skrive'},
    help: {kind: 'boolean', help: 'vis denne teksten'},
};

/**
 * Gamle navn som fortsatt godtas. De advarer i stedet for å feile, slik at en
 * kjørende kø ikke stopper — men de skal bort.
 */
export const LEGACY_ALIASES: Record<string, string> = {
    lang: 'language',
    dry: 'dry-run',
    source: 'bible',
    n: 'limit',
    // «AI» er feil på begge ledd. Det er en språkmodell, og det er det den
    // heter i dette prosjektet.
    'use-ai': 'use-llm',
    // `--remote` var motsatt fortegn av `--local`. Den kan ikke oversettes
    // mekanisk, så den avvises med en forklaring framfor å bli gjettet på.
};

export interface ParsedArgs {
    flags: Record<string, string | number | boolean | Range | undefined>;
    /** Argumenter uten `--`, i rekkefølge. */
    positional: string[];
}

function parseRange(value: string, flag: string): Range {
    if (value.includes('-')) {
        const [rawStart, rawEnd] = value.split('-');
        const start = parseInt(rawStart, 10);
        const end = parseInt(rawEnd, 10);
        if (Number.isNaN(start) || Number.isNaN(end)) {
            throw new Error(`--${flag}: «${value}» er ikke et gyldig intervall (f.eks. 1-5)`);
        }
        return {start, end};
    }
    const num = parseInt(value, 10);
    if (Number.isNaN(num)) throw new Error(`--${flag}: «${value}» er ikke et tall`);
    return {start: num, end: num};
}

/**
 * Parser argumenter mot en spesifikasjon.
 *
 * Kaster på ukjent flagg. Det er med vilje: den forrige oppførselen — stille
 * ignorering — betyr at en skrivefeil i et køskript gir en jobb som kjører
 * med feil innstilling uten å si fra.
 */
export function parseArgs(argv: string[], spec: Record<string, FlagSpec>): ParsedArgs {
    const flags: ParsedArgs['flags'] = {};
    const positional: string[] = [];

    for (const [name, s] of Object.entries(spec)) {
        if (s.default !== undefined) flags[name] = s.default;
        else if (s.kind === 'boolean') flags[name] = false;
    }

    let i = 0;
    while (i < argv.length) {
        const arg = argv[i];

        if (!arg.startsWith('--')) {
            positional.push(arg);
            i++;
            continue;
        }

        let name = arg.slice(2);

        // `--no-<flagg>` slår AV et boolsk flagg som står på som standard.
        //
        // Uten denne var kontrakten for stiv: et skript der `local` er
        // standarden hadde ingen måte å velge Claude-veien på, siden `--local`
        // da er en no-op. Det gjaldt `scan-stories`, der `--remote` var eneste
        // vei til Claude — og å innføre et nytt motsatt flagg ville gjenskapt
        // nettopp toveisaksen kontrakten avskaffer.
        if (name.startsWith('no-')) {
            const target = name.slice(3);
            const ts = spec[target];
            if (ts?.kind === 'boolean') {
                flags[target] = false;
                i++;
                continue;
            }
        }

        if (name === 'remote') {
            throw new Error(
                '--remote er fjernet. Aksen heter --local: uten flagget kjøres jobben ' +
                'mot Claude, med flagget mot lokal Ollama. --remote betydde det ' +
                'motsatte av --local i de skriptene som hadde det, så den kan ikke ' +
                'oversettes mekanisk — se #51.',
            );
        }

        if (LEGACY_ALIASES[name]) {
            const canonical = LEGACY_ALIASES[name];
            console.warn(`advarsel: --${name} heter nå --${canonical} (#52)`);
            name = canonical;
        }

        const s = spec[name];
        if (!s) {
            const known = Object.keys(spec).sort().map(f => `--${f}`).join(' ');
            throw new Error(`ukjent flagg --${name}\nkjente flagg: ${known}`);
        }

        if (s.kind === 'boolean') {
            flags[name] = true;
            i++;
            continue;
        }

        if (s.kind === 'float') {
            const value = argv[i + 1];
            if (value === undefined || value.startsWith('--')) {
                throw new Error(`--${name} mangler verdi`);
            }
            const n = parseFloat(value);
            if (Number.isNaN(n)) throw new Error(`--${name}: «${value}» er ikke et tall`);
            flags[name] = n;
            i += 2;
            continue;
        }

        const value = argv[i + 1];
        if (value === undefined || value.startsWith('--')) {
            throw new Error(`--${name} mangler verdi`);
        }

        if (s.kind === 'number') {
            const n = parseInt(value, 10);
            if (Number.isNaN(n)) throw new Error(`--${name}: «${value}» er ikke et tall`);
            flags[name] = n;
        } else if (s.kind === 'range') {
            flags[name] = parseRange(value, name);
        } else {
            flags[name] = value;
        }
        i += 2;
    }

    return {flags, positional};
}

/**
 * Bygger hjelpeteksten fra spesifikasjonen, med standardverdiene synlige.
 *
 * Standardverdien er hele poenget: den er det eneste som ikke kan leses ut av
 * kommandolinja i ettertid.
 */
export function formatHelp(
    script: string,
    purpose: string,
    spec: Record<string, FlagSpec>,
    examples: string[] = [],
): string {
    const width = Math.max(...Object.keys(spec).map(f => f.length)) + 2;
    const lines = Object.entries(spec).map(([name, s]) => {
        const shown = s.default !== undefined && s.default !== false
            ? `${s.help} (standard: ${s.default})`
            : s.help;
        // Står et boolsk flagg PÅ som standard, er det `--no-<flagg>` brukeren
        // trenger — å vise `--<flagg>` ville vært å dokumentere en no-op.
        const shownName = s.kind === 'boolean' && s.default === true ? `no-${name}` : name;
        return `  --${shownName.padEnd(width)} ${shown}`;
    });
    const parts = [
        `${script} — ${purpose}`,
        '',
        `Bruk: bun ${script} [flagg]`,
        '',
        'Flagg:',
        ...lines,
    ];
    if (examples.length) parts.push('', 'Eksempler:', ...examples.map(e => `  ${e}`));
    return parts.join('\n');
}
