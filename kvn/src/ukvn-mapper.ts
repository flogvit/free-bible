import type { UkvnMappingFile } from './ukvn-types.js';

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
    return this.kvnToTkvn.get(kvn) ?? kvn;
  }

  toKvn(tkvn: number): number {
    return this.tkvnToKvn.get(tkvn) ?? tkvn;
  }

  get entryCount(): number {
    return this.kvnToTkvn.size;
  }
}
