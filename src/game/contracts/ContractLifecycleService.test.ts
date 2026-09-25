import { describe, expect, it } from "vitest";
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
    state = finalizeOptionPhase(state);
    expect(state.league.currentPhase).toBe("OFFSEASON_PRE_DRAFT");
    expect(state.contractLifecycle?.completed).toBe(true);
    expect(state.capState.capHolds.every((hold, index, holds) => holds.findIndex((entry) => entry.playerId === hold.playerId) === index)).toBe(true);

    const base = offseasonState();
    const command = { commandId: "rollover-once", type: "ROLLOVER_LEAGUE_YEAR", payload: {} } as const;
    const once = executeContractLifecycleCommand(base, command);
    expect(executeContractLifecycleCommand(once, command)).toBe(once);
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
    expect(first.players[player.id].teamId).toBe("FREE_AGENT");
    expect(first.teams.ATL.playerIds).not.toContain(player.id);
    expect(stableHash(stableSerialize(first))).toBe(stableHash(stableSerialize(second)));
  });
});
