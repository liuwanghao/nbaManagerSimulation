import SaveCodecWorker from "./SaveCodec.worker?worker&inline";
import { hashSaveValue } from "../game/random/hash";
import { decodeStoredStringCore, encodeStoredStringCore } from "../platform/storage/StoredStringCodec";
import type { SaveEnvelope } from "./SaveService";
import { inspectEncodedSaveEnvelopeCore, inspectValidSaveEnvelopeCore, parseValidSaveEnvelopeCopyCore, parseValidSaveEnvelopeCore, serializeEncodedSaveEnvelopeCore, serializeSaveEnvelopeCore, type InspectedEncodedSaveEnvelope, type InspectedSaveEnvelope, type SaveEnvelopeCopy } from "./SaveEnvelopeCodec";

export type { InspectedEncodedSaveEnvelope, InspectedSaveEnvelope, SaveEnvelopeCopy } from "./SaveEnvelopeCodec";

type Request =
  | { id: number; kind: "HASH"; value: unknown }
  | { id: number; kind: "STRINGIFY"; value: unknown }
  | { id: number; kind: "SERIALIZE_ENVELOPE" | "SERIALIZE_ENCODED_ENVELOPE"; value: SaveEnvelope }
  | { id: number; kind: "PARSE_ENVELOPE"; value: string | null; expectedSlotId?: number }
  | { id: number; kind: "PARSE_ENVELOPE_COPY" | "INSPECT_ENVELOPE" | "INSPECT_ENCODED_ENVELOPE"; value: string | null; expectedSlotId?: number }
  | { id: number; kind: "ENCODE_STORED_STRING" | "DECODE_STORED_STRING" | "VALIDATE_STORED_STRING"; value: string };

type Response = { id: number; result?: unknown; error?: string };
type RequestInput<T> = T extends { id: number } ? Omit<T, "id"> : never;

let worker: Worker | null = null;
let unavailable = false;
let nextId = 1;
const WORKER_RESPONSE_TIMEOUT_MS = 10_000;
const pending = new Map<number, { resolve(value: unknown): void; reject(error: unknown): void; timer: ReturnType<typeof setTimeout> }>();

function disableWorker(): void {
  // Codec jobs have no storage side effects. Terminate before rerunning them
  // locally, and release every caller sharing this failed Worker.
  unavailable = true;
  worker?.terminate();
  worker = null;
  for (const waiter of pending.values()) {
    clearTimeout(waiter.timer);
    waiter.reject(new Error("SAVE_CODEC_WORKER_FAILED"));
  }
  pending.clear();
}

function waitForResponse<T>(id: number, send: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(disableWorker, WORKER_RESPONSE_TIMEOUT_MS);
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
    try { send(); }
    catch (error) {
      clearTimeout(timer);
      pending.delete(id);
      if (error instanceof DOMException && error.name === "DataCloneError") disableWorker();
      reject(error);
    }
  });
}

function runLocally(request: Request): unknown {
  switch (request.kind) {
    case "HASH": return hashSaveValue(request.value);
    case "STRINGIFY": return JSON.stringify(request.value);
    case "SERIALIZE_ENVELOPE": return serializeSaveEnvelopeCore(request.value);
    case "SERIALIZE_ENCODED_ENVELOPE": return serializeEncodedSaveEnvelopeCore(request.value);
    case "PARSE_ENVELOPE": return parseValidSaveEnvelopeCore(request.value, request.expectedSlotId);
    case "PARSE_ENVELOPE_COPY": return parseValidSaveEnvelopeCopyCore(request.value, request.expectedSlotId);
    case "INSPECT_ENVELOPE": return inspectValidSaveEnvelopeCore(request.value, request.expectedSlotId);
    case "INSPECT_ENCODED_ENVELOPE": return inspectEncodedSaveEnvelopeCore(request.value, request.expectedSlotId);
    case "ENCODE_STORED_STRING": return encodeStoredStringCore(request.value);
    case "DECODE_STORED_STRING": return decodeStoredStringCore(request.value);
    case "VALIDATE_STORED_STRING": return decodeStoredStringCore(request.value).then(() => undefined);
  }
}

function getWorker(): Worker | null {
  if (unavailable || typeof window === "undefined" || typeof Worker === "undefined") return null;
  if (worker) return worker;
  try {
    worker = new SaveCodecWorker();
    worker.onmessage = (event: MessageEvent<Response>) => {
      const message = event.data;
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      clearTimeout(waiter.timer);
      if (message.error) waiter.reject(new Error(message.error));
      else waiter.resolve(message.result);
    };
    worker.onerror = disableWorker;
    worker.onmessageerror = disableWorker;
    return worker;
  } catch {
    unavailable = true;
    return null;
  }
}

async function run<T>(input: RequestInput<Request>): Promise<T> {
  const request = { ...input, id: nextId++ } as Request;
  const activeWorker = getWorker();
  if (!activeWorker) return runLocally(request) as T;
  return waitForResponse<T>(request.id, () => activeWorker.postMessage(request)).catch((error: unknown) => {
    if (!unavailable && !(error instanceof DOMException && error.name === "DataCloneError")) throw error;
    return runLocally(request) as T;
  });
}

export const hashSaveState = (value: unknown): Promise<string> => run({ kind: "HASH", value });
export const stringifySaveValue = (value: unknown): Promise<string> => run({ kind: "STRINGIFY", value });
export const serializeSaveEnvelope = (value: SaveEnvelope): Promise<{ stateHash: string; serialized: string }> => run({ kind: "SERIALIZE_ENVELOPE", value });
export const serializeEncodedSaveEnvelope = (value: SaveEnvelope): Promise<{ stateHash: string; encoded: string }> => run({ kind: "SERIALIZE_ENCODED_ENVELOPE", value });
export const parseValidSaveEnvelope = (value: string | null, expectedSlotId?: number): Promise<SaveEnvelope | null> => run({ kind: "PARSE_ENVELOPE", value, expectedSlotId });
export const parseValidSaveEnvelopeCopy = (value: string | null, expectedSlotId?: number): Promise<SaveEnvelopeCopy | null> => run({ kind: "PARSE_ENVELOPE_COPY", value, expectedSlotId });
export const inspectValidSaveEnvelope = (value: string | null, expectedSlotId?: number): Promise<InspectedSaveEnvelope | null> => run({ kind: "INSPECT_ENVELOPE", value, expectedSlotId });
export const inspectEncodedSaveEnvelope = (value: string | null, expectedSlotId?: number): Promise<InspectedEncodedSaveEnvelope | null> => run({ kind: "INSPECT_ENCODED_ENVELOPE", value, expectedSlotId });
export const validateStoredStringEncoding = (value: string): Promise<void> => run({ kind: "VALIDATE_STORED_STRING", value });

export async function encodeStoredStringInWorker(value: string): Promise<string> {
  if (value.length <= 512_000) return run({ kind: "ENCODE_STORED_STRING", value });
  const activeWorker = getWorker();
  if (!activeWorker) return encodeStoredStringCore(value);
  const id = nextId++;
  const result = waitForResponse<string>(id, () => undefined);
  // Attach a rejection handler before yielding between chunks.
  void result.catch(() => undefined);
  try {
    for (let start = 0; start < value.length; start += 512_000) {
      if (unavailable) throw new Error("SAVE_CODEC_WORKER_FAILED");
      const end = Math.min(value.length, start + 512_000);
      activeWorker.postMessage({ id, kind: "ENCODE_CHUNK", chunk: value.slice(start, end), final: end === value.length });
      if (end < value.length) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    return await result;
  } catch (error) {
    const waiter = pending.get(id);
    if (waiter) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    pending.delete(id);
    if (!unavailable && !(error instanceof DOMException && error.name === "DataCloneError")) throw error;
    if (!unavailable) disableWorker();
    return encodeStoredStringCore(value);
  }
}

export const decodeStoredStringInWorker = (value: string): Promise<string> => run({ kind: "DECODE_STORED_STRING", value });
