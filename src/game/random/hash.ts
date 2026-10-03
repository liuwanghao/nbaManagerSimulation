const FNV_OFFSET_HIGH = 0xcbf29ce4;
const FNV_OFFSET_LOW = 0x84222325;
const FNV_PRIME_LOW = 0x1b3;

export function stableSerialize(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`).join(",")}}`;
  }
  return JSON.stringify(String(value));
}

class Fnv1a64 {
  private high = FNV_OFFSET_HIGH;
  private low = FNV_OFFSET_LOW;

  writeByte(byte: number): void {
    this.low = (this.low ^ byte) >>> 0;
    // 0x100000001b3 = (0x100 << 32) + 0x1b3. The low product is
    // below 2^53, so its carry is exact in a JavaScript number.
    const lowProduct = this.low * FNV_PRIME_LOW;
    this.high = (Math.imul(this.high, FNV_PRIME_LOW)
      + Math.floor(lowProduct / 0x1_0000_0000)
      + Math.imul(this.low, 0x100)) >>> 0;
    this.low = lowProduct >>> 0;
  }

  writeSaveSegment(segment: string): void {
    // Every segment is stableSerialize output: JSON string leaves already
    // escape control characters and lone surrogates. Only quotes/backslashes
    // need another escape for the outer JSON string used by the save hash.
    for (let index = 0; index < segment.length; index += 1) {
      const codePoint = segment.codePointAt(index)!;
      if (codePoint === 0x22 || codePoint === 0x5c) this.writeByte(0x5c);
      if (codePoint < 0x80) {
        this.writeByte(codePoint);
      } else if (codePoint < 0x800) {
        this.writeByte(0xc0 | (codePoint >>> 6));
        this.writeByte(0x80 | (codePoint & 0x3f));
      } else if (codePoint < 0x10000) {
        this.writeByte(0xe0 | (codePoint >>> 12));
        this.writeByte(0x80 | ((codePoint >>> 6) & 0x3f));
        this.writeByte(0x80 | (codePoint & 0x3f));
      } else {
        this.writeByte(0xf0 | (codePoint >>> 18));
        this.writeByte(0x80 | ((codePoint >>> 12) & 0x3f));
        this.writeByte(0x80 | ((codePoint >>> 6) & 0x3f));
        this.writeByte(0x80 | (codePoint & 0x3f));
        index += 1;
      }
    }
  }

  digest(): string {
    return this.high.toString(16).padStart(8, "0") + this.low.toString(16).padStart(8, "0");
  }
}

export function fnv1a64Utf8(input: string): string {
  const hash = new Fnv1a64();
  for (const byte of new TextEncoder().encode(input)) hash.writeByte(byte);
  return hash.digest();
}

export function stableHash(...parts: unknown[]): string {
  return fnv1a64Utf8(parts.map(stableSerialize).join("\u001f"));
}

/** Hash stableHash(stableSerialize(value)) without building whole-value strings. */
export function hashSaveValue(value: unknown): string {
  const hash = new Fnv1a64();
  const serialize = (item: unknown): void => {
    if (Array.isArray(item)) {
      hash.writeSaveSegment("[");
      const length = item.length;
      for (let index = 0; index < length; index += 1) {
        if (index > 0) hash.writeSaveSegment(",");
        // Array.map preserves holes; join contributes an empty slot for them.
        if (index in item) serialize(item[index]);
      }
      hash.writeSaveSegment("]");
    } else if (item !== null && typeof item === "object") {
      const entries = Object.entries(item as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([a], [b]) => a.localeCompare(b));
      hash.writeSaveSegment("{");
      entries.forEach(([key, entry], index) => {
        if (index > 0) hash.writeSaveSegment(",");
        hash.writeSaveSegment(JSON.stringify(key));
        hash.writeSaveSegment(":");
        serialize(entry);
      });
      hash.writeSaveSegment("}");
    } else {
      hash.writeSaveSegment(stableSerialize(item));
    }
  };
  hash.writeByte(0x22);
  serialize(value);
  hash.writeByte(0x22);
  return hash.digest();
}

export function low32FromHash(hash: string): number {
  return Number(BigInt(`0x${hash}`) & 0xffffffffn) >>> 0;
}
