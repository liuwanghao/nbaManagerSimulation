import { describe, expect, it } from "vitest";
import { createFixtureDataset } from "../../data/fixture";
import type { PlayerBoxScore, TeamBoxScore } from "../state/types";
import { moraleEfficiencyModifier, simulateGame } from "./simulateGame";

const sum = (players: PlayerBoxScore[], key: keyof Omit<PlayerBoxScore, "playerId">): number =>
  players.reduce((total, player) => total + player[key], 0);

function expectLegalBoxScore(box: TeamBoxScore, overtimePeriods: number): void {
  expect(sum(box.playerStats, "pts")).toBe(box.score);
  expect(sum(box.playerStats, "seconds")).toBe(14_400 + overtimePeriods * 1_500);
  for (const key of ["fgm", "fga", "threePm", "threePa", "ftm", "fta", "reb", "ast", "stl", "blk", "tov"] as const) {
    expect(sum(box.playerStats, key)).toBe(box.totals[key]);
  }
  for (const player of box.playerStats) {
    expect(player.fgm).toBeLessThanOrEqual(player.fga);
    expect(player.threePm).toBeLessThanOrEqual(player.threePa);
    expect(player.threePm).toBeLessThanOrEqual(player.fgm);
    expect(player.ftm).toBeLessThanOrEqual(player.fta);
    expect(player.pts).toBe(2 * (player.fgm - player.threePm) + 3 * player.threePm + player.ftm);
  }
}

describe("simulation contract", () => {
  it("applies the frozen morale penalty curve without rewarding high morale", () => {
    const fixture = createFixtureDataset("morale-curve-test");
    const players = fixture.teams.SEA.playerIds.slice(0, 5).map((id) => fixture.players[id]);
    const seconds = Object.fromEntries(players.map((player) => [player.id, 2_880]));
    players.forEach((player) => { player.morale = 50; });
    expect(moraleEfficiencyModifier(players, seconds)).toBe(0);
    players.forEach((player) => { player.morale = 32.5; });
    expect(moraleEfficiencyModifier(players, seconds)).toBeCloseTo(-0.75, 8);
    players.forEach((player) => { player.morale = 5; });
    expect(moraleEfficiencyModifier(players, seconds)).toBe(-1.5);
  });

  it("uses one deterministic engine and emits conserved box scores", () => {
    const fixture = createFixtureDataset("simulation-test");
    const game = {
      id: "game-1",
      seasonId: "2026-27",
      dateIndex: 0,
      date: "2026-10-20",
      homeTeamId: "SEA",
      awayTeamId: "BOS",
      matchupOrdinal: 1,
      status: "SCHEDULED" as const,
    };
    const first = simulateGame(game, fixture.teams.SEA, fixture.teams.BOS, fixture.players, "season-seed");
    const replay = simulateGame(game, fixture.teams.SEA, fixture.teams.BOS, fixture.players, "season-seed");
    expect(first).toEqual(replay);
    expect(first.homeScore).not.toBe(first.awayScore);
    expect(first.homePeriodScores?.reduce((total, value) => total + value, 0)).toBe(first.homeScore);
    expect(first.awayPeriodScores?.reduce((total, value) => total + value, 0)).toBe(first.awayScore);
    expect(first.homePeriodScores).toHaveLength(4 + first.overtimePeriods);
    expectLegalBoxScore(first.homeBoxScore as TeamBoxScore, first.overtimePeriods);
    expectLegalBoxScore(first.awayBoxScore as TeamBoxScore, first.overtimePeriods);
  });
});
