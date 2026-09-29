import { describe, expect, it } from "vitest";
import { LEAGUE_FINANCE_CONFIG } from "../../config/leagueFinance";
import { getCapSheet } from "../cap/CapSheetService";
import { createCareer } from "../season/career";
import { validateSalaryMatch } from "./SalaryMatchValidator";

function salaryScenario(outgoingSalaries: number[], incomingSalary: number | number[], targetPreSalary: number) {
  const state = createCareer("salary-match-test");
  const teamId = state.userTeamId;
  const otherTeamId = Object.keys(state.teams).find((id) => id !== teamId) as string;
  const outgoingIds = state.teams[teamId].playerIds.slice(0, outgoingSalaries.length);
  const incomingSalaries = Array.isArray(incomingSalary) ? incomingSalary : [incomingSalary];
  const incomingIds = state.teams[otherTeamId].playerIds.slice(0, incomingSalaries.length);
  const incomingId = incomingIds[0];
  state.teams[teamId].playerIds.filter((id) => !outgoingIds.includes(id)).forEach((id) => {
    state.players[id].contract.salary = 1_000_000;
  });
  outgoingIds.forEach((id, index) => { state.players[id].contract.salary = outgoingSalaries[index]; });
  incomingIds.forEach((id, index) => { state.players[id].contract.salary = incomingSalaries[index]; });
  const current = getCapSheet(state, teamId).total;
  state.capState.deadMoney.push({ id: "trade-test-dead-money", teamId, salaryBySeason: { [state.league.seasonId]: targetPreSalary - current } });
  return { state, teamId, outgoingIds, incomingId, incomingIds };
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
    const { state, teamId, outgoingIds, incomingId } = salaryScenario([5_000_000, 5_000_000], 9_000_000, second + 5_000_000);
    expect(() => validateSalaryMatch(state, teamId, outgoingIds, [incomingId])).toThrow("SECOND_APRON_SALARY_MATCH_FAILED");
  });

  it("lets a one-year minimum contract come in without outgoing matching salary", () => {
    const minimum = LEAGUE_FINANCE_CONFIG.minimumSalary;
    const { state, teamId, incomingId } = salaryScenario([], minimum, LEAGUE_FINANCE_CONFIG.secondApron + 1_000_000);
    const player = state.players[incomingId];
    player.serviceYears = 0;
    player.contract.contractType = "STANDARD";
    player.contract.startSeason = state.league.seasonYear;
    player.contract.endSeason = state.league.seasonYear;
    player.contract.currentYearIndex = 0;
    player.contract.yearsRemaining = 1;
    player.contract.salaryByYear = [minimum];
    expect(() => validateSalaryMatch(state, teamId, [], [incomingId])).not.toThrow();
  });

  it("does not mistake a final-year minimum salary on a longer deal for a minimum contract", () => {
    const minimum = LEAGUE_FINANCE_CONFIG.minimumSalary;
    const { state, teamId, incomingId } = salaryScenario([], minimum, LEAGUE_FINANCE_CONFIG.secondApron + 1_000_000);
    const contract = state.players[incomingId].contract;
    contract.contractType = "STANDARD";
    contract.startSeason = state.league.seasonYear - 2;
    contract.endSeason = state.league.seasonYear;
    contract.currentYearIndex = 2;
    contract.yearsRemaining = 1;
    contract.salaryByYear = [minimum, minimum, minimum];
    expect(() => validateSalaryMatch(state, teamId, [], [incomingId])).toThrow("SECOND_APRON_SALARY_MATCH_FAILED");
  });

  it("requires every year of a two-year minimum contract to meet the exception", () => {
    const minimum = LEAGUE_FINANCE_CONFIG.minimumSalary;
    const { state, teamId, incomingId } = salaryScenario([], minimum, LEAGUE_FINANCE_CONFIG.secondApron + 1_000_000);
    const player = state.players[incomingId];
    player.serviceYears = 0;
    player.contract.contractType = "STANDARD";
    player.contract.startSeason = state.league.seasonYear;
    player.contract.endSeason = state.league.seasonYear + 1;
    player.contract.currentYearIndex = 0;
    player.contract.yearsRemaining = 2;
    player.contract.salaryByYear = [minimum, Math.round(1_955_377 * minimum / 1_157_153 * 1.07)];
    expect(() => validateSalaryMatch(state, teamId, [], [incomingId])).not.toThrow();
    player.contract.salaryByYear[1] += 100_000;
    expect(() => validateSalaryMatch(state, teamId, [], [incomingId])).toThrow("SECOND_APRON_SALARY_MATCH_FAILED");
  });

  it("also recognizes a service-year veteran minimum on a one-year contract", () => {
    const veteranMinimum = Math.round(3_303_771 * LEAGUE_FINANCE_CONFIG.minimumSalary / 1_157_153);
    const { state, teamId, incomingId } = salaryScenario([], veteranMinimum, LEAGUE_FINANCE_CONFIG.secondApron + 1_000_000);
    const player = state.players[incomingId];
    player.serviceYears = 10;
    player.contract.contractType = "STANDARD";
    player.contract.startSeason = state.league.seasonYear;
    player.contract.endSeason = state.league.seasonYear;
    player.contract.currentYearIndex = 0;
    player.contract.yearsRemaining = 1;
    player.contract.salaryByYear = [veteranMinimum];
    expect(() => validateSalaryMatch(state, teamId, [], [incomingId])).not.toThrow();
  });

  it("handles incomplete legacy contract metadata without granting an unproven exception", () => {
    const minimum = LEAGUE_FINANCE_CONFIG.minimumSalary;
    const { state, teamId, incomingId } = salaryScenario([], minimum, LEAGUE_FINANCE_CONFIG.secondApron + 1_000_000);
    state.players[incomingId].contract.salaryByYear = undefined;
    expect(() => validateSalaryMatch(state, teamId, [], [incomingId])).toThrow("SECOND_APRON_SALARY_MATCH_FAILED");
  });

  it("allows separately matched standard exceptions above the second apron", () => {
    const { state, teamId, outgoingIds, incomingIds } = salaryScenario([10_000_000, 4_000_000], [9_000_000, 3_000_000], LEAGUE_FINANCE_CONFIG.secondApron + 1_000_000);
    expect(() => validateSalaryMatch(state, teamId, outgoingIds, incomingIds)).not.toThrow();
  });

  it("allows one outgoing salary to cover multiple incoming players without aggregation", () => {
    const { state, teamId, outgoingIds, incomingIds } = salaryScenario([10_000_000], [6_000_000, 4_000_000], LEAGUE_FINANCE_CONFIG.secondApron + 1_000_000);
    expect(() => validateSalaryMatch(state, teamId, outgoingIds, incomingIds)).not.toThrow();
  });

  it("rejects two incoming salaries that need aggregation above the second apron", () => {
    const { state, teamId, outgoingIds, incomingIds } = salaryScenario([10_000_000, 4_000_000], [11_000_000, 1_000_000], LEAGUE_FINANCE_CONFIG.secondApron + 5_000_000);
    expect(() => validateSalaryMatch(state, teamId, outgoingIds, incomingIds)).toThrow("SECOND_APRON_SALARY_MATCH_FAILED");
  });

  it("allows aggregation when the completed trade takes a team below the second apron", () => {
    const second = LEAGUE_FINANCE_CONFIG.secondApron;
    const { state, teamId, outgoingIds, incomingId } = salaryScenario([8_000_000, 5_000_000], 10_000_000, second + 2_000_000);
    expect(() => validateSalaryMatch(state, teamId, outgoingIds, [incomingId])).not.toThrow();
  });

  it("treats a post-trade salary exactly on an apron as below that restriction", () => {
    const first = LEAGUE_FINANCE_CONFIG.firstApron;
    const firstScenario = salaryScenario([5_000_000], 6_000_000, first - 1_000_000);
    expect(() => validateSalaryMatch(firstScenario.state, firstScenario.teamId, firstScenario.outgoingIds, [firstScenario.incomingId])).not.toThrow();

    const second = LEAGUE_FINANCE_CONFIG.secondApron;
    const secondScenario = salaryScenario([8_000_000, 5_000_000], 11_000_000, second + 2_000_000);
    expect(() => validateSalaryMatch(secondScenario.state, secondScenario.teamId, secondScenario.outgoingIds, [secondScenario.incomingId])).not.toThrow();
  });

  it("does not count free-agent cap holds as apron salary", () => {
    const { state, teamId, outgoingIds, incomingId } = salaryScenario([5_000_000], 9_000_000, 175_000_000);
    state.capState.capHolds.push({ playerId: "future-free-agent", teamId, amount: 50_000_000, type: "BIRD_UFA" });
    expect(getCapSheet(state, teamId).total).toBeGreaterThan(LEAGUE_FINANCE_CONFIG.secondApron);
    expect(() => validateSalaryMatch(state, teamId, outgoingIds, [incomingId])).not.toThrow();
  });
});
