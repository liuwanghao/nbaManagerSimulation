import { describe, expect, it } from "vitest";
import { createFixtureDataset } from "../../data/fixture";
import { buildDefaultRotationPlan } from "../roster/RotationPlanService";
import type { PlayerBoxScore, TeamBoxScore } from "../state/types";
import { buildTeamBoxScore } from "./boxScore";
import { solveRotationSeconds } from "./minutes";
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
  it("credits rebounders and primary creators without changing team totals", () => {
    const fixture = createFixtureDataset("box-score-specialists");
    const players = fixture.teams.SEA.playerIds.slice(0, 5).map((id, index) => ({
      ...fixture.players[id],
      position: (["PG", "SG", "SF", "PF", "C"] as const)[index],
      attributes: {
        ...fixture.players[id].attributes,
        rebounding: 75,
        playmaking: index === 0 ? 95 : 55,
        basketballIq: 75,
      },
    }));
    const seconds = Object.fromEntries(players.map((player) => [player.id, 2_880]));
    const boxes = Array.from({ length: 32 }, (_, index) => buildTeamBoxScore("SEA", players, seconds, 115, 100, `box-score-specialists-${index}`));
    const totalForPosition = (position: typeof players[number]["position"], key: "reb" | "ast") => boxes.reduce((total, box) => {
      const playerIndex = players.findIndex((player) => player.position === position);
      return total + box.playerStats[playerIndex][key];
    }, 0);

    expect(totalForPosition("C", "reb")).toBeGreaterThan(totalForPosition("PG", "reb"));
    expect(totalForPosition("PF", "reb")).toBeGreaterThan(totalForPosition("SG", "reb"));
    expect(totalForPosition("PG", "ast") / boxes.length).toBeGreaterThan(10);
    for (const box of boxes) {
      expect(sum(box.playerStats, "reb")).toBe(box.totals.reb);
      expect(sum(box.playerStats, "ast")).toBe(box.totals.ast);
      expect(box.totals.ast).toBeLessThanOrEqual(box.totals.fgm);
    }
  });

  it("adds an available reserve when only five planned players remain under the minute cap", () => {
    const fixture = createFixtureDataset("rotation-minute-cap-fallback");
    const players = fixture.teams.SEA.playerIds.map((id) => fixture.players[id]);
    const plan = buildDefaultRotationPlan(players);
    const starterIds = new Set(Object.values(plan.starters));
    for (const player of players) if (!starterIds.has(player.id)) plan.targetMinutes[player.id] = 0;
    const seconds = solveRotationSeconds(players, false, plan);
    expect(Object.keys(seconds).length).toBeGreaterThanOrEqual(6);
    expect(Object.values(seconds).reduce((total, value) => total + value, 0)).toBe(14_400);
    expect(Math.max(...Object.values(seconds))).toBeLessThanOrEqual(2_400);
  });

  it("keeps a one-game rested player out of the box score while preserving legal team minutes", () => {
    const fixture = createFixtureDataset("one-game-rest");
    const home = fixture.teams.SEA;
    const away = fixture.teams.BOS;
    const restedId = home.playerIds[0];
    const game = {
      id: "one-game-rest",
      seasonId: "2026-27",
      dateIndex: 0,
      date: "2026-10-20",
      homeTeamId: home.id,
      awayTeamId: away.id,
      matchupOrdinal: 1,
      status: "SCHEDULED" as const,
    };
    const result = simulateGame(game, home, away, fixture.players, "one-game-rest-season", false, undefined, new Set([restedId]));
    expect(result.homeBoxScore!.playerStats.some((stat) => stat.playerId === restedId)).toBe(false);
    expect(sum(result.homeBoxScore!.playerStats, "seconds")).toBe(14_400 + result.overtimePeriods * 1_500);
    expect(result.homeBoxScore!.playerStats.length).toBeGreaterThanOrEqual(6);
  });

  it("preserves the low morale penalty curve", () => {
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

  it.each([
    [50, 0], [55, 0], [60, 0], [61, 0.0075], [80, 0.15], [100, 0.3], [110, 0.3],
  ])("applies a capped small bonus at morale %s", (morale, expected) => {
    const fixture = createFixtureDataset("morale-bonus-test");
    const player = { ...fixture.players[fixture.teams.SEA.playerIds[0]], morale };
    expect(moraleEfficiencyModifier([player], { [player.id]: 2_880 })).toBeCloseTo(expected, 8);
  });

  it("weights morale by playing time and ignores players who do not play", () => {
    const fixture = createFixtureDataset("morale-weighting-test");
    const players = fixture.teams.SEA.playerIds.slice(0, 3).map((id, index) => ({
      ...fixture.players[id], morale: index === 0 ? 100 : 0,
    }));
    const seconds = { [players[0].id]: 2_400, [players[1].id]: 600, [players[2].id]: 0 };
    expect(moraleEfficiencyModifier(players, seconds)).toBeCloseTo(0.15, 8);
    expect(moraleEfficiencyModifier(players, {})).toBe(0);
  });

  it("gives high morale a small scoring benefit while preserving replay and box score totals", () => {
    const fixture = createFixtureDataset("morale-scoring-test");
    const boostedPlayers = structuredClone(fixture.players);
    for (const id of fixture.teams.SEA.playerIds) {
      fixture.players[id].morale = 60;
      boostedPlayers[id].morale = 100;
    }
    let totalBenefit = 0;
    for (let index = 0; index < 32; index += 1) {
      const game = {
        id: `morale-scoring-${index}`, seasonId: "2026-27", dateIndex: 0, date: "2026-10-20",
        homeTeamId: "SEA", awayTeamId: "BOS", matchupOrdinal: 1, status: "SCHEDULED" as const,
      };
      const baseline = simulateGame(game, fixture.teams.SEA, fixture.teams.BOS, fixture.players, "season-seed");
      const boosted = simulateGame(game, fixture.teams.SEA, fixture.teams.BOS, boostedPlayers, "season-seed");
      expect(boosted).toEqual(simulateGame(game, fixture.teams.SEA, fixture.teams.BOS, boostedPlayers, "season-seed"));
      expectLegalBoxScore(boosted.homeBoxScore as TeamBoxScore, boosted.overtimePeriods);
      expectLegalBoxScore(boosted.awayBoxScore as TeamBoxScore, boosted.overtimePeriods);
      if (baseline.overtimePeriods || boosted.overtimePeriods) continue;
      expect(boosted.awayScore).toBe(baseline.awayScore);
      const benefit = boosted.homeScore - baseline.homeScore;
      expect(benefit).toBeGreaterThanOrEqual(0);
      expect(benefit).toBeLessThanOrEqual(1);
      totalBenefit += benefit;
    }
    expect(totalBenefit).toBeGreaterThan(0);
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

  it("allows a scorer to have hot and quiet nights across different games", () => {
    const fixture = createFixtureDataset("variance-probe");
    const home = fixture.teams.SEA;
    const away = fixture.teams.BOS;
    const games = Array.from({ length: 32 }, (_, index) => simulateGame({
      id: `variance-${index}`,
      seasonId: "2026-27",
      dateIndex: index,
      date: "2026-10-20",
      homeTeamId: home.id,
      awayTeamId: away.id,
      matchupOrdinal: index,
      status: "SCHEDULED",
    }, home, away, fixture.players, "variance-season"));
    const firstBox = games[0].homeBoxScore as TeamBoxScore;
    const scorer = [...firstBox.playerStats].sort((left, right) => right.pts - left.pts)[0];
    const scorerGames = games.map((game) => (game.homeBoxScore as TeamBoxScore).playerStats.find((stat) => stat.playerId === scorer.playerId)!);

    expect(new Set(scorerGames.map((stat) => stat.fga)).size).toBeGreaterThanOrEqual(5);
    expect(Math.max(...scorerGames.map((stat) => stat.pts)) - Math.min(...scorerGames.map((stat) => stat.pts))).toBeGreaterThanOrEqual(10);
    for (const game of games) expectLegalBoxScore(game.homeBoxScore as TeamBoxScore, game.overtimePeriods);
  });
});
