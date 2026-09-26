import { EVENT_DEFINITION_BY_ID } from "../../data/events";
import { BALANCE_CONFIG } from "../../config/balanceConfig";
import { addTeamNotification } from "../notifications/TeamNotificationService";
import { applyRotationPlanToPlayers, planPlayerRotationResponse } from "../roster/RotationPlanService";
import { stableHash } from "../random/hash";
import type { EventDefinition, EventEffectDefinition, EventInstance, GameResult, GameState, Player } from "../state/types";

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
  const snapshot: EventEffectDefinition = {
    ...effect,
    value: typeof effect.value === "string" ? interpolate(effect.value, context) : effect.value,
  };
  if (effect.target) snapshot.target = interpolate(effect.target, context);
  return snapshot;
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
    } else if (effect.type === "PLAYER_ROTATION") {
      const team = state.teams[state.userTeamId];
      const players = team.playerIds.map((id) => state.players[id]).filter(Boolean);
      const plan = effect.target ? planPlayerRotationResponse(players, team.rotationPlan, effect.target,
        event.definitionId === "role_starter_claim_001") : null;
      if (plan) {
        team.rotationPlan = plan;
        applyRotationPlanToPlayers(players, plan);
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

function isInformationalEvent(event: EventInstance): boolean {
  return event.definitionId !== "franchise_season_opening_001"
    && event.choices.length === 1
    && event.choices[0].id === "acknowledge"
    && choicesForEvent(event).length === 1;
}

function informationalImpact(effects: EventEffectDefinition[]): string {
  return effects.map((effect) => {
    if (typeof effect.value !== "number") return "";
    const change = `${effect.value > 0 ? "+" : ""}${effect.value}`;
    if (effect.type === "TEAM_FAN_SUPPORT") return `球迷支持 ${change}`;
    if (effect.type === "TEAM_REPUTATION") return `球队声望 ${change}`;
    if (effect.type === "PLAYER_MORALE") return `球员士气 ${change}`;
    if (effect.type === "PLAYER_FORM") return `竞技状态 ${change}`;
    return "";
  }).filter(Boolean).join(" · ");
}

function settleInformationalEvent(state: GameState, event: EventInstance): void {
  event.status = "RESOLVED";
  event.effectivePause = false;
  event.selectedChoiceId = event.choices[0].id;
  applyEffects(state, event, event.choices[0].effects.filter((effect) => effect.type !== "LEAGUE_LOG"));
  for (const effect of event.choices[0].effects) {
    if (effect.type !== "LEAGUE_LOG") continue;
    const executionId = `${event.eventInstanceId}:${effect.effectId}`;
    if (!state.eventState.executedEffectIds.includes(executionId)) state.eventState.executedEffectIds.push(executionId);
  }
  if (!state.eventState.resolvedInstanceIds.includes(event.eventInstanceId)) state.eventState.resolvedInstanceIds.push(event.eventInstanceId);
  const definition = EVENT_DEFINITION_BY_ID[event.definitionId];
  if (definition?.scope === "PLAYER_TEAM" || definition?.visibility === "PLAYER_VISIBLE") {
    const impact = informationalImpact(event.choices[0].effects);
    addTeamNotification(state, {
      id: `event-${event.eventInstanceId}`,
      category: event.category === "STREAK" ? "TEAM" : event.category === "FREE_AGENCY" || event.category === "RFA" ? "FREE_AGENCY" : "SEASON",
      seasonId: event.seasonId,
      title: event.title,
      message: impact ? `${event.description} ${impact}` : event.description,
    });
  } else {
    state.eventState.leagueLog.unshift(event.description && event.description !== event.title
      ? `${event.title}：${event.description}` : event.title);
    state.eventState.leagueLog = state.eventState.leagueLog.slice(0, BALANCE_CONFIG.randomEvents.leagueLogLimit);
  }
}

/** Removes acknowledgement-only notices from older saves after their gameplay effects have already happened. */
export function settleInformationalEvents(state: GameState): void {
  for (const event of state.eventState.queue) {
    if (event.status === "PENDING" && isInformationalEvent(event)) settleInformationalEvent(state, event);
  }
  state.eventState.queue = state.eventState.queue.filter((event) => event.status === "PENDING");
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
  const repeatableInjuryNotice = definition.category === "INJURY" && !definition.pauseSimulation
    && definition.choices.length === 1
    && definition.choices[0].effects.every((effect) => effect.type === "LEAGUE_LOG");
  if (!repeatableInjuryNotice && !canOccur(state, definition)) return undefined;
  const eventInstanceId = repeatableInjuryNotice
    ? stableHash(state.seeds.seasonSeed, definition.id, scheduledAt, careerGameCount(state), context.player_id)
    : stableHash(state.seeds.seasonSeed, definition.id, scheduledAt, careerGameCount(state));
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
  if (isInformationalEvent(instance)) {
    settleInformationalEvent(state, instance);
    return instance;
  }
  if (definition.scope === "AI_TEAM" || definition.visibility === "BACKGROUND") {
    instance.status = "RESOLVED";
    instance.selectedChoiceId = definition.choices[0]?.id;
    applyEffects(state, instance, instance.choices[0]?.effects ?? []);
    state.eventState.resolvedInstanceIds.push(eventInstanceId);
    state.eventState.leagueLog.unshift(instance.title);
    state.eventState.leagueLog = state.eventState.leagueLog.slice(0, BALANCE_CONFIG.randomEvents.leagueLogLimit);
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

/** Keeps saves made before V1.43 actionable instead of trapping them on a notification-only morale event. */
export function choicesForEvent(event: EventInstance): EventInstance["choices"] {
  const legacyAcknowledgement = event.choices.length === 1 && event.choices[0]?.id === "acknowledge";
  if (!["MORALE", "ROLE"].includes(event.category)) return event.choices;
  const target = event.choices.flatMap((choice) => choice.effects).find((effect) => effect.type === "PLAYER_MORALE")?.target;
  const choices = legacyAcknowledgement ? [
    {
      id: "increase_role",
      label: event.definitionId === "role_starter_claim_001" ? "安排首发并调整轮换" : "增加出场时间",
      effects: [{ effectId: "morale_role_up", type: "PLAYER_MORALE", target, value: 12, executionPhase: "ON_CHOICE" }],
    },
    {
      id: "maintain_plan",
      label: "维持当前轮换",
      effects: [{ effectId: "morale_role_down", type: "PLAYER_MORALE", target, value: -8, executionPhase: "ON_CHOICE" }],
    },
  ] as EventInstance["choices"] : event.choices;
  return choices.map((choice) => choice.id === "increase_role" && !choice.effects.some((effect) => effect.type === "PLAYER_ROTATION")
    ? { ...choice, effects: [...choice.effects, { effectId: "rotation_response", type: "PLAYER_ROTATION", target, value: 6, executionPhase: "ON_CHOICE" }] }
    : choice);
}

export function resolveEvent(input: GameState, eventInstanceId: string, choiceId: string): GameState {
  const state = structuredClone(input);
  const event = state.eventState.queue.find((candidate) => candidate.eventInstanceId === eventInstanceId && candidate.status === "PENDING");
  if (!event) throw new Error("EVENT_NOT_PENDING");
  const choices = choicesForEvent(event);
  event.choices = choices;
  if (!choices.some((choice) => choice.id === choiceId)) throw new Error("EVENT_CHOICE_INVALID");
  event.status = "RESOLVED";
  event.selectedChoiceId = choiceId;
  const choice = choices.find((candidate) => candidate.id === choiceId) as EventInstance["choices"][number];
  applyEffects(state, event, choice.effects ?? []);
  state.eventState.resolvedInstanceIds.push(event.eventInstanceId);
  state.eventState.leagueLog.unshift(`${event.title} · ${choices.find((choice) => choice.id === choiceId)?.label ?? choiceId}`);
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

function chooseConversationPlayer(state: GameState, definition: EventDefinition, featured: Player, rollHash: string): Player | undefined {
  if (definition.category !== "MORALE" && definition.category !== "ROLE") return featured;
  const plan = state.teams[state.userTeamId].rotationPlan;
  const available = state.teams[state.userTeamId].playerIds.map((id) => state.players[id])
    .filter((player) => player?.available && !player.injury && (plan?.targetMinutes[player.id] ?? 0) < BALANCE_CONFIG.rotationPlan.regularSeasonMaximumMinutes);
  const eligible = available.filter((player) => {
    if (definition.id === "role_starter_claim_001") return player.rotationRole !== "STARTER";
    if (definition.id === "role_sixth_man_001") return player.rotationRole === "SIXTH_MAN";
    if (definition.id === "role_rookie_growth_001") return player.serviceYears <= 2;
    if (definition.id === "role_veteran_reduced_001" || definition.id === "morale_veteran_voice_001") return player.age >= 32;
    if (definition.id === "morale_minutes_001") return (plan?.targetMinutes[player.id] ?? 0) < 25;
    return true;
  }).sort((left, right) => left.id.localeCompare(right.id));
  return eligible.length ? eligible[Number.parseInt(rollHash.slice(0, 8), 16) % eligible.length] : undefined;
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
        if (selected) {
          const subject = chooseConversationPlayer(state, selected.definition, player, rollHash);
          if (subject) enqueueEvent(state, selected.definition.id, { player_id: subject.id, player_name: subject.name });
        }
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
