#!/usr/bin/env bun
/**
 * Unified reading plan generator
 * Generates all reading plans from configuration
 *
 * Run with: bun generate_reading_plans.ts
 *
 * Flaggene går gjennom den felles kontrakten i cli.ts; `--help` viser dem.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { bookRanges, getChaptersForRange, getChaptersForBooks, resolveBookRange } from './lib.js';
import type { BookRange, ChapterRef } from './lib.js';
import { planDefinitions, categoryOrder } from './reading_plans_config.js';
import { parseArgs, formatHelp, COMMON_FLAGS } from './cli.js';
import type { FlagSpec } from './cli.js';

/**
 * Én dags lesning i en ferdig generert plan.
 *
 * `label` settes bare av parallelle planer som har `labels` i konfigurasjonen,
 * derfor valgfri.
 */
interface Reading {
  day: number;
  chapters: ChapterRef[];
  label?: string;
}

/** Ett spor i en parallell plan (f.eks. GT og NT lest ved siden av hverandre). */
interface PlanTrack {
  bookRange: string | BookRange;
  label?: string;
}

/** En dagslesning slik den står i konfigurasjonen — dagsnummeret kommer av rekkefølgen. */
interface CustomReading {
  chapters: ChapterRef[];
}

/**
 * En plandefinisjon fra reading_plans_config.js.
 *
 * Alt utenom de fem feltene alle planer har er valgfritt: hvilke som er satt
 * avhenger av `type`, og konfigurasjonen er en vanlig array-literal, så `type`
 * er `string` og ikke en literal som kunne skilt variantene fra hverandre.
 */
interface PlanDefinition {
  id: string;
  name: string;
  description: string;
  category: string;
  type: string;
  bookRange?: string | BookRange;
  books?: number[];
  chaptersPerDay?: number;
  days?: number;
  daysPerChapter?: number;
  chapters?: ChapterRef[];
  tracks?: PlanTrack[];
  labels?: string[];
  readings?: CustomReading[];
}

/** En ferdig generert plan, slik den skrives til <id>.json. */
interface GeneratedPlan {
  id: string;
  name: string;
  description: string;
  category: string;
  days: number;
  readings: Reading[];
}

/** En linje i index.json — planen uten selve lesningene. */
interface PlanIndexEntry {
  id: string;
  name: string;
  description: string;
  category: string;
  days: number;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Plans are generated in Norwegian (the config language) into reading_plans/nb/;
// other languages are produced from there with translate.mjs
const outputDir = path.join(__dirname, 'reading_plans/nb');

// Skriptet tar ingen argumenter utover hjelpen. Kontrakten er likevel med,
// slik at `--help` svarer i stedet for å bli tolket som et vanlig argument og
// skrive over reading_plans/nb/ (#108).
const SPEC: Record<string, FlagSpec> = {
  help: COMMON_FLAGS.help,
};

/**
 * Distribute chapters evenly over a number of days
 */
function distributeChapters(chapters: ChapterRef[], days: number): Reading[] {
  const readings: Reading[] = [];
  const chaptersPerDay = chapters.length / days;

  let chapterIndex = 0;
  for (let day = 1; day <= days; day++) {
    const dayChapters: ChapterRef[] = [];
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

/**
 * Create sequential readings (X chapters per day)
 */
function createSequentialReadings(chapters: ChapterRef[], chaptersPerDay: number): Reading[] {
  const readings: Reading[] = [];
  let day = 1;
  let dayChapters: ChapterRef[] = [];

  for (const chapter of chapters) {
    dayChapters.push(chapter);

    if (dayChapters.length >= chaptersPerDay) {
      readings.push({ day, chapters: dayChapters });
      day++;
      dayChapters = [];
    }
  }

  // Add remaining chapters
  if (dayChapters.length > 0) {
    readings.push({ day, chapters: dayChapters });
  }

  return readings;
}

/**
 * Create parallel readings (multiple tracks read together)
 */
function createParallelReadings(tracks: PlanTrack[], days: number, labels: string[] | null = null): Reading[] {
  const trackChapters = tracks.map(track => {
    const range = resolveBookRange(track.bookRange);
    return getChaptersForRange(range);
  });

  const readings: Reading[] = [];
  const trackIndices = tracks.map(() => 0);
  const trackRates = trackChapters.map(tc => tc.length / days);

  for (let day = 1; day <= days; day++) {
    const dayChapters: ChapterRef[] = [];

    for (let t = 0; t < tracks.length; t++) {
      const targetEnd = Math.round(day * trackRates[t]);
      while (trackIndices[t] < targetEnd && trackIndices[t] < trackChapters[t].length) {
        dayChapters.push(trackChapters[t][trackIndices[t]]);
        trackIndices[t]++;
      }
    }

    const reading: Reading = { day, chapters: dayChapters };
    if (labels && labels[day - 1]) {
      reading.label = labels[day - 1];
    }
    readings.push(reading);
  }

  return readings;
}

/**
 * Create repeat readings (same chapter repeated over multiple days)
 */
function createRepeatReadings(chapters: ChapterRef[], daysPerChapter: number): Reading[] {
  const readings: Reading[] = [];
  let day = 1;

  for (const chapter of chapters) {
    for (let i = 0; i < daysPerChapter; i++) {
      readings.push({ day, chapters: [chapter] });
      day++;
    }
  }

  return readings;
}

/**
 * Generate a plan from its definition
 */
// `!` under er rene typepåstander: hvilke felter som finnes følger av
// `definition.type`, og et manglende felt kastet — eller ga NaN-dager — også før
// typene kom til. Påstandene beskriver den eksisterende oppførselen.
function generatePlan(definition: PlanDefinition): GeneratedPlan {
  let readings: Reading[];
  let chapters: ChapterRef[];

  switch (definition.type) {
    case 'sequential':
      if (definition.books) {
        chapters = getChaptersForBooks(definition.books);
      } else {
        const range = resolveBookRange(definition.bookRange!);
        chapters = getChaptersForRange(range);
      }
      readings = createSequentialReadings(chapters, definition.chaptersPerDay!);
      break;

    case 'distributed':
      if (definition.books) {
        chapters = getChaptersForBooks(definition.books);
      } else {
        const range = resolveBookRange(definition.bookRange!);
        chapters = getChaptersForRange(range);
      }
      readings = distributeChapters(chapters, definition.days!);
      break;

    case 'parallel':
      readings = createParallelReadings(definition.tracks!, definition.days!, definition.labels);
      break;

    case 'repeat':
      readings = createRepeatReadings(definition.chapters!, definition.daysPerChapter!);
      break;

    case 'custom':
      readings = definition.readings!.map((reading, i) => ({
        day: i + 1,
        ...reading
      }));
      break;

    default:
      throw new Error(`Unknown plan type: ${definition.type}`);
  }

  return {
    id: definition.id,
    name: definition.name,
    description: definition.description,
    category: definition.category,
    days: readings.length,
    readings
  };
}

/**
 * Save plan to JSON file
 */
function savePlan(plan: GeneratedPlan): void {
  const filename = path.join(outputDir, `${plan.id}.json`);
  fs.writeFileSync(filename, JSON.stringify(plan, null, 2));
  console.log(`✓ ${plan.id}.json (${plan.days} dager)`);
}

/**
 * Generate and save index file
 */
function saveIndex(plans: GeneratedPlan[]): void {
  const index: PlanIndexEntry[] = plans.map(p => ({
    id: p.id,
    name: p.name,
    description: p.description,
    category: p.category,
    days: p.days
  }));

  // Sort by category and days
  index.sort((a: PlanIndexEntry, b: PlanIndexEntry) => {
    // `categoryOrder` er en literal med faste nøkler, mens `category` bare er en
    // streng her — oppslaget er dynamisk, og `|| 99` er nettopp fallbacken for
    // en kategori som ikke står der. Påstanden gjør det oppslaget mulig å skrive.
    const catDiff = ((categoryOrder as Record<string, number>)[a.category] || 99) - ((categoryOrder as Record<string, number>)[b.category] || 99);
    if (catDiff !== 0) return catDiff;
    return a.days - b.days;
  });

  const filename = path.join(outputDir, 'index.json');
  fs.writeFileSync(filename, JSON.stringify(index, null, 2));
  console.log(`\n✓ index.json (${index.length} planer)`);
}

// Main execution
function main(): void {
  // Hjelpen skal ut før noe leses fra eller skrives til disk.
  const { flags } = parseArgs(process.argv.slice(2), SPEC);
  if (flags.help) {
    console.log(formatHelp(
      'generate/generate_reading_plans.ts',
      'genererer alle leseplanene fra reading_plans_config.ts og SKRIVER dem til '
      + 'generate/reading_plans/nb/<plan-id>.json og index.json',
      SPEC,
    ));
    process.exit(0);
  }

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log('Genererer leseplaner...\n');

  const plans: GeneratedPlan[] = [];
  for (const definition of planDefinitions) {
    try {
      const plan = generatePlan(definition);
      savePlan(plan);
      plans.push(plan);
    } catch (error) {
      console.error(`✗ Feil ved generering av ${definition.id}: ${(error as Error).message}`);
    }
  }

  saveIndex(plans);

  console.log(`\nFerdig! ${plans.length} leseplaner generert.`);
}

// Kjører bare når fila startes direkte. Uten vakten kjører jobben ved IMPORT —
// det er grunnen til at days.ts slettet data bare man lastet modulen (#108),
// og det gjør skriptene umulige å teste.
if (import.meta.main) {
  main();
}
