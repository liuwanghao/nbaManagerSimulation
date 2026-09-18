import { ColorboxStorageAdapter, IndexedDbStorageAdapter, LocalStorageAdapter, type StorageAdapter } from "./storage/StorageAdapter";

export interface PlatformUser {
  id: string;
  nickname: string;
  avatarUrl?: string;
  authenticated: boolean;
}

export interface PlatformAdapter {
  storage: StorageAdapter;
  cloudStorage?: StorageAdapter;
  getCurrentUser(): Promise<PlatformUser>;
  share(payload: { title: string; text: string; imageUrl?: string }): Promise<"UNAVAILABLE" | "OPENED">;
  track(event: string, properties?: Record<string, string | number | boolean>): Promise<void>;
  close(): Promise<void>;
}

export function createBrowserPlatform(): PlatformAdapter {
  const colorboxStorage = window.ColorboxAI?.storage;
  return {
    storage: colorboxStorage ? new IndexedDbStorageAdapter() : new LocalStorageAdapter(),
    cloudStorage: colorboxStorage ? new ColorboxStorageAdapter(colorboxStorage) : undefined,
    async getCurrentUser() {
      return { id: "anonymous", nickname: "访客经理", authenticated: false };
    },
    async share() {
      return "UNAVAILABLE";
    },
    async track() {
      return Promise.resolve();
    },
    async close() {
      return Promise.resolve();
    },
  };
}
