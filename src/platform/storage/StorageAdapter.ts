import { decodeStoredStringInWorker, encodeStoredStringInWorker, validateStoredStringEncoding } from "../../storage/SaveCodec";

export interface StorageAdapter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

/** Internal save path: values retain their raw:/gz: encoding or legacy plain bytes. */
export interface EncodedStorageAdapter extends StorageAdapter {
  getEncoded(key: string): Promise<string | null>;
  setEncoded(key: string, value: string): Promise<void>;
}

export function hasEncodedStorage(adapter: StorageAdapter): adapter is EncodedStorageAdapter {
  const candidate = adapter as Partial<EncodedStorageAdapter>;
  return typeof candidate.getEncoded === "function" && typeof candidate.setEncoded === "function";
}

export const encodeStoredString = encodeStoredStringInWorker;
export const decodeStoredString = decodeStoredStringInWorker;

export class LocalStorageAdapter implements StorageAdapter {
  // Only anonymous career saves and checkpoints are stored locally; no phone number or account identifiers.
  async get(key: string): Promise<string | null> {
    const value = await this.getEncoded(key);
    return value === null ? null : decodeStoredString(value);
  }

  async set(key: string, value: string): Promise<void> {
    await this.setEncoded(key, await encodeStoredString(value));
  }

  async getEncoded(key: string): Promise<string | null> {
    return window.localStorage.getItem(key);
  }

  async setEncoded(key: string, value: string): Promise<void> {
    window.localStorage.setItem(key, value);
  }

  async remove(key: string): Promise<void> {
    window.localStorage.removeItem(key);
  }
}

const INDEXED_DB_TIMEOUT_MS = 10_000;

export class IndexedDbStorageAdapter implements StorageAdapter {
  private database: Promise<IDBDatabase> | undefined;

  constructor(private readonly databaseName = "basketball-franchise-manager", private readonly storeName = "career-saves") {}

  private getDatabase(): Promise<IDBDatabase> {
    if (this.database) return this.database;
    const opening = new Promise<IDBDatabase>((resolve, reject) => {
      const request = window.indexedDB.open(this.databaseName, 1);
      let settled = false;
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      };
      const timer = setTimeout(() => fail(new Error("INDEXED_DB_OPEN_TIMEOUT")), INDEXED_DB_TIMEOUT_MS);
      request.onupgradeneeded = () => {
        if (settled) { request.transaction?.abort(); return; }
        if (!request.result.objectStoreNames.contains(this.storeName)) request.result.createObjectStore(this.storeName);
      };
      request.onsuccess = () => {
        if (settled) { request.result.close(); return; }
        settled = true;
        clearTimeout(timer);
        const database = request.result;
        database.onclose = () => { if (this.database === opening) this.database = undefined; };
        database.onversionchange = () => {
          database.close();
          if (this.database === opening) this.database = undefined;
        };
        resolve(database);
      };
      request.onerror = () => fail(request.error ?? new Error("INDEXED_DB_OPEN_FAILED"));
      request.onblocked = () => fail(new Error("INDEXED_DB_OPEN_BLOCKED"));
    });
    this.database = opening;
    void opening.catch(() => { if (this.database === opening) this.database = undefined; });
    return opening;
  }

  private async transaction<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const connection = this.getDatabase();
    const database = await connection;
    return new Promise((resolve, reject) => {
      let transaction: IDBTransaction;
      try { transaction = database.transaction(this.storeName, mode); }
      catch (error) {
        if (error instanceof DOMException && error.name === "InvalidStateError") {
          database.close();
          if (this.database === connection) this.database = undefined;
        }
        reject(error);
        return;
      }
      let settled = false;
      const fail = (error: unknown, abort = false) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (abort) {
          try { transaction.abort(); } catch { /* Already inactive; the rejection still releases the save queue. */ }
        }
        reject(error);
      };
      const timer = setTimeout(() => fail(new Error("INDEXED_DB_TRANSACTION_TIMEOUT"), true), INDEXED_DB_TIMEOUT_MS);
      let request: IDBRequest<T>;
      transaction.oncomplete = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(request.result);
      };
      transaction.onerror = () => fail(transaction.error ?? new Error("INDEXED_DB_TRANSACTION_FAILED"));
      transaction.onabort = () => fail(transaction.error ?? new Error("INDEXED_DB_TRANSACTION_ABORTED"));
      try { request = operation(transaction.objectStore(this.storeName)); }
      catch (error) { fail(error, true); }
    });
  }

  async get(key: string): Promise<string | null> {
    const value = await this.getEncoded(key);
    return value === null ? null : decodeStoredString(value);
  }

  async set(key: string, value: string): Promise<void> {
    await this.setEncoded(key, await encodeStoredString(value));
  }

  async getEncoded(key: string): Promise<string | null> {
    return await this.transaction<string | undefined>("readonly", (store) => store.get(key)) ?? null;
  }

  async setEncoded(key: string, value: string): Promise<void> {
    await this.transaction<IDBValidKey>("readwrite", (store) => store.put(value, key));
  }

  async setIfAbsent(key: string, value: string): Promise<boolean> {
    return this.setEncodedIfAbsent(key, await encodeStoredString(value));
  }

  async setEncodedIfAbsent(key: string, value: string): Promise<boolean> {
    try {
      await this.transaction<IDBValidKey>("readwrite", (store) => store.add(value, key));
      return true;
    } catch (error) {
      if (error instanceof DOMException && error.name === "ConstraintError") return false;
      throw error;
    }
  }

  async remove(key: string): Promise<void> {
    await this.transaction<undefined>("readwrite", (store) => store.delete(key));
  }
}

/** Copies older localStorage entries into IndexedDB as they are accessed. */
export class MigratingIndexedDbStorageAdapter implements StorageAdapter {
  readonly getEncoded?: (key: string) => Promise<string | null>;
  readonly setEncoded?: (key: string, value: string) => Promise<void>;

  constructor(
    private readonly current: StorageAdapter & {
      setIfAbsent?(key: string, value: string): Promise<boolean>;
      setEncodedIfAbsent?(key: string, value: string): Promise<boolean>;
    } = new IndexedDbStorageAdapter(),
    private readonly legacy: StorageAdapter = new LocalStorageAdapter(),
  ) {
    // Custom injected stores keep their decoded path. Migration must have an
    // atomic encoded insert so a concurrent writer is never replaced.
    const setEncodedIfAbsent = current.setEncodedIfAbsent;
    if (hasEncodedStorage(current) && hasEncodedStorage(legacy) && typeof setEncodedIfAbsent === "function") {
      const insert = setEncodedIfAbsent.bind(current);
      this.getEncoded = async (key) => {
        const value = await current.getEncoded(key);
        if (value !== null) return value;
        const old = await legacy.getEncoded(key);
        if (old === null) return null;
        await validateStoredStringEncoding(old);
        await insert(key, old);
        const migrated = await current.getEncoded(key);
        if (migrated === null) throw new Error("SAVE_MIGRATION_VERIFICATION_FAILED");
        // The atomic insert may have lost to another writer; verify its actual
        // winning bytes before removing the original legacy copy.
        await validateStoredStringEncoding(migrated);
        await legacy.remove(key);
        return migrated;
      };
      this.setEncoded = async (key, value) => {
        await current.setEncoded(key, value);
        await legacy.remove(key);
      };
    }
  }

  async get(key: string): Promise<string | null> {
    const value = await this.current.get(key);
    if (value !== null) return value;
    const legacyValue = await this.legacy.get(key);
    if (legacyValue === null) return null;
    if (this.current.setIfAbsent) await this.current.setIfAbsent(key, legacyValue);
    else await this.current.set(key, legacyValue);
    const migrated = await this.current.get(key);
    if (migrated === null) throw new Error("SAVE_MIGRATION_VERIFICATION_FAILED");
    await this.legacy.remove(key);
    return migrated;
  }

  async set(key: string, value: string): Promise<void> {
    await this.current.set(key, value);
    await this.legacy.remove(key);
  }

  async remove(key: string): Promise<void> {
    await this.legacy.remove(key);
    await this.current.remove(key);
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
