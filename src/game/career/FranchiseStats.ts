import type { FranchisePlayerTotals, FranchiseStatsState, GameResult, GameState, TeamBoxScore } from "../state/types";

export interface FranchiseLeaders {
  points: FranchisePlayerTotals[];
  rebounds: FranchisePlayerTotals[];
  assists: FranchisePlayerTotals[];
  coverage: FranchiseStatsState["coverage"];
}

export function createFranchiseStatsState(): FranchiseStatsState {
  return { players: {}, coverage: { status: "COMPLETE", countedGames: 0, expectedGames: 0 } };
}

function userBoxScore(result: GameResult, userTeamId: string): TeamBoxScore | undefined {
  if (result.homeTeamId === userTeamId) return result.homeBoxScore?.teamId === userTeamId ? result.homeBoxScore : undefined;
  if (result.awayTeamId === userTeamId) return result.awayBoxScore?.teamId === userTeamId ? result.awayBoxScore : undefined;
  return undefined;
}

function addBoxScore(stats: FranchiseStatsState, box: TeamBoxScore, state: GameState): void {
  for (const player of box.playerStats) {
    const totals = stats.players[player.playerId] ??= {
      playerId: player.playerId,
      playerName: state.players[player.playerId]?.name ?? player.playerId,
      games: 0,
      points: 0,
      rebounds: 0,
      assists: 0,
    };
    totals.games += 1;
    totals.points += player.pts;
    totals.rebounds += player.reb;
    totals.assists += player.ast;
  }
  stats.coverage.countedGames += 1;
}

/** Called exactly once when a scheduled user regular-season game becomes final. */
export function recordFranchiseRegularGame(state: GameState, result: GameResult): void {
  if (result.homeTeamId !== state.userTeamId && result.awayTeamId !== state.userTeamId) return;
  state.franchiseStats ??= createFranchiseStatsState();
  state.franchiseStats.coverage.expectedGames += 1;
  const box = userBoxScore(result, state.userTeamId);
  if (box) addBoxScore(state.franchiseStats, box, state);
  else state.franchiseStats.coverage.status = "PARTIAL";
}

/** Reconstructs the games still available in a legacy save, including archived seasons. */
export function backfillFranchiseStats(state: GameState): FranchiseStatsState {
  const stats = createFranchiseStatsState();
  const expectedIds = new Set<string>();
  const details = new Map<string, GameResult>();
  const includeResult = (result: GameResult): void => {
    if (result.homeTeamId === state.userTeamId || result.awayTeamId === state.userTeamId) expectedIds.add(result.gameId);
  };
  const includeDetails = (results: Record<string, GameResult> | undefined): void => {
    for (const result of Object.values(results ?? {})) {
      if (result.homeTeamId !== state.userTeamId && result.awayTeamId !== state.userTeamId) continue;
      expectedIds.add(result.gameId);
      if (!details.has(result.gameId)) details.set(result.gameId, result);
    }
  };
  for (const archive of state.history.seasons) {
    for (const result of archive.regularSeasonResults ?? []) includeResult(result);
    includeDetails(archive.userRegularGameDetails);
  }
  for (const result of state.lightweightResults ?? []) includeResult(result);
  includeDetails(state.userGameDetails);
  for (const gameId of [...expectedIds].sort()) {
    const detail = details.get(gameId);
    const box = detail && userBoxScore(detail, state.userTeamId);
    if (box) addBoxScore(stats, box, state);
  }
  stats.coverage.expectedGames = expectedIds.size;
  if (stats.coverage.countedGames < stats.coverage.expectedGames) stats.coverage.status = "PARTIAL";
  return stats;
}

/** Sorted copies keep the persisted totals immutable for read-only Career pages. */
export function getFranchiseLeaders(state: GameState): FranchiseLeaders {
  const stats = state.franchiseStats ?? backfillFranchiseStats(state);
  const players = Object.values(stats.players).map((player) => ({ ...player }));
  const sorted = (metric: "points" | "rebounds" | "assists"): FranchisePlayerTotals[] =>
    [...players].sort((a, b) => b[metric] - a[metric] || a.playerName.localeCompare(b.playerName) || a.playerId.localeCompare(b.playerId));
  return {
    points: sorted("points"),
    rebounds: sorted("rebounds"),
    assists: sorted("assists"),
    coverage: { ...stats.coverage },
  };
}
