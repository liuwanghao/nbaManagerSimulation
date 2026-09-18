import { EVENT_DEFINITION_BY_ID } from "../../data/events";
import { BALANCE_CONFIG } from "../../config/balanceConfig";
import { stableHash } from "../random/hash";
import type { EventDefinition, EventEffectDefinition, EventInstance, GameResult, GameState } from "../state/types";

export type EventCommand = {
  commandId: string;
  type: "RESOLVE_EVENT";
  payload: { eventInstanceId: string; choiceId: string };
};

export function createEventState(): GameState["eventState"] {
  return { queue: [], resolvedInstanceIds: [], executedEffectIds: [], lastOccurrenceByDefinition: {}, leagueLog: [] };
}

function careerGameCount(state: GameState): number {
  return state.history.seasons.reduce((sum, season) => sum + season.regularSeasonResults.length, 0) + state.lightweightResults.length;
}

function interpolate(template: string, context: Record<string, string>): string {
  return template.replace(/\{\{([a-z0-9_]+)\}\}/giu, (_match, key: string) => context[key] ?? "球队成员");
}

function snapshotEffect(effect: EventEffectDefinition, context: Record<string, string>): EventEffectDefinition {
  return {
    ...effect,
    target: effect.target ? interpolate(effect.target, context) : undefined,
    value: typeof effect.value === "string" ? interpolate(effect.value, context) : effect.value,
  };
}

const clampStatus = (
  value: number,
  minimum: number = BALANCE_CONFIG.randomEvents.status.minimum,
  maximum: number = BALANCE_CONFIG.randomEvents.status.maximum,
): number => Math.max(minimum, Math.min(maximum, Math.round(value * 100) / 100));

function applyEffects(state: GameState, event: EventInstance, effects: EventEffectDefinition[]): void {
  for (const effect of effects) {
    const executionId = `${event.eventInstanceId}:${effect.effectId}`;
    if (state.eventState.executedEffectIds.includes(executionId)) continue;
    if (effect.type === "LEAGUE_LOG") {
      state.eventState.leagueLog.unshift(String(effect.value));
    } else if (effect.type === "TEAM_FAN_SUPPORT" || effect.type === "TEAM_REPUTATION") {
      const team = state.teams[effect.target ?? state.userTeamId];
      if (team && typeof effect.value === "number") {
        if (effect.type === "TEAM_FAN_SUPPORT") team.fanSupport = clampStatus(team.fanSupport + effect.value);
        else team.franchiseReputation = clampStatus(team.franchiseReputation + effect.value);
      }
    } else {
      const player = effect.target ? state.players[effect.target] : undefined;
      if (player && typeof effect.value === "number") {
        if (effect.type === "PLAYER_MORALE") player.morale = clampStatus((player.morale ?? BALANCE_CONFIG.randomEvents.status.defaultMorale) + effect.value);
        else player.form = clampStatus(player.form + effect.value, BALANCE_CONFIG.randomEvents.status.formMinimum, BALANCE_CONFIG.randomEvents.status.formMaximum);
      }
    }
    state.eventState.executedEffectIds.push(executionId);
  }
  state.eventState.leagueLog = state.eventState.leagueLog.slice(0, BALANCE_CONFIG.randomEvents.leagueLogLimit);
}

function canOccur(state: GameState, definition: EventDefinition): boolean {
  const previous = state.eventState.lastOccurrenceByDefinition[definition.id];
  if (!previous) return true;
  if (definition.oncePerCareer) return false;
  if (definition.oncePerSeason && previous.seasonId === state.league.seasonId) return false;
  return careerGameCount(state) - previous.careerGame >= definition.cooldownGames;
}

function sortQueue(state: GameState): void {
  state.eventState.queue.sort((left, right) => right.priority - left.priority
    || left.scheduledAt.localeCompare(right.scheduledAt)
    || left.eventInstanceId.localeCompare(right.eventInstanceId));
}

export function enqueueEvent(
  state: GameState,
  definitionId: string,
  context: Record<string, string> = {},
  scheduledAt = `${state.league.seasonId}:D${state.calendar.currentDateIndex}`,
): EventInstance | undefined {
  const definition = EVENT_DEFINITION_BY_ID[definitionId];
  if (!definition) {
    state.eventState.leagueLog.unshift(`未知事件 ${definitionId} 已安全跳过`);
    state.eventState.leagueLog = state.eventState.leagueLog.slice(0, BALANCE_CONFIG.randomEvents.leagueLogLimit);
    return undefined;
  }
  if (!canOccur(state, definition)) return undefined;
  const eventInstanceId = stableHash(state.seeds.seasonSeed, definition.id, scheduledAt, careerGameCount(state));
  if (state.eventState.queue.some((event) => event.eventInstanceId === eventInstanceId)
    || state.eventState.resolvedInstanceIds.includes(eventInstanceId)) return undefined;
  const effectivePause = definition.visibility === "PLAYER_VISIBLE"
    && definition.pauseSimulation
    && definition.scope !== "AI_TEAM";
  const instance: EventInstance = {
    eventInstanceId,
    definitionId: definition.id,
    definitionVersion: definition.version,
    seasonId: state.league.seasonId,
    scheduledAt,
    priority: definition.priority,
    title: interpolate(definition.content.title, context),
    description: interpolate(definition.content.description, context),
    category: definition.category,
    illustrationKey: definition.visual.illustrationKey,
    effectivePause,
    autoEffects: definition.autoEffects.map((effect) => snapshotEffect(effect, context)),
    choices: definition.choices.map((choice) => ({ ...choice, effects: choice.effects.map((effect) => snapshotEffect(effect, context)) })),
    status: "PENDING",
  };
  state.eventState.lastOccurrenceByDefinition[definition.id] = { seasonId: state.league.seasonId, careerGame: careerGameCount(state) };
  applyEffects(state, instance, instance.autoEffects);
  if (definition.scope === "AI_TEAM" || definition.visibility === "BACKGROUND") {
    instance.status = "RESOLVED";
    instance.selectedChoiceId = definition.choices[0]?.id;
    applyEffects(state, instance, instance.choices[0]?.effects ?? []);
    state.eventState.resolvedInstanceIds.push(eventInstanceId);
    state.eventState.leagueLog.unshift(instance.title);
    return instance;
  }
  state.eventState.queue.push(instance);
  sortQueue(state);
  return instance;
}

export function nextPendingEvent(state: GameState): EventInstance | undefined {
  return state.eventState.queue.find((event) => event.status === "PENDING");
}

export function blockingEvent(state: GameState): EventInstance | undefined {
  return state.eventState.queue.find((event) => event.status === "PENDING" && event.effectivePause);
}

export function resolveEvent(input: GameState, eventInstanceId: string, choiceId: string): GameState {
  const state = structuredClone(input);
  const event = state.eventState.queue.find((candidate) => candidate.eventInstanceId === eventInstanceId && candidate.status === "PENDING");
  if (!event) throw new Error("EVENT_NOT_PENDING");
  if (!event.choices.some((choice) => choice.id === choiceId)) throw new Error("EVENT_CHOICE_INVALID");
  event.status = "RESOLVED";
  event.selectedChoiceId = choiceId;
  const choice = event.choices.find((candidate) => candidate.id === choiceId) as EventInstance["choices"][number];
  applyEffects(state, event, choice.effects ?? []);
  state.eventState.resolvedInstanceIds.push(event.eventInstanceId);
  state.eventState.leagueLog.unshift(`${event.title} · ${event.choices.find((choice) => choice.id === choiceId)?.label ?? choiceId}`);
  state.eventState.leagueLog = state.eventState.leagueLog.slice(0, BALANCE_CONFIG.randomEvents.leagueLogLimit);
  state.eventState.queue = state.eventState.queue.filter((candidate) => candidate.status === "PENDING");
  return state;
}

export function resolveAllEvents(input: GameState): GameState {
  let state = input;
  while (nextPendingEvent(state)) {
    const event = nextPendingEvent(state) as EventInstance;
    state = resolveEvent(state, event.eventInstanceId, event.choices[0]?.id ?? "acknowledge");
  }
  return state;
}

function consecutiveUserResults(state: GameState): GameResult[] {
  const userResults = state.lightweightResults.filter((game) => game.homeTeamId === state.userTeamId || game.awayTeamId === state.userTeamId);
  const latest = userResults.at(-1);
  if (!latest) return [];
  const latestWon = latest.winnerTeamId === state.userTeamId;
  const streak: GameResult[] = [];
  for (let index = userResults.length - 1; index >= 0; index -= 1) {
    const won = userResults[index].winnerTeamId === state.userTeamId;
    if (won !== latestWon) break;
    streak.push(userResults[index]);
  }
  return streak;
}

export function enqueueAfterUserGameEvents(state: GameState): void {
  const streak = consecutiveUserResults(state);
  if (!streak.length) return;
  const won = streak[0].winnerTeamId === state.userTeamId;
  for (const threshold of BALANCE_CONFIG.randomEvents.streakThresholds) {
    if (streak.length === threshold) enqueueEvent(state, `streak_${won ? "winning" : "losing"}_${String(threshold).padStart(3, "0")}`);
  }
  const userResults = state.lightweightResults.filter((game) => game.homeTeamId === state.userTeamId || game.awayTeamId === state.userTeamId);
  const eventConfig = BALANCE_CONFIG.randomEvents;
  if (userResults.length % eventConfig.triggerEveryUserGames === 0) {
    const latest = state.userGameDetails[userResults.at(-1)?.gameId ?? ""];
    const box = latest?.homeTeamId === state.userTeamId ? latest.homeBoxScore : latest?.awayBoxScore;
    const top = box?.playerStats.slice().sort((left, right) => right.pts - left.pts || left.playerId.localeCompare(right.playerId))[0];
    if (top) {
      const player = state.players[top.playerId];
      const category = top.pts >= eventConfig.breakoutPointsThreshold ? "BREAKOUT" : player.morale < eventConfig.moraleEventThreshold ? "MORALE" : won ? "ROLE" : "SLUMP";
      const recoveryActive = !won && streak.length >= eventConfig.losingStreakRecovery.minimumLosses;
      const recoveryCategories = new Set(["MORALE", "ROLE", "SLUMP"]);
      const dynamicCategories = new Set(["BREAKOUT", "MORALE", "ROLE", "SLUMP"]);
      const candidates = EVENT_DEFINITION_BY_ID ? Object.values(EVENT_DEFINITION_BY_ID).filter((definition) =>
        definition.category === category || recoveryActive && dynamicCategories.has(definition.category)) : [];
      const rollHash = stableHash(state.seeds.seasonSeed, "dynamic-event", userResults.length, top.playerId);
      const probabilityRoll = Number.parseInt(rollHash.slice(0, 8), 16) / 0xffffffff;
      if (candidates.length && probabilityRoll < eventConfig.triggerProbability) {
        const ordered = candidates.sort((left, right) => left.id.localeCompare(right.id));
        const weighted = ordered.map((definition) => ({
          definition,
          weight: definition.weight * (recoveryActive && recoveryCategories.has(definition.category)
            ? eventConfig.losingStreakRecovery.weightMultiplier
            : 1),
        }));
        const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);
        let target = (Number.parseInt(rollHash.slice(8, 16), 16) / 0xffffffff) * total;
        const selected = weighted.find((entry) => { target -= entry.weight; return target <= 0; }) ?? weighted.at(-1);
        if (selected) enqueueEvent(state, selected.definition.id, { player_id: player.id, player_name: player.name });
      }
    }
  }
  enqueueCareerMilestoneEvents(state);
}

export function enqueueCareerMilestoneEvents(state: GameState): void {
  const map = {
    EXPANSION_COMPLETE: "expansion_complete_001",
    FIRST_WIN: "franchise_first_win_001",
    TEN_WINS: "franchise_ten_wins_001",
    FIRST_PLAYOFFS: "playoffs_appearance_001",
    FIRST_SERIES_WIN: "playoffs_series_win_001",
    FINALS_APPEARANCE: "playoffs_finals_001",
    FIRST_CHAMPIONSHIP: "playoffs_champion_001",
    FIFTY_WIN_SEASON: "franchise_fifty_wins_001",
    SIXTY_WIN_SEASON: "franchise_sixty_wins_001",
    HOMEGROWN_ALL_STAR: "franchise_all_star_001",
    ROOKIE_OF_YEAR: "rookie_award_001",
    DYNASTY_TWO_OF_THREE: "franchise_dynasty_001",
  } as const;
  for (const [achievementId, definitionId] of Object.entries(map)) {
    if (state.achievements[achievementId as keyof typeof map]?.unlocked) enqueueEvent(state, definitionId);
  }
}

export function executeEventCommand(state: GameState, command: EventCommand): GameState {
  const payloadHash = stableHash(command.type, command.payload);
  const receipt = state.commandReceipts[command.commandId];
  if (receipt) {
    if (receipt.payloadHash !== payloadHash) throw new Error("Command ID 已被不同 Payload 使用");
    return state;
  }
  const next = resolveEvent(state, command.payload.eventInstanceId, command.payload.choiceId);
  next.commandReceipts[command.commandId] = { payloadHash };
  return next;
}
