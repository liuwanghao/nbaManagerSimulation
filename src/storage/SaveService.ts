import { stableHash } from "../game/random/hash";
import { createFutureDraftPicks } from "../data/draftPicks";
import { TEAM_DEFINITIONS } from "../data/league";
import retiredPlayers from "../data/nba-retired-players.json";
import { createFictionalPlayerProfile } from "../data/playerProfiles";
import { NBA_PLAYER_DATASET } from "../data/nbaPlayerDataset";
import { RETIRED_LEGEND_TEMPLATES } from "../data/retiredLegendTemplates";
import { replaceIneligibleUnpickedHistoricalProspects, upgradeUnpickedHistoricalProspects } from "../game/draft/DraftService";
import { firstPassOpeningNbaServiceYears, openingNbaServiceYears } from "../data/nbaServiceYears";
import { GAME_CONFIG } from "../config/gameConfig";
import { calculateMarketPreference } from "../game/player/MarketPreferenceService";
import { calculateAttributeOverall, calculatePlayerOverall } from "../game/player/PlayerRatingService";
import { emptyPlayerSeasonStats, type GameState } from "../game/state/types";
import { backfillNewAchievements, createAchievementState, createGmCareerState, repairInvalidWinAchievements } from "../game/career/AchievementService";
import { backfillFranchiseStats } from "../game/career/FranchiseStats";
import { createEventState, settleInformationalEvents } from "../game/events/EventService";
import { addTeamNotification, ensureExpansionWelcomeNotification, repairCareerMilestoneNotifications } from "../game/notifications/TeamNotificationService";
import { EVENT_DEFINITION_BY_ID } from "../data/events";
import { createAiTeamProfiles } from "../game/ai/AIManagementService";
import { encodeStoredString, hasEncodedStorage, type StorageAdapter } from "../platform/storage/StorageAdapter";
import { isStoredStringCorruptionError } from "../platform/storage/StoredStringCodec";
import { applyRotationPlanToPlayers, buildDefaultRotationPlan, normalizeRotationPlan, upgradeLegacyAutomaticRotationPlan } from "../game/roster/RotationPlanService";
import { BALANCE_CONFIG } from "../config/balanceConfig";
import { hasOpeningMipBaselines, seedOpeningMipBaselines } from "../game/awards/OpeningMipBaseline";
import {
  hashSaveState, inspectEncodedSaveEnvelope, inspectValidSaveEnvelope, parseValidSaveEnvelope, parseValidSaveEnvelopeCopy,
  serializeEncodedSaveEnvelope, serializeSaveEnvelope, stringifySaveValue,
} from "./SaveCodec";

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
  status?: "CORRUPTED" | "UNAVAILABLE";
  error?: string;
  teamName: string;
  seasonId: string;
  currentDate: string;
  phase: string;
  wins: number;
  losses: number;
  updatedAt: string;
  revision: number;
}

export interface SaveOptions {
  /** Set only after the player confirms replacing an unrecoverable career. */
  rebuildCorrupted?: boolean;
}

type SaveCopyDiagnostic = { key: string; error: unknown; kind: "CORRUPTED" | "UNAVAILABLE" };
type ValidSaveCopy<T> = { serialized: string; envelope: T };
type SaveCopyParser<T> = (serialized: string | null, expectedSlotId?: number) => Promise<ValidSaveCopy<T> | null>;

export class SaveRecoveryError extends Error {
  readonly canRebuild: boolean;

  constructor(readonly diagnostics: SaveCopyDiagnostic[]) {
    super(`No recoverable save revision: ${diagnostics.map(({ key, error }) => `${key}: ${error instanceof Error ? error.message : String(error)}`).join("; ")}`);
    this.name = "SaveRecoveryError";
    this.canRebuild = diagnostics.every(({ kind }) => kind === "CORRUPTED");
  }
}

// Shared adapter identity also protects callers that construct another service.
const slotOperations = new WeakMap<StorageAdapter, Map<number, Promise<void>>>();

function queueSlotOperation<T>(slotId: number, adapters: StorageAdapter[], operation: () => Promise<T>): Promise<T> {
  if (!Number.isInteger(slotId) || slotId < 1 || slotId > 3) return Promise.reject(new Error("V1 supports save slots 1 through 3"));
  const queues = [...new Set(adapters)].map((adapter) => {
    let slots = slotOperations.get(adapter);
    if (!slots) { slots = new Map(); slotOperations.set(adapter, slots); }
    return slots;
  });
  // Reserve all participating adapters together, so cloud writes and conflict
  // resolution cannot interleave with a save or deadlock on nested locks.
  const pending = queues.map((slots) => slots.get(slotId) ?? Promise.resolve());
  const result = Promise.all(pending).then(operation);
  const tail = result.then(() => undefined, () => undefined);
  for (const slots of queues) slots.set(slotId, tail);
  void tail.then(() => {
    for (const slots of queues) if (slots.get(slotId) === tail) slots.delete(slotId);
  });
  return result;
}

const slotKey = (slotId: number): string => `basketball-manager:career:${slotId}`;
const tempKey = (slotId: number): string => `${slotKey(slotId)}:pending`;
const checkpointKey = (slotId: number, checkpointId: string): string => `${slotKey(slotId)}:checkpoint:${checkpointId}`;
const checkpointIndexKey = (slotId: number): string => `${slotKey(slotId)}:checkpoint-index`;
const previousKey = (slotId: number): string => `${slotKey(slotId)}:previous-valid`;
const conflictBackupKey = (slotId: number): string => `${slotKey(slotId)}:conflict-backup`;
const historicalNameBySourceId = new Map([
  ...NBA_PLAYER_DATASET.historicalTemplates,
  ...RETIRED_LEGEND_TEMPLATES,
].map((template) => [template.sourcePlayerId, template.sourceName]));
const retiredLegendTemplateBySourceId = new Map(RETIRED_LEGEND_TEMPLATES.map((template) => [template.sourcePlayerId, template]));
const retiredLegendPeakBySourceId = new Map(RETIRED_LEGEND_TEMPLATES.map((template) => [template.sourcePlayerId, template.peakOverall]));

function isStorageQuotaError(error: unknown): boolean {
  return error instanceof Error && (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED");
}

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
  replaceIneligibleUnpickedHistoricalProspects(state);
  upgradeUnpickedHistoricalProspects(state);
  for (const player of Object.values(state.players)) {
    if (player.profileSource !== "HISTORICAL_ARCHETYPE" || !player.historicalSourcePlayerId) continue;
    player.name = historicalNameBySourceId.get(player.historicalSourcePlayerId) ?? player.name;
    const historicalTemplate = retiredLegendTemplateBySourceId.get(player.historicalSourcePlayerId);
    if (historicalTemplate?.secondaryPosition) player.secondaryPosition = historicalTemplate.secondaryPosition;
    const peakOverall = retiredLegendPeakBySourceId.get(player.historicalSourcePlayerId);
    if (peakOverall !== undefined) {
      player.truePotential = Math.max(player.truePotential ?? 0, BALANCE_CONFIG.draft.historicalRebirth.potentialFloor, peakOverall);
      player.scoutedPotentialGrade = "S";
    }
  }
  const hasFirstServiceYearsMigration = state.meta.dataVersion.includes("+service.2026.v1");
  const legacyRealPlayerServiceYears = !state.meta.dataVersion.includes("+service.2026.v2")
    && (state.meta.dataVersion.startsWith("bundled.") || state.meta.dataVersion.startsWith("hupu.nba.live-roster"));
  state.meta.configVersion = GAME_CONFIG.version;
  state.commandReceipts ??= {};
  if (state.league.seasonYear === BALANCE_CONFIG.playerLifecycle.snapshotSeasonYear
    && (state.rookieDraft?.source === "CURATED_2026" || state.rookieDraft?.source === "PROCEDURAL_2026")
    && state.rookieDraft.lotteryPresented === undefined) {
    state.rookieDraft.lotteryPresented = true;
  }
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
  repairInvalidWinAchievements(state);
  backfillNewAchievements(state);
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
  const hadQueuedMajorInjury = state.eventState.queue.some((event) => event.definitionId === "injury_core_major_001");
  state.trainingPlan ??= { seasonId: state.league.seasonId, assignments: {} };
  state.injuryState ??= { recentEvents: [] };
  const pendingMajorInjury = state.injuryState.pendingUserMajorInjury;
  if (pendingMajorInjury && !hadQueuedMajorInjury) {
    addTeamNotification(state, {
      id: `injury-${pendingMajorInjury.injuryId}`,
      category: "SEASON",
      seasonId: pendingMajorInjury.seasonId,
      title: "核心球员受伤",
      message: `${state.players[pendingMajorInjury.playerId]?.name ?? "球员"}受伤，预计缺阵 ${pendingMajorInjury.gamesOut} 场；首发与轮换已自动调整。`,
    });
  }
  state.injuryState.pendingUserMajorInjury = undefined;
  const players = Object.values(state.players).sort((left, right) => left.id.localeCompare(right.id));
  players.forEach((player, ordinal) => {
    if (player.id === "nba:201143" && (player.profileSource === "CURATED_DATASET" || player.profileSource === "HUPU_LIVE_ROSTER")) {
      const horford = NBA_PLAYER_DATASET.players.find((entry) => entry.canonicalPlayerId === player.id);
      if (horford && (player.position !== horford.position || player.secondaryPosition !== horford.secondaryPosition)) {
        const currentOverall = calculatePlayerOverall(player);
        player.position = horford.position;
        player.secondaryPosition = horford.secondaryPosition ?? horford.position;
        player.overallAdjustment = currentOverall - calculateAttributeOverall(player.attributes, player.position);
      }
    }
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
  state.franchiseStats ??= backfillFranchiseStats(state);
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
  for (const team of Object.values(state.teams)) {
    const roster = team.playerIds.map((id) => state.players[id]).filter(Boolean);
    if (roster.filter((player) => player.available && !player.injury).length < BALANCE_CONFIG.rotationPlan.minimumActivePlayers) continue;
    team.rotationPlan = team.rotationPlan
      ? normalizeRotationPlan(roster, upgradeLegacyAutomaticRotationPlan(roster, team.rotationPlan))
      : buildDefaultRotationPlan(roster);
    applyRotationPlanToPlayers(roster, team.rotationPlan);
  }
  state.meta.schemaVersion = Math.max(18, state.meta.schemaVersion);
  if (state.league.seasonYear === 2026
    && (state.meta.dataVersion.startsWith("bundled.") || state.meta.dataVersion.startsWith("hupu.nba.live-roster"))
    && (state.schedule.length === 0 || state.schedule.some((game) => game.status === "SCHEDULED"))
    && !hasOpeningMipBaselines(state)) seedOpeningMipBaselines(state);
  ensureExpansionWelcomeNotification(state);
  settleInformationalEvents(state);
  repairCareerMilestoneNotifications(state);
  return state;
}

export class SaveService {
  constructor(private readonly adapter: StorageAdapter) {}

  private async evictOldestCheckpoint(slotId: number): Promise<boolean> {
    const serialized = await this.adapter.get(checkpointIndexKey(slotId));
    const checkpoints = serialized ? JSON.parse(serialized) as string[] : [];
    const oldest = checkpoints.shift();
    if (!oldest) return false;
    await this.adapter.remove(checkpointKey(slotId, oldest));
    await this.adapter.set(checkpointIndexKey(slotId), JSON.stringify(checkpoints));
    return true;
  }

  private async setWithQuotaRecovery(slotId: number, key: string, value: string, persistence: StorageAdapter = this.adapter): Promise<void> {
    for (;;) {
      try {
        await persistence.set(key, value);
        return;
      } catch (error) {
        if (!isStorageQuotaError(error)) throw error;
        if (await this.evictOldestCheckpoint(slotId)) continue;
        if (key !== previousKey(slotId) && await persistence.get(previousKey(slotId)) !== null) {
          await persistence.remove(previousKey(slotId));
          continue;
        }
        throw error;
      }
    }
  }

  save(slotId: number, state: GameState, options: SaveOptions = {}): Promise<SaveEnvelope> {
    return queueSlotOperation(slotId, [this.adapter], () => this.saveUnlocked(slotId, state, options));
  }

  private async saveUnlocked(slotId: number, state: GameState, options: SaveOptions = {}): Promise<SaveEnvelope> {
    const encodedAdapter = hasEncodedStorage(this.adapter) ? this.adapter : null;
    // The recovery state machine accepts opaque payloads. A raw view reuses it
    // without decoding large JSON on the main thread or changing queue identity.
    const persistence: StorageAdapter = encodedAdapter ? {
      get: (key) => encodedAdapter.getEncoded(key),
      set: (key, value) => encodedAdapter.setEncoded(key, value),
      remove: (key) => encodedAdapter.remove(key),
    } : this.adapter;
    let previousCopy: ValidSaveCopy<Omit<SaveEnvelope, "state">> | null;
    let rebuilding = false;
    try {
      // The Worker validates old state but returns only its headers and bytes.
      // Recovery stays shared with loading without cloning old state here.
      previousCopy = await this.loadEnvelopeCopy<Omit<SaveEnvelope, "state">>(slotId, persistence, async (serialized, expectedSlotId) => {
        if (encodedAdapter) {
          const inspected = await inspectEncodedSaveEnvelope(serialized, expectedSlotId);
          return inspected ? { envelope: inspected, serialized: inspected.encoded } : null;
        }
        const inspected = await inspectValidSaveEnvelope(serialized, expectedSlotId);
        return inspected ? { envelope: inspected, serialized: inspected.serialized } : null;
      });
    } catch (error) {
      if (!options.rebuildCorrupted || !(error instanceof SaveRecoveryError) || !error.canRebuild) throw error;
      previousCopy = null;
      rebuilding = true;
    }
    const previous = previousCopy?.envelope;
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
      stateHash: "",
      updatedAt: new Date().toISOString(),
      pendingSync: true,
      state,
    };
    const prepared = encodedAdapter ? await serializeEncodedSaveEnvelope(envelope) : await serializeSaveEnvelope(envelope);
    envelope.stateHash = prepared.stateHash;
    const serialized = "encoded" in prepared ? prepared.encoded : prepared.serialized;
    await this.setWithQuotaRecovery(slotId, tempKey(slotId), serialized, persistence);
    // The encoded envelope was already hashed in the Worker. Exact readback also
    // detects corruption without parsing and hashing the entire state again.
    if (await persistence.get(tempKey(slotId)) !== serialized) {
      throw new Error("Temporary save verification failed");
    }
    const previousSerialized = previousCopy?.serialized;
    if (previousSerialized) {
      try {
        await this.setWithQuotaRecovery(slotId, previousKey(slotId), previousSerialized, persistence);
      } catch (error) {
        if (!isStorageQuotaError(error)) throw error;
      }
    }
    await this.setWithQuotaRecovery(slotId, slotKey(slotId), serialized, persistence);
    await persistence.remove(tempKey(slotId));
    // The healthy primary is committed; stale corrupt backup cleanup can be
    // retried later without reporting that the player's new save failed.
    if (rebuilding) await persistence.remove(previousKey(slotId)).catch(() => undefined);
    return envelope;
  }

  load(slotId: number): Promise<GameState | null> {
    return queueSlotOperation(slotId, [this.adapter], () => this.loadUnlocked(slotId));
  }

  private async loadUnlocked(slotId: number): Promise<GameState | null> {
    const envelope = await this.loadEnvelope(slotId);
    if (!envelope) return null;
    const actualHash = await hashSaveState(envelope.state);
    if (actualHash !== envelope.stateHash) throw new Error("Save checksum mismatch");
    return migrateLoadedState(envelope.state);
  }

  async listSlotSummaries(): Promise<SaveSlotSummary[]> {
    const slots = [1, 2, 3] as const;
    const summaries = await Promise.all(slots.map((slotId) => queueSlotOperation(slotId, [this.adapter], async () => {
      try {
        const envelope = await this.loadEnvelope(slotId);
        return envelope ? this.summaryFor(slotId, envelope) : null;
      } catch (error) {
        return {
          slotId, status: error instanceof SaveRecoveryError && error.canRebuild ? "CORRUPTED" as const : "UNAVAILABLE" as const,
          error: error instanceof Error ? error.message : String(error),
          teamName: error instanceof SaveRecoveryError && error.canRebuild ? "损坏存档" : "存档暂不可用", seasonId: "", currentDate: "", phase: "",
          wins: 0, losses: 0, updatedAt: "", revision: 0,
        };
      }
    })));
    return summaries.filter((summary): summary is SaveSlotSummary => summary !== null);
  }

  async loadMostRecent(): Promise<{ slotId: 1 | 2 | 3; state: GameState } | null> {
    const summaries = await this.listSlotSummaries();
    const latest = summaries.filter((summary) => !summary.status).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.revision - left.revision || right.slotId - left.slotId)[0];
    if (!latest) return null;
    const state = await this.load(latest.slotId);
    return state ? { slotId: latest.slotId, state } : null;
  }

  saveCheckpoint(slotId: number, checkpointId: string, state: GameState): Promise<void> {
    return queueSlotOperation(slotId, [this.adapter], () => this.saveCheckpointUnlocked(slotId, checkpointId, state));
  }

  private async saveCheckpointUnlocked(slotId: number, checkpointId: string, state: GameState): Promise<void> {
    if (!/^[a-z0-9-]{1,40}$/u.test(checkpointId)) throw new Error("Invalid checkpoint id");
    const indexSerialized = await this.adapter.get(checkpointIndexKey(slotId));
    const current = indexSerialized ? JSON.parse(indexSerialized) as string[] : [];
    const retained = current.filter((id) => id !== checkpointId);
    // Free space before writing: a fourth full-season checkpoint can exceed browser storage quota.
    while (retained.length >= 3) {
      const oldest = retained.shift() as string;
      await this.adapter.remove(checkpointKey(slotId, oldest));
    }
    if (retained.length !== current.length && !current.includes(checkpointId)) {
      await this.adapter.set(checkpointIndexKey(slotId), JSON.stringify(retained));
    }
    const envelope: CheckpointEnvelope = {
      checkpointId,
      stateHash: await hashSaveState(state),
      state,
    };
    await this.adapter.set(checkpointKey(slotId, checkpointId), await stringifySaveValue(envelope));
    await this.adapter.set(checkpointIndexKey(slotId), JSON.stringify([...retained, checkpointId]));
  }

  loadCheckpoint(slotId: number, checkpointId: string): Promise<GameState | null> {
    return queueSlotOperation(slotId, [this.adapter], () => this.loadCheckpointUnlocked(slotId, checkpointId));
  }

  private async loadCheckpointUnlocked(slotId: number, checkpointId: string): Promise<GameState | null> {
    const serialized = await this.adapter.get(checkpointKey(slotId, checkpointId));
    if (!serialized) return null;
    const envelope = JSON.parse(serialized) as CheckpointEnvelope;
    if (await hashSaveState(envelope.state) !== envelope.stateHash) throw new Error("Checkpoint checksum mismatch");
    return migrateLoadedState(envelope.state);
  }

  getSlotUsageBytes(slotId: number): Promise<number> {
    return queueSlotOperation(slotId, [this.adapter], () => this.getSlotUsageBytesUnlocked(slotId));
  }

  private async getSlotUsageBytesUnlocked(slotId: number): Promise<number> {
    const indexSerialized = await this.adapter.get(checkpointIndexKey(slotId));
    const checkpoints = indexSerialized ? JSON.parse(indexSerialized) as string[] : [];
    const keys = [slotKey(slotId), tempKey(slotId), previousKey(slotId), checkpointIndexKey(slotId), conflictBackupKey(slotId), ...checkpoints.map((id) => checkpointKey(slotId, id))];
    const values = await Promise.all(keys.map((key) => this.adapter.get(key)));
    const encoded = await Promise.all(values.map((value) => value ? encodeStoredString(value) : null));
    return encoded.reduce((sum, value) => sum + (value ? new TextEncoder().encode(value).byteLength : 0), 0);
  }

  syncWithCloud(slotId: number, cloud: StorageAdapter): Promise<SaveSyncResult | null> {
    return queueSlotOperation(slotId, [this.adapter, cloud], () => this.syncWithCloudUnlocked(slotId, cloud));
  }

  private async syncWithCloudUnlocked(slotId: number, cloud: StorageAdapter): Promise<SaveSyncResult | null> {
    const local = await this.loadEnvelope(slotId);
    const cloudEnvelope = await this.loadEnvelope(slotId, cloud);
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

  resolveConflict(slotId: number, cloud: StorageAdapter, choice: "LOCAL" | "CLOUD"): Promise<SaveEnvelope> {
    return queueSlotOperation(slotId, [this.adapter, cloud], () => this.resolveConflictUnlocked(slotId, cloud, choice));
  }

  private async resolveConflictUnlocked(slotId: number, cloud: StorageAdapter, choice: "LOCAL" | "CLOUD"): Promise<SaveEnvelope> {
    const status = await this.syncWithCloudUnlocked(slotId, cloud);
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
      serializedGameState: await stringifySaveValue(status.local.state),
    };
    await this.adapter.set(conflictBackupKey(slotId), JSON.stringify(backup));
    const verified = JSON.parse(await this.adapter.get(conflictBackupKey(slotId)) as string) as ConflictBackup;
    if (await hashSaveState(JSON.parse(verified.serializedGameState)) !== verified.stateHash) throw new Error("CONFLICT_BACKUP_VERIFICATION_FAILED");
    const resolved = { ...status.cloud, syncBaseRevision: status.cloud.revision, pendingSync: false };
    await this.writeEnvelope(this.adapter, slotId, resolved);
    return resolved;
  }

  loadConflictBackup(slotId: number): Promise<GameState | null> {
    return queueSlotOperation(slotId, [this.adapter], () => this.loadConflictBackupUnlocked(slotId));
  }

  private async loadConflictBackupUnlocked(slotId: number): Promise<GameState | null> {
    const serialized = await this.adapter.get(conflictBackupKey(slotId));
    if (!serialized) return null;
    const backup = JSON.parse(serialized) as ConflictBackup;
    const state = JSON.parse(backup.serializedGameState) as GameState;
    if (await hashSaveState(state) !== backup.stateHash) throw new Error("Conflict backup checksum mismatch");
    return migrateLoadedState(state);
  }

  private normalizeEnvelopeSlot(slotId: number, envelope: SaveEnvelope): SaveEnvelope {
    return envelope.slotId === slotId ? envelope : { ...envelope, slotId };
  }

  summaryFor(slotId: 1 | 2 | 3, envelope: SaveEnvelope): SaveSlotSummary {
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
    const serialized = await stringifySaveValue(normalized);
    await adapter.set(tempKey(slotId), serialized);
    const verified = await parseValidSaveEnvelope(await adapter.get(tempKey(slotId)), slotId);
    if (!verified || verified.slotId !== slotId || verified.stateHash !== normalized.stateHash) throw new Error("SAVE_WRITE_VERIFICATION_FAILED");
    await adapter.set(slotKey(slotId), serialized);
    await adapter.remove(tempKey(slotId));
  }

  private async readEnvelopeCopy<T>(key: string, slotId: number, adapter: StorageAdapter, parse: SaveCopyParser<T>): Promise<{
    serialized: string | null;
    copy: ValidSaveCopy<T> | null;
    diagnostic?: SaveCopyDiagnostic;
  }> {
    try {
      // Decoding belongs inside each copy's failure boundary, whether performed
      // by the normal adapter or the encoded Worker's parser. A bad gzip payload
      // must not prevent trying the other recoverable copies.
      const serialized = await adapter.get(key);
      if (serialized === null) return { serialized, copy: null };
      // Both parsers check the same structure/checksum and repair legacy headers.
      const copy = await parse(serialized, slotId);
      if (!copy) return { serialized, copy: null, diagnostic: { key, error: new Error("Invalid save structure or checksum"), kind: "CORRUPTED" } };
      return { serialized, copy };
    } catch (error) {
      const kind = isStoredStringCorruptionError(error) ? "CORRUPTED" : "UNAVAILABLE";
      return { serialized: null, copy: null, diagnostic: { key, error, kind } };
    }
  }

  private async loadEnvelope(slotId: number, adapter: StorageAdapter = this.adapter): Promise<SaveEnvelope | null> {
    const copy = await this.loadEnvelopeCopy(slotId, adapter, parseValidSaveEnvelopeCopy);
    return copy?.envelope ?? null;
  }

  private async loadEnvelopeCopy<T extends Pick<SaveEnvelope, "revision">>(slotId: number, adapter: StorageAdapter, parse: SaveCopyParser<T>): Promise<ValidSaveCopy<T> | null> {
    const [primaryCopy, pendingCopy] = await Promise.all([
      this.readEnvelopeCopy(slotKey(slotId), slotId, adapter, parse),
      this.readEnvelopeCopy(tempKey(slotId), slotId, adapter, parse),
    ]);
    const primary = primaryCopy.copy;
    const pending = pendingCopy.copy;
    const previousCopy = !primary && !pending ? await this.readEnvelopeCopy(previousKey(slotId), slotId, adapter, parse) : null;
    const previous = previousCopy?.copy;
    const hasPending = pendingCopy.serialized !== null || pendingCopy.diagnostic !== undefined;
    if (!primary && !pending && !previous) {
      const diagnostics = [primaryCopy.diagnostic, pendingCopy.diagnostic, previousCopy?.diagnostic]
        .filter((diagnostic): diagnostic is SaveCopyDiagnostic => diagnostic !== undefined);
      if (diagnostics.length) throw new SaveRecoveryError(diagnostics);
      return null;
    }
    if (pending && (!primary || pending.envelope.revision > primary.envelope.revision)) {
      await adapter.set(slotKey(slotId), pending.serialized);
      await adapter.remove(tempKey(slotId));
      return pending;
    }
    if (!primary && previous) {
      await adapter.set(slotKey(slotId), previous.serialized);
      if (hasPending) await adapter.remove(tempKey(slotId));
      return previous;
    }
    if (hasPending) await adapter.remove(tempKey(slotId));
    if (primary && primaryCopy.serialized !== primary.serialized) await adapter.set(slotKey(slotId), primary.serialized);
    return primary;
  }
}
