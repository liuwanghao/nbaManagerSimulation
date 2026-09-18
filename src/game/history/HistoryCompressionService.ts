import type { GameResult, GameState, SeasonHistoryArchive } from "../state/types";
import { BALANCE_CONFIG } from "../../config/balanceConfig";

const postseasonOffset = (game: GameResult): number => Number.parseInt(game.date.replace("POST-", ""), 10);
const seriesKey = (game: GameResult): string => [game.homeTeamId, game.awayTeamId].sort().join("::");

function significantRegularGame(game: GameResult, userTeamId: string): boolean {
  const thresholds = BALANCE_CONFIG.historyCompression.recordThresholds;
  const userBox = game.homeTeamId === userTeamId ? game.homeBoxScore : game.awayBoxScore;
  const recordPerformance = userBox?.playerStats.some((stat) => stat.pts >= thresholds.points || stat.reb >= thresholds.rebounds
    || stat.ast >= thresholds.assists || stat.stl >= thresholds.steals || stat.blk >= thresholds.blocks) ?? false;
  const majorInjury = game.injuryEvents?.some((event) => event.teamId === userTeamId && (event.severity === "LONG" || event.severity === "SEASON_ENDING")) ?? false;
  return recordPerformance || majorInjury;
}

function compressArchive(archive: SeasonHistoryArchive, userTeamId: string, preserveFirstWin: boolean): SeasonHistoryArchive {
  const regular = Object.values(archive.userRegularGameDetails).sort((left, right) => left.date.localeCompare(right.date) || left.gameId.localeCompare(right.gameId));
  const firstWin = preserveFirstWin ? regular.find((game) => game.winnerTeamId === userTeamId) : undefined;
  const keptRegular = regular.filter((game) => game.gameId === firstWin?.gameId || significantRegularGame(game, userTeamId));

  const postseason = Object.values(archive.postseasonGameDetails);
  const bySeries = new Map<string, GameResult[]>();
  for (const game of postseason) {
    const key = seriesKey(game);
    bySeries.set(key, [...(bySeries.get(key) ?? []), game]);
  }
  const gameSevenIds = new Set([...bySeries.values()].filter((games) => games.length === BALANCE_CONFIG.historyCompression.decidingSeriesGameCount)
    .map((games) => [...games].sort((left, right) => postseasonOffset(left) - postseasonOffset(right)).at(-1)?.gameId)
    .filter((id): id is string => Boolean(id)));
  const keptPostseason = postseason.filter((game) => game.homeTeamId === userTeamId || game.awayTeamId === userTeamId
    || postseasonOffset(game) >= BALANCE_CONFIG.historyCompression.finalsDateOffset || gameSevenIds.has(game.gameId));
  return {
    ...archive,
    userRegularGameDetails: Object.fromEntries(keptRegular.map((game) => [game.gameId, game])),
    postseasonGameDetails: Object.fromEntries(keptPostseason.map((game) => [game.gameId, game])),
  };
}

export function compressHistoricalArchives(state: GameState): void {
  const fullSeasonsToKeep = BALANCE_CONFIG.historyCompression.fullSeasonsToKeep;
  if (state.history.seasons.length <= fullSeasonsToKeep) return;
  const fullSeasonIds = new Set(state.history.seasons.slice(-fullSeasonsToKeep).map((season) => season.seasonId));
  let firstWinPreserved = false;
  state.history.seasons = state.history.seasons.map((archive) => {
    if (fullSeasonIds.has(archive.seasonId)) return archive;
    const hasEarlierFirstWin = firstWinPreserved;
    const compressed = compressArchive(archive, state.userTeamId, !hasEarlierFirstWin);
    if (Object.values(compressed.userRegularGameDetails).some((game) => game.winnerTeamId === state.userTeamId)) firstWinPreserved = true;
    return compressed;
  });
}
