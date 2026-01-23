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

// Persons to generate - Tier 1 (main characters)
const personsList = [
    // Tier 1 - Main characters
    { id: "jesus", name: "Jesus", searchTerms: ["Jesus", "Kristus", "Messias", "Guds Sønn", "Menneskesønnen"] },
    { id: "abraham", name: "Abraham", searchTerms: ["Abraham", "Abram"] },
    { id: "moses", name: "Moses", searchTerms: ["Moses"] },
    { id: "david", name: "David", searchTerms: ["David"] },
    { id: "paulus", name: "Paulus", searchTerms: ["Paulus", "Saulus"] },
    { id: "peter", name: "Peter", searchTerms: ["Peter", "Simon Peter", "Kefas", "Simon"] },
    { id: "jakob-israel", name: "Jakob (Israel)", searchTerms: ["Jakob", "Israel"] },
    { id: "josef-gt", name: "Josef (sønn av Jakob)", searchTerms: ["Josef"] },
    { id: "isak", name: "Isak", searchTerms: ["Isak"] },
    { id: "noah", name: "Noah", searchTerms: ["Noah", "Noa"] },
    { id: "salomo", name: "Salomo", searchTerms: ["Salomo"] },
    { id: "johannes-apostel", name: "Johannes (apostel)", searchTerms: ["Johannes"] },

    // Tier 2 - Important characters
    { id: "elia", name: "Elia", searchTerms: ["Elia", "Elias"] },
    { id: "elisa", name: "Elisa", searchTerms: ["Elisa"] },
    { id: "samuel", name: "Samuel", searchTerms: ["Samuel"] },
    { id: "daniel", name: "Daniel", searchTerms: ["Daniel"] },
    { id: "jeremia", name: "Jeremia", searchTerms: ["Jeremia"] },
    { id: "jesaja", name: "Jesaja", searchTerms: ["Jesaja"] },
    { id: "josva", name: "Josva", searchTerms: ["Josva"] },
    { id: "rut", name: "Rut", searchTerms: ["Rut", "Ruth"] },
    { id: "ester", name: "Ester", searchTerms: ["Ester"] },
    { id: "maria-jesu-mor", name: "Maria (Jesu mor)", searchTerms: ["Maria"] },
    { id: "johannes-doperen", name: "Johannes døperen", searchTerms: ["Johannes", "døperen"] },
    { id: "judas-iskariot", name: "Judas Iskariot", searchTerms: ["Judas Iskariot"] },
    { id: "stefanus", name: "Stefanus", searchTerms: ["Stefanus"] },
    { id: "barnabas", name: "Barnabas", searchTerms: ["Barnabas"] },
    { id: "timoteus", name: "Timoteus", searchTerms: ["Timoteus"] },
    { id: "nehemja", name: "Nehemja", searchTerms: ["Nehemja"] },
    { id: "esra", name: "Esra", searchTerms: ["Esra"] },
    { id: "job", name: "Job", searchTerms: ["Job"] },
    { id: "adam", name: "Adam", searchTerms: ["Adam"] },
    { id: "eva", name: "Eva", searchTerms: ["Eva"] },
];

// Roles in Norwegian
const roles = {
    prophet: "profet",
    king: "konge",
    judge: "dommer",
    priest: "prest",
    apostle: "apostel",
    disciple: "disippel",
    leader: "leder",
    matriarch: "matriark",
    patriarch: "patriark",
    martyr: "martyr",
    warrior: "kriger",
    wiseman: "vismann"
};

// Eras (linked to timeline periods)
const eras = {
    creation: "Skapelsen",
    patriarchs: "Patriarkene",
    exodus: "Utgang fra Egypt",
    conquest: "Erobringen",
    judges: "Dommertiden",
    "united-kingdom": "Det forente kongerike",
    "divided-kingdom": "Det delte kongerike",
    exile: "Eksilet",
    return: "Tilbakekomsten",
    intertestamental: "Mellomtestamentlig tid",
    jesus: "Jesu tid",
    "early-church": "Den tidlige kirke"
};

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
    const { id, name, searchTerms } = personConfig;
    const outputPath = path.join(__dirname, "persons", "nb", `${id}.json`);

    // Skip if already exists
    if (fs.existsSync(outputPath)) {
        console.log(`Skipping ${name} - already exists`);
        return;
    }

    console.log(`Generating profile for ${name}...`);

    const prompt = `Generate a comprehensive biblical character profile for ${name} in Norwegian bokmål.
The profile should follow this exact JSON structure:

{
  "id": "${id}",
  "name": "${name}",
  "title": "<kort beskrivende tittel, f.eks. 'Troens far' eller 'Israels konge'>",
  "era": "<en av: creation, patriarchs, exodus, conquest, judges, united-kingdom, divided-kingdom, exile, return, intertestamental, jesus, early-church>",
  "lifespan": "<omtrentlig levetid hvis kjent, f.eks. 'ca. 2000 f.Kr.' eller '?'>",
  "summary": "<2-3 setninger som oppsummerer personen og deres betydning>",
  "roles": [<liste med roller fra: profet, konge, dommer, prest, apostel, disippel, leder, matriark, patriark, martyr, kriger, vismann>],
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
2. Include 4-6 key events that are most significant for this person
3. For keyEvents verses, use accurate book IDs: OT books 1-39, NT books 40-66
4. All descriptions and text should be in Norwegian bokmål
5. Be historically and biblically accurate
6. Include both OT and NT references where relevant (e.g., for Abraham include Hebrews references)

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

    } catch (error) {
        console.error(`Error generating ${name}:`, error.message);
    }
}

function nameToId(name) {
    return name
        .replace(/\s*\([^)]*\)/g, "") // Remove parentheses and their content
        .trim()
        .toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Remove accents
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9-]/g, "");
}

async function main() {
    const args = process.argv.slice(2);

    if (args.length === 0) {
        console.log("Usage: node bible_persons.mjs <person-id|name|all>");
        console.log("\nExamples:");
        console.log('  node bible_persons.mjs "Set (Adams sønn)"');
        console.log('  node bible_persons.mjs abraham');
        console.log('  node bible_persons.mjs all');
        console.log("\nPre-defined persons:");
        personsList.forEach(p => console.log(`  ${p.id} - ${p.name}`));
        return;
    }

    const input = args.join(" "); // Support names with spaces

    if (input === "all") {
        // Generate all persons
        for (const person of personsList) {
            await generatePerson(person);
            // Small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    } else {
        // Check if it's a predefined person by id
        let person = personsList.find(p => p.id === input);

        if (!person) {
            // Check if name matches a predefined person
            person = personsList.find(p => p.name.toLowerCase() === input.toLowerCase());
        }

        if (!person) {
            // Create a new person config from the provided name
            const id = nameToId(input);
            person = {
                id: id,
                name: input,
                searchTerms: [input]
            };
            console.log(`Creating new person: ${input} (id: ${id})`);
        }

        await generatePerson(person);
    }
}

main();
