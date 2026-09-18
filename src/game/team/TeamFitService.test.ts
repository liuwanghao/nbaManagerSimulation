import { describe, expect, it } from "vitest";
import { createCareer } from "../season/career";
import { calculateTeamFit, fitGrade } from "./TeamFitService";

describe("TeamFitService", () => {
  it("returns every V1 explanatory component and a bounded modifier", () => {
    const state = createCareer("team-fit");
    const fit = calculateTeamFit(state, "SEA");
    for (const value of [fit.creation, fit.spacing, fit.perimeterDefense, fit.rimProtection, fit.rebounding, fit.sizeBalance, fit.benchDepth, fit.usageConflict, fit.score, fit.health]) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
    expect(fit.modifier).toBeGreaterThanOrEqual(-5);
    expect(fit.modifier).toBeLessThanOrEqual(5);
    expect(fitGrade(fit.score)).toMatch(/^(?:S|A\+|A|B\+|B|C\+|C|D)$/u);
  });
});
