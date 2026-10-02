import type { GameState, InjurySeverity, Player } from "../state/types";

const REGULAR_SEASON_DAYS = 174;
const REGULAR_SEASON_GAMES = 82;

export function daysForGames(games: number): number {
  return Math.max(1, Math.ceil(games * REGULAR_SEASON_DAYS / REGULAR_SEASON_GAMES));
}

export function injuryDaysRemaining(player: Player): number | null {
  if (!player.injury) return null;
  return player.injury.daysRemaining ?? daysForGames(player.injury.gamesRemaining);
}

export function injuryDurationLabel(severity: InjurySeverity, days: number): string {
  if (severity === "SEASON_ENDING") return "赛季报销";
  if (days < 7) return `预计伤停约 ${days} 天`;
  if (days < 28) return `预计伤停约 ${Math.round(days / 7)} 周`;
  return `预计伤停约 ${Math.round(days / 30)} 个月`;
}

export function estimatedInjuryMissedGames(state: GameState, player: Player): number | null {
  const days = injuryDaysRemaining(player);
  if (days === null) return null;
  const start = state.calendar.currentDateIndex;
  if (["REGULAR_SEASON", "REGULAR_PRE_DEADLINE", "REGULAR_POST_DEADLINE"].includes(state.league.currentPhase)) {
    const upcomingGames = state.schedule.filter((game) => game.status === "SCHEDULED"
      && game.dateIndex >= start && game.dateIndex < start + days
      && (game.homeTeamId === player.teamId || game.awayTeamId === player.teamId)).length;
    // A positive injury duration means the player misses at least the next
    // team game. Sparse calendar windows (especially 1–2 day injuries) can
    // otherwise round the displayed estimate down to an impossible 0.
    return upcomingGames > 0 ? upcomingGames : state.schedule.some((game) => game.status === "SCHEDULED"
      && game.dateIndex >= start
      && (game.homeTeamId === player.teamId || game.awayTeamId === player.teamId)) ? 1 : 0;
  }
  return Math.round(days * REGULAR_SEASON_GAMES / REGULAR_SEASON_DAYS);
}
