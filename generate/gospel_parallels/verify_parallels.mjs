import fs from 'fs';
import path from 'path';

const parallelsData = JSON.parse(fs.readFileSync('gospel_parallels/parallels.json', 'utf-8'));
const biblePath = 'bibles_raw/osnb2';

const gospelNames = {
  matthew: 'Matteus',
  mark: 'Markus',
  luke: 'Lukas',
  john: 'Johannes'
};

function getVerses(bookId, chapter, verseStart, verseEnd) {
  const filePath = path.join(biblePath, String(bookId), `${chapter}.json`);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const chapterData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const verses = chapterData
    .filter(v => v.verseId >= verseStart && v.verseId <= verseEnd)
    .map(v => `${v.verseId}: ${v.text}`)
    .join('\n');

  return verses;
}

let output = '';
output += '# Verifisering av parallelle evangelietekster\n\n';
output += `Generert: ${new Date().toISOString()}\n\n`;
output += '---\n\n';

for (const section of parallelsData.sections) {
  const sectionParallels = parallelsData.parallels.filter(p => p.section === section.id);
  if (sectionParallels.length === 0) continue;

  output += `## ${section.name}\n`;
  output += `${section.description}\n\n`;

  for (const parallel of sectionParallels) {
    output += `### ${parallel.title}\n`;
    output += `ID: ${parallel.id}\n`;
    if (parallel.notes) {
      output += `Notat: ${parallel.notes}\n`;
    }
    output += '\n';

    for (const [gospel, ref] of Object.entries(parallel.passages)) {
      const verses = getVerses(ref.bookId, ref.chapter, ref.verseStart, ref.verseEnd);
      output += `**${gospelNames[gospel]} ${ref.reference}**\n`;
      if (verses) {
        output += '```\n';
        output += verses + '\n';
        output += '```\n\n';
      } else {
        output += `FEIL: Kunne ikke finne ${ref.bookId}/${ref.chapter}.json\n\n`;
      }
    }

    output += '---\n\n';
  }
}

fs.writeFileSync('gospel_parallels/verification_report.md', output);
console.log('Rapport skrevet til gospel_parallels/verification_report.md');
console.log(`Totalt ${parallelsData.parallels.length} paralleller verifisert`);
