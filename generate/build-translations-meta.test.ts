/**
 * bun test
 *
 * Seed-fila skal finnes der skriptet leter (#107).
 *
 * `translations_seed.json` ble flyttet fra skriptrota til `generate/data/`.
 * Kallstedet er `readJson(SEED_FILE) ?? {}`, så en sti som ikke finnes ser ut
 * som ingen seeds i det hele tatt: kjøringen går igjennom, og `meta.json` for
 * oversettelsene dette repoet lager selv blir skrevet uten det som er ført inn
 * for hånd. Ingen feilmelding, ingen exit-kode — bare metadata som mangler.
 */
import {test, expect} from 'bun:test';
import {existsSync, readFileSync} from 'fs';

import {SEED_FILE} from './build-translations-meta.js';

test('SEED_FILE peker på en fil som finnes', () => {
    expect(existsSync(SEED_FILE)).toBe(true);
});

test('seed-fila har oversettelsene dette repoet lager selv', () => {
    const seeds = JSON.parse(readFileSync(SEED_FILE, 'utf-8')) as Record<string, unknown>;

    // De tre oralske oversettelsene er nettopp de manuelle oppføringene seed-fila
    // finnes for — ingen modell kan slå opp hvem som lagde dem.
    expect(Object.keys(seeds)).toEqual(expect.arrayContaining(['osnb', 'osnn', 'osen']));
});
