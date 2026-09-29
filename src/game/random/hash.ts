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

export function fnv1a64Utf8(input: string): string {
  let high = FNV_OFFSET_HIGH;
  let low = FNV_OFFSET_LOW;
  for (const byte of new TextEncoder().encode(input)) {
    low = (low ^ byte) >>> 0;
    // 0x100000001b3 = (0x100 << 32) + 0x1b3. The low product is
    // below 2^53, so its carry is exact in a JavaScript number.
    const lowProduct = low * FNV_PRIME_LOW;
    high = (Math.imul(high, FNV_PRIME_LOW)
      + Math.floor(lowProduct / 0x1_0000_0000)
      + Math.imul(low, 0x100)) >>> 0;
    low = lowProduct >>> 0;
  }
  return high.toString(16).padStart(8, "0") + low.toString(16).padStart(8, "0");
}

export function stableHash(...parts: unknown[]): string {
  return fnv1a64Utf8(parts.map(stableSerialize).join("\u001f"));
}

export function low32FromHash(hash: string): number {
  return Number(BigInt(`0x${hash}`) & 0xffffffffn) >>> 0;
}
