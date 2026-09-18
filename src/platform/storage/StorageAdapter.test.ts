import { describe, expect, it } from "vitest";
import { ColorboxStorageAdapter, decodeStoredString, encodeStoredString } from "./StorageAdapter";

describe("ColorboxStorageAdapter", () => {
  it("round-trips native gzip storage payloads", async () => {
    const source = JSON.stringify({ seasons: Array.from({ length: 2_000 }, (_, index) => ({ index, team: "SEA", status: "FINAL" })) });
    const encoded = await encodeStoredString(source);
    expect(encoded.startsWith("gz:")).toBe(true);
    expect(encoded.length).toBeLessThan(source.length / 4);
    expect(await decodeStoredString(encoded)).toBe(source);
  });

  it("chunks values below the official 200KB write limit and reconstructs them", async () => {
    const values = new Map<string, unknown>();
    let largestWrite = 0;
    const adapter = new ColorboxStorageAdapter({
      async getValue(key) { return key ? values.get(key) ?? null : Object.fromEntries(values); },
      async setValue(data) {
        largestWrite = Math.max(largestWrite, new TextEncoder().encode(JSON.stringify(data)).byteLength);
        for (const [key, value] of Object.entries(data)) value === null ? values.delete(key) : values.set(key, value);
        return { ok: true };
      },
    });
    const payload = JSON.stringify({ names: "篮球经理🏀".repeat(35_000), state: "x".repeat(280_000) });
    await adapter.set("career:1", payload);
    expect(await adapter.get("career:1")).toBe(payload);
    expect(largestWrite).toBeLessThan(200_000);
    await adapter.remove("career:1");
    expect(await adapter.get("career:1")).toBeNull();
  });
});
