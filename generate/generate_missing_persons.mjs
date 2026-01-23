import dotenv from 'dotenv'
import * as fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config()

import Anthropic from '@anthropic-ai/sdk';
import {anthropicModel} from "./constants.js";

const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
});

function nameToId(name) {
    return name
        .replace(/\s*\([^)]*\)/g, "") // Remove parentheses and their content
        .trim()
        .toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Remove accents
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9-]/g, "");
}

function parseMissingPersons() {
    const mdPath = path.join(__dirname, "persons", "PERSONER.md");
    const content = fs.readFileSync(mdPath, 'utf-8');

    const persons = [];
    const lines = content.split('\n');

    for (const line of lines) {
        // Match lines like "- [ ] Name (description)"
        const match = line.match(/^-\s*\[\s*\]\s*(.+)$/);
        if (match) {
            const fullName = match[1].trim();
            const id = nameToId(fullName);
            persons.push({ id, name: fullName });
        }
    }

    return persons;
}

function getExistingPersons() {
    const personsDir = path.join(__dirname, "persons", "nb");
    const files = fs.readdirSync(personsDir);
    return files
        .filter(f => f.endsWith('.json'))
        .map(f => f.replace('.json', ''));
}

async function doAnthropicCall(content) {
    return anthropic.messages.create({
        model: anthropicModel,
        max_tokens: 8192,
        system: `You are a biblical scholar assistant. You MUST respond with valid JSON only.
Never include explanations, comments, or any text outside the JSON structure.
All text content should be in Norwegian bokmål.`,
        messages: [
            {
                role: "user",
                content
            }
        ]
    });
}

async function generatePerson(personConfig) {
    const { id, name } = personConfig;
    const outputPath = path.join(__dirname, "persons", "nb", `${id}.json`);

    // Skip if already exists
    if (fs.existsSync(outputPath)) {
        console.log(`Skipping ${name} - already exists`);
        return { status: 'skipped', name };
    }

    console.log(`Generating profile for ${name}...`);

    const prompt = `Generate a comprehensive biblical character profile for ${name} in Norwegian bokmål.
The profile should follow this exact JSON structure:

{
  "id": "${id}",
  "name": "${name}",
  "title": "<kort beskrivende tittel, f.eks. 'Troens far' eller 'Israels konge'>",
  "era": "<en av: creation, patriarchs, exodus, conquest, judges, united-kingdom, divided-kingdom, exile, return, intertestamental, jesus, early-church>",
  "lifespan": "<omtrentlig levetid hvis kjent, f.eks. 'ca. 2000 f.Kr.' eller utelat hvis ukjent>",
  "summary": "<2-3 setninger som oppsummerer personen og deres betydning>",
  "roles": [<liste med roller fra: profet, konge, dommer, prest, apostel, disippel, leder, matriark, patriark, martyr, kriger, vismann, tjener, hærfører, dronning, prinsesse>],
  "family": {
    "father": "<fars id eller null>",
    "mother": "<mors id eller null>",
    "siblings": [<liste med søskens id-er>],
    "spouse": "<ektefelles id eller null>",
    "children": [<liste med barns id-er>]
  },
  "relatedPersons": [<liste med andre relaterte personers id-er>],
  "keyEvents": [
    {
      "title": "<kort tittel>",
      "description": "<1-2 setninger>",
      "verses": [{ "bookId": <1-66>, "chapter": <nummer>, "verses": [<vers-nummer>] }]
    }
  ]
}

Important guidelines:
1. Use lowercase IDs for family members and related persons (e.g., "abraham", "sara", "isak")
2. Include 3-6 key events that are most significant for this person
3. For keyEvents verses, use accurate book IDs: OT books 1-39, NT books 40-66
4. All descriptions and text should be in Norwegian bokmål
5. Be historically and biblically accurate
6. Include both OT and NT references where relevant
7. If the person has limited biblical mentions, include fewer keyEvents but make them accurate

Response ONLY with the JSON, no other text.`;

    try {
        const completion = await doAnthropicCall(prompt);
        let responseText = completion.content[0].text;

        // Clean up potential markdown formatting
        responseText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

        // Validate JSON
        const personData = JSON.parse(responseText);

        // Write to file
        fs.writeFileSync(outputPath, JSON.stringify(personData, null, 2));
        console.log(`  Written: ${outputPath}`);
        return { status: 'created', name };

    } catch (error) {
        console.error(`Error generating ${name}:`, error.message);
        return { status: 'error', name, error: error.message };
    }
}

async function main() {
    const args = process.argv.slice(2);

    // Parse options
    const dryRun = args.includes('--dry-run');
    const limit = args.find(a => a.startsWith('--limit='));
    const maxCount = limit ? parseInt(limit.split('=')[1]) : Infinity;
    const startFrom = args.find(a => a.startsWith('--start='));
    const startIndex = startFrom ? parseInt(startFrom.split('=')[1]) : 0;

    console.log("Parsing PERSONER.md...");
    const allPersons = parseMissingPersons();
    const existing = getExistingPersons();

    // Filter out already existing
    const missing = allPersons.filter(p => !existing.includes(p.id));

    console.log(`\nFound ${allPersons.length} persons in PERSONER.md`);
    console.log(`Already have ${existing.length} person files`);
    console.log(`Missing: ${missing.length} persons\n`);

    if (dryRun) {
        console.log("Missing persons:");
        missing.forEach((p, i) => console.log(`  ${i + 1}. ${p.name} (${p.id})`));
        console.log("\nRun without --dry-run to generate files");
        return;
    }

    // Apply start index and limit
    const toGenerate = missing.slice(startIndex, startIndex + maxCount);

    console.log(`Generating ${toGenerate.length} persons (starting from index ${startIndex})...\n`);

    const results = { created: 0, skipped: 0, errors: [] };

    for (let i = 0; i < toGenerate.length; i++) {
        const person = toGenerate[i];
        console.log(`[${i + 1}/${toGenerate.length}] Processing ${person.name}...`);

        const result = await generatePerson(person);

        if (result.status === 'created') results.created++;
        else if (result.status === 'skipped') results.skipped++;
        else if (result.status === 'error') results.errors.push(result);

        // Delay between API calls to avoid rate limiting
        if (i < toGenerate.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1500));
        }
    }

    console.log("\n--- Summary ---");
    console.log(`Created: ${results.created}`);
    console.log(`Skipped: ${results.skipped}`);
    console.log(`Errors: ${results.errors.length}`);

    if (results.errors.length > 0) {
        console.log("\nFailed:");
        results.errors.forEach(e => console.log(`  - ${e.name}: ${e.error}`));
    }
}

main();
