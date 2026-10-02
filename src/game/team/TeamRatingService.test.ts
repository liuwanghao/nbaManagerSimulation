import { describe, expect, it } from "vitest";
import { createCareer } from "../season/career";
import { calculateTeamOverall, calculateTeamOverallForPlayers } from "./TeamRatingService";

describe("TeamRatingService", () => {
  it("maps a strong 85 average to roughly 90 team OVR", () => {
    const state = createCareer("team-overall-contender");
    const players = state.teams[state.userTeamId].playerIds.map((id) => structuredClone(state.players[id]));
    players.forEach((player) => {
      for (const key of Object.keys(player.attributes) as Array<keyof typeof player.attributes>) player.attributes[key] = 85;
      player.overallAdjustment = 0;
    });
    const rating = calculateTeamOverallForPlayers(players);
    expect(rating.raw).toBeCloseTo(85, 0);
    expect(rating.overall).toBe(91);
  });

  it("keeps 90-average rosters below the 99 ceiling", () => {
    const state = createCareer("team-overall-preserves-differences");
    const players = state.teams[state.userTeamId].playerIds.map((id) => structuredClone(state.players[id]));
    players.forEach((player) => {
      for (const key of Object.keys(player.attributes) as Array<keyof typeof player.attributes>) player.attributes[key] = 90;
      player.overallAdjustment = 0;
    });

    const rating = calculateTeamOverallForPlayers(players);
    expect(rating.raw).toBeCloseTo(90, 0);
    expect(rating.overall).toBe(96);
  });

  it("keeps OVR separate from roster-fit scoring", () => {
    const state = createCareer("team-overall-stable");
    const first = calculateTeamOverall(state, state.userTeamId);
    state.teams[state.userTeamId].fanSupport = 0;
    state.teams[state.userTeamId].franchiseReputation = 100;
    expect(calculateTeamOverall(state, state.userTeamId)).toEqual(first);
  });

  it("weights the top eight at 90% and the ninth through twelfth at 10%", () => {
    const state = createCareer("team-overall-core-depth");
    const players = state.teams[state.userTeamId].playerIds.slice(0, 12).map((id) => structuredClone(state.players[id]));
    players.forEach((player, index) => {
      const rating = index < 8 ? 90 : 70;
      for (const key of Object.keys(player.attributes) as Array<keyof typeof player.attributes>) player.attributes[key] = rating;
      player.overallAdjustment = 0;
    });
    const rating = calculateTeamOverallForPlayers(players);
    expect(rating.raw).toBeCloseTo(88, 0);
    expect(rating.overall).toBe(94);
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
