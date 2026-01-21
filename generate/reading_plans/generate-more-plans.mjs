#!/usr/bin/env node
/**
 * Generate additional reading plans
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Helper to create a plan with sequential chapters from multiple books
function createSequentialPlan(id, name, description, category, books, chaptersPerDay = 1) {
  const readings = [];
  let day = 1;
  let dayChapters = [];

  for (const book of books) {
    for (let chapter = 1; chapter <= book.chapters; chapter++) {
      dayChapters.push({ bookId: book.id, chapter });

      if (dayChapters.length >= chaptersPerDay) {
        readings.push({ day, chapters: dayChapters });
        day++;
        dayChapters = [];
      }
    }
  }

  // Add remaining chapters
  if (dayChapters.length > 0) {
    readings.push({ day, chapters: dayChapters });
  }

  return {
    id,
    name,
    description,
    category,
    days: readings.length,
    readings
  };
}

// Helper to create a plan with specific chapters
function createCustomPlan(id, name, description, category, dayReadings) {
  return {
    id,
    name,
    description,
    category,
    days: dayReadings.length,
    readings: dayReadings.map((chapters, i) => ({
      day: i + 1,
      chapters
    }))
  };
}

// Book definitions
const books = {
  // GT
  job: { id: 18, chapters: 42 },
  ordsp: { id: 20, chapters: 31 },
  fork: { id: 21, chapters: 12 },
  hoys: { id: 22, chapters: 8 },
  jes: { id: 23, chapters: 66 },
  jer: { id: 24, chapters: 52 },
  klag: { id: 25, chapters: 5 },
  esek: { id: 26, chapters: 48 },
  dan: { id: 27, chapters: 12 },
  hos: { id: 28, chapters: 14 },
  joel: { id: 29, chapters: 4 },
  amos: { id: 30, chapters: 9 },
  ob: { id: 31, chapters: 1 },
  jona: { id: 32, chapters: 4 },
  mika: { id: 33, chapters: 7 },
  nah: { id: 34, chapters: 3 },
  hab: { id: 35, chapters: 3 },
  sef: { id: 36, chapters: 3 },
  hag: { id: 37, chapters: 2 },
  sak: { id: 38, chapters: 14 },
  mal: { id: 39, chapters: 3 },
  // NT
  matt: { id: 40, chapters: 28 },
  mark: { id: 41, chapters: 16 },
  luk: { id: 42, chapters: 24 },
  joh: { id: 43, chapters: 21 },
  apg: { id: 44, chapters: 28 },
  rom: { id: 45, chapters: 16 },
  hebr: { id: 58, chapters: 13 },
  jak: { id: 59, chapters: 5 },
  pet1: { id: 60, chapters: 5 },
  pet2: { id: 61, chapters: 3 },
  joh1: { id: 62, chapters: 5 },
  joh2: { id: 63, chapters: 1 },
  joh3: { id: 64, chapters: 1 },
  jud: { id: 65, chapters: 1 },
  ap: { id: 66, chapters: 22 },
};

const plans = [];

// 1. Visdomslitteratur - 93 kapitler, ~3 per dag = 31 dager
plans.push(createSequentialPlan(
  'visdomslitteratur',
  'Visdomslitteraturen',
  'Les Job, Ordspråkene, Forkynneren og Høysangen på én måned.',
  'kort',
  [books.job, books.ordsp, books.fork, books.hoys],
  3
));

// 2. Profetene - 250 kapitler, ~3 per dag = 84 dager
plans.push(createSequentialPlan(
  'profetene',
  'Profetene',
  'Les alle profetbøkene fra Jesaja til Malaki.',
  'middels',
  [books.jes, books.jer, books.klag, books.esek, books.dan,
   books.hos, books.joel, books.amos, books.ob, books.jona,
   books.mika, books.nah, books.hab, books.sef, books.hag, books.sak, books.mal],
  3
));

// 3. Johannes' skrifter - 50 kapitler
plans.push(createSequentialPlan(
  'johannes-skrifter',
  'Johannes\' skrifter',
  'Les Johannesevangeliet, Johannes\' brev og Åpenbaringen.',
  'kort',
  [books.joh, books.joh1, books.joh2, books.joh3, books.ap],
  2
));

// 4. Hebreerbrevet + allmenne brev - 34 kapitler
plans.push(createSequentialPlan(
  'allmenne-brev',
  'Hebreerbrevet og de allmenne brevene',
  'Les Hebreerbrevet, Jakob, Peters brev, Johannes\' brev og Judas.',
  'kort',
  [books.hebr, books.jak, books.pet1, books.pet2, books.joh1, books.joh2, books.joh3, books.jud],
  1
));

// 5. Apostlenes gjerninger - 28 kapitler
plans.push(createSequentialPlan(
  'apostlenes-gjerninger',
  'Apostlenes gjerninger',
  'Følg den første kirkens historie på 28 dager.',
  'kort',
  [books.apg],
  1
));

// 6. Romerbrevet - 16 kapitler, grundig med 2 dager per kapittel for refleksjon
const romReadings = [];
for (let ch = 1; ch <= 16; ch++) {
  romReadings.push([{ bookId: 45, chapter: ch }]);
}
plans.push(createCustomPlan(
  'romerbrevet',
  'Romerbrevet',
  'Les Paulus\' mesterverk på 16 dager - ett kapittel per dag.',
  'kort',
  romReadings
));

// 7. Bergprekenen - Matt 5-7, kan leses grundig over 21 dager (7 dager per kapittel)
// eller raskt over 3 dager
plans.push(createCustomPlan(
  'bergprekenen',
  'Bergprekenen',
  'Jesu mest kjente tale fra Matteus 5-7. Les grundig over 3 uker.',
  'kort',
  [
    // Uke 1: Matt 5 (saligprisningene og loven)
    [{ bookId: 40, chapter: 5 }],
    [{ bookId: 40, chapter: 5 }],
    [{ bookId: 40, chapter: 5 }],
    [{ bookId: 40, chapter: 5 }],
    [{ bookId: 40, chapter: 5 }],
    [{ bookId: 40, chapter: 5 }],
    [{ bookId: 40, chapter: 5 }],
    // Uke 2: Matt 6 (bønn, faste, bekymring)
    [{ bookId: 40, chapter: 6 }],
    [{ bookId: 40, chapter: 6 }],
    [{ bookId: 40, chapter: 6 }],
    [{ bookId: 40, chapter: 6 }],
    [{ bookId: 40, chapter: 6 }],
    [{ bookId: 40, chapter: 6 }],
    [{ bookId: 40, chapter: 6 }],
    // Uke 3: Matt 7 (dømme andre, den smale vei)
    [{ bookId: 40, chapter: 7 }],
    [{ bookId: 40, chapter: 7 }],
    [{ bookId: 40, chapter: 7 }],
    [{ bookId: 40, chapter: 7 }],
    [{ bookId: 40, chapter: 7 }],
    [{ bookId: 40, chapter: 7 }],
    [{ bookId: 40, chapter: 7 }],
  ]
));

// 8. Påskeplan - Lidelseshistorien fra alle evangelier over 14 dager
plans.push(createCustomPlan(
  'paske',
  'Påskeplan',
  'Les lidelseshistorien fra alle fire evangelier i påskeuka.',
  'kort',
  [
    // Dag 1-3: Matteus' beretning
    [{ bookId: 40, chapter: 26 }],
    [{ bookId: 40, chapter: 27 }],
    [{ bookId: 40, chapter: 28 }],
    // Dag 4-6: Markus' beretning
    [{ bookId: 41, chapter: 14 }],
    [{ bookId: 41, chapter: 15 }],
    [{ bookId: 41, chapter: 16 }],
    // Dag 7-9: Lukas' beretning
    [{ bookId: 42, chapter: 22 }],
    [{ bookId: 42, chapter: 23 }],
    [{ bookId: 42, chapter: 24 }],
    // Dag 10-14: Johannes' beretning (mer detaljert)
    [{ bookId: 43, chapter: 13 }], // Fotvasking og avskjedstalen starter
    [{ bookId: 43, chapter: 14 }, { bookId: 43, chapter: 15 }], // Avskjedstalen
    [{ bookId: 43, chapter: 16 }, { bookId: 43, chapter: 17 }], // Yppersteprestlig bønn
    [{ bookId: 43, chapter: 18 }, { bookId: 43, chapter: 19 }], // Arrestasjon og korsfestelse
    [{ bookId: 43, chapter: 20 }, { bookId: 43, chapter: 21 }], // Oppstandelsen
  ]
));

// 9. Juleplan/Advent - 24 dager
plans.push(createCustomPlan(
  'advent',
  'Adventsplan',
  'Les juleevangeliet og profetier om Messias gjennom adventstiden.',
  'kort',
  [
    // Uke 1: Profetier om Messias
    [{ bookId: 23, chapter: 7 }],   // Jesaja 7 - Jomfrutegnet
    [{ bookId: 23, chapter: 9 }],   // Jesaja 9 - Et barn er oss født
    [{ bookId: 23, chapter: 11 }],  // Jesaja 11 - Davids rotskudd
    [{ bookId: 33, chapter: 5 }],   // Mika 5 - Fra Betlehem
    [{ bookId: 23, chapter: 40 }],  // Jesaja 40 - Trøst mitt folk
    [{ bookId: 39, chapter: 3 }],   // Malaki 3 - Budbæreren
    [{ bookId: 23, chapter: 53 }],  // Jesaja 53 - Den lidende tjener
    // Uke 2: Forberedelsen
    [{ bookId: 42, chapter: 1 }],   // Lukas 1:1-38 - Engelen til Maria
    [{ bookId: 42, chapter: 1 }],   // Lukas 1:39-80 - Maria hos Elisabeth
    [{ bookId: 40, chapter: 1 }],   // Matteus 1 - Jesu slektstavle og Josefs drøm
    [{ bookId: 43, chapter: 1 }],   // Johannes 1:1-18 - Ordet ble menneske
    [{ bookId: 48, chapter: 4 }],   // Galaterne 4 - I tidens fylde
    [{ bookId: 50, chapter: 2 }],   // Filipperne 2 - Han fornedret seg selv
    [{ bookId: 58, chapter: 1 }],   // Hebreerne 1 - Sønnen er større
    // Uke 3: Jesu fødsel
    [{ bookId: 42, chapter: 2 }],   // Lukas 2:1-20 - Jesu fødsel
    [{ bookId: 42, chapter: 2 }],   // Lukas 2:1-20 (igjen for meditasjon)
    [{ bookId: 40, chapter: 2 }],   // Matteus 2:1-12 - Vismennene
    [{ bookId: 40, chapter: 2 }],   // Matteus 2:13-23 - Flukten til Egypt
    [{ bookId: 42, chapter: 2 }],   // Lukas 2:21-40 - Simeon og Anna
    [{ bookId: 42, chapter: 2 }],   // Lukas 2:41-52 - Jesus som tolvåring
    [{ bookId: 19, chapter: 2 }],   // Salme 2 - Kongen på Sion
    // Julaften og juledagene
    [{ bookId: 19, chapter: 98 }],  // Salme 98 - Syng en ny sang
    [{ bookId: 23, chapter: 52 }],  // Jesaja 52 - Hvor fagre er føttene
    [{ bookId: 62, chapter: 4 }],   // 1. Johannes 4 - Gud er kjærlighet
  ]
));

// 10. De små profetene - Hosea til Malaki
plans.push(createSequentialPlan(
  'sma-profetene',
  'De små profetene',
  'Les de tolv små profetene fra Hosea til Malaki.',
  'kort',
  [books.hos, books.joel, books.amos, books.ob, books.jona,
   books.mika, books.nah, books.hab, books.sef, books.hag, books.sak, books.mal],
  2
));

// 11. Mosesbøkene (Toraen/Pentateuken) - 187 kapitler
const mosebooks = [
  { id: 1, chapters: 50 },
  { id: 2, chapters: 40 },
  { id: 3, chapters: 27 },
  { id: 4, chapters: 36 },
  { id: 5, chapters: 34 },
];
plans.push(createSequentialPlan(
  'mosebokene',
  'Mosebøkene',
  'Les de fem Mosebøkene (Toraen) på ca. 2 måneder.',
  'middels',
  mosebooks,
  3
));

// 12. Historiske bøker - Josva til Ester
const historicalBooks = [
  { id: 6, chapters: 24 },  // Josva
  { id: 7, chapters: 21 },  // Dommerne
  { id: 8, chapters: 4 },   // Rut
  { id: 9, chapters: 31 },  // 1. Samuel
  { id: 10, chapters: 24 }, // 2. Samuel
  { id: 11, chapters: 22 }, // 1. Kongebok
  { id: 12, chapters: 25 }, // 2. Kongebok
  { id: 13, chapters: 29 }, // 1. Krønikebok
  { id: 14, chapters: 36 }, // 2. Krønikebok
  { id: 15, chapters: 10 }, // Esra
  { id: 16, chapters: 13 }, // Nehemja
  { id: 17, chapters: 10 }, // Ester
];
plans.push(createSequentialPlan(
  'historiske-boker',
  'De historiske bøkene',
  'Les Israels historie fra Josva til Ester.',
  'lang',
  historicalBooks,
  3
));

// Write all plans to files
for (const plan of plans) {
  const filename = path.join(__dirname, `${plan.id}.json`);
  fs.writeFileSync(filename, JSON.stringify(plan, null, 2));
  console.log(`Created: ${plan.id}.json (${plan.days} dager)`);
}

// Update index.json
const indexPath = path.join(__dirname, 'index.json');
const existingIndex = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));

// Add new plans to index (avoid duplicates)
const existingIds = new Set(existingIndex.map(p => p.id));
for (const plan of plans) {
  if (!existingIds.has(plan.id)) {
    existingIndex.push({
      id: plan.id,
      name: plan.name,
      description: plan.description,
      category: plan.category,
      days: plan.days
    });
  }
}

// Sort by category and days
const categoryOrder = { kort: 1, middels: 2, lang: 3 };
existingIndex.sort((a, b) => {
  const catDiff = categoryOrder[a.category] - categoryOrder[b.category];
  if (catDiff !== 0) return catDiff;
  return a.days - b.days;
});

fs.writeFileSync(indexPath, JSON.stringify(existingIndex, null, 2));
console.log(`\nUpdated index.json with ${existingIndex.length} plans total`);
