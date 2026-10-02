import { describe, expect, it } from "vitest";
import { createCareer } from "../season/career";
import { emptyPlayerSeasonStats, type TeamBoxScore } from "../state/types";
import { simulateGame } from "./simulateGame";
import { applyPlayerStatusAfterGame, projectedFatigueAfterRest, recoverFatigueBeforeGameDay } from "./PlayerStatusService";

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

  it("recovers exactly 15 fatigue per rest day at any fatigue level and stops at zero", () => {
    expect(projectedFatigueAfterRest(80, 1)).toBe(65);
    expect(projectedFatigueAfterRest(40, 1)).toBe(25);
    expect(projectedFatigueAfterRest(10, 1)).toBe(0);
    expect(projectedFatigueAfterRest(80, 0)).toBe(80);
    expect(projectedFatigueAfterRest(80, 6)).toBe(0);
  });

  it("recovers fatigue according to the configured number of rest days", () => {
    const state = createCareer("player-status-rest");
    const player = state.players[state.teams.SEA.playerIds[0]];
    player.fatigue = 80;
    recoverFatigueBeforeGameDay(state, ["SEA"], 2);
    expect(player.fatigue).toBe(50);
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
    expect(state.players[restingId].fatigue).toBe(55);
  });

  it("keeps a 34-minute player below high fatigue over the first several weeks", () => {
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
    let maximumFatigue = 0;
    for (const [index, game] of games.entries()) {
      recoverFatigueBeforeGameDay(state, [teamId], game.dateIndex);
      const backToBack = index > 0 && game.dateIndex - games[index - 1].dateIndex === 1;
      applyPlayerStatusAfterGame(state, [box], new Set(backToBack ? [teamId] : []));
      game.status = "FINAL";
      maximumFatigue = Math.max(maximumFatigue, player.fatigue);
    }
    expect(maximumFatigue).toBeGreaterThan(0);
    expect(maximumFatigue).toBeLessThanOrEqual(60);
  });
});
