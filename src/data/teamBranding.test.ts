import { describe, expect, it } from "vitest";
import { TEAM_DEFINITIONS } from "./league";
import { EXISTING_TEAM_BRANDING } from "./teamBranding";

describe("team branding dataset", () => {
  it("maps all 30 existing teams to unique same-origin logo assets", () => {
    expect(Object.keys(EXISTING_TEAM_BRANDING)).toHaveLength(30);
    const existingTeams = TEAM_DEFINITIONS.filter((team) => !["SEA", "LVG"].includes(team.id));
    expect(existingTeams).toHaveLength(30);
    expect(new Set(existingTeams.map((team) => team.logoUrl)).size).toBe(30);
    for (const team of existingTeams) {
      expect(team.logoUrl).toMatch(/^(?:\.\/|\/)team-logos\/.+\.png$/);
      expect(team.sourceTeamId).toMatch(/^\d{16}$/);
      expect(team.primaryColor).toBe(`#${team.dayColor}`);
      expect(team.secondaryColor).toBe(`#${team.nightColor}`);
      expect(team.fullName).not.toBe("");
      expect(team.arena).not.toBe("");
    }
  });

  it("keeps expansion teams independent from existing-team branding", () => {
    for (const id of ["SEA", "LVG"]) {
      const team = TEAM_DEFINITIONS.find((entry) => entry.id === id);
      expect(team?.sourceTeamId).toBeUndefined();
      expect(team?.logoUrl).toBeUndefined();
    }
  });

  it("uses the 32-team realignment described by the expansion opening", () => {
    expect(TEAM_DEFINITIONS.find((team) => team.id === "MIN")?.conference).toBe("EAST");
    expect(TEAM_DEFINITIONS.find((team) => team.id === "SEA")?.conference).toBe("WEST");
    expect(TEAM_DEFINITIONS.find((team) => team.id === "LVG")?.conference).toBe("WEST");
    expect(TEAM_DEFINITIONS.filter((team) => team.conference === "EAST")).toHaveLength(16);
    expect(TEAM_DEFINITIONS.filter((team) => team.conference === "WEST")).toHaveLength(16);
  });
});
