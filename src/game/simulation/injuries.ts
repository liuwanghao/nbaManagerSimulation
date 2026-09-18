import { BALANCE_CONFIG } from "../../config/balanceConfig";
import { stableHash } from "../random/hash";
import { createRng } from "../random/xoshiro";
import type { GameState, InjuryEvent, InjurySeverity, Player, PlayerBoxScore, ScheduleGame, TeamBoxScore } from "../state/types";
import { enqueueEvent } from "../events/EventService";
import { calculatePlayerOverall } from "../player/PlayerRatingService";

const SEVERITIES: InjurySeverity[] = ["MINOR", "SHORT", "MEDIUM", "LONG", "SEASON_ENDING"];

function injuryProbability(player: Player, seconds: number): number {
  const cfg = BALANCE_CONFIG.injuries;
  const durabilityRisk = Math.max(0, Math.min(1, (cfg.injuryRatingInfluence.baseline - player.injuryRating) / cfg.injuryRatingInfluence.divisor));
  const minutesFactor = cfg.minutes.baseMultiplier + Math.min(cfg.minutes.maximumRatio, seconds / (cfg.minutes.referenceMinutes * 60)) * cfg.minutes.multiplier;
  const ageFactor = player.age <= 25 ? cfg.ageMultipliers.age25AndUnder : player.age <= 30 ? cfg.ageMultipliers.age26To30 : player.age <= 34 ? cfg.ageMultipliers.age31To34 : cfg.ageMultipliers.age35AndOver;
  const fatigueFactor = 1 + Math.max(0, player.fatigue) / cfg.fatigueDivisor;
  const historyFactor = 1 + Math.min(cfg.history.maximumAddition, (player.career?.careerInjuryGamesMissed ?? 0) / cfg.history.missedGamesDivisor);
  return BALANCE_CONFIG.injuries.basePerPlayerGameProbability
    * (cfg.injuryRatingInfluence.baseMultiplier + durabilityRisk * cfg.injuryRatingInfluence.riskMultiplier)
    * minutesFactor
    * ageFactor
    * fatigueFactor
    * historyFactor;
}

function severityFor(player: Player, roll: number): InjurySeverity {
  const cfg = BALANCE_CONFIG.injuries;
  const adjustment = cfg.severityAdjustment;
  const adjusted = Math.min(0.999, roll + Math.max(0, player.age - adjustment.ageStart) * adjustment.agePerYear
    + Math.max(0, adjustment.injuryRatingStart - player.injuryRating) * adjustment.injuryRatingPerPoint);
  let cumulative = 0;
  for (const severity of SEVERITIES) {
    cumulative += cfg.severityWeights[severity] / 100;
    if (adjusted < cumulative) return severity;
  }
  return SEVERITIES.at(-1) as InjurySeverity;
}

function eventForPlayer(game: ScheduleGame, player: Player, teamId: string, stat: PlayerBoxScore, seasonSeed: string): InjuryEvent | null {
  if (stat.seconds <= 0 || player.injury || !player.available) return null;
  const rng = createRng(stableHash(seasonSeed, "injury", game.id, player.id));
  if (rng.nextFloat() >= injuryProbability(player, stat.seconds)) return null;
  const severity = severityFor(player, rng.nextFloat());
  const [minimum, maximum] = BALANCE_CONFIG.injuries.durationGames[severity];
  const gamesOut = rng.int(minimum, maximum);
  return {
    injuryId: stableHash(game.seasonId, game.id, player.id, severity),
    playerId: player.id,
    teamId,
    severity,
    gamesOut,
    gameId: game.id,
    seasonId: game.seasonId,
  };
}

function boxEvents(game: ScheduleGame, box: TeamBoxScore, players: Record<string, Player>, seasonSeed: string): InjuryEvent[] {
  return box.playerStats.flatMap((stat) => {
    const player = players[stat.playerId];
    const event = player ? eventForPlayer(game, player, box.teamId, stat, seasonSeed) : null;
    return event ? [event] : [];
  });
}

export function generateGameInjuries(
  game: ScheduleGame,
  homeBoxScore: TeamBoxScore,
  awayBoxScore: TeamBoxScore,
  players: Record<string, Player>,
  seasonSeed: string,
): InjuryEvent[] {
  return [...boxEvents(game, homeBoxScore, players, seasonSeed), ...boxEvents(game, awayBoxScore, players, seasonSeed)]
    .sort((left, right) => left.playerId.localeCompare(right.playerId));
}

export function isMajorInjury(severity: InjurySeverity): boolean {
  return SEVERITIES.indexOf(severity) >= SEVERITIES.indexOf(BALANCE_CONFIG.injuries.majorSeverityThreshold);
}

function normalizeRotation(state: GameState, teamId: string): void {
  const rotation = BALANCE_CONFIG.rosterRotation;
  const healthy = state.teams[teamId].playerIds.map((id) => state.players[id])
    .filter((player) => player && player.available && !player.injury)
    .sort((left, right) => {
      const leftOverall = calculatePlayerOverall(left);
      const rightOverall = calculatePlayerOverall(right);
      return rightOverall - leftOverall || left.id.localeCompare(right.id);
    });
  healthy.forEach((player, index) => {
    player.rotationRole = index < rotation.starters ? "STARTER" : index === rotation.sixthManIndex ? "SIXTH_MAN" : index < rotation.rotationEndIndex ? "ROTATION" : "BENCH";
  });
  for (const playerId of state.teams[teamId].playerIds) if (state.players[playerId].injury) state.players[playerId].rotationRole = "OUT";
}

export function applyInjuryEvents(state: GameState, events: InjuryEvent[]): void {
  for (const event of events) {
    const player = state.players[event.playerId];
    if (!player || player.injury) continue;
    player.injury = {
      injuryId: event.injuryId,
      severity: event.severity,
      gamesRemaining: event.gamesOut,
      occurredSeasonId: event.seasonId,
      occurredGameId: event.gameId,
      previousRotationRole: player.rotationRole,
    };
    player.available = false;
    player.health = Math.min(player.health ?? 100, BALANCE_CONFIG.injuries.healthAfterInjury[event.severity]);
    player.rotationRole = "OUT";
    if (event.teamId === state.userTeamId) {
      enqueueEvent(state, isMajorInjury(event.severity) ? "injury_core_major_001" : "injury_depth_test_001", { player_id: player.id, player_name: player.name });
    }
    if (!state.injuryState.pendingUserMajorInjury
      && event.teamId === state.userTeamId
      && player.teamRole === "FRANCHISE_CORE"
      && isMajorInjury(event.severity)) {
      state.injuryState.pendingUserMajorInjury = event;
    }
  }
  state.injuryState.recentEvents = [...state.injuryState.recentEvents, ...events]
    .slice(-BALANCE_CONFIG.injuries.recentEventLimit);
  for (const teamId of new Set(events.map((event) => event.teamId))) normalizeRotation(state, teamId);
}

export function advanceInjuriesAfterGames(state: GameState, teamIds: string[], newInjuryIds: Set<string>): void {
  for (const teamId of [...new Set(teamIds)].sort()) {
    for (const playerId of state.teams[teamId].playerIds) {
      const player = state.players[playerId];
      const injury = player.injury;
      if (!injury || newInjuryIds.has(injury.injuryId)) continue;
      if (player.career) player.career.careerInjuryGamesMissed += 1;
      const recovery = BALANCE_CONFIG.injuryRecovery;
      player.health = Math.min(recovery.maximumHealthBeforeFullRecovery, (player.health ?? recovery.defaultInjuredHealth)
        + Math.max(recovery.minimumPerGame, recovery.recoveryPool / Math.max(1, injury.gamesRemaining)));
      injury.gamesRemaining -= 1;
      if (injury.gamesRemaining <= 0) {
        player.available = true;
        player.health = recovery.fullHealth;
        player.rotationRole = injury.previousRotationRole;
        delete player.injury;
        if (teamId === state.userTeamId) enqueueEvent(state, "injury_recovery_001", { player_id: player.id, player_name: player.name });
      }
    }
    normalizeRotation(state, teamId);
  }
}

export function availablePlayerCount(state: GameState, teamId: string): number {
  return state.teams[teamId].playerIds.filter((playerId) => {
    const player = state.players[playerId];
    return player?.teamId === teamId && player.contract.status === "STANDARD" && player.available && !player.injury;
  }).length;
}

export function standardAvailablePlayerCount(state: GameState, teamId: string): number {
  return state.teams[teamId].playerIds.filter((playerId) => {
    const player = state.players[playerId];
    return player?.teamId === teamId
      && player.contract.status === "STANDARD"
      && player.contract.contractType !== "EMERGENCY"
      && player.available
      && !player.injury;
  }).length;
}
