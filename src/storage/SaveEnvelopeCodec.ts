import { hashSaveValue, stableHash } from "../game/random/hash";
import { decodeStoredStringCore, encodeStoredStringCore } from "../platform/storage/StoredStringCodec";
import type { SaveEnvelope } from "./SaveService";

export type SaveEnvelopeCopy = { envelope: SaveEnvelope; serialized: string };
export type InspectedSaveEnvelope = Omit<SaveEnvelope, "state"> & { serialized: string };
export type InspectedEncodedSaveEnvelope = Omit<SaveEnvelope, "state"> & { encoded: string };

function parseEnvelope(value: string | null, expectedSlotId?: number): {
  envelope: SaveEnvelope; changed: boolean;
} | null {
  if (!value) return null;
  let envelope: SaveEnvelope;
  try { envelope = JSON.parse(value) as SaveEnvelope; }
  catch (error) {
    // A read/allocation failure does not establish that the player's save is corrupt.
    if (error instanceof SyntaxError) return null;
    throw error;
  }
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) return null;
  const changed = !envelope.saveId;
  if (changed) envelope.saveId = stableHash(envelope.careerSeed, "save", expectedSlotId ?? envelope.slotId);
  return hashSaveValue(envelope.state) === envelope.stateHash ? { envelope, changed } : null;
}

export function parseValidSaveEnvelopeCore(value: string | null, expectedSlotId?: number): SaveEnvelope | null {
  return parseEnvelope(value, expectedSlotId)?.envelope ?? null;
}

export function parseValidSaveEnvelopeCopyCore(value: string | null, expectedSlotId?: number): SaveEnvelopeCopy | null {
  const parsed = parseEnvelope(value, expectedSlotId);
  if (!parsed || !value) return null;
  const { envelope } = parsed;
  if (!Number.isInteger(envelope.revision) || envelope.revision < 1
    || typeof envelope.updatedAt !== "string" || !Number.isFinite(Date.parse(envelope.updatedAt))
    || !envelope.state?.meta || !envelope.state.seeds || !envelope.state.teams
    || !envelope.state.standings || !envelope.state.calendar || !envelope.state.league) return null;
  const wrongSlot = expectedSlotId !== undefined && envelope.slotId !== expectedSlotId;
  if (wrongSlot) envelope.slotId = expectedSlotId;
  return { envelope, serialized: parsed.changed || wrongSlot ? JSON.stringify(envelope) : value };
}

export function inspectValidSaveEnvelopeCore(value: string | null, expectedSlotId?: number): InspectedSaveEnvelope | null {
  const copy = parseValidSaveEnvelopeCopyCore(value, expectedSlotId);
  if (!copy) return null;
  const { state: _state, ...header } = copy.envelope;
  return { ...header, serialized: copy.serialized };
}

export function serializeSaveEnvelopeCore(value: SaveEnvelope): { stateHash: string; serialized: string } {
  const stateHash = hashSaveValue(value.state);
  return { stateHash, serialized: JSON.stringify({ ...value, stateHash }) };
}

export async function serializeEncodedSaveEnvelopeCore(value: SaveEnvelope): Promise<{ stateHash: string; encoded: string }> {
  const { stateHash, serialized } = serializeSaveEnvelopeCore(value);
  return { stateHash, encoded: await encodeStoredStringCore(serialized) };
}

export async function inspectEncodedSaveEnvelopeCore(value: string | null, expectedSlotId?: number): Promise<InspectedEncodedSaveEnvelope | null> {
  if (value === null) return null;
  const serialized = await decodeStoredStringCore(value);
  const copy = parseValidSaveEnvelopeCopyCore(serialized, expectedSlotId);
  if (!copy) return null;
  const { state: _state, ...header } = copy.envelope;
  // Healthy bytes are reusable even when legacy storage has no compression prefix.
  const encoded = copy.serialized === serialized ? value : await encodeStoredStringCore(copy.serialized);
  return { ...header, encoded };
}
