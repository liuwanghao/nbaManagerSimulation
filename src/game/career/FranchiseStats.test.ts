import { describe, expect, it } from "vitest";
import { MemoryStorageAdapter } from "../../platform/storage/StorageAdapter";
import { SaveService } from "../../storage/SaveService";
import { createCareer, simulateRegularSeason } from "../season/career";
import { emptyPlayerSeasonStats, type GameResult, type GameState, type TeamBoxScore } from "../state/types";
import { getFranchiseLeaders, recordFranchiseRegularGame } from "./FranchiseStats";

function result(gameId: string, userTeamId: string, playerId: string, points: number, userHome = true): GameResult {
  const opponent = "ATL";
  const box: TeamBoxScore = {
    teamId: userTeamId,
    score: points,
    playerStats: [{ ...emptyPlayerSeasonStats(), playerId, games: 1, pts: points, reb: 8, ast: 5 }],
    totals: { ...emptyPlayerSeasonStats(), pts: points, reb: 8, ast: 5 },
  };
  return {
    gameId, date: "2026-10-20", homeTeamId: userHome ? userTeamId : opponent,
    awayTeamId: userHome ? opponent : userTeamId,
    homeScore: userHome ? points : 70, awayScore: userHome ? 70 : points,
    winnerTeamId: userTeamId, overtimePeriods: 0,
    ...(userHome ? { homeBoxScore: box } : { awayBoxScore: box }),
  };
}

describe("franchise regular-season leaders", () => {
  it("accumulates only user-team box scores and keeps player totals after a trade", () => {
    const state = createCareer("career-flow");
    const playerId = state.teams[state.userTeamId].playerIds[0];
    recordFranchiseRegularGame(state, result("one", state.userTeamId, playerId, 20));
    state.players[playerId].teamId = "ATL";
    recordFranchiseRegularGame(state, result("two", state.userTeamId, playerId, 12, false));
    recordFranchiseRegularGame(state, result("opponent-only", "ATL", playerId, 50));

    const leaders = getFranchiseLeaders(state);
    expect(leaders.points[0]).toMatchObject({ playerId, games: 2, points: 32, rebounds: 16, assists: 10 });
    expect(leaders.coverage).toEqual({ status: "COMPLETE", countedGames: 2, expectedGames: 2 });
  });

  it("counts simulated user games exactly once from the user's box scores", () => {
    const state = simulateRegularSeason(createCareer("career-flow"), {
      autoAcknowledgeMajorInjuries: true, autoResolveEmergencyRosters: true, autoResolveEvents: true,
    });
    const boxes = Object.values(state.userGameDetails).map((game) => game.homeTeamId === state.userTeamId ? game.homeBoxScore! : game.awayBoxScore!);
    const leaders = getFranchiseLeaders(state);
    expect(leaders.points.reduce((sum, player) => sum + player.points, 0)).toBe(boxes.reduce((sum, box) => sum + box.playerStats.reduce((total, player) => total + player.pts, 0), 0));
    expect(leaders.coverage).toEqual({ status: "COMPLETE", countedGames: 82, expectedGames: 82 });
  }, 30_000);

  it("backfills legacy archives without double counting a current copy and labels missing boxes partial", async () => {
    const service = new SaveService(new MemoryStorageAdapter());
    const legacy = createCareer("career-flow");
    const playerId = legacy.teams[legacy.userTeamId].playerIds[0];
    const full = result("retained", legacy.userTeamId, playerId, 25);
    const missing = result("compressed", legacy.userTeamId, playerId, 11);
    legacy.history.seasons.push({
      seasonId: "2025-26", championTeamId: "ATL", standings: {},
      regularSeasonResults: [full, missing], userRegularGameDetails: { retained: full },
      postseasonGameDetails: {},
      userPostseason: { enteredPlayIn: false, enteredPlayoffs: false, seriesWins: 0, conferenceFinals: false,
        finalsAppearance: false, champion: false, playoffWins: 0, playoffLosses: 0 },
    });
    legacy.lightweightResults = [full];
    legacy.userGameDetails = { retained: full };
    delete (legacy as Partial<GameState>).franchiseStats;
    await service.save(1, legacy);

    const loaded = await service.load(1);
    expect(loaded && getFranchiseLeaders(loaded).points[0]).toMatchObject({ playerId, games: 1, points: 25 });
    expect(loaded?.franchiseStats.coverage).toEqual({ status: "PARTIAL", countedGames: 1, expectedGames: 2 });
    await service.save(1, loaded!);
    expect((await service.load(1))?.franchiseStats).toEqual(loaded?.franchiseStats);
  });
});
