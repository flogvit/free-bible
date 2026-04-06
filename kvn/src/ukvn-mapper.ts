import type { UkvnMappingFile } from './ukvn-types.js';
import { UKVN_PART_SIZE } from './ukvn-types.js';

export class UkvnMapper {
  private kvnToTkvn = new Map<number, number>();
  private tkvnToKvn = new Map<number, number>();
  readonly system: string;

  constructor(mapping: UkvnMappingFile) {
    this.system = mapping.system;
    for (const entry of mapping.map) {
      this.kvnToTkvn.set(entry.kvnFrom, entry.tkvnFrom);
      if (!this.tkvnToKvn.has(entry.tkvnFrom)) {
        this.tkvnToKvn.set(entry.tkvnFrom, entry.kvnFrom);
      }
    }
  }

  toTkvn(kvn: number): number {
    const exact = this.kvnToTkvn.get(kvn);
    if (exact !== undefined) return exact;
    const part = kvn % UKVN_PART_SIZE;
    if (part > 0) {
      const base = this.kvnToTkvn.get(kvn - part);
      if (base !== undefined) return base + part;
    }
    return kvn;
  }

  toKvn(tkvn: number): number {
    const exact = this.tkvnToKvn.get(tkvn);
    if (exact !== undefined) return exact;
    const part = tkvn % UKVN_PART_SIZE;
    if (part > 0) {
      const base = this.tkvnToKvn.get(tkvn - part);
      if (base !== undefined) return base + part;
    }
    return tkvn;
  }

  get entryCount(): number {
    return this.kvnToTkvn.size;
  }
}
