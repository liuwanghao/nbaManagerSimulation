import { describe, expect, it } from "vitest";
import { createCareer } from "../season/career";
import { emptyPlayerSeasonStats, type TeamBoxScore } from "../state/types";
import { simulateGame } from "./simulateGame";
import { applyPlayerStatusAfterGame, recoverFatigueBeforeGameDay } from "./PlayerStatusService";

describe("PlayerStatusService", () => {
  it("adds deterministic game load and keeps form in its bounded range", () => {
    const state = createCareer("player-status-load");
    const game = state.schedule.find((entry) => entry.homeTeamId === "SEA" && entry.awayTeamId === "POR") ?? state.schedule[0];
    const result = simulateGame(game, state.teams[game.homeTeamId], state.teams[game.awayTeamId], state.players, state.seeds.seasonSeed);
    applyPlayerStatusAfterGame(state, [result.homeBoxScore, result.awayBoxScore], new Set([game.homeTeamId]));
    const participants = [...(result.homeBoxScore?.playerStats ?? []), ...(result.awayBoxScore?.playerStats ?? [])].filter((stat) => stat.seconds > 0);
    expect(participants.every((stat) => state.players[stat.playerId].fatigue > 0)).toBe(true);
    expect(participants.every((stat) => Math.abs(state.players[stat.playerId].form) <= 3)).toBe(true);
  });

  it("recovers fatigue according to the configured number of rest days", () => {
    const state = createCareer("player-status-rest");
    const player = state.players[state.teams.SEA.playerIds[0]];
    player.fatigue = 80;
    recoverFatigueBeforeGameDay(state, ["SEA"], 2);
    expect(player.fatigue).toBe(52.35);
  });

  it("recovers a player who sits out while teammates play", () => {
    const state = createCareer("player-status-dnp-rest");
    const game = state.schedule.find((entry) => entry.homeTeamId === "SEA" && entry.awayTeamId === "POR") ?? state.schedule[0];
    const result = simulateGame(game, state.teams[game.homeTeamId], state.teams[game.awayTeamId], state.players, state.seeds.seasonSeed);
    const box = result.homeBoxScore!;
    const played = new Set(box.playerStats.filter((stat) => stat.seconds > 0).map((stat) => stat.playerId));
    const restingId = state.teams[box.teamId].playerIds.find((id) => !played.has(id));
    if (!restingId) throw new Error("Expected a player outside the game rotation");
    state.players[restingId].fatigue = 70;
    applyPlayerStatusAfterGame(state, [box], new Set());
    expect(state.players[restingId].fatigue).toBe(56.4);
  });

  it("builds fatigue gradually over the first several weeks of heavy minutes", () => {
    const state = createCareer("fatigue-early-season-curve");
    const teamId = state.userTeamId;
    const playerId = state.teams[teamId].playerIds[0];
    const player = state.players[playerId];
    player.age = 30;
    player.attributes.athleticism = 70;
    const games = state.schedule.filter((game) => game.homeTeamId === teamId || game.awayTeamId === teamId)
      .sort((left, right) => left.dateIndex - right.dateIndex || left.id.localeCompare(right.id)).slice(0, 25);
    const stat = { ...emptyPlayerSeasonStats(), playerId, games: 1, seconds: 34 * 60, pts: 20 };
    const box = { teamId, playerStats: [stat] } as TeamBoxScore;
    let firstHighGame = 0;
    let fifthGameFatigue = 0;
    for (const [index, game] of games.entries()) {
      recoverFatigueBeforeGameDay(state, [teamId], game.dateIndex);
      const backToBack = index > 0 && game.dateIndex - games[index - 1].dateIndex === 1;
      applyPlayerStatusAfterGame(state, [box], new Set(backToBack ? [teamId] : []));
      game.status = "FINAL";
      if (index === 4) fifthGameFatigue = player.fatigue;
      if (!firstHighGame && player.fatigue > 60) firstHighGame = index + 1;
    }
    expect(fifthGameFatigue).toBeLessThan(60);
    expect(firstHighGame).toBeGreaterThanOrEqual(10);
    expect(firstHighGame).toBeLessThanOrEqual(20);
    expect(player.fatigue).toBeLessThan(100);
  });
});
