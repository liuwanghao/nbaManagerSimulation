import { BALANCE_CONFIG } from "../../config/balanceConfig";
import { LEAGUE_FINANCE_CONFIG } from "../../config/leagueFinance";
import { createFutureDraftPicks } from "../../data/draftPicks";
import { publicPlayerValue } from "../ai/AIValueService";
import { assertPhaseAllowed } from "../policy/TransactionPolicyService";
import { stableHash } from "../random/hash";
import { createRng } from "../random/xoshiro";
import type { GameState, Player, PlayerContract } from "../state/types";
import { processOffseasonPlayerLifecycle } from "../development/PlayerDevelopmentService";
import { compressHistoricalArchives } from "../history/HistoryCompressionService";

export type ContractLifecycleCommand =
  | { commandId: string; type: "ROLLOVER_LEAGUE_YEAR"; payload: Record<string, never> }
  | { commandId: string; type: "RESOLVE_TEAM_OPTION"; payload: { playerId: string; decision: "PICK_UP" | "DECLINE" } }
  | { commandId: string; type: "FINALIZE_OPTION_PHASE"; payload: Record<string, never> };

const seasonLabel = (year: number): string => `${year}-${String((year + 1) % 100).padStart(2, "0")}`;
const openingDateForYear = (year: number): string => `${year}-10-20`;

function normalizeContract(player: Player, seasonYear: number): PlayerContract {
  const contract = player.contract;
  if (contract.status !== "STANDARD") return contract;
  const length = Math.max(1, contract.salaryByYear?.length ?? contract.yearsRemaining);
  contract.contractId ??= stableHash(player.id, "migrated-contract", seasonYear);
  contract.contractType ??= "STANDARD";
  contract.startSeason ??= seasonYear;
  contract.endSeason ??= contract.startSeason + length - 1;
  contract.currentYearIndex ??= 0;
  contract.salaryByYear ??= Array.from({ length }, () => contract.salary);
  contract.guaranteedByYear ??= Array.from({ length }, () => contract.salary);
  contract.optionByYear ??= Array.from({ length }, (_, index) => {
    if (index !== length - 1) return "NONE";
    return contract.optionType === "TEAM" ? "TEAM_OPTION" : contract.optionType === "PLAYER" ? "PLAYER_OPTION" : "NONE";
  });
  contract.signedTeamId ??= player.teamId;
  contract.signedPhase ??= "DATASET";
  return contract;
}

function marketSalary(player: Player): number {
  const percentages = LEAGUE_FINANCE_CONFIG.maximumSalaryPercentages;
  return Math.max(LEAGUE_FINANCE_CONFIG.minimumSalary, Math.min(
    LEAGUE_FINANCE_CONFIG.salaryCap * (player.serviceYears >= 10 ? percentages.tenPlusYears : player.serviceYears >= 7 ? percentages.sevenToNineYears : percentages.zeroToSixYears),
    Math.max(0, publicPlayerValue(player) - BALANCE_CONFIG.freeAgency.marketSalary.valueFloor) * BALANCE_CONFIG.freeAgency.marketSalary.dollarsPerValuePoint,
  ));
}

function shouldExercisePlayerOption(state: GameState, player: Player, optionSalary: number): boolean {
  const rng = createRng(stableHash(state.seeds.seasonSeed, "player-option", player.id, state.league.seasonYear));
  const config = BALANCE_CONFIG.contracts.playerOption;
  const personality = player.personality === "MONEY_FOCUSED" ? config.moneyFocusedBonus : player.personality === "LOYAL" ? config.loyalBonus : player.personality === "COMPETITIVE" ? config.competitivePenalty : 0;
  const injury = player.injuryRating < config.lowInjuryRatingThreshold ? config.lowInjuryRatingBonus : 0;
  const salaryAdvantage = (optionSalary / Math.max(1, marketSalary(player)) - 1) * 100;
  return salaryAdvantage + personality + injury + rng.int(BALANCE_CONFIG.contracts.playerOptionNoiseMin, BALANCE_CONFIG.contracts.playerOptionNoiseMax) >= 0;
}

export function shouldPickUpTeamOption(player: Player, optionSalary: number): boolean {
  const config = BALANCE_CONFIG.contracts.teamOption;
  const ageModifier = player.age <= config.youngMaximumAge ? config.youngBonus : player.age >= config.veteranMinimumAge ? config.veteranPenalty : 0;
  const needModifier = player.rotationRole === "STARTER" ? config.starterBonus : player.rotationRole === "OUT" ? config.outPenalty : 0;
  const score = publicPlayerValue(player) - optionSalary / config.salaryDivisor + ageModifier + needModifier;
  return score >= BALANCE_CONFIG.contracts.teamOptionThreshold;
}

function detachFromTeam(state: GameState, player: Player): string | undefined {
  const oldTeamId = state.teams[player.teamId] ? player.teamId : player.birdTeamId ?? undefined;
  if (oldTeamId && state.teams[oldTeamId]) state.teams[oldTeamId].playerIds = state.teams[oldTeamId].playerIds.filter((id) => id !== player.id);
  player.teamId = "FREE_AGENT";
  return oldTeamId;
}

function expireContract(state: GameState, player: Player, rfaEligible: boolean, reason: string): void {
  const oldTeamId = detachFromTeam(state, player);
  player.contract.status = rfaEligible ? "RFA" : "UFA";
  player.contract.yearsRemaining = 0;
  player.contract.optionDecision = reason === "DECLINED" ? "DECLINED" : "NOT_APPLICABLE";
  player.contract.guaranteedAmount = 0;
  if (oldTeamId) player.birdTeamId = oldTeamId;
  state.contractLifecycle?.transactionLog.push(`${player.name} · ${reason} · 进入 ${player.contract.status}`);
}

function activateContractYear(player: Player, nextIndex: number): void {
  const contract = player.contract;
  const salaries = contract.salaryByYear as number[];
  contract.currentYearIndex = nextIndex;
  contract.salary = salaries[nextIndex];
  contract.yearsRemaining = salaries.length - nextIndex;
  contract.guaranteedAmount = (contract.guaranteedByYear ?? salaries).slice(nextIndex).reduce((sum, value) => sum + value, 0);
}

function advancePlayerContract(state: GameState, player: Player): void {
  if (player.contract.contractType === "EMERGENCY") {
    detachFromTeam(state, player);
    player.contract = {
      salary: 0,
      yearsRemaining: 0,
      guaranteedAmount: 0,
      status: "UFA",
      optionType: "NONE",
      optionDecision: "NOT_APPLICABLE",
    };
    player.rotationRole = "OUT";
    player.serviceRosterDays = 0;
    player.birdTeamId = null;
    player.birdYears = 0;
    return;
  }
  if (player.contract.status !== "STANDARD") {
    if (state.teams[player.teamId]) {
      player.birdTeamId ??= player.teamId;
      detachFromTeam(state, player);
    }
    player.serviceRosterDays = 0;
    return;
  }
  if (!state.teams[player.teamId]) return;
  const contract = normalizeContract(player, state.league.seasonYear - 1);
  if ((player.serviceRosterDays ?? 0) >= LEAGUE_FINANCE_CONFIG.serviceYearMinimumRosterDays && contract.contractType !== "EMERGENCY") player.serviceYears += 1;
  player.serviceRosterDays = 0;
  if (player.birdTeamId === player.teamId) player.birdYears = (player.birdYears ?? 0) + 1;
  else {
    player.birdTeamId = player.teamId;
    player.birdYears = Math.max(1, player.birdYears ?? 1);
  }

  const nextIndex = (contract.currentYearIndex ?? 0) + 1;
  const salaryByYear = contract.salaryByYear as number[];
  if (nextIndex >= salaryByYear.length) {
    expireContract(state, player, contract.contractType === "ROOKIE_FIRST" && salaryByYear.length >= 4, "CONTRACT_EXPIRED");
    return;
  }

  const option = contract.optionByYear?.[nextIndex] ?? "NONE";
  const optionSalary = salaryByYear[nextIndex];
  activateContractYear(player, nextIndex);
  if (option === "PLAYER_OPTION") {
    const exercised = shouldExercisePlayerOption(state, player, optionSalary);
    contract.optionType = "PLAYER";
    contract.optionDecision = exercised ? "EXERCISED" : "DECLINED";
    if (!exercised) expireContract(state, player, false, "PLAYER_OPTION_DECLINED");
    else state.contractLifecycle?.transactionLog.push(`${player.name} 执行球员选项`);
    return;
  }
  if (option === "TEAM_OPTION") {
    contract.optionType = "TEAM";
    if (player.teamId === state.userTeamId) {
      contract.optionDecision = "PENDING";
      state.contractLifecycle?.pendingUserTeamOptionPlayerIds.push(player.id);
      return;
    }
    const pickedUp = shouldPickUpTeamOption(player, optionSalary);
    contract.optionDecision = pickedUp ? "EXERCISED" : "DECLINED";
    if (!pickedUp) expireContract(state, player, false, "TEAM_OPTION_DECLINED");
    else state.contractLifecycle?.transactionLog.push(`${state.teams[player.teamId].name} 执行 ${player.name} 的球队选项`);
    return;
  }
  contract.optionType = "NONE";
  contract.optionDecision = "NOT_APPLICABLE";
}

function addFuturePickInventory(state: GameState): void {
  for (const [pickId, pick] of Object.entries(createFutureDraftPicks(state.teams, state.league.seasonYear + 1))) state.draftPicks[pickId] ??= pick;
}

export function rolloverLeagueYear(input: GameState): GameState {
  assertPhaseAllowed(input, "Rollover league year", ["OFFSEASON"]);
  let state = structuredClone(input);
  compressHistoricalArchives(state);
  const seasonYear = state.league.seasonYear + 1;
  const seasonId = seasonLabel(seasonYear);
  state.league = { currentPhase: "OPTION_PHASE", seasonYear, seasonId };
  state.seeds.seasonSeed = stableHash(state.seeds.careerSeed, "season", seasonId);
  state.scheduleCycleYear = (state.scheduleCycleYear + 1) % 6;
  state.calendar = { currentDateIndex: 0, openingDate: openingDateForYear(seasonYear), finalDateIndex: 173 };
  state.contractLifecycle = { rolloverSeasonId: seasonId, pendingUserTeamOptionPlayerIds: [], transactionLog: [], completed: false };
  state.capState.offerReservations = [];
  state.capState.capHolds = [];
  state.freeAgency = undefined;
  state.injuryState.pendingUserMajorInjury = undefined;
  state.tradeDesk = { offers: [] };
  state = processOffseasonPlayerLifecycle(state);
  for (const player of Object.values(state.players).sort((a, b) => a.id.localeCompare(b.id))) advancePlayerContract(state, player);
  addFuturePickInventory(state);
  return state;
}

export function resolveTeamOption(input: GameState, playerId: string, decision: "PICK_UP" | "DECLINE"): GameState {
  assertPhaseAllowed(input, "Resolve team option", ["OPTION_PHASE"]);
  if (!input.contractLifecycle?.pendingUserTeamOptionPlayerIds.includes(playerId)) throw new Error("TEAM_OPTION_NOT_PENDING");
  const state = structuredClone(input);
  const player = state.players[playerId];
  if (player.teamId !== state.userTeamId || player.contract.optionDecision !== "PENDING") throw new Error("TEAM_OPTION_NOT_CONTROLLED");
  player.contract.optionDecision = decision === "PICK_UP" ? "EXERCISED" : "DECLINED";
  state.contractLifecycle = state.contractLifecycle as NonNullable<GameState["contractLifecycle"]>;
  state.contractLifecycle.pendingUserTeamOptionPlayerIds = state.contractLifecycle.pendingUserTeamOptionPlayerIds.filter((id) => id !== playerId);
  if (decision === "DECLINE") expireContract(state, player, false, "TEAM_OPTION_DECLINED");
  else state.contractLifecycle.transactionLog.push(`你执行了 ${player.name} 的球队选项`);
  return state;
}

function maxSalary(player: Player): number {
  const percentages = LEAGUE_FINANCE_CONFIG.maximumSalaryPercentages;
  return LEAGUE_FINANCE_CONFIG.salaryCap * (player.serviceYears >= 10 ? percentages.tenPlusYears : player.serviceYears >= 7 ? percentages.sevenToNineYears : percentages.zeroToSixYears);
}

function createCapHolds(state: GameState): void {
  state.capState.capHolds = [];
  for (const player of Object.values(state.players)) {
    const teamId = player.birdTeamId;
    if (player.teamId !== "FREE_AGENT" || !teamId || !state.teams[teamId]) continue;
    if (player.contract.status === "RFA") {
      state.capState.capHolds.push({ playerId: player.id, teamId, amount: Math.max(player.contract.salary * LEAGUE_FINANCE_CONFIG.capHolds.qualifyingOfferPreviousSalaryMultiplier, LEAGUE_FINANCE_CONFIG.minimumSalary), type: "RFA" });
    } else if (player.contract.status === "UFA" && (player.birdYears ?? 0) >= LEAGUE_FINANCE_CONFIG.capHolds.birdEligibilityYears) {
      state.capState.capHolds.push({ playerId: player.id, teamId, amount: Math.min(Math.max(player.contract.salary * LEAGUE_FINANCE_CONFIG.capHolds.birdUfaPreviousSalaryMultiplier, LEAGUE_FINANCE_CONFIG.minimumSalary), maxSalary(player)), type: "BIRD_UFA" });
    }
  }
}

export function finalizeOptionPhase(input: GameState): GameState {
  assertPhaseAllowed(input, "Finalize option phase", ["OPTION_PHASE"]);
  if (input.contractLifecycle?.pendingUserTeamOptionPlayerIds.length) throw new Error("TEAM_OPTIONS_STILL_PENDING");
  const state = structuredClone(input);
  createCapHolds(state);
  (state.contractLifecycle as NonNullable<GameState["contractLifecycle"]>).completed = true;
  state.league.currentPhase = "OFFSEASON_PRE_DRAFT";
  return state;
}

export function executeContractLifecycleCommand(state: GameState, command: ContractLifecycleCommand): GameState {
  const payloadHash = stableHash(command.type, command.payload);
  const receipt = state.commandReceipts[command.commandId];
  if (receipt) {
    if (receipt.payloadHash !== payloadHash) throw new Error("Command ID 已被不同 Payload 使用");
    return state;
  }
  const next = command.type === "ROLLOVER_LEAGUE_YEAR" ? rolloverLeagueYear(state)
    : command.type === "RESOLVE_TEAM_OPTION" ? resolveTeamOption(state, command.payload.playerId, command.payload.decision)
      : finalizeOptionPhase(state);
  next.commandReceipts[command.commandId] = { payloadHash };
  return next;
}
