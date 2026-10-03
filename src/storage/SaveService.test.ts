import { afterEach, describe, expect, it, vi } from "vitest";
import { createExpansionCareerFromBundledDataset } from "../data/hupuRoster";
import { createCareer, simulateNextGameDay } from "../game/season/career";
import { executeDraftCommand } from "../game/draft/DraftService";
import { calculateAttributeOverall, calculatePlayerOverall } from "../game/player/PlayerRatingService";
import { calculateMarketPreference } from "../game/player/MarketPreferenceService";
import { addTeamNotification, executeTeamNotificationCommand } from "../game/notifications/TeamNotificationService";
import { enqueueCareerMilestoneEvents, enqueueEvent, executeEventCommand } from "../game/events/EventService";
import { LocalStorageAdapter, MemoryStorageAdapter, MigratingIndexedDbStorageAdapter } from "../platform/storage/StorageAdapter";
import type { StorageAdapter } from "../platform/storage/StorageAdapter";
import { SaveService, type SaveEnvelope } from "./SaveService";
import { decodeStoredStringCore, encodeStoredStringCore } from "../platform/storage/StoredStringCodec";
import { stableHash } from "../game/random/hash";
import * as SaveCodec from "./SaveCodec";

describe("SaveService encoded pipeline", () => {
  const key = "basketball-manager:career:1";
  function localStore() {
    const values = new Map<string, string>();
    const setItem = vi.fn((name: string, value: string) => { values.set(name, value); });
    const removeItem = vi.fn((name: string) => { values.delete(name); });
    vi.stubGlobal("window", { localStorage: { getItem: (name: string) => values.get(name) ?? null, setItem, removeItem } });
    return { values, setItem, removeItem, adapter: new LocalStorageAdapter() };
  }
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("prepares the new envelope once and reuses its encoded bytes without decoded APIs", async () => {
    const store = localStore();
    const state = createCareer("encoded-new-envelope");
    const serialize = vi.spyOn(SaveCodec, "serializeEncodedSaveEnvelope");
    const oldSerialize = vi.spyOn(SaveCodec, "serializeSaveEnvelope");
    const get = vi.spyOn(store.adapter, "get");
    const set = vi.spyOn(store.adapter, "set");
    const saved = await new SaveService(store.adapter).save(1, state);
    expect(saved.state).toBe(state);
    expect(serialize).toHaveBeenCalledOnce();
    const prepared = await serialize.mock.results[0].value;
    expect(Object.keys(prepared).sort()).toEqual(["encoded", "stateHash"]);
    expect(oldSerialize).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
    expect(store.setItem.mock.calls).toEqual([[`${key}:pending`, prepared.encoded], [key, prepared.encoded]]);
    expect(JSON.parse(await decodeStoredStringCore(store.values.get(key)!))).toEqual(saved);
    expect((await new SaveService(store.adapter).load(1))?.seeds.careerSeed).toBe(state.seeds.careerSeed);
  });

  it.each(["primary", "pending", "previous"] as const)("retains exact valid %s encoding and revision metadata as backup", async (source) => {
    const store = localStore();
    const state = createCareer(`encoded-recovery-${source}`);
    const old = await new SaveService(new MemoryStorageAdapter()).save(1, state);
    const original = await encodeStoredStringCore(`\n${JSON.stringify({ ...old, revision: 4, parentRevision: 3, syncBaseRevision: 2 }, null, 2)}\n`);
    if (source === "primary") store.values.set(key, original);
    if (source === "pending") store.values.set(`${key}:pending`, original);
    if (source === "previous") {
      store.values.set(key, "gz:!!!!");
      store.values.set(`${key}:previous-valid`, original);
    }
    const inspect = vi.spyOn(SaveCodec, "inspectEncodedSaveEnvelope");
    const saved = await new SaveService(store.adapter).save(1, state);
    expect(saved).toMatchObject({ saveId: old.saveId, revision: 5, parentRevision: 4, syncBaseRevision: 2 });
    expect(store.values.get(`${key}:previous-valid`)).toBe(original);
    expect(store.values.has(`${key}:pending`)).toBe(false);
    const replies = await Promise.allSettled(inspect.mock.results.map(({ value }) => value));
    for (const result of replies) {
      if (result.status !== "fulfilled" || !result.value) continue;
      const reply = result.value;
      expect(reply).not.toHaveProperty("state");
      expect(reply).not.toHaveProperty("serialized");
    }
  });

  it.each(["changed", "unavailable"] as const)("preserves the primary and backup when encoded pending readback is %s", async (failure) => {
    const store = localStore();
    const state = createCareer(`encoded-readback-${failure}`);
    const service = new SaveService(store.adapter);
    await service.save(1, state);
    const original = store.values.get(key)!;
    store.values.set(`${key}:previous-valid`, original);
    store.setItem.mockClear();
    const getEncoded = store.adapter.getEncoded.bind(store.adapter);
    vi.spyOn(store.adapter, "getEncoded").mockImplementation(async (name) => {
      if (name === `${key}:pending` && store.values.has(name)) {
        if (failure === "unavailable") throw new Error("Storage unavailable");
        return "raw:changed";
      }
      return getEncoded(name);
    });
    await expect(service.save(1, state)).rejects.toThrow(failure === "unavailable" ? "Storage unavailable" : "verification failed");
    expect(store.values.get(key)).toBe(original);
    expect(store.values.get(`${key}:previous-valid`)).toBe(original);
    expect(store.setItem.mock.calls.every(([name]) => name === `${key}:pending`)).toBe(true);
  });

  it("cannot rebuild valid encoded copies when inspection runs out of memory", async () => {
    const store = localStore();
    const state = createCareer("encoded-allocation-failure");
    await new SaveService(store.adapter).save(1, state);
    const original = store.values.get(key)!;
    store.values.set(`${key}:pending`, original);
    store.values.set(`${key}:previous-valid`, original);
    store.setItem.mockClear(); store.removeItem.mockClear();
    vi.spyOn(SaveCodec, "inspectEncodedSaveEnvelope").mockRejectedValue(new RangeError("Invalid string length"));
    await expect(new SaveService(store.adapter).save(1, state, { rebuildCorrupted: true })).rejects.toMatchObject({ name: "SaveRecoveryError", canRebuild: false });
    expect(store.setItem).not.toHaveBeenCalled();
    expect(store.removeItem).not.toHaveBeenCalled();
    expect([...store.values.values()]).toEqual([original, original, original]);
  });

  it("evicts a checkpoint for quota recovery while preserving the same prepared save bytes", async () => {
    const store = localStore();
    const state = createCareer("encoded-quota-checkpoint");
    const service = new SaveService(store.adapter);
    await service.save(1, state);
    const checkpoint = `${key}:checkpoint:first`;
    store.values.set(`${key}:checkpoint-index`, 'raw:["first"]');
    store.values.set(checkpoint, "raw:checkpoint");
    const write = store.adapter.setEncoded.bind(store.adapter);
    const attempted: string[] = [];
    vi.spyOn(store.adapter, "setEncoded").mockImplementation(async (name, value) => {
      if (name === `${key}:pending`) {
        attempted.push(value);
        if (store.values.has(checkpoint)) throw new DOMException("Full", "QuotaExceededError");
      }
      await write(name, value);
    });
    expect((await service.save(1, state)).revision).toBe(2);
    expect(store.values.has(checkpoint)).toBe(false);
    expect(attempted).toHaveLength(2);
    expect(attempted[0]).toBe(attempted[1]);
    expect(store.values.get(key)).toBe(attempted[0]);
    expect(await store.adapter.get(`${key}:checkpoint-index`)).toBe("[]");
  });

  it("commits the new encoded primary when a previous backup cannot fit", async () => {
    const store = localStore();
    const state = createCareer("encoded-quota-backup");
    const service = new SaveService(store.adapter);
    await service.save(1, state);
    const original = store.values.get(key)!;
    store.values.set(`${key}:previous-valid`, original);
    const write = store.adapter.setEncoded.bind(store.adapter);
    vi.spyOn(store.adapter, "setEncoded").mockImplementation(async (name, value) => {
      if (name === `${key}:previous-valid`) throw new DOMException("Full", "QuotaExceededError");
      await write(name, value);
    });
    const saved = await service.save(1, state);
    expect(saved.revision).toBe(2);
    expect(JSON.parse(await decodeStoredStringCore(store.values.get(key)!))).toEqual(saved);
    expect(store.values.get(`${key}:previous-valid`)).toBe(original);
    expect(store.values.has(`${key}:pending`)).toBe(false);
  });
});

describe("SaveService", () => {
  it.each(["primary", "pending", "previous"] as const)("preserves revision headers and the exact recovered %s backup on the next save", async (source) => {
    const adapter = new MemoryStorageAdapter();
    const service = new SaveService(adapter);
    const state = createCareer(`save-headers-${source}`);
    const key = "basketball-manager:career:1";
    await service.save(1, state);
    const original = JSON.parse(await adapter.get(key) as string) as SaveEnvelope;
    const recovered = {
      ...original, saveId: `preserved-save-id-${source}`, revision: 4,
      parentRevision: 3, syncBaseRevision: 2, updatedAt: "2026-10-02T08:00:00.000Z",
    };
    const recoveredSerialized = JSON.stringify(recovered);
    if (source === "primary") await adapter.set(key, recoveredSerialized);
    if (source === "pending") await adapter.set(`${key}:pending`, recoveredSerialized);
    if (source === "previous") {
      await adapter.set(key, "broken-primary");
      await adapter.set(`${key}:pending`, "broken-pending");
      await adapter.set(`${key}:previous-valid`, recoveredSerialized);
    }
    const nextState = structuredClone(state);
    nextState.calendar.currentDateIndex = 1;

    expect(await service.save(1, nextState)).toMatchObject({
      saveId: recovered.saveId, slotId: 1, revision: 5, parentRevision: 4,
      syncBaseRevision: 2, pendingSync: true, state: nextState,
    });
    expect(await adapter.get(`${key}:previous-valid`)).toBe(recoveredSerialized);
    expect(await adapter.get(`${key}:pending`)).toBeNull();
    expect((await service.load(1))?.calendar.currentDateIndex).toBe(1);
  });

  it.each(["primary", "pending", "previous"] as const)("normalizes legacy slot and saveId headers in a recovered %s backup before saving", async (source) => {
    const adapter = new MemoryStorageAdapter();
    const service = new SaveService(adapter);
    const state = createCareer(`save-legacy-headers-${source}`);
    const key = "basketball-manager:career:2";
    await service.save(2, state);
    const legacy = JSON.parse(await adapter.get(key) as string) as Partial<SaveEnvelope>;
    legacy.slotId = 3;
    legacy.revision = 4;
    legacy.syncBaseRevision = 2;
    delete legacy.saveId;
    const legacySerialized = JSON.stringify(legacy);
    if (source === "primary") await adapter.set(key, legacySerialized);
    if (source === "pending") await adapter.set(`${key}:pending`, legacySerialized);
    if (source === "previous") {
      await adapter.set(key, "broken-primary");
      await adapter.set(`${key}:previous-valid`, legacySerialized);
    }
    const saveId = stableHash(state.seeds.careerSeed, "save", 2);
    const normalizedSerialized = JSON.stringify({ ...legacy, slotId: 2, saveId });

    expect(await service.save(2, state)).toMatchObject({ saveId, slotId: 2, revision: 5, parentRevision: 4, syncBaseRevision: 2 });
    expect(await adapter.get(`${key}:previous-valid`)).toBe(normalizedSerialized);
    expect(await adapter.get(`${key}:pending`)).toBeNull();
    expect(await service.load(3)).toBeNull();
  });

  it("validates the previous save through metadata without reparsing or serializing its full state", async () => {
    const adapter = new MemoryStorageAdapter();
    const service = new SaveService(adapter);
    const state = createCareer("metadata-only-previous-save");
    const key = "basketball-manager:career:1";
    await service.save(1, state);
    const original = ` \n${await adapter.get(key)}\n `;
    await adapter.set(key, original);
    const inspect = vi.spyOn(SaveCodec, "inspectValidSaveEnvelope");
    const parse = vi.spyOn(SaveCodec, "parseValidSaveEnvelope");
    const parseCopy = vi.spyOn(SaveCodec, "parseValidSaveEnvelopeCopy");
    const stringify = vi.spyOn(SaveCodec, "stringifySaveValue");
    try {
      expect((await service.save(1, state)).revision).toBe(2);
      expect(inspect).toHaveBeenCalledWith(original, 1);
      expect(await inspect.mock.results[0].value).not.toHaveProperty("state");
      expect(parse).not.toHaveBeenCalled();
      expect(parseCopy).not.toHaveBeenCalled();
      expect(stringify).not.toHaveBeenCalled();
      expect(await adapter.get(`${key}:previous-valid`)).toBe(original);
    } finally {
      inspect.mockRestore();
      parse.mockRestore();
      parseCopy.mockRestore();
      stringify.mockRestore();
    }
  });

  it("loads a healthy primary without serializing or rewriting the validated stored bytes", async () => {
    const adapter = new MemoryStorageAdapter();
    const service = new SaveService(adapter);
    const state = createCareer("healthy-save-without-canonical-roundtrip");
    await service.save(1, state);
    const key = "basketball-manager:career:1";
    const stored = ` \n${await adapter.get(key)}\n `;
    await adapter.set(key, stored);
    const stringify = vi.spyOn(SaveCodec, "stringifySaveValue");
    const set = vi.spyOn(adapter, "set");
    try {
      expect((await service.load(1))?.seeds.careerSeed).toBe(state.seeds.careerSeed);
      expect(stringify).not.toHaveBeenCalled();
      expect(set).not.toHaveBeenCalled();
      expect(await adapter.get(key)).toBe(stored);
    } finally {
      stringify.mockRestore();
      set.mockRestore();
    }
  });

  it("preserves valid save copies when metadata validation is temporarily unavailable", async () => {
    const adapter = new MemoryStorageAdapter();
    const service = new SaveService(adapter);
    const state = createCareer("metadata-validation-resource-failure");
    const key = "basketball-manager:career:1";
    await service.save(1, state);
    const stored = await adapter.get(key) as string;
    await adapter.set(`${key}:pending`, stored);
    await adapter.set(`${key}:previous-valid`, stored);
    const inspect = vi.spyOn(SaveCodec, "inspectValidSaveEnvelope").mockRejectedValue(new RangeError("Invalid string length"));
    const set = vi.spyOn(adapter, "set");
    const remove = vi.spyOn(adapter, "remove");
    try {
      await expect(service.save(1, state, { rebuildCorrupted: true })).rejects.toMatchObject({
        name: "SaveRecoveryError", canRebuild: false,
        diagnostics: [
          { key, kind: "UNAVAILABLE" },
          { key: `${key}:pending`, kind: "UNAVAILABLE" },
          { key: `${key}:previous-valid`, kind: "UNAVAILABLE" },
        ],
      });
      expect(set).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
      for (const suffix of ["", ":pending", ":previous-valid"]) expect(await adapter.get(`${key}${suffix}`)).toBe(stored);
    } finally {
      inspect.mockRestore();
      set.mockRestore();
      remove.mockRestore();
    }
  });

  it("queues same-slot saves in invocation order while other slots remain available", async () => {
    const backing = new MemoryStorageAdapter();
    const primaryKey = "basketball-manager:career:1";
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let started!: () => void;
    const writing = new Promise<void>((resolve) => { started = resolve; });
    const adapter: StorageAdapter = {
      get: (key) => backing.get(key),
      remove: (key) => backing.remove(key),
      async set(key, value) {
        const envelope = JSON.parse(value);
        if (key === `${primaryKey}:pending` && envelope.revision === 2 && envelope.state.calendar.currentDateIndex === 0) {
          started();
          await gate;
        }
        await backing.set(key, value);
      },
    };
    const service = new SaveService(adapter);
    const state = createCareer("ordered-slot-writes");
    await service.save(1, state);
    const older = service.save(1, state);
    await writing;
    const newerState = structuredClone(state);
    newerState.calendar.currentDateIndex = 1;
    // A second service sharing storage must observe the same slot queue.
    const newer = new SaveService(adapter).save(1, newerState);
    const concurrentLoad = service.load(1);
    await service.save(2, state);
    release();
    expect((await older).revision).toBe(2);
    expect((await newer).revision).toBe(3);
    expect((await concurrentLoad)?.calendar.currentDateIndex).toBe(1);
    expect((await service.load(1))?.calendar.currentDateIndex).toBe(1);
  });

  it("reserves local and cloud slots through conflict resolution before later saves", async () => {
    const localAdapter = new MemoryStorageAdapter();
    const cloudBacking = new MemoryStorageAdapter();
    let blocked = false;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let started!: () => void;
    const writing = new Promise<void>((resolve) => { started = resolve; });
    const cloudAdapter: StorageAdapter = {
      get: (key) => cloudBacking.get(key),
      remove: (key) => cloudBacking.remove(key),
      async set(key, value) {
        if (blocked && key === "basketball-manager:career:1:pending") {
          blocked = false;
          started();
          await gate;
        }
        await cloudBacking.set(key, value);
      },
    };
    const localService = new SaveService(localAdapter);
    const cloudService = new SaveService(cloudAdapter);
    const base = createCareer("ordered-cloud-resolution");
    await localService.save(1, base);
    await localService.syncWithCloud(1, cloudAdapter);
    const localState = structuredClone(base);
    localState.calendar.currentDateIndex = 1;
    const cloudState = structuredClone(base);
    cloudState.calendar.currentDateIndex = 2;
    await localService.save(1, localState);
    await cloudService.save(1, cloudState);
    blocked = true;
    const resolution = localService.resolveConflict(1, cloudAdapter, "LOCAL");
    await writing;
    const laterLocal = structuredClone(base);
    laterLocal.calendar.currentDateIndex = 3;
    const laterCloud = structuredClone(base);
    laterCloud.calendar.currentDateIndex = 4;
    const localSave = localService.save(1, laterLocal);
    const cloudSave = cloudService.save(1, laterCloud);
    release();
    expect((await resolution).revision).toBe(3);
    expect((await localSave).revision).toBe(4);
    expect((await cloudSave).revision).toBe(4);
    expect((await localService.load(1))?.calendar.currentDateIndex).toBe(3);
    expect((await cloudService.load(1))?.calendar.currentDateIndex).toBe(4);
  });

  it("keeps a rejected write from poisoning the slot queue and retries against the committed revision", async () => {
    const backing = new MemoryStorageAdapter();
    let rejectNext = false;
    const adapter: StorageAdapter = {
      get: (key) => backing.get(key),
      remove: (key) => backing.remove(key),
      async set(key, value) {
        if (rejectNext) { rejectNext = false; throw new Error("STORAGE_UNAVAILABLE"); }
        await backing.set(key, value);
      },
    };
    const service = new SaveService(adapter);
    const state = createCareer("failed-save-retry");
    await service.save(1, state);
    rejectNext = true;
    const rejected = expect(service.save(1, state)).rejects.toThrow("STORAGE_UNAVAILABLE");
    const next = service.save(1, state);
    await rejected;
    expect((await next).revision).toBe(2);
    expect((await service.load(1))?.seeds.careerSeed).toBe(state.seeds.careerSeed);
  });

  it("recovers a newer cloud pending revision before deciding whether to pull or conflict", async () => {
    const localAdapter = new MemoryStorageAdapter();
    const cloudAdapter = new MemoryStorageAdapter();
    const localService = new SaveService(localAdapter);
    const cloudService = new SaveService(cloudAdapter);
    const base = createCareer("cloud-pending-recovery");
    const key = "basketball-manager:career:1";
    await localService.save(1, base);
    await localService.syncWithCloud(1, cloudAdapter);
    const oldCloud = await cloudAdapter.get(key) as string;
    const newer = structuredClone(base);
    newer.calendar.currentDateIndex = 2;
    await cloudService.save(1, newer);
    await cloudAdapter.set(`${key}:pending`, await cloudAdapter.get(key) as string);
    await cloudAdapter.set(key, oldCloud);

    expect((await localService.syncWithCloud(1, cloudAdapter))?.status).toBe("PULLED_CLOUD");
    expect((await localService.load(1))?.calendar.currentDateIndex).toBe(2);
    expect(await cloudAdapter.get(`${key}:pending`)).toBeNull();
  });

  it("preserves diagnostics for every unreadable copy instead of treating the slot as empty", async () => {
    const backing = new MemoryStorageAdapter();
    const key = "basketball-manager:career:1";
    for (const suffix of ["", ":pending", ":previous-valid"]) await backing.set(`${key}${suffix}`, "unreadable");
    const failure = new Error("INVALID_COMPRESSED_SAVE: Invalid character");
    const adapter: StorageAdapter = {
      async get(name) { if (await backing.get(name) !== null) throw failure; return null; },
      set: (name, value) => backing.set(name, value),
      remove: (name) => backing.remove(name),
    };
    const service = new SaveService(adapter);
    await expect(service.load(1)).rejects.toMatchObject({
      name: "SaveRecoveryError",
      diagnostics: [
        { key, error: failure },
        { key: `${key}:pending`, error: failure },
        { key: `${key}:previous-valid`, error: failure },
      ],
    });
    expect(await service.listSlotSummaries()).toEqual([
      expect.objectContaining({ slotId: 1, status: "CORRUPTED", error: expect.stringContaining("Invalid character") }),
    ]);
    expect(await service.loadMostRecent()).toBeNull();
  });

  it("never rebuilds a healthy but temporarily inaccessible slot or a slot with an unreadable backup", async () => {
    const backing = new MemoryStorageAdapter();
    const key = "basketball-manager:career:1";
    const unavailable = new Set<string>();
    const adapter: StorageAdapter = {
      async get(name) { if (unavailable.has(name)) throw new Error("STORAGE_OFFLINE"); return backing.get(name); },
      set: (name, value) => backing.set(name, value),
      remove: (name) => backing.remove(name),
    };
    const service = new SaveService(adapter);
    const original = createCareer("temporarily-unavailable-save");
    await service.save(1, original);
    const committed = await backing.get(key);
    unavailable.add(key);
    expect(await service.listSlotSummaries()).toEqual([
      expect.objectContaining({ slotId: 1, status: "UNAVAILABLE", error: expect.stringContaining("STORAGE_OFFLINE") }),
    ]);
    await expect(service.save(1, createCareer("replacement"), { rebuildCorrupted: true })).rejects.toMatchObject({ canRebuild: false });
    expect(await backing.get(key)).toBe(committed);
    expect(await service.loadMostRecent()).toBeNull();
    unavailable.clear();
    expect((await service.load(1))?.seeds.careerSeed).toBe(original.seeds.careerSeed);

    await backing.set(key, "broken-json");
    unavailable.add(`${key}:previous-valid`);
    expect(await service.listSlotSummaries()).toEqual([expect.objectContaining({ slotId: 1, status: "UNAVAILABLE" })]);
    await expect(service.save(1, original, { rebuildCorrupted: true })).rejects.toMatchObject({ canRebuild: false });
    expect(await backing.get(key)).toBe("broken-json");
  });

  it("reports a rebuilt healthy primary as committed even if corrupt backup cleanup fails", async () => {
    const backing = new MemoryStorageAdapter();
    const key = "basketball-manager:career:1";
    await backing.set(key, "broken-json");
    await backing.set(`${key}:previous-valid`, "broken-json");
    const adapter: StorageAdapter = {
      get: (name) => backing.get(name),
      set: (name, value) => backing.set(name, value),
      async remove(name) {
        if (name === `${key}:previous-valid`) throw new Error("BACKUP_REMOVE_FAILED");
        await backing.remove(name);
      },
    };
    const service = new SaveService(adapter);
    const state = createCareer("committed-corrupt-slot-rebuild");
    expect((await service.save(1, state, { rebuildCorrupted: true })).revision).toBe(1);
    expect((await service.load(1))?.seeds.careerSeed).toBe(state.seeds.careerSeed);
    expect(await service.listSlotSummaries()).toEqual([expect.objectContaining({ slotId: 1, revision: 1 })]);
  });

  it.each([
    new Error("Out of memory"),
    new TypeError("Out of memory"),
    new DOMException("The I/O read operation failed.", "NotReadableError"),
    new RangeError("Invalid string length"),
  ])("preserves every valid compressed copy and blocks rebuilding after %s", async (failure) => {
    const backing = new MemoryStorageAdapter();
    const original = createCareer("resource-failure-is-not-corruption");
    await new SaveService(backing).save(1, original);
    const key = "basketball-manager:career:1";
    const encoded = await encodeStoredStringCore(await backing.get(key) as string);
    const values = new Map([key, `${key}:pending`, `${key}:previous-valid`].map((name) => [name, encoded]));
    const before = [...values.entries()];
    const setItem = vi.fn((name: string, value: string) => { values.set(name, value); });
    const removeItem = vi.fn((name: string) => { values.delete(name); });
    vi.stubGlobal("window", { localStorage: {
      getItem: (name: string) => values.get(name) ?? null, setItem, removeItem,
    } });
    const read = vi.spyOn(Response.prototype, "text").mockImplementation(async function (this: Response) {
      await this.body?.cancel();
      throw failure;
    });
    try {
      const service = new SaveService(new LocalStorageAdapter());
      await expect(service.load(1)).rejects.toMatchObject({
        name: "SaveRecoveryError", canRebuild: false,
        diagnostics: [
          { key, kind: "UNAVAILABLE" },
          { key: `${key}:pending`, kind: "UNAVAILABLE" },
          { key: `${key}:previous-valid`, kind: "UNAVAILABLE" },
        ],
      });
      expect(await service.listSlotSummaries()).toEqual([expect.objectContaining({ status: "UNAVAILABLE" })]);
      await expect(service.save(1, original, { rebuildCorrupted: true })).rejects.toMatchObject({ canRebuild: false });
      expect(setItem).not.toHaveBeenCalled();
      expect(removeItem).not.toHaveBeenCalled();
      expect([...values.entries()]).toEqual(before);
      read.mockRestore();
      expect((await service.load(1))?.seeds.careerSeed).toBe(original.seeds.careerSeed);
    } finally {
      read.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it.each([
    "INVALID_COMPRESSED_SAVE: Out of memory",
    "INVALID_COMPRESSED_SAVE: NotReadableError: The I/O read operation failed.",
  ])("does not offer rebuilding when a runtime failure arrives wrapped as %s", async (message) => {
    const failure = new Error(message);
    const key = "basketball-manager:career:1";
    const adapter: StorageAdapter = {
      async get(name) { if ([key, `${key}:pending`, `${key}:previous-valid`].includes(name)) throw failure; return null; },
      set: vi.fn(), remove: vi.fn(),
    };
    const service = new SaveService(adapter);
    expect(await service.listSlotSummaries()).toEqual([expect.objectContaining({ status: "UNAVAILABLE" })]);
    await expect(service.save(1, createCareer("blocked-resource-rebuild"), { rebuildCorrupted: true })).rejects.toMatchObject({ canRebuild: false });
    expect(adapter.set).not.toHaveBeenCalled();
    expect(adapter.remove).not.toHaveBeenCalled();
  });

  it("classifies actual gzip corruption as rebuildable while unsupported gzip remains unavailable", async () => {
    const values = new Map<string, string>();
    const key = "basketball-manager:career:1";
    values.set(key, "gz:!!!!");
    vi.stubGlobal("window", { localStorage: {
      getItem: (name: string) => values.get(name) ?? null,
      setItem: (name: string, value: string) => { values.set(name, value); },
      removeItem: (name: string) => { values.delete(name); },
    } });
    try {
      const service = new SaveService(new LocalStorageAdapter());
      expect(await service.listSlotSummaries()).toEqual([expect.objectContaining({ status: "CORRUPTED" })]);
      await expect(service.load(1)).rejects.toMatchObject({ canRebuild: true });
      const state = createCareer("rebuild-invalid-gzip");
      await service.save(1, state, { rebuildCorrupted: true });
      expect((await service.load(1))?.seeds.careerSeed).toBe(state.seeds.careerSeed);
      vi.stubGlobal("DecompressionStream", undefined);
      expect(await service.listSlotSummaries()).toEqual([expect.objectContaining({ status: "UNAVAILABLE" })]);
      await expect(service.save(1, state, { rebuildCorrupted: true })).rejects.toMatchObject({ canRebuild: false });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("isolates unrecoverable slots and requires explicit consent before rebuilding them", async () => {
    const adapter = new MemoryStorageAdapter();
    const service = new SaveService(adapter);
    const healthy = createCareer("healthy-next-to-broken-slot");
    await service.save(1, healthy);
    for (const suffix of ["", ":pending", ":previous-valid"]) await adapter.set(`basketball-manager:career:2${suffix}`, "broken-json");
    const summaries = await service.listSlotSummaries();
    expect(summaries).toEqual([
      expect.objectContaining({ slotId: 1, revision: 1 }),
      expect.objectContaining({ slotId: 2, status: "CORRUPTED", error: expect.stringContaining("No recoverable save revision") }),
    ]);
    expect((await service.loadMostRecent())?.slotId).toBe(1);
    await expect(service.load(2)).rejects.toThrow("No recoverable save revision");
    await expect(service.save(2, healthy)).rejects.toThrow("No recoverable save revision");
    await service.save(3, createCareer("new-career-in-empty-slot"));
    expect((await service.load(3))?.seeds.careerSeed).toBe("new-career-in-empty-slot");
    await service.save(2, healthy, { rebuildCorrupted: true });
    expect((await service.load(2))?.seeds.careerSeed).toBe(healthy.seeds.careerSeed);
    expect(await adapter.get("basketball-manager:career:2:previous-valid")).toBeNull();
  });

  it.each(["base64", "truncated-gzip", "checksum", "pending"])("recovers real compressed copies independently when %s is corrupt", async (kind) => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", { localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    } });
    try {
      const service = new SaveService(new LocalStorageAdapter());
      const state = createCareer(`recover-compressed-${kind}`);
      const key = "basketball-manager:career:1";
      await service.save(1, state);
      const valid = values.get(key)!;
      expect(valid.startsWith("gz:")).toBe(true);
      values.set(`${key}:previous-valid`, valid);
      if (kind === "pending") values.set(`${key}:pending`, "gz:!!!!");
      else if (kind === "base64") values.set(key, "gz:!!!!");
      else if (kind === "truncated-gzip") values.set(key, "gz:H4sIAAAAAAAA");
      else {
        const adapter = new LocalStorageAdapter();
        const corrupt = JSON.parse(await adapter.get(key) as string);
        corrupt.stateHash = "invalid-checksum";
        await adapter.set(key, JSON.stringify(corrupt));
      }
      expect((await service.load(1))?.seeds.careerSeed).toBe(state.seeds.careerSeed);
      expect(values.has(`${key}:pending`)).toBe(false);
      await service.save(1, state);
      expect((await service.load(1))?.seeds.careerSeed).toBe(state.seeds.careerSeed);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("does not read the previous full revision when the primary is valid", async () => {
    const backing = new MemoryStorageAdapter();
    const reads: string[] = [];
    const adapter: StorageAdapter = {
      async get(key) { reads.push(key); return backing.get(key); },
      set: (key, value) => backing.set(key, value),
      remove: (key) => backing.remove(key),
    };
    const service = new SaveService(adapter);
    const state = createCareer("avoid-unneeded-backup-read");
    await service.save(1, state);
    await service.save(1, simulateNextGameDay(state));
    reads.length = 0;
    expect(await service.load(1)).not.toBeNull();
    expect(reads).not.toContain("basketball-manager:career:1:previous-valid");
  });

  it("migrates and recovers a legacy pending revision without losing the previous valid copy", async () => {
    const legacy = new MemoryStorageAdapter();
    const oldService = new SaveService(legacy);
    const original = createCareer("indexed-db-legacy-recovery");
    await oldService.save(1, original);
    const primaryKey = "basketball-manager:career:1";
    const originalSerialized = await legacy.get(primaryKey) as string;
    const newer = simulateNextGameDay(original);
    const nextEnvelope = await oldService.save(1, newer);
    const newerSerialized = await legacy.get(primaryKey) as string;
    const corrupt = JSON.parse(originalSerialized) as { state: { userTeamId: string } };
    corrupt.state.userTeamId = "CORRUPTED";
    await legacy.set(primaryKey, JSON.stringify(corrupt));
    await legacy.set(`${primaryKey}:pending`, newerSerialized);
    await legacy.set(`${primaryKey}:previous-valid`, originalSerialized);

    const indexedDb = new MemoryStorageAdapter();
    const migrated = new SaveService(new MigratingIndexedDbStorageAdapter(indexedDb, legacy));
    expect((await migrated.load(1))?.lightweightResults.length).toBe(newer.lightweightResults.length);
    expect(JSON.parse(await indexedDb.get(primaryKey) as string)).toMatchObject({ revision: nextEnvelope.revision });
    expect(await indexedDb.get(`${primaryKey}:pending`)).toBeNull();
    expect(await indexedDb.get(`${primaryKey}:previous-valid`)).toBeNull();
    expect(await legacy.get(primaryKey)).toBeNull();
    expect(await legacy.get(`${primaryKey}:pending`)).toBeNull();
    expect(await legacy.get(`${primaryKey}:previous-valid`)).toBe(originalSerialized);

    const damagedCurrent = JSON.parse(await indexedDb.get(primaryKey) as string) as { state: { userTeamId: string } };
    damagedCurrent.state.userTeamId = "CORRUPTED_AGAIN";
    await indexedDb.set(primaryKey, JSON.stringify(damagedCurrent));
    expect((await migrated.load(1))?.seeds.careerSeed).toBe(original.seeds.careerSeed);
    expect(await indexedDb.get(`${primaryKey}:previous-valid`)).toBe(originalSerialized);
    expect(await legacy.get(`${primaryKey}:previous-valid`)).toBeNull();
  });

  it("adds the opening MIP comparison group to unfinished older real-roster saves", async () => {
    const service = new SaveService(new MemoryStorageAdapter());
    const state = createExpansionCareerFromBundledDataset("legacy-mip-baseline");
    for (const player of Object.values(state.players)) {
      if (player.career?.lastSeasonStatsSource !== "SYNTHETIC_OPENING") continue;
      delete player.career.lastSeasonStats;
      delete player.career.lastSeasonStatsSource;
    }
    await service.save(1, state);
    const loaded = await service.load(1);
    expect(Object.values(loaded!.players).filter((player) => player.career?.lastSeasonStatsSource === "SYNTHETIC_OPENING")).toHaveLength(30);
    expect(Object.values(state.players).filter((player) => player.career?.lastSeasonStatsSource === "SYNTHETIC_OPENING")).toHaveLength(0);
  });

  it("restores historical rookie names in existing saves without changing the source object", async () => {
    const service = new SaveService(new MemoryStorageAdapter());
    const state = createCareer("historical-name-migration");
    const player = Object.values(state.players)[0];
    player.profileSource = "HISTORICAL_ARCHETYPE";
    player.historicalSourcePlayerId = "nba:977";
    player.name = "Old Fictional Name";
    player.truePotential = 90;
    player.scoutedPotentialGrade = "A+";
    await service.save(1, state);

    const loaded = await service.load(1);
    expect(loaded?.players[player.id].name).toBe("Kobe Bryant");
    expect(loaded?.players[player.id].truePotential).toBeGreaterThanOrEqual(94);
    expect(loaded?.players[player.id].scoutedPotentialGrade).toBe("S");
    expect(state.players[player.id].name).toBe("Old Fictional Name");
    expect(state.players[player.id].scoutedPotentialGrade).toBe("A+");
    expect((await service.load(1))?.players[player.id].name).toBe("Kobe Bryant");
  });

  it("upgrades unpicked historical rookies without weakening other prospects in an existing draft save", async () => {
    const service = new SaveService(new MemoryStorageAdapter());
    const state = createCareer("older-future-draft-balance");
    state.league.currentPhase = "OFFSEASON_PRE_DRAFT";
    state.league.seasonYear = 2027;
    state.league.seasonId = "2027-28";
    const prepared = executeDraftCommand(state, { commandId: "prepare-older-future-draft", type: "PREPARE_ROOKIE_DRAFT", payload: {} });
    const players = prepared.rookieDraft!.classPlayerIds.map((id) => prepared.players[id]);
    const legend = players.find((player) => player.profileSource === "HISTORICAL_ARCHETYPE")!;
    const procedural = players.find((player) => player.profileSource === "PROCEDURAL_DRAFT")!;
    legend.attributes = Object.fromEntries(Object.keys(legend.attributes).map((key) => [key, 70])) as unknown as typeof legend.attributes;
    legend.truePotential = 90;
    legend.scoutedPotentialGrade = "A+";
    procedural.attributes = Object.fromEntries(Object.keys(procedural.attributes).map((key) => [key, 86])) as unknown as typeof procedural.attributes;
    procedural.truePotential = 99;
    procedural.scoutedPotentialGrade = "S";
    await service.save(1, prepared);

    const loaded = await service.load(1);
    expect(calculatePlayerOverall(loaded!.players[legend.id])).toBeGreaterThanOrEqual(80);
    expect(loaded!.players[legend.id]).toMatchObject({ scoutedPotentialGrade: "S" });
    expect(loaded!.players[legend.id].truePotential).toBeGreaterThanOrEqual(94);
    expect(calculatePlayerOverall(loaded!.players[procedural.id])).toBe(calculatePlayerOverall(procedural));
    expect(loaded!.players[procedural.id]).toMatchObject({ truePotential: 99, scoutedPotentialGrade: "S" });
    expect(prepared.players[procedural.id].truePotential).toBe(99);
  });

  it("removes a false fifty-win milestone from an old save and restores it at the real threshold", async () => {
    const service = new SaveService(new MemoryStorageAdapter());
    const state = createCareer("false-fifty-win-save");
    state.league.seasonYear = 2027;
    state.league.seasonId = "2027-28";
    state.history.seasons.push({
      seasonId: "2026-27", championTeamId: "BOS",
      standings: { [state.userTeamId]: { wins: 30, losses: 52 } },
      regularSeasonResults: [], userRegularGameDetails: {}, postseasonGameDetails: {},
      userPostseason: { enteredPlayIn: false, enteredPlayoffs: false, seriesWins: 0,
        conferenceFinals: false, finalsAppearance: false, champion: false, playoffWins: 0, playoffLosses: 0 },
    });
    state.gmCareer.seasons = 1;
    state.gmCareer.dynastyScore = 100;
    state.achievements.TWENTY_FIVE_WINS = { unlocked: true, unlockedAt: "2026-27:D80", seasonId: "2026-27" };
    state.achievements.THIRTY_WIN_SEASON = { unlocked: true, unlockedAt: "2026-27:D120", seasonId: "2026-27" };
    state.achievements.FIFTY_CAREER_WINS = { unlocked: true, unlockedAt: "2027-28:D0", seasonId: "2027-28" };
    await service.save(1, state);

    const repaired = await service.load(1);
    expect(repaired?.achievements.FIFTY_CAREER_WINS).toEqual({ unlocked: false, unlockedAt: null, seasonId: null });
    expect(repaired?.gmCareer.dynastyScore).toBe(70);
    expect((await service.load(1))?.gmCareer.dynastyScore).toBe(70);

    repaired!.standings[repaired!.userTeamId].wins = 20;
    await service.save(1, repaired!);
    const reached = await service.load(1);
    expect(reached?.achievements.FIFTY_CAREER_WINS.unlocked).toBe(true);
    expect(reached?.gmCareer.dynastyScore).toBe(100);
  });

  it("loads a save when injuries leave only five players available for a 240-minute rotation", async () => {
    const service = new SaveService(new MemoryStorageAdapter());
    const state = createCareer("five-available-player-save");
    const team = state.teams[state.userTeamId];
    for (const playerId of team.playerIds.slice(5)) state.players[playerId].available = false;

    await service.save(1, state);
    const loaded = await service.load(1);
    expect(loaded).not.toBeNull();
    expect(Object.values(loaded!.teams[loaded!.userTeamId].rotationPlan!.targetMinutes).reduce((sum, value) => sum + value, 0)).toBe(200);
    expect(Math.max(...Object.values(loaded!.teams[loaded!.userTeamId].rotationPlan!.targetMinutes))).toBe(40);

    loaded!.players[team.playerIds[5]].available = true;
    await service.save(1, loaded!);
    const recovered = await service.load(1);
    expect(Object.values(recovered!.teams[recovered!.userTeamId].rotationPlan!.targetMinutes).reduce((sum, value) => sum + value, 0)).toBe(240);
  });

  it("removes the superseded expansion inbox notice from older saves without undoing its support gain", async () => {
    const service = new SaveService(new MemoryStorageAdapter());
    const state = createCareer("legacy-expansion-inbox-save");
    state.expansion = { finalized: true } as NonNullable<typeof state.expansion>;
    state.teams[state.userTeamId].fanSupport += 1;
    state.teamNotifications = [{
      id: "event-legacy-expansion", category: "SEASON", seasonId: state.league.seasonId,
      title: "新球队诞生", message: "扩军选秀完成，一支新球队正式加入联盟。 球迷支持 +1",
      date: state.calendar.openingDate, read: false,
    }];
    await service.save(1, state);
    const loaded = await service.load(1);
    expect(loaded?.teamNotifications?.map((entry) => entry.id)).toEqual([`expansion-welcome-${state.league.seasonId}`]);
    expect(loaded?.teams[state.userTeamId].fanSupport).toBe(state.teams[state.userTeamId].fanSupport);
  });

  it("backfills new win achievements in an older slot without adding points twice", async () => {
    const service = new SaveService(new MemoryStorageAdapter());
    const state = createCareer("save-achievement-backfill");
    state.standings[state.userTeamId].wins = 42;
    delete (state.achievements as Partial<typeof state.achievements>).TWENTY_FIVE_WINS;
    delete (state.achievements as Partial<typeof state.achievements>).THIRTY_WIN_SEASON;
    delete (state.achievements as Partial<typeof state.achievements>).FORTY_WIN_SEASON;
    await service.save(1, state);
    const loaded = await service.load(1);
    expect(loaded?.achievements.TWENTY_FIVE_WINS.unlocked).toBe(true);
    expect(loaded?.achievements.THIRTY_WIN_SEASON.unlocked).toBe(true);
    expect(loaded?.achievements.FORTY_WIN_SEASON.unlocked).toBe(true);
    await service.save(1, loaded!);
    expect((await service.load(1))?.gmCareer.dynastyScore).toBe(loaded?.gmCareer.dynastyScore);
  });

  it("round-trips an atomic career slot without changing state", async () => {
    const service = new SaveService(new MemoryStorageAdapter());
    const state = simulateNextGameDay(createCareer("save-test"));
    const envelope = await service.save(1, state);
    expect(envelope.revision).toBe(1);
    expect(await service.load(1)).toEqual(state);
    const next = await service.save(1, state);
    expect(next.revision).toBe(2);
    expect(next.parentRevision).toBe(1);
  });

  it("restores the completed lottery reveal before draft acknowledgement", async () => {
    const service = new SaveService(new MemoryStorageAdapter());
    const state = createCareer("lottery-reveal-save");
    state.league.seasonYear = 2027;
    state.league.seasonId = "2027-28";
    state.league.currentPhase = "OFFSEASON_PRE_DRAFT";
    const prepared = executeDraftCommand(state, { commandId: "lottery-save-prepare", type: "PREPARE_ROOKIE_DRAFT", payload: {} });
    const revealed = executeDraftCommand(prepared, { commandId: "lottery-save-reveal", type: "COMPLETE_DRAFT_LOTTERY_REVEAL", payload: {} });
    await service.save(1, revealed);

    const loaded = await service.load(1);
    expect(loaded?.rookieDraft?.lotteryRevealComplete).toBe(true);
    expect(loaded?.rookieDraft?.lotteryPresented).toBe(false);
    expect(loaded?.rookieDraft?.pickOrder).toEqual(revealed.rookieDraft?.pickOrder);
  });

  it("repairs only missing lottery confirmation in a legacy first-season draft", async () => {
    const service = new SaveService(new MemoryStorageAdapter());
    const legacy = createCareer("legacy-curated-lottery-field");
    legacy.league.currentPhase = "DRAFT";
    legacy.rookieDraft = {
      draftSeed: "legacy-draft", classPlayerIds: [], pickOrder: [],
      currentPickIndex: 0, completed: false, source: "CURATED_2026",
    };
    await service.save(1, legacy);
    await service.saveCheckpoint(1, "legacy-lottery", legacy);
    const restored = await service.load(1);
    expect(restored?.rookieDraft?.lotteryPresented).toBe(true);
    expect((await service.loadCheckpoint(1, "legacy-lottery"))?.rookieDraft?.lotteryPresented).toBe(true);
    expect(legacy.rookieDraft.lotteryPresented).toBeUndefined();
    await service.save(1, restored!);
    expect((await service.load(1))?.rookieDraft?.lotteryPresented).toBe(true);

    const procedural2026 = structuredClone(legacy);
    procedural2026.rookieDraft!.source = "PROCEDURAL_2026";
    await service.saveCheckpoint(1, "legacy-procedural-lottery", procedural2026);
    expect((await service.loadCheckpoint(1, "legacy-procedural-lottery"))?.rookieDraft?.lotteryPresented).toBe(true);

    const future = structuredClone(legacy);
    future.league.seasonYear = 2027;
    future.league.seasonId = "2027-28";
    future.rookieDraft!.source = "PROCEDURAL_FUTURE";
    await service.save(2, future);
    expect((await service.load(2))?.rookieDraft?.lotteryPresented).toBeUndefined();

    const explicitlyPending = structuredClone(legacy);
    explicitlyPending.rookieDraft!.lotteryPresented = false;
    await service.save(3, explicitlyPending);
    expect((await service.load(3))?.rookieDraft?.lotteryPresented).toBe(false);
  });

  it("restores read and unread team notifications and initializes older saves", async () => {
    const service = new SaveService(new MemoryStorageAdapter());
    const state = createCareer("team-notification-save");
    addTeamNotification(state, { id: "fa-result", category: "FREE_AGENCY", seasonId: state.league.seasonId, title: "签约成功", message: "合同已生效。" });
    await service.save(1, state);
    expect((await service.load(1))?.teamNotifications).toEqual([expect.objectContaining({ id: "fa-result", read: false })]);
    const read = executeTeamNotificationCommand(state, { commandId: "read-fa-result", type: "MARK_TEAM_NOTIFICATIONS_READ", payload: { ids: ["fa-result"] } });
    await service.save(1, read);
    expect((await service.load(1))?.teamNotifications?.[0].read).toBe(true);
    delete read.teamNotifications;
    await service.save(2, read);
    expect((await service.load(2))?.teamNotifications).toEqual([]);
  });

  it.each([true, false])("repairs repeated legacy playoff milestone notices and preserves read=%s on reload", async (read) => {
    const service = new SaveService(new MemoryStorageAdapter());
    const state = createCareer("legacy-repeated-playoff-notices");
    state.achievements.FIRST_PLAYOFFS = { unlocked: true, unlockedAt: `${state.league.seasonId}:D0`, seasonId: state.league.seasonId };
    enqueueCareerMilestoneEvents(state);
    const original = state.teamNotifications![0];
    original.read = read;
    original.date = "2026-10-20";
    state.teamNotifications!.unshift({ ...original, id: "event-legacy-repeat", read: false, date: "2026-11-20" });
    addTeamNotification(state, { id: "unrelated-season-notice", category: "SEASON", seasonId: state.league.seasonId,
      title: "其他赛季消息", message: "保留这条通知。" });
    delete state.eventState.lastOccurrenceByDefinition.playoffs_appearance_001;
    const support = state.teams[state.userTeamId].fanSupport;
    const score = state.gmCareer.dynastyScore;
    await service.save(1, state);
    const loaded = (await service.load(1))!;
    expect(loaded.teamNotifications?.filter((notice) => notice.title === "季后赛初体验")).toEqual([original]);
    expect(loaded.teamNotifications).toContainEqual(expect.objectContaining({ id: "unrelated-season-notice", read: false }));
    expect(loaded.eventState.lastOccurrenceByDefinition.playoffs_appearance_001).toBeDefined();
    enqueueCareerMilestoneEvents(loaded);
    expect(loaded.teamNotifications).toHaveLength(2);
    expect(loaded.teams[state.userTeamId].fanSupport).toBe(support);
    expect(loaded.gmCareer.dynastyScore).toBe(score);
    await service.save(1, loaded);
    expect((await service.load(1))?.teamNotifications).toEqual(loaded.teamNotifications);
  });

  it("upgrades player state before automatically settling a saved depth-injury decision", async () => {
    const service = new SaveService(new MemoryStorageAdapter());
    const state = createCareer("legacy-depth-auto-save");
    const player = state.players[state.teams[state.userTeamId].rotationPlan!.starters.PG];
    const event = enqueueEvent(state, "injury_depth_test_001", {
      player_id: player.id, player_name: player.name, injury_duration: "预计伤停约 3 天", games_out: "2",
    })!;
    state.eventState.queue = [{ ...event, status: "PENDING", selectedChoiceId: undefined, effectivePause: true,
      choices: [{ id: "auto_adjust", label: "一键自动调整轮换", effects: [] }, { id: "manual_adjust", label: "手动调整轮换", effects: [] }],
    }];
    state.eventState.resolvedInstanceIds = [];
    state.teamNotifications = [];
    player.injury = { injuryId: "legacy-depth-injury", severity: "SHORT", daysRemaining: 3, gamesRemaining: 2,
      occurredSeasonId: state.league.seasonId, occurredGameId: "legacy-game", previousRotationRole: "STARTER" };
    player.available = true;
    Reflect.deleteProperty(player, "contract");
    Reflect.deleteProperty(state, "injuryState");
    await service.save(1, state);
    const loaded = await service.load(1);
    expect(loaded?.eventState.queue).toEqual([]);
    expect(loaded?.players[player.id].available).toBe(false);
    expect(loaded?.teams[state.userTeamId].rotationPlan?.targetMinutes[player.id]).toBe(0);
    expect(loaded?.teams[state.userTeamId].rotationPlan?.selectionMode).toBe("AUTO");
    expect(loaded?.teamNotifications).toEqual([expect.objectContaining({ title: "轮换球员受伤", read: false })]);
    await service.save(1, loaded!);
    expect((await service.load(1))?.teamNotifications).toHaveLength(1);
  });

  it("clears a saved acknowledgement-only injury card while preserving consequential choices", async () => {
    const service = new SaveService(new MemoryStorageAdapter());
    const state = createCareer("legacy-informational-event");
    const notice = enqueueEvent(state, "injury_depth_test_001", { player_name: "测试球员" });
    const choice = enqueueEvent(state, "morale_minutes_001", { player_id: state.teams[state.userTeamId].playerIds[0] });
    if (!notice || !choice) throw new Error("Expected both event fixtures");
    notice.choices = [{ id: "acknowledge", label: "确认", effects: [] }];
    notice.status = "PENDING";
    notice.effectivePause = true;
    state.eventState.queue.push(notice);
    delete notice.selectedChoiceId;
    state.eventState.resolvedInstanceIds = state.eventState.resolvedInstanceIds.filter((id) => id !== notice.eventInstanceId);
    state.teamNotifications = [];
    await service.save(1, state);

    const loaded = await service.load(1);
    expect(loaded?.eventState.queue.map((event) => event.eventInstanceId)).toEqual([choice.eventInstanceId]);
    expect(loaded?.eventState.resolvedInstanceIds).toContain(notice.eventInstanceId);
    expect(loaded?.teamNotifications).toContainEqual(expect.objectContaining({
      id: `event-${notice.eventInstanceId}`, message: expect.stringContaining("测试球员"), read: false,
    }));
  });

  it("keeps an automatically resolved injury rotation and its notice after a save reload", async () => {
    const service = new SaveService(new MemoryStorageAdapter());
    const state = createCareer("injury-decision-save");
    const player = state.players[state.teams[state.userTeamId].playerIds[0]];
    const event = enqueueEvent(state, "injury_core_major_001", {
      player_id: player.id, player_name: player.name, games_out: "8",
    })!;
    await service.save(1, state);
    const loaded = await service.load(1);
    expect(loaded?.eventState.queue).toEqual([]);
    expect(loaded?.eventState.resolvedInstanceIds.filter((id) => id === event.eventInstanceId)).toHaveLength(1);
    expect(loaded?.teamNotifications?.filter((notice) => notice.id === `event-${event.eventInstanceId}`)).toHaveLength(1);
    expect(loaded?.teams[loaded.userTeamId].rotationPlan?.selectionMode).toBe("AUTO");
  });

  it("turns an older major-injury pause into an unread notice on load", async () => {
    const service = new SaveService(new MemoryStorageAdapter());
    const state = createCareer("old-major-injury-pause");
    const playerId = state.teams[state.userTeamId].playerIds[0];
    state.injuryState.pendingUserMajorInjury = {
      injuryId: "old-major-injury", playerId, teamId: state.userTeamId,
      severity: "LONG", gamesOut: 20, gameId: "old-game", seasonId: state.league.seasonId,
    };
    await service.save(1, state);
    const loaded = await service.load(1);
    expect(loaded?.injuryState.pendingUserMajorInjury).toBeUndefined();
    expect(loaded?.teamNotifications).toContainEqual(expect.objectContaining({
      id: "injury-old-major-injury", message: expect.stringContaining("轮换已自动调整"), read: false,
    }));
  });

  it.each([
    ["nba:201566", "Russell Westbrook"],
    ["nba:201587", "Nicolas Batum"],
  ])("removes unsigned retiree %s from an older bundled save", async (playerId, playerName) => {
    const service = new SaveService(new MemoryStorageAdapter());
    const state = createCareer("retired-free-agent-save");
    state.meta.dataVersion = "bundled.2026-before-retirement-correction";
    state.players[playerId] = {
      ...structuredClone(Object.values(state.players)[0]),
      id: playerId,
      name: playerName,
      teamId: "FREE_AGENT",
      contract: {
        salary: 0,
        yearsRemaining: 0,
        guaranteedAmount: 0,
        status: "UFA",
        optionType: "NONE",
        optionDecision: "NOT_APPLICABLE",
      },
    };
    await service.save(1, state);
    const loaded = await service.load(1);
    expect(loaded?.players[playerId]).toBeUndefined();
    expect(loaded?.history.retiredPlayerIds).toContain(playerId);
  });

  it("repairs Horford's old SF/PF save after a trade without changing his OVR or team", async () => {
    const service = new SaveService(new MemoryStorageAdapter());
    const state = createExpansionCareerFromBundledDataset("horford-position-save");
    const horford = state.players["nba:201143"];
    horford.position = "SF";
    horford.secondaryPosition = "PF";
    horford.overallAdjustment = 79 - calculateAttributeOverall(horford.attributes, "SF");
    state.teams.GSW.playerIds = state.teams.GSW.playerIds.filter((id) => id !== horford.id);
    state.teams[state.userTeamId].playerIds.push(horford.id);
    horford.teamId = state.userTeamId;
    const previousOverall = calculatePlayerOverall(horford);
    await service.save(1, state);

    const loaded = await service.load(1);
    expect(loaded?.players[horford.id]).toMatchObject({ teamId: state.userTeamId, position: "C", secondaryPosition: "PF" });
    expect(calculatePlayerOverall(loaded!.players[horford.id])).toBeCloseTo(previousOverall);
    expect(loaded?.teams[state.userTeamId].playerIds).toContain(horford.id);
    expect(loaded?.teams.GSW.playerIds).not.toContain(horford.id);
  });

  it("saves and restores a verified expansion checkpoint", async () => {
    const service = new SaveService(new MemoryStorageAdapter());
    const state = createCareer("checkpoint-test");
    await service.saveCheckpoint(1, "pre-expansion-draft", state);
    expect(await service.loadCheckpoint(1, "pre-expansion-draft")).toEqual(state);
  });

  it("keeps three career slots independent", async () => {
    const service = new SaveService(new MemoryStorageAdapter());
    await service.save(1, createCareer("slot-one"));
    await service.save(2, createCareer("slot-two"));
    await service.save(3, createCareer("slot-three"));
    expect((await service.load(1))?.seeds.careerSeed).toBe("slot-one");
    expect((await service.load(2))?.seeds.careerSeed).toBe("slot-two");
    expect((await service.load(3))?.seeds.careerSeed).toBe("slot-three");
  });

  it("uses the physical storage slot when stored metadata names another slot", async () => {
    const adapter = new MemoryStorageAdapter();
    const service = new SaveService(adapter);
    await service.save(2, createCareer("slot-two-metadata-repair"));
    const key = "basketball-manager:career:2";
    const misplaced = JSON.parse(await adapter.get(key) as string) as { slotId: number };
    misplaced.slotId = 3;
    await adapter.set(key, JSON.stringify(misplaced));

    expect(await service.listSlotSummaries()).toEqual([
      expect.objectContaining({ slotId: 2 }),
    ]);
    expect(JSON.parse(await adapter.get(key) as string)).toEqual(expect.objectContaining({ slotId: 2 }));
    expect((await service.load(2))?.seeds.careerSeed).toBe("slot-two-metadata-repair");
    expect(await service.load(3)).toBeNull();
  });

  it("repairs slot metadata while recovering a newer pending write", async () => {
    const adapter = new MemoryStorageAdapter();
    const service = new SaveService(adapter);
    await service.save(2, createCareer("pending-slot-repair"));
    const key = "basketball-manager:career:2";
    const pendingKey = `${key}:pending`;
    const pending = JSON.parse(await adapter.get(key) as string) as { slotId: number; revision: number };
    pending.slotId = 3;
    pending.revision += 1;
    await adapter.set(pendingKey, JSON.stringify(pending));

    expect((await service.load(2))?.seeds.careerSeed).toBe("pending-slot-repair");
    expect(JSON.parse(await adapter.get(key) as string)).toEqual(expect.objectContaining({ slotId: 2, revision: 2 }));
    expect(await adapter.get(pendingKey)).toBeNull();
  });

  it("repairs slot metadata while restoring the previous valid revision", async () => {
    const adapter = new MemoryStorageAdapter();
    const service = new SaveService(adapter);
    await service.save(2, createCareer("previous-slot-repair"));
    const key = "basketball-manager:career:2";
    const previousKey = `${key}:previous-valid`;
    const valid = JSON.parse(await adapter.get(key) as string) as { slotId: number; state: { userTeamId: string } };
    valid.slotId = 3;
    await adapter.set(previousKey, JSON.stringify(valid));
    const corrupt = structuredClone(valid);
    corrupt.state.userTeamId = "CORRUPTED";
    await adapter.set(key, JSON.stringify(corrupt));

    expect((await service.load(2))?.seeds.careerSeed).toBe("previous-slot-repair");
    expect(JSON.parse(await adapter.get(key) as string)).toEqual(expect.objectContaining({ slotId: 2 }));
  });

  it("normalizes cloud slot metadata before pulling it into a local slot", async () => {
    const cloudAdapter = new MemoryStorageAdapter();
    const cloudService = new SaveService(cloudAdapter);
    await cloudService.save(2, createCareer("cloud-slot-repair"));
    const key = "basketball-manager:career:2";
    const cloudEnvelope = JSON.parse(await cloudAdapter.get(key) as string) as { slotId: number };
    cloudEnvelope.slotId = 3;
    await cloudAdapter.set(key, JSON.stringify(cloudEnvelope));

    const localAdapter = new MemoryStorageAdapter();
    const localService = new SaveService(localAdapter);
    const result = await localService.syncWithCloud(2, cloudAdapter);

    expect(result).toEqual(expect.objectContaining({ status: "PULLED_CLOUD", local: expect.objectContaining({ slotId: 2 }) }));
    expect(JSON.parse(await localAdapter.get(key) as string)).toEqual(expect.objectContaining({ slotId: 2 }));
    expect(JSON.parse(await cloudAdapter.get(key) as string)).toEqual(expect.objectContaining({ slotId: 2 }));
  });

  it("lists recognizable slot details and resumes the most recently saved career", async () => {
    const service = new SaveService(new MemoryStorageAdapter());
    const first = createCareer("summary-one");
    first.teams[first.userTeamId].fullName = "西雅图海潮";
    const firstSaved = await service.save(1, first);
    const latest = simulateNextGameDay(createCareer("summary-two"));
    latest.teams[latest.userTeamId].fullName = "拉斯维加斯王牌";
    const latestSaved = await service.save(2, latest);

    const summaries = await service.listSlotSummaries();
    expect(service.summaryFor(1, firstSaved)).toEqual(summaries.find((summary) => summary.slotId === 1));
    expect(service.summaryFor(2, latestSaved)).toEqual(summaries.find((summary) => summary.slotId === 2));
    expect(summaries).toEqual(expect.arrayContaining([
      expect.objectContaining({ slotId: 1, teamName: "西雅图海潮", seasonId: first.league.seasonId, wins: 0, losses: 0 }),
      expect.objectContaining({ slotId: 2, teamName: "拉斯维加斯王牌", seasonId: latest.league.seasonId, currentDate: expect.any(String) }),
    ]));
    expect((await service.loadMostRecent())?.slotId).toBe(2);
    expect((await service.loadMostRecent())?.state.seeds.careerSeed).toBe("summary-two");
  });

  it("keeps sync_base_revision stable across offline saves and safely fast-forwards", async () => {
    const localAdapter = new MemoryStorageAdapter();
    const cloudAdapter = new MemoryStorageAdapter();
    const service = new SaveService(localAdapter);
    const state = createCareer("offline-branch");
    await service.save(1, state);
    expect((await service.syncWithCloud(1, cloudAdapter))?.status).toBe("PUSHED_LOCAL");
    const revision2 = await service.save(1, simulateNextGameDay(state));
    const revision3 = await service.save(1, simulateNextGameDay(simulateNextGameDay(state)));
    expect(revision2.syncBaseRevision).toBe(1);
    expect(revision3.syncBaseRevision).toBe(1);
    const result = await service.syncWithCloud(1, cloudAdapter);
    expect(result?.status).toBe("PUSHED_LOCAL");
    expect(result?.local.syncBaseRevision).toBe(3);
    expect(result?.local.pendingSync).toBe(false);
  });

  it("detects two-sided changes, never auto-merges, and backs up before choosing cloud", async () => {
    const localAdapter = new MemoryStorageAdapter();
    const cloudAdapter = new MemoryStorageAdapter();
    const localService = new SaveService(localAdapter);
    const cloudService = new SaveService(cloudAdapter);
    const base = createCareer("save-conflict");
    await localService.save(1, base);
    await localService.syncWithCloud(1, cloudAdapter);
    const localState = simulateNextGameDay(base);
    const cloudState = structuredClone(base);
    cloudState.teams.SEA.fanSupport += 2;
    await localService.save(1, localState);
    await cloudService.save(1, cloudState);
    expect((await localService.syncWithCloud(1, cloudAdapter))?.status).toBe("SAVE_CONFLICT");
    await localService.resolveConflict(1, cloudAdapter, "CLOUD");
    expect((await localService.load(1))?.teams.SEA.fanSupport).toBe(cloudState.teams.SEA.fanSupport);
    expect((await localService.loadConflictBackup(1))?.lightweightResults.length).toBe(localState.lightweightResults.length);
  });

  it("does not report a conflict when state hashes are equal", async () => {
    const localAdapter = new MemoryStorageAdapter();
    const cloudAdapter = new MemoryStorageAdapter();
    const service = new SaveService(localAdapter);
    const state = createCareer("same-content");
    await service.save(1, state);
    await service.syncWithCloud(1, cloudAdapter);
    await service.save(1, state);
    expect((await service.syncWithCloud(1, cloudAdapter))?.status).toBe("IN_SYNC");
  });

  it("keeps only the three newest checkpoints and reports total slot bytes", async () => {
    const service = new SaveService(new MemoryStorageAdapter());
    const state = createCareer("checkpoint-cap");
    await service.save(1, state);
    for (const id of ["one", "two", "three", "four"]) await service.saveCheckpoint(1, id, state);
    expect(await service.loadCheckpoint(1, "one")).toBeNull();
    expect(await service.loadCheckpoint(1, "four")).not.toBeNull();
    expect(await service.getSlotUsageBytes(1)).toBeGreaterThan(0);
  });

  it("frees old checkpoints before a full storage quota can block season rollover saves", async () => {
    class BoundedStorageAdapter implements StorageAdapter {
      values = new Map<string, string>();
      capacity = Number.POSITIVE_INFINITY;
      async get(key: string) { return this.values.get(key) ?? null; }
      async remove(key: string) { this.values.delete(key); }
      async set(key: string, value: string) {
        const used = [...this.values.entries()].reduce((sum, [name, content]) => sum + (name === key ? 0 : content.length), 0);
        if (used + value.length > this.capacity) throw new DOMException("Storage quota reached", "QuotaExceededError");
        this.values.set(key, value);
      }
      get used() { return [...this.values.values()].reduce((sum, value) => sum + value.length, 0); }
    }
    const adapter = new BoundedStorageAdapter();
    const service = new SaveService(adapter);
    const state = createCareer("quota-rollover-save");
    await service.save(1, state);
    for (const id of ["expansion", "draft", "free-agency"]) await service.saveCheckpoint(1, id, state);
    adapter.capacity = adapter.used + 100;
    await service.saveCheckpoint(1, "pre-rollover-2026-27", state);
    expect(await service.loadCheckpoint(1, "expansion")).toBeNull();
    state.league.currentPhase = "OPTION_PHASE";
    await service.save(1, state);
    expect((await service.load(1))?.league.currentPhase).toBe("OPTION_PHASE");
  });

  it("recovers a corrupted primary revision from a verified pending write", async () => {
    const adapter = new MemoryStorageAdapter();
    const service = new SaveService(adapter);
    const state = createCareer("recover-primary");
    await service.save(1, state);
    const primaryKey = "basketball-manager:career:1";
    const pendingKey = `${primaryKey}:pending`;
    const valid = await adapter.get(primaryKey) as string;
    const corrupt = JSON.parse(valid) as { state: { userTeamId: string } };
    corrupt.state.userTeamId = "CORRUPTED";
    await adapter.set(primaryKey, JSON.stringify(corrupt));
    await adapter.set(pendingKey, valid);
    expect((await service.load(1))?.userTeamId).toBe(state.userTeamId);
    expect(await adapter.get(pendingKey)).toBeNull();
  });

  it("migrates legacy placeholder players into complete deterministic profiles", async () => {
    const service = new SaveService(new MemoryStorageAdapter());
    const legacy = createCareer("legacy-player-profile");
    const player = Object.values(legacy.players).sort((left, right) => left.id.localeCompare(right.id))[0];
    player.name = "ATL Player 1";
    const legacyPlayer = player as unknown as Record<string, unknown>;
    for (const key of [
      "heightCm", "weightKg", "secondaryPosition", "birthDate", "ageAtSnapshot", "ageSource",
      "serviceYears", "injuryRating", "personality", "marketPreference", "profileSource",
    ]) delete legacyPlayer[key];
    legacy.meta.schemaVersion = 2;

    await service.save(1, legacy);
    const migrated = await service.load(1);
    const migratedPlayer = migrated?.players[player.id];

    expect(migrated?.meta.schemaVersion).toBe(18);
    expect(migrated?.teams[migrated.userTeamId].rotationPlan).toBeDefined();
    expect(migrated?.history.rebornHistoricalSourceIds).toEqual([]);
    expect(migratedPlayer?.name).not.toMatch(/ Player \d+$/u);
    expect(migratedPlayer?.heightCm).toBeGreaterThanOrEqual(183);
    expect(migratedPlayer?.birthDate).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    expect(migratedPlayer?.profileSource).toBe("FICTIONAL_FIXTURE");
    expect(migratedPlayer?.marketPreference).toBe(calculateMarketPreference(migratedPlayer!.personality, migratedPlayer!.ageAtSnapshot));
  });

  it("corrects Taj Gibson's randomized opening service years once in an older bundled save", async () => {
    const service = new SaveService(new MemoryStorageAdapter());
    const legacy = createCareer("legacy-real-service-years");
    legacy.meta.dataVersion = "bundled.before-service-years";
    const taj = structuredClone(Object.values(legacy.players)[0]);
    taj.id = "nba:201959";
    taj.name = "Taj Gibson";
    taj.teamId = "FREE_AGENT";
    taj.profileSource = "CURATED_DATASET";
    taj.age = 41;
    taj.ageAtSnapshot = 41;
    taj.serviceYears = 5;
    taj.contract.status = "UFA";
    legacy.players[taj.id] = taj;

    await service.save(1, legacy);
    const migrated = await service.load(1);
    expect(migrated?.players[taj.id].serviceYears).toBe(17);
    expect(migrated?.players[taj.id].serviceYearsSource).toBe("DOCUMENTED_DEBUT");
    expect(migrated?.meta.dataVersion).toContain("+service.2026.v2");

    if (!migrated) throw new Error("Legacy save did not load");
    migrated.players[taj.id].serviceYears = 18;
    await service.save(1, migrated);
    expect((await service.load(1))?.players[taj.id].serviceYears).toBe(18);
  });

  it("replaces first-pass NBA experience values and preserves service earned in the save", async () => {
    const service = new SaveService(new MemoryStorageAdapter());
    const state = createCareer("verified-service-years-migration");
    state.meta.dataVersion = "bundled.test+service.2026.v1";
    state.league.seasonYear = 2027;
    const template = Object.values(state.players)[0];
    state.players["nba:1630166"] = {
      ...structuredClone(template), id: "nba:1630166", profileSource: "CURATED_DATASET",
      ageAtSnapshot: 25, serviceYears: 6, serviceYearsSource: "NBA_OFFICIAL_PROFILE",
    };
    state.players["nba:1641739"] = {
      ...structuredClone(template), id: "nba:1641739", profileSource: "CURATED_DATASET",
      ageAtSnapshot: 26, serviceYears: 7, serviceYearsSource: "AGE_ESTIMATE",
    };
    state.players["nba:201145"] = {
      ...structuredClone(template), id: "nba:201145", profileSource: "CURATED_DATASET",
      ageAtSnapshot: 40, serviceYears: 20, serviceYearsSource: "NBA_OFFICIAL_PROFILE",
    };

    await service.save(1, state);
    const migrated = await service.load(1);
    expect(migrated?.players["nba:1630166"]).toMatchObject({ serviceYears: 7, serviceYearsSource: "NBA_OFFICIAL_PROFILE" });
    expect(migrated?.players["nba:1641739"]).toMatchObject({ serviceYears: 4, serviceYearsSource: "NBA_OFFICIAL_PROFILE" });
    expect(migrated?.players["nba:201145"]).toMatchObject({ serviceYears: 20, serviceYearsSource: "NBA_OFFICIAL_PROFILE" });
    expect(migrated?.meta.dataVersion).toContain("+service.2026.v2");
  });

  it("recalculates legacy random market preference when loading a career", async () => {
    const service = new SaveService(new MemoryStorageAdapter());
    const state = createCareer("legacy-market-preference");
    const player = Object.values(state.players)[0];
    player.marketPreference = 0;
    state.teams.LAL.marketRating = 56;
    await service.save(1, state);
    const loaded = await service.load(1);
    expect(loaded?.players[player.id].marketPreference).toBe(calculateMarketPreference(player.personality, player.ageAtSnapshot));
    expect(loaded?.teams.LAL.marketRating).toBe(100);
  });

  it("rejects a parseable temporary write whose state content was corrupted", async () => {
    class CorruptingAdapter implements StorageAdapter {
      private readonly values = new Map<string, string>();
      async get(key: string): Promise<string | null> { return this.values.get(key) ?? null; }
      async set(key: string, value: string): Promise<void> {
        if (key.endsWith(":pending")) {
          const parsed = JSON.parse(value) as { state: { userTeamId: string } };
          parsed.state.userTeamId = "CORRUPTED";
          this.values.set(key, JSON.stringify(parsed));
          return;
        }
        this.values.set(key, value);
      }
      async remove(key: string): Promise<void> { this.values.delete(key); }
    }
    const service = new SaveService(new CorruptingAdapter());
    await expect(service.save(1, createCareer("corrupt-temp-test"))).rejects.toThrow(/verification failed/);
  });

  it("merges missing seven-year draft inventory without overwriting existing ownership", async () => {
    const service = new SaveService(new MemoryStorageAdapter());
    const legacy = createCareer("legacy-picks");
    legacy.draftPicks["2027-R1-ATL"].ownerTeamId = "BOS";
    for (const pickId of Object.keys(legacy.draftPicks)) if (legacy.draftPicks[pickId].year >= 2032) delete legacy.draftPicks[pickId];
    await service.save(1, legacy);
    const migrated = await service.load(1);
    expect(migrated?.draftPicks["2027-R1-ATL"].ownerTeamId).toBe("BOS");
    expect(migrated?.draftPicks["2033-R2-SEA"].ownerTeamId).toBe("SEA");
  });
});
