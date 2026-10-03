import { afterEach, describe, expect, it, vi } from "vitest";
import { stableHash, stableSerialize } from "../game/random/hash";
import { createCareer } from "../game/season/career";
import { inspectEncodedSaveEnvelopeCore, inspectValidSaveEnvelopeCore, parseValidSaveEnvelopeCopyCore, parseValidSaveEnvelopeCore, serializeEncodedSaveEnvelopeCore, serializeSaveEnvelopeCore } from "./SaveEnvelopeCodec";
import { decodeStoredStringCore, encodeStoredStringCore } from "../platform/storage/StoredStringCodec";
import type { SaveEnvelope } from "./SaveService";

const state = createCareer("save-memory-codec-contract");
function envelope(): SaveEnvelope {
  return {
    saveId: "existing-career", slotId: 1, schemaVersion: state.meta.schemaVersion,
    gameVersion: state.meta.gameVersion, dataVersion: state.meta.dataVersion,
    generatorVersion: state.meta.generatorVersion, careerSeed: state.seeds.careerSeed,
    revision: 7, parentRevision: 6, syncBaseRevision: 4,
    stateHash: stableHash(stableSerialize(state)), updatedAt: "2026-10-02T12:00:00Z",
    pendingSync: true, state,
  };
}
afterEach(() => vi.restoreAllMocks());

describe("save envelope memory contract", () => {
  it("serializes and compresses one envelope without returning its JSON or state", async () => {
    const original = envelope();
    const result = await serializeEncodedSaveEnvelopeCore({ ...original, stateHash: "" });
    expect(Object.keys(result).sort()).toEqual(["encoded", "stateHash"]);
    expect(result.stateHash).toBe(original.stateHash);
    expect(JSON.parse(await decodeStoredStringCore(result.encoded))).toEqual(original);
  });

  it.each(["gzip", "raw", "legacy"])("inspects a healthy %s payload without decoded JSON or state in its reply", async (encoding) => {
    const original = envelope();
    const serialized = `\n${JSON.stringify(original, null, 2)}\n`;
    const encoded = encoding === "gzip" ? await encodeStoredStringCore(serialized) : encoding === "raw" ? `raw:${serialized}` : serialized;
    const result = await inspectEncodedSaveEnvelopeCore(encoded, 1);
    const { state: _state, ...header } = original;
    expect(result).toEqual({ ...header, encoded });
    expect(result).not.toHaveProperty("serialized");
    expect(result).not.toHaveProperty("state");
  });

  it("repairs legacy encoded headers while preserving the state and checksum", async () => {
    const legacy = envelope();
    delete (legacy as Partial<SaveEnvelope>).saveId;
    legacy.slotId = 3;
    const encoded = await encodeStoredStringCore(JSON.stringify(legacy));
    const result = await inspectEncodedSaveEnvelopeCore(encoded, 2);
    expect(result).toMatchObject({ slotId: 2, saveId: stableHash(legacy.careerSeed, "save", 2) });
    expect(JSON.parse(await decodeStoredStringCore(result!.encoded))).toEqual({ ...legacy, slotId: 2, saveId: result!.saveId });
  });

  it("rejects a checksum-invalid encoded state and preserves resource error classification", async () => {
    expect(await inspectEncodedSaveEnvelopeCore(await encodeStoredStringCore(JSON.stringify({ ...envelope(), stateHash: "bad" })), 1)).toBeNull();
    await expect(inspectEncodedSaveEnvelopeCore("gz:!!!!", 1)).rejects.toThrow("INVALID_COMPRESSED_SAVE");
    const encoded = await encodeStoredStringCore(JSON.stringify(envelope()));
    const failure = new RangeError("Invalid string length");
    vi.spyOn(JSON, "parse").mockImplementation(() => { throw failure; });
    await expect(inspectEncodedSaveEnvelopeCore(encoded, 1)).rejects.toBe(failure);
  });

  it("validates an old save while returning only metadata and its original bytes", () => {
    const original = envelope();
    const serialized = `\n${JSON.stringify(original, null, 2)}\n`;
    const inspected = inspectValidSaveEnvelopeCore(serialized, 1);
    expect(inspected).toMatchObject({ saveId: "existing-career", revision: 7, parentRevision: 6, syncBaseRevision: 4, serialized });
    expect(inspected).not.toHaveProperty("state");
    const { state: _state, ...header } = original;
    expect(inspected).toEqual({ ...header, serialized });
  });

  it("preserves healthy load bytes without another whole-state stringify", () => {
    const serialized = JSON.stringify(envelope(), null, 2);
    const stringify = vi.spyOn(JSON, "stringify");
    const copy = parseValidSaveEnvelopeCopyCore(serialized, 1);
    expect(copy?.serialized).toBe(serialized);
    expect(copy?.envelope.state.seeds.careerSeed).toBe(state.seeds.careerSeed);
    expect(stringify.mock.calls.some(([value]) => value !== null && typeof value === "object")).toBe(false);
  });

  it("repairs legacy missing identity and physical slot without changing the state checksum", () => {
    const legacy = envelope();
    delete (legacy as Partial<SaveEnvelope>).saveId;
    legacy.slotId = 3;
    const inspected = inspectValidSaveEnvelopeCore(JSON.stringify(legacy), 2)!;
    expect(inspected.slotId).toBe(2);
    expect(inspected.saveId).toBe(stableHash(legacy.careerSeed, "save", 2));
    const restored = JSON.parse(inspected.serialized) as SaveEnvelope;
    expect(restored.slotId).toBe(2);
    expect(restored.stateHash).toBe(legacy.stateHash);
    expect(restored.state).toEqual(state);
  });

  it("keeps raw-slot verification available to cloud writes", () => {
    const wrongSlot = { ...envelope(), slotId: 3 };
    const serialized = JSON.stringify(wrongSlot);
    expect(parseValidSaveEnvelopeCore(serialized, 1)?.slotId).toBe(3);
    expect(parseValidSaveEnvelopeCopyCore(serialized, 1)?.envelope.slotId).toBe(1);
  });

  it("writes the exact legacy state checksum and reloads it", () => {
    const original = envelope();
    original.stateHash = "";
    const encoded = serializeSaveEnvelopeCore(original);
    expect(encoded.stateHash).toBe(stableHash(stableSerialize(state)));
    expect(parseValidSaveEnvelopeCopyCore(encoded.serialized, 1)?.envelope.state).toEqual(state);
  });

  it("rejects a modified state instead of backing it up as valid", () => {
    const original = envelope();
    const modified = JSON.parse(JSON.stringify(original)) as SaveEnvelope;
    modified.state.calendar.currentDateIndex += 1;
    expect(inspectValidSaveEnvelopeCore(JSON.stringify(modified), 1)).toBeNull();
  });

  it.each([0, 1.5, -1])("rejects invalid revision %s", (revision) => {
    expect(inspectValidSaveEnvelopeCore(JSON.stringify({ ...envelope(), revision }), 1)).toBeNull();
  });

  it("rejects invalid date and missing required state structure", () => {
    expect(inspectValidSaveEnvelopeCore(JSON.stringify({ ...envelope(), updatedAt: "invalid" }), 1)).toBeNull();
    const invalid = { ...envelope(), state: { ...state, calendar: null } };
    invalid.stateHash = stableHash(stableSerialize(invalid.state));
    expect(inspectValidSaveEnvelopeCore(JSON.stringify(invalid), 1)).toBeNull();
  });

  it.each([null, "broken", "null", "42", "[]"])("rejects malformed save %s", (value) => {
    expect(inspectValidSaveEnvelopeCore(value, 1)).toBeNull();
  });

  it("propagates an allocation failure so saving cannot classify it as corrupt", () => {
    const failure = new RangeError("Invalid string length");
    vi.spyOn(JSON, "parse").mockImplementation(() => { throw failure; });
    expect(() => inspectValidSaveEnvelopeCore("valid-but-unreadable", 1)).toThrow(failure);
  });
});
