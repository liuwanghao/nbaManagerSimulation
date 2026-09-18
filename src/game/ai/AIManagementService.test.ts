import { describe, expect, it } from "vitest";
import { createCareer } from "../season/career";
import { refreshAiDirection } from "./AIManagementService";

describe("AIManagementService", () => {
  it("keeps a team direction locked for 60 days before allowing a record-based change", () => {
    const state = createCareer("direction-lock");
    const profile = state.aiTeamProfiles.ATL;
    profile.direction = "CONTEND";
    profile.directionLockUntilCareerDay = state.league.seasonYear * 200 + 60;
    state.standings.ATL.wins = 5;
    state.standings.ATL.losses = 35;
    expect(refreshAiDirection(state, "ATL", 59)).toBe("CONTEND");
    expect(refreshAiDirection(state, "ATL", 60)).toBe("REBUILD");
    expect(profile.directionLockUntilCareerDay).toBe(state.league.seasonYear * 200 + 120);
  });

  it("creates deterministic personality and direction profiles", () => {
    const first = createCareer("ai-profile").aiTeamProfiles;
    const second = createCareer("ai-profile").aiTeamProfiles;
    expect(first).toEqual(second);
    expect(Object.keys(first)).toHaveLength(32);
  });
});
