import * as fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// === Easter calculation (Anonymous Gregorian algorithm) ===
function easterDate(year) {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(year, month - 1, day);
}

function addDays(date, days) {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
}

function formatDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

// Find the Sunday closest to a given date
function nearestSunday(date) {
    const day = date.getDay(); // 0=Sun
    if (day === 0) return new Date(date);
    if (day <= 3) return addDays(date, -day);
    return addDays(date, 7 - day);
}

// Find first Sunday on or after a given date
function sundayOnOrAfter(date) {
    const day = date.getDay();
    if (day === 0) return new Date(date);
    return addDays(date, 7 - day);
}

// Find last Sunday before a given date
function sundayBefore(date) {
    const day = date.getDay();
    if (day === 0) return addDays(date, -7);
    return addDays(date, -day);
}

// Fixed date, returns same date every year
function fixed(month, day) {
    return (year) => new Date(year, month - 1, day);
}

// Relative to Easter
function fromEaster(offset) {
    return (year) => addDays(easterDate(year), offset);
}

// 1. søndag i advent = nearest Sunday to Nov 30, but specifically:
// the Sunday that falls between Nov 27 and Dec 3 inclusive
function advent1(year) {
    const nov27 = new Date(year, 10, 27);
    return sundayOnOrAfter(nov27);
}

function adventSunday(n) {
    return (year) => addDays(advent1(year), (n - 1) * 7);
}

// Kristi åpenbaringsdag: first Sunday after Jan 1 (but at least Jan 2),
// or Jan 6 in some traditions. In DNK it's the first Sunday in the new year.
// Looking at data: 2026: Jan 4, 2027: Jan 3, 2028: Jan 2
// It's the first Sunday on or after Jan 2.
function kristiAapenbaringsdag(year) {
    const jan2 = new Date(year, 0, 2);
    return sundayOnOrAfter(jan2);
}

// Maria budskapsdag: the Sunday before Palm Sunday (5th Sunday in Lent)
// From data: always Palm Sunday - 7
function mariaBudskapsdag(year) {
    return addDays(easterDate(year), -14);
}

// Mikkelsmesse: Sep 29 (fixed)
// Allehelgensdag: first Sunday in November
function allehelgensdag(year) {
    const nov1 = new Date(year, 10, 1);
    return sundayOnOrAfter(nov1);
}

// Domssøndag: last Sunday before Advent 1
function domssoendag(year) {
    return addDays(advent1(year), -7);
}

// Bots- og bønnedag: last Friday before Allehelgensdag
function botsOgBoennedag(year) {
    const ah = allehelgensdag(year);
    return addDays(ah, -2); // Friday before Sunday
}

// Sankthansdagen: Jun 24 (fixed, birth of John the Baptist)

// Kyndelsmesse: Feb 2 (fixed, Presentation of Jesus)

// Kristi forklarelsesdag: last Sunday before Lent (before Fastelavnssøndag)
// Actually from data it's the Sunday before Fastelavnssøndag
// 2026: Feb 8 (Fastelavn Feb 15, Easter Apr 5) -> Easter - 56
// 2027: Jan 31 (Fastelavn Feb 7, Easter Mar 28) -> Easter - 56
// So it's Easter - 56
function kristiForklarelsesdag(year) {
    return addDays(easterDate(year), -56);
}

// Såmannssøndag: the Sunday before Kristi forklarelsesdag
// 2026: Feb 1 (Kristi forkl. Feb 8) -> Easter - 63
// 2027: Jan 24 (Kristi forkl. Jan 31) -> Easter - 63
function samannssoendag(year) {
    return addDays(easterDate(year), -63);
}

// Vingårdssøndag: 14th Sunday after Trinity
function vingaardssoendag(year) {
    return addDays(easterDate(year), 56 + 13 * 7); // Trinity + 13 weeks
}

// === Jewish holidays (hardcoded Gregorian dates 2025-2035) ===
// Source: Wikipedia (2025-2028) and hebcal.com (2029-2035).
// Dates represent the first full calendar day of each holiday.

const jewishDates = {
    pesach: {
        2025: '2025-04-13', 2026: '2026-04-02', 2027: '2027-04-22',
        2028: '2028-04-11', 2029: '2029-03-31', 2030: '2030-04-18',
        2031: '2031-04-08', 2032: '2032-03-27', 2033: '2033-04-14',
        2034: '2034-04-04', 2035: '2035-04-24'
    },
    shavuot: {
        2025: '2025-06-02', 2026: '2026-05-22', 2027: '2027-06-11',
        2028: '2028-05-31', 2029: '2029-05-20', 2030: '2030-06-07',
        2031: '2031-05-28', 2032: '2032-05-16', 2033: '2033-06-03',
        2034: '2034-05-24', 2035: '2035-06-13'
    },
    rosh_hashana: {
        2025: '2025-09-23', 2026: '2026-09-12', 2027: '2027-10-02',
        2028: '2028-09-21', 2029: '2029-09-10', 2030: '2030-09-28',
        2031: '2031-09-18', 2032: '2032-09-06', 2033: '2033-09-24',
        2034: '2034-09-14', 2035: '2035-10-04'
    },
    yom_kippur: {
        2025: '2025-10-02', 2026: '2026-09-21', 2027: '2027-10-11',
        2028: '2028-09-30', 2029: '2029-09-19', 2030: '2030-10-07',
        2031: '2031-09-27', 2032: '2032-09-15', 2033: '2033-10-03',
        2034: '2034-09-23', 2035: '2035-10-13'
    },
    sukkot: {
        2025: '2025-10-07', 2026: '2026-09-26', 2027: '2027-10-16',
        2028: '2028-10-05', 2029: '2029-09-24', 2030: '2030-10-12',
        2031: '2031-10-02', 2032: '2032-09-20', 2033: '2033-10-08',
        2034: '2034-09-28', 2035: '2035-10-18'
    },
    purim: {
        2025: '2025-03-14', 2026: '2026-03-03', 2027: '2027-03-23',
        2028: '2028-03-12', 2029: '2029-03-01', 2030: '2030-03-19',
        2031: '2031-03-09', 2032: '2032-02-26', 2033: '2033-03-15',
        2034: '2034-03-05', 2035: '2035-03-25'
    },
    hanukkah: {
        2025: '2025-12-15', 2026: '2026-12-05', 2027: '2027-12-25',
        2028: '2028-12-13', 2029: '2029-12-02', 2030: '2030-12-21',
        2031: '2031-12-10', 2032: '2032-11-28', 2033: '2033-12-17',
        2034: '2034-12-07', 2035: '2035-12-26'
    }
};

// === Day definitions ===

const YEARS = [2025, 2026, 2027, 2028, 2029, 2030, 2031, 2032, 2033, 2034, 2035];

function computeDates(calcFn) {
    const dates = {};
    for (const year of YEARS) {
        dates[year] = formatDate(calcFn(year));
    }
    return dates;
}

function jewishHolidayDates(key) {
    const raw = jewishDates[key];
    const dates = {};
    for (const year of YEARS) {
        if (raw[year]) dates[year] = raw[year];
    }
    return dates;
}

const days = [
    // === ADVENT ===
    {
        id: 'advent-1',
        name: '1. søndag i adventstiden',
        description: 'Forventningen om Messias. Forberedelse til Jesu komme.',
        category: 'advent',
        dates: computeDates(adventSunday(1))
    },
    {
        id: 'advent-2',
        name: '2. søndag i adventstiden',
        description: 'Forløperen Johannes døperen og forberedelsen av veien for Herren.',
        category: 'advent',
        dates: computeDates(adventSunday(2))
    },
    {
        id: 'advent-3',
        name: '3. søndag i adventstiden',
        description: 'Gleden over Herrens komme. Johannes\' vitnesbyrd om Jesus.',
        category: 'advent',
        dates: computeDates(adventSunday(3))
    },
    {
        id: 'advent-4',
        name: '4. søndag i adventstiden',
        description: 'Maria og budskapet om Jesu fødsel. Den siste forberedelsen.',
        category: 'advent',
        dates: computeDates(adventSunday(4))
    },

    // === JUL ===
    {
        id: 'julaften',
        name: 'Julaften',
        description: 'Kvelden da vi feirer Jesu fødsel i Betlehem.',
        category: 'christmas',
        dates: computeDates(fixed(12, 24))
    },
    {
        id: 'juledag',
        name: 'Juledag',
        description: 'Feiringen av Jesu fødsel. Ordet ble kjød og tok bolig iblant oss.',
        category: 'christmas',
        dates: computeDates(fixed(12, 25))
    },
    {
        id: 'stefanusdag',
        name: 'Stefanusdag',
        description: 'Minnet om Stefanus, den første kristne martyren, steinet for sin tro.',
        category: 'christmas',
        dates: computeDates(fixed(12, 26))
    },
    {
        id: 'nyttaarsdag',
        name: 'Nyttårsdag / Jesu navnedag',
        description: 'Jesu omskjæring og navngiving åtte dager etter fødselen.',
        category: 'christmas',
        dates: computeDates(fixed(1, 1))
    },

    // === ÅPENBARING ===
    {
        id: 'kristi-aapenbaringsdag',
        name: 'Kristi åpenbaringsdag',
        description: 'Vismennene fra Østen tilber Jesusbarnet. Jesus åpenbares for folkeslagene.',
        category: 'epiphany',
        dates: computeDates(kristiAapenbaringsdag)
    },
    {
        id: 'kyndelsmesse',
        name: 'Kyndelsmesse',
        description: 'Jesus bæres frem i tempelet. Simeon og Hanna profeterer om barnet.',
        category: 'epiphany',
        dates: computeDates(fixed(2, 2))
    },
    {
        id: 'samannssoendag',
        name: 'Såmannssøndag',
        description: 'Lignelsen om såmannen. Guds ord som sås i ulik jordsmonn.',
        category: 'epiphany',
        dates: computeDates(samannssoendag)
    },
    {
        id: 'kristi-forklarelsesdag',
        name: 'Kristi forklarelsesdag',
        description: 'Jesus forklares på fjellet. Moses og Elia viser seg med ham.',
        category: 'epiphany',
        dates: computeDates(kristiForklarelsesdag)
    },

    // === FASTE ===
    {
        id: 'fastelavnssoendag',
        name: 'Fastelavnssøndag',
        description: 'Siste søndag før fastetiden. Overgang til bot og forberedelse.',
        category: 'lent',
        dates: computeDates(fromEaster(-49))
    },
    {
        id: 'askeonsdag',
        name: 'Askeonsdag',
        description: 'Fastetiden begynner. Kall til omvendelse, bot og selvransakelse.',
        category: 'lent',
        dates: computeDates(fromEaster(-46))
    },
    {
        id: 'faste-1',
        name: '1. søndag i fastetiden',
        description: 'Jesus fristes i ørkenen i 40 dager. Kampen mot fristelse.',
        category: 'lent',
        dates: computeDates(fromEaster(-42))
    },
    {
        id: 'faste-2',
        name: '2. søndag i fastetiden',
        description: 'Troens kamp og bønnens kraft i møte med motstand.',
        category: 'lent',
        dates: computeDates(fromEaster(-35))
    },
    {
        id: 'faste-3',
        name: '3. søndag i fastetiden',
        description: 'Kampen mellom lys og mørke. Jesu makt over det onde.',
        category: 'lent',
        dates: computeDates(fromEaster(-28))
    },
    {
        id: 'faste-4',
        name: '4. søndag i fastetiden',
        description: 'Brødet fra himmelen. Gud metter og gir liv.',
        category: 'lent',
        dates: computeDates(fromEaster(-21))
    },
    {
        id: 'maria-budskapsdag',
        name: 'Maria budskapsdag',
        description: 'Engelen Gabriel bringer bud til Maria om at hun skal føde Guds sønn.',
        category: 'lent',
        dates: computeDates(mariaBudskapsdag)
    },

    // === DEN STILLE UKE / PÅSKE ===
    {
        id: 'palmesoendag',
        name: 'Palmesøndag',
        description: 'Jesu inntog i Jerusalem. Folkemengden hyller ham med palmegrener.',
        category: 'easter',
        dates: computeDates(fromEaster(-7))
    },
    {
        id: 'skjaertorsdag',
        name: 'Skjærtorsdag',
        description: 'Det siste måltidet. Jesus innstifter nattverden og vasker disiplenes føtter.',
        category: 'easter',
        dates: computeDates(fromEaster(-3))
    },
    {
        id: 'langfredag',
        name: 'Langfredag',
        description: 'Jesus korsfestes og dør på Golgata. Soningsofferet for verdens synd.',
        category: 'easter',
        dates: computeDates(fromEaster(-2))
    },
    {
        id: 'paaskenatt',
        name: 'Påskenatt',
        description: 'Natten da Jesus oppstår fra graven. Overgangen fra mørke til lys.',
        category: 'easter',
        dates: computeDates(fromEaster(-1))
    },
    {
        id: 'paaskedag',
        name: 'Påskedag',
        description: 'Jesus er oppstått! Den tomme graven og oppstandelsens morgen.',
        category: 'easter',
        dates: computeDates(fromEaster(0))
    },
    {
        id: 'andre-paaskedag',
        name: '2. påskedag',
        description: 'Emmausvandrerne møter den oppstandne Jesus på veien.',
        category: 'easter',
        dates: computeDates(fromEaster(1))
    },

    // === PÅSKETIDEN ===
    {
        id: 'paasketiden-2',
        name: '2. søndag i påsketiden',
        description: 'Tvileren Tomas møter den oppstandne. Troens gave.',
        category: 'easter',
        dates: computeDates(fromEaster(7))
    },
    {
        id: 'paasketiden-3',
        name: '3. søndag i påsketiden',
        description: 'Den oppstandne Jesus åpenbarer seg for disiplene.',
        category: 'easter',
        dates: computeDates(fromEaster(14))
    },
    {
        id: 'paasketiden-4',
        name: '4. søndag i påsketiden',
        description: 'Jesus som den gode hyrden som gir livet for fårene.',
        category: 'easter',
        dates: computeDates(fromEaster(21))
    },
    {
        id: 'paasketiden-5',
        name: '5. søndag i påsketiden',
        description: 'Jesu avskjedstale. Løftet om Den Hellige Ånd.',
        category: 'easter',
        dates: computeDates(fromEaster(28))
    },
    {
        id: 'paasketiden-6',
        name: '6. søndag i påsketiden',
        description: 'Bønnens kraft og løftet om åndens ledelse.',
        category: 'easter',
        dates: computeDates(fromEaster(35))
    },

    // === HIMMELFART OG PINSE ===
    {
        id: 'kristi-himmelfartsdag',
        name: 'Kristi himmelfartsdag',
        description: 'Jesus farer opp til himmelen 40 dager etter oppstandelsen.',
        category: 'ascension',
        dates: computeDates(fromEaster(39))
    },
    {
        id: 'soendag-foer-pinse',
        name: 'Søndag før pinse',
        description: 'Ventingen på Den Hellige Ånd. Disiplene samles i bønn.',
        category: 'pentecost',
        dates: computeDates(fromEaster(42))
    },
    {
        id: 'pinsedag',
        name: 'Pinsedag',
        description: 'Den Hellige Ånd utgytes over disiplene. Kirkens fødselsdag.',
        category: 'pentecost',
        dates: computeDates(fromEaster(49))
    },
    {
        id: 'andre-pinsedag',
        name: '2. pinsedag',
        description: 'Åndens gaver og den første menighetens liv.',
        category: 'pentecost',
        dates: computeDates(fromEaster(50))
    },

    // === TREENIGHETSTIDEN ===
    {
        id: 'treenighetssoendag',
        name: 'Treenighetssøndag',
        description: 'Feiringen av den treenige Gud: Fader, Sønn og Hellig Ånd.',
        category: 'trinity',
        dates: computeDates(fromEaster(56))
    },
    {
        id: 'vingaardssoendag',
        name: 'Vingårdssøndag',
        description: 'Lignelsen om vingården og arbeiderne. Guds rike som en vingård.',
        category: 'trinity',
        dates: computeDates(vingaardssoendag)
    },

    // === SPESIELLE DAGER ===
    {
        id: 'sankthansdagen',
        name: 'Sankthansdagen / Jonsok',
        description: 'Johannes døperens fødsel. Han som beredte veien for Jesus.',
        category: 'special',
        dates: computeDates(fixed(6, 24))
    },
    {
        id: 'mikkelsmesse',
        name: 'Mikkelsmesse',
        description: 'Erkeengelen Mikael og englenes tjeneste. Kampen mellom godt og ondt.',
        category: 'special',
        dates: computeDates(fixed(9, 29))
    },
    {
        id: 'bots-og-boennedag',
        name: 'Bots- og bønnedag',
        description: 'Dag for bot, selvransakelse og bønn. Kall til omvendelse.',
        category: 'special',
        dates: computeDates(botsOgBoennedag)
    },
    {
        id: 'allehelgensdag',
        name: 'Allehelgensdag',
        description: 'Minnet om de troende som har gått foran. Håpet om oppstandelsen.',
        category: 'special',
        dates: computeDates(allehelgensdag)
    },
    {
        id: 'domssoendag',
        name: 'Domssøndag / Kristi kongedag',
        description: 'Kristi gjenkomst og den endelige dommen. Kirkeårets siste søndag.',
        category: 'special',
        dates: computeDates(domssoendag)
    },

    // === JØDISKE HØYTIDER ===
    {
        id: 'pesach',
        name: 'Pesach (Påske)',
        description: 'Feiringen av utgangen fra Egypt. Påskelammet og befrielsen fra slaveriet.',
        category: 'jewish',
        dates: jewishHolidayDates('pesach')
    },
    {
        id: 'shavuot',
        name: 'Shavuot (Ukefesten)',
        description: 'Feiringen av lovgivningen på Sinai, 50 dager etter Pesach. Førstegrødens høytid.',
        category: 'jewish',
        dates: jewishHolidayDates('shavuot')
    },
    {
        id: 'rosh-hashana',
        name: 'Rosh Hashana (Nyttår)',
        description: 'Det jødiske nyttåret. Basunblåsing og begynnelsen på de ti ærefrykts dagene.',
        category: 'jewish',
        dates: jewishHolidayDates('rosh_hashana')
    },
    {
        id: 'yom-kippur',
        name: 'Yom Kippur (Den store forsoningsdagen)',
        description: 'Den helligste dagen i jødisk tro. Faste, bønn og soning for folkets synder.',
        category: 'jewish',
        dates: jewishHolidayDates('yom_kippur')
    },
    {
        id: 'sukkot',
        name: 'Sukkot (Løvhyttefesten)',
        description: 'Minnet om ørkenvandringen. Folket bor i hytter og takker for høsten.',
        category: 'jewish',
        dates: jewishHolidayDates('sukkot')
    },
    {
        id: 'purim',
        name: 'Purim',
        description: 'Feiringen av jødenes redning fra Hamans plan, som fortalt i Esters bok.',
        category: 'jewish',
        dates: jewishHolidayDates('purim')
    },
    {
        id: 'hanukkah',
        name: 'Hanukkah (Lysfesten)',
        description: 'Tempelinnvielsen og mirakelet med oljen. Åtte dagers lysfest.',
        category: 'jewish',
        dates: jewishHolidayDates('hanukkah')
    }
];

// === Generate files ===
function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, {recursive: true});
}

function main() {
    const outDir = path.join(__dirname, 'days', 'nb');
    ensureDir(outDir);

    let created = 0;
    for (const day of days) {
        const file = path.join(outDir, `${day.id}.json`);
        const data = {
            id: day.id,
            name: day.name,
            description: day.description,
            category: day.category,
            dates: day.dates
        };
        fs.writeFileSync(file, JSON.stringify(data, null, 2));
        created++;
        console.log(`  ${day.id} (${Object.keys(day.dates).length} dates)`);
    }

    console.log(`\nCreated ${created} day files in ${outDir}`);
}

main();
