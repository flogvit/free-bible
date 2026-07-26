import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { KvnMappingFile } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAPPINGS_DIR = join(__dirname, '../mappings');

/**
 * Load a KVN mapping file.
 *
 * - No argument: loads dnb_2011_nb (default)
 * - System name (e.g. "osnn"): loads mappings/<system>.kvn.json
 * - Full path (contains '/' or '.json'): loads directly from that path
 */
export function loadKvnMapping(systemOrPath?: string): KvnMappingFile {
  let mappingPath: string;
  if (!systemOrPath) {
    mappingPath = join(MAPPINGS_DIR, 'dnb_2011_nb.kvn.json');
  } else if (systemOrPath.includes('/') || systemOrPath.endsWith('.json')) {
    mappingPath = systemOrPath;
  } else {
    mappingPath = join(MAPPINGS_DIR, `${systemOrPath}.kvn.json`);
  }
  return JSON.parse(readFileSync(mappingPath, 'utf-8'));
}

/**
 * List available mapping system names by scanning the mappings directory.
 * Returns names like ["dnb_2011_nb", "osnn"] (without .kvn.json suffix).
 */
export function listMappingSystems(): string[] {
  return readdirSync(MAPPINGS_DIR)
    .filter(f => f.endsWith('.kvn.json'))
    .map(f => f.replace('.kvn.json', ''))
    .sort();
}
