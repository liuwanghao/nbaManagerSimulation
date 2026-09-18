import { describe, expect, it } from "vitest";
import { createCareer } from "../season/career";
import { simulateGame } from "../simulation/simulateGame";
import { finalizeFinalsAwards, finalizeRegularSeasonAwards } from "./AwardsService";

describe("AwardsService", () => {
  it("selects two 12-player All-Star rosters and every required regular-season award idempotently", () => {
    const state = createCareer("awards-regular-season");
    for (const player of Object.values(state.players)) {
      player.seasonStats.games = 82;
      player.seasonStats.seconds = 82 * 20 * 60;
      player.seasonStats.pts = 82 * 8;
      player.seasonStats.reb = 82 * 3;
      player.seasonStats.ast = 82 * 2;
    }
    const starId = state.teams.SEA.playerIds[0];
    const star = state.players[starId];
    star.age = 22;
    star.serviceYears = 1;
    star.seasonStats.pts = 82 * 34;
    star.seasonStats.reb = 82 * 11;
    star.seasonStats.ast = 82 * 10;
    star.seasonStats.stl = 82 * 3;
    star.seasonStats.blk = 82 * 3;
    state.standings.SEA.wins = 70;
    state.standings.SEA.losses = 12;

    const awarded = finalizeRegularSeasonAwards(state);
    const record = awarded.history.seasonAwards[0];
    expect(record.allStars.WEST).toHaveLength(12);
    expect(record.allStars.EAST).toHaveLength(12);
    expect(record.winners.MVP).toBe(starId);
    for (const award of ["MVP", "DPOY", "ROY", "MIP", "SIXTH_MAN"] as const) expect(record.winners[award]).toBeTruthy();
    const honorCount = awarded.players[starId].career?.honors?.allStar;
    const replayed = finalizeRegularSeasonAwards(awarded);
    expect(replayed.players[starId].career?.honors?.allStar).toBe(honorCount);
  });

  it("records a champion and Finals MVP from the winning-team box scores", () => {
    const state = createCareer("awards-finals");
    const game = state.schedule[0];
    const result = simulateGame(game, state.teams[game.homeTeamId], state.teams[game.awayTeamId], state.players, state.seeds.seasonSeed, true);
    finalizeFinalsAwards(state, result.winnerTeamId, [result]);
    const record = state.history.seasonAwards[0];
    const finalsMvp = record.winners.FINALS_MVP as string;
    expect(state.teams[result.winnerTeamId].playerIds).toContain(finalsMvp);
    expect(state.players[finalsMvp].career?.honors?.finalsMvp).toBe(1);
    expect(state.teams[result.winnerTeamId].playerIds.every((id) => state.players[id].career?.honors?.championships === 1)).toBe(true);
  });
});
