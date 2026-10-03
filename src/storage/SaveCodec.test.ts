import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stableHash, stableSerialize } from "../game/random/hash";
import { decodeStoredStringCore } from "../platform/storage/StoredStringCodec";

const workers = vi.hoisted(() => ({ instances: [] as Array<{
  onmessage: ((event: { data: { id: number; result?: unknown; error?: string } }) => void) | null;
  onerror: (() => void) | null;
  onmessageerror: (() => void) | null;
  postMessage: ReturnType<typeof vi.fn>;
  terminate: ReturnType<typeof vi.fn>;
}> }));

vi.mock("./SaveCodec.worker?worker&inline", () => ({
  default: class {
    onmessage = null;
    onerror = null;
    onmessageerror = null;
    postMessage = vi.fn();
    terminate = vi.fn();
    constructor() { workers.instances.push(this); }
  },
}));

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.stubGlobal("window", {});
  vi.stubGlobal("Worker", class {});
  workers.instances = [];
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("save codec Worker recovery", () => {
  it("uses one Worker job to serialize/compress and replies to inspection without state or JSON", async () => {
    vi.useRealTimers();
    const { createCareer } = await import("../game/season/career");
    const { serializeEncodedSaveEnvelope, inspectEncodedSaveEnvelope } = await import("./SaveCodec");
    const state = createCareer("encoded-worker-protocol");
    const value = {
      saveId: "worker-career", slotId: 1, schemaVersion: state.meta.schemaVersion,
      gameVersion: state.meta.gameVersion, dataVersion: state.meta.dataVersion,
      generatorVersion: state.meta.generatorVersion, careerSeed: state.seeds.careerSeed,
      revision: 1, parentRevision: null, syncBaseRevision: null, stateHash: "",
      updatedAt: "2026-10-02T12:00:00Z", pendingSync: true, state,
    };
    const result = serializeEncodedSaveEnvelope(value);
    const worker = workers.instances[0];
    const replies: Array<{ id: number; result?: unknown; error?: string }> = [];
    const scope: { onmessage?: (event: { data: unknown }) => Promise<void>; postMessage(message: { id: number; result?: unknown; error?: string }): void } = {
      postMessage(message) { replies.push(message); worker.onmessage!({ data: message }); },
    };
    vi.stubGlobal("self", scope);
    await import("./SaveCodec.worker");
    await scope.onmessage!({ data: worker.postMessage.mock.calls[0][0] });
    const prepared = await result;
    expect(worker.postMessage).toHaveBeenCalledOnce();
    expect(worker.postMessage.mock.calls[0][0].kind).toBe("SERIALIZE_ENCODED_ENVELOPE");
    expect(Object.keys(prepared).sort()).toEqual(["encoded", "stateHash"]);
    expect(JSON.parse(await decodeStoredStringCore(prepared.encoded))).toEqual({ ...value, stateHash: prepared.stateHash });

    worker.postMessage.mockImplementation((request) => { void scope.onmessage!({ data: request }); });
    const inspected = await inspectEncodedSaveEnvelope(prepared.encoded, 1);
    expect(inspected).toMatchObject({ saveId: value.saveId, revision: 1, encoded: prepared.encoded });
    expect(inspected).not.toHaveProperty("state");
    expect(inspected).not.toHaveProperty("serialized");
    expect(replies.every(({ error }) => !error)).toBe(true);
  });

  it("recovers encoded jobs locally after Worker timeout without changing their format", async () => {
    const { inspectEncodedSaveEnvelope, validateStoredStringEncoding } = await import("./SaveCodec");
    const inspected = inspectEncodedSaveEnvelope("raw:broken", 1);
    const readable = validateStoredStringEncoding("raw:checkpoint index");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await inspected).toBeNull();
    expect(await readable).toBeUndefined();
    expect(workers.instances[0].terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("finishes silent requests locally and releases every pending caller", async () => {
    const { hashSaveState, stringifySaveValue } = await import("./SaveCodec");
    const value = { seasonId: "2028-29", phase: "OFFSEASON" };
    const hash = hashSaveState(value);
    const serialized = stringifySaveValue(value);
    const worker = workers.instances[0];
    let settled = false;
    void hash.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(9_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await hash).toBe(stableHash(stableSerialize(value)));
    expect(await serialized).toBe(JSON.stringify(value));
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    expect(await stringifySaveValue(value)).toBe(JSON.stringify(value));
    expect(workers.instances).toHaveLength(1);
  });

  it("clears the deadline after a response and leaves the Worker reusable", async () => {
    const { stringifySaveValue } = await import("./SaveCodec");
    const result = stringifySaveValue({ saved: true });
    const worker = workers.instances[0];
    const request = worker.postMessage.mock.calls[0][0];
    worker.onmessage!({ data: { id: request.id, result: '{"saved":true}' } });
    expect(await result).toBe('{"saved":true}');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(worker.terminate).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["onerror", "onmessageerror"] as const)("recovers all requests after %s", async (event) => {
    const { hashSaveState, stringifySaveValue } = await import("./SaveCodec");
    const hash = hashSaveState({ revision: 2 });
    const text = stringifySaveValue({ revision: 2 });
    workers.instances[0][event]!();
    expect(await hash).toBe(stableHash(stableSerialize({ revision: 2 })));
    expect(await text).toBe('{"revision":2}');
    expect(vi.getTimerCount()).toBe(0);
  });

  it("releases other callers when sending fails with DataCloneError", async () => {
    const { hashSaveState, stringifySaveValue } = await import("./SaveCodec");
    const hash = hashSaveState({ revision: 2 });
    const worker = workers.instances[0];
    worker.postMessage.mockImplementationOnce(() => { throw new DOMException("Cannot clone", "DataCloneError"); });
    expect(await stringifySaveValue({ revision: 3 })).toBe('{"revision":3}');
    await vi.advanceTimersByTimeAsync(0);
    expect(await hash).toBe(stableHash(stableSerialize({ revision: 2 })));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("recovers a silent chunked compression request without losing any characters", async () => {
    const { encodeStoredStringInWorker } = await import("./SaveCodec");
    const source = "篮球经理🏀".repeat(100_000);
    const result = encodeStoredStringInWorker(source);
    await vi.advanceTimersByTimeAsync(10_000);
    vi.useRealTimers();
    expect(await decodeStoredStringCore(await result)).toBe(source);
    expect(workers.instances[0].terminate).toHaveBeenCalledOnce();
  });

  it("preserves the 2028-29 primary while saving stalls, then commits and releases queued saves", async () => {
    const { SaveService } = await import("./SaveService");
    const { MemoryStorageAdapter } = await import("../platform/storage/StorageAdapter");
    const { createCareer } = await import("../game/season/career");
    const { executeContractLifecycleCommand } = await import("../game/contracts/ContractLifecycleService");
    const original = createCareer("rollover-save-worker-recovery");
    original.league = { seasonYear: 2028, seasonId: "2028-29", currentPhase: "OFFSEASON" };
    const primaryKey = "basketball-manager:career:1";
    const serialized = JSON.stringify({
      saveId: "rollover-reproduction", slotId: 1, revision: 1, parentRevision: null,
      syncBaseRevision: null, updatedAt: "2026-10-02T00:00:00Z", pendingSync: true,
      stateHash: stableHash(stableSerialize(original)), state: original,
    });
    const adapter = new MemoryStorageAdapter();
    await adapter.set(primaryKey, serialized);
    const service = new SaveService(adapter);
    const next = executeContractLifecycleCommand(original, {
      commandId: "rollover-2028-29", type: "ROLLOVER_LEAGUE_YEAR", payload: {},
    });
    const first = service.save(1, next);
    const second = service.save(1, next);
    await vi.advanceTimersByTimeAsync(0);
    const worker = workers.instances[0];
    worker.postMessage.mockImplementation((request) => {
      if (request.kind === "STRINGIFY") worker.onmessage!({ data: { id: request.id, result: JSON.stringify(request.value) } });
      // SERIALIZE_ENVELOPE deliberately never replies.
    });
    const parse = worker.postMessage.mock.calls[0][0];
    const { state: _state, ...header } = JSON.parse(parse.value);
    worker.onmessage!({ data: { id: parse.id, result: { ...header, serialized: parse.value } } });
    await vi.advanceTimersByTimeAsync(9_999);
    expect(await adapter.get(primaryKey)).toBe(serialized);
    expect(original.league.seasonId).toBe("2028-29");
    await vi.advanceTimersByTimeAsync(1);
    expect((await first).revision).toBe(2);
    expect((await second).revision).toBe(3);
    expect((await service.load(1))?.league.seasonId).toBe("2029-30");
    expect(await adapter.get(`${primaryKey}:pending`)).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});
