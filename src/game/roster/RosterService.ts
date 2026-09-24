import { LEAGUE_FINANCE_CONFIG } from "../../config/leagueFinance";
import { BALANCE_CONFIG } from "../../config/balanceConfig";
import { publicPlayerValue } from "../ai/AIValueService";
import { assertPhaseAllowed } from "../policy/TransactionPolicyService";
import { stableHash } from "../random/hash";
import { generateSchedule, validateSchedule } from "../schedule/schedule";
import { emptyStanding, type GameState, type Player, type TeamRole, type TrainingFocus } from "../state/types";
import { enqueueCareerMilestoneEvents, enqueueEvent } from "../events/EventService";

export type RosterCommand =
  | { commandId: string; type: "CLOSE_FREE_AGENCY"; payload: Record<string, never> }
  | { commandId: string; type: "WAIVE_PLAYER"; payload: { playerId: string } }
  | { commandId: string; type: "SET_TEAM_ROLE"; payload: { playerId: string; role: TeamRole } }
  | { commandId: string; type: "SET_TRAINING_FOCUS"; payload: { playerId: string; focus: TrainingFocus | null } }
  | { commandId: string; type: "LOCK_OPENING_ROSTER"; payload: { confirmMinimumFill: boolean } };

function addDeadMoney(state: GameState, player: Player, teamId: string): void {
  const guaranteed = player.contract.guaranteedByYear ?? [];
  const salaryBySeason: Record<string, number> = {};
  for (let index = player.contract.currentYearIndex ?? 0; index < guaranteed.length; index += 1) {
    const year = (player.contract.startSeason ?? state.league.seasonYear) + index;
    const seasonId = `${year}-${String((year + 1) % 100).padStart(2, "0")}`;
    if (guaranteed[index] > 0) salaryBySeason[seasonId] = guaranteed[index];
  }
  if (Object.keys(salaryBySeason).length === 0 && player.contract.guaranteedAmount > 0) salaryBySeason[state.league.seasonId] = Math.min(player.contract.salary, player.contract.guaranteedAmount);
  if (Object.keys(salaryBySeason).length) state.capState.deadMoney.push({ id: stableHash(teamId, player.id, "waive", state.league.seasonId), teamId, salaryBySeason });
}

export function waivePlayer(input: GameState, playerId: string): GameState {
  assertPhaseAllowed(input, "Waive player", ["OFFSEASON_PRE_DRAFT", "OFFSEASON_POST_DRAFT", "PRESEASON", "REGULAR_PRE_DEADLINE", "REGULAR_POST_DEADLINE"]);
  if (!input.teams[input.userTeamId].playerIds.includes(playerId)) throw new Error("Player is not on the user roster");
  if (input.teams[input.userTeamId].playerIds.length <= LEAGUE_FINANCE_CONFIG.rosterLimits.emergencyTarget) throw new Error(`Cannot waive below ${LEAGUE_FINANCE_CONFIG.rosterLimits.emergencyTarget} available players`);
  const state = structuredClone(input);
  const player = state.players[playerId];
  addDeadMoney(state, player, state.userTeamId);
  state.teams[state.userTeamId].playerIds = state.teams[state.userTeamId].playerIds.filter((id) => id !== playerId);
  player.teamId = "FREE_AGENT";
  player.contract = { salary: 0, yearsRemaining: 0, guaranteedAmount: 0, status: "UFA", optionType: "NONE", optionDecision: "NOT_APPLICABLE" };
  player.birdTeamId = null;
  player.birdYears = 0;
  if (state.trainingPlan) delete state.trainingPlan.assignments[playerId];
  return state;
}

export function setTrainingFocus(input: GameState, playerId: string, focus: TrainingFocus | null): GameState {
  assertPhaseAllowed(input, "Set training focus", ["PRESEASON"]);
  if (!input.teams[input.userTeamId].playerIds.includes(playerId)) throw new Error("TRAINING_PLAYER_NOT_ON_USER_ROSTER");
  const state = structuredClone(input);
  if (!state.trainingPlan || state.trainingPlan.seasonId !== state.league.seasonId) {
    state.trainingPlan = { seasonId: state.league.seasonId, assignments: {} };
  }
  const assignments = state.trainingPlan.assignments;
  if (focus === null) {
    delete assignments[playerId];
    return state;
  }
  if (!assignments[playerId] && Object.keys(assignments).length >= BALANCE_CONFIG.training.maxFocusedPlayers) {
    throw new Error("TRAINING_FOCUS_LIMIT_REACHED");
  }
  assignments[playerId] = focus;
  return state;
}

export function setTeamRole(input: GameState, playerId: string, role: TeamRole): GameState {
  assertPhaseAllowed(input, "Set team role", ["OFFSEASON_PRE_DRAFT", "OFFSEASON_POST_DRAFT", "PRESEASON", "REGULAR_PRE_DEADLINE", "REGULAR_POST_DEADLINE"]);
  if (!input.teams[input.userTeamId].playerIds.includes(playerId)) throw new Error("ROLE_PLAYER_NOT_ON_USER_ROSTER");
  const state = structuredClone(input);
  const player = state.players[playerId];
  if (role === "FRANCHISE_CORE" && player.teamRole !== "FRANCHISE_CORE") {
    const coreCount = state.teams[state.userTeamId].playerIds.filter((id) => state.players[id].teamRole === "FRANCHISE_CORE").length;
    if (coreCount >= LEAGUE_FINANCE_CONFIG.rosterLimits.franchiseCoreMaximum) throw new Error("FRANCHISE_CORE_LIMIT_REACHED");
  }
  player.teamRole = role;
  return state;
}

function closeOffers(state: GameState): void {
  if (!state.freeAgency) return;
  for (const offer of Object.values(state.freeAgency.offers)) if (offer.status === "ACTIVE") offer.status = "WITHDRAWN";
  state.capState.offerReservations = [];
}

export function closeFreeAgency(input: GameState): GameState {
  assertPhaseAllowed(input, "Close free agency", ["OFFSEASON_POST_DRAFT"]);
  if (input.freeAgency?.pendingUserRfaDecision) throw new Error("Resolve the pending RFA decision first");
  const state = structuredClone(input);
  closeOffers(state);
  state.league.currentPhase = "PRESEASON";
  return state;
}

function signMinimum(state: GameState, teamId: string, player: Player): void {
  player.teamId = teamId;
  player.contract = {
    salary: LEAGUE_FINANCE_CONFIG.minimumSalary, yearsRemaining: 1, guaranteedAmount: LEAGUE_FINANCE_CONFIG.minimumSalary,
    status: "STANDARD", optionType: "NONE", optionDecision: "NOT_APPLICABLE",
    contractId: stableHash(state.league.seasonId, teamId, player.id, "minimum"), contractType: "STANDARD",
    startSeason: state.league.seasonYear, endSeason: state.league.seasonYear, currentYearIndex: 0,
    salaryByYear: [LEAGUE_FINANCE_CONFIG.minimumSalary], guaranteedByYear: [LEAGUE_FINANCE_CONFIG.minimumSalary], optionByYear: ["NONE"],
    signedTeamId: teamId, signedPhase: "PRESEASON",
  };
  if (player.career) { player.career.unemployedGameDays = 0; player.career.unemployedLeagueYears = 0; }
  state.teams[teamId].playerIds.push(player.id);
}

function availableFreeAgents(state: GameState): Player[] {
  return Object.values(state.players).filter((player) => player.teamId === "FREE_AGENT" && player.contract.status !== "RFA")
    .sort((a, b) => publicPlayerValue(b) - publicPlayerValue(a) || a.id.localeCompare(b.id));
}

function normalizeAiRosters(state: GameState): void {
  for (const team of Object.values(state.teams).filter((entry) => entry.id !== state.userTeamId)) {
    while (team.playerIds.length > LEAGUE_FINANCE_CONFIG.rosterLimits.regularSeasonMaximum) {
      const player = team.playerIds.map((id) => state.players[id]).sort((a, b) => publicPlayerValue(a) - publicPlayerValue(b) || a.id.localeCompare(b.id))[0];
      addDeadMoney(state, player, team.id);
      team.playerIds = team.playerIds.filter((id) => id !== player.id);
      player.teamId = "FREE_AGENT";
      player.contract = { salary: 0, yearsRemaining: 0, guaranteedAmount: 0, status: "UFA", optionType: "NONE", optionDecision: "NOT_APPLICABLE" };
    }
    while (team.playerIds.length < LEAGUE_FINANCE_CONFIG.rosterLimits.regularSeasonMinimum) {
      const player = availableFreeAgents(state)[0];
      if (!player) throw new Error("Not enough free agents to complete AI rosters");
      signMinimum(state, team.id, player);
    }
  }
}

function setRotation(state: GameState, teamId: string): void {
  const rotation = BALANCE_CONFIG.rosterRotation;
  state.teams[teamId].playerIds.map((id) => state.players[id]).sort((a, b) => publicPlayerValue(b) - publicPlayerValue(a) || a.id.localeCompare(b.id))
    .forEach((player, index) => { player.rotationRole = index < rotation.starters ? "STARTER" : index === rotation.sixthManIndex ? "SIXTH_MAN" : index < rotation.rotationEndIndex ? "ROTATION" : "BENCH"; });
}

export function lockOpeningRoster(input: GameState, confirmMinimumFill: boolean): GameState {
  assertPhaseAllowed(input, "Lock opening roster", ["PRESEASON"]);
  const size = input.teams[input.userTeamId].playerIds.length;
  if (size > LEAGUE_FINANCE_CONFIG.rosterLimits.regularSeasonMaximum) throw new Error("ROSTER_OVER_REGULAR_LIMIT");
  if (size < LEAGUE_FINANCE_CONFIG.rosterLimits.regularSeasonMinimum && !confirmMinimumFill) throw new Error("MINIMUM_FILL_CONFIRMATION_REQUIRED");
  const state = structuredClone(input);
  while (state.teams[state.userTeamId].playerIds.length < LEAGUE_FINANCE_CONFIG.rosterLimits.regularSeasonMinimum) {
    const player = availableFreeAgents(state)[0];
    if (!player) throw new Error("No free agent is available for minimum roster fill");
    signMinimum(state, state.userTeamId, player);
  }
  normalizeAiRosters(state);
  for (const teamId of Object.keys(state.teams)) setRotation(state, teamId);
  const schedule = generateSchedule(state.teams, state.league.seasonId, state.calendar.openingDate, state.scheduleCycleYear, stableHash(state.seeds.seasonSeed, "schedule"));
  const report = validateSchedule(schedule, state.teams);
  if (!report.valid) throw new Error(`Opening schedule is invalid: ${report.errors.join("; ")}`);
  state.schedule = schedule;
  state.standings = Object.fromEntries(Object.keys(state.teams).map((teamId) => [teamId, emptyStanding(teamId)]));
  state.lightweightResults = [];
  state.userGameDetails = {};
  state.calendar.currentDateIndex = 0;
  state.league.currentPhase = "REGULAR_PRE_DEADLINE";
  enqueueCareerMilestoneEvents(state);
  enqueueEvent(state, "franchise_season_opening_001");
  return state;
}

export function executeRosterCommand(state: GameState, command: RosterCommand): GameState {
  const payloadHash = stableHash(command.type, command.payload);
  const receipt = state.commandReceipts[command.commandId];
  if (receipt) { if (receipt.payloadHash !== payloadHash) throw new Error("Command ID 已被不同 Payload 使用"); return state; }
  const next = command.type === "CLOSE_FREE_AGENCY" ? closeFreeAgency(state)
    : command.type === "WAIVE_PLAYER" ? waivePlayer(state, command.payload.playerId)
      : command.type === "SET_TEAM_ROLE" ? setTeamRole(state, command.payload.playerId, command.payload.role)
        : command.type === "SET_TRAINING_FOCUS" ? setTrainingFocus(state, command.payload.playerId, command.payload.focus)
          : lockOpeningRoster(state, command.payload.confirmMinimumFill);
  next.commandReceipts[command.commandId] = { payloadHash };
  return next;
}
