import { describe, expect, it } from "vitest";
import type { GameResult } from "../game/state/types";
import { createCareer, enterPostseason, simulatePostseasonGame } from "../game/season/career";
import { postseasonBracket } from "./seasonResultsView";

describe("postseason bracket", () => {
  it("updates the live bracket after an interactive play-in game", () => {
    const state = createCareer("live-bracket");
    state.schedule.forEach((game) => { game.status = "FINAL"; });
    state.standings[state.userTeamId].wins = 82;
    const entered = enterPostseason(state);
    const first = simulatePostseasonGame(entered);
    const finished = first.postseason!.series.find((series) => series.winnerTeamId);
    expect(finished).toBeDefined();
    const bracket = postseasonBracket(first);
    const conference = bracket.conferences.find((entry) => entry.conference === finished!.conference)!;
    const visible = conference.playIn.find((entry) => entry.teamA === finished!.teamAId && entry.teamB === finished!.teamBId);
    expect(visible).toMatchObject({ winsA: finished!.winsA, winsB: finished!.winsB, winner: finished!.winnerTeamId });
    expect(bracket.settled).toBe(false);
  });

  it("shows seeded first-round matchups before the play-in is settled", () => {
    const state = createCareer("bracket-preview");
    const bracket = postseasonBracket(state);
    expect(bracket.settled).toBe(false);
    expect(bracket.conferences).toHaveLength(2);
    expect(bracket.conferences.every((conference) => conference.playIn.length === 3 && conference.firstRound.length === 4)).toBe(true);
    expect(bracket.conferences[0].playIn[0].placeholderA).toBe("7/8 负者");
    expect(bracket.conferences[0].playIn[2].teamA).toBeDefined();
    expect(bracket.conferences[0].firstRound[0].placeholderB).toBe("第 8 席");
    expect(bracket.conferences[0].firstRound[2].placeholderB).toBe("第 7 席");
  });

  it("reconstructs each completed round and the Finals from archived games", () => {
    const state = createCareer("bracket-completed");
    const byConference = { EAST: Object.values(state.teams).filter((team) => team.conference === "EAST").slice(0, 10), WEST: Object.values(state.teams).filter((team) => team.conference === "WEST").slice(0, 10) };
    const games: GameResult[] = [];
    const addGame = (first: string, second: string, offset: number) => games.push({
      gameId: `post-${offset}-${first}-${second}`,
      date: `POST-${String(offset).padStart(3, "0")}`,
      homeTeamId: first,
      awayTeamId: second,
      homeScore: 110,
      awayScore: 100,
      winnerTeamId: first,
      overtimePeriods: 0,
    });
    for (const conference of ["EAST", "WEST"] as const) {
      const ids = byConference[conference].map((team) => team.id);
      [[6, 7], [8, 9], [7, 8], [0, 7], [3, 4], [1, 6], [2, 5], [0, 3], [1, 2], [0, 1]].forEach(([first, second], index) => addGame(ids[first], ids[second], 2 + index * 12));
    }
    addGame(byConference.EAST[0].id, byConference.WEST[0].id, 140);
    state.history.seasons.push({
      seasonId: state.league.seasonId,
      championTeamId: byConference.EAST[0].id,
      standings: {},
      regularSeasonResults: [],
      userRegularGameDetails: {},
      postseasonGameDetails: Object.fromEntries(games.map((game) => [game.gameId, game])),
      userPostseason: { enteredPlayIn: false, enteredPlayoffs: false, seriesWins: 0, conferenceFinals: false, finalsAppearance: false, champion: false, playoffWins: 0, playoffLosses: 0 },
    });

    const bracket = postseasonBracket(state);
    expect(bracket.settled).toBe(true);
    expect(bracket.conferences[0].firstRound).toHaveLength(4);
    expect(bracket.conferences[0].playIn[0].teamA).toBe(byConference.EAST[7].id);
    expect(bracket.conferences[0].playIn[0].winner).toBe(bracket.conferences[0].firstRound[0].teamB);
    expect(bracket.conferences[0].playIn[2].winner).toBe(bracket.conferences[0].firstRound[2].teamB);
    expect(bracket.conferences[0].semifinals).toHaveLength(2);
    expect(bracket.conferences[0].final).toHaveLength(1);
    expect(bracket.finals[0]).toMatchObject({ teamA: byConference.EAST[0].id, teamB: byConference.WEST[0].id, winner: byConference.EAST[0].id });
  });
});
