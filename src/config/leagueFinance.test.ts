import { describe, expect, it } from "vitest";
import { getSeasonFinanceConfig, LEAGUE_FINANCE_CONFIG } from "./leagueFinance";

describe("season finance", () => {
  it("keeps 2026 as the base and raises monetary limits by 7% each season", () => {
    const base = getSeasonFinanceConfig(2026);
    const second = getSeasonFinanceConfig(2027);
    const third = getSeasonFinanceConfig(2028);
    expect(base.salaryCap).toBe(LEAGUE_FINANCE_CONFIG.salaryCap);
    expect(second.salaryCap).toBe(Math.round(base.salaryCap * 1.07));
    expect(third.salaryCap).toBe(Math.round(base.salaryCap * 1.07 ** 2));
    for (const field of ["luxuryTaxLine", "firstApron", "secondApron", "minimumSalary", "rookieMinimumSalary"] as const) {
      expect(second[field]).toBe(Math.round(base[field] * 1.07));
      expect(third[field]).toBe(Math.round(base[field] * 1.07 ** 2));
    }
    expect(second.rookieScale[1]).toBe(Math.round(base.rookieScale[1] * 1.07));
    expect(second.salaryMatching.capSpaceBuffer).toBe(Math.round(base.salaryMatching.capSpaceBuffer * 1.07));
    expect(second.salaryMatching.belowFirstApronBuffer).toBe(Math.round(base.salaryMatching.belowFirstApronBuffer * 1.07));
    expect(second.minimumTeamSalary).toBe(Math.round(second.salaryCap * 0.9));
    expect(third.minimumTeamSalary).toBe(Math.round(third.salaryCap * 0.9));
    for (let year = 2026; year <= 2036; year += 1) {
      const finance = getSeasonFinanceConfig(year);
      expect(finance.salaryCap).toBe(Math.round(base.salaryCap * 1.07 ** (year - 2026)));
      expect(finance.minimumTeamSalary).toBe(Math.round(finance.salaryCap * 0.9));
      expect(finance.firstApron).toBeLessThan(finance.secondApron);
      expect(finance.minimumSalary).toBeLessThan(finance.salaryCap);
    }
  });

  it("rejects an invalid season instead of producing NaN salary limits", () => {
    expect(() => getSeasonFinanceConfig(2025)).toThrow(/Invalid finance season/);
    expect(() => getSeasonFinanceConfig(Number.NaN)).toThrow(/Invalid finance season/);
  });
});
