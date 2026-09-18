import { describe, expect, it } from "vitest";
import { createCareer, simulateNextGameDay } from "../game/season/career";
import { MemoryStorageAdapter } from "../platform/storage/StorageAdapter";
import type { StorageAdapter } from "../platform/storage/StorageAdapter";
import { SaveService } from "./SaveService";

describe("SaveService", () => {
  it("round-trips an atomic career slot without changing state", async () => {
    const service = new SaveService(new MemoryStorageAdapter());
    const state = simulateNextGameDay(createCareer("save-test"));
    const envelope = await service.save(1, state);
    expect(envelope.revision).toBe(1);
    expect(await service.load(1)).toEqual(state);
    const next = await service.save(1, state);
    expect(next.revision).toBe(2);
    expect(next.parentRevision).toBe(1);
  });

  it("saves and restores a verified expansion checkpoint", async () => {
    const service = new SaveService(new MemoryStorageAdapter());
    const state = createCareer("checkpoint-test");
    await service.saveCheckpoint(1, "pre-expansion-draft", state);
    expect(await service.loadCheckpoint(1, "pre-expansion-draft")).toEqual(state);
  });

  it("keeps three career slots independent", async () => {
    const service = new SaveService(new MemoryStorageAdapter());
    await service.save(1, createCareer("slot-one"));
    await service.save(2, createCareer("slot-two"));
    await service.save(3, createCareer("slot-three"));
    expect((await service.load(1))?.seeds.careerSeed).toBe("slot-one");
    expect((await service.load(2))?.seeds.careerSeed).toBe("slot-two");
    expect((await service.load(3))?.seeds.careerSeed).toBe("slot-three");
  });

  it("keeps sync_base_revision stable across offline saves and safely fast-forwards", async () => {
    const localAdapter = new MemoryStorageAdapter();
    const cloudAdapter = new MemoryStorageAdapter();
    const service = new SaveService(localAdapter);
    const state = createCareer("offline-branch");
    await service.save(1, state);
    expect((await service.syncWithCloud(1, cloudAdapter))?.status).toBe("PUSHED_LOCAL");
    const revision2 = await service.save(1, simulateNextGameDay(state));
    const revision3 = await service.save(1, simulateNextGameDay(simulateNextGameDay(state)));
    expect(revision2.syncBaseRevision).toBe(1);
    expect(revision3.syncBaseRevision).toBe(1);
    const result = await service.syncWithCloud(1, cloudAdapter);
    expect(result?.status).toBe("PUSHED_LOCAL");
    expect(result?.local.syncBaseRevision).toBe(3);
    expect(result?.local.pendingSync).toBe(false);
  });

  it("detects two-sided changes, never auto-merges, and backs up before choosing cloud", async () => {
    const localAdapter = new MemoryStorageAdapter();
    const cloudAdapter = new MemoryStorageAdapter();
    const localService = new SaveService(localAdapter);
    const cloudService = new SaveService(cloudAdapter);
    const base = createCareer("save-conflict");
    await localService.save(1, base);
    await localService.syncWithCloud(1, cloudAdapter);
    const localState = simulateNextGameDay(base);
    const cloudState = structuredClone(base);
    cloudState.teams.SEA.fanSupport += 2;
    await localService.save(1, localState);
    await cloudService.save(1, cloudState);
    expect((await localService.syncWithCloud(1, cloudAdapter))?.status).toBe("SAVE_CONFLICT");
    await localService.resolveConflict(1, cloudAdapter, "CLOUD");
    expect((await localService.load(1))?.teams.SEA.fanSupport).toBe(cloudState.teams.SEA.fanSupport);
    expect((await localService.loadConflictBackup(1))?.lightweightResults.length).toBe(localState.lightweightResults.length);
  });

  it("does not report a conflict when state hashes are equal", async () => {
    const localAdapter = new MemoryStorageAdapter();
    const cloudAdapter = new MemoryStorageAdapter();
    const service = new SaveService(localAdapter);
    const state = createCareer("same-content");
    await service.save(1, state);
    await service.syncWithCloud(1, cloudAdapter);
    await service.save(1, state);
    expect((await service.syncWithCloud(1, cloudAdapter))?.status).toBe("IN_SYNC");
  });

  it("keeps only the three newest checkpoints and reports total slot bytes", async () => {
    const service = new SaveService(new MemoryStorageAdapter());
    const state = createCareer("checkpoint-cap");
    await service.save(1, state);
    for (const id of ["one", "two", "three", "four"]) await service.saveCheckpoint(1, id, state);
    expect(await service.loadCheckpoint(1, "one")).toBeNull();
    expect(await service.loadCheckpoint(1, "four")).not.toBeNull();
    expect(await service.getSlotUsageBytes(1)).toBeGreaterThan(0);
  });

  it("recovers a corrupted primary revision from a verified pending write", async () => {
    const adapter = new MemoryStorageAdapter();
    const service = new SaveService(adapter);
    const state = createCareer("recover-primary");
    await service.save(1, state);
    const primaryKey = "basketball-manager:career:1";
    const pendingKey = `${primaryKey}:pending`;
    const valid = await adapter.get(primaryKey) as string;
    const corrupt = JSON.parse(valid) as { state: { userTeamId: string } };
    corrupt.state.userTeamId = "CORRUPTED";
    await adapter.set(primaryKey, JSON.stringify(corrupt));
    await adapter.set(pendingKey, valid);
    expect((await service.load(1))?.userTeamId).toBe(state.userTeamId);
    expect(await adapter.get(pendingKey)).toBeNull();
  });

  it("migrates legacy placeholder players into complete deterministic profiles", async () => {
    const service = new SaveService(new MemoryStorageAdapter());
    const legacy = createCareer("legacy-player-profile");
    const player = Object.values(legacy.players).sort((left, right) => left.id.localeCompare(right.id))[0];
    player.name = "ATL Player 1";
    const legacyPlayer = player as unknown as Record<string, unknown>;
    for (const key of [
      "heightCm", "weightKg", "secondaryPosition", "birthDate", "ageAtSnapshot", "ageSource",
      "serviceYears", "injuryRating", "personality", "marketPreference", "profileSource",
    ]) delete legacyPlayer[key];
    legacy.meta.schemaVersion = 2;

    await service.save(1, legacy);
    const migrated = await service.load(1);
    const migratedPlayer = migrated?.players[player.id];

    expect(migrated?.meta.schemaVersion).toBe(17);
    expect(migrated?.history.rebornHistoricalSourceIds).toEqual([]);
    expect(migratedPlayer?.name).not.toMatch(/ Player \d+$/u);
    expect(migratedPlayer?.heightCm).toBeGreaterThanOrEqual(183);
    expect(migratedPlayer?.birthDate).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    expect(migratedPlayer?.profileSource).toBe("FICTIONAL_FIXTURE");
  });

  it("rejects a parseable temporary write whose state content was corrupted", async () => {
    class CorruptingAdapter implements StorageAdapter {
      private readonly values = new Map<string, string>();
      async get(key: string): Promise<string | null> { return this.values.get(key) ?? null; }
      async set(key: string, value: string): Promise<void> {
        if (key.endsWith(":pending")) {
          const parsed = JSON.parse(value) as { state: { userTeamId: string } };
          parsed.state.userTeamId = "CORRUPTED";
          this.values.set(key, JSON.stringify(parsed));
          return;
        }
        this.values.set(key, value);
      }
      async remove(key: string): Promise<void> { this.values.delete(key); }
    }
    const service = new SaveService(new CorruptingAdapter());
    await expect(service.save(1, createCareer("corrupt-temp-test"))).rejects.toThrow(/verification failed/);
  });

  it("merges missing seven-year draft inventory without overwriting existing ownership", async () => {
    const service = new SaveService(new MemoryStorageAdapter());
    const legacy = createCareer("legacy-picks");
    legacy.draftPicks["2027-R1-ATL"].ownerTeamId = "BOS";
    for (const pickId of Object.keys(legacy.draftPicks)) if (legacy.draftPicks[pickId].year >= 2032) delete legacy.draftPicks[pickId];
    await service.save(1, legacy);
    const migrated = await service.load(1);
    expect(migrated?.draftPicks["2027-R1-ATL"].ownerTeamId).toBe("BOS");
    expect(migrated?.draftPicks["2033-R2-SEA"].ownerTeamId).toBe("SEA");
  });
});
