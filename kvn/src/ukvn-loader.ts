import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { UkvnMappingFile } from './ukvn-types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAPPINGS_DIR = join(__dirname, '../mappings');

export function loadUkvnMapping(systemOrPath: string): UkvnMappingFile {
  let mappingPath: string;
  if (systemOrPath.includes('/') || systemOrPath.endsWith('.json')) {
    mappingPath = systemOrPath;
  } else {
    mappingPath = join(MAPPINGS_DIR, `${systemOrPath}.ukvn.json`);
  }
  return JSON.parse(readFileSync(mappingPath, 'utf-8'));
}

export function listUkvnMappings(): string[] {
  return readdirSync(MAPPINGS_DIR)
    .filter(f => f.endsWith('.ukvn.json'))
    .map(f => f.replace('.ukvn.json', ''));
}
