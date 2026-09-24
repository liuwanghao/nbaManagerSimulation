import { describe, expect, it } from "vitest";
import type { GameState, Player, PlayerAttributes, Position } from "../game/state/types";
import { filterExpansionPlayers, findExpansionDraftPlayers, findNextSelectableTeamId, getCurrentRosterPositionCounts, getCurrentTeamId, getCurrentTeamRoster, getExpansionDraftRecap, getExpansionRosterGaps, getRecentExpansionPickBroadcasts } from "./expansionDraftView";

const BASE_ATTRIBUTES: PlayerAttributes = {
  finishing: 50,
  shooting: 50,
  playmaking: 50,
  perimeterDefense: 50,
  interiorDefense: 50,
  rebounding: 50,
  athleticism: 50,
  basketballIq: 50,
};

function player(id: string, teamId: string, position: Position, secondaryPosition: Position, overallAdjustment = 0): Player {
  return { id, teamId, position, secondaryPosition, age: 24, name: id, contract: { salary: 1, yearsRemaining: 1, guaranteedAmount: 1 }, attributes: BASE_ATTRIBUTES, overallAdjustment } as Player;
}

function gameState(teamIds: string[], userTeamId: string, expansionTeamId?: string) {
  const teams = Object.fromEntries(teamIds.map((id) => [id, { id, playerIds: [], fullName: id }]));
  return { userTeamId, teams, players: {}, expansion: expansionTeamId ? { playerTeamId: expansionTeamId } : undefined } as unknown as GameState;
}

describe("expansion draft view rules", () => {
  const players = [
    player("bos-pg", "BOS", "PG", "SG"),
    player("chi-c", "CHI", "C", "PF"),
    player("dal-sf", "DAL", "SF", "SG"),
  ];

  it("filters the selected source team by primary position only", () => {
    expect(filterExpansionPlayers(players, "BOS", "PG").map(({ id }) => id)).toEqual(["bos-pg"]);
    expect(filterExpansionPlayers(players, "BOS", "SG")).toEqual([]);
    expect(filterExpansionPlayers(players, "BOS", "C")).toEqual([]);
  });

  it("shows a dual-position player only under the first listed position", () => {
    const comboGuard = player("combo-guard", "BOS", "SG", "PG");

    expect(filterExpansionPlayers([comboGuard], "BOS", "SG").map(({ id }) => id)).toEqual(["combo-guard"]);
    expect(filterExpansionPlayers([comboGuard], "BOS", "PG")).toEqual([]);
  });

  it("shows every source team for ALL and sorts players by overall descending", () => {
    const rankedPlayers = [
      player("low", "BOS", "PG", "SG", 10),
      player("high", "DAL", "SF", "PF", 30),
      player("mid", "CHI", "C", "PF", 20),
    ];

    expect(filterExpansionPlayers(rankedPlayers, "ALL", "ALL").map(({ id }) => id)).toEqual(["high", "mid", "low"]);
  });

  it("broadcasts the latest three completed picks in order", () => {
    const state = gameState(["SEA", "LVG", "BOS", "CHI"], "SEA", "SEA");
    state.teams.SEA.fullName = "西雅图 海潮";
    state.teams.LVG.fullName = "拉斯维加斯 闪电";
    state.teams.BOS.fullName = "波士顿凯尔特人";
    state.teams.CHI.fullName = "芝加哥公牛";
    state.players = Object.fromEntries(["甲", "乙", "丙", "丁"].map((name) => [name, player(name, "SEA", "PG", "SG")]));
    state.expansion!.picks = [
      { pickNumber: 1, round: 1, teamId: "SEA", sourceTeamId: "BOS", playerId: "甲" },
      { pickNumber: 2, round: 1, teamId: "LVG", sourceTeamId: "CHI", playerId: "乙" },
      { pickNumber: 3, round: 2, teamId: "LVG", sourceTeamId: "BOS", playerId: "丙" },
      { pickNumber: 4, round: 2, teamId: "SEA", sourceTeamId: "CHI", playerId: "丁" },
    ];

    expect(getRecentExpansionPickBroadcasts(state)).toEqual([
      { pickNumber: 2, teamName: "拉斯维加斯闪电", sourceTeamName: "芝加哥公牛", playerName: "乙" },
      { pickNumber: 3, teamName: "拉斯维加斯闪电", sourceTeamName: "波士顿凯尔特人", playerName: "丙" },
      { pickNumber: 4, teamName: "西雅图海潮", sourceTeamName: "芝加哥公牛", playerName: "丁" },
    ]);
  });

  it("keeps intervening picks when the same expansion team selects twice in a row", () => {
    const state = gameState(["SEA", "LVG", "BOS", "CHI"], "SEA", "SEA");
    state.expansion!.picks = [
      { pickNumber: 25, round: 13, teamId: "SEA", sourceTeamId: "BOS", playerId: "甲" },
      { pickNumber: 26, round: 13, teamId: "LVG", sourceTeamId: "CHI", playerId: "乙" },
      { pickNumber: 27, round: 14, teamId: "LVG", sourceTeamId: "BOS", playerId: "丙" },
    ];
    state.players = Object.fromEntries(["甲", "乙", "丙"].map((name) => [name, player(name, "SEA", "PG", "SG")]));

    expect(getRecentExpansionPickBroadcasts(state).map((entry) => entry.pickNumber)).toEqual([25, 26, 27]);
  });

  it("groups every completed pick by expansion team and keeps each team's draft order", () => {
    const state = gameState(["SEA", "LVG", "BOS", "CHI"], "LVG", "LVG");
    state.expansion!.aiTeamId = "SEA";
    state.expansion!.picks = [
      { pickNumber: 4, round: 2, teamId: "LVG", sourceTeamId: "BOS", playerId: "four" },
      { pickNumber: 1, round: 1, teamId: "SEA", sourceTeamId: "CHI", playerId: "one" },
      { pickNumber: 3, round: 2, teamId: "LVG", sourceTeamId: "CHI", playerId: "three" },
      { pickNumber: 2, round: 1, teamId: "SEA", sourceTeamId: "BOS", playerId: "two" },
    ];

    expect(getExpansionDraftRecap(state).map(({ teamId, picks }) => [teamId, picks.map((pick) => pick.pickNumber)])).toEqual([
      ["LVG", [3, 4]],
      ["SEA", [1, 2]],
    ]);
  });

  it("searches within team and position filters and sorts by age, salary or contract length", () => {
    const older = player("Older Guard", "BOS", "PG", "SG", 30);
    older.age = 32;
    older.contract.salary = 8;
    older.contract.yearsRemaining = 3;
    const younger = player("Young Guard", "BOS", "PG", "SG", 20);
    younger.age = 21;
    younger.contract.salary = 4;
    younger.contract.yearsRemaining = 2;
    const shortDeal = player("Short Guard", "BOS", "PG", "SG", 10);
    shortDeal.age = 27;
    shortDeal.contract.salary = 2;
    shortDeal.contract.yearsRemaining = 1;
    const otherTeam = player("Young Guard Elsewhere", "CHI", "PG", "SG", 40);
    const pool = [older, younger, shortDeal, otherTeam];

    expect(findExpansionDraftPlayers(pool, "BOS", "PG", " guard ", "OVERALL").map(({ id }) => id)).toEqual(["Older Guard", "Young Guard", "Short Guard"]);
    expect(findExpansionDraftPlayers(pool, "BOS", "PG", "GUARD", "AGE").map(({ id }) => id)).toEqual(["Young Guard", "Short Guard", "Older Guard"]);
    expect(findExpansionDraftPlayers(pool, "BOS", "PG", "", "SALARY").map(({ id }) => id)).toEqual(["Short Guard", "Young Guard", "Older Guard"]);
    expect(findExpansionDraftPlayers(pool, "BOS", "PG", "", "CONTRACT").map(({ id }) => id)).toEqual(["Short Guard", "Young Guard", "Older Guard"]);
    expect(findExpansionDraftPlayers(pool, "BOS", "C", "", "AGE")).toEqual([]);
  });

  it("shows advisory roster gaps using primary positions", () => {
    const roster = [player("guard", "SEA", "PG", "SG"), player("wing", "SEA", "SF", "PG")];
    expect(getExpansionRosterGaps(roster)).toEqual([
      { position: "PG", count: 1, gap: 1 }, { position: "SG", count: 0, gap: 2 },
      { position: "SF", count: 1, gap: 1 }, { position: "PF", count: 0, gap: 2 },
      { position: "C", count: 0, gap: 2 },
    ]);
  });

  it("advances in team order and skips teams without selectable players", () => {
    expect(findNextSelectableTeamId(["BOS", "BKN", "CHI", "DAL"], "BOS", players, "ALL")).toBe("CHI");
    expect(findNextSelectableTeamId(["BOS", "BKN", "CHI", "DAL"], "DAL", players, "ALL")).toBe("BOS");
  });

  it("prefers the active position and falls back to the next team with any player", () => {
    expect(findNextSelectableTeamId(["BOS", "CHI", "DAL"], "BOS", players, "SF")).toBe("DAL");
    expect(findNextSelectableTeamId(["BOS", "CHI", "DAL"], "BOS", players, "PG")).toBe("CHI");
  });

  it("uses the expansion team when it is available and sorts its roster by overall", () => {
    const high = player("high", "SEA", "C", "PF", 30);
    const low = player("low", "SEA", "PG", "SG", 10);
    const state = gameState(["SEA", "BOS"], "BOS", "SEA");
    state.teams.SEA.playerIds = [low.id, high.id];
    state.players = { [high.id]: high, [low.id]: low };

    expect(getCurrentTeamId(state)).toBe("SEA");
    expect(getCurrentTeamRoster(state).map(({ id }) => id)).toEqual(["high", "low"]);
    expect(getCurrentRosterPositionCounts(getCurrentTeamRoster(state))).toEqual([
      { position: "PG", count: 1 }, { position: "SG", count: 0 }, { position: "SF", count: 0 }, { position: "PF", count: 0 }, { position: "C", count: 1 },
    ]);
  });

  it("falls back to the user team when no valid expansion team exists", () => {
    const state = gameState(["BOS"], "BOS", "SEA");
    expect(getCurrentTeamId(state)).toBe("BOS");
  });
});
