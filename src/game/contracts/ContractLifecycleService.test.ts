import { describe, expect, it } from "vitest";
import { getSeasonFinanceConfig } from "../../config/leagueFinance";
import { stableHash, stableSerialize } from "../random/hash";
import { createCareer } from "../season/career";
import {
  executeContractLifecycleCommand,
  finalizeOptionPhase,
  resolveTeamOption,
  rolloverLeagueYear,
} from "./ContractLifecycleService";

function offseasonState() {
  const state = createCareer("contract-rollover");
  state.league.currentPhase = "OFFSEASON";
  return state;
}

describe("ContractLifecycleService", () => {
  it.each([
    { seasonYear: 2027, serviceYears: 3, percentage: 0.25 },
    { seasonYear: 2027, serviceYears: 10, percentage: 0.35 },
    { seasonYear: 2028, serviceYears: 8, percentage: 0.3 },
  ])("uses the whole-dollar maximum for Bird cap holds in $seasonYear with $serviceYears service years", ({ seasonYear, serviceYears, percentage }) => {
    const state = offseasonState();
    state.league.currentPhase = "OPTION_PHASE";
    state.league.seasonYear = seasonYear;
    state.contractLifecycle = { rolloverSeasonId: state.league.seasonId, pendingUserTeamOptionPlayerIds: [], transactionLog: [], completed: false };
    const playerId = state.teams[state.userTeamId].playerIds.pop()!;
    const player = state.players[playerId];
    player.teamId = "FREE_AGENT";
    player.contract.status = "UFA";
    player.contract.salary = 80_000_000;
    player.serviceYears = serviceYears;
    player.birdTeamId = state.userTeamId;
    player.birdYears = 3;
    const next = finalizeOptionPhase(state);
    expect(next.capState.capHolds.find((hold) => hold.playerId === playerId)?.amount).toBe(Math.round(getSeasonFinanceConfig(seasonYear).salaryCap * percentage));
  });

  it("rolls service time, Bird continuity and a pending user team option exactly once", () => {
    const state = offseasonState();
    const player = state.players[state.teams[state.userTeamId].playerIds[0]];
    const serviceBefore = player.serviceYears;
    player.serviceRosterDays = 82;
    player.birdTeamId = state.userTeamId;
    player.birdYears = 2;
    player.contract = {
      salary: 4_000_000, yearsRemaining: 2, guaranteedAmount: 4_000_000, status: "STANDARD",
      optionType: "TEAM", optionDecision: "NOT_APPLICABLE", contractId: "test-option", contractType: "STANDARD",
      startSeason: 2026, endSeason: 2027, currentYearIndex: 0,
      salaryByYear: [4_000_000, 5_000_000], guaranteedByYear: [4_000_000, 0], optionByYear: ["NONE", "TEAM_OPTION"],
      signedTeamId: state.userTeamId, signedPhase: "TEST",
    };

    const next = rolloverLeagueYear(state);
    expect(next.league.seasonId).toBe("2027-28");
    expect(next.league.currentPhase).toBe("OPTION_PHASE");
    expect(next.players[player.id].serviceYears).toBe(serviceBefore + 1);
    expect(next.players[player.id].serviceRosterDays).toBe(0);
    expect(next.players[player.id].birdYears).toBe(3);
    expect(next.players[player.id].contract.salary).toBe(5_000_000);
    expect(next.contractLifecycle?.pendingUserTeamOptionPlayerIds).toContain(player.id);
    expect(state.league.seasonId).toBe("2026-27");
  });

  it("starts the new season with empty live player stats after preserving the snapshot", () => {
    const state = offseasonState();
    const player = state.players[state.teams[state.userTeamId].playerIds[0]];
    player.seasonStats.games = 91;
    player.seasonStats.pts = 1_820;
    const next = rolloverLeagueYear(state);

    expect(next.players[player.id].seasonStats.games).toBe(0);
    expect(next.players[player.id].seasonStats.pts).toBe(0);
    expect(next.players[player.id].career?.lastSeasonStats).toMatchObject({ games: 91, pts: 1_820 });
  });

  it("requires every user option decision, creates holds and is command-idempotent", () => {
    const input = offseasonState();
    const optionPlayer = input.players[input.teams[input.userTeamId].playerIds[0]];
    optionPlayer.contract = {
      salary: 4_000_000, yearsRemaining: 2, guaranteedAmount: 4_000_000, status: "STANDARD",
      optionType: "TEAM", optionDecision: "NOT_APPLICABLE", contractId: "pending-option", contractType: "STANDARD",
      startSeason: 2026, endSeason: 2027, currentYearIndex: 0,
      salaryByYear: [4_000_000, 5_000_000], guaranteedByYear: [4_000_000, 0], optionByYear: ["NONE", "TEAM_OPTION"],
      signedTeamId: input.userTeamId, signedPhase: "TEST",
    };
    let state = rolloverLeagueYear(input);
    expect(() => finalizeOptionPhase(state)).toThrow(/TEAM_OPTIONS_STILL_PENDING/);
    for (const playerId of [...(state.contractLifecycle?.pendingUserTeamOptionPlayerIds ?? [])]) state = resolveTeamOption(state, playerId, "DECLINE");
    expect(state.players[optionPlayer.id].contract.optionDecision).toBe("DECLINED");
    expect(state.contractLifecycle?.renewalEligiblePlayerIds).not.toContain(optionPlayer.id);
    state = finalizeOptionPhase(state);
    expect(state.league.currentPhase).toBe("OFFSEASON_PRE_DRAFT");
    expect(state.contractLifecycle?.completed).toBe(true);
    expect(state.capState.capHolds.every((hold, index, holds) => holds.findIndex((entry) => entry.playerId === hold.playerId) === index)).toBe(true);

    const base = offseasonState();
    const command = { commandId: "rollover-once", type: "ROLLOVER_LEAGUE_YEAR", payload: {} } as const;
    const once = executeContractLifecycleCommand(base, command);
    expect(executeContractLifecycleCommand(once, command)).toBe(once);
  });

  it("records a player's decision to decline an undervalued player option", () => {
    const input = offseasonState();
    const player = input.players[input.teams[input.userTeamId].playerIds[0]];
    player.contract = {
      salary: 4_000_000, yearsRemaining: 2, guaranteedAmount: 4_000_000, status: "STANDARD",
      optionType: "PLAYER", optionDecision: "NOT_APPLICABLE", contractId: "declined-player-option", contractType: "STANDARD",
      startSeason: 2026, endSeason: 2027, currentYearIndex: 0,
      salaryByYear: [4_000_000, 1], guaranteedByYear: [4_000_000, 0], optionByYear: ["NONE", "PLAYER_OPTION"],
      signedTeamId: input.userTeamId, signedPhase: "TEST",
    };

    const next = rolloverLeagueYear(input);
    expect(next.players[player.id].contract.status).toBe("UFA");
    expect(next.players[player.id].contract.optionDecision).toBe("DECLINED");
    expect(next.contractLifecycle?.transactionLog).toContain(`${player.name} · PLAYER_OPTION_DECLINED · 成为UFA`);
    expect(next.contractLifecycle?.renewalEligiblePlayerIds).toContain(player.id);
  });

  it("makes completed first-round rookie contracts restricted free agents deterministically", () => {
    const state = offseasonState();
    const player = state.players[state.teams.ATL.playerIds[0]];
    player.contract = {
      salary: 8_000_000, yearsRemaining: 1, guaranteedAmount: 8_000_000, status: "STANDARD",
      optionType: "NONE", optionDecision: "NOT_APPLICABLE", contractId: "rookie-expiring", contractType: "ROOKIE_FIRST",
      startSeason: 2023, endSeason: 2026, currentYearIndex: 3,
      salaryByYear: [5_000_000, 6_000_000, 7_000_000, 8_000_000], guaranteedByYear: [5_000_000, 6_000_000, 0, 0],
      optionByYear: ["NONE", "NONE", "TEAM_OPTION", "TEAM_OPTION"], signedTeamId: "ATL", signedPhase: "DRAFT",
    };
    player.birdTeamId = "ATL";
    player.birdYears = 4;
    const run = () => rolloverLeagueYear(structuredClone(state));
    const first = run();
    const second = run();
    expect(first.players[player.id].contract.status).toBe("RFA");
    expect(first.players[player.id].contract.qualifyingOfferDecision).toBe("PENDING");
    expect(first.contractLifecycle?.renewalEligiblePlayerIds).toContain(player.id);
    expect(first.players[player.id].teamId).toBe("FREE_AGENT");
    expect(first.teams.ATL.playerIds).not.toContain(player.id);
    expect(stableHash(stableSerialize(first))).toBe(stableHash(stableSerialize(second)));
  });
});
