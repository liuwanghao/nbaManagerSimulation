import { getSeasonFinanceConfig, LEAGUE_FINANCE_CONFIG } from "../../config/leagueFinance";
import { stableHash } from "../random/hash";
import type { GameState, Player } from "../state/types";
import { availablePlayerCount, standardAvailablePlayerCount } from "../simulation/injuries";
import { applyRotationPlanToPlayers, buildDefaultRotationPlan } from "../roster/RotationPlanService";
import { getAutomaticRosterReplacement, notifyAutomaticRosterFill } from "../roster/AutomaticRosterFillService";

export type EmergencyRosterCommand = {
  commandId: string;
  type: "FILL_EMERGENCY_ROSTER";
  payload: { teamId: string };
};

function signEmergencyPlayer(state: GameState, teamId: string): Player {
  const player = getAutomaticRosterReplacement(state);
  const remainingDays = Math.max(1, state.calendar.finalDateIndex - state.calendar.currentDateIndex + 1);
  const dailySalary = Math.ceil(getSeasonFinanceConfig(state.league.seasonYear).minimumSalary / LEAGUE_FINANCE_CONFIG.emergencyContract.fullSeasonDays);
  player.teamId = teamId;
  player.available = true;
  player.injury = undefined;
  player.rotationRole = "BENCH";
  player.teamRole = "BENCH";
  player.birdTeamId = null;
  player.birdYears = 0;
  player.serviceRosterDays = 0;
  player.contract = {
    salary: dailySalary * remainingDays,
    yearsRemaining: 1,
    guaranteedAmount: 0,
    status: "STANDARD",
    optionType: "NONE",
    optionDecision: "NOT_APPLICABLE",
    contractId: stableHash(state.league.seasonId, teamId, player.id, "emergency"),
    contractType: "EMERGENCY",
    startSeason: state.league.seasonYear,
    endSeason: state.league.seasonYear,
    currentYearIndex: 0,
    salaryByYear: [dailySalary * remainingDays],
    guaranteedByYear: [0],
    optionByYear: ["NONE"],
    signedTeamId: teamId,
    signedPhase: state.league.currentPhase,
    emergencyStatus: "ACTIVE",
    emergencyDailySalary: dailySalary,
  };
  state.capState.capHolds = state.capState.capHolds.filter((hold) => hold.playerId !== player.id);
  if (!state.teams[teamId].playerIds.includes(player.id)) state.teams[teamId].playerIds.push(player.id);
  return player;
}

function terminateEmergencyPlayer(state: GameState, player: Player): void {
  const teamId = player.teamId;
  if (state.teams[teamId]) state.teams[teamId].playerIds = state.teams[teamId].playerIds.filter((id) => id !== player.id);
  player.teamId = "FREE_AGENT";
  player.freeAgentDemand = { uncontestedDays: 0 };
  player.rotationRole = "OUT";
  player.contract = {
    salary: 0,
    yearsRemaining: 0,
    guaranteedAmount: 0,
    status: "UFA",
    optionType: "NONE",
    optionDecision: "NOT_APPLICABLE",
  };
}

export function resolveEmergencyTerminations(state: GameState, teamId: string): void {
  if (standardAvailablePlayerCount(state, teamId) < LEAGUE_FINANCE_CONFIG.rosterLimits.emergencyTarget) return;
  const emergencyPlayers = state.teams[teamId].playerIds.map((id) => state.players[id])
    .filter((player) => player?.contract.contractType === "EMERGENCY" && player.contract.emergencyStatus === "ACTIVE");
  for (const player of emergencyPlayers) {
    player.contract.emergencyStatus = "PENDING_TERMINATION";
    terminateEmergencyPlayer(state, player);
  }
}

export function fillEmergencyRoster(state: GameState, teamId: string): void {
  if (!state.teams[teamId]) throw new Error("EMERGENCY_TEAM_NOT_FOUND");
  const signedPlayers: Player[] = [];
  while (availablePlayerCount(state, teamId) < LEAGUE_FINANCE_CONFIG.rosterLimits.emergencyTarget) {
    signedPlayers.push(signEmergencyPlayer(state, teamId));
  }
  if (teamId === state.userTeamId && state.injuryState.pendingAutoRotationAfterEmergency) {
    const players = state.teams[teamId].playerIds.map((id) => state.players[id]).filter(Boolean);
    state.teams[teamId].rotationPlan = buildDefaultRotationPlan(players.filter((player) => player.contract.status === "STANDARD"));
    applyRotationPlanToPlayers(players, state.teams[teamId].rotationPlan);
    state.injuryState.pendingAutoRotationAfterEmergency = undefined;
  }
  if (state.injuryState.pendingEmergencyRoster?.teamId === teamId) state.injuryState.pendingEmergencyRoster = undefined;
  if (teamId === state.userTeamId) notifyAutomaticRosterFill(state, signedPlayers, "EMERGENCY");
}

export function prepareEmergencyRostersForDay(state: GameState, teamIds: string[]): void {
  for (const teamId of [...new Set(teamIds)].sort()) resolveEmergencyTerminations(state, teamId);
  for (const teamId of [...new Set(teamIds)].sort()) {
    const count = availablePlayerCount(state, teamId);
    if (count >= LEAGUE_FINANCE_CONFIG.rosterLimits.emergencyTarget) continue;
    if (teamId === state.userTeamId) {
      state.injuryState.pendingEmergencyRoster = { teamId, availableCount: count, requiredCount: LEAGUE_FINANCE_CONFIG.rosterLimits.emergencyTarget };
      continue;
    }
    fillEmergencyRoster(state, teamId);
  }
}

export function chargeEmergencySalariesAtRosterLock(state: GameState, teamIds: string[], dateIndex: number): void {
  state.capState.emergencySalaryCharges ??= [];
  for (const teamId of [...new Set(teamIds)].sort()) {
    for (const playerId of state.teams[teamId].playerIds) {
      const player = state.players[playerId];
      if (player?.contract.contractType !== "EMERGENCY" || player.contract.emergencyStatus !== "ACTIVE") continue;
      const id = stableHash(state.league.seasonId, dateIndex, teamId, playerId, "emergency-daily-salary");
      if (state.capState.emergencySalaryCharges.some((charge) => charge.id === id)) continue;
      state.capState.emergencySalaryCharges.push({
        id,
        playerId,
        teamId,
        seasonId: state.league.seasonId,
        dateIndex,
        amount: player.contract.emergencyDailySalary ?? Math.ceil(getSeasonFinanceConfig(state.league.seasonYear).minimumSalary / LEAGUE_FINANCE_CONFIG.emergencyContract.fullSeasonDays),
      });
    }
  }
}

export function executeEmergencyRosterCommand(state: GameState, command: EmergencyRosterCommand): GameState {
  const payloadHash = stableHash(command.type, command.payload);
  const receipt = state.commandReceipts[command.commandId];
  if (receipt) {
    if (receipt.payloadHash !== payloadHash) throw new Error("Command ID 已被不同 Payload 使用");
    return state;
  }
  if (command.payload.teamId !== state.userTeamId) throw new Error("EMERGENCY_USER_TEAM_ONLY");
  if (state.injuryState.pendingEmergencyRoster?.teamId !== command.payload.teamId) throw new Error("EMERGENCY_ROSTER_NOT_PENDING");
  const next = structuredClone(state);
  fillEmergencyRoster(next, command.payload.teamId);
  next.commandReceipts[command.commandId] = { payloadHash };
  return next;
}
