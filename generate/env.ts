/**
 * Laster `generate/.env`. Erstatter `dotenv` (#111).
 *
 * Bun laster `.env` automatisk — men fra arbeidskatalogen, og fila ligger i
 * `generate/`. Skriptene kjøres fra repo-rota (`bun generate/bible.ts`), så
 * den automatiske lastingen finner den ikke. Derfor denne.
 *
 * Standarden i prosjektet er så få npm-pakker som mulig, helst ingen. `dotenv`
 * var 27 importer for 20 linjer arbeid — og versjonen som lå der (16.0.3)
 * kjente ikke `quiet`-flagget ett av skriptene sendte, så det ble stille
 * ignorert.
 *
 * Bruk:
 *
 *     import './env.js';   // øverst, før noe leser process.env
 */

import {existsSync, readFileSync} from 'fs';
import {dirname, join} from 'path';
import {fileURLToPath} from 'url';

/**
 * Parser innholdet i en `.env`-fil.
 *
 * Eksportert for at den skal kunne testes uten en fil på disk.
 */
export function parseEnv(content: string): Record<string, string> {
    const out: Record<string, string> = {};

    for (const rawLine of content.split('\n')) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;

        const eq = line.indexOf('=');
        if (eq === -1) continue;

        const key = line.slice(0, eq).trim();
        if (!key) continue;

        let value = line.slice(eq + 1).trim();

        // Sitater fjernes, men bare når de omslutter HELE verdien. En verdi som
        // «say "hi"» skal beholde sine.
        const quote = value[0];
        if ((quote === '"' || quote === "'") && value.length > 1 && value.at(-1) === quote) {
            value = value.slice(1, -1);
            // \n er bare en escape inni doble sitater, som i skallet.
            if (quote === '"') value = value.replace(/\\n/g, '\n');
        }

        out[key] = value;
    }

    return out;
}

/**
 * Leser en `.env`-fil og setter nøklene i `process.env`.
 *
 * **Eksisterende verdier vinner.** En variabel satt i skallet — eller av en
 * kø — skal ikke kunne overstyres av en fil på disk. Det er samme regel som
 * dotenv har, og køskriptene bygger på den.
 *
 * @returns nøklene som faktisk ble satt
 */
export function loadEnv(file: string): string[] {
    if (!existsSync(file)) return [];

    const parsed = parseEnv(readFileSync(file, 'utf-8'));
    const applied: string[] = [];

    for (const [key, value] of Object.entries(parsed)) {
        if (process.env[key] === undefined) {
            process.env[key] = value;
            applied.push(key);
        }
    }

    return applied;
}

// Lastes ved import, slik `dotenv.config()` gjorde. Stien er relativ til denne
// fila, ikke til arbeidskatalogen, så det spiller ingen rolle hvor du står.
loadEnv(join(dirname(fileURLToPath(import.meta.url)), '.env'));
