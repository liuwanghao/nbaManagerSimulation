import { describe, expect, it } from "vitest";
import { createCareer } from "../season/career";
import type { GameResult } from "../state/types";
import { applyFanSupportAfterGame, applySeasonTeamCoreUpdate, freeAgentAttraction } from "./TeamSystemService";

function result(winnerTeamId: string): GameResult {
  return { gameId: `game-${winnerTeamId}`, date: "2026-10-20", homeTeamId: "SEA", awayTeamId: "LVG", homeScore: winnerTeamId === "SEA" ? 110 : 100, awayScore: winnerTeamId === "LVG" ? 110 : 100, winnerTeamId, overtimePeriods: 0 };
}

describe("TeamSystemService", () => {
  it("applies per-game support changes and streak bonuses exactly", () => {
    const state = createCareer("team-core-game");
    const initial = state.teams.SEA.fanSupport;
    const player = state.players[state.teams.SEA.playerIds[0]];
    applyFanSupportAfterGame(state, result("SEA"));
    applyFanSupportAfterGame(state, result("SEA"));
    applyFanSupportAfterGame(state, result("SEA"));
    expect(state.teams.SEA.fanSupport).toBe(initial + 0.85);
    expect(state.teams.SEA.currentStreak).toBe(3);
    expect(player.morale).toBe(51.15);
  });

  it("caps season reputation growth at twelve and derives attraction", () => {
    const state = createCareer("team-core-season");
    state.standings.SEA.wins = 60;
    state.standings.SEA.losses = 22;
    const before = state.teams.SEA.franchiseReputation;
    applySeasonTeamCoreUpdate(state, {
      SEA: { enteredPlayIn: false, enteredPlayoffs: true, seriesWins: 4, conferenceFinals: true, finalsAppearance: true, champion: true },
    }, { seasonId: state.league.seasonId, allStars: { WEST: [], EAST: [] }, winners: { MVP: state.teams.SEA.playerIds[0] } });
    expect(state.teams.SEA.franchiseReputation).toBe(Math.min(100, before + 12));
    expect(freeAgentAttraction(state, state.teams.SEA)).toBeGreaterThanOrEqual(0);
    expect(freeAgentAttraction(state, state.teams.SEA)).toBeLessThanOrEqual(100);
  });
});
