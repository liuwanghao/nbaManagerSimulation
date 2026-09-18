import { describe, expect, it } from "vitest";
import { GAME_CONFIG, validateGameConfig } from "./gameConfig";

describe("versioned game configuration", () => {
  it("keeps all tuning domains available from one validated entry point", () => {
    expect(validateGameConfig()).toEqual([]);
    expect(GAME_CONFIG.balance.draft.classSize).toBe(80);
    expect(GAME_CONFIG.balance.draft.historicalRebirth.maximumPerClass).toBeLessThanOrEqual(GAME_CONFIG.balance.draft.classSize);
    expect(GAME_CONFIG.balance.draft.historicalRebirth.mode).toBe("LEGEND_ARCHETYPE");
    expect(GAME_CONFIG.balance.achievements.FIRST_WIN.trigger.value).toBe(1);
    expect(GAME_CONFIG.simulation.starPower.weight).toBeGreaterThan(0);
    expect(GAME_CONFIG.finance.maximumSalaryPercentages.tenPlusYears).toBe(0.35);
    expect(GAME_CONFIG.simulation.boxScore.turnover.baseRate).toBe(0.14);
    expect(GAME_CONFIG.balance.teamFit.modifier.maximum).toBe(5);
    expect(GAME_CONFIG.balance.awards.allStarsPerConference).toBe(12);
    expect(GAME_CONFIG.finance.rosterLimits.regularSeasonMinimum).toBe(14);
  });
});
