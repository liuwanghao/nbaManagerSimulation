import { describe, expect, it } from "vitest";
import { getCapSheet } from "../cap/CapSheetService";
import { createCareer } from "../season/career";
import { availablePlayerCount, standardAvailablePlayerCount } from "../simulation/injuries";
import { enqueueEvent, executeEventCommand } from "../events/EventService";
import { validateRotationPlan } from "../roster/RotationPlanService";
import { calculatePlayerOverall } from "../player/PlayerRatingService";
import {
  chargeEmergencySalariesAtRosterLock,
  executeEmergencyRosterCommand,
  fillEmergencyRoster,
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

function setFreeAgentPool(state: ReturnType<typeof createCareer>, ratings: number[]): string[] {
  for (const player of Object.values(state.players)) {
    if (player.teamId === "FREE_AGENT") player.available = false;
  }
  const template = state.players[state.teams[state.userTeamId].playerIds[0]];
  return ratings.map((rating, index) => {
    const player = structuredClone(template);
    player.id = `emergency-candidate-${index}`;
    player.name = `补员候选${index}`;
    player.teamId = "FREE_AGENT";
    player.available = true;
    player.injury = undefined;
    player.overallAdjustment = 0;
    for (const attribute of Object.keys(player.attributes) as Array<keyof typeof player.attributes>) player.attributes[attribute] = rating;
    player.contract = { salary: 0, yearsRemaining: 0, guaranteedAmount: 0, status: "UFA", optionType: "NONE", optionDecision: "NOT_APPLICABLE" };
    state.players[player.id] = player;
    return player.id;
  });
}

function emergencyPlayers(state: ReturnType<typeof createCareer>, teamId = state.userTeamId) {
  return state.teams[teamId].playerIds.map((id) => state.players[id])
    .filter((player) => player.contract.contractType === "EMERGENCY");
}

describe("emergency active roster", () => {
  it("releases the former team's cap hold when recruiting an emergency free agent", () => {
    const state = createCareer("emergency-release-old-cap-hold");
    reduceAvailableRoster(state, state.userTeamId, 7);
    const [replacementId, otherPlayerId] = setFreeAgentPool(state, [55, 75]);
    const oldTeamId = "BOS";
    state.players[replacementId].birdTeamId = oldTeamId;
    state.players[replacementId].birdYears = 4;
    state.capState.capHolds.push({ playerId: replacementId, teamId: oldTeamId, amount: 5_000_000, type: "BIRD_UFA" });
    state.capState.capHolds.push({ playerId: otherPlayerId, teamId: oldTeamId, amount: 3_000_000, type: "BIRD_UFA" });
    fillEmergencyRoster(state, state.userTeamId);
    expect(state.players[replacementId]).toMatchObject({ teamId: state.userTeamId, birdTeamId: null, birdYears: 0, contract: { contractType: "EMERGENCY" } });
    expect(state.capState.capHolds.some((hold) => hold.playerId === replacementId)).toBe(false);
    expect(state.capState.capHolds).toContainEqual({ playerId: otherPlayerId, teamId: oldTeamId, amount: 3_000_000, type: "BIRD_UFA" });
  });

  it("recruits only low-ability free agents even when 90+ stars are available", () => {
    const state = createCareer("emergency-low-ability-pool");
    reduceAvailableRoster(state, state.userTeamId, 6);
    const [star, fringe, low, boundary] = setFreeAgentPool(state, [97, 66, 55, 65]);
    fillEmergencyRoster(state, state.userTeamId);
    expect(availablePlayerCount(state, state.userTeamId)).toBe(8);
    expect(emergencyPlayers(state).map((player) => player.id).sort()).toEqual([low, boundary].sort());
    expect(state.players[star].teamId).toBe("FREE_AGENT");
    expect(state.players[fringe].teamId).toBe("FREE_AGENT");
    expect(emergencyPlayers(state).every((player) => calculatePlayerOverall(player) <= 65)).toBe(true);
  });

  it("generates low-ability bench players when the free-agent pool contains only stars", () => {
    const state = createCareer("emergency-low-ability-generated");
    reduceAvailableRoster(state, state.userTeamId, 5);
    const stars = setFreeAgentPool(state, [97, 96, 95]);
    fillEmergencyRoster(state, state.userTeamId);
    expect(availablePlayerCount(state, state.userTeamId)).toBe(8);
    expect(emergencyPlayers(state)).toHaveLength(3);
    for (const player of emergencyPlayers(state)) {
      expect(calculatePlayerOverall(player)).toBeLessThanOrEqual(65);
      expect(player).toMatchObject({ teamRole: "BENCH", rotationRole: "BENCH", available: true });
    }
    expect(stars.every((id) => state.players[id].teamId === "FREE_AGENT")).toBe(true);
  });

  it("sends one unread summary with player names, ratings and emergency contracts and does not repeat it", () => {
    const state = createCareer("emergency-fill-notification");
    reduceAvailableRoster(state, state.userTeamId, 6);
    setFreeAgentPool(state, [55, 65]);
    fillEmergencyRoster(state, state.userTeamId);
    expect(state.teamNotifications).toHaveLength(1);
    const notice = state.teamNotifications![0];
    expect(notice.read).toBe(false);
    expect(notice.message).toContain("紧急合同");
    for (const player of emergencyPlayers(state)) {
      expect(notice.message).toContain(player.name);
      expect(notice.message).toContain(String(Math.round(calculatePlayerOverall(player))));
    }
    fillEmergencyRoster(state, state.userTeamId);
    expect(state.teamNotifications).toHaveLength(1);
  });

  it.each([0, 1])("sends a fresh unread notice when the same replacement is released and signed again after %i days", (elapsedDays) => {
    const state = createCareer(`emergency-repeat-signing-${elapsedDays}`);
    const disabled = reduceAvailableRoster(state, state.userTeamId, 7);
    const [replacementId] = setFreeAgentPool(state, [55]);
    fillEmergencyRoster(state, state.userTeamId);
    expect(emergencyPlayers(state).map((player) => player.id)).toEqual([replacementId]);
    expect(state.teamNotifications).toHaveLength(1);
    const firstNotice = state.teamNotifications![0];
    firstNotice.read = true;

    state.players[disabled[0]].available = true;
    resolveEmergencyTerminations(state, state.userTeamId);
    expect(state.players[replacementId].teamId).toBe("FREE_AGENT");
    state.players[disabled[0]].available = false;
    state.calendar.currentDateIndex += elapsedDays;
    fillEmergencyRoster(state, state.userTeamId);

    expect(emergencyPlayers(state).map((player) => player.id)).toEqual([replacementId]);
    expect(state.teamNotifications).toHaveLength(2);
    expect(state.teamNotifications![0]).toMatchObject({ read: false });
    expect(state.teamNotifications![0].id).not.toBe(firstNotice.id);
    expect(state.teamNotifications![0].message).toContain(state.players[replacementId].name);
    expect(firstNotice.read).toBe(true);
    fillEmergencyRoster(state, state.userTeamId);
    expect(state.teamNotifications).toHaveLength(2);
  });

  it("does not send a player notification when an AI team fills its emergency roster", () => {
    const state = createCareer("emergency-ai-notification");
    const teamId = Object.keys(state.teams).find((id) => id !== state.userTeamId)!;
    reduceAvailableRoster(state, teamId, 7);
    setFreeAgentPool(state, [55]);
    fillEmergencyRoster(state, teamId);
    expect(availablePlayerCount(state, teamId)).toBe(8);
    expect(state.teamNotifications ?? []).toEqual([]);
  });

  it("defers automatic depth-injury rotation until emergency players are added without an event popup", () => {
    const state = createCareer("depth-injury-emergency-rotation");
    reduceAvailableRoster(state, state.userTeamId, 5);
    const event = enqueueEvent(state, "injury_depth_test_001", {
      player_id: state.teams[state.userTeamId].playerIds[0], player_name: "测试球员", injury_duration: "预计伤停约 3 天", games_out: "2",
    })!;
    expect(event.status).toBe("RESOLVED");
    expect(event.effectivePause).toBe(false);
    expect(state.eventState.queue).toEqual([]);
    expect(state.injuryState.pendingAutoRotationAfterEmergency).toBe(true);
    expect(state.teamNotifications?.[0].message).toContain("补齐后将自动安排轮换");
    prepareEmergencyRostersForDay(state, [state.userTeamId]);
    const filled = executeEmergencyRosterCommand(state, {
      commandId: "depth-injury-fill", type: "FILL_EMERGENCY_ROSTER", payload: { teamId: state.userTeamId },
    });
    expect(filled.injuryState.pendingAutoRotationAfterEmergency).toBeUndefined();
    const roster = filled.teams[filled.userTeamId].playerIds.map((id) => filled.players[id]);
    expect(() => validateRotationPlan(roster, filled.teams[filled.userTeamId].rotationPlan!)).not.toThrow();
    expect(filled.teamNotifications).toHaveLength(2);
    expect(filled.teamNotifications?.some((notice) => notice.message.includes("补齐后将自动安排轮换"))).toBe(true);
  });

  it("completes an automatic injury rotation after emergency players are added", () => {
    const state = createCareer("emergency-auto-rotation");
    reduceAvailableRoster(state, state.userTeamId, 5);
    const event = enqueueEvent(state, "injury_core_major_001", {
      player_id: state.teams[state.userTeamId].playerIds[0], player_name: "测试球员", games_out: "4",
    })!;
    expect(state.eventState.queue).toEqual([]);
    expect(state.injuryState.pendingAutoRotationAfterEmergency).toBe(true);
    prepareEmergencyRostersForDay(state, [state.userTeamId]);
    const filled = executeEmergencyRosterCommand(state, {
      commandId: "fill-after-injury", type: "FILL_EMERGENCY_ROSTER", payload: { teamId: state.userTeamId },
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
