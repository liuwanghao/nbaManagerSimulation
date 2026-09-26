import { describe, expect, it } from "vitest";
import type { GameResult, GameState, SeasonHistoryArchive } from "../state/types";
import { createCareer } from "../season/career";
import { getCareerMilestones, getCareerOverview, getCareerSeasonSummaries, getFranchiseRecords } from "./CareerRecords";

function result(state: GameState, id: string, date: string, won: boolean): GameResult {
  const opponent = Object.keys(state.teams).find((teamId) => teamId !== state.userTeamId)!;
  return {
    gameId: id,
    date,
    homeTeamId: state.userTeamId,
    awayTeamId: opponent,
    homeScore: won ? 101 : 99,
    awayScore: won ? 99 : 101,
    winnerTeamId: won ? state.userTeamId : opponent,
    overtimePeriods: 0,
  };
}

function archive(state: GameState, seasonId: string, results: GameResult[], champion = false): SeasonHistoryArchive {
  return {
    seasonId,
    championTeamId: champion ? state.userTeamId : Object.keys(state.teams).find((teamId) => teamId !== state.userTeamId)!,
    standings: { [state.userTeamId]: { wins: results.filter((game) => game.winnerTeamId === state.userTeamId).length, losses: results.filter((game) => game.winnerTeamId !== state.userTeamId).length } },
    regularSeasonResults: results,
    userRegularGameDetails: {},
    postseasonGameDetails: {},
    userPostseason: {
      enteredPlayIn: false,
      enteredPlayoffs: champion,
      seriesWins: champion ? 4 : 0,
      conferenceFinals: champion,
      finalsAppearance: champion,
      champion,
      playoffWins: champion ? 16 : 0,
      playoffLosses: champion ? 7 : 0,
    },
  };
}

describe("career records selectors", () => {
  it("includes live standings and does not count an archived current season twice", () => {
    const state = createCareer("career-record-live");
    expect(getFranchiseRecords(state)).toMatchObject({ firstWin: null, bestSeason: null, longestWinningStreak: null });
    state.standings[state.userTeamId].wins = 3;
    state.standings[state.userTeamId].losses = 2;
    expect(getCareerOverview(state)).toMatchObject({ seasons: 0, regularSeasonWins: 3, regularSeasonLosses: 2 });
    expect(getCareerSeasonSummaries(state)).toMatchObject([{ seasonId: state.league.seasonId, isCurrent: true, postseason: "in-progress" }]);

    state.history.seasons.push(archive(state, state.league.seasonId, [result(state, "W", "2027-01-01", true)]));
    expect(getCareerOverview(state)).toMatchObject({ seasons: 1, regularSeasonWins: 1, regularSeasonLosses: 0 });
    expect(getCareerSeasonSummaries(state)).toMatchObject([{ seasonId: state.league.seasonId, isCurrent: false }]);
    expect(getFranchiseRecords(state).bestSeason).toMatchObject({ seasonId: state.league.seasonId, isCurrent: false });
  });

  it("summarizes archived honors and per-season manager activity", () => {
    const state = createCareer("career-record-history");
    const previousSeason = "2025-26";
    state.history.seasons.push(archive(state, previousSeason, [result(state, "W", "2026-01-01", true)], true));
    state.history.seasonAwards.push({ seasonId: previousSeason, allStars: { EAST: [], WEST: [] }, winners: { MVP: "mvp-player" } });
    state.gmCareer.draftHistory.push({ seasonId: previousSeason, pickNumber: 1, playerId: "rookie" });
    state.gmCareer.tradeHistory.push({ seasonId: state.league.seasonId, offerId: "trade", summary: "trade" });
    state.standings[state.userTeamId].wins = 2;
    state.standings[state.userTeamId].losses = 1;

    expect(getCareerSeasonSummaries(state)).toMatchObject([
      { seasonId: state.league.seasonId, wins: 2, losses: 1, tradeCount: 1, draftCount: 0, postseason: "in-progress" },
      { seasonId: previousSeason, isCurrent: false, wins: 1, losses: 0, tradeCount: 0, draftCount: 1, postseason: "champion", awards: { MVP: "mvp-player" } },
    ]);
    expect(getCareerOverview(state)).toMatchObject({ seasons: 1, regularSeasonWins: 3, regularSeasonLosses: 1, playoffWins: 16, championships: 1, draftCount: 1, tradeCount: 1 });
  });

  it("orders actual milestone unlocks and derives records from ordered results without mutating them", () => {
    const state = createCareer("career-record-milestones");
    state.achievements.FIRST_WIN = { unlocked: true, seasonId: "2025-26", unlockedAt: "2025-26:D20" };
    state.achievements.EXPANSION_COMPLETE = { unlocked: true, seasonId: "2025-26", unlockedAt: "2025-26:D1" };
    state.achievements.TEN_WINS = { unlocked: true, seasonId: "2025-26", unlockedAt: "2025-26:D30" };
    state.achievements.FIRST_CHAMPIONSHIP = { unlocked: true, seasonId: "2026-27", unlockedAt: "2026-27:D180" };
    expect(getCareerMilestones(state).map((entry) => [entry.id, entry.dayIndex])).toEqual([
      ["FIRST_CHAMPIONSHIP", 180], ["TEN_WINS", 30], ["FIRST_WIN", 20], ["EXPANSION_COMPLETE", 1],
    ]);

    const archivedResults = [
      result(state, "3", "2026-01-03", false),
      result(state, "2", "2026-01-02", true),
      result(state, "1", "2026-01-01", true),
    ];
    state.history.seasons.push(archive(state, "2025-26", archivedResults));
    state.standings[state.userTeamId].wins = 3;
    state.standings[state.userTeamId].losses = 1;
    state.lightweightResults = [
      result(state, "6", "2027-01-03", true),
      result(state, "5", "2027-01-02", true),
      result(state, "4", "2027-01-01", true),
    ];
    const originalArchiveOrder = archivedResults.map((game) => game.gameId);
    const originalCurrentOrder = state.lightweightResults.map((game) => game.gameId);
    expect(getFranchiseRecords(state)).toMatchObject({
      firstWin: { seasonId: "2025-26", date: "2026-01-01" },
      bestSeason: { seasonId: state.league.seasonId, wins: 3, losses: 1 },
      longestWinningStreak: { seasonId: state.league.seasonId, wins: 3 },
    });
    expect(archivedResults.map((game) => game.gameId)).toEqual(originalArchiveOrder);
    expect(state.lightweightResults.map((game) => game.gameId)).toEqual(originalCurrentOrder);
  });

  it("puts the first win above team creation when both unlock on the same day", () => {
    const state = createCareer("career-same-day-milestones");
    state.achievements.EXPANSION_COMPLETE = { unlocked: true, seasonId: "2026-27", unlockedAt: "2026-27:D0" };
    state.achievements.FIRST_WIN = { unlocked: true, seasonId: "2026-27", unlockedAt: "2026-27:D0" };
    expect(getCareerMilestones(state).map((entry) => entry.id)).toEqual(["FIRST_WIN", "EXPANSION_COMPLETE"]);
  });
});
