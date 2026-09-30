import { stableHash, stableSerialize } from "../game/random/hash";
import { decodeStoredStringCore, encodeStoredStringCore } from "../platform/storage/StoredStringCodec";
import type { SaveEnvelope } from "./SaveService";

type Request =
  | { id: number; kind: "HASH"; value: unknown }
  | { id: number; kind: "STRINGIFY"; value: unknown }
  | { id: number; kind: "SERIALIZE_ENVELOPE"; value: SaveEnvelope }
  | { id: number; kind: "PARSE_ENVELOPE"; value: string | null; expectedSlotId?: number }
  | { id: number; kind: "ENCODE_STORED_STRING" | "DECODE_STORED_STRING"; value: string }
  | { id: number; kind: "ENCODE_CHUNK"; chunk: string; final: boolean };

const encodeChunks = new Map<number, string[]>();

self.onmessage = async (event: MessageEvent<Request>) => {
  const request = event.data;
  try {
    let result: unknown;
    switch (request.kind) {
      case "HASH": result = stableHash(stableSerialize(request.value)); break;
      case "STRINGIFY": result = JSON.stringify(request.value); break;
      case "SERIALIZE_ENVELOPE": {
        const stateHash = stableHash(stableSerialize(request.value.state));
        result = { stateHash, serialized: JSON.stringify({ ...request.value, stateHash }) };
        break;
      }
      case "PARSE_ENVELOPE": {
        try {
          if (!request.value) { result = null; break; }
          const envelope = JSON.parse(request.value) as SaveEnvelope;
          if (!envelope.saveId) envelope.saveId = stableHash(envelope.careerSeed, "save", request.expectedSlotId ?? envelope.slotId);
          result = stableHash(stableSerialize(envelope.state)) === envelope.stateHash ? envelope : null;
        } catch { result = null; }
        break;
      }
      case "ENCODE_STORED_STRING": result = await encodeStoredStringCore(request.value); break;
      case "DECODE_STORED_STRING": result = await decodeStoredStringCore(request.value); break;
      case "ENCODE_CHUNK": {
        const chunks = encodeChunks.get(request.id) ?? [];
        chunks.push(request.chunk);
        if (!request.final) {
          encodeChunks.set(request.id, chunks);
          return;
        }
        encodeChunks.delete(request.id);
        result = await encodeStoredStringCore(chunks.join(""));
        break;
      }
    }
    self.postMessage({ id: request.id, result });
  } catch (error) {
    self.postMessage({ id: request.id, error: error instanceof Error ? error.message : String(error) });
  }
};
