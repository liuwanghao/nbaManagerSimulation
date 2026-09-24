import { describe, expect, it } from "vitest";
import { createCareer, simulateNextGameDay } from "../game/season/career";
import { calculateMarketPreference } from "../game/player/MarketPreferenceService";
import { addTeamNotification, executeTeamNotificationCommand } from "../game/notifications/TeamNotificationService";
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

  it("restores read and unread team notifications and initializes older saves", async () => {
    const service = new SaveService(new MemoryStorageAdapter());
    const state = createCareer("team-notification-save");
    addTeamNotification(state, { id: "fa-result", category: "FREE_AGENCY", seasonId: state.league.seasonId, title: "签约成功", message: "合同已生效。" });
    await service.save(1, state);
    expect((await service.load(1))?.teamNotifications).toEqual([expect.objectContaining({ id: "fa-result", read: false })]);
    const read = executeTeamNotificationCommand(state, { commandId: "read-fa-result", type: "MARK_TEAM_NOTIFICATIONS_READ", payload: { ids: ["fa-result"] } });
    await service.save(1, read);
    expect((await service.load(1))?.teamNotifications?.[0].read).toBe(true);
    delete read.teamNotifications;
    await service.save(2, read);
    expect((await service.load(2))?.teamNotifications).toEqual([]);
  });

  it.each([
    ["nba:201566", "Russell Westbrook"],
    ["nba:201587", "Nicolas Batum"],
  ])("removes unsigned retiree %s from an older bundled save", async (playerId, playerName) => {
    const service = new SaveService(new MemoryStorageAdapter());
    const state = createCareer("retired-free-agent-save");
    state.meta.dataVersion = "bundled.2026-before-retirement-correction";
    state.players[playerId] = {
      ...structuredClone(Object.values(state.players)[0]),
      id: playerId,
      name: playerName,
      teamId: "FREE_AGENT",
      contract: {
        salary: 0,
        yearsRemaining: 0,
        guaranteedAmount: 0,
        status: "UFA",
        optionType: "NONE",
        optionDecision: "NOT_APPLICABLE",
      },
    };
    await service.save(1, state);
    const loaded = await service.load(1);
    expect(loaded?.players[playerId]).toBeUndefined();
    expect(loaded?.history.retiredPlayerIds).toContain(playerId);
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

  it("uses the physical storage slot when stored metadata names another slot", async () => {
    const adapter = new MemoryStorageAdapter();
    const service = new SaveService(adapter);
    await service.save(2, createCareer("slot-two-metadata-repair"));
    const key = "basketball-manager:career:2";
    const misplaced = JSON.parse(await adapter.get(key) as string) as { slotId: number };
    misplaced.slotId = 3;
    await adapter.set(key, JSON.stringify(misplaced));

    expect(await service.listSlotSummaries()).toEqual([
      expect.objectContaining({ slotId: 2 }),
    ]);
    expect(JSON.parse(await adapter.get(key) as string)).toEqual(expect.objectContaining({ slotId: 2 }));
    expect((await service.load(2))?.seeds.careerSeed).toBe("slot-two-metadata-repair");
    expect(await service.load(3)).toBeNull();
  });

  it("repairs slot metadata while recovering a newer pending write", async () => {
    const adapter = new MemoryStorageAdapter();
    const service = new SaveService(adapter);
    await service.save(2, createCareer("pending-slot-repair"));
    const key = "basketball-manager:career:2";
    const pendingKey = `${key}:pending`;
    const pending = JSON.parse(await adapter.get(key) as string) as { slotId: number; revision: number };
    pending.slotId = 3;
    pending.revision += 1;
    await adapter.set(pendingKey, JSON.stringify(pending));

    expect((await service.load(2))?.seeds.careerSeed).toBe("pending-slot-repair");
    expect(JSON.parse(await adapter.get(key) as string)).toEqual(expect.objectContaining({ slotId: 2, revision: 2 }));
    expect(await adapter.get(pendingKey)).toBeNull();
  });

  it("repairs slot metadata while restoring the previous valid revision", async () => {
    const adapter = new MemoryStorageAdapter();
    const service = new SaveService(adapter);
    await service.save(2, createCareer("previous-slot-repair"));
    const key = "basketball-manager:career:2";
    const previousKey = `${key}:previous-valid`;
    const valid = JSON.parse(await adapter.get(key) as string) as { slotId: number; state: { userTeamId: string } };
    valid.slotId = 3;
    await adapter.set(previousKey, JSON.stringify(valid));
    const corrupt = structuredClone(valid);
    corrupt.state.userTeamId = "CORRUPTED";
    await adapter.set(key, JSON.stringify(corrupt));

    expect((await service.load(2))?.seeds.careerSeed).toBe("previous-slot-repair");
    expect(JSON.parse(await adapter.get(key) as string)).toEqual(expect.objectContaining({ slotId: 2 }));
  });

  it("normalizes cloud slot metadata before pulling it into a local slot", async () => {
    const cloudAdapter = new MemoryStorageAdapter();
    const cloudService = new SaveService(cloudAdapter);
    await cloudService.save(2, createCareer("cloud-slot-repair"));
    const key = "basketball-manager:career:2";
    const cloudEnvelope = JSON.parse(await cloudAdapter.get(key) as string) as { slotId: number };
    cloudEnvelope.slotId = 3;
    await cloudAdapter.set(key, JSON.stringify(cloudEnvelope));

    const localAdapter = new MemoryStorageAdapter();
    const localService = new SaveService(localAdapter);
    const result = await localService.syncWithCloud(2, cloudAdapter);

    expect(result).toEqual(expect.objectContaining({ status: "PULLED_CLOUD", local: expect.objectContaining({ slotId: 2 }) }));
    expect(JSON.parse(await localAdapter.get(key) as string)).toEqual(expect.objectContaining({ slotId: 2 }));
    expect(JSON.parse(await cloudAdapter.get(key) as string)).toEqual(expect.objectContaining({ slotId: 2 }));
  });

  it("lists recognizable slot details and resumes the most recently saved career", async () => {
    const service = new SaveService(new MemoryStorageAdapter());
    const first = createCareer("summary-one");
    first.teams[first.userTeamId].fullName = "西雅图海潮";
    await service.save(1, first);
    const latest = simulateNextGameDay(createCareer("summary-two"));
    latest.teams[latest.userTeamId].fullName = "拉斯维加斯王牌";
    await service.save(2, latest);

    expect(await service.listSlotSummaries()).toEqual(expect.arrayContaining([
      expect.objectContaining({ slotId: 1, teamName: "西雅图海潮", seasonId: first.league.seasonId, wins: 0, losses: 0 }),
      expect.objectContaining({ slotId: 2, teamName: "拉斯维加斯王牌", seasonId: latest.league.seasonId, currentDate: expect.any(String) }),
    ]));
    expect((await service.loadMostRecent())?.slotId).toBe(2);
    expect((await service.loadMostRecent())?.state.seeds.careerSeed).toBe("summary-two");
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
    expect(migratedPlayer?.marketPreference).toBe(calculateMarketPreference(migratedPlayer!.personality, migratedPlayer!.ageAtSnapshot));
  });

  it("corrects Taj Gibson's randomized opening service years once in an older bundled save", async () => {
    const service = new SaveService(new MemoryStorageAdapter());
    const legacy = createCareer("legacy-real-service-years");
    legacy.meta.dataVersion = "bundled.before-service-years";
    const taj = structuredClone(Object.values(legacy.players)[0]);
    taj.id = "nba:201959";
    taj.name = "Taj Gibson";
    taj.teamId = "FREE_AGENT";
    taj.profileSource = "CURATED_DATASET";
    taj.age = 41;
    taj.ageAtSnapshot = 41;
    taj.serviceYears = 5;
    taj.contract.status = "UFA";
    legacy.players[taj.id] = taj;

    await service.save(1, legacy);
    const migrated = await service.load(1);
    expect(migrated?.players[taj.id].serviceYears).toBe(17);
    expect(migrated?.players[taj.id].serviceYearsSource).toBe("DOCUMENTED_DEBUT");
    expect(migrated?.meta.dataVersion).toContain("+service.2026.v2");

    if (!migrated) throw new Error("Legacy save did not load");
    migrated.players[taj.id].serviceYears = 18;
    await service.save(1, migrated);
    expect((await service.load(1))?.players[taj.id].serviceYears).toBe(18);
  });

  it("replaces first-pass NBA experience values and preserves service earned in the save", async () => {
    const service = new SaveService(new MemoryStorageAdapter());
    const state = createCareer("verified-service-years-migration");
    state.meta.dataVersion = "bundled.test+service.2026.v1";
    state.league.seasonYear = 2027;
    const template = Object.values(state.players)[0];
    state.players["nba:1630166"] = {
      ...structuredClone(template), id: "nba:1630166", profileSource: "CURATED_DATASET",
      ageAtSnapshot: 25, serviceYears: 6, serviceYearsSource: "NBA_OFFICIAL_PROFILE",
    };
    state.players["nba:1641739"] = {
      ...structuredClone(template), id: "nba:1641739", profileSource: "CURATED_DATASET",
      ageAtSnapshot: 26, serviceYears: 7, serviceYearsSource: "AGE_ESTIMATE",
    };
    state.players["nba:201145"] = {
      ...structuredClone(template), id: "nba:201145", profileSource: "CURATED_DATASET",
      ageAtSnapshot: 40, serviceYears: 20, serviceYearsSource: "NBA_OFFICIAL_PROFILE",
    };

    await service.save(1, state);
    const migrated = await service.load(1);
    expect(migrated?.players["nba:1630166"]).toMatchObject({ serviceYears: 7, serviceYearsSource: "NBA_OFFICIAL_PROFILE" });
    expect(migrated?.players["nba:1641739"]).toMatchObject({ serviceYears: 4, serviceYearsSource: "NBA_OFFICIAL_PROFILE" });
    expect(migrated?.players["nba:201145"]).toMatchObject({ serviceYears: 20, serviceYearsSource: "NBA_OFFICIAL_PROFILE" });
    expect(migrated?.meta.dataVersion).toContain("+service.2026.v2");
  });

  it("recalculates legacy random market preference when loading a career", async () => {
    const service = new SaveService(new MemoryStorageAdapter());
    const state = createCareer("legacy-market-preference");
    const player = Object.values(state.players)[0];
    player.marketPreference = 0;
    state.teams.LAL.marketRating = 56;
    await service.save(1, state);
    const loaded = await service.load(1);
    expect(loaded?.players[player.id].marketPreference).toBe(calculateMarketPreference(player.personality, player.ageAtSnapshot));
    expect(loaded?.teams.LAL.marketRating).toBe(100);
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
