/**
 * Genererer leseplaner for bibel.flogvit.com
 * Kjør med: node reading_plans.mjs
 */

import * as fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Bokdata med kapittelantall
const books = [
    { id: 1, name: "1. Mosebok", chapters: 50 },
    { id: 2, name: "2. Mosebok", chapters: 40 },
    { id: 3, name: "3. Mosebok", chapters: 27 },
    { id: 4, name: "4. Mosebok", chapters: 36 },
    { id: 5, name: "5. Mosebok", chapters: 34 },
    { id: 6, name: "Josva", chapters: 24 },
    { id: 7, name: "Dommerne", chapters: 21 },
    { id: 8, name: "Rut", chapters: 4 },
    { id: 9, name: "1. Samuel", chapters: 31 },
    { id: 10, name: "2. Samuel", chapters: 24 },
    { id: 11, name: "1. Kongebok", chapters: 22 },
    { id: 12, name: "2. Kongebok", chapters: 25 },
    { id: 13, name: "1. Krønikebok", chapters: 29 },
    { id: 14, name: "2. Krønikebok", chapters: 36 },
    { id: 15, name: "Esra", chapters: 10 },
    { id: 16, name: "Nehemja", chapters: 13 },
    { id: 17, name: "Ester", chapters: 10 },
    { id: 18, name: "Job", chapters: 42 },
    { id: 19, name: "Salmene", chapters: 150 },
    { id: 20, name: "Ordspråkene", chapters: 31 },
    { id: 21, name: "Forkynneren", chapters: 12 },
    { id: 22, name: "Høysangen", chapters: 8 },
    { id: 23, name: "Jesaja", chapters: 66 },
    { id: 24, name: "Jeremia", chapters: 52 },
    { id: 25, name: "Klagesangene", chapters: 5 },
    { id: 26, name: "Esekiel", chapters: 48 },
    { id: 27, name: "Daniel", chapters: 12 },
    { id: 28, name: "Hosea", chapters: 14 },
    { id: 29, name: "Joel", chapters: 3 },
    { id: 30, name: "Amos", chapters: 9 },
    { id: 31, name: "Obadja", chapters: 1 },
    { id: 32, name: "Jona", chapters: 4 },
    { id: 33, name: "Mika", chapters: 7 },
    { id: 34, name: "Nahum", chapters: 3 },
    { id: 35, name: "Habakkuk", chapters: 3 },
    { id: 36, name: "Sefanja", chapters: 3 },
    { id: 37, name: "Haggai", chapters: 2 },
    { id: 38, name: "Sakarja", chapters: 14 },
    { id: 39, name: "Malaki", chapters: 3 },
    { id: 40, name: "Matteus", chapters: 28 },
    { id: 41, name: "Markus", chapters: 16 },
    { id: 42, name: "Lukas", chapters: 24 },
    { id: 43, name: "Johannes", chapters: 21 },
    { id: 44, name: "Apostlenes gjerninger", chapters: 28 },
    { id: 45, name: "Romerne", chapters: 16 },
    { id: 46, name: "1. Korinterbrev", chapters: 16 },
    { id: 47, name: "2. Korinterbrev", chapters: 13 },
    { id: 48, name: "Galaterne", chapters: 6 },
    { id: 49, name: "Efeserne", chapters: 6 },
    { id: 50, name: "Filipperne", chapters: 4 },
    { id: 51, name: "Kolosserne", chapters: 4 },
    { id: 52, name: "1. Tessalonikerne", chapters: 5 },
    { id: 53, name: "2. Tessalonikerne", chapters: 3 },
    { id: 54, name: "1. Timoteus", chapters: 6 },
    { id: 55, name: "2. Timoteus", chapters: 4 },
    { id: 56, name: "Titus", chapters: 3 },
    { id: 57, name: "Filemon", chapters: 1 },
    { id: 58, name: "Hebreerne", chapters: 13 },
    { id: 59, name: "Jakob", chapters: 5 },
    { id: 60, name: "1. Peter", chapters: 5 },
    { id: 61, name: "2. Peter", chapters: 3 },
    { id: 62, name: "1. Johannes", chapters: 5 },
    { id: 63, name: "2. Johannes", chapters: 1 },
    { id: 64, name: "3. Johannes", chapters: 1 },
    { id: 65, name: "Judas", chapters: 1 },
    { id: 66, name: "Åpenbaringen", chapters: 22 }
];

// Hjelpefunksjon: få alle kapitler for en bok-range
function getChapters(fromBookId, toBookId) {
    const chapters = [];
    for (const book of books) {
        if (book.id >= fromBookId && book.id <= toBookId) {
            for (let ch = 1; ch <= book.chapters; ch++) {
                chapters.push({ bookId: book.id, chapter: ch });
            }
        }
    }
    return chapters;
}

// Hjelpefunksjon: fordel kapitler på dager
function distributeChapters(chapters, days) {
    const readings = [];
    const chaptersPerDay = chapters.length / days;

    let chapterIndex = 0;
    for (let day = 1; day <= days; day++) {
        const dayChapters = [];
        const targetEnd = Math.round(day * chaptersPerDay);

        while (chapterIndex < targetEnd && chapterIndex < chapters.length) {
            dayChapters.push(chapters[chapterIndex]);
            chapterIndex++;
        }

        if (dayChapters.length > 0) {
            readings.push({ day, chapters: dayChapters });
        }
    }

    return readings;
}

// Lagre plan til fil
function savePlan(plan) {
    const filename = path.join(__dirname, 'reading_plans', `${plan.id}.json`);
    fs.writeFileSync(filename, JSON.stringify(plan, null, 2));
    console.log(`Lagret: ${filename} (${plan.readings.length} dager)`);
}

// ============================================
// LESEPLANER
// ============================================

// 1. Ordspråkene - 31 dager (perfekt for en måned)
function createProverbsPlan() {
    const chapters = getChapters(20, 20); // Ordspråkene = bok 20
    return {
        id: "ordsprakene-31",
        name: "Ordspråkene på én måned",
        description: "Les ett kapittel fra Ordspråkene hver dag. Perfekt å gjenta hver måned!",
        category: "kort",
        days: 31,
        readings: chapters.map((ch, i) => ({ day: i + 1, chapters: [ch] }))
    };
}

// 2. Salmene - 150 dager
function createPsalmsPlan() {
    const chapters = getChapters(19, 19); // Salmene = bok 19
    return {
        id: "salmene-150",
        name: "Salmene på 150 dager",
        description: "Les én salme hver dag. En reise gjennom bønn, lovsang og klage.",
        category: "kort",
        days: 150,
        readings: chapters.map((ch, i) => ({ day: i + 1, chapters: [ch] }))
    };
}

// 3. Salmene - 30 dager (5 salmer per dag)
function createPsalms30Plan() {
    const chapters = getChapters(19, 19);
    return {
        id: "salmene-30",
        name: "Salmene på én måned",
        description: "Les 5 salmer hver dag og fullfør Salmenes bok på 30 dager.",
        category: "kort",
        days: 30,
        readings: distributeChapters(chapters, 30)
    };
}

// 4. NT på 9 uker (65 dager, ~4 kapitler/dag)
function createNT9WeeksPlan() {
    const chapters = getChapters(40, 66); // NT = bok 40-66
    return {
        id: "nt-9-uker",
        name: "Det nye testamentet på 9 uker",
        description: "Les hele NT på 65 dager med ca. 4 kapitler per dag.",
        category: "middels",
        days: 65,
        readings: distributeChapters(chapters, 65)
    };
}

// 5. Evangeliene (89 kapitler)
function createGospelsPlan() {
    const chapters = getChapters(40, 43); // Matt, Mark, Luk, Joh
    return {
        id: "evangeliene",
        name: "De fire evangeliene",
        description: "Les alle fire evangelier og bli kjent med Jesu liv og lære.",
        category: "kort",
        days: 89,
        readings: chapters.map((ch, i) => ({ day: i + 1, chapters: [ch] }))
    };
}

// 6. Evangeliene på 30 dager
function createGospels30Plan() {
    const chapters = getChapters(40, 43);
    return {
        id: "evangeliene-30",
        name: "Evangeliene på én måned",
        description: "Les alle fire evangelier på 30 dager med ~3 kapitler per dag.",
        category: "kort",
        days: 30,
        readings: distributeChapters(chapters, 30)
    };
}

// 7. Årlig leseplan - GT og NT parallelt
function createYearlyPlan() {
    const gtChapters = getChapters(1, 39);  // 929 kapitler
    const ntChapters = getChapters(40, 66); // 260 kapitler

    const readings = [];

    // Fordel GT på 365 dager (~2.5 kapitler/dag)
    // Fordel NT på 365 dager (~0.7 kapitler/dag, så vi leser NT ~1.4 ganger)

    const gtPerDay = gtChapters.length / 365;
    const ntPerDay = ntChapters.length / 365;

    let gtIndex = 0;
    let ntIndex = 0;

    for (let day = 1; day <= 365; day++) {
        const dayChapters = [];

        // GT kapitler for dagen
        const gtTargetEnd = Math.round(day * gtPerDay);
        while (gtIndex < gtTargetEnd && gtIndex < gtChapters.length) {
            dayChapters.push(gtChapters[gtIndex]);
            gtIndex++;
        }

        // NT kapittel for dagen (noen dager har ikke NT)
        const ntTargetEnd = Math.round(day * ntPerDay);
        while (ntIndex < ntTargetEnd && ntIndex < ntChapters.length) {
            dayChapters.push(ntChapters[ntIndex]);
            ntIndex++;
        }

        readings.push({ day, chapters: dayChapters });
    }

    return {
        id: "arlig",
        name: "Hele Bibelen på ett år",
        description: "Les hele Bibelen på 365 dager med både GT og NT hver dag.",
        category: "lang",
        days: 365,
        readings
    };
}

// 8. GT på ett år
function createOTYearlyPlan() {
    const chapters = getChapters(1, 39);
    return {
        id: "gt-arlig",
        name: "Det gamle testamentet på ett år",
        description: "Les hele GT på 365 dager med ~2.5 kapitler per dag.",
        category: "lang",
        days: 365,
        readings: distributeChapters(chapters, 365)
    };
}

// 9. Paulus' brev (87 kapitler)
function createPaulsPlan() {
    const chapters = getChapters(45, 57); // Rom - Filemon
    return {
        id: "paulus-brev",
        name: "Paulus' brev",
        description: "Les alle Paulus' 13 brev på 87 dager.",
        category: "kort",
        days: 87,
        readings: chapters.map((ch, i) => ({ day: i + 1, chapters: [ch] }))
    };
}

// 10. Paulus' brev på 30 dager
function createPauls30Plan() {
    const chapters = getChapters(45, 57);
    return {
        id: "paulus-brev-30",
        name: "Paulus' brev på én måned",
        description: "Les alle Paulus' brev på 30 dager med ~3 kapitler per dag.",
        category: "kort",
        days: 30,
        readings: distributeChapters(chapters, 30)
    };
}

// Generer alle planer
const plans = [
    createProverbsPlan(),
    createPsalmsPlan(),
    createPsalms30Plan(),
    createNT9WeeksPlan(),
    createGospelsPlan(),
    createGospels30Plan(),
    createYearlyPlan(),
    createOTYearlyPlan(),
    createPaulsPlan(),
    createPauls30Plan()
];

// Lagre alle planer
for (const plan of plans) {
    savePlan(plan);
}

// Lag en index-fil med oversikt
const index = plans.map(p => ({
    id: p.id,
    name: p.name,
    description: p.description,
    category: p.category,
    days: p.days
}));

const indexFilename = path.join(__dirname, 'reading_plans', 'index.json');
fs.writeFileSync(indexFilename, JSON.stringify(index, null, 2));
console.log(`\nLagret index: ${indexFilename}`);
console.log(`\nTotalt ${plans.length} leseplaner generert!`);
