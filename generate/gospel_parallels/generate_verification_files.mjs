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

// Create temp directory
const tempDir = 'gospel_parallels/temp_verify';
if (fs.existsSync(tempDir)) {
  fs.rmSync(tempDir, { recursive: true });
}
fs.mkdirSync(tempDir, { recursive: true });

function getVerses(bookId, chapter, verseStart, verseEnd) {
  const filePath = path.join(biblePath, String(bookId), `${chapter}.json`);
  if (!fs.existsSync(filePath)) {
    return `FEIL: Filen ${filePath} finnes ikke`;
  }

  const chapterData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const verses = chapterData
    .filter(v => v.verseId >= verseStart && v.verseId <= verseEnd)
    .map(v => `${v.verseId}: ${v.text}`)
    .join('\n');

  if (!verses) {
    return `FEIL: Ingen vers funnet for ${verseStart}-${verseEnd}`;
  }

  return verses;
}

let fileIndex = 1;
for (const parallel of parallelsData.parallels) {
  let content = '';
  content += `TITTEL: ${parallel.title}\n`;
  content += `ID: ${parallel.id}\n`;
  content += `SEKSJON: ${parallel.section}\n`;
  if (parallel.notes) {
    content += `NOTAT: ${parallel.notes}\n`;
  }
  content += '\n';
  content += '='.repeat(60) + '\n\n';

  for (const [gospel, ref] of Object.entries(parallel.passages)) {
    const verses = getVerses(ref.bookId, ref.chapter, ref.verseStart, ref.verseEnd);
    content += `--- ${gospelNames[gospel]} ${ref.reference} ---\n\n`;
    content += verses + '\n\n';
  }

  const filename = `${String(fileIndex).padStart(2, '0')}_${parallel.id}.txt`;
  fs.writeFileSync(path.join(tempDir, filename), content);
  fileIndex++;
}

console.log(`Generert ${fileIndex - 1} filer i ${tempDir}/`);
