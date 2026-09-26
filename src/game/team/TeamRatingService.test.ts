import { describe, expect, it } from "vitest";
import { createCareer } from "../season/career";
import { calculateTeamOverall, calculateTeamOverallForPlayers } from "./TeamRatingService";

describe("TeamRatingService", () => {
  it("maps contender-level minute-weighted talent above 90 on the shared 100 scale", () => {
    const state = createCareer("team-overall-contender");
    const players = state.teams[state.userTeamId].playerIds.map((id) => structuredClone(state.players[id]));
    players.forEach((player) => {
      for (const key of Object.keys(player.attributes) as Array<keyof typeof player.attributes>) player.attributes[key] = 85;
      player.overallAdjustment = 0;
    });
    expect(calculateTeamOverallForPlayers(players).overall).toBeGreaterThanOrEqual(90);
  });

  it("keeps OVR separate from roster-fit scoring", () => {
    const state = createCareer("team-overall-stable");
    const first = calculateTeamOverall(state, state.userTeamId);
    state.teams[state.userTeamId].fanSupport = 0;
    state.teams[state.userTeamId].franchiseReputation = 100;
    expect(calculateTeamOverall(state, state.userTeamId)).toEqual(first);
  });

  it("rates an incomplete expansion roster without requiring a 240-minute rotation", () => {
    const state = createCareer("team-overall-incomplete-expansion-roster");
    const players = state.teams[state.userTeamId].playerIds
      .slice(0, 5)
      .map((id) => structuredClone(state.players[id]));

    expect(() => calculateTeamOverallForPlayers(players)).not.toThrow();
    const rating = calculateTeamOverallForPlayers(players);
    expect(rating.raw).toBeGreaterThan(0);
    expect(rating.overall).toBeGreaterThanOrEqual(50);
    expect(rating.overall).toBeLessThanOrEqual(99);
  });
});
