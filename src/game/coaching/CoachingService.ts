import { SIMULATION_CONFIG } from "../simulation/config";
import { stableHash } from "../random/hash";
import type { CoachingFocus, CoachingState, GameResult, GameState, ScheduleGame } from "../state/types";

export type CoachingCommand =
  | { type: "UNLOCK_REGULAR_PREP"; gameId: string }
  | { type: "SET_REGULAR_PLAN"; gameId: string; focus: CoachingFocus }
  | { type: "USE_FIVE_GAME_REVIEW"; afterGameId: string; benefit: "FATIGUE"; playerIds: string[] }
  | { type: "USE_FIVE_GAME_REVIEW"; afterGameId: string; benefit: "TEAM_FATIGUE" }
  | { type: "USE_FIVE_GAME_REVIEW"; afterGameId: string; benefit: "MORALE_TWO" }
  | { type: "USE_FIVE_GAME_REVIEW"; afterGameId: string; benefit: "MORALE" }
  | { type: "SET_PLAYOFF_PLAN"; gameId: string; seriesId: string; focus: CoachingFocus };

export type CoachingGameModifier = NonNullable<GameResult["coaching"]>;
export type RegularPregameSelection = { gameId: string; choice: CoachingFocus | "NONE" };

const regularPhases = new Set<GameState["league"]["currentPhase"]>(["REGULAR_SEASON", "REGULAR_PRE_DEADLINE", "REGULAR_POST_DEADLINE"]);
const isUserGame = (state: GameState, game: ScheduleGame): boolean => game.homeTeamId === state.userTeamId || game.awayTeamId === state.userTeamId;
const bySchedule = (left: ScheduleGame, right: ScheduleGame): number => left.dateIndex - right.dateIndex || left.id.localeCompare(right.id);

function currentCoaching(state: GameState): CoachingState {
  return state.coaching?.seasonId === state.league.seasonId
    ? state.coaching
    : { seasonId: state.league.seasonId, usedPlayoffRounds: [] };
}

export function nextRegularUserGame(state: GameState): ScheduleGame | undefined {
  if (!regularPhases.has(state.league.currentPhase)) return undefined;
  return state.schedule.filter((game) => game.status === "SCHEDULED" && isUserGame(state, game)).sort(bySchedule)[0];
}

export function nextPlayoffUserGame(state: GameState): { game: ScheduleGame; seriesId: string; round: NonNullable<GameState["postseason"]>["series"][number]["round"] } | undefined {
  if (!["PLAY_IN", "PLAYOFFS"].includes(state.league.currentPhase)) return undefined;
  const game = state.postseason?.schedule.filter((entry) => entry.status === "SCHEDULED" && isUserGame(state, entry)).sort(bySchedule)[0];
  const series = game && state.postseason?.series.find((entry) => entry.gameIds.includes(game.id));
  return game && series ? { game, seriesId: series.id, round: series.round } : undefined;
}

export function highFatiguePlayerIds(state: GameState): string[] {
  return state.teams[state.userTeamId].playerIds.filter((id) => {
    const player = state.players[id];
    return player?.available && !player.injury && player.fatigue > SIMULATION_CONFIG.coaching.highFatigueThreshold;
  }).sort((left, right) => state.players[right].fatigue - state.players[left].fatigue || left.localeCompare(right));
}

export function lowMoralePlayerIds(state: GameState): string[] {
  return state.teams[state.userTeamId].playerIds.filter((id) => state.players[id]?.morale < SIMULATION_CONFIG.coaching.lowMoraleThreshold)
    .sort((left, right) => state.players[left].morale - state.players[right].morale || left.localeCompare(right));
}

export function randomReviewMoraleTargetIds(state: GameState, afterGameId: string): string[] {
  const roster = state.teams[state.userTeamId].playerIds.filter((id) => state.players[id] && state.players[id].morale < 100);
  const byDraw = (left: string, right: string) => stableHash(state.seeds.careerSeed, state.league.seasonId, afterGameId, "review-morale-two", left)
    .localeCompare(stableHash(state.seeds.careerSeed, state.league.seasonId, afterGameId, "review-morale-two", right)) || left.localeCompare(right);
  const low = roster.filter((id) => state.players[id].morale < SIMULATION_CONFIG.coaching.lowMoraleThreshold).sort(byDraw);
  const others = roster.filter((id) => state.players[id].morale >= SIMULATION_CONFIG.coaching.lowMoraleThreshold).sort(byDraw);
  return [...low, ...others].slice(0, 2);
}

export function regularCoachingView(state: GameState): { gameId: string; selected?: CoachingState["regularPlan"]; videoUnlocked: boolean } | undefined {
  const game = nextRegularUserGame(state) ?? nextPlayoffUserGame(state)?.game;
  if (!game) return undefined;
  const coaching = currentCoaching(state);
  const selected = coaching.regularPlan?.gameId === game.id && (coaching.regularPlan.focus === "OFFENSE" || coaching.regularPlan.focus === "DEFENSE")
    ? coaching.regularPlan : undefined;
  return { gameId: game.id, selected, videoUnlocked: coaching.regularVideoGameId === game.id };
}

export function fiveGameReviewView(state: GameState): { afterGameId: string; fatigueCandidates: string[]; moraleCandidates: string[]; moraleTwoTargets: string[]; wins: number; losses: number } | undefined {
  const review = currentCoaching(state).fiveGameReview;
  if (!review || !nextRegularUserGame(state)) return undefined;
  const latest = state.schedule.filter((game) => game.status === "FINAL" && isUserGame(state, game)).sort(bySchedule).at(-1);
  if (latest?.id !== review.afterGameId) return undefined;
  const fatigueCandidates = highFatiguePlayerIds(state);
  const moraleCandidates = lowMoralePlayerIds(state);
  const moraleTwoTargets = moraleCandidates.length ? randomReviewMoraleTargetIds(state, review.afterGameId) : [];
  const recent = state.schedule.filter((game) => game.status === "FINAL" && isUserGame(state, game)).sort(bySchedule).slice(-5);
  const wins = recent.filter((game) => game.winnerTeamId === state.userTeamId).length;
  return fatigueCandidates.length || moraleCandidates.length ? { afterGameId: review.afterGameId, fatigueCandidates, moraleCandidates, moraleTwoTargets, wins, losses: recent.length - wins } : undefined;
}

export function playoffCoachingView(state: GameState): { gameId: string; seriesId: string; selected?: CoachingState["playoffPlan"]; used: boolean } | undefined {
  const upcoming = nextPlayoffUserGame(state);
  if (!upcoming) return undefined;
  const coaching = currentCoaching(state);
  return {
    gameId: upcoming.game.id, seriesId: upcoming.seriesId,
    selected: coaching.playoffPlan?.gameId === upcoming.game.id ? coaching.playoffPlan : undefined,
    used: coaching.usedPlayoffRounds.includes(upcoming.round),
  };
}

function validateSelectedPlayers(state: GameState, ids: string[], eligible: string[], requiredCount?: number): void {
  if (ids.length < 1 || ids.length > 2 || (requiredCount && ids.length !== requiredCount)
    || new Set(ids).size !== ids.length || ids.some((id) => !eligible.includes(id))) throw new Error("COACHING_PLAYERS_INVALID");
  if (ids.some((id) => !state.players[id])) throw new Error("COACHING_PLAYERS_INVALID");
}

export function executeCoachingCommand(input: GameState, command: CoachingCommand): GameState {
  const coaching = { ...currentCoaching(input), usedPlayoffRounds: [...currentCoaching(input).usedPlayoffRounds] };
  const state: GameState = { ...input, coaching };
  if (command.type === "UNLOCK_REGULAR_PREP") {
    const view = regularCoachingView(input);
    if (!view || view.gameId !== command.gameId || view.videoUnlocked) throw new Error("COACHING_PREGAME_UNAVAILABLE");
    coaching.regularVideoGameId = command.gameId;
    return state;
  }
  if (command.type === "SET_REGULAR_PLAN") {
    const view = regularCoachingView(input);
    if (!view || view.gameId !== command.gameId) throw new Error("COACHING_PREGAME_UNAVAILABLE");
    if (command.focus !== "OFFENSE" && command.focus !== "DEFENSE") throw new Error("COACHING_FOCUS_INVALID");
    coaching.regularPlan = { gameId: command.gameId, focus: command.focus };
    return state;
  }
  if (command.type === "SET_PLAYOFF_PLAN") {
    const view = playoffCoachingView(input);
    if (!view || view.gameId !== command.gameId || view.seriesId !== command.seriesId || view.used) throw new Error("COACHING_PLAYOFF_UNAVAILABLE");
    if (command.focus !== "OFFENSE" && command.focus !== "DEFENSE") throw new Error("COACHING_FOCUS_INVALID");
    coaching.playoffPlan = { gameId: command.gameId, seriesId: command.seriesId, focus: command.focus };
    coaching.usedPlayoffRounds.push(nextPlayoffUserGame(input)!.round);
    return state;
  }
  const view = fiveGameReviewView(input);
  if (!view || view.afterGameId !== command.afterGameId) throw new Error("COACHING_REVIEW_UNAVAILABLE");
  state.players = { ...input.players };
  if (command.benefit === "FATIGUE") {
    validateSelectedPlayers(input, command.playerIds, view.fatigueCandidates);
    for (const id of command.playerIds) {
      const player = { ...input.players[id] };
      player.fatigue = Math.max(0, Math.round((player.fatigue - SIMULATION_CONFIG.coaching.reviewFatigueRecovery) * 100) / 100);
      state.players[id] = player;
    }
  } else if (command.benefit === "TEAM_FATIGUE") {
    if (!view.fatigueCandidates.length) throw new Error("COACHING_REVIEW_UNAVAILABLE");
    for (const id of input.teams[input.userTeamId].playerIds) {
      const player = input.players[id];
      if (!player) continue;
      state.players[id] = { ...player, fatigue: Math.max(0, Math.round((player.fatigue - SIMULATION_CONFIG.coaching.reviewTeamFatigueRecovery) * 100) / 100) };
    }
  } else if (command.benefit === "MORALE_TWO") {
    if (!view.moraleCandidates.length || view.moraleTwoTargets.length !== 2) throw new Error("COACHING_REVIEW_UNAVAILABLE");
    for (const id of view.moraleTwoTargets) {
      const player = input.players[id];
      state.players[id] = { ...player, morale: Math.min(100, Math.round((player.morale + SIMULATION_CONFIG.coaching.reviewTwoPlayerMoraleBoost) * 100) / 100) };
    }
  } else {
    if (!view.moraleCandidates.length) throw new Error("COACHING_REVIEW_UNAVAILABLE");
    for (const id of input.teams[input.userTeamId].playerIds) {
      const player = input.players[id];
      if (!player) continue;
      state.players[id] = { ...player, morale: Math.min(100, Math.round((player.morale + SIMULATION_CONFIG.coaching.reviewTeamMoraleBoost) * 100) / 100) };
    }
  }
  delete coaching.fiveGameReview;
  return state;
}

export function applyRegularPregameSelection(input: GameState, draft: RegularPregameSelection | null): GameState {
  const view = regularCoachingView(input);
  if (!view) return input;
  const selection = draft?.gameId === view.gameId ? draft : null;
  if (selection?.choice === "NONE" || !view.videoUnlocked) {
    if (!view.selected) return input;
    const coaching = { ...input.coaching! };
    delete coaching.regularPlan;
    return { ...input, coaching };
  }
  if (!selection) return input;
  return executeCoachingCommand(input, { type: "SET_REGULAR_PLAN", gameId: selection.gameId, focus: selection.choice });
}

export function offerCoachingReview(input: GameState, completedGameIds: string[]): GameState {
  if (!completedGameIds.length || completedGameIds.length > 5 || new Set(completedGameIds).size !== completedGameIds.length || !nextRegularUserGame(input)) return input;
  const completed = input.schedule.filter((game) => game.status === "FINAL" && isUserGame(input, game)).sort(bySchedule);
  const latestIds = completed.slice(-completedGameIds.length).map((game) => game.id);
  if (latestIds.some((id, index) => id !== completedGameIds[index])) return input;
  const completedBeforeAction = completed.length - completedGameIds.length;
  const checkpoint = currentCoaching(input).lastReviewAtGameCount ?? Math.floor(completedBeforeAction / 5) * 5;
  if (completed.length - checkpoint < 5) return input;
  const coaching: CoachingState = { ...currentCoaching(input), lastReviewAtGameCount: completed.length };
  if (highFatiguePlayerIds(input).length || lowMoralePlayerIds(input).length) {
    coaching.fiveGameReview = { afterGameId: completed.at(-1)!.id };
  }
  return { ...input, coaching };
}

export function consumeRegularCoachingForGame(state: GameState, game: ScheduleGame): CoachingGameModifier | undefined {
  if (!isUserGame(state, game)) return undefined;
  if (state.coaching?.seasonId === state.league.seasonId) delete state.coaching.fiveGameReview;
  const videoUnlocked = currentCoaching(state).regularVideoGameId === game.id;
  if (videoUnlocked && state.coaching) delete state.coaching.regularVideoGameId;
  const plan = currentCoaching(state).regularPlan;
  if (!plan || plan.gameId !== game.id) return undefined;
  if (state.coaching) delete state.coaching.regularPlan;
  if (!videoUnlocked || (plan.focus !== "OFFENSE" && plan.focus !== "DEFENSE")) return undefined;
  const postseasonGame = state.postseason?.schedule.some((entry) => entry.id === game.id) ?? false;
  return { teamId: state.userTeamId, focus: plan.focus, efficiencyPoints: postseasonGame ? SIMULATION_CONFIG.coaching.playoffEfficiencyPoints : SIMULATION_CONFIG.coaching.regularEfficiencyPoints };
}

export function consumePlayoffCoachingForGame(state: GameState, game: ScheduleGame): CoachingGameModifier | undefined {
  const plan = currentCoaching(state).playoffPlan;
  if (!plan || plan.gameId !== game.id || !isUserGame(state, game)) return undefined;
  if (state.coaching) delete state.coaching.playoffPlan;
  return { teamId: state.userTeamId, focus: plan.focus, efficiencyPoints: SIMULATION_CONFIG.coaching.playoffEfficiencyPoints };
}
