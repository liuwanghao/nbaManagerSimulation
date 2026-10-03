import { hashSaveValue } from "../game/random/hash";
import { decodeStoredStringCore, encodeStoredStringCore } from "../platform/storage/StoredStringCodec";
import type { SaveEnvelope } from "./SaveService";
import { inspectEncodedSaveEnvelopeCore, inspectValidSaveEnvelopeCore, parseValidSaveEnvelopeCopyCore, parseValidSaveEnvelopeCore, serializeEncodedSaveEnvelopeCore, serializeSaveEnvelopeCore } from "./SaveEnvelopeCodec";

type Request =
  | { id: number; kind: "HASH"; value: unknown }
  | { id: number; kind: "STRINGIFY"; value: unknown }
  | { id: number; kind: "SERIALIZE_ENVELOPE" | "SERIALIZE_ENCODED_ENVELOPE"; value: SaveEnvelope }
  | { id: number; kind: "PARSE_ENVELOPE"; value: string | null; expectedSlotId?: number }
  | { id: number; kind: "PARSE_ENVELOPE_COPY" | "INSPECT_ENVELOPE" | "INSPECT_ENCODED_ENVELOPE"; value: string | null; expectedSlotId?: number }
  | { id: number; kind: "ENCODE_STORED_STRING" | "DECODE_STORED_STRING" | "VALIDATE_STORED_STRING"; value: string }
  | { id: number; kind: "ENCODE_CHUNK"; chunk: string; final: boolean };

const encodeChunks = new Map<number, string[]>();

self.onmessage = async (event: MessageEvent<Request>) => {
  const request = event.data;
  try {
    let result: unknown;
    switch (request.kind) {
      case "HASH": result = hashSaveValue(request.value); break;
      case "STRINGIFY": result = JSON.stringify(request.value); break;
      case "SERIALIZE_ENVELOPE": result = serializeSaveEnvelopeCore(request.value); break;
      case "SERIALIZE_ENCODED_ENVELOPE": result = await serializeEncodedSaveEnvelopeCore(request.value); break;
      case "PARSE_ENVELOPE": result = parseValidSaveEnvelopeCore(request.value, request.expectedSlotId); break;
      case "PARSE_ENVELOPE_COPY": result = parseValidSaveEnvelopeCopyCore(request.value, request.expectedSlotId); break;
      case "INSPECT_ENVELOPE": result = inspectValidSaveEnvelopeCore(request.value, request.expectedSlotId); break;
      case "INSPECT_ENCODED_ENVELOPE": result = await inspectEncodedSaveEnvelopeCore(request.value, request.expectedSlotId); break;
      case "ENCODE_STORED_STRING": result = await encodeStoredStringCore(request.value); break;
      case "DECODE_STORED_STRING": result = await decodeStoredStringCore(request.value); break;
      case "VALIDATE_STORED_STRING": await decodeStoredStringCore(request.value); break;
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
