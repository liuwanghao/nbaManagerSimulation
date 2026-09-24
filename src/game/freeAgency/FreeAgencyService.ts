import { BALANCE_CONFIG } from "../../config/balanceConfig";
import { LEAGUE_FINANCE_CONFIG } from "../../config/leagueFinance";
import { publicPlayerValue } from "../ai/AIValueService";
import { getAvailableCapSpace, getCapSheet } from "../cap/CapSheetService";
import { assertPhaseAllowed, getRosterLimit } from "../policy/TransactionPolicyService";
import { stableHash } from "../random/hash";
import { createRng } from "../random/xoshiro";
import { marketFitScore, personalityOfferWeights } from "../player/MarketPreferenceService";
import { addTeamNotification } from "../notifications/TeamNotificationService";
import { calculatePlayerOverall } from "../player/PlayerRatingService";
import type { FreeAgentOffer, FreeAgentOfferResolutionReason, FreeAgencyState, GameState, Player, PromisedRole } from "../state/types";
import { freeAgentAttraction } from "../team/TeamSystemService";

export type FreeAgencyCommand =
  | { commandId: string; type: "ENTER_FREE_AGENCY"; payload: Record<string, never> }
  | { commandId: string; type: "SUBMIT_FA_OFFER"; payload: { playerId: string; years: number; year1Salary: number; salaryByYear?: number[]; guaranteedPercent: number; rolePromised: PromisedRole } }
  | { commandId: string; type: "WITHDRAW_FA_OFFER"; payload: { offerId: string } }
  | { commandId: string; type: "ADVANCE_FA_DAY"; payload: Record<string, never> }
  | { commandId: string; type: "RESOLVE_USER_RFA"; payload: { decision: "MATCH" | "DECLINE" } };

export interface FreeAgentOfferDraft {
  years: number;
  year1Salary: number;
  salaryByYear?: number[];
  guaranteedPercent: number;
  rolePromised: PromisedRole;
}

export interface FreeAgentOfferPreview {
  draft: FreeAgentOfferDraft;
  salaryByYear: number[];
  totalValue: number;
  guaranteedValue: number;
  annualRaiseRate: number;
  valid: boolean;
  reason?: string;
}

export interface FreeAgentContractTerms {
  salaryByYear: number[];
  totalValue: number;
  guaranteedValue: number;
  annualRaiseRate: number;
}

const cfg = BALANCE_CONFIG.freeAgency;
const clamp = (value: number): number => Math.max(0, Math.min(100, value));
const salaryDisplayRoundingTolerance = 5_000;

function hasSubmittedOfferInCurrentWindow(freeAgency: FreeAgencyState, teamId: string, playerId: string): boolean {
  const market = freeAgency.markets[playerId];
  return market?.marketWindowStatus === "OPEN"
    && Object.values(freeAgency.offers).some((offer) => offer.teamId === teamId
      && offer.playerId === playerId
      && offer.createdDay >= market.marketWindowStartDay
      && offer.status !== "WITHDRAWN");
}

function maxSalary(player: Player): number {
  const percentages = LEAGUE_FINANCE_CONFIG.maximumSalaryPercentages;
  const percent = player.serviceYears >= 10 ? percentages.tenPlusYears : player.serviceYears >= 7 ? percentages.sevenToNineYears : percentages.zeroToSixYears;
  return LEAGUE_FINANCE_CONFIG.salaryCap * percent;
}

function expectedRole(player: Player): PromisedRole {
  const overall = calculatePlayerOverall(player);
  const thresholds = cfg.roleOverallThresholds;
  return overall >= thresholds.starter ? "STARTER"
    : overall >= thresholds.sixthMan ? "SIXTH_MAN"
      : overall >= thresholds.rotation ? "ROTATION" : "BENCH";
}

export function getRecommendedFreeAgentOffer(state: GameState, playerId: string, teamId = state.userTeamId): FreeAgentOfferDraft {
  const player = state.players[playerId];
  if (!player) throw new Error("Unknown free agent");
  const marketSalary = Math.round(getProjectedMarketSalary(player) / 10_000) * 10_000;
  const careerStage = cfg.ageCareerStage;
  const years = player.age <= careerStage.youngMaximumAge
    ? careerStage.targetYears.young
    : player.age >= careerStage.veteranMinimumAge ? careerStage.targetYears.veteran : careerStage.targetYears.prime;
  const rolePromised = expectedRole(player);
  const originalTeamId = state.freeAgency?.markets[playerId]?.originalTeamId;
  const maxYears = originalTeamId === teamId ? LEAGUE_FINANCE_CONFIG.contractYears.ownTeamMaximum : LEAGUE_FINANCE_CONFIG.contractYears.otherTeamMaximum;
  return {
    years: Math.max(LEAGUE_FINANCE_CONFIG.contractYears.minimum, Math.min(maxYears, years)),
    year1Salary: Math.min(maxSalary(player), Math.max(LEAGUE_FINANCE_CONFIG.minimumSalary, marketSalary)),
    guaranteedPercent: BALANCE_CONFIG.ai.freeAgency.guaranteedPercent,
    rolePromised,
  };
}

export function getFreeAgentContractTerms(
  state: GameState,
  playerId: string,
  draft: FreeAgentOfferDraft,
  teamId = state.userTeamId,
): FreeAgentContractTerms {
  if (!state.players[playerId]) throw new Error("Unknown free agent");
  const originalTeamId = state.freeAgency?.markets[playerId]?.originalTeamId;
  const annualRaiseRate = originalTeamId === teamId
    ? LEAGUE_FINANCE_CONFIG.annualRaisePercentages.ownTeam
    : LEAGUE_FINANCE_CONFIG.annualRaisePercentages.otherTeam;
  const salaryByYear = draft.salaryByYear
    ? [...draft.salaryByYear]
    : Array.from(
      { length: draft.years },
      (_, index) => Math.round(draft.year1Salary * Math.pow(1 + annualRaiseRate, index)),
    );
  const totalValue = salaryByYear.reduce((sum, salary) => sum + salary, 0);
  return {
    salaryByYear,
    totalValue,
    guaranteedValue: Math.round(totalValue * draft.guaranteedPercent),
    annualRaiseRate,
  };
}

export function getFreeAgentCustomOfferPreview(
  state: GameState,
  playerId: string,
  draft: FreeAgentOfferDraft,
  teamId = state.userTeamId,
): FreeAgentOfferPreview {
  const player = state.players[playerId];
  if (!player) throw new Error("Unknown free agent");
  const terms = getFreeAgentContractTerms(state, playerId, draft, teamId);
  const preview = { draft, ...terms };
  const freeAgency = state.freeAgency;
  if (!freeAgency?.opened) return { ...preview, valid: false, reason: "自由市场尚未开启" };
  if (!player || !["UFA", "RFA"].includes(player.contract.status) || player.teamId !== "FREE_AGENT") return { ...preview, valid: false, reason: "球员已不在自由市场" };
  const market = freeAgency.markets[playerId];
  if (market?.marketWindowStatus === "RFA_MATCHING") return { ...preview, valid: false, reason: "RFA 正在等待原球队匹配" };
  if (hasSubmittedOfferInCurrentWindow(freeAgency, teamId, playerId)) return { ...preview, valid: false, reason: "本队已向该球员提交报价" };
  if (player.contract.status === "RFA" && market?.originalTeamId === teamId) return { ...preview, valid: false, reason: "原球队不能提交 RFA 报价单" };
  const maxYears = market?.originalTeamId === teamId ? LEAGUE_FINANCE_CONFIG.contractYears.ownTeamMaximum : LEAGUE_FINANCE_CONFIG.contractYears.otherTeamMaximum;
  if (!Number.isInteger(draft.years) || draft.years < LEAGUE_FINANCE_CONFIG.contractYears.minimum || draft.years > maxYears) return { ...preview, valid: false, reason: `合同年限必须为 ${LEAGUE_FINANCE_CONFIG.contractYears.minimum}～${maxYears} 年` };
  if (terms.salaryByYear.length !== draft.years) return { ...preview, valid: false, reason: "逐年薪资数量必须与合同年限一致" };
  if (terms.salaryByYear[0] !== draft.year1Salary) return { ...preview, valid: false, reason: "首年薪资与逐年薪资表不一致" };
  if (terms.salaryByYear.some((salary) => !Number.isFinite(salary) || salary < LEAGUE_FINANCE_CONFIG.minimumSalary)) return { ...preview, valid: false, reason: `每年薪资不得低于 ${Math.round(LEAGUE_FINANCE_CONFIG.minimumSalary / 10_000)} 万美元` };
  const annualRaiseRate = terms.annualRaiseRate;
  if (terms.salaryByYear.some((salary, index) => salary > Math.round(maxSalary(player) * Math.pow(1 + annualRaiseRate, index)) + salaryDisplayRoundingTolerance)) return { ...preview, valid: false, reason: "逐年薪资超过该球员允许的最高合同" };
  if (terms.salaryByYear.some((salary, index) => index > 0 && Math.abs(salary - terms.salaryByYear[index - 1]) > Math.ceil(terms.salaryByYear[index - 1] * annualRaiseRate) + salaryDisplayRoundingTolerance)) return { ...preview, valid: false, reason: `相邻年份薪资变动不能超过 ${Math.round(annualRaiseRate * 100)}%` };
  if (!Number.isFinite(draft.guaranteedPercent) || draft.guaranteedPercent < 0 || draft.guaranteedPercent > 1) return { ...preview, valid: false, reason: "保障比例必须为 0～100%" };
  if (state.teams[teamId].playerIds.length >= getRosterLimit(state.league.currentPhase)) return { ...preview, valid: false, reason: "球队名单已满" };
  const available = getAvailableCapSpace(state, teamId);
  const hold = state.capState.capHolds.find((entry) => entry.teamId === teamId && entry.playerId === playerId)?.amount ?? 0;
  if (Math.max(0, draft.year1Salary - hold) > available) return { ...preview, valid: false, reason: "可用薪资空间不足" };
  return { ...preview, valid: true };
}

export function getFreeAgentOfferPreview(state: GameState, playerId: string, teamId = state.userTeamId): FreeAgentOfferPreview {
  return getFreeAgentCustomOfferPreview(state, playerId, getRecommendedFreeAgentOffer(state, playerId, teamId), teamId);
}

export function getProjectedMarketSalary(player: Player): number {
  const overall = calculatePlayerOverall(player);
  const anchors = cfg.marketSalary.ratingAnchors;
  const upperIndex = anchors.findIndex((anchor) => overall <= anchor.overall);
  const baseSalary = upperIndex <= 0
    ? anchors[upperIndex === -1 ? anchors.length - 1 : 0].annualSalary
    : anchors[upperIndex - 1].annualSalary
      + (anchors[upperIndex].annualSalary - anchors[upperIndex - 1].annualSalary)
      * (overall - anchors[upperIndex - 1].overall)
      / (anchors[upperIndex].overall - anchors[upperIndex - 1].overall);
  const ageMultiplier = player.age <= cfg.marketSalary.youngMaximumAge ? cfg.marketSalary.youngMultiplier
    : player.age >= cfg.marketSalary.veteranMinimumAge ? cfg.marketSalary.veteranMultiplier : 1;
  return Math.max(LEAGUE_FINANCE_CONFIG.minimumSalary, Math.min(maxSalary(player), baseSalary * ageMultiplier));
}

function roleScore(player: Player, role: PromisedRole): number {
  const expected = expectedRole(player);
  const order: PromisedRole[] = ["BENCH", "ROTATION", "SIXTH_MAN", "STARTER"];
  return clamp(cfg.utilityScales.roleBase + (order.indexOf(role) - order.indexOf(expected)) * cfg.utilityScales.roleStep);
}

function offerUtility(state: GameState, offer: Omit<FreeAgentOffer, "utility">, player: Player): number {
  const marketSalary = getProjectedMarketSalary(player);
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
  const market = marketFitScore(player.marketPreference, state.teams[offer.teamId].marketRating);
  const marketState = state.freeAgency?.markets[player.id];
  const relationship = marketState?.originalTeamId === offer.teamId ? cfg.originalTeamRelationship : cfg.otherTeamRelationship;
  const ageFit = player.age <= careerStage.youngMaximumAge
    ? (offer.years * careerStage.young.years + roleScore(player, offer.rolePromised) * careerStage.young.role)
    : player.age >= careerStage.veteranMinimumAge
      ? (guaranteedMoney * careerStage.veteran.guaranteed + contender * careerStage.veteran.contender)
      : (salaryValue * careerStage.prime.salary + contender * careerStage.prime.contender + roleScore(player, offer.rolePromised) * careerStage.prime.role);
  const weights = personalityOfferWeights(player.personality);
  const factors = {
    salaryValue,
    guaranteedMoney,
    contractYears,
    promisedRole: roleScore(player, offer.rolePromised),
    teamRecord: winRate,
    contenderStatus: contender,
    franchiseReputation: reputation,
    marketPreference: market,
    existingTeamRelationship: relationship,
    ageCareerStageFit: ageFit,
  } satisfies Record<keyof typeof weights, number>;
  const base = (Object.keys(factors) as Array<keyof typeof factors>).reduce((sum, key) =>
    sum + factors[key] * weights[key], 0) / 100;
  const rng = createRng(stableHash(state.seeds.seasonSeed, "free_agency", player.id, offer.teamId, offer.offerId));
  return Math.round(clamp(base + rng.int(cfg.preferenceNoiseMin, cfg.preferenceNoiseMax)) * 100) / 100;
}

function releaseReservation(state: GameState, offerId: string): void {
  state.capState.offerReservations = state.capState.offerReservations.filter((entry) => entry.offerId !== offerId);
}

function rejectOtherOffers(
  state: GameState,
  accepted: FreeAgentOffer,
  destinationTeamId: string,
  reasonOverride?: FreeAgentOfferResolutionReason,
): void {
  const freeAgency = state.freeAgency as FreeAgencyState;
  const market = freeAgency.markets[accepted.playerId];
  const resolutionReason = reasonOverride ?? (accepted.kind === "RFA_OFFER_PROPOSAL" && destinationTeamId === market.originalTeamId
    ? "RFA_MATCHED"
    : "SIGNED_WITH_OTHER_TEAM");
  for (const offer of Object.values(freeAgency.offers)) {
    if (offer.playerId === accepted.playerId && offer.offerId !== accepted.offerId && offer.status === "ACTIVE") {
      offer.status = "REJECTED";
      offer.resolutionReason = resolutionReason;
      releaseReservation(state, offer.offerId);
    }
  }
}

function signAcceptedOffer(state: GameState, offer: FreeAgentOffer, destinationTeamId = offer.teamId): void {
  const player = state.players[offer.playerId];
  const team = state.teams[destinationTeamId];
  if (!player || !team) throw new Error("Offer references an invalid player or team");
  if (team.playerIds.length >= getRosterLimit(state.league.currentPhase)) throw new Error(`${team.fullName} has reached its roster limit`);
  const terms = getFreeAgentContractTerms(state, player.id, {
    years: offer.years,
    year1Salary: offer.year1Salary,
    salaryByYear: offer.salaryByYear,
    guaranteedPercent: offer.totalValue > 0 ? offer.guaranteedValue / offer.totalValue : 0,
    rolePromised: offer.rolePromised,
  }, offer.teamId);
  const salaryByYear = terms.salaryByYear;
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
  rejectOtherOffers(state, offer, destinationTeamId);
  const market = (state.freeAgency as FreeAgencyState).markets[player.id];
  market.marketWindowStatus = "SIGNED";
  (state.freeAgency as FreeAgencyState).transactionLog.unshift(`${player.name} 与 ${team.fullName} 签约 ${offer.years} 年 / ${Math.round(offer.totalValue / 1_000_000)}M`);
}

function createOfferMutable(state: GameState, teamId: string, playerId: string, years: number, year1Salary: number, guaranteedPercent: number, rolePromised: PromisedRole, salaryByYear?: number[]): FreeAgentOffer {
  assertPhaseAllowed(state, "Submit free-agent offer", ["OFFSEASON_POST_DRAFT", "PRESEASON"]);
  const freeAgency = state.freeAgency;
  const player = state.players[playerId];
  if (!freeAgency?.opened || !player || !["UFA", "RFA"].includes(player.contract.status) || player.teamId !== "FREE_AGENT") throw new Error("Player is not available in free agency");
  if (freeAgency.markets[playerId]?.marketWindowStatus === "RFA_MATCHING") throw new Error("RFA is already in a matching window");
  if (hasSubmittedOfferInCurrentWindow(freeAgency, teamId, playerId)) {
    throw new Error("Team already submitted an offer to this player in the current market window");
  }
  const originalTeamId = freeAgency.markets[playerId]?.originalTeamId;
  if (player.contract.status === "RFA" && originalTeamId === teamId) throw new Error("The rights team cannot submit an RFA offer proposal");
  const maxYears = originalTeamId === teamId ? LEAGUE_FINANCE_CONFIG.contractYears.ownTeamMaximum : LEAGUE_FINANCE_CONFIG.contractYears.otherTeamMaximum;
  if (!Number.isInteger(years) || years < LEAGUE_FINANCE_CONFIG.contractYears.minimum || years > maxYears) throw new Error(`Contract length must be ${LEAGUE_FINANCE_CONFIG.contractYears.minimum}-${maxYears} years`);
  if (!Number.isFinite(year1Salary) || year1Salary < LEAGUE_FINANCE_CONFIG.minimumSalary || year1Salary > maxSalary(player)) throw new Error("Year-one salary is outside legal limits");
  if (guaranteedPercent < 0 || guaranteedPercent > 1) throw new Error("Guaranteed percentage is invalid");
  if (state.teams[teamId].playerIds.length >= getRosterLimit(state.league.currentPhase)) throw new Error("Team roster is already full");
  const terms = getFreeAgentContractTerms(state, playerId, { years, year1Salary, salaryByYear, guaranteedPercent, rolePromised }, teamId);
  if (terms.salaryByYear.length !== years || terms.salaryByYear[0] !== year1Salary) throw new Error("Salary schedule must match contract length and year-one salary");
  if (terms.salaryByYear.some((salary) => !Number.isFinite(salary) || salary < LEAGUE_FINANCE_CONFIG.minimumSalary)) throw new Error("Each contract year must meet the minimum salary");
  if (terms.salaryByYear.some((salary, index) => salary > Math.round(maxSalary(player) * Math.pow(1 + terms.annualRaiseRate, index)) + salaryDisplayRoundingTolerance)) throw new Error("Salary schedule exceeds legal limits");
  if (terms.salaryByYear.some((salary, index) => index > 0 && Math.abs(salary - terms.salaryByYear[index - 1]) > Math.ceil(terms.salaryByYear[index - 1] * terms.annualRaiseRate) + salaryDisplayRoundingTolerance)) throw new Error("Salary schedule exceeds the annual change limit");
  const { totalValue, guaranteedValue } = terms;
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
    years, year1Salary, salaryByYear: terms.salaryByYear, totalValue, guaranteedValue, rolePromised,
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
    rejected.resolutionReason = "ACTIVE_OFFER_LIMIT";
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
    if (player.teamId === "UNDRAFTED" || !["UFA", "RFA"].includes(player.contract.status)) continue;
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
  createOfferMutable(state, state.userTeamId, payload.playerId, payload.years, payload.year1Salary, payload.guaranteedPercent, payload.rolePromised, payload.salaryByYear);
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
    const allowance = Math.max(0, BALANCE_CONFIG.ai.maxNewFreeAgentOffersPerTeamDay - alreadyToday);
    if (!allowance) continue;
    const candidates = players.filter((player) => freeAgency.markets[player.id]?.originalTeamId !== teamId || player.contract.status !== "RFA")
      .filter((player) => !Object.values(freeAgency.offers).some((offer) => offer.teamId === teamId && offer.playerId === player.id && offer.status === "ACTIVE"))
      .sort((a, b) => publicPlayerValue(b) - publicPlayerValue(a) || stableHash(state.seeds.seasonSeed, teamId, freeAgency.currentDay, a.id).localeCompare(stableHash(state.seeds.seasonSeed, teamId, freeAgency.currentDay, b.id)));
    const aiFa = BALANCE_CONFIG.ai.freeAgency;
    let createdOffers = 0;
    for (const target of candidates) {
      if (createdOffers >= allowance) break;
      const salaryMultiplier = aiFa.salaryOfferMinMultiplier + createRng(stableHash(state.seeds.seasonSeed, "ai-fa", teamId, target.id, freeAgency.currentDay)).nextFloat()
        * (aiFa.salaryOfferMaxMultiplier - aiFa.salaryOfferMinMultiplier);
      const salary = Math.round(Math.max(LEAGUE_FINANCE_CONFIG.minimumSalary, getProjectedMarketSalary(target) * salaryMultiplier) / 10_000) * 10_000;
      try {
        createOfferMutable(
          state,
          teamId,
          target.id,
          target.age <= aiFa.longOfferMaximumAge ? aiFa.longOfferYears : aiFa.veteranOfferYears,
          Math.min(salary, maxSalary(target)),
          aiFa.guaranteedPercent,
          expectedRole(target),
        );
        createdOffers += 1;
      } catch { /* deterministic legal skip */ }
    }
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
  rejectOtherOffers(state, offer, originalTeamId, "PLAYER_REJECTED");
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
    for (const offer of active) {
      if (state.teams[offer.teamId].playerIds.length < getRosterLimit(state.league.currentPhase)) continue;
      offer.status = "REJECTED";
      offer.resolutionReason = "ROSTER_FULL";
      releaseReservation(state, offer.offerId);
      if (offer.teamId === state.userTeamId) freeAgency.transactionLog.unshift(`${state.players[offer.playerId].name} 的报价因球队名单已满失效`);
    }
    if (freeAgency.currentDay < market.decisionDeadline) {
      for (const offer of active.filter((entry) => entry.expiresDay < freeAgency.currentDay)) { offer.status = "EXPIRED"; releaseReservation(state, offer.offerId); }
    }
    const remaining = active.filter((offer) => offer.status === "ACTIVE").sort((a, b) => b.utility - a.utility || b.guaranteedValue - a.guaranteedValue || b.year1Salary - a.year1Salary || a.offerId.localeCompare(b.offerId));
    const best = remaining[0];
    if (best && (best.utility >= cfg.earlyAcceptThreshold || freeAgency.currentDay >= market.decisionDeadline && best.utility >= cfg.minimumAcceptThreshold)) {
      if (best.kind === "RFA_OFFER_PROPOSAL") resolveRfaOfferSheet(state, best); else signAcceptedOffer(state, best);
    } else if (freeAgency.currentDay >= market.decisionDeadline) {
      for (const offer of remaining) {
        offer.status = "REJECTED";
        offer.resolutionReason = "PLAYER_REJECTED";
        releaseReservation(state, offer.offerId);
      }
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
  for (const offer of Object.values((state.freeAgency as FreeAgencyState).offers)) {
    if (offer.teamId !== state.userTeamId || offer.status === "ACTIVE" || offer.status === "WITHDRAWN") continue;
    const previousStatus = input.freeAgency!.offers[offer.offerId]?.status;
    if (!previousStatus || previousStatus === offer.status) continue;
    const player = state.players[offer.playerId];
    const signedTeam = player.teamId !== "FREE_AGENT" ? state.teams[player.teamId] : undefined;
    const market = (state.freeAgency as FreeAgencyState).markets[player.id];
    const rfaMatched = offer.kind === "RFA_OFFER_PROPOSAL"
      && player.teamId !== offer.teamId
      && player.teamId === market?.originalTeamId;
    let title: string;
    let message: string;
    if (offer.status === "ACCEPTED" && rfaMatched) {
      title = "报价被原球队匹配";
      message = `原球队 ${signedTeam?.fullName ?? "未知球队"} 匹配了报价单，球员已与原球队签约。预留薪资已释放。`;
    } else if (offer.status === "ACCEPTED") {
      title = "自由球员签约成功";
      message = `${offer.years} 年合同已生效，球员已加入球队。`;
    } else if (offer.status === "SIGNED_OFFER_SHEET") {
      title = "报价单已获接受";
      message = "等待原球队决定是否匹配。";
    } else if (offer.status === "EXPIRED") {
      title = "报价已到期";
      message = "球员未在有效期内接受合同报价，预留薪资已释放。";
    } else if (offer.status === "REJECTED" && offer.resolutionReason === "ROSTER_FULL") {
      title = "报价因名单已满失效";
      message = "球队名单已满，系统已撤销本次合同报价并释放预留薪资。";
    } else if (offer.status === "REJECTED" && signedTeam && rfaMatched) {
      title = "报价被原球队匹配";
      message = `球员拒绝了本队的合同报价，原球队 ${signedTeam.fullName} 匹配报价单并完成签约。预留薪资已释放。`;
    } else if (offer.status === "REJECTED" && signedTeam) {
      title = "球员拒绝合同报价";
      message = `球员拒绝了本队的合同报价，并与 ${signedTeam.fullName} 签约。预留薪资已释放。`;
    } else if (offer.status === "REJECTED") {
      title = "球员拒绝合同报价";
      message = "球员拒绝了本队的合同报价，预留薪资已释放。";
    } else {
      title = "报价未成交";
      message = "本次报价未成交，预留薪资已释放。";
    }
    addTeamNotification(state, {
      id: `fa-offer-${offer.offerId}-${offer.status}`, category: "FREE_AGENCY", seasonId: state.league.seasonId,
      title, message, playerId: player.id, playerName: player.name,
    });
  }
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
  addTeamNotification(state, {
    id: `rfa-decision-${offer.offerId}-${decision}`, category: "FREE_AGENCY", seasonId: state.league.seasonId,
    title: decision === "MATCH" ? "已匹配受限自由球员报价" : "已放弃匹配报价",
    message: decision === "MATCH" ? "球员已加入球队，合同生效。" : "球员将加盟报价球队。",
    playerId: offer.playerId, playerName: state.players[offer.playerId]?.name,
  });
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
