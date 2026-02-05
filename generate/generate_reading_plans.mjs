#!/usr/bin/env node
/**
 * Unified reading plan generator
 * Generates all reading plans from configuration
 *
 * Run with: node generate_reading_plans.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { bookRanges, getChaptersForRange, getChaptersForBooks, resolveBookRange } from './lib.js';
import { planDefinitions, categoryOrder } from './reading_plans_config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.join(__dirname, 'reading_plans');

// Ensure output directory exists
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

/**
 * Distribute chapters evenly over a number of days
 */
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

/**
 * Create sequential readings (X chapters per day)
 */
function createSequentialReadings(chapters, chaptersPerDay) {
  const readings = [];
  let day = 1;
  let dayChapters = [];

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
function createParallelReadings(tracks, days, labels = null) {
  const trackChapters = tracks.map(track => {
    const range = resolveBookRange(track.bookRange);
    return getChaptersForRange(range);
  });

  const readings = [];
  const trackIndices = tracks.map(() => 0);
  const trackRates = trackChapters.map(tc => tc.length / days);

  for (let day = 1; day <= days; day++) {
    const dayChapters = [];

    for (let t = 0; t < tracks.length; t++) {
      const targetEnd = Math.round(day * trackRates[t]);
      while (trackIndices[t] < targetEnd && trackIndices[t] < trackChapters[t].length) {
        dayChapters.push(trackChapters[t][trackIndices[t]]);
        trackIndices[t]++;
      }
    }

    const reading = { day, chapters: dayChapters };
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
function createRepeatReadings(chapters, daysPerChapter) {
  const readings = [];
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
function generatePlan(definition) {
  let readings;
  let chapters;

  switch (definition.type) {
    case 'sequential':
      if (definition.books) {
        chapters = getChaptersForBooks(definition.books);
      } else {
        const range = resolveBookRange(definition.bookRange);
        chapters = getChaptersForRange(range);
      }
      readings = createSequentialReadings(chapters, definition.chaptersPerDay);
      break;

    case 'distributed':
      if (definition.books) {
        chapters = getChaptersForBooks(definition.books);
      } else {
        const range = resolveBookRange(definition.bookRange);
        chapters = getChaptersForRange(range);
      }
      readings = distributeChapters(chapters, definition.days);
      break;

    case 'parallel':
      readings = createParallelReadings(definition.tracks, definition.days, definition.labels);
      break;

    case 'repeat':
      readings = createRepeatReadings(definition.chapters, definition.daysPerChapter);
      break;

    case 'custom':
      readings = definition.readings.map((reading, i) => ({
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
function savePlan(plan) {
  const filename = path.join(outputDir, `${plan.id}.json`);
  fs.writeFileSync(filename, JSON.stringify(plan, null, 2));
  console.log(`✓ ${plan.id}.json (${plan.days} dager)`);
}

/**
 * Generate and save index file
 */
function saveIndex(plans) {
  const index = plans.map(p => ({
    id: p.id,
    name: p.name,
    description: p.description,
    category: p.category,
    days: p.days
  }));

  // Sort by category and days
  index.sort((a, b) => {
    const catDiff = (categoryOrder[a.category] || 99) - (categoryOrder[b.category] || 99);
    if (catDiff !== 0) return catDiff;
    return a.days - b.days;
  });

  const filename = path.join(outputDir, 'index.json');
  fs.writeFileSync(filename, JSON.stringify(index, null, 2));
  console.log(`\n✓ index.json (${index.length} planer)`);
}

// Main execution
console.log('Genererer leseplaner...\n');

const plans = [];
for (const definition of planDefinitions) {
  try {
    const plan = generatePlan(definition);
    savePlan(plan);
    plans.push(plan);
  } catch (error) {
    console.error(`✗ Feil ved generering av ${definition.id}: ${error.message}`);
  }
}

saveIndex(plans);

console.log(`\nFerdig! ${plans.length} leseplaner generert.`);
