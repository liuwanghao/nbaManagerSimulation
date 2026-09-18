import { describe, expect, it } from "vitest";
import { createCareer } from "../season/career";
import type { GameResult, SeasonHistoryArchive } from "../state/types";
import { compressHistoricalArchives } from "./HistoryCompressionService";

function game(id: string, date: string, home: string, away: string, winner: string): GameResult {
  return { gameId: id, date, homeTeamId: home, awayTeamId: away, homeScore: winner === home ? 110 : 100, awayScore: winner === away ? 110 : 100, winnerTeamId: winner, overtimePeriods: 0 };
}

function archive(seasonId: string, games: GameResult[], postseason: GameResult[]): SeasonHistoryArchive {
  return {
    seasonId, championTeamId: "BOS", standings: {}, regularSeasonResults: [],
    userRegularGameDetails: Object.fromEntries(games.map((entry) => [entry.gameId, entry])),
    postseasonGameDetails: Object.fromEntries(postseason.map((entry) => [entry.gameId, entry])),
    userPostseason: { enteredPlayIn: false, enteredPlayoffs: false, seriesWins: 0, conferenceFinals: false, finalsAppearance: false, champion: false, playoffWins: 0, playoffLosses: 0 },
  };
}

describe("HistoryCompressionService", () => {
  it("keeps the latest season complete and preserves old first win, user playoffs, finals, and game seven", () => {
    const state = createCareer("history-compression");
    const oldRegular = [game("loss", "2026-10-20", "SEA", "POR", "POR"), game("first-win", "2026-10-22", "SEA", "SAC", "SEA"), game("ordinary", "2026-10-24", "SEA", "GSW", "GSW")];
    const sevenGameSeries = Array.from({ length: 7 }, (_, index) => game(`series-${index + 1}`, `POST-${String(10 + index).padStart(3, "0")}`, "BOS", "NYK", index % 2 ? "NYK" : "BOS"));
    const postseason = [...sevenGameSeries, game("user-playoff", "POST-080", "SEA", "LAL", "SEA"), game("finals", "POST-140", "BOS", "DEN", "BOS"), game("ordinary-playoff", "POST-090", "MIL", "MIA", "MIL")];
    state.history.seasons = [archive("2026-27", oldRegular, postseason), archive("2027-28", [game("latest", "2027-10-20", "SEA", "POR", "SEA")], [])];
    compressHistoricalArchives(state);
    expect(Object.keys(state.history.seasons[0].userRegularGameDetails)).toEqual(["first-win"]);
    expect(Object.keys(state.history.seasons[0].postseasonGameDetails).sort()).toEqual(["finals", "series-7", "user-playoff"]);
    expect(Object.keys(state.history.seasons[1].userRegularGameDetails)).toEqual(["latest"]);
  });
});
