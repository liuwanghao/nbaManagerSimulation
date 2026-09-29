import type { GameResult, GameState, ScheduleGame } from "../game/state/types";
import { calculatePlayerOverall } from "../game/player/PlayerRatingService";
import { estimatedInjuryMissedGames, injuryDaysRemaining } from "../game/simulation/injuries";

export interface InjuryListEntry {
  playerId: string;
  name: string;
  gamesRemaining: number | null;
  daysRemaining: number | null;
}

export function userInjuryList(state: GameState): InjuryListEntry[] {
  return state.teams[state.userTeamId].playerIds
    .map((playerId) => state.players[playerId])
    .filter((player) => player && (!player.available || player.injury))
    .sort((left, right) => calculatePlayerOverall(right) - calculatePlayerOverall(left) || left.id.localeCompare(right.id))
    .map((player) => ({ playerId: player.id, name: player.name, gamesRemaining: estimatedInjuryMissedGames(state, player), daysRemaining: injuryDaysRemaining(player) }))
    .slice(0, 2);
}

export function visibleInjuryList(
  saved: InjuryListEntry[],
  frames: Array<{ injuries: InjuryListEntry[] }> = [],
  completed = 0,
): InjuryListEntry[] {
  return completed > 0 ? frames[Math.min(completed, frames.length) - 1]?.injuries ?? saved : saved;
}

export function hasRemainingScheduledDay(
  schedule: Pick<ScheduleGame, "dateIndex" | "status">[],
  currentDateIndex: number,
  finalDateIndex: number,
): boolean {
  return currentDateIndex <= finalDateIndex
    && schedule.some((game) => game.status === "SCHEDULED" && game.dateIndex >= currentDateIndex && game.dateIndex <= finalDateIndex);
}

export function visibleRecentGames(
  savedGames: Record<string, GameResult>,
  frames: Array<{ game?: GameResult }> = [],
  completed = 0,
): GameResult[] {
  const games = new Map(Object.values(savedGames).map((game) => [game.gameId, game] as const));
  for (const frame of frames.slice(0, completed)) {
    if (frame.game) games.set(frame.game.gameId, frame.game);
  }
  return [...games.values()].slice(-5).reverse();
}
