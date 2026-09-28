import { describe, expect, it } from "vitest";
import { getCapSheet } from "../cap/CapSheetService";
import { createCareer } from "../season/career";
import { availablePlayerCount, standardAvailablePlayerCount } from "../simulation/injuries";
import { enqueueEvent, executeEventCommand } from "../events/EventService";
import { validateRotationPlan } from "../roster/RotationPlanService";
import {
  chargeEmergencySalariesAtRosterLock,
  executeEmergencyRosterCommand,
  prepareEmergencyRostersForDay,
  resolveEmergencyTerminations,
} from "./EmergencyRosterService";

function reduceAvailableRoster(state: ReturnType<typeof createCareer>, teamId: string, target: number): string[] {
  const disabled: string[] = [];
  for (const playerId of state.teams[teamId].playerIds) {
    const player = state.players[playerId];
    if (player.contract.status !== "STANDARD" || player.contract.contractType === "EMERGENCY") continue;
    if (standardAvailablePlayerCount(state, teamId) <= target) break;
    player.available = false;
    player.rotationRole = "OUT";
    disabled.push(playerId);
  }
  return disabled;
}

describe("emergency active roster", () => {
  it("completes an automatic injury rotation after emergency players are added", () => {
    const state = createCareer("emergency-auto-rotation");
    reduceAvailableRoster(state, state.userTeamId, 5);
    const event = enqueueEvent(state, "injury_core_major_001", {
      player_id: state.teams[state.userTeamId].playerIds[0], player_name: "测试球员", games_out: "4",
    })!;
    const chosen = executeEventCommand(state, {
      commandId: "injury-auto-before-emergency", type: "RESOLVE_EVENT",
      payload: { eventInstanceId: event.eventInstanceId, choiceId: "auto_adjust" },
    });
    expect(chosen.injuryState.pendingAutoRotationAfterEmergency).toBe(true);
    prepareEmergencyRostersForDay(chosen, [chosen.userTeamId]);
    const filled = executeEmergencyRosterCommand(chosen, {
      commandId: "fill-after-injury", type: "FILL_EMERGENCY_ROSTER", payload: { teamId: chosen.userTeamId },
    });
    expect(filled.injuryState.pendingAutoRotationAfterEmergency).toBeUndefined();
    expect(filled.teams[filled.userTeamId].rotationPlan?.selectionMode).toBe("AUTO");
    const roster = filled.teams[filled.userTeamId].playerIds.map((id) => filled.players[id]);
    expect(() => validateRotationPlan(roster, filled.teams[filled.userTeamId].rotationPlan!)).not.toThrow();
  });

  it("pauses the user below eight, fills to eight, and charges only active roster-lock days", () => {
    const state = createCareer("emergency-user");
    const disabled = reduceAvailableRoster(state, state.userTeamId, 7);
    prepareEmergencyRostersForDay(state, [state.userTeamId]);
    expect(state.injuryState.pendingEmergencyRoster?.availableCount).toBe(7);

    const filled = executeEmergencyRosterCommand(state, {
      commandId: "fill-emergency-user",
      type: "FILL_EMERGENCY_ROSTER",
      payload: { teamId: state.userTeamId },
    });
    expect(availablePlayerCount(filled, filled.userTeamId)).toBe(8);
    expect(filled.injuryState.pendingEmergencyRoster).toBeUndefined();
    const emergency = filled.teams[filled.userTeamId].playerIds.map((id) => filled.players[id])
      .find((player) => player.contract.contractType === "EMERGENCY");
    expect(emergency).toBeTruthy();
    expect(emergency?.contract.guaranteedAmount).toBe(0);

    const before = getCapSheet(filled, filled.userTeamId).activeContractSalary;
    chargeEmergencySalariesAtRosterLock(filled, [filled.userTeamId], 10);
    chargeEmergencySalariesAtRosterLock(filled, [filled.userTeamId], 10);
    expect(filled.capState.emergencySalaryCharges).toHaveLength(1);
    expect(getCapSheet(filled, filled.userTeamId).activeContractSalary).toBe(before + (emergency?.contract.emergencyDailySalary ?? 0));

    filled.players[disabled[0]].available = true;
    resolveEmergencyTerminations(filled, filled.userTeamId);
    expect(filled.teams[filled.userTeamId].playerIds).not.toContain(emergency?.id);
    expect(emergency?.contract.status).toBe("UFA");
    expect(filled.capState.deadMoney).toHaveLength(0);
    chargeEmergencySalariesAtRosterLock(filled, [filled.userTeamId], 11);
    expect(filled.capState.emergencySalaryCharges).toHaveLength(1);
  });

  it("automatically fills AI teams to eight even when a generated replacement is required", () => {
    const state = createCareer("emergency-ai");
    const teamId = Object.keys(state.teams).find((id) => id !== state.userTeamId) as string;
    reduceAvailableRoster(state, teamId, 4);
    prepareEmergencyRostersForDay(state, [teamId]);
    expect(availablePlayerCount(state, teamId)).toBe(8);
    expect(state.teams[teamId].playerIds.filter((id) => state.players[id].contract.contractType === "EMERGENCY")).toHaveLength(4);
  });
});
