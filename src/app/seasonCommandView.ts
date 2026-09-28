import type { GameResult, ScheduleGame } from "../game/state/types";

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
