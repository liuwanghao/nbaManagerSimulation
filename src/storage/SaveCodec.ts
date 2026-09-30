import SaveCodecWorker from "./SaveCodec.worker?worker&inline";
import { stableHash, stableSerialize } from "../game/random/hash";
import { decodeStoredStringCore, encodeStoredStringCore } from "../platform/storage/StoredStringCodec";
import type { SaveEnvelope } from "./SaveService";

type Request =
  | { id: number; kind: "HASH"; value: unknown }
  | { id: number; kind: "STRINGIFY"; value: unknown }
  | { id: number; kind: "SERIALIZE_ENVELOPE"; value: SaveEnvelope }
  | { id: number; kind: "PARSE_ENVELOPE"; value: string | null; expectedSlotId?: number }
  | { id: number; kind: "ENCODE_STORED_STRING" | "DECODE_STORED_STRING"; value: string };

type Response = { id: number; result?: unknown; error?: string };
type RequestInput<T> = T extends { id: number } ? Omit<T, "id"> : never;

let worker: Worker | null = null;
let unavailable = false;
let nextId = 1;
const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();

function parseEnvelope(serialized: string | null, expectedSlotId?: number): SaveEnvelope | null {
  if (!serialized) return null;
  try {
    const envelope = JSON.parse(serialized) as SaveEnvelope;
    if (!envelope.saveId) envelope.saveId = stableHash(envelope.careerSeed, "save", expectedSlotId ?? envelope.slotId);
    return stableHash(stableSerialize(envelope.state)) === envelope.stateHash ? envelope : null;
  } catch {
    return null;
  }
}

function runLocally(request: Request): unknown {
  switch (request.kind) {
    case "HASH": return stableHash(stableSerialize(request.value));
    case "STRINGIFY": return JSON.stringify(request.value);
    case "SERIALIZE_ENVELOPE": {
      const stateHash = stableHash(stableSerialize(request.value.state));
      return { stateHash, serialized: JSON.stringify({ ...request.value, stateHash }) };
    }
    case "PARSE_ENVELOPE": return parseEnvelope(request.value, request.expectedSlotId);
    case "ENCODE_STORED_STRING": return encodeStoredStringCore(request.value);
    case "DECODE_STORED_STRING": return decodeStoredStringCore(request.value);
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
      if (message.error) waiter.reject(new Error(message.error));
      else waiter.resolve(message.result);
    };
    const fail = () => {
      unavailable = true;
      worker?.terminate();
      worker = null;
      for (const waiter of pending.values()) waiter.reject(new Error("SAVE_CODEC_WORKER_FAILED"));
      pending.clear();
    };
    worker.onerror = fail;
    worker.onmessageerror = fail;
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
  return new Promise<T>((resolve, reject) => {
    pending.set(request.id, { resolve: resolve as (value: unknown) => void, reject });
    try { activeWorker.postMessage(request); }
    catch (error) { pending.delete(request.id); reject(error); }
  }).catch((error: unknown) => {
    if (!unavailable && !(error instanceof DOMException && error.name === "DataCloneError")) throw error;
    unavailable = true;
    worker?.terminate();
    worker = null;
    return runLocally(request) as T;
  });
}

export const hashSaveState = (value: unknown): Promise<string> => run({ kind: "HASH", value });
export const stringifySaveValue = (value: unknown): Promise<string> => run({ kind: "STRINGIFY", value });
export const serializeSaveEnvelope = (value: SaveEnvelope): Promise<{ stateHash: string; serialized: string }> => run({ kind: "SERIALIZE_ENVELOPE", value });
export const parseValidSaveEnvelope = (value: string | null, expectedSlotId?: number): Promise<SaveEnvelope | null> => run({ kind: "PARSE_ENVELOPE", value, expectedSlotId });

export async function encodeStoredStringInWorker(value: string): Promise<string> {
  if (value.length <= 512_000) return run({ kind: "ENCODE_STORED_STRING", value });
  const activeWorker = getWorker();
  if (!activeWorker) return encodeStoredStringCore(value);
  const id = nextId++;
  const result = new Promise<string>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (result: unknown) => void, reject });
  });
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
    pending.delete(id);
    if (!unavailable && !(error instanceof DOMException && error.name === "DataCloneError")) throw error;
    unavailable = true;
    worker?.terminate();
    worker = null;
    return encodeStoredStringCore(value);
  }
}

export const decodeStoredStringInWorker = (value: string): Promise<string> => run({ kind: "DECODE_STORED_STRING", value });
