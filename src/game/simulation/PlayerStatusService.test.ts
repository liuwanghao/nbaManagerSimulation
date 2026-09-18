import { describe, expect, it } from "vitest";
import { createCareer } from "../season/career";
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
    expect(player.fatigue).toBe(44);
  });
});
