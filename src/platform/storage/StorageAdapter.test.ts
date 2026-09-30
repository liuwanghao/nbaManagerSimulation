import { describe, expect, it } from "vitest";
import { ColorboxStorageAdapter, decodeStoredString, encodeStoredString, MemoryStorageAdapter, MigratingIndexedDbStorageAdapter } from "./StorageAdapter";

describe("MigratingIndexedDbStorageAdapter", () => {
  it("moves a legacy entry only after it is readable in the new store", async () => {
    const current = new MemoryStorageAdapter();
    const legacy = new MemoryStorageAdapter();
    await legacy.set("basketball-manager:career:1", "old save");
    const adapter = new MigratingIndexedDbStorageAdapter(current, legacy);
    expect(await adapter.get("basketball-manager:career:1")).toBe("old save");
    expect(await current.get("basketball-manager:career:1")).toBe("old save");
    expect(await legacy.get("basketball-manager:career:1")).toBeNull();
  });

  it("preserves legacy data when copying or verification fails", async () => {
    const legacy = new MemoryStorageAdapter();
    await legacy.set("career", "valid");
    const rejectedWrite = new MigratingIndexedDbStorageAdapter({
      async get() { return null; },
      async set() { throw new DOMException("Full", "QuotaExceededError"); },
      async remove() {},
    }, legacy);
    await expect(rejectedWrite.get("career")).rejects.toThrow();
    expect(await legacy.get("career")).toBe("valid");
    const unreadableWrite = new MigratingIndexedDbStorageAdapter({
      async get() { return null; },
      async set() {},
      async remove() {},
    }, legacy);
    await expect(unreadableWrite.get("career")).rejects.toThrow("SAVE_MIGRATION_VERIFICATION_FAILED");
    expect(await legacy.get("career")).toBe("valid");
  });

  it("keeps a newer current value if another writer wins during migration", async () => {
    const legacy = new MemoryStorageAdapter();
    const current = new MemoryStorageAdapter();
    await legacy.set("career", "old revision");
    const adapter = new MigratingIndexedDbStorageAdapter({
      get: (key) => current.get(key),
      set: (key, value) => current.set(key, value),
      remove: (key) => current.remove(key),
      async setIfAbsent(key) {
        await current.set(key, "new revision");
        return false;
      },
    }, legacy);
    expect(await adapter.get("career")).toBe("new revision");
    expect(await current.get("career")).toBe("new revision");
    expect(await legacy.get("career")).toBeNull();
  });

  it("overwrites a 30-season-sized entry when a 5 MiB legacy store cannot fit both revisions", async () => {
    const legacy = new MemoryStorageAdapter();
    const current = new MemoryStorageAdapter();
    const adapter = new MigratingIndexedDbStorageAdapter(current, legacy);
    const first = "A".repeat(2_840_000);
    const next = "B".repeat(2_840_000);
    const key = "basketball-manager:career:1";
    await legacy.set(key, first);
    expect(first.length + next.length).toBeGreaterThan(5 * 1_024 * 1_024);
    expect(await adapter.get(key)).toBe(first);
    await adapter.set(key, next);
    expect(await adapter.get(key)).toBe(next);
    expect(await legacy.get(key)).toBeNull();
  });
});

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
