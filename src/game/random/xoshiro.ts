import { low32FromHash, stableHash } from "./hash";

function rotl(value: number, shift: number): number {
  return ((value << shift) | (value >>> (32 - shift))) >>> 0;
}

export class DeterministicRng {
  private readonly state: Uint32Array;

  constructor(seed: string) {
    this.state = new Uint32Array(4);
    for (let index = 0; index < 4; index += 1) {
      this.state[index] = low32FromHash(stableHash(`${seed}#${index}`));
    }
    if (this.state.every((value) => value === 0)) this.state[0] = 0x9e3779b9;
  }

  nextUint32(): number {
    const result = Math.imul(rotl(Math.imul(this.state[1], 5) >>> 0, 7), 9) >>> 0;
    const temporary = (this.state[1] << 9) >>> 0;
    this.state[2] ^= this.state[0];
    this.state[3] ^= this.state[1];
    this.state[1] ^= this.state[2];
    this.state[0] ^= this.state[3];
    this.state[2] ^= temporary;
    this.state[3] = rotl(this.state[3], 11);
    return result;
  }

  nextFloat(): number {
    return this.nextUint32() / 0x100000000;
  }

  int(minInclusive: number, maxInclusive: number): number {
    return minInclusive + Math.floor(this.nextFloat() * (maxInclusive - minInclusive + 1));
  }

  normalLike(standardDeviation = 1): number {
    let total = 0;
    for (let index = 0; index < 12; index += 1) total += this.nextFloat();
    return (total - 6) * standardDeviation;
  }

  shuffle<T>(items: readonly T[]): T[] {
    const copy = [...items];
    for (let index = copy.length - 1; index > 0; index -= 1) {
      const other = this.int(0, index);
      [copy[index], copy[other]] = [copy[other], copy[index]];
    }
    return copy;
  }
}

export function createRng(seed: string): DeterministicRng {
  return new DeterministicRng(seed);
}
