import { describe, expect, it } from "vitest";
import { LEAGUE_FINANCE_CONFIG } from "../../config/leagueFinance";
import { getCapSheet } from "../cap/CapSheetService";
import { createCareer } from "../season/career";
import { validateSalaryMatch } from "./SalaryMatchValidator";

function salaryScenario(outgoingSalaries: number[], incomingSalary: number, targetPreSalary: number) {
  const state = createCareer("salary-match-test");
  const teamId = state.userTeamId;
  const otherTeamId = Object.keys(state.teams).find((id) => id !== teamId) as string;
  const outgoingIds = state.teams[teamId].playerIds.slice(0, outgoingSalaries.length);
  const incomingId = state.teams[otherTeamId].playerIds[0];
  state.teams[teamId].playerIds.filter((id) => !outgoingIds.includes(id)).forEach((id) => {
    state.players[id].contract.salary = 1_000_000;
  });
  outgoingIds.forEach((id, index) => { state.players[id].contract.salary = outgoingSalaries[index]; });
  state.players[incomingId].contract.salary = incomingSalary;
  const current = getCapSheet(state, teamId).total;
  state.capState.deadMoney.push({ id: "trade-test-dead-money", teamId, salaryBySeason: { [state.league.seasonId]: targetPreSalary - current } });
  return { state, teamId, outgoingIds, incomingId };
}

describe("SalaryMatchValidator", () => {
  it("uses the expanded simultaneous exception below the first apron", () => {
    const { state, teamId, outgoingIds, incomingId } = salaryScenario([5_000_000], 9_000_000, 175_000_000);
    expect(getCapSheet(state, teamId).total).toBe(175_000_000);
    expect(() => validateSalaryMatch(state, teamId, outgoingIds, [incomingId])).not.toThrow();
  });

  it("does not grant the $250k salary buffer at or above the first apron", () => {
    const first = LEAGUE_FINANCE_CONFIG.firstApron;
    const { state, teamId, outgoingIds, incomingId } = salaryScenario([5_000_000], 5_000_001, first + 1_000_000);
    expect(() => validateSalaryMatch(state, teamId, outgoingIds, [incomingId])).toThrow("FIRST_APRON_SALARY_MATCH_FAILED");
  });

  it("prevents salary aggregation above the second apron", () => {
    const second = LEAGUE_FINANCE_CONFIG.secondApron;
    const { state, teamId, outgoingIds, incomingId } = salaryScenario([5_000_000, 5_000_000], 9_000_000, second + 1_000_000);
    expect(() => validateSalaryMatch(state, teamId, outgoingIds, [incomingId])).toThrow("SECOND_APRON_SALARY_MATCH_FAILED");
  });

  it("does not count free-agent cap holds as apron salary", () => {
    const { state, teamId, outgoingIds, incomingId } = salaryScenario([5_000_000], 9_000_000, 175_000_000);
    state.capState.capHolds.push({ playerId: "future-free-agent", teamId, amount: 50_000_000, type: "BIRD_UFA" });
    expect(getCapSheet(state, teamId).total).toBeGreaterThan(LEAGUE_FINANCE_CONFIG.secondApron);
    expect(() => validateSalaryMatch(state, teamId, outgoingIds, [incomingId])).not.toThrow();
  });
});
