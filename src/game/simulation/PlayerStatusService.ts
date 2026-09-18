import type { GameState, PlayerBoxScore, TeamBoxScore } from "../state/types";
import { SIMULATION_CONFIG } from "./config";

const clamp = (value: number, minimum: number, maximum: number): number => Math.max(minimum, Math.min(maximum, Math.round(value * 100) / 100));

export function recoverFatigueBeforeGameDay(state: GameState, teamIds: string[], dateIndex: number): void {
  for (const teamId of new Set(teamIds)) {
    const previousDate = state.schedule.filter((game) => game.status === "FINAL" && (game.homeTeamId === teamId || game.awayTeamId === teamId))
      .reduce((latest, game) => Math.max(latest, game.dateIndex), -1);
    const restDays = previousDate < 0 ? Math.max(0, dateIndex) : Math.max(0, dateIndex - previousDate - 1);
    if (restDays <= 0) continue;
    for (const playerId of state.teams[teamId].playerIds) {
      const player = state.players[playerId];
      if (player) player.fatigue = clamp(player.fatigue - restDays * SIMULATION_CONFIG.fatigue.recoveryPerRestDay, 0, 100);
    }
  }
}

export function recoverFatigueForRestDays(state: GameState, teamIds: string[], restDays: number): void {
  if (restDays <= 0) return;
  for (const teamId of new Set(teamIds)) for (const playerId of state.teams[teamId].playerIds) {
    const player = state.players[playerId];
    if (player) player.fatigue = clamp(player.fatigue - restDays * SIMULATION_CONFIG.fatigue.recoveryPerRestDay, 0, 100);
  }
}

function updatePlayerStatus(state: GameState, stat: PlayerBoxScore, backToBack: boolean): void {
  const player = state.players[stat.playerId];
  if (!player || stat.seconds <= 0) return;
  const config = SIMULATION_CONFIG.fatigue;
  const status = SIMULATION_CONFIG.playerStatus;
  const minutes = stat.seconds / 60;
  const load = config.baseGameLoad
    + minutes * config.minutesLoad
    + (backToBack ? config.backToBackLoad : 0)
    + Math.max(0, player.age - status.ageLoadStart) * config.ageLoadAfter30
    - Math.max(0, player.attributes.athleticism - status.athleticismReliefStart) * config.athleticismRelief;
  player.fatigue = clamp(player.fatigue + Math.max(status.fatigueMinimumGameLoad, load), 0, 100);

  const pointsPer36 = stat.pts * status.pointsPer36Seconds / stat.seconds;
  const expectedPoints = status.expectedPointsBase + player.usageTendency * status.expectedPointsUsageWeight;
  const performanceDelta = clamp((pointsPer36 - expectedPoints) / status.formPerformanceDivisor, status.formDeltaMinimum, status.formDeltaMaximum);
  player.form = clamp(player.form * status.formCarryover + performanceDelta, status.formMinimum, status.formMaximum);
}

export function applyPlayerStatusAfterGame(state: GameState, boxes: Array<TeamBoxScore | undefined>, backToBackTeamIds: Set<string>): void {
  for (const box of boxes) {
    if (!box) continue;
    for (const stat of box.playerStats) updatePlayerStatus(state, stat, backToBackTeamIds.has(box.teamId));
  }
}
