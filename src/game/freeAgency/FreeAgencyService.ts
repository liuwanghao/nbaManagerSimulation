import { BALANCE_CONFIG } from "../../config/balanceConfig";
import { LEAGUE_FINANCE_CONFIG } from "../../config/leagueFinance";
import { publicPlayerValue } from "../ai/AIValueService";
import { getAvailableCapSpace, getCapSheet } from "../cap/CapSheetService";
import { assertPhaseAllowed, getRosterLimit } from "../policy/TransactionPolicyService";
import { stableHash } from "../random/hash";
import { createRng } from "../random/xoshiro";
import type { FreeAgentOffer, FreeAgencyState, GameState, Player, PromisedRole } from "../state/types";
import { freeAgentAttraction } from "../team/TeamSystemService";

export type FreeAgencyCommand =
  | { commandId: string; type: "ENTER_FREE_AGENCY"; payload: Record<string, never> }
  | { commandId: string; type: "SUBMIT_FA_OFFER"; payload: { playerId: string; years: number; year1Salary: number; guaranteedPercent: number; rolePromised: PromisedRole } }
  | { commandId: string; type: "WITHDRAW_FA_OFFER"; payload: { offerId: string } }
  | { commandId: string; type: "ADVANCE_FA_DAY"; payload: Record<string, never> }
  | { commandId: string; type: "RESOLVE_USER_RFA"; payload: { decision: "MATCH" | "DECLINE" } };

const cfg = BALANCE_CONFIG.freeAgency;
const clamp = (value: number): number => Math.max(0, Math.min(100, value));

function maxSalary(player: Player): number {
  const percentages = LEAGUE_FINANCE_CONFIG.maximumSalaryPercentages;
  const percent = player.serviceYears >= 10 ? percentages.tenPlusYears : player.serviceYears >= 7 ? percentages.sevenToNineYears : percentages.zeroToSixYears;
  return LEAGUE_FINANCE_CONFIG.salaryCap * percent;
}

function projectedMarketSalary(player: Player): number {
  const value = publicPlayerValue(player, "BALANCED");
  return Math.max(LEAGUE_FINANCE_CONFIG.minimumSalary, Math.min(maxSalary(player), (value - cfg.marketSalary.valueFloor) * cfg.marketSalary.dollarsPerValuePoint));
}

function roleScore(player: Player, role: PromisedRole): number {
  const thresholds = cfg.roleValueThresholds;
  const expected = publicPlayerValue(player) >= thresholds.starter ? "STARTER" : publicPlayerValue(player) >= thresholds.sixthMan ? "SIXTH_MAN" : publicPlayerValue(player) >= thresholds.rotation ? "ROTATION" : "BENCH";
  const order: PromisedRole[] = ["BENCH", "ROTATION", "SIXTH_MAN", "STARTER"];
  return clamp(cfg.utilityScales.roleBase + (order.indexOf(role) - order.indexOf(expected)) * cfg.utilityScales.roleStep);
}

function offerUtility(state: GameState, offer: Omit<FreeAgentOffer, "utility">, player: Player): number {
  const marketSalary = projectedMarketSalary(player);
  const salaryValue = clamp(offer.year1Salary / marketSalary * cfg.utilityScales.salary);
  const guaranteedMoney = clamp(offer.guaranteedValue / Math.max(1, offer.totalValue) * 100);
  const careerStage = cfg.ageCareerStage;
  const targetYears = player.age <= careerStage.youngMaximumAge ? careerStage.targetYears.young
    : player.age >= careerStage.veteranMinimumAge ? careerStage.targetYears.veteran : careerStage.targetYears.prime;
  const contractYears = clamp(offer.years / targetYears * cfg.utilityScales.contractYears);
  const record = state.standings[offer.teamId];
  const games = (record?.wins ?? 0) + (record?.losses ?? 0);
  const winRate = games ? (record.wins / games) * 100 : 50;
  const contender = clamp(winRate + (publicPlayerValue(player) >= cfg.contenderStarValueThreshold ? cfg.contenderStarBonus : 0));
  const reputation = freeAgentAttraction(state, state.teams[offer.teamId]);
  const market = clamp(50 + (player.marketPreference - 50) * ((Number.parseInt(stableHash(offer.teamId, "market").slice(-2), 16) % 101 - 50) / 50));
  const marketState = state.freeAgency?.markets[player.id];
  const relationship = marketState?.originalTeamId === offer.teamId ? cfg.originalTeamRelationship : cfg.otherTeamRelationship;
  const ageFit = player.age <= careerStage.youngMaximumAge
    ? (offer.years * careerStage.young.years + roleScore(player, offer.rolePromised) * careerStage.young.role)
    : player.age >= careerStage.veteranMinimumAge
      ? (guaranteedMoney * careerStage.veteran.guaranteed + contender * careerStage.veteran.contender)
      : (salaryValue * careerStage.prime.salary + contender * careerStage.prime.contender + roleScore(player, offer.rolePromised) * careerStage.prime.role);
  const weights = cfg.weights;
  const base = (salaryValue * weights.salaryValue + guaranteedMoney * weights.guaranteedMoney
    + contractYears * weights.contractYears + roleScore(player, offer.rolePromised) * weights.promisedRole
    + winRate * weights.teamRecord + contender * weights.contenderStatus + reputation * weights.franchiseReputation
    + market * weights.marketPreference + relationship * weights.existingTeamRelationship
    + ageFit * weights.ageCareerStageFit) / 100;
  const rng = createRng(stableHash(state.seeds.seasonSeed, "free_agency", player.id, offer.teamId, offer.offerId));
  return Math.round(clamp(base + rng.int(cfg.preferenceNoiseMin, cfg.preferenceNoiseMax)) * 100) / 100;
}

function releaseReservation(state: GameState, offerId: string): void {
  state.capState.offerReservations = state.capState.offerReservations.filter((entry) => entry.offerId !== offerId);
}

function rejectOtherOffers(state: GameState, accepted: FreeAgentOffer): void {
  const freeAgency = state.freeAgency as FreeAgencyState;
  for (const offer of Object.values(freeAgency.offers)) {
    if (offer.playerId === accepted.playerId && offer.offerId !== accepted.offerId && offer.status === "ACTIVE") {
      offer.status = "REJECTED";
      releaseReservation(state, offer.offerId);
    }
  }
}

function signAcceptedOffer(state: GameState, offer: FreeAgentOffer, destinationTeamId = offer.teamId): void {
  const player = state.players[offer.playerId];
  const team = state.teams[destinationTeamId];
  if (!player || !team) throw new Error("Offer references an invalid player or team");
  if (team.playerIds.length >= getRosterLimit(state.league.currentPhase)) throw new Error(`${team.fullName} has reached its roster limit`);
  const annualGrowth = destinationTeamId === state.freeAgency?.markets[player.id]?.originalTeamId
    ? LEAGUE_FINANCE_CONFIG.annualRaisePercentages.ownTeam
    : LEAGUE_FINANCE_CONFIG.annualRaisePercentages.otherTeam;
  const salaryByYear = Array.from({ length: offer.years }, (_, index) => Math.round(offer.year1Salary * Math.pow(1 + annualGrowth, index)));
  player.teamId = destinationTeamId;
  player.contract = {
    salary: salaryByYear[0], yearsRemaining: offer.years, guaranteedAmount: offer.guaranteedValue,
    status: "STANDARD", optionType: "NONE", optionDecision: "NOT_APPLICABLE",
    contractId: stableHash(offer.offerId, destinationTeamId, "contract"), contractType: "STANDARD",
    startSeason: state.league.seasonYear, endSeason: state.league.seasonYear + offer.years - 1,
    currentYearIndex: 0, salaryByYear,
    guaranteedByYear: salaryByYear.map((salary, index) => Math.min(salary, Math.max(0, offer.guaranteedValue - salaryByYear.slice(0, index).reduce((sum, value) => sum + value, 0)))),
    optionByYear: salaryByYear.map(() => "NONE"), signedTeamId: destinationTeamId, signedPhase: state.league.currentPhase,
  };
  player.birdTeamId = destinationTeamId;
  player.birdYears = 1;
  if (player.career) { player.career.unemployedGameDays = 0; player.career.unemployedLeagueYears = 0; }
  team.playerIds.push(player.id);
  offer.status = "ACCEPTED";
  releaseReservation(state, offer.offerId);
  state.capState.capHolds = state.capState.capHolds.filter((entry) => entry.playerId !== player.id);
  rejectOtherOffers(state, offer);
  const market = (state.freeAgency as FreeAgencyState).markets[player.id];
  market.marketWindowStatus = "SIGNED";
  (state.freeAgency as FreeAgencyState).transactionLog.unshift(`${player.name} 与 ${team.fullName} 签约 ${offer.years} 年 / ${Math.round(offer.totalValue / 1_000_000)}M`);
}

function createOfferMutable(state: GameState, teamId: string, playerId: string, years: number, year1Salary: number, guaranteedPercent: number, rolePromised: PromisedRole): FreeAgentOffer {
  assertPhaseAllowed(state, "Submit free-agent offer", ["OFFSEASON_POST_DRAFT", "PRESEASON"]);
  const freeAgency = state.freeAgency;
  const player = state.players[playerId];
  if (!freeAgency?.opened || !player || !["UFA", "RFA"].includes(player.contract.status) || player.teamId !== "FREE_AGENT") throw new Error("Player is not available in free agency");
  if (freeAgency.markets[playerId]?.marketWindowStatus === "RFA_MATCHING") throw new Error("RFA is already in a matching window");
  const originalTeamId = freeAgency.markets[playerId]?.originalTeamId;
  if (player.contract.status === "RFA" && originalTeamId === teamId) throw new Error("The rights team cannot submit an RFA offer proposal");
  const maxYears = originalTeamId === teamId ? LEAGUE_FINANCE_CONFIG.contractYears.ownTeamMaximum : LEAGUE_FINANCE_CONFIG.contractYears.otherTeamMaximum;
  if (!Number.isInteger(years) || years < LEAGUE_FINANCE_CONFIG.contractYears.minimum || years > maxYears) throw new Error(`Contract length must be ${LEAGUE_FINANCE_CONFIG.contractYears.minimum}-${maxYears} years`);
  if (!Number.isFinite(year1Salary) || year1Salary < LEAGUE_FINANCE_CONFIG.minimumSalary || year1Salary > maxSalary(player)) throw new Error("Year-one salary is outside legal limits");
  if (guaranteedPercent < 0 || guaranteedPercent > 1) throw new Error("Guaranteed percentage is invalid");
  if (state.teams[teamId].playerIds.length >= getRosterLimit(state.league.currentPhase)) throw new Error("Team roster is already full");
  const totalValue = Math.round(Array.from({ length: years }, (_, index) => year1Salary * Math.pow(1 + LEAGUE_FINANCE_CONFIG.annualRaisePercentages.otherTeam, index)).reduce((sum, value) => sum + value, 0));
  const guaranteedValue = Math.round(totalValue * guaranteedPercent);
  const offerId = stableHash(state.seeds.seasonSeed, "fa-offer", teamId, playerId, freeAgency.currentDay, Object.keys(freeAgency.offers).length);
  const market = freeAgency.markets[playerId] ?? {
    playerId, marketWindowStartDay: freeAgency.currentDay,
    decisionDeadline: freeAgency.currentDay + cfg.decisionWindowDays - 1,
    marketWindowStatus: "OPEN" as const,
  };
  if (market.marketWindowStatus === "CLOSED_NO_SIGNING") {
    market.marketWindowStartDay = freeAgency.currentDay;
    market.decisionDeadline = freeAgency.currentDay + cfg.decisionWindowDays - 1;
    market.marketWindowStatus = "OPEN";
  }
  freeAgency.markets[playerId] = market;
  const draftOffer: Omit<FreeAgentOffer, "utility"> = {
    offerId, playerId, teamId, createdDay: freeAgency.currentDay,
    expiresDay: Math.min(freeAgency.currentDay + cfg.offerValidDays - 1, market.decisionDeadline),
    years, year1Salary, totalValue, guaranteedValue, rolePromised,
    capReservation: year1Salary, status: "ACTIVE",
    kind: player.contract.status === "RFA" ? "RFA_OFFER_PROPOSAL" : "UFA_OFFER",
  };
  const offer: FreeAgentOffer = { ...draftOffer, utility: offerUtility(state, draftOffer, player) };
  const available = getAvailableCapSpace(state, teamId);
  const hold = state.capState.capHolds.find((entry) => entry.teamId === teamId && entry.playerId === playerId)?.amount ?? 0;
  const required = Math.max(0, year1Salary - hold);
  if (required > available) throw new Error("Insufficient cap space for this offer reservation");
  freeAgency.offers[offerId] = offer;
  state.capState.offerReservations.push({ offerId, playerId, teamId, amount: year1Salary });
  const active = Object.values(freeAgency.offers).filter((entry) => entry.playerId === playerId && entry.status === "ACTIVE")
    .sort((a, b) => b.utility - a.utility || b.guaranteedValue - a.guaranteedValue || b.year1Salary - a.year1Salary || a.offerId.localeCompare(b.offerId));
  for (const rejected of active.slice(cfg.maxActiveOffersPerPlayer)) {
    rejected.status = "REJECTED";
    releaseReservation(state, rejected.offerId);
  }
  return offer;
}

export function enterFreeAgency(input: GameState): GameState {
  assertPhaseAllowed(input, "Enter free agency", ["OFFSEASON_POST_DRAFT"]);
  if (!input.rookieDraft?.completed) throw new Error("Rookie Draft must be completed first");
  if (input.freeAgency?.opened) return input;
  const state = structuredClone(input);
  const freeAgency: FreeAgencyState = { opened: true, currentDay: 1, offers: {}, markets: {}, settledPlayerDay: {}, transactionLog: [] };
  state.freeAgency = freeAgency;
  for (const player of Object.values(state.players).sort((a, b) => a.id.localeCompare(b.id))) {
    if (!["UFA", "RFA"].includes(player.contract.status)) continue;
    const originalTeamId = player.teamId !== "FREE_AGENT" ? player.teamId : player.birdTeamId ?? undefined;
    if (originalTeamId && state.teams[originalTeamId]) state.teams[originalTeamId].playerIds = state.teams[originalTeamId].playerIds.filter((id) => id !== player.id);
    player.teamId = "FREE_AGENT";
    freeAgency.markets[player.id] = { playerId: player.id, marketWindowStartDay: 0, decisionDeadline: 0, marketWindowStatus: "CLOSED_NO_SIGNING", originalTeamId };
    if (originalTeamId && player.contract.status === "RFA") {
      const qo = Math.max(player.contract.salary * LEAGUE_FINANCE_CONFIG.capHolds.qualifyingOfferPreviousSalaryMultiplier, LEAGUE_FINANCE_CONFIG.minimumSalary);
      if (!state.capState.capHolds.some((hold) => hold.playerId === player.id && hold.teamId === originalTeamId)) {
        state.capState.capHolds.push({ playerId: player.id, teamId: originalTeamId, amount: qo, type: "RFA" });
      }
    } else if (originalTeamId && (player.birdYears ?? LEAGUE_FINANCE_CONFIG.capHolds.birdEligibilityYears) >= LEAGUE_FINANCE_CONFIG.capHolds.birdEligibilityYears) {
      if (!state.capState.capHolds.some((hold) => hold.playerId === player.id && hold.teamId === originalTeamId)) {
        state.capState.capHolds.push({ playerId: player.id, teamId: originalTeamId, amount: Math.min(Math.max(player.contract.salary * LEAGUE_FINANCE_CONFIG.capHolds.birdUfaPreviousSalaryMultiplier, LEAGUE_FINANCE_CONFIG.minimumSalary), maxSalary(player)), type: "BIRD_UFA" });
      }
    }
  }
  freeAgency.transactionLog.push("自由市场开启：UFA 与 RFA 已进入统一报价状态机");
  return state;
}

export function submitFreeAgentOffer(input: GameState, payload: Extract<FreeAgencyCommand, { type: "SUBMIT_FA_OFFER" }>["payload"]): GameState {
  const state = structuredClone(input);
  createOfferMutable(state, state.userTeamId, payload.playerId, payload.years, payload.year1Salary, payload.guaranteedPercent, payload.rolePromised);
  return state;
}

export function withdrawFreeAgentOffer(input: GameState, offerId: string): GameState {
  assertPhaseAllowed(input, "Withdraw free-agent offer", ["OFFSEASON_POST_DRAFT", "PRESEASON"]);
  const state = structuredClone(input);
  const offer = state.freeAgency?.offers[offerId];
  if (!offer || offer.teamId !== state.userTeamId || offer.status !== "ACTIVE") throw new Error("Offer cannot be withdrawn");
  offer.status = "WITHDRAWN";
  releaseReservation(state, offerId);
  return state;
}

function generateAiOffers(state: GameState): void {
  const freeAgency = state.freeAgency as FreeAgencyState;
  const players = Object.values(state.players).filter((player) => player.teamId === "FREE_AGENT" && ["UFA", "RFA"].includes(player.contract.status));
  for (const teamId of Object.keys(state.teams).sort()) {
    if (teamId === state.userTeamId || state.teams[teamId].playerIds.length >= getRosterLimit(state.league.currentPhase)) continue;
    const alreadyToday = Object.values(freeAgency.offers).filter((offer) => offer.teamId === teamId && offer.createdDay === freeAgency.currentDay).length;
    const allowance = Math.max(0, Math.min(1, BALANCE_CONFIG.ai.maxNewFreeAgentOffersPerTeamDay - alreadyToday));
    if (!allowance) continue;
    const target = players.filter((player) => freeAgency.markets[player.id]?.originalTeamId !== teamId || player.contract.status !== "RFA")
      .filter((player) => !Object.values(freeAgency.offers).some((offer) => offer.teamId === teamId && offer.playerId === player.id && offer.status === "ACTIVE"))
      .sort((a, b) => publicPlayerValue(b) - publicPlayerValue(a) || stableHash(state.seeds.seasonSeed, teamId, freeAgency.currentDay, a.id).localeCompare(stableHash(state.seeds.seasonSeed, teamId, freeAgency.currentDay, b.id)))[0];
    if (!target) continue;
    const aiFa = BALANCE_CONFIG.ai.freeAgency;
    const salaryMultiplier = aiFa.salaryOfferMinMultiplier + createRng(stableHash(state.seeds.seasonSeed, "ai-fa", teamId, target.id, freeAgency.currentDay)).nextFloat()
      * (aiFa.salaryOfferMaxMultiplier - aiFa.salaryOfferMinMultiplier);
    const salary = Math.round(Math.max(LEAGUE_FINANCE_CONFIG.minimumSalary, projectedMarketSalary(target) * salaryMultiplier) / 10_000) * 10_000;
    try {
      createOfferMutable(
        state,
        teamId,
        target.id,
        target.age <= aiFa.longOfferMaximumAge ? aiFa.longOfferYears : aiFa.veteranOfferYears,
        Math.min(salary, maxSalary(target)),
        aiFa.guaranteedPercent,
        publicPlayerValue(target) >= aiFa.starterOfferValue ? "STARTER" : "ROTATION",
      );
    } catch { /* deterministic legal skip */ }
  }
}

function resolveRfaOfferSheet(state: GameState, offer: FreeAgentOffer): void {
  const freeAgency = state.freeAgency as FreeAgencyState;
  const market = freeAgency.markets[offer.playerId];
  const originalTeamId = market.originalTeamId;
  if (!originalTeamId) return signAcceptedOffer(state, offer);
  offer.status = "SIGNED_OFFER_SHEET";
  market.marketWindowStatus = "RFA_MATCHING";
  market.signedOfferSheetId = offer.offerId;
  market.matchingDeadline = freeAgency.currentDay + 1;
  rejectOtherOffers(state, offer);
  if (originalTeamId === state.userTeamId) {
    freeAgency.pendingUserRfaDecision = { playerId: offer.playerId, offerId: offer.offerId, originalTeamId, deadline: market.matchingDeadline };
    return;
  }
  const player = state.players[offer.playerId];
  const canFit = state.teams[originalTeamId].playerIds.length < getRosterLimit(state.league.currentPhase);
  const rfaHold = state.capState.capHolds.find((hold) => hold.teamId === originalTeamId && hold.playerId === player.id);
  const canAfford = Boolean(rfaHold) || getCapSheet(state, originalTeamId).availableCapSpace >= offer.year1Salary;
  const match = canFit && canAfford && publicPlayerValue(player) >= BALANCE_CONFIG.ai.freeAgency.rfaMatchValue;
  signAcceptedOffer(state, offer, match ? originalTeamId : offer.teamId);
  freeAgency.transactionLog.unshift(`${state.teams[originalTeamId].fullName}${match ? "匹配" : "放弃匹配"} ${player.name} 的报价单`);
}

function settlePlayers(state: GameState): void {
  const freeAgency = state.freeAgency as FreeAgencyState;
  for (const market of Object.values(freeAgency.markets).sort((a, b) => a.playerId.localeCompare(b.playerId))) {
    if (freeAgency.settledPlayerDay[market.playerId] === freeAgency.currentDay || market.marketWindowStatus !== "OPEN") continue;
    const active = Object.values(freeAgency.offers).filter((offer) => offer.playerId === market.playerId && offer.status === "ACTIVE");
    if (freeAgency.currentDay < market.decisionDeadline) {
      for (const offer of active.filter((entry) => entry.expiresDay < freeAgency.currentDay)) { offer.status = "EXPIRED"; releaseReservation(state, offer.offerId); }
    }
    const remaining = active.filter((offer) => offer.status === "ACTIVE").sort((a, b) => b.utility - a.utility || b.guaranteedValue - a.guaranteedValue || b.year1Salary - a.year1Salary || a.offerId.localeCompare(b.offerId));
    const best = remaining[0];
    if (best && (best.utility >= cfg.earlyAcceptThreshold || freeAgency.currentDay >= market.decisionDeadline && best.utility >= cfg.minimumAcceptThreshold)) {
      if (best.kind === "RFA_OFFER_PROPOSAL") resolveRfaOfferSheet(state, best); else signAcceptedOffer(state, best);
    } else if (freeAgency.currentDay >= market.decisionDeadline) {
      for (const offer of remaining) { offer.status = "REJECTED"; releaseReservation(state, offer.offerId); }
      market.marketWindowStatus = "CLOSED_NO_SIGNING";
    }
    freeAgency.settledPlayerDay[market.playerId] = freeAgency.currentDay;
  }
}

export function advanceFreeAgencyDay(input: GameState): GameState {
  assertPhaseAllowed(input, "Advance free agency day", ["OFFSEASON_POST_DRAFT", "PRESEASON"]);
  if (!input.freeAgency?.opened) throw new Error("Free agency is not open");
  if (input.freeAgency.pendingUserRfaDecision) throw new Error("Resolve the pending RFA offer sheet before advancing");
  const state = structuredClone(input);
  generateAiOffers(state);
  settlePlayers(state);
  (state.freeAgency as FreeAgencyState).currentDay += 1;
  return state;
}

export function resolveUserRfa(input: GameState, decision: "MATCH" | "DECLINE"): GameState {
  const state = structuredClone(input);
  const pending = state.freeAgency?.pendingUserRfaDecision;
  if (!pending) throw new Error("No RFA decision is pending");
  const offer = state.freeAgency?.offers[pending.offerId] as FreeAgentOffer;
  if (decision === "MATCH") {
    if (state.teams[state.userTeamId].playerIds.length >= getRosterLimit(state.league.currentPhase)) throw new Error("RFA match requires a roster slot");
    signAcceptedOffer(state, offer, state.userTeamId);
  } else signAcceptedOffer(state, offer, offer.teamId);
  delete (state.freeAgency as FreeAgencyState).pendingUserRfaDecision;
  return state;
}

export function getFreeAgents(state: GameState): Player[] {
  return Object.values(state.players).filter((player) => player.teamId === "FREE_AGENT" && ["UFA", "RFA"].includes(player.contract.status))
    .sort((a, b) => publicPlayerValue(b) - publicPlayerValue(a) || a.id.localeCompare(b.id));
}

export function executeFreeAgencyCommand(state: GameState, command: FreeAgencyCommand): GameState {
  const payloadHash = stableHash(command.type, command.payload);
  const receipt = state.commandReceipts[command.commandId];
  if (receipt) {
    if (receipt.payloadHash !== payloadHash) throw new Error("Command ID 已被不同 Payload 使用");
    return state;
  }
  let next: GameState;
  switch (command.type) {
    case "ENTER_FREE_AGENCY": next = enterFreeAgency(state); break;
    case "SUBMIT_FA_OFFER": next = submitFreeAgentOffer(state, command.payload); break;
    case "WITHDRAW_FA_OFFER": next = withdrawFreeAgentOffer(state, command.payload.offerId); break;
    case "ADVANCE_FA_DAY": next = advanceFreeAgencyDay(state); break;
    case "RESOLVE_USER_RFA": next = resolveUserRfa(state, command.payload.decision); break;
  }
  next.commandReceipts[command.commandId] = { payloadHash };
  return next;
}
