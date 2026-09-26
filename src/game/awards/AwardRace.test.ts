import { describe, expect, it } from "vitest";
import { createCareer } from "../season/career";
import { finalizeRegularSeasonAwards, getAwardRace } from "./AwardsService";

const AWARDS = ["MVP", "DPOY", "ROY", "SIXTH_MAN", "MIP"] as const;

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
});
