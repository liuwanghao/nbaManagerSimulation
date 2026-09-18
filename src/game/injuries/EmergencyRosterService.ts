import { LEAGUE_FINANCE_CONFIG } from "../../config/leagueFinance";
import { BALANCE_CONFIG } from "../../config/balanceConfig";
import { createFictionalPlayerProfile } from "../../data/playerProfiles";
import { publicPlayerValue } from "../ai/AIValueService";
import { stableHash } from "../random/hash";
import { createRng } from "../random/xoshiro";
import { emptyPlayerSeasonStats, type GameState, type Player, type PlayerAttributes, type Position } from "../state/types";
import { availablePlayerCount, standardAvailablePlayerCount } from "../simulation/injuries";

export type EmergencyRosterCommand = {
  commandId: string;
  type: "FILL_EMERGENCY_ROSTER";
  payload: { teamId: string };
};

const POSITIONS: Position[] = ["PG", "SG", "SF", "PF", "C"];
function replacementAttributes(seed: string): PlayerAttributes {
  const rng = createRng(seed);
  const config = BALANCE_CONFIG.replacementPlayers;
  const rating = (modifier = 0) => Math.max(config.attributeMinimum, Math.min(config.attributeMaximum,
    config.attributeBase + modifier + rng.int(-config.attributeNoise, config.attributeNoise)));
  return {
    shooting: rating(),
    finishing: rating(1),
    playmaking: rating(-1),
    perimeterDefense: rating(),
    interiorDefense: rating(),
    rebounding: rating(),
    athleticism: rating(1),
    basketballIq: rating(2),
  };
}

function createReplacementPlayer(state: GameState, teamId: string): Player {
  const ordinal = Object.keys(state.players).filter((id) => id.startsWith(`EMG-${state.league.seasonId}-${teamId}-`)).length;
  const id = `EMG-${state.league.seasonId}-${teamId}-${String(ordinal + 1).padStart(2, "0")}`;
  const seed = stableHash(state.seeds.seasonSeed, "emergency-player", id);
  const rng = createRng(seed);
  const config = BALANCE_CONFIG.replacementPlayers;
  const position = POSITIONS[rng.int(0, POSITIONS.length - 1)];
  const age = rng.int(config.ageMinimum, config.ageMaximum);
  const profile = createFictionalPlayerProfile(state.seeds.careerSeed, Object.keys(state.players).length + ordinal, id, position, age);
  return {
    id,
    teamId: "FREE_AGENT",
    ...profile,
    age,
    position,
    attributes: replacementAttributes(seed),
    threeRate: config.threeRateMinimum + rng.nextFloat() * config.threeRateRange,
    assistRate: config.assistRateMinimum + rng.nextFloat() * config.assistRateRange,
    rimRate: config.rimRateMinimum + rng.nextFloat() * config.rimRateRange,
    usageTendency: rng.int(config.usageMinimum, config.usageMaximum),
    health: 100,
    morale: config.initialMorale,
    fatigue: 0,
    form: 0,
    rotationRole: "OUT",
    teamRole: "BENCH",
    available: true,
    serviceRosterDays: 0,
    birdTeamId: null,
    birdYears: 0,
    contract: {
      salary: 0,
      yearsRemaining: 0,
      guaranteedAmount: 0,
      status: "UFA",
      optionType: "NONE",
      optionDecision: "NOT_APPLICABLE",
    },
    seasonStats: emptyPlayerSeasonStats(),
    postseasonStats: emptyPlayerSeasonStats(),
  };
}

function bestEmergencyCandidate(state: GameState): Player {
  const candidate = Object.values(state.players)
    .filter((player) => player.teamId === "FREE_AGENT" && player.contract.status === "UFA" && player.available && !player.injury)
    .sort((left, right) => publicPlayerValue(right) - publicPlayerValue(left) || left.id.localeCompare(right.id))[0];
  if (candidate) return candidate;
  const replacement = createReplacementPlayer(state, "POOL");
  state.players[replacement.id] = replacement;
  return replacement;
}

function signEmergencyPlayer(state: GameState, teamId: string): Player {
  const player = bestEmergencyCandidate(state);
  const remainingDays = Math.max(1, state.calendar.finalDateIndex - state.calendar.currentDateIndex + 1);
  const dailySalary = Math.ceil(LEAGUE_FINANCE_CONFIG.minimumSalary / LEAGUE_FINANCE_CONFIG.emergencyContract.fullSeasonDays);
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
  if (!state.teams[teamId].playerIds.includes(player.id)) state.teams[teamId].playerIds.push(player.id);
  return player;
}

function terminateEmergencyPlayer(state: GameState, player: Player): void {
  const teamId = player.teamId;
  if (state.teams[teamId]) state.teams[teamId].playerIds = state.teams[teamId].playerIds.filter((id) => id !== player.id);
  player.teamId = "FREE_AGENT";
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
  while (availablePlayerCount(state, teamId) < LEAGUE_FINANCE_CONFIG.rosterLimits.emergencyTarget) signEmergencyPlayer(state, teamId);
  if (state.injuryState.pendingEmergencyRoster?.teamId === teamId) state.injuryState.pendingEmergencyRoster = undefined;
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
        amount: player.contract.emergencyDailySalary ?? Math.ceil(LEAGUE_FINANCE_CONFIG.minimumSalary / LEAGUE_FINANCE_CONFIG.emergencyContract.fullSeasonDays),
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
