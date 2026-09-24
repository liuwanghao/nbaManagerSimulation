import { stableHash, stableSerialize } from "../game/random/hash";
import { createFutureDraftPicks } from "../data/draftPicks";
import { TEAM_DEFINITIONS } from "../data/league";
import retiredPlayers from "../data/nba-retired-players.json";
import { createFictionalPlayerProfile } from "../data/playerProfiles";
import { firstPassOpeningNbaServiceYears, openingNbaServiceYears } from "../data/nbaServiceYears";
import { GAME_CONFIG } from "../config/gameConfig";
import { calculateMarketPreference } from "../game/player/MarketPreferenceService";
import { emptyPlayerSeasonStats, type GameState } from "../game/state/types";
import { createAchievementState, createGmCareerState } from "../game/career/AchievementService";
import { createEventState } from "../game/events/EventService";
import { EVENT_DEFINITION_BY_ID } from "../data/events";
import { createAiTeamProfiles } from "../game/ai/AIManagementService";
import { encodeStoredString, type StorageAdapter } from "../platform/storage/StorageAdapter";

export interface SaveEnvelope {
  saveId: string;
  slotId: number;
  schemaVersion: number;
  gameVersion: string;
  dataVersion: string;
  generatorVersion: number;
  careerSeed: string;
  revision: number;
  parentRevision: number | null;
  syncBaseRevision: number | null;
  stateHash: string;
  updatedAt: string;
  pendingSync: boolean;
  state: GameState;
}

export interface SaveSlotSummary {
  slotId: 1 | 2 | 3;
  teamName: string;
  seasonId: string;
  currentDate: string;
  phase: string;
  wins: number;
  losses: number;
  updatedAt: string;
  revision: number;
}

const slotKey = (slotId: number): string => `basketball-manager:career:${slotId}`;
const tempKey = (slotId: number): string => `${slotKey(slotId)}:pending`;
const checkpointKey = (slotId: number, checkpointId: string): string => `${slotKey(slotId)}:checkpoint:${checkpointId}`;
const checkpointIndexKey = (slotId: number): string => `${slotKey(slotId)}:checkpoint-index`;
const previousKey = (slotId: number): string => `${slotKey(slotId)}:previous-valid`;
const conflictBackupKey = (slotId: number): string => `${slotKey(slotId)}:conflict-backup`;

interface CheckpointEnvelope {
  checkpointId: string;
  stateHash: string;
  state: GameState;
}

export type SaveSyncResult =
  | { status: "IN_SYNC" | "PUSHED_LOCAL" | "PULLED_CLOUD"; local: SaveEnvelope; cloud: SaveEnvelope }
  | { status: "SAVE_CONFLICT"; local: SaveEnvelope; cloud: SaveEnvelope };

interface ConflictBackup {
  slotId: number;
  saveId: string;
  createdAt: string;
  source: "LOCAL_BEFORE_CLOUD_OVERRIDE";
  revision: number;
  stateHash: string;
  serializedGameState: string;
}

function migrateLoadedState(input: GameState): GameState {
  const state = structuredClone(input);
  const hasFirstServiceYearsMigration = state.meta.dataVersion.includes("+service.2026.v1");
  const legacyRealPlayerServiceYears = !state.meta.dataVersion.includes("+service.2026.v2")
    && (state.meta.dataVersion.startsWith("bundled.") || state.meta.dataVersion.startsWith("hupu.nba.live-roster"));
  state.meta.configVersion = GAME_CONFIG.version;
  state.commandReceipts ??= {};
  state.teamNotifications ??= [];
  state.draftPicks ??= {};
  const requiredPicks = {
    ...createFutureDraftPicks(state.teams, 2027),
    ...createFutureDraftPicks(state.teams, state.league.seasonYear + 1),
  };
  for (const [pickId, pick] of Object.entries(requiredPicks)) state.draftPicks[pickId] ??= pick;
  state.capState ??= { capHolds: [], deadMoney: [], offerReservations: [] };
  state.capState.emergencySalaryCharges ??= [];
  state.tradeInquiryCount ??= {};
  state.tradeDesk ??= { offers: [] };
  state.aiTradeState ??= { evaluationCounter: 0, completedByTeamSeason: {}, transactionLog: [] };
  const defaultAiProfiles = createAiTeamProfiles(Object.keys(state.teams), state.seeds.careerSeed, state.league.seasonYear);
  state.aiTeamProfiles ??= defaultAiProfiles;
  for (const [teamId, profile] of Object.entries(defaultAiProfiles)) state.aiTeamProfiles[teamId] ??= profile;
  const marketRatings = new Map(TEAM_DEFINITIONS.map((team) => [team.id, team.marketRating]));
  for (const team of Object.values(state.teams)) team.marketRating = marketRatings.get(team.id) ?? team.marketRating;
  state.history.retiredPlayerIds ??= [];
  state.history.rebornHistoricalSourceIds ??= [];
  state.history.seasonAwards ??= [];
  state.history.seasons ??= [];
  if (state.league.seasonYear === 2026 && state.meta.dataVersion.startsWith("bundled.")) {
    for (const retired of retiredPlayers.players) {
      const playerId = `nba:${retired.nbaPlayerId}`;
      const player = state.players[playerId];
      if (!player || player.teamId !== "FREE_AGENT" || !["UFA", "RFA"].includes(player.contract.status)) continue;
      delete state.players[playerId];
      if (!state.history.retiredPlayerIds.includes(playerId)) state.history.retiredPlayerIds.push(playerId);
      state.capState.capHolds = state.capState.capHolds.filter((hold) => hold.playerId !== playerId);
      state.capState.offerReservations = state.capState.offerReservations.filter((offer) => offer.playerId !== playerId);
      if (state.freeAgency) {
        for (const [offerId, offer] of Object.entries(state.freeAgency.offers)) {
          if (offer.playerId === playerId) delete state.freeAgency.offers[offerId];
        }
        delete state.freeAgency.markets[playerId];
        delete state.freeAgency.settledPlayerDay[playerId];
        if (state.freeAgency.pendingUserRfaDecision?.playerId === playerId) delete state.freeAgency.pendingUserRfaDecision;
      }
    }
  }
  for (const season of state.history.seasons) season.userPostseason ??= {
    enteredPlayIn: false,
    enteredPlayoffs: false,
    seriesWins: 0,
    conferenceFinals: false,
    finalsAppearance: season.championTeamId === state.userTeamId,
    champion: season.championTeamId === state.userTeamId,
    playoffWins: 0,
    playoffLosses: 0,
  };
  state.achievements ??= createAchievementState();
  for (const [id, achievement] of Object.entries(createAchievementState())) state.achievements[id as keyof typeof state.achievements] ??= achievement;
  state.gmCareer ??= createGmCareerState();
  state.gmCareer.draftHistory ??= [];
  state.gmCareer.tradeHistory ??= [];
  state.eventState ??= createEventState();
  state.eventState.queue ??= [];
  state.eventState.resolvedInstanceIds ??= [];
  state.eventState.executedEffectIds ??= [];
  state.eventState.lastOccurrenceByDefinition ??= {};
  state.eventState.leagueLog ??= [];
  for (const event of state.eventState.queue) {
    const definition = EVENT_DEFINITION_BY_ID[event.definitionId];
    event.autoEffects ??= definition?.autoEffects ?? [];
    event.choices = event.choices.map((choice) => ({
      ...choice,
      effects: choice.effects ?? definition?.choices.find((candidate) => candidate.id === choice.id)?.effects ?? [],
    }));
  }
  state.trainingPlan ??= { seasonId: state.league.seasonId, assignments: {} };
  state.injuryState ??= { recentEvents: [] };
  const players = Object.values(state.players).sort((left, right) => left.id.localeCompare(right.id));
  players.forEach((player, ordinal) => {
    const profile = createFictionalPlayerProfile(state.seeds.careerSeed, ordinal, player.id, player.position, player.age);
    if (/^[A-Z]{2,3} Player \d+$/u.test(player.name)) player.name = profile.name;
    player.heightCm ??= profile.heightCm;
    player.weightKg ??= profile.weightKg;
    player.secondaryPosition ??= profile.secondaryPosition;
    player.birthDate ??= profile.birthDate;
    player.ageAtSnapshot ??= profile.ageAtSnapshot;
    player.ageSource ??= profile.ageSource;
    player.serviceYears ??= profile.serviceYears;
    if (legacyRealPlayerServiceYears && (player.profileSource === "CURATED_DATASET" || player.profileSource === "HUPU_LIVE_ROSTER")) {
      const opening = openingNbaServiceYears(player.id, player.ageAtSnapshot);
      if (state.league.seasonYear === 2026) {
        player.serviceYears = opening.years;
        player.serviceYearsSource = opening.source;
      } else if (hasFirstServiceYearsMigration && opening.source !== "AGE_ESTIMATE") {
        const previousOpeningYears = firstPassOpeningNbaServiceYears(
          player.id, player.ageAtSnapshot, player.serviceYearsSource,
        );
        player.serviceYears = opening.years + Math.max(0, player.serviceYears - previousOpeningYears);
        player.serviceYearsSource = opening.source;
      } else if (opening.source !== "AGE_ESTIMATE" && player.serviceYears < opening.years) {
        player.serviceYears = opening.years;
        player.serviceYearsSource = opening.source;
      }
    }
    player.serviceRosterDays ??= 0;
    if (player.birdTeamId === undefined) player.birdTeamId = player.teamId === "FREE_AGENT" ? null : player.teamId;
    player.birdYears ??= player.teamId === "FREE_AGENT" ? 0 : 1;
    player.injuryRating ??= profile.injuryRating;
    player.personality ??= profile.personality;
    player.marketPreference = calculateMarketPreference(player.personality, player.ageAtSnapshot);
    player.profileSource ??= profile.profileSource;
    player.health ??= player.available ? 100 : 55;
    player.morale ??= 50;
    player.contract ??= {
      salary: 2_000_000,
      yearsRemaining: 1,
      guaranteedAmount: 2_000_000,
      status: "STANDARD",
      optionType: "NONE",
      optionDecision: "NOT_APPLICABLE",
    };
    player.contract.optionType ??= "NONE";
    player.contract.optionDecision ??= player.contract.optionType === "NONE" ? "NOT_APPLICABLE" : "PENDING";
    player.postseasonStats ??= emptyPlayerSeasonStats();
    if (player.injury) {
      player.available = false;
      player.rotationRole = "OUT";
    }
  });
  if (legacyRealPlayerServiceYears) state.meta.dataVersion += "+service.2026.v2";
  for (const definition of TEAM_DEFINITIONS) {
    const team = state.teams[definition.id];
    if (!team) continue;
    team.fullName ??= definition.fullName;
    team.englishName ??= definition.englishName;
    team.dayColor ??= definition.dayColor;
    team.nightColor ??= definition.nightColor;
    team.logoUrl ??= definition.logoUrl;
    team.arena ??= definition.arena;
    team.sourceTeamId ??= definition.sourceTeamId;
    team.marketRating ??= definition.marketRating;
    team.franchiseReputation ??= definition.franchiseReputation;
    team.fanSupport ??= definition.fanSupport;
    team.currentStreak ??= 0;
  }
  state.meta.schemaVersion = Math.max(17, state.meta.schemaVersion);
  return state;
}

export class SaveService {
  constructor(private readonly adapter: StorageAdapter) {}

  async save(slotId: number, state: GameState): Promise<SaveEnvelope> {
    if (slotId < 1 || slotId > 3) throw new Error("V1 supports save slots 1 through 3");
    const previous = await this.loadEnvelope(slotId);
    const revision = (previous?.revision ?? 0) + 1;
    const envelope: SaveEnvelope = {
      saveId: previous?.saveId ?? stableHash(state.seeds.careerSeed, "save", slotId),
      slotId,
      schemaVersion: state.meta.schemaVersion,
      gameVersion: state.meta.gameVersion,
      dataVersion: state.meta.dataVersion,
      generatorVersion: state.meta.generatorVersion,
      careerSeed: state.seeds.careerSeed,
      revision,
      parentRevision: previous?.revision ?? null,
      syncBaseRevision: previous?.syncBaseRevision ?? null,
      stateHash: stableHash(stableSerialize(state)),
      updatedAt: new Date().toISOString(),
      pendingSync: true,
      state,
    };
    const serialized = JSON.stringify(envelope);
    await this.adapter.set(tempKey(slotId), serialized);
    const verify = JSON.parse((await this.adapter.get(tempKey(slotId))) as string) as SaveEnvelope;
    const verifiedStateHash = stableHash(stableSerialize(verify.state));
    if (verify.stateHash !== envelope.stateHash || verifiedStateHash !== envelope.stateHash) {
      throw new Error("Temporary save verification failed");
    }
    const previousSerialized = await this.adapter.get(slotKey(slotId));
    if (previousSerialized) await this.adapter.set(previousKey(slotId), previousSerialized);
    await this.adapter.set(slotKey(slotId), serialized);
    await this.adapter.remove(tempKey(slotId));
    return envelope;
  }

  async load(slotId: number): Promise<GameState | null> {
    const envelope = await this.loadEnvelope(slotId);
    if (!envelope) return null;
    const actualHash = stableHash(stableSerialize(envelope.state));
    if (actualHash !== envelope.stateHash) throw new Error("Save checksum mismatch");
    return migrateLoadedState(envelope.state);
  }

  async listSlotSummaries(): Promise<SaveSlotSummary[]> {
    const slots = [1, 2, 3] as const;
    const envelopes = await Promise.all(slots.map((slotId) => this.loadEnvelope(slotId)));
    return envelopes.flatMap((envelope, index) => envelope ? [this.summaryFor(slots[index], envelope)] : []);
  }

  async loadMostRecent(): Promise<{ slotId: 1 | 2 | 3; state: GameState } | null> {
    const summaries = await this.listSlotSummaries();
    const latest = summaries.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.revision - left.revision || right.slotId - left.slotId)[0];
    if (!latest) return null;
    const state = await this.load(latest.slotId);
    return state ? { slotId: latest.slotId, state } : null;
  }

  async saveCheckpoint(slotId: number, checkpointId: string, state: GameState): Promise<void> {
    if (!/^[a-z0-9-]{1,40}$/u.test(checkpointId)) throw new Error("Invalid checkpoint id");
    const envelope: CheckpointEnvelope = {
      checkpointId,
      stateHash: stableHash(stableSerialize(state)),
      state,
    };
    await this.adapter.set(checkpointKey(slotId, checkpointId), JSON.stringify(envelope));
    const indexSerialized = await this.adapter.get(checkpointIndexKey(slotId));
    const current = indexSerialized ? JSON.parse(indexSerialized) as string[] : [];
    const next = current.filter((id) => id !== checkpointId).concat(checkpointId);
    while (next.length > 3) await this.adapter.remove(checkpointKey(slotId, next.shift() as string));
    await this.adapter.set(checkpointIndexKey(slotId), JSON.stringify(next));
  }

  async loadCheckpoint(slotId: number, checkpointId: string): Promise<GameState | null> {
    const serialized = await this.adapter.get(checkpointKey(slotId, checkpointId));
    if (!serialized) return null;
    const envelope = JSON.parse(serialized) as CheckpointEnvelope;
    if (stableHash(stableSerialize(envelope.state)) !== envelope.stateHash) throw new Error("Checkpoint checksum mismatch");
    return migrateLoadedState(envelope.state);
  }

  async getSlotUsageBytes(slotId: number): Promise<number> {
    const indexSerialized = await this.adapter.get(checkpointIndexKey(slotId));
    const checkpoints = indexSerialized ? JSON.parse(indexSerialized) as string[] : [];
    const keys = [slotKey(slotId), tempKey(slotId), previousKey(slotId), checkpointIndexKey(slotId), conflictBackupKey(slotId), ...checkpoints.map((id) => checkpointKey(slotId, id))];
    const values = await Promise.all(keys.map((key) => this.adapter.get(key)));
    const encoded = await Promise.all(values.map((value) => value ? encodeStoredString(value) : null));
    return encoded.reduce((sum, value) => sum + (value ? new TextEncoder().encode(value).byteLength : 0), 0);
  }

  async syncWithCloud(slotId: number, cloud: StorageAdapter): Promise<SaveSyncResult | null> {
    const local = await this.loadEnvelope(slotId);
    const cloudSerialized = await cloud.get(slotKey(slotId));
    const parsedCloudEnvelope = this.parseValidEnvelope(cloudSerialized, slotId);
    const cloudEnvelope = parsedCloudEnvelope ? this.normalizeEnvelopeSlot(slotId, parsedCloudEnvelope) : null;
    if (cloudEnvelope && cloudSerialized !== JSON.stringify(cloudEnvelope)) {
      await this.writeEnvelope(cloud, slotId, cloudEnvelope);
    }
    if (!local && !cloudEnvelope) return null;
    if (!local && cloudEnvelope) {
      const normalized = { ...cloudEnvelope, syncBaseRevision: cloudEnvelope.revision, pendingSync: false };
      await this.writeEnvelope(this.adapter, slotId, normalized);
      return { status: "PULLED_CLOUD", local: normalized, cloud: normalized };
    }
    if (!local) return null;
    if (!cloudEnvelope) {
      const normalized = { ...local, syncBaseRevision: local.revision, pendingSync: false };
      await this.writeEnvelope(cloud, slotId, normalized);
      await this.writeEnvelope(this.adapter, slotId, normalized);
      return { status: "PUSHED_LOCAL", local: normalized, cloud: normalized };
    }
    if (local.stateHash === cloudEnvelope.stateHash) {
      const revision = Math.max(local.revision, cloudEnvelope.revision);
      const normalized = { ...(local.revision >= cloudEnvelope.revision ? local : cloudEnvelope), revision, syncBaseRevision: revision, pendingSync: false };
      await this.writeEnvelope(cloud, slotId, normalized);
      await this.writeEnvelope(this.adapter, slotId, normalized);
      return { status: "IN_SYNC", local: normalized, cloud: normalized };
    }
    if (local.pendingSync && cloudEnvelope.revision === local.syncBaseRevision) {
      const normalized = { ...local, syncBaseRevision: local.revision, pendingSync: false };
      await this.writeEnvelope(cloud, slotId, normalized);
      await this.writeEnvelope(this.adapter, slotId, normalized);
      return { status: "PUSHED_LOCAL", local: normalized, cloud: normalized };
    }
    if (!local.pendingSync && cloudEnvelope.revision > local.revision) {
      const normalized = { ...cloudEnvelope, syncBaseRevision: cloudEnvelope.revision, pendingSync: false };
      await this.writeEnvelope(this.adapter, slotId, normalized);
      return { status: "PULLED_CLOUD", local: normalized, cloud: normalized };
    }
    return { status: "SAVE_CONFLICT", local, cloud: cloudEnvelope };
  }

  async resolveConflict(slotId: number, cloud: StorageAdapter, choice: "LOCAL" | "CLOUD"): Promise<SaveEnvelope> {
    const status = await this.syncWithCloud(slotId, cloud);
    if (!status || status.status !== "SAVE_CONFLICT") throw new Error("NO_SAVE_CONFLICT");
    if (choice === "LOCAL") {
      const revision = Math.max(status.local.revision, status.cloud.revision) + 1;
      const resolved = { ...status.local, revision, parentRevision: status.cloud.revision, syncBaseRevision: revision, pendingSync: false, updatedAt: new Date().toISOString() };
      await this.writeEnvelope(cloud, slotId, resolved);
      await this.writeEnvelope(this.adapter, slotId, resolved);
      return resolved;
    }
    const backup: ConflictBackup = {
      slotId,
      saveId: status.local.saveId,
      createdAt: new Date().toISOString(),
      source: "LOCAL_BEFORE_CLOUD_OVERRIDE",
      revision: status.local.revision,
      stateHash: status.local.stateHash,
      serializedGameState: JSON.stringify(status.local.state),
    };
    await this.adapter.set(conflictBackupKey(slotId), JSON.stringify(backup));
    const verified = JSON.parse(await this.adapter.get(conflictBackupKey(slotId)) as string) as ConflictBackup;
    if (stableHash(stableSerialize(JSON.parse(verified.serializedGameState))) !== verified.stateHash) throw new Error("CONFLICT_BACKUP_VERIFICATION_FAILED");
    const resolved = { ...status.cloud, syncBaseRevision: status.cloud.revision, pendingSync: false };
    await this.writeEnvelope(this.adapter, slotId, resolved);
    return resolved;
  }

  async loadConflictBackup(slotId: number): Promise<GameState | null> {
    const serialized = await this.adapter.get(conflictBackupKey(slotId));
    if (!serialized) return null;
    const backup = JSON.parse(serialized) as ConflictBackup;
    const state = JSON.parse(backup.serializedGameState) as GameState;
    if (stableHash(stableSerialize(state)) !== backup.stateHash) throw new Error("Conflict backup checksum mismatch");
    return migrateLoadedState(state);
  }

  private parseValidEnvelope(serialized: string | null, expectedSlotId?: number): SaveEnvelope | null {
    if (!serialized) return null;
    try {
      const envelope = JSON.parse(serialized) as SaveEnvelope;
      if (!envelope.saveId) envelope.saveId = stableHash(envelope.careerSeed, "save", expectedSlotId ?? envelope.slotId);
      return stableHash(stableSerialize(envelope.state)) === envelope.stateHash ? envelope : null;
    } catch {
      return null;
    }
  }

  private normalizeEnvelopeSlot(slotId: number, envelope: SaveEnvelope): SaveEnvelope {
    return envelope.slotId === slotId ? envelope : { ...envelope, slotId };
  }

  private summaryFor(slotId: 1 | 2 | 3, envelope: SaveEnvelope): SaveSlotSummary {
    const state = envelope.state;
    const team = state.teams[state.userTeamId];
    const record = state.standings[state.userTeamId];
    const date = new Date(`${state.calendar.openingDate}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + state.calendar.currentDateIndex);
    return {
      slotId,
      teamName: team?.fullName ?? team?.name ?? "未命名球队",
      seasonId: state.league.seasonId,
      currentDate: date.toISOString().slice(0, 10),
      phase: state.league.currentPhase,
      wins: record?.wins ?? 0,
      losses: record?.losses ?? 0,
      updatedAt: envelope.updatedAt,
      revision: envelope.revision,
    };
  }

  private async writeEnvelope(adapter: StorageAdapter, slotId: number, envelope: SaveEnvelope): Promise<void> {
    const normalized = this.normalizeEnvelopeSlot(slotId, envelope);
    const serialized = JSON.stringify(normalized);
    await adapter.set(tempKey(slotId), serialized);
    const verified = this.parseValidEnvelope(await adapter.get(tempKey(slotId)), slotId);
    if (!verified || verified.slotId !== slotId || verified.stateHash !== normalized.stateHash) throw new Error("SAVE_WRITE_VERIFICATION_FAILED");
    await adapter.set(slotKey(slotId), serialized);
    await adapter.remove(tempKey(slotId));
  }

  private async loadEnvelope(slotId: number): Promise<SaveEnvelope | null> {
    const [primarySerialized, pendingSerialized, previousSerialized] = await Promise.all([
      this.adapter.get(slotKey(slotId)),
      this.adapter.get(tempKey(slotId)),
      this.adapter.get(previousKey(slotId)),
    ]);
    const parsedPrimary = this.parseValidEnvelope(primarySerialized, slotId);
    const parsedPending = this.parseValidEnvelope(pendingSerialized, slotId);
    const parsedPrevious = this.parseValidEnvelope(previousSerialized, slotId);
    const primary = parsedPrimary ? this.normalizeEnvelopeSlot(slotId, parsedPrimary) : null;
    const pending = parsedPending ? this.normalizeEnvelopeSlot(slotId, parsedPending) : null;
    const previous = parsedPrevious ? this.normalizeEnvelopeSlot(slotId, parsedPrevious) : null;
    if (!primary && !pending && !previous) {
      if (primarySerialized || pendingSerialized || previousSerialized) throw new Error("No recoverable save revision");
      return null;
    }
    if (pending && (!primary || pending.revision > primary.revision)) {
      await this.adapter.set(slotKey(slotId), JSON.stringify(pending));
      await this.adapter.remove(tempKey(slotId));
      return pending;
    }
    if (!primary && previous) {
      await this.adapter.set(slotKey(slotId), JSON.stringify(previous));
      if (pendingSerialized) await this.adapter.remove(tempKey(slotId));
      return previous;
    }
    if (pendingSerialized) await this.adapter.remove(tempKey(slotId));
    if (primary && primarySerialized !== JSON.stringify(primary)) await this.adapter.set(slotKey(slotId), JSON.stringify(primary));
    return primary;
  }
}
