import type { UkvnMapper } from './ukvn-mapper.js';
import { ukvnDecode } from './ukvn-types.js';

export interface CrossMapResult {
  tkvn: number;
  osmainKvn: number;
  partial: boolean;
}

export class CrossMapper {
  constructor(
    private source: UkvnMapper,
    private target: UkvnMapper,
  ) {}

  map(sourceTkvn: number): CrossMapResult {
    const osmainKvn = this.source.toKvn(sourceTkvn);
    const decoded = ukvnDecode(osmainKvn);
    const partial = decoded.part > 0;
    const targetTkvn = this.target.toTkvn(osmainKvn);
    return { tkvn: targetTkvn, osmainKvn, partial };
  }
}
