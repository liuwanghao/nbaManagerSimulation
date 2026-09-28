import { describe, expect, it } from "vitest";
import { createCareer } from "../season/career";
import { emptyPlayerSeasonStats } from "../state/types";
import { finalizeRegularSeasonAwards, getAwardRace } from "./AwardsService";

const AWARDS = ["MVP", "DPOY", "ROY", "SIXTH_MAN"] as const;

describe("award races", () => {
  it("shows five eligible candidates for every award and keeps the final winner in first place", () => {
    const state = createCareer("award-race-five-candidates");
    const players = Object.values(state.players);
    for (const player of players) player.seasonStats.games = 0;
    for (const [index, player] of players.slice(0, 10).entries()) {
      player.age = 20;
      player.serviceYears = 0;
      player.rotationRole = "SIXTH_MAN";
      player.seasonStats.games = 10;
      player.seasonStats.pts = 100 + index * 10;
      player.seasonStats.reb = 50;
      player.seasonStats.ast = 30;
      player.seasonStats.stl = 10;
      player.seasonStats.blk = 10;
    }

    const awarded = finalizeRegularSeasonAwards(state);
    for (const award of AWARDS) {
      const race = getAwardRace(state, award);
      expect(race).toHaveLength(5);
      expect(race[0].id).toBe(awarded.history.seasonAwards[0].winners[award]);
    }
  });

  it("shows a provisional race after one game", () => {
    const state = createCareer("award-race-early-season");
    const players = Object.values(state.players);
    for (const player of players) player.seasonStats.games = 0;
    players[0].seasonStats.games = 1;
    expect(getAwardRace(state, "MVP").map((player) => player.id)).toEqual([players[0].id]);
  });

  it("keeps MIP empty without a prior season and ranks only comparable improvements", () => {
    const state = createCareer("award-race-mip-history");
    const players = Object.values(state.players).slice(0, 6);
    for (const [index, player] of players.entries()) {
      player.seasonStats = { ...player.seasonStats, games: 60, pts: 60 * (14 + index), reb: 60 * 5, ast: 60 * 3 };
    }
    expect(getAwardRace(state, "MIP")).toEqual([]);
    for (const [index, player] of players.entries()) {
      player.career = {
        seasonsPlayed: 1, totals: emptyPlayerSeasonStats(), peakOverall: 70, peakImpact: 70,
        unemployedGameDays: 0, unemployedLeagueYears: 0, careerInjuryGamesMissed: 0,
        lastSeasonStats: { ...emptyPlayerSeasonStats(), games: 60, pts: 60 * (12 - index), reb: 60 * 5, ast: 60 * 3 },
      };
    }
    const race = getAwardRace(state, "MIP");
    expect(race).toHaveLength(5);
    expect(race[0].id).toBe(players[5].id);
    expect(finalizeRegularSeasonAwards(state).history.seasonAwards[0].winners.MIP).toBe(players[5].id);
  });
});
