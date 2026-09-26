import { describe, expect, it } from "vitest";
import { createCareer } from "../game/season/career";
import { leagueStatLeaders } from "./LeagueLeadersPanel";

describe("leagueStatLeaders", () => {
  it("keeps the leaderboard empty before any player has played", () => {
    const state = createCareer("league-leaders-empty");
    expect(leagueStatLeaders(state, "pts")).toEqual([]);
  });

  it("ranks five played players by per-game production and resolves ties consistently", () => {
    const state = createCareer("league-leaders-top-five");
    const players = Object.values(state.players);
    for (const player of players) player.seasonStats.games = 0;

    const [first, second, third, fourth, fifth, sixth, seventh] = players;
    first.seasonStats.games = 1;
    first.seasonStats.pts = 10;
    second.seasonStats.games = 2;
    second.seasonStats.pts = 20;
    for (const [player, points] of [[third, 9], [fourth, 8], [fifth, 7], [sixth, 6]] as const) {
      player.seasonStats.games = 1;
      player.seasonStats.pts = points;
    }
    seventh.seasonStats.pts = 1000;
    third.seasonStats.stl = 4;
    fourth.seasonStats.blk = 5;

    expect(leagueStatLeaders(state, "pts").map((player) => player.id)).toEqual([second.id, first.id, third.id, fourth.id, fifth.id]);
    expect(leagueStatLeaders(state, "stl")[0].id).toBe(third.id);
    expect(leagueStatLeaders(state, "blk")[0].id).toBe(fourth.id);
  });
});
