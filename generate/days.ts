import * as fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';

import {parseArgs, formatHelp, COMMON_FLAGS} from './cli.js';
import type {FlagSpec} from './cli.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Skriptet tar ingen flagg: dagene og datoreglene ligger i fila, og det er
 * ingenting å velge mellom. `--help` må likevel med, for uten den ble
 * `bun generate/days.ts --help` en full kjøring — og en full kjøring
 * overskriver hver dagfil (#109).
 */
const SPEC: Record<string, FlagSpec> = {
    help: COMMON_FLAGS.help,
};

const HELP_EXAMPLES = [
    'bun generate/days.ts',
    '',
    'ADVARSEL: hver fil skrives i sin helhet, med bare feltene som står i',
    'skriptet. Felter som er lagt til etterpå — blant annet references[] —',
    'forsvinner. Sjekk `git status generate/days/nb` etter kjøring.',
];

/** Regner ut datoen en dag faller på i et gitt år. */
type DateCalc = (year: number) => Date;

/** År → dato på formen `YYYY-MM-DD`, slik `dates`-feltet lagres. */
type DateMap = Record<number, string>;

// === Easter calculation (Anonymous Gregorian algorithm) ===
function easterDate(year: number): Date {
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

function addDays(date: Date, days: number): Date {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
}

function formatDate(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

// Find the Sunday closest to a given date
function nearestSunday(date: Date): Date {
    const day = date.getDay(); // 0=Sun
    if (day === 0) return new Date(date);
    if (day <= 3) return addDays(date, -day);
    return addDays(date, 7 - day);
}

// Find first Sunday on or after a given date
function sundayOnOrAfter(date: Date): Date {
    const day = date.getDay();
    if (day === 0) return new Date(date);
    return addDays(date, 7 - day);
}

// Find last Sunday before a given date
function sundayBefore(date: Date): Date {
    const day = date.getDay();
    if (day === 0) return addDays(date, -7);
    return addDays(date, -day);
}

// Fixed date, returns same date every year
function fixed(month: number, day: number): DateCalc {
    return (year) => new Date(year, month - 1, day);
}

// Relative to Easter
function fromEaster(offset: number): DateCalc {
    return (year) => addDays(easterDate(year), offset);
}

// 1. søndag i advent = nearest Sunday to Nov 30, but specifically:
// the Sunday that falls between Nov 27 and Dec 3 inclusive
function advent1(year: number): Date {
    const nov27 = new Date(year, 10, 27);
    return sundayOnOrAfter(nov27);
}

function adventSunday(n: number): DateCalc {
    return (year) => addDays(advent1(year), (n - 1) * 7);
}

// Kristi åpenbaringsdag: first Sunday after Jan 1 (but at least Jan 2),
// or Jan 6 in some traditions. In DNK it's the first Sunday in the new year.
// Looking at data: 2026: Jan 4, 2027: Jan 3, 2028: Jan 2
// It's the first Sunday on or after Jan 2.
function kristiAapenbaringsdag(year: number): Date {
    const jan2 = new Date(year, 0, 2);
    return sundayOnOrAfter(jan2);
}

// Maria budskapsdag: the Sunday before Palm Sunday (5th Sunday in Lent)
// From data: always Palm Sunday - 7
function mariaBudskapsdag(year: number): Date {
    return addDays(easterDate(year), -14);
}

// Mikkelsmesse: Sep 29 (fixed)
// Allehelgensdag: first Sunday in November
function allehelgensdag(year: number): Date {
    const nov1 = new Date(year, 10, 1);
    return sundayOnOrAfter(nov1);
}

// Domssøndag: last Sunday before Advent 1
function domssoendag(year: number): Date {
    return addDays(advent1(year), -7);
}

// Bots- og bønnedag: last Friday before Allehelgensdag
function botsOgBoennedag(year: number): Date {
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
function kristiForklarelsesdag(year: number): Date {
    return addDays(easterDate(year), -56);
}

// Såmannssøndag: the Sunday before Kristi forklarelsesdag
// 2026: Feb 1 (Kristi forkl. Feb 8) -> Easter - 63
// 2027: Jan 24 (Kristi forkl. Jan 31) -> Easter - 63
function samannssoendag(year: number): Date {
    return addDays(easterDate(year), -63);
}

// Vingårdssøndag: 14th Sunday after Trinity
function vingaardssoendag(year: number): Date {
    return addDays(easterDate(year), 56 + 13 * 7); // Trinity + 13 weeks
}

// === Jewish holidays (hardcoded Gregorian dates 2025-2035) ===
// Source: Wikipedia (2025-2028) and hebcal.com (2029-2035).
// Dates represent the first full calendar day of each holiday.

type JewishHoliday =
    | 'pesach'
    | 'shavuot'
    | 'rosh_hashana'
    | 'yom_kippur'
    | 'sukkot'
    | 'purim'
    | 'hanukkah';

const jewishDates: Record<JewishHoliday, DateMap> = {
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

function computeDates(calcFn: DateCalc): DateMap {
    const dates: DateMap = {};
    for (const year of YEARS) {
        dates[year] = formatDate(calcFn(year));
    }
    return dates;
}

function jewishHolidayDates(key: JewishHoliday): DateMap {
    const raw = jewishDates[key];
    const dates: DateMap = {};
    for (const year of YEARS) {
        if (raw[year]) dates[year] = raw[year];
    }
    return dates;
}

/**
 * Én dag i kirkeåret eller den jødiske festkalenderen, slik den skrives til
 * `days/nb/<id>.json`.
 */
interface Day {
    id: string;
    name: string;
    description: string;
    category: string;
    biblicalBasis: string;
    significance: string;
    liturgicalContext: string;
    history: string;
    otConnections: string;
    dates: DateMap;
}

const days: Day[] = [
    // === ADVENT ===
    {
        id: 'advent-1',
        name: '1. søndag i adventstiden',
        description: 'Kirkeårets begynnelse og starten på ventetiden før jul.',
        category: 'advent',
        biblicalBasis: 'Tekstene kretser rundt Messias-forventningen. Jesu inntog i Jerusalem (Matt 21:1-11) brukes som bilde på hans komme. Jesajas profetier om fredsfyrsten og Davids rotskudd (Jes 9:6-7, 11:1-10). Salmenes rop: «Løft hodene, dere porter! Ærens konge kommer inn» (Sal 24). Paulus\' formaning: «Timen er kommet da dere må våkne opp av søvnen» (Rom 13:11-12).',
        significance: 'Advent betyr «komme» — ventetiden minner om Israels lengsel etter Messias og kirkens venting på Kristi gjenkomst. Det doble perspektivet: vi ser tilbake på Jesu første komme og fremover mot hans endelige komme. Kallet til å våke og være beredt gjelder ikke bare den historiske hendelsen, men det kristne livets grunnholdning.',
        liturgicalContext: 'Kirkeårets første dag. Adventstiden varer fire søndager. Liturgisk farge er fiolett (bot og forberedelse). Adventskransen med fire lys tennes progressivt. Første søndag har kongelig preg — Kristus som den ventede kongen.',
        history: 'Adventstiden oppstod i Gallia på 400-tallet, opprinnelig som en fastetid før jul tilsvarende fastetiden før påske. Pave Gregor I (ca. 600) fastsatte fire adventssøndager. I luthersk tradisjon har advent bevart sitt doble fokus: Kristi fødsel og gjenkomst.',
        otConnections: 'Jesaja 9 og 11 om barnet som er født og Isais rotskudd. Sakarja 9:9 om den ydmyke kongen som rir på et esel. Salme 24 om ærens konge som kommer inn gjennom portene. Profetenes lengsel etter Guds frelse: «Rop av glede, Sions datter! Se, din konge kommer til deg» (Sak 9:9).',
        dates: computeDates(adventSunday(1))
    },
    {
        id: 'advent-2',
        name: '2. søndag i adventstiden',
        description: 'Johannes døperen som forløper og veibereder for Messias.',
        category: 'advent',
        biblicalBasis: 'Johannes roper i ørkenen: «Rydd vei for Herren, gjør hans stier rette!» (Matt 3:1-12, Mark 1:1-8, Luk 3:1-18). Han døper til omvendelse og peker frem mot en sterkere som skal døpe med Hellig Ånd og ild. Jesaja 40:3-5 om røsten i ørkenen som bereder veien. Malaki 3:1 og 4:5 om budbæreren og Elias som skal komme.',
        significance: 'Johannes representerer overgangen mellom den gamle og den nye pakt. Han er den siste profeten og den første som peker direkte på Jesus. Omvendelseskallet minner om at Guds komme krever forberedelse — ikke ytre pynt, men indre forandring. «Bær frukt som svarer til omvendelsen» (Matt 3:8).',
        liturgicalContext: 'Fiolett farge. Tekstene veksler mellom profetisk forventning og omvendelseskall. I mange tradisjoner leses Jesaja 40 som en av hovedtekstene.',
        history: 'Johannes døperen har vært en sentral skikkelse i adventsliturgien siden oldkirken. Flere kirkefedre (Origenes, Chrysostomos) utla Johannes som den endelige Elias. Adventstiden ble tidlig preget av hans rop om omvendelse som forberedelse til jul.',
        otConnections: 'Jesaja 40:1-11 — «Trøst, trøst mitt folk» og røsten som roper i ørkenen. Malaki 3:1 om sendbudet som rydder veien. Malaki 4:5-6 om profeten Elia som skal komme før Herrens store dag. Jesaja 35 om ørkenens blomstring når Herren kommer.',
        dates: computeDates(adventSunday(2))
    },
    {
        id: 'advent-3',
        name: '3. søndag i adventstiden',
        description: 'Gledens søndag (Gaudete) midt i adventstiden.',
        category: 'advent',
        biblicalBasis: 'Johannes sender bud fra fengselet: «Er du den som skal komme, eller skal vi vente en annen?» Jesus svarer med å peke på tegnene: «Blinde ser, lamme går, spedalske renses, døve hører, døde står opp, og evangeliet forkynnes for fattige» (Matt 11:2-6, Luk 7:18-23). Jesu vitnesbyrd om Johannes: «Blant dem som er født av kvinner, har det ikke stått frem noen større.»',
        significance: 'Gleden bryter gjennom midt i ventingen og forberedelsen. Jesu svar til Johannes viser at Messias ikke kom som en politisk erobrer, men som en helbreder og frigjører. Tegnene han peker på er oppfyllelsen av Jesajas profetier — Guds rike bryter inn gjennom barmhjertighet, ikke makt.',
        liturgicalContext: 'Kalles «Gaudete» etter introitusen fra Fil 4:4: «Gled dere i Herren alltid!» Noen tradisjoner bruker rosa liturgisk farge denne søndagen i stedet for fiolett, og det tredje adventslyset kan være rosa. Et gledens avbrekk i adventstidens alvor.',
        history: 'Gaudete-tradisjonen er kjent fra middelalderen. Det rosa lyset symboliserer at fastetiden lempes. I Roma var det skikk at paven velsignet en gyllen rose denne søndagen.',
        otConnections: 'Jesaja 35:1-10 — ørkenen skal juble og blomstre, den hellige veien åpnes. Jesaja 61:1-3 om Herrens Ånds salvelse: å forkynne godt budskap for fattige, forbinde dem som har et knust hjerte. Sefanja 3:14-17: «Herren din Gud er hos deg, en helt som frelser.»',
        dates: computeDates(adventSunday(3))
    },
    {
        id: 'advent-4',
        name: '4. søndag i adventstiden',
        description: 'Den siste forberedelsen før jul. Maria og inkarnasjonens mysterium.',
        category: 'advent',
        biblicalBasis: 'Bebudelsen til Maria (Luk 1:26-38): engelen Gabriel forkynner at hun skal føde Guds Sønn. Marias svar: «Se, jeg er Herrens tjenestekvinne.» Marias lovsang — Magnificat (Luk 1:46-55). Besøket hos Elisabet (Luk 1:39-45). Josefs drøm der engelen forteller at barnet er av Den Hellige Ånd (Matt 1:18-25). Jesaja 7:14: «Se, jomfruen skal bli med barn og føde en sønn.»',
        significance: 'Inkarnasjonen — at Gud blir menneske — er det sentrale mysteriet. Maria representerer troens mottagelighet: hun sier ja til noe hun ikke forstår fullt ut. Josefs lydighet viser troens lydnad. Dagen peker rett inn mot Betlehem — Gud er i ferd med å komme.',
        liturgicalContext: 'Siste søndag før jul. Faller ofte tett på julaften. Mange tradisjoner synger «Å kom, å kom, Immanuel» denne søndagen. Maria-fokuset er sterkt i både katolsk og luthersk tradisjon.',
        history: 'Maria budskapsdag (25. mars) har vært feiret siden 400-tallet som datoen for inkarnasjonens begynnelse — ni måneder før jul. 4. søndag i advent tok opp Maria-tematikken i den liturgiske forberedelsen til jul.',
        otConnections: 'Jesaja 7:14 om jomfrutegnet. Mika 5:2 om herskeren fra Betlehem. 2 Samuel 7:12-16 om Davids trone som skal stå fast for evig — løftet som oppfylles i Jesus. Ruts bok som en del av Jesu stammor-linje gjennom Obed, Isai og David.',
        dates: computeDates(adventSunday(4))
    },

    // === JUL ===
    {
        id: 'julaften',
        name: 'Julaften',
        description: 'Feiringen av Jesu fødsel i Betlehem.',
        category: 'christmas',
        biblicalBasis: 'Lukas\' fødselsberetning: Augustus\' folketelling fører Josef og Maria til Betlehem, der Jesus fødes og legges i en krybbe fordi det ikke var plass i herberget (Luk 2:1-7). Gjeterne på marken får budskapet fra engelen: «I dag er det født dere en frelser» (Luk 2:8-20). Den himmelske hærskaren synger «Ære være Gud i det høyeste, og fred på jorden». Jesaja 9:2-7 om barnet som er født og folkeslaget som vandrer i mørket men ser et stort lys.',
        significance: 'Gud stiger inn i det aller minste — et barn i en krybbe, i utkanten av imperiet. Budskapet kommer først til gjeterne, de laveste i samfunnet. Inkarnasjonen er ikke bare en teologisk idé, men en konkret historisk hendelse: Gud tar bolig i det menneskelige for å forløse det innenfra.',
        liturgicalContext: 'Liturgisk farge er hvit (fest). I norsk tradisjon er julaften den viktigste julefeiringen med gudstjeneste, julevangeliet fra Lukas og julesanger. Adventslysene har brent ferdig — nå er Lyset selv kommet. Juletiden varer til Kristi åpenbaringsdag.',
        history: 'Feiringen av Jesu fødsel 25. desember er kjent fra 300-tallet i Roma. Datoen kan være valgt i tilknytning til den romerske vintersolhvervsfesten (Sol Invictus). I østkirken ble 6. januar feiret. Den norske tradisjonen med julaften 24. desember følger germansk skikk der helligdagen begynner kvelden før.',
        otConnections: 'Jesaja 9:2-7 om barnet og fredsfyrsten. Mika 5:2 om Betlehem som fødested. 1 Mosebok 3:15 — det første løftet om en som skal knuse slangens hode (protoevangeliet). Jesaja 7:14 om Immanuel. Numeri 24:17 om stjernen som stiger opp av Jakob.',
        dates: computeDates(fixed(12, 24))
    },
    {
        id: 'juledag',
        name: 'Juledag',
        description: 'Inkarnasjonen — at Gud ble menneske.',
        category: 'christmas',
        biblicalBasis: 'Johannesevangeliets prolog: «I begynnelsen var Ordet, og Ordet var hos Gud, og Ordet var Gud... Og Ordet ble kjød og tok bolig iblant oss, og vi så hans herlighet» (Joh 1:1-18). Hebreerbrevet 1:1-6 om Sønnen som avglans av Guds herlighet og uttrykt bilde av hans vesen. Titus 2:11: «Guds nåde er blitt åpenbart til frelse for alle mennesker.»',
        significance: 'Mens julaften fokuserer på fødselsberetningen, løfter juledag blikket til det kosmiske: Skaperen selv stiger inn i skaperverket. Ordet som var hos Gud fra evighet av tar menneskelig skikkelse. Dette er ikke bare en fødsel — det er en kosmisk hendelse der evigheten bryter inn i tiden.',
        liturgicalContext: 'Hvit farge. Høytidelig gudstjeneste. Johannesprologen er den klassiske juledagsteksten som løfter perspektivet fra stalldøren til den kosmiske inkarnasjonen. Mange tradisjoner har ottesang (morgengudstjeneste) med Lukas 2-teksten og høymesse med Johannes 1.',
        history: 'Juledag 25. desember ble den offisielle feiringsdagen i vestkirken fra 300-tallet. Keiser Konstantins tid ga julefeiringen et løft. Gjennom middelalderen ble julefeiringen utvidet med dramatiske fremstillinger av fødselsberetningen (krybbespill).',
        otConnections: 'Ordets skaperkraft: «Gud sa: Bli lys! Og det ble lys» (1 Mos 1:3) — det samme Ordet som nå tar bolig iblant oss. Jesaja 52:7-10: «Alle jordens ender får se frelsen fra vår Gud.» Visdomslitteraturens personifisering av Guds visdom (Ordsp 8:22-31) som et forbilde på Logos-teologien.',
        dates: computeDates(fixed(12, 25))
    },
    {
        id: 'stefanusdag',
        name: 'Stefanusdag',
        description: 'Den første kristne martyren steines for sin tro.',
        category: 'christmas',
        biblicalBasis: 'Stefanus, full av nåde og kraft, gjør tegn og under (Apg 6:8-15). Han holder sin forsvarstale der han gjennomgår Israels frelseshistorie og anklager folket for å ha forrådt og drept Den rettferdige (Apg 7:1-53). Han ser himmelen åpnet og Menneskesønnen stå ved Guds høyre hånd. Mens han steines, ber han: «Herre Jesus, ta imot min ånd» og «Herre, tilregn dem ikke denne synden» (Apg 7:54-60).',
        significance: 'Plasseringen dagen etter juledag er bevisst — den viser troens pris. Gleden over Guds komme til verden konfronteres umiddelbart med verdens avvisning. Stefanus\' bønn for sine fiender speiler Jesu ord på korset og viser martyriets vitnesbyrd: troen holder stand selv i møte med døden.',
        liturgicalContext: 'Rød liturgisk farge (martyrdag). En av de eldste helgendagene i kirken. I skandinavisk tradisjon også kalt «andre juledag». Kontrasten mellom julens glede og martyriets alvor er tilsiktet i den liturgiske kalenderen.',
        history: 'Stefanusdagen har vært feiret 26. desember siden 400-tallet. Stefanus regnes som den første martyren (protomartyr). Plasseringen rett etter jul understreker oldkirkens bevissthet om at inkarnasjonen leder til korset. Saulus (Paulus) var til stede ved steiningen — en detalj som knytter martyriet til misjonen.',
        otConnections: 'Stefanus\' tale gjennomgår hele GTs frelseshistorie fra Abraham til Salomo. Han trekker linjer fra Moses som ble avvist av sitt folk til Jesus som ble avvist. Motstandsmotivet: som fedrene forfulgte profetene, forfølger nå folket Messias og hans vitner.',
        dates: computeDates(fixed(12, 26))
    },
    {
        id: 'nyttaarsdag',
        name: 'Nyttårsdag / Jesu navnedag',
        description: 'Jesu omskjæring og navngiving åtte dager etter fødselen.',
        category: 'christmas',
        biblicalBasis: '«Da åtte dager var gått og barnet skulle omskjæres, fikk han navnet Jesus, det navnet engelen hadde gitt ham før han ble unnfanget i mors liv» (Luk 2:21). Navnet Jesus (hebraisk Jeshua/Yehoshua) betyr «Herren frelser». Omskjæringen etter 1 Mosebok 17:12 og 3 Mosebok 12:3.',
        significance: 'Omskjæringen viser at Jesus underordnet seg Moseloven og tok del i pakten med Abraham. Paulus tolker dette: «Da tidens fylde kom, sendte Gud sin Sønn, født av en kvinne, født under loven, for å kjøpe fri dem som stod under loven» (Gal 4:4-5). Navngivingen bekrefter Guds frelsesplan — barnet er den lovede frelseren.',
        liturgicalContext: 'Hvit farge. Sammenfaller med den sivile nyttårsdagen, men det liturgiske fokuset er på Jesu navngiving, ikke årsskiftet. I eldre tradisjon ble dagen kalt «Circumcisio Domini» (Herrens omskjærelse).',
        history: 'Feiringen er kjent fra 500-tallet. I middelalderen var fokuset på omskjærelsen og Jesu første blodsutgytelse som et forvarsel om korset. Etter reformasjonen la lutherske kirker mer vekt på navngivingen og navnet Jesu betydning.',
        otConnections: '1 Mosebok 17:9-14 om omskjærelsespakten med Abraham. 1 Mosebok 17:19 der Gud gir Isak navn før han er født — en parallell til at Jesus fikk navnet sitt fra engelen før unnfangelsen. Josva (samme navn som Jesus) som ledet folket inn i det lovede land.',
        dates: computeDates(fixed(1, 1))
    },

    // === ÅPENBARING ===
    {
        id: 'kristi-aapenbaringsdag',
        name: 'Kristi åpenbaringsdag',
        description: 'Jesus åpenbares for folkeslagene gjennom vismennenes tilbedelse.',
        category: 'epiphany',
        biblicalBasis: 'Vismennene fra Østen følger stjernen til Betlehem og tilber Jesusbarnet med gull, røkelse og myrra (Matt 2:1-12). Herodes forsøker å bruke dem for å finne barnet og drepe det. Vismennene advares i drøm og reiser hjem en annen vei. Jesaja 60:1-6 om folkene som vandrer mot lyset og kongene som bringer gull og røkelse.',
        significance: 'Epifani betyr «åpenbaring». Frelsen gjelder ikke bare Israel, men alle folkeslag — vismennene representerer hedningeverdenen som bøyer kne for Israels Messias. Gavene har symbolsk betydning i kristen tradisjon: gull til kongen, røkelse til Gud, myrra til den som skal dø. Herodes\' motstand viser at Guds rike møter verdens makt.',
        liturgicalContext: 'Hvit farge. I østkirken er dette den opprinnelige juledagen. I vestkirken markerer den slutten av juletiden og starten på åpenbaringstiden. «Hellige tre kongers dag» i folkelig tradisjon, men Bibelen sier verken hvor mange de var eller at de var konger.',
        history: 'Feiringen 6. januar er eldre enn julefeiringen 25. desember. I østkirken feiret man opprinnelig Jesu fødsel, dåp og det første underet i Kana på denne dagen. Etterhvert ble fødselsfeiringen flyttet til 25. desember i vest, mens 6. januar beholdt fokuset på åpenbaringen for folkeslagene.',
        otConnections: 'Jesaja 60:1-6 om folkenes pilegrimsferd til Sion med gull og røkelse. Numeri 24:17 — Bileams profeti om stjernen fra Jakob. Salme 72:10-11 om kongene som bringer gaver og bøyer seg. Jesaja 49:6 om lyset for folkeslagene.',
        dates: computeDates(kristiAapenbaringsdag)
    },
    {
        id: 'kyndelsmesse',
        name: 'Kyndelsmesse',
        description: 'Jesus bæres frem i tempelet. Simeon og Hanna møter barnet.',
        category: 'epiphany',
        biblicalBasis: 'Førti dager etter fødselen bringes Jesus til tempelet etter Moseloven (Luk 2:22-38). Simeon, som hadde fått løfte om å se Herrens Salvede før han døde, tar barnet i armene og synger Nunc dimittis: «Herre, nå lar du din tjener fare herfra i fred... for mine øyne har sett din frelse, et lys til åpenbaring for hedningene og en herlighet for ditt folk Israel.» Han profeterer til Maria: «Et sverd skal gjennombore din sjel.» Profetinnen Hanna takker Gud og vitner om barnet.',
        significance: 'Møtet mellom den gamle og den nye pakt — Simeon og Hanna representerer den ventende resten av Israel som endelig ser frelsens oppfyllelse. Lysmotivet er sentralt: Jesus er verdens lys, åpenbart i tempelet. Simeons profeti om sverdet peker mot Langfredag — gleden over barnet bærer allerede lidelsens forvarsel.',
        liturgicalContext: 'Hvit farge. Navnet «kyndelsmesse» (lysmesse) kommer av lysprosesjon og velsignelse av lys. I katolsk tradisjon velsignes årets kirkelys denne dagen. Nunc dimittis synges i aftenbønn/completorium daglig.',
        history: 'Feiringen 2. februar (40 dager etter 25. desember) er kjent fra Jerusalem allerede på 300-tallet, da den ble kalt Hypapante (Møtet). Lysprosesjonen kom til fra 400-500-tallet. I folketradisjonen markerte kyndelsmesse vinteren midtpunkt og lengre dager.',
        otConnections: '3 Mosebok 12:1-8 om reinselsesofferet etter fødsel — Maria og Josef ofrer det fattigfolks offer: to turtelduer. 2 Mosebok 13:2 om at alt førstefødt tilhører Herren. Malaki 3:1: «Herren som dere søker, kommer brått til sitt tempel.» Jesaja 42:6 og 49:6 om lyset for folkeslagene.',
        dates: computeDates(fixed(2, 2))
    },
    {
        id: 'samannssoendag',
        name: 'Såmannssøndag',
        description: 'Lignelsen om såmannen og Guds ords mottagelse.',
        category: 'epiphany',
        biblicalBasis: 'Jesus forteller lignelsen om såmannen som sår korn i ulik jordsmonn (Matt 13:1-23, Mark 4:1-20, Luk 8:4-15). Noe faller på veien og fuglene spiser det, noe i steingrunn der det visner fort, noe blant torner som kveler det, og noe i god jord der det bærer frukt — trettidobbelt, sekstidobbelt, hundredobbelt. Jesus forklarer at såkornet er Guds ord og jordsmonnet er menneskers hjerter.',
        significance: 'Lignelsen handler om hvordan mennesker tar imot Guds ord — og hva som hindrer det fra å bære frukt: likegyldighet, overflatisk tro, bekymringer og rikdom. Samtidig er det et løfte: der ordet får rotfeste, bærer det overstrømmende frukt. Ansvaret ligger hos mottageren, men kraften ligger i ordet selv.',
        liturgicalContext: 'Grønn farge (åpenbaringstiden). Plassert mellom åpenbaringstid og fastetid. Fokuset på Guds ord gjør dagen til en naturlig overgang — fra åpenbaring til etterfølgelse.',
        history: 'Såmannssøndagen er særlig viktig i skandinavisk luthersk tradisjon. Luther la stor vekt på lignelsen som en beskrivelse av ordets virkning og troens utfordringer. Søndagen har tradisjonelt vært knyttet til bibelspredning og misjon.',
        otConnections: 'Jesaja 55:10-11 — Guds ord som regnet som ikke vender tilbake uten å ha utrettet det det ble sendt for. Salme 126:5-6 om å så med tårer og høste med jubel. Jesaja 6:9-10 om folket som hører men ikke forstår — sitert av Jesus i forklaringen av lignelsen.',
        dates: computeDates(samannssoendag)
    },
    {
        id: 'kristi-forklarelsesdag',
        name: 'Kristi forklarelsesdag',
        description: 'Jesus forklares på fjellet og hans guddommelighet åpenbares.',
        category: 'epiphany',
        biblicalBasis: 'Jesus tar Peter, Jakob og Johannes med opp på et høyt fjell. Han forklares: ansiktet lyser som solen, klærne blir hvite som lyset (Matt 17:1-9, Mark 9:2-10, Luk 9:28-36). Moses og Elia viser seg og taler med ham om hans «utgang» i Jerusalem. Peter vil bygge tre hytter. En lysende sky overskygger dem, og en røst sier: «Dette er min Sønn, den elskede, i ham har jeg min glede. Hør ham!» På vei ned forbyr Jesus dem å fortelle om synet før Menneskesønnen er oppstått.',
        significance: 'Forklarelsen åpenbarer hvem Jesus egentlig er — Guds herlighet bryter gjennom den menneskelige skikkelsen. Moses (loven) og Elia (profetene) vitner om ham og taler om hans «utgang» (exodus) i Jerusalem — korsdøden som en ny utgang fra slaveriet. Hendelsen er en forhåndsvisning av oppstandelsens herlighet, gitt disiplene som styrke før lidelsesveien.',
        liturgicalContext: 'Hvit farge. Plassert rett før fastetiden — et glimt av herligheten før lidelsesveien begynner. Siste søndag i åpenbaringstiden. Kontrasten er tilsiktet: fra fjellets lys til ørkenens fristelse (1. søndag i fasten).',
        history: 'Forklarelsen er feiret i østkirken fra 400-tallet (6. august). I vestkirken ble den offisielt innført i 1457 av pave Calixtus III. Luthersk tradisjon plasserer den som avslutning på åpenbaringstiden, som et siste vendepunkt før fastetiden.',
        otConnections: 'Moses på Sinai der hans ansikt lyste etter møtet med Gud (2 Mos 34:29-35). Elias på Horeb der Gud åpenbarte seg (1 Kong 19). Skyen som tegn på Guds nærvær — tabernakelskyen (2 Mos 40:34-38) og tempelskyen (1 Kong 8:10-11). Daniels syn av Menneskesønnen i herlighet (Dan 7:13-14).',
        dates: computeDates(kristiForklarelsesdag)
    },

    // === FASTE ===
    {
        id: 'fastelavnssoendag',
        name: 'Fastelavnssøndag',
        description: 'Siste søndag før fastetiden. Overgang fra fest til bot.',
        category: 'lent',
        biblicalBasis: 'Jesu tredje lidelsesforutsigelse: «Menneskesønnen skal overgis til hedningene, bli hånt og mishandlet og spyttet på, og de skal piske ham og slå ham i hjel, og den tredje dagen skal han stå opp» (Luk 18:31-34, Mark 10:32-34). Den blinde Bartimeus som roper og ikke gir seg: «Jesus, Davids sønn, forbarm deg over meg!» (Mark 10:46-52). Paulus\' ord om kjærlighetens vei (1 Kor 13).',
        significance: 'Overgangen fra åpenbaringstidens glede til fastens alvor. Jesu lidelsesforutsigelse setter kursen mot Jerusalem og korset. Bartimeus\' rop er et bilde på menneskets grunnleggende behov for nåde — han ser sin egen blindhet og roper om hjelp. Etterfølgelse koster, men begynner med å se sin nød.',
        liturgicalContext: 'Fiolett farge. Navnet «fastelavn» (fastelaven = fasteaften) viser at dagen er terskelen til fasten. I folkelig tradisjon var det festdag med karneval og «slå katten av tønnen» — den siste festen før fastens alvor.',
        history: 'Fastelavnsfeiringen har røtter i middelalderens karneval (carne vale = «farvel til kjøttet») før askeonsdag. Den lutherske kirken beholdt søndagen men fjernet karnevalselementene og la vekt på lidelsesforutsigelsen og etterfølgelsestemaet.',
        otConnections: 'Jesaja 53 om Herrens lidende tjener som et bakgrunnsmotiv for lidelsesforutsigelsen. Blindheten som metafor — Jesaja 42:18-19: «Hør, dere døve! Se hit, dere blinde!» Overgangen minner om Israels overgang fra ørkenens fest til vandringens alvor.',
        dates: computeDates(fromEaster(-49))
    },
    {
        id: 'askeonsdag',
        name: 'Askeonsdag',
        description: 'Fastetiden begynner. 40 dager med bot og forberedelse til påske.',
        category: 'lent',
        biblicalBasis: 'Jesu undervisning om faste, bønn og almisser i det skjulte: «Når dere faster, skal dere ikke gå med mørkt ansikt... men salv hodet og vask ansiktet» (Matt 6:1-18). Joel 2:12-13: «Vend om til meg av hele deres hjerte, med faste og gråt og klage. Riv hjertet i stykker, ikke klærne!» 1 Mosebok 3:19: «Støv er du, og til støv skal du vende tilbake.»',
        significance: 'Asken minner om dødeligheten og syndens alvor. Fasten er ikke en ytre øvelse men en indre vending — Joel insisterer på å rive hjertet, ikke klærne. De 40 dagene speiler Jesu 40 dager i ørkenen, Israels 40 år i ørkenen og Moses\' 40 dager på Sinai. Fastetiden er en innøvelse i å gi slipp og gjøre plass for Gud.',
        liturgicalContext: 'Fiolett farge. Askekorset tegnes på pannen med ordene «Husk at du er støv, og til støv skal du vende tilbake» eller «Vend om og tro på evangeliet». Søndagene telles ikke med i de 40 dagene fordi hver søndag er en «liten påskedag».',
        history: 'Askeonsdagen er kjent fra 600-tallet. Opprinnelig ble offentlige syndere pålagt bot med aske og sekkestrie. Etterhvert ble askekorset gitt til alle troende som tegn på fellesskap i syndsbekjennelse. Luther beholdt askeonsdagen som en verdifull botspraksis.',
        otConnections: 'Jona 3:5-10 der ninivittene faster i sekk og aske og Gud vender om fra sin vrede. Daniel 9:3 der Daniel ber med faste, sekk og aske. Job 42:6: «Derfor tar jeg alt tilbake og angrer i støv og aske.» Esther 4:1-3 der Mordekais faste i sekk og aske fører til redning.',
        dates: computeDates(fromEaster(-46))
    },
    {
        id: 'faste-1',
        name: '1. søndag i fastetiden',
        description: 'Jesus fristes i ørkenen. Kampen mot det onde.',
        category: 'lent',
        biblicalBasis: 'Etter dåpen føres Jesus av Ånden ut i ørkenen der han faster i 40 dager og fristes av djevelen (Matt 4:1-11, Luk 4:1-13). Tre fristelser: å gjøre stein til brød (selvtilfredsstillelse), å kaste seg ned fra tempelet (å sette Gud på prøve), og å tilbe djevelen i bytte mot verdens riker (makt). Jesus avviser alle med Skriftord fra 5. Mosebok.',
        significance: 'Jesus gjennomgår den prøven Israel feilet — 40 år i ørkenen med murring og avgudsdyrkelse. Der Israel sviktet, består Jesus. Fristelsene representerer grunnleggende menneskelige fristelser: behovstilfredsstillelse, prestisje og makt. Jesu svar viser at Guds ord er våpenet mot fristelse.',
        liturgicalContext: 'Fiolett farge. Første søndag i fasten. Fristelsesberetningen leses hvert år — den setter tonen for hele fastetiden som en kamptid.',
        history: 'Fristelsesberetningen har vært knyttet til 1. søndag i fasten siden oldkirken. De 40 dagene i ørkenen ga modell for fastetiden. Mange kirkefedre så fristelsene som en oppsummering av alle menneskelige fristelser.',
        otConnections: 'Israels 40 år i ørkenen (5 Mos 8:2-3) — Jesus siterer fra nettopp Deuteronomium. Adams fristelse i hagen (1 Mos 3) — den nye Adam består der den første falt. Moses\' 40 dager på Sinai (2 Mos 34:28). Elias\' 40 dager til Horeb (1 Kong 19:8).',
        dates: computeDates(fromEaster(-42))
    },
    {
        id: 'faste-2',
        name: '2. søndag i fastetiden',
        description: 'Troens kamp og utholdenhet i bønn.',
        category: 'lent',
        biblicalBasis: 'Den kanaaneiske kvinnen som ikke gir seg selv når Jesus virker avvisende: «Herre, hjelp meg!... Også hundene spiser smulene som faller fra herrens bord» (Matt 15:21-28). Jakobs kamp med Gud ved Jabbok: «Jeg slipper deg ikke uten at du velsigner meg» (1 Mos 32:24-30). Hebreerbrevet 11 om troens vitner som holdt fast.',
        significance: 'Tro er ikke passive følelser men aktiv kamp — å holde fast i Gud selv når han synes taus eller avvisende. Den kanaaneiske kvinnens tro er forbilledlig nettopp fordi den ikke gir opp. Jakob får nytt navn (Israel = «den som kjemper med Gud») — troskampen forandrer identiteten.',
        liturgicalContext: 'Fiolett farge. Midt i fastetiden fordypes temaet om troens utholdenhet — forberedelsen til påske krever standhaftighet.',
        history: 'Denne søndagen har tradisjonelt hatt fokus på bønnens kamp. Luther la vekt på Anfechtung — anfektelsen der troen prøves og styrkes gjennom tvil og kamp.',
        otConnections: 'Jakob ved Jabbok (1 Mos 32:24-30) er den sentrale GT-teksten. Hanna som ber med gråt i Silo og ikke gir seg (1 Sam 1:9-20). Moses som holder armene oppe i kamp mot Amalek (2 Mos 17:8-13) — bønnens utholdenhet i krig.',
        dates: computeDates(fromEaster(-35))
    },
    {
        id: 'faste-3',
        name: '3. søndag i fastetiden',
        description: 'Kampen mellom Guds rike og det ondes makt.',
        category: 'lent',
        biblicalBasis: 'Jesus driver ut onde ånder og anklages for å gjøre det ved Beelzebul (Luk 11:14-28, Matt 12:22-30). Jesus svarer: «Er det ved Guds finger jeg driver ut de onde åndene, da har jo Guds rike nådd fram til dere.» Lignelsen om den sterke mannen som bindes av en sterkere. «Den som ikke er med meg, er mot meg.»',
        significance: 'Guds rike bryter inn som en konfrontasjon med det onde — ikke fredelig sameksistens, men kamp. Jesus viser seg som den sterkere som binder Satan. Det nøytrale alternativet finnes ikke: «Den som ikke er med meg, er mot meg.» Fastetiden er en tid for å velge side og rydde plass for Guds rike.',
        liturgicalContext: 'Fiolett farge. Temaet om åndelig kamp utdyper fastens karakter — det handler ikke bare om selvdisiplin, men om å ta stilling i kampen mellom godt og ondt.',
        history: 'Eksorisme og demonologi var sentrale temaer i oldkirkens katekese under fasten, da dåpskandidatene ble forberedt på å forsake djevelen i dåpen. Denne søndagen bærer preg av den pedagogikken.',
        otConnections: 'Guds finger som skapte loven på steintavlene (2 Mos 31:18) — den samme Guds finger som nå driver ut demoner. Elias\' kamp mot Baals-profetene på Karmel (1 Kong 18) — «Hvor lenge vil dere halte til begge sider?» Daniels kamp med mørkets fyrster (Dan 10).',
        dates: computeDates(fromEaster(-28))
    },
    {
        id: 'faste-4',
        name: '4. søndag i fastetiden',
        description: 'Gledens søndag (Laetare). Brødet fra himmelen.',
        category: 'lent',
        biblicalBasis: 'Brødunderet der Jesus metter fem tusen med fem brød og to fisker (Joh 6:1-15, Matt 14:13-21). Brødtalen: «Jeg er livets brød. Den som kommer til meg, skal ikke hungre» (Joh 6:35). 2 Mosebok 16 om mannaen Gud ga folket i ørkenen. Salme 78:24-25 om englebrødet.',
        significance: 'Midt i fastens ørkenvandring gir Gud overflod — akkurat som mannaen i ørkenen. Jesus bryter fem brød og metter tusenvis, med tolv kurver til overs. Han er selv mannaen — livets brød som metter sjelens hunger. Underet peker mot nattverden: bruddet brød som gir fellesskap med Gud.',
        liturgicalContext: 'Kalles «Laetare» etter Jesaja 66:10: «Gled dere med Jerusalem!» Noen tradisjoner bruker rosa farge denne søndagen — et gledens avbrekk midt i fastens fiolett, parallelt med Gaudete i advent. Fasten har nådd midtpunktet.',
        history: 'Laetare-søndagen har vært feiret siden 400-tallet. I middelalderen ble den kalt «Rosensonntag» fordi paven velsignet en gylden rose. Skikken med rosa liturgiske tekstiler er kjent fra 1100-tallet.',
        otConnections: 'Mannaen i ørkenen (2 Mos 16) — brødet fra himmelen som Gud ga daglig. Elias som ble mettet av engler i ørkenen (1 Kong 19:4-8). Elisjas brødunder der tjue byggbrød mettet hundre menn med mat til overs (2 Kong 4:42-44) — et direkte forbilde på Jesu under.',
        dates: computeDates(fromEaster(-21))
    },
    {
        id: 'maria-budskapsdag',
        name: 'Maria budskapsdag',
        description: 'Engelen Gabriel forkynner Jesu fødsel for Maria. Inkarnasjonen begynner.',
        category: 'lent',
        biblicalBasis: 'Engelen Gabriel sendes til Maria i Nasaret: «Vær hilset, du som har fått nåde! Herren er med deg» (Luk 1:26-38). Maria spør hvordan dette kan skje siden hun ikke har vært sammen med noen mann. Engelen svarer: «Den Hellige Ånd skal komme over deg.» Marias svar: «Se, jeg er Herrens tjenestekvinne. La det skje med meg som du har sagt.» Jesaja 7:14: «Se, jomfruen skal bli med barn.»',
        significance: 'I dette øyeblikket begynner inkarnasjonen — Gud blir menneske. Marias ja er troens urbilde: hun gir rom for noe hun ikke forstår. Ni måneder før jul skjer det avgjørende — ikke med makt og herlighet, men i en ung kvinnes lydige ja i en utkantby. Guds plan avhenger av et menneskes frie samtykke.',
        liturgicalContext: 'Hvit farge. Feires 25. mars (ni måneder før jul). Hvis den faller i Den stille uke eller påsken, flyttes den. I fastetiden bryter dagen opp alvoret med glede over inkarnasjonens begynnelse.',
        history: 'Feiringen er kjent fra 400-500-tallet. Datoen 25. mars ble tidlig regnet som inkarnasjons- og muligens verdens skapelsesdag. Noen kirkefedre regnet også Jesu korsfestelse til denne datoen — fødsel og død på samme dato.',
        otConnections: 'Jesaja 7:14 om jomfrutegnet. 1 Mosebok 3:15 der kvinnens ætt skal knuse slangens hode — Maria som den nye Eva. Ruts ja til Noomi og hennes folk (Rut 1:16) som et forbilde på Marias overgivelse. Arons stav som blomstrer (4 Mos 17) som et symbol på nytt liv fra det tilsynelatende livløse.',
        dates: computeDates(mariaBudskapsdag)
    },

    // === DEN STILLE UKE / PÅSKE ===
    {
        id: 'palmesoendag',
        name: 'Palmesøndag',
        description: 'Jesu inntog i Jerusalem. Starten på Den stille uke.',
        category: 'easter',
        biblicalBasis: 'Jesus rir inn i Jerusalem på et esel mens folkemengden legger kapper og palmegrener på veien og roper «Hosianna! Velsignet er han som kommer i Herrens navn!» (Matt 21:1-11, Mark 11:1-11, Luk 19:28-44, Joh 12:12-19). Jesus gråter over Jerusalem: «Hadde du bare på denne dagen forstått hva som tjener til din fred.» Oppfyllelsen av Sakarja 9:9 om den ydmyke kongen.',
        significance: 'Jesus kommer som konge, men på et esel — fredskongen, ikke krigshelten. Jubelen slår snart om til «Korsfest ham!» Palmesøndag viser både Jesu kongeverdighet og menneskemassens ubestandighet. Den som hylles i dag, foraktes i morgen. Det er en dag med dobbelt bunn — glede og sorg, hyllest og forvarsel.',
        liturgicalContext: 'Fiolett eller rød farge. Palmeprosesjon i mange tradisjoner. Pasjonsberetningen (hele lidelseshistorien) leses i mange kirker denne søndagen. Starten på Den stille uke (Karuka) — uken som leder til korset.',
        history: 'Palmesøndagen er kjent fra Jerusalem allerede på 300-tallet, da pilegrimer bar palmegrener i prosesjon fra Oljeberget inn i byen. Egeria (ca. 384) beskriver denne prosesjonen. Skikken spredde seg til vestkirken gjennom middelalderen.',
        otConnections: 'Sakarja 9:9: «Se, din konge kommer til deg, rettferdig og rik på frelse, ydmyk, ridende på et esel.» Salme 118:25-26: «Hosianna! Velsignet er han som kommer i Herrens navn!» — den liturgiske salmen fra Sukkot-feiringen. 1 Kongebok 1:32-40 om Salomos salving der han rir på kongens muldyr.',
        dates: computeDates(fromEaster(-7))
    },
    {
        id: 'skjaertorsdag',
        name: 'Skjærtorsdag',
        description: 'Det siste måltidet. Nattverdinnstiftelsen og fotvasken.',
        category: 'easter',
        biblicalBasis: 'Jesus spiser påskemåltidet med disiplene og innstifter nattverden: «Dette er mitt legeme som gis for dere... Denne kalken er den nye pakt i mitt blod» (Matt 26:26-29, Mark 14:22-25, Luk 22:14-23, 1 Kor 11:23-26). Jesus vasker disiplenes føtter: «Jeg har gitt dere et forbilde» (Joh 13:1-17). Avskjedstalen (Joh 14-16). Bønnen i Getsemane: «Far, om du vil, ta dette begeret fra meg! Men la din vilje skje, ikke min» (Luk 22:39-46). Judas\' forræderi og arrestasjonen.',
        significance: 'Nattverden er den nye pakts måltid — Jesus knytter seg til påskelammet og gir offeret personlig: «mitt legeme, mitt blod». Fotvasken snur alle maktforhold på hodet — Herren tjener sine tjenere. Getsemane viser Jesu fulle menneskelighet: angsten, svetten, bønnen om å slippe — og den fullstendige overgivelsen til Faderens vilje.',
        liturgicalContext: 'Hvit farge (nattverdsinnstiftelsen). Navnet «skjærtorsdag» kan komme av norrønt «skíra» (rense/vaske) — fotvasken. Alteret strippes etter gudstjenesten til tegn på at alt tas bort. Mange kirker har nattverdgudstjeneste om kvelden.',
        history: 'Skjærtorsdagsfeiringen er kjent fra 300-tallet. Fotvasken (Mandatum, derav «Maundy Thursday» på engelsk) ble en liturgisk handling der biskopen vasket de fattiges føtter. Nattverdsinnstiftelsen har gjort denne kvelden til en av de mest sentrale i kirkeåret.',
        otConnections: 'Pesach-måltidet i 2 Mosebok 12 — det siste måltidet er et påskemåltid. Paktsblod: «Se, dette er paktens blod» (2 Mos 24:8) da Moses stryker blod på folket. Jeremias løfte om en ny pakt: «Jeg legger min lov i deres sinn og skriver den i deres hjerte» (Jer 31:31-34). Tjenermotivet fra Jesaja 53.',
        dates: computeDates(fromEaster(-3))
    },
    {
        id: 'langfredag',
        name: 'Langfredag',
        description: 'Jesu lidelse, korsfestelse og død.',
        category: 'easter',
        biblicalBasis: 'Rettssaken for Pilatus, Barabbas løslates, Jesus piskes og hånes (Matt 27, Mark 15, Luk 23, Joh 18-19). Korsbæringen til Golgata. Korsfestelsen mellom to røvere. De syv ordene fra korset, inkludert «Far, tilgi dem, for de vet ikke hva de gjør» (Luk 23:34) og «Det er fullbrakt» (Joh 19:30). Mørke over landet fra den sjette til den niende time. Forhenget i tempelet revner i to. Jesus dør og begraves i Josefs grav.',
        significance: 'Korset er soningsofferet — Guds lam som bærer bort verdens synd (Joh 1:29). «Gud var i Kristus og forsonte verden med seg selv» (2 Kor 5:19). Forhenget som revner viser at veien til Gud nå er åpen for alle. Jesu død er ikke et nederlag men en frivillig overgivelse: «Ingen tar mitt liv, jeg gir det frivillig» (Joh 10:18). Langfredag uten påskedag er meningsløs — men påskedag uten langfredag er billig.',
        liturgicalContext: 'Sort eller fiolett farge — den eneste dagen uten nattverd i mange tradisjoner. Kirken er strippert og naken. Pasjonsberetningen leses i sin helhet. Korset tilbes eller æres. Stillhet preger dagen. Klokkene tier fra skjærtorsdag til påskenatt.',
        history: 'Langfredag har vært feiret i Jerusalem siden 300-tallet med prosesjon langs Via Dolorosa. Egeria beskriver gudstjenester fra den sjette til den niende time (da Jesus hang på korset). Navnet «langfredag» kan komme av den «lange» gudstjenesten eller den «lange» fredagen av sorg. På engelsk «Good Friday» — fordi det gode (frelsen) skjer gjennom det onde (korset).',
        otConnections: 'Jesaja 53 om Herrens lidende tjener: «Han ble såret for våre overtredelser, knust for våre synder.» Salme 22: «Min Gud, min Gud, hvorfor har du forlatt meg?» — Jesu rop fra korset. Påskelammet i 2 Mosebok 12 — «ikke et ben skal brytes» (Joh 19:36). Den bronseslangen Moses reiste i ørkenen (4 Mos 21:8-9, jf. Joh 3:14). Abrahams ofring av Isak på Moria (1 Mos 22). Salme 69 om den lidende rettferdige.',
        dates: computeDates(fromEaster(-2))
    },
    {
        id: 'paaskenatt',
        name: 'Påskenatt',
        description: 'Påskeviglien — den store nattgudstjenesten fra mørke til lys.',
        category: 'easter',
        biblicalBasis: 'Påskenattens lesninger spenner over hele frelseshistorien: skapelsen (1 Mos 1), syndefloden og regnbuen (1 Mos 7-9), Abrahams ofring av Isak (1 Mos 22), gjennomgangen av Rødehavet (2 Mos 14-15), Esekiels syn om de tørre knoklene (Esek 37), og profetenes løfter om fornyelse. Nattens evangelium: kvinnene kommer til graven tidlig søndag morgen og finner den tom.',
        significance: 'Vigiliens struktur er teologisk: frelseshistorien leses kronologisk fra skapelsen — alt peker mot denne natten. Lyset tennes i mørket: påskelyset (Kristuslyset) bæres inn i den mørke kirken som et tegn på oppstandelsens seier. Dåpen hører naturlig til denne natten — å bli begravet med Kristus og stå opp med ham (Rom 6:3-4).',
        liturgicalContext: 'Overgangen fra sort til hvit. Nattstille som brytes av jubel. Kirken er mørk, påskelyset bæres inn, lyset spres fra person til person. Exsultet-hymnen synges. Dåp og dåpspåminnelse. Nattverd feires. Den mest dramatiske gudstjenesten i kirkeåret.',
        history: 'Påskeviglien er den eldste kristne gudstjenesten, kjent fra det 2. århundret. Opprinnelig varte den hele natten og kulminerte med dåp og nattverd ved daggry. I middelalderen ble den gradvis flyttet til lørdag formiddag og mistet sin kraft. Liturgibevegelsen på 1900-tallet gjenopprettet påskenattfeiringen i sin opprinnelige form.',
        otConnections: 'Påskenattens lesninger ER gammeltestamentlige: skapelsen (1 Mos 1-2), syndefloden (1 Mos 7-9), Isaks ofring (1 Mos 22), utgangen fra Egypt (2 Mos 14-15), paktsfornyelse (Jes 55), de tørre knoklene (Esek 37). Hele GT leses som en forberedelse til den tomme graven — frelseshistorien som når sitt klimaks.',
        dates: computeDates(fromEaster(0))
    },
    {
        id: 'paaskedag',
        name: 'Påskedag',
        description: 'Oppstandelsens dag — den kristne troens sentrum og kirkeårets høydepunkt.',
        category: 'easter',
        biblicalBasis: 'Alle fire evangelier forteller om den tomme graven. Tidlig søndag morgen kommer kvinner til graven med salveolje, men finner steinen rullet bort. En engel forkynner: «Han er ikke her, han er oppstått!» I Matteus møter de den oppstandne Jesus på veien tilbake (Matt 28:1-10). I Markus flykter kvinnene i frykt og undring (Mark 16:1-8). I Lukas husker de Jesu ord om at han måtte lide og oppstå (Luk 24:1-12). I Johannes kommer Maria Magdalena alene, finner graven tom og møter Jesus som hun først tror er gartneren — til han sier navnet hennes (Joh 20:1-18). Paulus oppsummerer: «Hvis Kristus ikke er oppstått, da er deres tro uten mening» (1 Kor 15:14).',
        significance: 'Oppstandelsen er bekreftelsen på at Jesu offer ble godtatt av Gud. Døden er beseiret — ikke som en abstrakt idé, men som en historisk hendelse med vitner. Jesus er rettferdiggjort som Guds Sønn (Rom 1:4). De troende har del i oppstandelsen: «Som alle dør i Adam, skal alle få liv i Kristus» (1 Kor 15:22). Dåpen er en deltakelse i Jesu død og oppstandelse (Rom 6:3-4). Uten påskedag faller hele den kristne troen sammen — korset alene er et nederlag, men den tomme graven gjør det til en seier.',
        liturgicalContext: 'Hvit farge. Kirkeårets absolutte høydepunkt, viktigere enn jul. Gudstjenesten preges av jubel, hvite klær, lys og blomster. Påskehilsenen «Kristus er oppstanden! — Ja, han er sannelig oppstanden!» brukes i mange tradisjoner. Påsketiden varer i femti dager frem til pinse. De tidligste kristne feiret oppstandelsen hver søndag — søndagen er «den lille påskedagen». Påskedatoen fastsettes etter den første fullmånen etter vårjevndøgn.',
        history: 'Påske har vært feiret fra den aller tidligste kirken. De første kristne, som var jødiske, feiret oppstandelsen i sammenheng med Pesach. Quartodeciman-striden i det 2. århundret handlet om hvorvidt påske skulle feires på 14. Nisan (sammen med jødisk Pesach) eller alltid på en søndag. Konsilet i Nikea (325) fastslo søndagsregelen. Den vestlige og østlige kirken bruker ulik kalenderberegning, så ortodoks og vestlig påske faller ofte på ulike datoer.',
        otConnections: 'Jonas tre dager og tre netter i fiskens buk er det fremste gammeltestamentlige forbildet på oppstandelsen, som Jesus selv pekte på (Matt 12:40). Isaks «ofring» på Moria-fjellet der Abraham får sønnen tilbake «som fra de døde» (1 Mos 22, jf. Hebr 11:19). Utgangen fra Egypt — som Israel gikk gjennom Rødehavet fra trelldom til frihet, gikk Kristus gjennom døden til oppstandelse. Esekiels syn om de tørre knoklene som får liv (Esek 37). Hosea 6:2: «Den tredje dagen reiser han oss opp.»',
        dates: computeDates(fromEaster(0))
    },
    {
        id: 'andre-paaskedag',
        name: '2. påskedag',
        description: 'Emmausvandrerne møter den oppstandne uten å gjenkjenne ham.',
        category: 'easter',
        biblicalBasis: 'To disipler går fra Jerusalem til Emmaus, nedslåtte etter korsfestelsen (Luk 24:13-35). Jesus slutter seg til dem, men de gjenkjenner ham ikke. Han utlegger Skriftene og viser hvordan alt i Moseloven, profetene og skriftene handler om ham. Ved kveldsmåltidet bryter han brødet — da åpnes øynene deres, og han blir usynlig. «Brant ikke vårt hjerte i oss da han talte til oss på veien og åpnet Skriftene for oss?» De skynder seg tilbake til Jerusalem og forteller de andre.',
        significance: 'Emmaus-beretningen viser at den oppstandne møter mennesker midt i hverdagen — på veien, i samtalen, i brødsbrytelsen. Gjenkjennelsen skjer gjennom Skriften og nattverden, ikke gjennom syner. Hjertet brenner før øynene åpnes — troen begynner innenfra. Disiplenes vending fra flukt til tilbakevending er et bilde på omvendelse.',
        liturgicalContext: 'Hvit farge. Offentlig helligdag i mange land. Emmaus-evangeliet leses tradisjonelt denne dagen. Koblingen mellom Skrift og nattverd gjør teksten liturgisk viktig.',
        history: 'Emmaus-beretningen har vært knyttet til 2. påskedag i vestkirken fra tidlig middelalder. Den har inspirert pilegrimsvandringer og emmausvandringstradisjon i flere land, der menigheten vandrer til et nærliggende kapell.',
        otConnections: 'Jesus utlegger «alt det som stod om ham hos Moses og alle profetene» — GT som helhet peker mot Kristus. Jesaja 53 om den lidende tjener. Salme 16:10: «Du overgir ikke min sjel til dødsriket.» Moses og profetene som vitner om Messias\' lidelse og herlighet.',
        dates: computeDates(fromEaster(1))
    },

    // === PÅSKETIDEN ===
    {
        id: 'paasketiden-2',
        name: '2. søndag i påsketiden',
        description: 'Tomas møter den oppstandne. Tro uten å se.',
        category: 'easter',
        biblicalBasis: 'Tomas var ikke til stede da Jesus viste seg for disiplene og nekter å tro: «Dersom jeg ikke får se naglemerket i hendene hans og stikke fingeren i naglemerket og legge hånden i siden hans, vil jeg ikke tro» (Joh 20:24-29). En uke senere viser Jesus seg igjen: «Rekk fingeren hit... Vær ikke vantro, men troende!» Tomas svarer: «Min Herre og min Gud!» Jesus: «Salig er de som ikke har sett, og likevel tror.»',
        significance: 'Tomas\' tvil er ikke fordømt — Jesus kommer ham i møte. Men saligprisningen gjelder dem som tror uten å se: alle kommende generasjoner av troende. Troen bygger på vitnesbyrdet, ikke på personlig erfaring av den oppstandne. Tomas\' bekjennelse «Min Herre og min Gud» er en av de sterkeste kristologiske bekjennelsene i evangeliene.',
        liturgicalContext: 'Hvit farge. Kalles Quasimodogeniti etter introitusen fra 1 Pet 2:2. I noen tradisjoner også kalt «hvite søndagen» fordi de nydøpte fra påskenatt tok av de hvite dåpsklærne denne dagen.',
        history: 'Denne søndagen avsluttet den eldste påskeoktaven. De som ble døpt i påskenatt bar hvite klær i åtte dager. Tomas-evangeliet har vært knyttet til denne søndagen siden oldkirken.',
        otConnections: 'Habakkuk 2:4: «Den rettferdige skal leve ved sin tro» — tro som tillit uten å se. Abrahams tro på løftet om en sønn han ennå ikke hadde sett (1 Mos 15:6). Gideons tegn med ullfellen (Dom 6:36-40) som en parallell til Tomas\' ønske om bevis.',
        dates: computeDates(fromEaster(7))
    },
    {
        id: 'paasketiden-3',
        name: '3. søndag i påsketiden',
        description: 'Den oppstandne bekrefter seg gjennom måltidsfellesskap.',
        category: 'easter',
        biblicalBasis: 'Jesus viser seg for disiplene ved Tiberias-sjøen (Joh 21:1-19). De har fisket hele natten uten fangst. Jesus sier: «Kast garnet på høyre side!» — de får 153 fisk. Jesus lager frokost på stranden. Tre ganger spør han Peter: «Elsker du meg?» Tre ganger svarer Peter ja. Tre ganger sier Jesus: «Fø mine lam/sauer.» Gjennopprettelsen etter Peters tre fornektelser.',
        significance: 'Den oppstandne Jesus oppsøker disiplene i deres hverdag — ved fiskebåten, på stranden, i måltidet. Peters tredobbelte gjeninnsettelse speiler hans tredobbelte fornektelse. Tilgivelse og nytt oppdrag hører sammen. Kallet til å fø fårene er kallet til hyrdetjeneste i Jesu sted.',
        liturgicalContext: 'Hvit farge. Denne søndagen har tradisjonelt hatt fokus på gjenkjennelse og gjeninnsettelse — den oppstandne gir nytt oppdrag til de som sviktet.',
        history: 'Frokostscenen ved sjøen har vært brukt i katekese om forsoning og kall siden oldkirken. Tallet 153 har fascinert teologer: Hieronymus mente det representerte alle kjente fiskearter — altså alle folkeslag.',
        otConnections: 'Hyrdemotivet fra Esekiel 34 der Gud selv vil gjete sine sauer. Moses som hyrde for flokken og ble kalt til å lede folket (2 Mos 3). Elias\' kall av Elisja som var i arbeid ved plogen (1 Kong 19:19-21) — kallet kommer midt i hverdagen.',
        dates: computeDates(fromEaster(14))
    },
    {
        id: 'paasketiden-4',
        name: '4. søndag i påsketiden',
        description: 'Den gode hyrde. Jesus gir livet for fårene.',
        category: 'easter',
        biblicalBasis: '«Jeg er den gode hyrden. Den gode hyrden gir livet sitt for fårene» (Joh 10:1-18). Jesus kjenner sine sauer ved navn og de kjenner hans røst. Leiesvennen flykter når ulven kommer, men den gode hyrden gir livet. «Jeg har også andre sauer som ikke hører til denne flokken.» Salme 23: «Herren er min hyrde, jeg mangler ingenting.»',
        significance: 'Hyrdemetaforen uttrykker nærhet, omsorg og offer. Jesus kjenner hver enkelt ved navn — troen er personlig, ikke bare kollektiv. At han gir livet «frivillig» understreker at korset ikke var et uhell men en handling av kjærlighet. «Andre sauer» peker mot hedningemisjon — flokken er større enn Israel.',
        liturgicalContext: 'Hvit farge. Tradisjonelt kalt «Den gode hyrdes søndag». Mange kirker bruker dagen til å be for kall til prestetjeneste og hyrdetjeneste. Salme 23 synges eller leses.',
        history: 'Hyrdebildet er det eldste kristne kunstmotivet — fra katakombene i Roma (200-tallet). Den gode hyrde med sauen på skuldrene ble et av de første Jesus-bildene, brukt før krusifikset.',
        otConnections: 'Salme 23 — Herren som hyrde. Esekiel 34 der Gud kritiserer Israels ledere (dårlige hyrder) og lover å selv gjete flokken. Jesaja 40:11: «Som en hyrde gjeter han sin flokk.» 1 Mosebok 48-49 om Gud som Jakobs hyrde. Mika 5:3 om herskeren fra Betlehem som skal gjete i Herrens kraft.',
        dates: computeDates(fromEaster(21))
    },
    {
        id: 'paasketiden-5',
        name: '5. søndag i påsketiden',
        description: 'Veien, sannheten og livet. Vintreet og grenene.',
        category: 'easter',
        biblicalBasis: 'Jesu avskjedstale: «Jeg er veien, sannheten og livet. Ingen kommer til Far uten ved meg» (Joh 14:6). «Jeg er det sanne vintreet, og min Far er vingårdsmannen... Bli i meg, så blir jeg i dere. Den som blir i meg og jeg i ham, bærer mye frukt» (Joh 15:1-8). Kjærlighetsbudet: «Elsk hverandre slik jeg har elsket dere. Ingen har større kjærlighet enn den som gir livet sitt for sine venner» (Joh 15:12-13).',
        significance: 'Vintreet og grenene er det sterkeste bildet på fellesskapet mellom Kristus og de troende — uten tilknytning ingen frukt. Å «bli i» Kristus er ikke mystisk verdenflukt men praktisk kjærlighet. Kjærlighetsbudet er ikke en ny lov men en konsekvens av å være forbundet med ham som er kjærligheten selv.',
        liturgicalContext: 'Hvit farge. Avskjedstalens tematikk preger søndagene mot himmelfart — Jesus forbereder disiplene på sitt fravær og Åndens komme.',
        history: 'Vintreet som bilde på Guds folk er gjennomgående i kristen kunst og teologi. Kirkefedrene (spesielt Augustin) brukte vintre-lignelsen som hovedtekst for å forklare nådens nødvendighet og troens frukt.',
        otConnections: 'Israel som Guds vingård i Jesaja 5:1-7 — vingården som ikke bar frukt. Salme 80:9-16 om vintreet Gud plantet fra Egypt. Hosea 10:1 om Israel som et frodig vintre. Jesus er det «sanne» vintreet — oppfyllelsen av det Israel var ment å være.',
        dates: computeDates(fromEaster(28))
    },
    {
        id: 'paasketiden-6',
        name: '6. søndag i påsketiden',
        description: 'Bønnens søndag. Jesu yppersteprestlige bønn.',
        category: 'easter',
        biblicalBasis: 'Jesus ber sin store bønn for disiplene og alle som skal komme til tro (Joh 17): «Hellige Far, bevar dem i ditt navn... at de alle må være ett, likesom du, Far, er i meg og jeg i deg.» Løftet: «Be, og dere skal få, så gleden deres kan være fullkommen» (Joh 16:24). «Hittil har dere ikke bedt om noe i mitt navn. Be, og dere skal få.»',
        significance: 'Den yppersteprestlige bønn gir innblikk i Jesu dypeste ønske: enhet mellom de troende, forankret i enheten mellom Faderen og Sønnen. Bønn er ikke å overtale Gud, men å tre inn i fellesskapet mellom Fader og Sønn gjennom Ånden. Gleden er ikke avhengig av omstendighetene men av relasjonen til Gud.',
        liturgicalContext: 'Hvit farge. Siste søndag før himmelfart i noen tradisjoner. Rogasjonsdagene (bededagene) faller i denne uken i vestkirken — bønn for årets avlinger og Guds velsignelse.',
        history: 'Rogasjonsdagene (de tre dagene før himmelfart) ble innført av biskop Mamertus i Vienne ca. 470, opprinnelig som bønne- og botsprosesjon ved naturkatastrofer. De ble senere en fast del av kirkekalenderen med fokus på bønn for daglig brød.',
        otConnections: 'Salomos tempelinnvielsesbønn (1 Kong 8:22-53) — en bønn for hele folket i Guds nærvær. Abrahams forbønn for Sodoma (1 Mos 18:22-33). Moses\' forbønn for folket etter gullkalven (2 Mos 32:11-14). Daniels bønn om Jerusalems gjenreisning (Dan 9:1-19).',
        dates: computeDates(fromEaster(35))
    },

    // === HIMMELFART OG PINSE ===
    {
        id: 'kristi-himmelfartsdag',
        name: 'Kristi himmelfartsdag',
        description: 'Jesus farer opp til himmelen og gir misjonsbefalingen.',
        category: 'ascension',
        biblicalBasis: 'Førti dager etter oppstandelsen farer Jesus opp til himmelen fra Oljeberget (Apg 1:6-11). Han gir disiplene løftet: «Dere skal få kraft idet Den Hellige Ånd kommer over dere, og dere skal være mine vitner til jordens ender.» To menn i hvite klær sier: «Denne Jesus som ble tatt opp fra dere til himmelen, han skal komme igjen på samme måte.» Misjonsbefalingen: «Meg er gitt all makt i himmel og på jord. Gå derfor ut og gjør alle folkeslag til disipler» (Matt 28:18-20). Lukas 24:50-53: Jesus velsigner dem og farer opp.',
        significance: 'Himmelfarten betyr ikke at Jesus forlater verden, men at han regjerer fra Guds høyre hånd med all makt. Kristus er ikke borte — han er allestedsnærværende gjennom Ånden. Misjonsbefalingen er konsekvensen: fordi all makt er gitt ham, skal evangeliet nå ut til alle folk. Løftet om Ånden fyller ventetiden med forventning, ikke tomhet.',
        liturgicalContext: 'Hvit farge. Feires på torsdag (40 dager etter påske). Offentlig helligdag i mange land. Noen tradisjoner slukker påskelyset denne dagen som symbol på Jesu synlige fravær. De ti dagene mellom himmelfart og pinse er en bønnetid.',
        history: 'Himmelfartsdag er kjent som egen feiring fra 300-tallet (tidligere feiret sammen med pinse). Augustin kaller den en av de eldste kristne festene. I middelalderen ble det vanlig med dramatiske fremstillinger der en Kristus-figur ble heist opp gjennom et hull i kirketaket.',
        otConnections: 'Elias\' himmelfart i ildvognen — Elisja tar opp Elias\' kappe og får dobbel del av hans ånd (2 Kong 2:1-15). En direkte parallell: som Elias farer opp og Elisja får ånden, farer Jesus opp og disiplene får Ånden. Salme 47: «Gud farer opp under jubelrop.» Salme 110:1: «Sett deg ved min høyre hånd.» Daniel 7:13-14 om Menneskesønnen som føres frem for Gud og får evig herredømme.',
        dates: computeDates(fromEaster(39))
    },
    {
        id: 'soendag-foer-pinse',
        name: 'Søndag før pinse',
        description: 'Ventingen på Den Hellige Ånd mellom himmelfart og pinse.',
        category: 'pentecost',
        biblicalBasis: 'Disiplene samles i bønn i Jerusalem og venter på løftet (Apg 1:12-14). Jesus hadde sagt: «Jeg vil ikke la dere bli igjen som foreldreløse barn. Jeg kommer til dere» (Joh 14:18). «Talsmannen, Den Hellige Ånd, som Faderen skal sende i mitt navn, han skal lære dere alt» (Joh 14:26). «Det er til gagn for dere at jeg går bort. For går jeg ikke bort, kommer ikke Talsmannen til dere» (Joh 16:7).',
        significance: 'Ventingen er ikke passiv — disiplene er samlet i bønn og fellesskap. Jesus forklarer at hans fysiske fravær er nødvendig for at Åndens universelle nærvær skal bli mulig. Ånden er ikke en erstatning for Jesus, men hans nærvær i ny form — «en annen talsmann», som skal «lede dere til hele sannheten».',
        liturgicalContext: 'Hvit eller rød farge. Bønnepreg — samling i venting. Noen tradisjoner har bønnenatt denne lørdagen som forberedelse til pinse.',
        history: 'De ti dagene mellom himmelfart og pinse var fra tidlig kirketid en særlig bønnetid. Pinsenovenen (ni dagers bønn) har røtter i disiplenes venting i øvre sal. Ordet «novene» (ni dager) kommer nettopp herfra.',
        otConnections: 'Elia ved Horeb som ventet på Herrens komme — ikke i stormen, ikke i jordskjelvet, ikke i ilden, men i den stille susen (1 Kong 19:11-13). Israels venting i ørkenen mellom utgangen og lovgivningen — femti dager fra Pesach til Sinai.',
        dates: computeDates(fromEaster(42))
    },
    {
        id: 'pinsedag',
        name: 'Pinsedag',
        description: 'Den Hellige Ånd utgytes. Kirkens fødselsdag.',
        category: 'pentecost',
        biblicalBasis: 'Femti dager etter påske: «De ble alle fylt av Den Hellige Ånd og begynte å tale på andre tungemål» (Apg 2:1-13). Et kraftig vindkast fyller huset, tunger av ild setter seg på hver av dem. Jøder fra alle folkeslag hører sitt eget språk. Peter holder sin første preken og siterer Joel 3:1-5: «Jeg vil utøse min Ånd over alle mennesker.» Tre tusen blir døpt (Apg 2:14-41).',
        significance: 'Pinsen er Åndens dag og kirkens fødselsdag. Språkunderet er en reversering av Babel-forvirringen (1 Mos 11) — det som splitter mennesker, forenes i Ånden. Joels profeti oppfylles: Ånden gis ikke bare til profeter og konger, men til alle — sønner og døtre, unge og gamle, slaver og frie. Kirken fødes som et fellesskap av alle folkeslag.',
        liturgicalContext: 'Rød farge (Åndens ild). En av kirkeårets tre store høytider (jul, påske, pinse). Noen tradisjoner slipper duer, blåser vind i kirken, eller taler på mange språk. Konfirmasjon er tradisjonelt knyttet til pinsen. Pinsedagen avslutter påsketiden.',
        history: 'Pinsen ble feiret fra den tidligste kirketid som avslutning på de femti dagene etter påske. Dåpen ble tidlig knyttet til pinse i tillegg til påskenatt. Pinsefeiringen faller på Shavuot — den jødiske ukefesten som feirer lovgivningen på Sinai. Kirkefedre (spesielt Augustin) så parallellen: på Sinai ble loven gitt på steintavler, i pinsen ble loven skrevet i hjertene ved Ånden.',
        otConnections: 'Joel 3:1-5 om Åndens utgytelse over alle mennesker (Peters hovedsitat). Babels språkforvirring (1 Mos 11) reverseres. Sinai-teofanien med ild, vind og guddommelig tale (2 Mos 19-20) — pinseberetningen speiler Sinai med tunger av ild og stormen. Esekiel 37 der Ånden (ruach) blåser liv i de tørre knoklene. Jesaja 44:3: «Jeg vil øse ut vann over det tørstige land og min Ånd over din ætt.» Numeri 11:29 der Moses ønsker at hele folket hadde fått Guds Ånd.',
        dates: computeDates(fromEaster(49))
    },
    {
        id: 'andre-pinsedag',
        name: '2. pinsedag',
        description: 'Den første menighetens liv og Åndens gaver.',
        category: 'pentecost',
        biblicalBasis: 'Den første menighetens fellesskap: «De holdt seg trofast til apostlenes lære og fellesskapet, til brødsbrytelsen og bønnene... De var sammen og hadde alt felles» (Apg 2:42-47). Åndens gaver: visdom, kunnskap, tro, helbredelse, profeti, tungetale, tydning (1 Kor 12:4-11). Åndens frukt: kjærlighet, glede, fred, tålmodighet, vennlighet, godhet, trofasthet, ydmykhet, selvbeherskelse (Gal 5:22-23). «Dere er Kristi legeme, og hver av dere er et lem på det» (1 Kor 12:27).',
        significance: 'Ånden skaper ikke bare individuelle opplevelser, men fellesskap. Menigheten som Kristi legeme har mange lemmer med ulike funksjoner — mangfoldet er tilsiktet. Åndens frukt (Gal 5) er mer grunnleggende enn de spektakulære gavene — kjærligheten er den «veien som overgår alle andre» (1 Kor 13).',
        liturgicalContext: 'Rød farge. Offentlig helligdag i mange land. Fokuset utvides fra Åndens komme til Åndens vedvarende virke i menigheten. Noen tradisjoner har fokus på misjon og diakoni denne dagen.',
        history: 'I oldkirken ble hele pinse-uken feiret. 2. pinsedag ble beholdt som helligdag i mange protestantiske land etter reformasjonen. Luther la vekt på Åndens virke gjennom ord og sakramenter i menighetens fellesskap.',
        otConnections: 'Fellesskapsmotivet: Israels leir i ørkenen der folket levde sammen rundt tabernakelet (4 Mos 2). Gavemotivet: Bezalel og Oholiab som fikk Ånden til å bygge tabernakelet med ulike håndverksgaver (2 Mos 31:1-6). De 70 eldste som fikk del i Moses\' ånd (4 Mos 11:16-17, 24-30).',
        dates: computeDates(fromEaster(50))
    },

    // === TREENIGHETSTIDEN ===
    {
        id: 'treenighetssoendag',
        name: 'Treenighetssøndag',
        description: 'Feiringen av den treenige Gud — Fader, Sønn og Hellig Ånd.',
        category: 'trinity',
        biblicalBasis: 'Nikodemus\' nattesamtale med Jesus: «Ingen kan se Guds rike uten å bli født på ny av vann og Ånd» (Joh 3:1-17). Dåpsbefalingen i treenighetens navn: «Døp dem til Faderens og Sønnens og Den Hellige Ånds navn» (Matt 28:19). Jesajas tempelsyn med serafenes tredobbelte «Hellig, hellig, hellig er Herren Sebaot» (Jes 6:1-8). Paulus\' velsignelse: «Herren Jesu Kristi nåde, Guds kjærlighet og Den Hellige Ånds fellesskap» (2 Kor 13:13).',
        significance: 'Treenighetssøndag er den eneste dagen som feirer en lære snarere enn en hendelse. Etter å ha feiret Guds gjerninger gjennom hele kirkeåret (Faderens skapelse, Sønnens frelse, Åndens komme), samles det hele i bekjennelsen av den ene Gud i tre personer. Treenighetslæren er ikke abstrakt spekulasjon men uttrykk for den kristne gudserfaring: skapt av Faderen, forløst av Sønnen, levendegjort av Ånden.',
        liturgicalContext: 'Hvit farge. Første søndag etter pinse. Starten på treenighetstiden (den lengste perioden i kirkeåret, som varer til advent). Den nikenske trosbekjennelse brukes ofte denne søndagen. Athanasianum (den athanasianske trosbekjennelse) ble tradisjonelt lest denne dagen.',
        history: 'Treenighetssøndagen ble en fast del av vestkirkens kalender i 1334 under pave Johannes XXII, men ble feiret lokalt fra 900-tallet. Østkirken har ikke en egen treenighetssøndag — de mener at hver søndag feirer treenighetens mysterium. Luther verdsatte dagen men advarte mot å gjøre treenighetslæren til abstrakt filosofi.',
        otConnections: 'Jesaja 6:3 — det tredobbelte «hellig» tolkes i kristen tradisjon som en hentydning til treenighetens tre personer. 1 Mosebok 1:26: «La oss gjøre mennesker i vårt bilde» — flertallsformen. Ånden som svever over vannene (1 Mos 1:2) og Guds ord som skaper (1 Mos 1:3) — Ånd og Ord som aktive i skapelsen.',
        dates: computeDates(fromEaster(56))
    },
    {
        id: 'vingaardssoendag',
        name: 'Vingårdssøndag',
        description: 'Guds vingård og nådens overraskende logikk.',
        category: 'trinity',
        biblicalBasis: 'Lignelsen om arbeiderne i vingården der alle får lik lønn uansett når de begynte: «Er du misunnelig fordi jeg er god?» (Matt 20:1-16). Lignelsen om de troløse vingårdsarbeiderne som dreper eierens tjenere og til slutt hans sønn (Matt 21:33-46). Jesajas sang om vingården som Gud plantet, gjødslet og ventet frukt fra — men den bar bare ville druer (Jes 5:1-7).',
        significance: 'Vingården er et gjennomgående bilde på Guds folk og hans forventning om frukt. Arbeiderlignelsen snur menneskelig rettferdighetstenkning på hodet: Guds nåde er ikke lønn etter fortjeneste, men gavmild godhet — «de siste skal bli de første». De troløse arbeiderne advarer mot å ta Guds tålmodighet for gitt. Jesajas vingårdssang er en dom over ufruktbarhet.',
        liturgicalContext: 'Grønn farge. Plassert i treenighetstiden. Vingårdsmetaforen har gjort denne søndagen til en naturlig dag for å reflektere over forholdet mellom nåde og ansvar, gave og frukt.',
        history: 'Vingårdsmotivet er et av de mest brukte i kirkens kunsthistorie — fra katakomber til middelalderens glassmalerier. Luther brukte arbeiderlignelsen til å understreke nåden alene (sola gratia): Gud lønner ikke etter fortjeneste.',
        otConnections: 'Jesaja 5:1-7 — vingårdssangen som kjernetekst. Salme 80:9-16 om vintreet Gud plantet fra Egypt. Hosea 10:1 om Israel som frodig vintre. Jeremia 2:21 om det edle vintreet som ble til ville ranker. Disse GT-tekstene danner bakteppet for Jesu bruk av vingårdsmetaforen.',
        dates: computeDates(vingaardssoendag)
    },

    // === SPESIELLE DAGER ===
    {
        id: 'sankthansdagen',
        name: 'Sankthansdagen / Jonsok',
        description: 'Johannes døperens fødsel — forløperen som beredte veien.',
        category: 'special',
        biblicalBasis: 'Sakarias og Elisabet får løftet om en sønn i sin alderdom (Luk 1:5-25). Engelen Gabriel forkynner: «Han skal bli stor for Herren... fylt av Den Hellige Ånd helt fra mors liv... han skal gå foran med Elias\' ånd og kraft» (Luk 1:15-17). Johannes\' fødsel og Sakarias\' lovsang — Benedictus (Luk 1:57-80). Johannes\' eget vitnesbyrd: «Han skal vokse, jeg skal avta» (Joh 3:30). Datoen 24. juni bygger på Lukas 1:36 — Elisabet var i sjette måned da Maria fikk sitt budskap.',
        significance: 'Johannes er bindeleddet mellom den gamle og den nye pakt — den siste profeten som peker direkte på Guds lam. Hans ydmykhet («jeg er ikke verdig til å løse sandalremmen hans») og hans vilje til å tre tilbake er et forbilde. At han fødes seks måneder før Jesus speiles i solhvervet: fra Jonsok blir dagene kortere — «han skal avta» — mot jul blir de lengre — «han skal vokse».',
        liturgicalContext: 'Hvit farge. Feires 24. juni. En av få helgendager som feirer fødselen (sammen med jul og Maria budskapsdag). I Norden sammenfaller dagen med midtsommerfeiring og sankthansaften med bål.',
        history: 'Feiringen av Johannes\' fødsel 24. juni er kjent fra 300-400-tallet. Datoen er satt seks måneder før jul (25. desember) basert på Luk 1:36. I nordisk folkekulturel ble sankthansaften (23. juni) forbundet med midtsommer, bål og lys — kristen og førkristen tradisjon smeltet sammen.',
        otConnections: 'Malaki 4:5-6 om Elias som skal komme før Herrens dag — Jesus identifiserer Johannes som denne Elias (Matt 11:14). Jesaja 40:3 om røsten i ørkenen. Barneløse par som får barn ved Guds inngripen: Abraham og Sara, Hanna og Elkana — Sakarias og Elisabet står i denne tradisjonen.',
        dates: computeDates(fixed(6, 24))
    },
    {
        id: 'mikkelsmesse',
        name: 'Mikkelsmesse',
        description: 'Erkeengelen Mikael og englenes tjeneste.',
        category: 'special',
        biblicalBasis: 'Mikael kjemper mot dragen: «Det brøt ut en krig i himmelen. Mikael og englene hans gikk til krig mot dragen» (Åp 12:7-12). Daniel 10:13 og 12:1 om Mikael som den store fyrsten som står opp for folket. Jakobs drøm om stigen mellom jord og himmel med engler som gikk opp og ned (1 Mos 28:12). Jesu ord: «Se til at dere ikke forakter en eneste av disse små, for deres engler i himmelen ser alltid min himmelske Fars ansikt» (Matt 18:10). Hebreerbrevet 1:14 om englene som tjenende ånder.',
        significance: 'Englene vitner om at virkeligheten er større enn det synlige. Mikael representerer Guds kamp mot det onde — en kamp som allerede er vunnet, men som fortsatt utspilles. Englene i Bibelen er ikke søte figurer, men mektige budbærere som ofte sier «Frykt ikke!» De tjener Gud ved å beskytte, veilede og forkynne.',
        liturgicalContext: 'Hvit farge. Feires 29. september. I luthersk tradisjon feires dagen for Mikael og alle engler — ikke bare Mikael alene. I folkelig tradisjon markerte mikkelsmesse sommerens slutt og høstens begynnelse.',
        history: 'Feiringen 29. september er kjent fra 400-500-tallet, opprinnelig knyttet til innvielsen av en Mikael-kirke i Roma. I middelalderen var mikkelsmesse en av de store årsfestene med marked og regnskapssoppgjør. Mikael-kulten var sterk i hele Europa.',
        otConnections: 'Jakobs stige (1 Mos 28:12) — englene som formidlere mellom himmel og jord. Bileams esel som ser engelen mennesket ikke kan se (4 Mos 22:21-35). Engelen som vokter veien til livets tre (1 Mos 3:24). Serafene i Jesajas tempelsyn (Jes 6). Englene som ledsager Israel gjennom ørkenen (2 Mos 23:20).',
        dates: computeDates(fixed(9, 29))
    },
    {
        id: 'bots-og-boennedag',
        name: 'Bots- og bønnedag',
        description: 'Dag for bot, selvransakelse og omvendelse.',
        category: 'special',
        biblicalBasis: 'Jesu lignelse om tolleren og fariseeren: tolleren slår seg for brystet og ber «Gud, vær meg synder nådig!» og går hjem rettferdiggjort (Luk 18:9-14). Davids botssalme: «Skap i meg et rent hjerte, Gud, gi meg en ny og stødig ånd» (Sal 51). Joel 2:12-13: «Vend om til meg av hele deres hjerte, med faste og gråt og klage. Riv hjertet i stykker, ikke klærne!» Profetenes gjennomgående kall til omvendelse.',
        significance: 'Botsdagen minner om at synd er en realitet som krever erkjennelse — men at Guds barmhjertighet alltid er større. Tolleren, ikke fariseeren, går rettferdiggjort hjem: den som kjenner sin nød, finner nåde. Boten er ikke selvplaging men sannferdighet innfor Gud, og bønnen er ikke prestasjon men tillit til hans godhet.',
        liturgicalContext: 'Fiolett farge. Plassert i treenighetstiden, mot slutten av kirkeåret. Har tradisjonelt hatt preg av syndsbekjennelse og skriftemål. I norsk tradisjon har den vekslet mellom å være offentlig helligdag og vanlig søndag.',
        history: 'Botsdager har vært feiret i protestantiske kirker siden 1500-tallet, ofte utlyst ved kriser og katastrofer. I skandinavisk tradisjon ble den en fast årlig dag. Luther la vekt på daglig omvendelse — boten er ikke en engangshandling men en grunnholdning i det kristne livet.',
        otConnections: 'Salme 51 — Davids bot etter synden med Batseba. Jona 3 om Ninives omvendelse. Joel 2:12-14 om å rive hjertet i stykker. Nehemja 9 om folkets store syndsbekjennelse etter hjemkomsten fra eksil. Daniel 9 om bønn og bot i eksil.',
        dates: computeDates(botsOgBoennedag)
    },
    {
        id: 'allehelgensdag',
        name: 'Allehelgensdag',
        description: 'Minnet om alle troende som har gått foran. Håpet om oppstandelsen.',
        category: 'special',
        biblicalBasis: 'Den store hvite flokk: «Etter dette så jeg en stor skare som ingen kunne telle, av alle nasjoner og stammer og folk og tungemål. De stod foran tronen og foran Lammet, kledd i hvite kapper» (Åp 7:9-17). Saligprisningene: «Salige er de fattige i ånden... salige er de som sørger... salige er de som er forfulgt for rettferdighets skyld» (Matt 5:1-12). Hebreerbrevet 12:1-2: «Når vi har en så stor sky av vitner omkring oss.» Jesu løfte: «Den som tror på meg, skal leve om han enn dør» (Joh 11:25-26).',
        significance: 'Allehelgensdag feirer ikke bare berømte helgener, men alle troende — den ukjente bestemoren som bad, den navnløse martyren, enhver som levde i tro. Døden er ikke det siste — de troende er «omgitt av en sky av vitner». Dagen gir rom for sorg og håp samtidig: savnet er reelt, men oppstandelseshåpet er sterkere.',
        liturgicalContext: 'Hvit farge. Feires første søndag i november i luthersk tradisjon. I norsk tradisjon også minnedag for egne avdøde — lys tennes på gravene. Kombinerer festlig helgenminne med personlig sorg og håp.',
        history: 'Feiringen av alle helgener er kjent fra 300-400-tallet, opprinnelig knyttet til martyrminne. Pave Gregor III (731) vigslet et kapell til alle helgener 1. november. Luthersk tradisjon beholdt dagen men fjernet helgendyrkelsen — fokuset ble på troens forbilde og oppstandelseshåpet.',
        otConnections: 'Hebreerbrevet 11 — troens vitner fra Abel til profetene: «Alle disse fikk godt vitnesbyrd for sin tro.» Esekiel 37 om de tørre knoklene som får liv — oppstandelseshåpet i GT. Jesaja 25:6-9: «Han skal sluke døden for evig. Herren Gud skal tørke tårene av hvert ansikt.» Daniel 12:2-3 om oppstandelsen til evig liv.',
        dates: computeDates(allehelgensdag)
    },
    {
        id: 'domssoendag',
        name: 'Domssøndag / Kristi kongedag',
        description: 'Kirkeårets siste søndag. Kristi gjenkomst og den endelige dommen.',
        category: 'special',
        biblicalBasis: 'Lignelsen om sauene og geitene: «Kom hit, dere som er velsignet av min Far, og ta i arv det riket som er gjort i stand for dere... Det dere gjorde mot én av disse mine minste søsken, har dere gjort mot meg» (Matt 25:31-46). Daniels syn om Menneskesønnen: «En som var lik en menneskesønn, kom med himmelens skyer... Han fikk herredømme, ære og rike» (Dan 7:13-14). Åpenbaringen 21:1-5 om den nye himmel og den nye jord: «Se, jeg gjør alle ting nye.»',
        significance: 'Kirkeåret ender med blikket fremover — Kristus som kommer igjen som dommer og konge. Dommen i Matt 25 er overraskende konkret: det er handlingene mot «de minste» som avgjør. Kristi kongevelde er ikke en fjern fremtidshendelse — det er en nåtidig realitet som skal fullbyrdes. Historien har et mål: Guds rike fullendes.',
        liturgicalContext: 'Hvit eller grønn farge. Kirkeårets siste søndag — neste søndag er 1. søndag i advent og et nytt kirkeår begynner. Sirkelen sluttes: fra venting (advent) gjennom fødsel, død, oppstandelse og Åndens virke til dommen og fullendelsen.',
        history: 'Kristi kongedag ble innført i den katolske kirken av Pius XI i 1925, men temaet om dom og gjenkomst på kirkeårets siste søndag er langt eldre i protestantisk tradisjon. Luther la vekt på Kristi kongevelde som en trøst for de troende og en advarsel til undertrykkere.',
        otConnections: 'Daniel 7:13-14 om Menneskesønnen som kjernetekst. Jesaja 65:17 og 66:22 om den nye himmel og den nye jord. Sakarja 14:9: «Herren skal være konge over hele jorden.» Salme 96 og 98 om at Herren kommer for å dømme jorden. Jesaja 11:1-9 om fredsriket der ulven bor med lammet.',
        dates: computeDates(domssoendag)
    },

    // === JØDISKE HØYTIDER ===
    {
        id: 'pesach',
        name: 'Pesach (Påske)',
        description: 'Den viktigste jødiske høytiden — utgangen fra Egypt og befrielsen fra slaveriet.',
        category: 'jewish',
        biblicalBasis: 'Innstiftelsen i 2 Mosebok 12: påskelammet slaktes, blodet strykes på dørstolpene, og Herren «går forbi» (pesach) de merkede husene når han slår ned de førstefødte i Egypt. Usyret brød spises i syv dager til minne om hastverket ved utvandringen (2 Mos 12:14-20). Gjennomgangen av Rødehavet (2 Mos 14). Seder-måltidet gjenforteller frelseshistorien med spørsmålet «Hvorfor er denne natten annerledes enn alle andre netter?» (etter Misjna Pesachim 10:4).',
        significance: 'Pesach er det jødiske folks grunnfortelling — befrielsen fra slaveriet definerer Israels identitet. Gud hører sitt folks rop og griper inn. Påskelammet og blodet på dørstolpene danner det direkte forbildet for kristen teologi om Kristus som Guds lam (Joh 1:29, 1 Kor 5:7). Nattverden ble innstiftet under et pesach-måltid.',
        liturgicalContext: 'Pesach begynner 15. Nisan i den hebraiske kalenderen og varer syv (i diaspora åtte) dager. Seder-kvelden med Haggadah-lesning er det liturgiske høydepunktet. Hallel-salmene (Sal 113-118) synges. Den kristne påskens dato er knyttet til Pesach gjennom påskeberegningen.',
        history: 'Pesach er feiret kontinuerlig i over 3000 år. Tempelet i Jerusalem var sentrum for feiringen med masseofring av påskelam. Etter templets ødeleggelse (70 e.Kr.) ble hjemmefeiringen (seder) den bærende formen. Haggadah-teksten tok form gjennom de første århundrene e.Kr.',
        otConnections: 'Hele 2. Mosebok 1-15 er Pesach-narrativet. 5 Mosebok 16:1-8 om pesach-feiringen. Josva 5:10-12 — den første pesach i det lovede land. 2 Krønikebok 30 og 35 om Hiskias og Josias\' pesach-reformer. Esekiel 45:21-24 om pesach i det fremtidige tempel.',
        dates: jewishHolidayDates('pesach')
    },
    {
        id: 'shavuot',
        name: 'Shavuot (Ukefesten)',
        description: 'Lovgivningen på Sinai og førstegrødens høytid, femti dager etter Pesach.',
        category: 'jewish',
        biblicalBasis: 'Budet i 5 Mosebok 16:9-12: «Tell sju uker fra den dagen sigden settes i kornet, og hold så Ukefesten for Herren din Gud.» 3 Mosebok 23:15-21 om frembæring av førstegrøden. 2 Mosebok 19-20 om åpenbaringen på Sinai der folket mottar De ti bud. Ruts bok leses under Shavuot — hennes historie utspiller seg i kornhøsten, og hun er et forbilde på den som frivillig velger Torah og Israels Gud.',
        significance: 'Shavuot kobler høstfest og åpenbaring: Gud gir både brød og lov. Mottagelsen av Torah definerer Israel som et paktsfolk. At den kristne pinsen falt på Shavuot (Apg 2) er teologisk ladet — den gamle pakts lov på steintavler erstattes av den nye pakts lov skrevet i hjertene ved Ånden (Jer 31:31-34, 2 Kor 3:3).',
        liturgicalContext: 'Feires 6. Sivan (50 dager etter Pesach). I synagogen leses De ti bud og Ruts bok. Tradisjonen med å spise melkeprodukter. Tikkun Leil Shavuot — nattlig Torah-studium.',
        history: 'I bibelsk tid primært en jordbrukshøytid. Koblingen til Sinai-åpenbaringen utviklet seg i rabbinsk tid (etter templets fall). Filons skrifter (1. århundre) er blant de tidligste kildene som knytter Shavuot til lovgivningen.',
        otConnections: '2 Mosebok 19-20 — teofanien på Sinai med torden, ild og Guds stemme. Jer 31:31-34 om den nye pakten med loven skrevet i hjertene. Ruts bok i sin helhet. 2 Krønikebok 15:10-15 om paktsfornyelse under Asa.',
        dates: jewishHolidayDates('shavuot')
    },
    {
        id: 'rosh-hashana',
        name: 'Rosh Hashana (Nyttår)',
        description: 'Det jødiske nyttåret med shofarblåsing og kall til omvendelse.',
        category: 'jewish',
        biblicalBasis: '3 Mosebok 23:23-25: «I den sjuende måneden, på den første dagen, skal dere ha sabbatsfeiring med basunklang.» 4 Mosebok 29:1-6 om ofrene på basundagen. Shofar-hornet blåses hundre ganger i synagogen. 1 Mosebok 22 (Binding av Isak/Akedat Yitzhak) leses — væren som ofres i stedet for Isak knytter an til shofarens værehorn.',
        significance: 'Rosh Hashana markerer begynnelsen på «de ti ærefrykts dagene» (Yamim Noraim) som kulminerer i Yom Kippur. Shofarens lyd er et vekkerrop — kall til selvransakelse og omvendelse. Tradisjonelt regnet som verdens skaperdag og Guds domsdag der han åpner tre bøker: for de rettferdige, de ugudelige og de midt imellom.',
        liturgicalContext: 'Feires 1.-2. Tishri. Spesielle bønner (Unetanneh Tokef: «Hvem skal leve og hvem skal dø»). Tashlich — symbolsk kasting av synder i rinnende vann. Epler i honning — ønske om et godt og søtt nytt år.',
        history: 'Bibelen kaller dagen «basundagen» (Yom Teruah), ikke «nyttår». Betegnelsen Rosh Hashana («årets begynnelse») er fra Misjna-tiden. Rabbinsk tradisjon utviklet de fire nyttårene — Tishri for verdens skapelse og dom, Nisan for konger og høytider.',
        otConnections: 'Shofar i Bibelen: ved Sinai (2 Mos 19:16), ved Jerikos fall (Jos 6), i Salme 81:4 og 98:6. Jesaja 27:13 om den store shofar som skal blåses den dagen. Binding av Isak (1 Mos 22) som hovedlesning. Hannas bønn (1 Sam 1-2) — hun som fikk Samuel, «den etterlengtede».',
        dates: jewishHolidayDates('rosh_hashana')
    },
    {
        id: 'yom-kippur',
        name: 'Yom Kippur (Den store forsoningsdagen)',
        description: 'Den helligste dagen i jødisk kalender — faste, soning og forsoning.',
        category: 'jewish',
        biblicalBasis: '3 Mosebok 16 beskriver ritualet i detalj: øverstepresten skifter til hvite linklær, ofrer en okse for seg selv, velger to bukker — én til Herren (syndoffer) og én til Asasel (syndebukken som sendes ut i ørkenen med folkets synder). Han går inn i Det aller helligste med røkelse og blod og skvetter blodet på soningslokket på paktskisten. 3 Mosebok 23:26-32: «Dere skal faste og ydmyke dere... den som ikke ydmyker seg, skal utryddes.»',
        significance: 'Yom Kippur er den eneste dagen øverstepresten gikk inn i Det aller helligste — Guds direkte nærvær. Hebreerbrevet tolker dette som et forbilde på Kristus: «Kristus kom som øversteprest... Han gikk inn i den himmelske helligdommen, én gang for alle, ikke med blod av bukker og kalver, men med sitt eget blod, og fant en evig forløsning» (Hebr 9:11-12). Syndebukken bærer folkets synd bort — et bilde på stedfortredende soning.',
        liturgicalContext: 'Feires 10. Tishri. 25 timers faste uten mat og drikke. Kol Nidre-bønnen kvelden før. Fem gudstjenester gjennom dagen. Avslutningsseremonien Ne\'ila (portene lukkes) kulminerer i ett langt shofar-støt. Hvite klær som symbol på renhet.',
        history: 'I tempeltiden var Yom Kippur den mest dramatiske og farlige gudstjenesten — øverstepresten kunne dø i Det aller helligste hvis ritualet ikke ble utført korrekt. Etter templets ødeleggelse erstattet bønn og faste ofringene. Rabbinsk tradisjon: «For overtredelser mot Gud soner Yom Kippur. For overtredelser mot medmennesker soner den ikke, før man har gjort opp med den man har krenket» (Misjna Joma 8:9).',
        otConnections: '3 Mosebok 16 i sin helhet er grunnlaget. 3 Mosebok 23:26-32 om fasten. Jesaja 58:1-12 om den sanne faste. Jona leses på ettermiddagsgudstjenesten — Guds vilje til å tilgi, selv Ninive. Esekiel 36:25-26: «Jeg stenker rent vann på dere, så dere blir rene... Jeg gir dere et nytt hjerte.»',
        dates: jewishHolidayDates('yom_kippur')
    },
    {
        id: 'sukkot',
        name: 'Sukkot (Løvhyttefesten)',
        description: 'Syv dagers gledesfest til minne om ørkenvandringen.',
        category: 'jewish',
        biblicalBasis: '3 Mosebok 23:33-43: «Dere skal bo i hytter i syv dager... for at kommende slekter skal vite at jeg lot israelittene bo i hytter da jeg førte dem ut av Egypt.» 5 Mosebok 16:13-15: «Du skal glede deg med din sønn og din datter, din slave og din slavekvinne.» Nehemja 8:14-18 om gjenopptakelsen av Sukkot etter eksilet. Johannes 7:37-38: på den siste, store festdagen roper Jesus: «Den som tørster, la ham komme til meg og drikke.»',
        significance: 'Sukkot minner om at livet er provisorisk — hyttene er skjøre, åpne mot himmelen. Mennesket lever av Guds daglige forsørgelse, ikke av egne murer. Vannøsingsseremonien i tempelet pekte mot Guds velsignelse og regn — Jesus knytter an til denne når han tilbyr levende vann (Joh 7). Løvhyttefesten er den mest gledesfylte av høytidene — «gledens tid» (zman simchatenu).',
        liturgicalContext: 'Feires 15.-21. Tishri. Lulav (palmegrein, myrte, vier) og etrog (sitrusfrukt) viftes i alle retninger. Familie og venner samles i sukkah-hytter til måltider. Hoshanot-prosesjoner rundt synagogens bimah. Avsluttes med Shemini Atseret og Simchat Torah (glede i Torah).',
        history: 'En av de tre pilegrimshøytidene (shalosh regalim) da hele Israel dro opp til Jerusalem. Salomos tempelinnvielse fant sted under Sukkot (1 Kong 8). Under det andre tempelet var vannøsingsseremonien og lysfeiringen i tempelforgården spektakulære begivenheter. Sakharja 14:16-19 profeterer at alle folkeslag skal feire Sukkot i Messias\' tid.',
        otConnections: 'Skystøtten og ildstøtten i ørkenen (2 Mos 13:21-22) — Guds beskyttende nærvær som hyttene symboliserer. 1 Kongebok 8 — Salomos tempelinnvielse under Sukkot. Sakarja 14:16-19 om folkeslagenes fremtidige Sukkot-feiring. Nehemja 8:14-18 om den store gjenoppdagelsen av Sukkot-feiringen.',
        dates: jewishHolidayDates('sukkot')
    },
    {
        id: 'purim',
        name: 'Purim',
        description: 'Feiringen av jødenes redning fra Hamans folkemordplan.',
        category: 'jewish',
        biblicalBasis: 'Esters bok i sin helhet. Haman, perserkong Ahasverus\' minister, planlegger å utrydde alle jøder i riket. Han kaster purim (lodd) for å finne den beste datoen (Est 3:7). Mordekais oppfordring til Ester: «Hvem vet om det ikke er for en tid som denne du er blitt dronning?» (Est 4:14). Ester risikerer livet ved å gå ubedt til kongen. Planen avsløres, Haman henges i galgen han bygde for Mordekaj (Est 7). Jødene får lov til å forsvare seg (Est 9).',
        significance: 'Purim handler om Guds skjulte forsyn — Guds navn nevnes aldri i Esters bok, men hans hånd er synlig i hendelsenes gang. Motet til å tale for de utsatte er sentralt: Ester risikerer alt. Vendingen fra undergang til redning, fra sorg til glede, er et gjennomgående bibelsk motiv. «De dagene da jødene fikk ro fra sine fiender, og den måneden da sorgen ble vendt til glede» (Est 9:22).',
        liturgicalContext: 'Feires 14. Adar. Megillat Ester (Ester-rullen) leses høyt i synagogen — tilhørerne bråker med rasler (grogger) hver gang Hamans navn nevnes. Mishloach manot (gaver til venner), matanot la-evyonim (gaver til fattige). Festmåltid med vin. Utkledningstradisjon — rollen snur, identiteter byttes.',
        history: 'Purim er den mest «sekulære» av de jødiske høytidene — den har karnevalskarakter. Feiringen er beskrevet i Esters bok selv (Est 9:20-32). Megilla-lesningen er kjent fra Misjna-tiden. I diaspora ble «lokale purim» feiret i byer som opplevde redning fra forfølgelse.',
        otConnections: 'Esters bok i sin helhet. Tematisk kobling til Josef-historien — en jøde i fremmed hoff som redder sitt folk (1 Mos 37-50). Guds skjulte hånd i historien — som i Ruts bok der «tilfeldigheter» styrer mot frelse. Haman er agagitt (Est 3:1) — etterkommet av agagittene/amalekittene, Israels urfiender (1 Sam 15).',
        dates: jewishHolidayDates('purim')
    },
    {
        id: 'hanukkah',
        name: 'Hanukkah (Lysfesten)',
        description: 'Tempelinnvielsen etter makkabeeropprøret. Lyset som seirer over mørket.',
        category: 'jewish',
        biblicalBasis: '1 Makkabeerbok 4:36-59 og 2 Makkabeerbok 10:1-8 om gjeninnvielsen av tempelet etter Antiokus IV Epifanes\' vanhelligelse. Tempelet renses, et nytt alter bygges, og feiringen varer åtte dager. Ifølge talmudisk tradisjon (Shabbat 21b) fant de bare én krukke med hellig olje forseglet med øversteprestens segl — nok til én dag, men den brant i åtte dager. Jesus i tempelet under Hanukkah: «Er du Messias, så si oss det rett ut» (Joh 10:22-23).',
        significance: 'Hanukkah feirer troens motstandskraft: en liten gruppe holder stand mot et imperium som vil tvinge dem til å oppgi sin tro. Oljemirakelet vitner om at Gud strekker det lille til å rekke. Lyset som tennes i mørket — ett lys mer for hver dag — er et kraftig bilde på håpets vekst. At Jesus var i tempelet under Hanukkah og ble konfrontert med Messias-spørsmålet, gir lysfesten kristologisk dybde.',
        liturgicalContext: 'Feires 25. Kislev, åtte dager. Hanukkia-lysestaken med ni armer tennes: shamash (tjenerlyset) og ett nytt lys hver kveld. Levivot (potetpannekaker) og sufganiyot (donuts) stekes i olje. Dreidel-spill. Al Hanissim-bønnen legges til i den daglige bønnen.',
        history: 'Makkabeeropprøret (167-164 f.Kr.) var en reaksjon på Antiokus IV som forbød jødisk religionsutøvelse og satte opp et Zeus-alter i tempelet. Judas Makkabeus ledet opprøret. Oljemirakelet er ikke nevnt i Makkabeer-bøkene men i Talmud (200-500-tallet). Hanukkah er den eneste store jødiske høytiden uten bibelsk (kanonisk) grunnlag i den hebraiske bibelen.',
        otConnections: 'Daniel 8 og 11 om «den avskyelige ødeleggelse» — Antiokus\' vanhelligelse av tempelet, som Daniel profeterte om. 1 Kongebok 8 — Salomos tempelinnvielse som forbilde. Haggai 2:1-9 om det gjenoppbygde tempelets herlighet. Jesus siterer «ødeleggelsens styggedom» fra Daniel i sin tale om de siste tider (Matt 24:15).',
        dates: jewishHolidayDates('hanukkah')
    }
];

// === Generate files ===
function ensureDir(dirPath: string): void {
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, {recursive: true});
}

function main(): void {
    // Hjelpen skal ut før den første fila røres — kjøringen er destruktiv.
    const {flags} = parseArgs(process.argv.slice(2), SPEC);
    if (flags.help) {
        console.log(formatHelp(
            'generate/days.ts',
            'skriver dagene i kirkeåret og den jødiske festkalenderen til generate/days/nb/<id>.json, med datoene beregnet for 2025–2035',
            SPEC,
            HELP_EXAMPLES,
        ));
        process.exit(0);
    }

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
            biblicalBasis: day.biblicalBasis || '',
            significance: day.significance || '',
            liturgicalContext: day.liturgicalContext || '',
            history: day.history || '',
            otConnections: day.otConnections || '',
            dates: day.dates
        };
        fs.writeFileSync(file, JSON.stringify(data, null, 2));
        created++;
        console.log(`  ${day.id} (${Object.keys(day.dates).length} dates)`);
    }

    console.log(`\nCreated ${created} day files in ${outDir}`);
}

// Kjører bare når fila startes direkte. Uten vakten kjører jobben ved IMPORT —
// det er grunnen til at days.ts slettet data bare man lastet modulen (#108),
// og det gjør skriptene umulige å teste.
if (import.meta.main) {
    main();
}
