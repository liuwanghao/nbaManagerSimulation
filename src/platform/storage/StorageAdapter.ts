export interface StorageAdapter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (let start = 0; start < bytes.length; start += 32_768) binary += String.fromCharCode(...bytes.subarray(start, start + 32_768));
  return btoa(binary);
};

const base64ToBytes = (value: string): Uint8Array => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
};

export async function encodeStoredString(value: string): Promise<string> {
  if (value.length < 1_024 || typeof CompressionStream === "undefined") return `raw:${value}`;
  const stream = new Blob([value]).stream().pipeThrough(new CompressionStream("gzip"));
  const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
  return `gz:${bytesToBase64(compressed)}`;
}

export async function decodeStoredString(value: string): Promise<string> {
  if (value.startsWith("raw:")) return value.slice(4);
  if (!value.startsWith("gz:")) return value;
  if (typeof DecompressionStream === "undefined") throw new Error("GZIP_STORAGE_UNSUPPORTED");
  const compressed = base64ToBytes(value.slice(3));
  const stream = new Blob([compressed.slice().buffer as ArrayBuffer]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

export class LocalStorageAdapter implements StorageAdapter {
  async get(key: string): Promise<string | null> {
    const value = window.localStorage.getItem(key);
    return value === null ? null : decodeStoredString(value);
  }

  async set(key: string, value: string): Promise<void> {
    window.localStorage.setItem(key, await encodeStoredString(value));
  }

  async remove(key: string): Promise<void> {
    window.localStorage.removeItem(key);
  }
}

export class IndexedDbStorageAdapter implements StorageAdapter {
  private readonly database: Promise<IDBDatabase>;

  constructor(databaseName = "basketball-franchise-manager", private readonly storeName = "career-saves") {
    this.database = new Promise((resolve, reject) => {
      const request = window.indexedDB.open(databaseName, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(this.storeName)) request.result.createObjectStore(this.storeName);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("INDEXED_DB_OPEN_FAILED"));
    });
  }

  private async transaction<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const database = await this.database;
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(this.storeName, mode);
      const request = operation(transaction.objectStore(this.storeName));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("INDEXED_DB_OPERATION_FAILED"));
      transaction.onerror = () => reject(transaction.error ?? new Error("INDEXED_DB_TRANSACTION_FAILED"));
    });
  }

  async get(key: string): Promise<string | null> {
    const value = await this.transaction<string | undefined>("readonly", (store) => store.get(key));
    return value === undefined ? null : decodeStoredString(value);
  }

  async set(key: string, value: string): Promise<void> {
    const encoded = await encodeStoredString(value);
    await this.transaction<IDBValidKey>("readwrite", (store) => store.put(encoded, key));
  }

  async remove(key: string): Promise<void> {
    await this.transaction<undefined>("readwrite", (store) => store.delete(key));
  }
}

export class MemoryStorageAdapter implements StorageAdapter {
  private readonly values = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  async remove(key: string): Promise<void> {
    this.values.delete(key);
  }
}

interface ColorboxStorageRuntime {
  getValue(key?: string): Promise<unknown>;
  setValue(data: Record<string, unknown>): Promise<{ ok: boolean }>;
}

interface ChunkManifest {
  version: number;
  chunkKeys: string[];
}

const COLORBOX_CHUNK_CHARACTERS = 150_000;
const COLORBOX_CHUNK_BYTES = 180_000;

export class ColorboxStorageAdapter implements StorageAdapter {
  constructor(private readonly runtime: ColorboxStorageRuntime) {}

  private manifestKey(key: string): string { return `nba-manager:${key}:manifest`; }

  async get(key: string): Promise<string | null> {
    const rawManifest = await this.runtime.getValue(this.manifestKey(key));
    if (!rawManifest || typeof rawManifest !== "object") return null;
    const manifest = rawManifest as ChunkManifest;
    if (!Array.isArray(manifest.chunkKeys)) return null;
    const chunks = await Promise.all(manifest.chunkKeys.map((chunkKey) => this.runtime.getValue(chunkKey)));
    if (chunks.some((chunk) => typeof chunk !== "string")) return null;
    return decodeStoredString(chunks.join(""));
  }

  async set(key: string, value: string): Promise<void> {
    const prior = await this.runtime.getValue(this.manifestKey(key));
    const priorManifest = prior && typeof prior === "object" ? prior as ChunkManifest : undefined;
    const version = (priorManifest?.version ?? 0) + 1;
    const encodedValue = await encodeStoredString(value);
    const chunks: string[] = [];
    for (let cursor = 0; cursor < encodedValue.length;) {
      let end = Math.min(encodedValue.length, cursor + COLORBOX_CHUNK_CHARACTERS);
      let candidate = encodedValue.slice(cursor, end);
      let bytes = new TextEncoder().encode(candidate).byteLength;
      while (bytes > COLORBOX_CHUNK_BYTES) {
        end = cursor + Math.max(1, Math.floor((end - cursor) * COLORBOX_CHUNK_BYTES / bytes * 0.98));
        candidate = encodedValue.slice(cursor, end);
        bytes = new TextEncoder().encode(candidate).byteLength;
      }
      if (end < encodedValue.length && /[\uD800-\uDBFF]/u.test(encodedValue[end - 1])) end -= 1;
      chunks.push(encodedValue.slice(cursor, end));
      cursor = end;
    }
    const chunkKeys = chunks.map((_, index) => `nba-manager:${key}:v${version}:c${index}`);
    for (let index = 0; index < chunks.length; index += 1) {
      const response = await this.runtime.setValue({ [chunkKeys[index]]: chunks[index] });
      if (!response.ok) throw new Error("COLORBOX_STORAGE_WRITE_FAILED");
    }
    const manifestResponse = await this.runtime.setValue({ [this.manifestKey(key)]: { version, chunkKeys } });
    if (!manifestResponse.ok) throw new Error("COLORBOX_STORAGE_MANIFEST_FAILED");
    for (const oldKey of priorManifest?.chunkKeys ?? []) if (!chunkKeys.includes(oldKey)) await this.runtime.setValue({ [oldKey]: null });
  }

  async remove(key: string): Promise<void> {
    const prior = await this.runtime.getValue(this.manifestKey(key));
    const manifest = prior && typeof prior === "object" ? prior as ChunkManifest : undefined;
    for (const chunkKey of manifest?.chunkKeys ?? []) await this.runtime.setValue({ [chunkKey]: null });
    const response = await this.runtime.setValue({ [this.manifestKey(key)]: null });
    if (!response.ok) throw new Error("COLORBOX_STORAGE_REMOVE_FAILED");
  }
}
