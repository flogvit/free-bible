import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { UkvnMappingFile } from './ukvn-types.js';
import { resolveMappingId } from './ukvn-types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAPPINGS_DIR = join(__dirname, '../mappings');

export function loadUkvnMapping(systemOrPath: string): UkvnMappingFile {
  let mappingPath: string;
  if (systemOrPath.includes('/') || systemOrPath.endsWith('.json')) {
    mappingPath = systemOrPath;
  } else {
    mappingPath = join(MAPPINGS_DIR, `${systemOrPath}.ukvn.json`);
    if (!existsSync(mappingPath)) {
      // Shortnames og legacy-navn (f.eks. «dnb2024» → dnb2024_nb)
      const resolved = resolveMappingId(systemOrPath);
      if (resolved && resolved !== systemOrPath) {
        mappingPath = join(MAPPINGS_DIR, `${resolved}.ukvn.json`);
      }
    }
  }
  return JSON.parse(readFileSync(mappingPath, 'utf-8'));
}

export function listUkvnMappings(): string[] {
  // Sortert: readdir-rekkefølge er filsystemavhengig og ga ulik rekkefølge på
  // ulike maskiner/disker.
  return readdirSync(MAPPINGS_DIR)
    .filter(f => f.endsWith('.ukvn.json'))
    .map(f => f.replace('.ukvn.json', ''))
    .sort();
}
