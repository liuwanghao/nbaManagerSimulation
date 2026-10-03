import { afterEach, describe, expect, it, vi } from "vitest";
import { ColorboxStorageAdapter, decodeStoredString, encodeStoredString, IndexedDbStorageAdapter, LocalStorageAdapter, MemoryStorageAdapter, MigratingIndexedDbStorageAdapter, type StorageAdapter } from "./StorageAdapter";

function indexedDbHarness() {
  const values = new Map<string, string>([["career", "raw:previous"]]);
  const requests: Array<{
    result: IDBDatabase;
    error: DOMException | null;
    transaction: IDBTransaction | null;
    onupgradeneeded: (() => void) | null;
    onsuccess: (() => void) | null;
    onerror: (() => void) | null;
    onblocked: (() => void) | null;
  }> = [];
  const transactions: Array<{
    error: DOMException | null;
    oncomplete: (() => void) | null;
    onerror: (() => void) | null;
    onabort: (() => void) | null;
    abort: ReturnType<typeof vi.fn>;
    complete(): void;
    objectStore(): unknown;
  }> = [];
  const databases: Array<{
    close: ReturnType<typeof vi.fn>;
    onversionchange: (() => void) | null;
    onclose: (() => void) | null;
    transaction: ReturnType<typeof vi.fn>;
  }> = [];
  const open = vi.fn(() => {
    const database = {
      close: vi.fn(),
      onversionchange: null as (() => void) | null,
      onclose: null as (() => void) | null,
      objectStoreNames: { contains: () => true },
      createObjectStore: vi.fn(),
      transaction: vi.fn(() => {
        let aborted = false;
        let write: [string, string] | undefined;
        const request = { result: undefined as unknown };
        const transaction = {
          error: null as DOMException | null,
          oncomplete: null as (() => void) | null,
          onerror: null as (() => void) | null,
          onabort: null as (() => void) | null,
          abort: vi.fn(() => { aborted = true; }),
          complete() {
            if (!aborted && write) values.set(...write);
            transaction.oncomplete?.();
          },
          objectStore: () => ({
            get(key: string) { request.result = values.get(key); return request; },
            put(value: string, key: string) { write = [key, value]; request.result = key; return request; },
            add(value: string, key: string) {
              if (values.has(key)) transaction.error = new DOMException("Already present", "ConstraintError");
              else { write = [key, value]; request.result = key; }
              return request;
            },
          }),
        };
        transactions.push(transaction);
        return transaction;
      }),
    };
    databases.push(database);
    const request = {
      result: database as unknown as IDBDatabase,
      error: null as DOMException | null,
      transaction: null as IDBTransaction | null,
      onupgradeneeded: null as (() => void) | null,
      onsuccess: null as (() => void) | null,
      onerror: null as (() => void) | null,
      onblocked: null as (() => void) | null,
    };
    requests.push(request);
    return request;
  });
  vi.stubGlobal("window", { indexedDB: { open } });
  return { values, requests, transactions, databases, open };
}

describe("IndexedDbStorageAdapter", () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("persists prepared encodings directly and uses atomic insert without replacing existing bytes", async () => {
    const harness = indexedDbHarness();
    const adapter = new IndexedDbStorageAdapter();
    const encoded = "gz:prepared-data";
    const write = adapter.setEncoded("next", encoded);
    harness.requests[0].onsuccess?.();
    await Promise.resolve();
    harness.transactions[0].complete();
    await write;
    expect(harness.values.get("next")).toBe(encoded);
    const read = adapter.getEncoded("next");
    await Promise.resolve();
    harness.transactions[1].complete();
    expect(await read).toBe(encoded);
    const competing = adapter.setEncodedIfAbsent("next", "raw:older");
    await Promise.resolve();
    harness.transactions[2].onerror?.();
    expect(await competing).toBe(false);
    expect(harness.values.get("next")).toBe(encoded);
    const inserted = adapter.setEncodedIfAbsent("empty", "raw:checkpoint index");
    await Promise.resolve();
    harness.transactions[3].complete();
    expect(await inserted).toBe(true);
    expect(harness.values.get("empty")).toBe("raw:checkpoint index");
  });

  it.each(["blocked", "error"] as const)("preserves data and retries after an open %s", async (event) => {
    const harness = indexedDbHarness();
    const adapter = new IndexedDbStorageAdapter();
    expect(harness.open).not.toHaveBeenCalled();
    const first = adapter.get("career");
    const rejected = expect(first).rejects.toThrow(event === "blocked" ? "INDEXED_DB_OPEN_BLOCKED" : "unavailable");
    if (event === "blocked") harness.requests[0].onblocked?.();
    else {
      harness.requests[0].error = new DOMException("unavailable", "UnknownError");
      harness.requests[0].onerror?.();
    }
    await rejected;
    expect(harness.values.get("career")).toBe("raw:previous");
    const retry = adapter.get("career");
    expect(harness.open).toHaveBeenCalledTimes(2);
    harness.requests[1].onsuccess?.();
    await Promise.resolve();
    harness.transactions[0].complete();
    expect(await retry).toBe("previous");
    harness.requests[0].onsuccess?.();
    expect(harness.databases[0].close).toHaveBeenCalledOnce();
    expect(harness.databases[1].close).not.toHaveBeenCalled();
  });

  it("times out a silent open and closes its late connection without replacing a retry", async () => {
    vi.useFakeTimers();
    const harness = indexedDbHarness();
    const adapter = new IndexedDbStorageAdapter();
    const first = adapter.get("career");
    const rejected = expect(first).rejects.toThrow("INDEXED_DB_OPEN_TIMEOUT");
    await vi.advanceTimersByTimeAsync(10_000);
    await rejected;
    expect(harness.values.get("career")).toBe("raw:previous");
    const retry = adapter.get("career");
    harness.requests[1].onsuccess?.();
    await Promise.resolve();
    harness.transactions[0].complete();
    expect(await retry).toBe("previous");
    harness.requests[0].onsuccess?.();
    expect(harness.databases[0].close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    const next = adapter.get("career");
    await Promise.resolve();
    expect(harness.open).toHaveBeenCalledTimes(2);
    harness.transactions[1].complete();
    expect(await next).toBe("previous");
  });

  it("closes on versionchange and opens a fresh connection for later operations", async () => {
    const harness = indexedDbHarness();
    const adapter = new IndexedDbStorageAdapter();
    const first = adapter.get("career");
    harness.requests[0].onsuccess?.();
    await Promise.resolve();
    harness.transactions[0].complete();
    await first;
    harness.databases[0].onversionchange?.();
    expect(harness.databases[0].close).toHaveBeenCalledOnce();
    const next = adapter.get("career");
    expect(harness.open).toHaveBeenCalledTimes(2);
    harness.requests[1].onsuccess?.();
    await Promise.resolve();
    harness.transactions[1].complete();
    expect(await next).toBe("previous");
  });

  it("reopens after an unexpected connection close", async () => {
    const harness = indexedDbHarness();
    const adapter = new IndexedDbStorageAdapter();
    const first = adapter.get("career");
    harness.requests[0].onsuccess?.();
    await Promise.resolve();
    harness.transactions[0].complete();
    await first;
    harness.databases[0].onclose?.();
    const next = adapter.get("career");
    expect(harness.open).toHaveBeenCalledTimes(2);
    harness.requests[1].onsuccess?.();
    await Promise.resolve();
    harness.transactions[1].complete();
    expect(await next).toBe("previous");
  });

  it("rejects an invalid connection without replaying the write and reopens on retry", async () => {
    const harness = indexedDbHarness();
    const adapter = new IndexedDbStorageAdapter();
    const first = adapter.get("career");
    harness.requests[0].onsuccess?.();
    await Promise.resolve();
    harness.transactions[0].complete();
    await first;
    harness.databases[0].transaction.mockImplementationOnce(() => { throw new DOMException("connection closed", "InvalidStateError"); });
    await expect(adapter.set("career", "next")).rejects.toThrow("connection closed");
    expect(harness.databases[0].close).toHaveBeenCalledOnce();
    expect(harness.open).toHaveBeenCalledTimes(1);
    expect(harness.values.get("career")).toBe("raw:previous");
    const retry = adapter.get("career");
    expect(harness.open).toHaveBeenCalledTimes(2);
    harness.requests[1].onsuccess?.();
    await Promise.resolve();
    harness.transactions[1].complete();
    expect(await retry).toBe("previous");
  });

  it.each(["AbortError", "QuotaExceededError"])("keeps the connection reusable after %s", async (name) => {
    const harness = indexedDbHarness();
    const adapter = new IndexedDbStorageAdapter();
    const first = adapter.get("career");
    harness.requests[0].onsuccess?.();
    await Promise.resolve();
    harness.transactions[0].complete();
    await first;
    harness.databases[0].transaction.mockImplementationOnce(() => { throw new DOMException("transaction rejected", name); });
    await expect(adapter.set("career", "next")).rejects.toThrow("transaction rejected");
    expect(harness.databases[0].close).not.toHaveBeenCalled();
    const retry = adapter.get("career");
    await Promise.resolve();
    expect(harness.open).toHaveBeenCalledTimes(1);
    harness.transactions[1].complete();
    expect(await retry).toBe("previous");
  });

  it("aborts a silent write transaction before rejecting and keeps the previous value", async () => {
    vi.useFakeTimers();
    const harness = indexedDbHarness();
    const adapter = new IndexedDbStorageAdapter();
    const write = adapter.set("career", "next");
    const rejected = expect(write).rejects.toThrow("INDEXED_DB_TRANSACTION_TIMEOUT");
    await vi.advanceTimersByTimeAsync(0);
    harness.requests[0].onsuccess?.();
    await Promise.resolve();
    const transaction = harness.transactions[0];
    await vi.advanceTimersByTimeAsync(10_000);
    await rejected;
    expect(transaction.abort).toHaveBeenCalledOnce();
    expect(harness.values.get("career")).toBe("raw:previous");
    transaction.complete();
    transaction.onabort?.();
    expect(harness.values.get("career")).toBe("raw:previous");
    expect(vi.getTimerCount()).toBe(0);
    const retry = adapter.get("career");
    await Promise.resolve();
    harness.transactions[1].complete();
    expect(await retry).toBe("previous");
  });

  it.each(["complete", "error", "abort"] as const)("clears timeouts after transaction %s", async (event) => {
    vi.useFakeTimers();
    const harness = indexedDbHarness();
    const adapter = new IndexedDbStorageAdapter();
    const read = adapter.get("career");
    const result = event === "complete" ? expect(read).resolves.toBe("previous") : expect(read).rejects.toThrow("transaction failed");
    harness.requests[0].onsuccess?.();
    await Promise.resolve();
    const transaction = harness.transactions[0];
    if (event === "complete") transaction.complete();
    else {
      transaction.error = new DOMException("transaction failed", "UnknownError");
      if (event === "error") transaction.onerror?.();
      else transaction.onabort?.();
    }
    await result;
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(transaction.abort).not.toHaveBeenCalled();
  });
});

describe("MigratingIndexedDbStorageAdapter", () => {
  it("does not expose an encoded capability for injected decoded-only backends", () => {
    const adapter = new MigratingIndexedDbStorageAdapter(new MemoryStorageAdapter(), new MemoryStorageAdapter());
    expect(adapter.getEncoded).toBeUndefined();
    expect(adapter.setEncoded).toBeUndefined();
  });

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

function encodedMemory() {
  const values = new Map<string, string>();
  const adapter = {
    get: async (key: string) => values.has(key) ? decodeStoredString(values.get(key)!) : null,
    set: async (key: string, value: string) => { values.set(key, await encodeStoredString(value)); },
    remove: vi.fn(async (key: string) => { values.delete(key); }),
    getEncoded: vi.fn(async (key: string) => values.get(key) ?? null),
    setEncoded: vi.fn(async (key: string, value: string) => { values.set(key, value); }),
    setEncodedIfAbsent: vi.fn(async (key: string, value: string) => {
      if (values.has(key)) return false;
      values.set(key, value);
      return true;
    }),
  } satisfies StorageAdapter & {
    getEncoded(key: string): Promise<string | null>;
    setEncoded(key: string, value: string): Promise<void>;
    setEncodedIfAbsent(key: string, value: string): Promise<boolean>;
  };
  return { values, adapter };
}

describe("encoded storage capability", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("writes and reads an existing encoding without recompressing it", async () => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", { localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    } });
    const adapter = new LocalStorageAdapter();
    const encoded = await encodeStoredString("篮球🏀".repeat(1000));
    await adapter.setEncoded("career", encoded);
    expect(await adapter.getEncoded("career")).toBe(encoded);
    expect(await adapter.get("career")).toBe("篮球🏀".repeat(1000));
  });

  it("migrates the original encoding only after the winning new value is readable", async () => {
    const current = encodedMemory();
    const legacy = encodedMemory();
    const encoded = await encodeStoredString("old revision".repeat(200));
    legacy.values.set("career", encoded);
    const adapter = new MigratingIndexedDbStorageAdapter(current.adapter, legacy.adapter);
    expect(await adapter.getEncoded!("career")).toBe(encoded);
    expect(current.values.get("career")).toBe(encoded);
    expect(legacy.adapter.remove).toHaveBeenCalledWith("career");
    expect(legacy.values.has("career")).toBe(false);
  });

  it("does not overwrite a concurrent winner during encoded migration", async () => {
    const current = encodedMemory();
    const legacy = encodedMemory();
    legacy.values.set("career", "raw:old revision");
    current.adapter.setEncodedIfAbsent.mockImplementationOnce(async (key) => {
      current.values.set(key, "raw:new revision");
      return false;
    });
    const adapter = new MigratingIndexedDbStorageAdapter(current.adapter, legacy.adapter);
    expect(await adapter.getEncoded!("career")).toBe("raw:new revision");
    expect(current.values.get("career")).toBe("raw:new revision");
    expect(legacy.values.has("career")).toBe(false);
  });

  it.each(["write", "readback", "corrupt-winner"])("retains legacy bytes if encoded migration fails at %s", async (failure) => {
    const current = encodedMemory();
    const legacy = encodedMemory();
    const encoded = "raw:old revision";
    legacy.values.set("career", encoded);
    if (failure === "write") current.adapter.setEncodedIfAbsent.mockRejectedValueOnce(new DOMException("Full", "QuotaExceededError"));
    if (failure === "readback") current.adapter.getEncoded.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    if (failure === "corrupt-winner") current.adapter.setEncodedIfAbsent.mockImplementationOnce(async (key) => {
      current.values.set(key, "gz:!!!!");
      return false;
    });
    const adapter = new MigratingIndexedDbStorageAdapter(current.adapter, legacy.adapter);
    await expect(adapter.getEncoded!("career")).rejects.toThrow();
    expect(legacy.values.get("career")).toBe(encoded);
    expect(legacy.adapter.remove).not.toHaveBeenCalled();
  });

  it("leaves malformed legacy bytes in their original store", async () => {
    const current = encodedMemory();
    const legacy = encodedMemory();
    legacy.values.set("career", "gz:!!!!");
    const adapter = new MigratingIndexedDbStorageAdapter(current.adapter, legacy.adapter);
    await expect(adapter.getEncoded!("career")).rejects.toThrow("INVALID_COMPRESSED_SAVE");
    expect(current.adapter.setEncodedIfAbsent).not.toHaveBeenCalled();
    expect(legacy.values.get("career")).toBe("gz:!!!!");
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
