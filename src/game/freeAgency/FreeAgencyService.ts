import { BALANCE_CONFIG } from "../../config/balanceConfig";
import { LEAGUE_FINANCE_CONFIG, getSeasonFinanceConfig } from "../../config/leagueFinance";
import { publicPlayerValue } from "../ai/AIValueService";
import { getAvailableCapSpace, getCapSheet } from "../cap/CapSheetService";
import { assertPhaseAllowed, getRosterLimit } from "../policy/TransactionPolicyService";
import { stableHash } from "../random/hash";
import { createRng } from "../random/xoshiro";
import { marketFitScore, personalityOfferWeights } from "../player/MarketPreferenceService";
import { addTeamNotification } from "../notifications/TeamNotificationService";
import { calculatePlayerOverall } from "../player/PlayerRatingService";
import type { ContractYearOption, FreeAgentOffer, FreeAgentOfferResolutionReason, FreeAgencyState, GameState, Player, PromisedRole } from "../state/types";
import { freeAgentAttraction } from "../team/TeamSystemService";
import { getQualifyingOfferAmount, getRfaCapHoldAmount } from "../contracts/ContractRules";
import { reconcileRotationAfterRosterChange } from "../roster/RotationPlanService";
import { prepareAiFreeAgencyRosters, reserveAiFreeAgencySlot } from "../roster/RosterService";
import { advanceInjuriesByDays } from "../simulation/injuries";
import { tradeCalendarDate } from "../trade/TradeTimingPolicy";

export type FreeAgencyCommand =
  | { commandId: string; type: "ENTER_FREE_AGENCY"; payload: Record<string, never> }
  | { commandId: string; type: "RESOLVE_QUALIFYING_OFFER"; payload: { playerId: string; decision: "TENDER" | "DECLINE" } }
  | { commandId: string; type: "RENEW_OWN_PLAYER"; payload: { playerId: string; years: number; year1Salary: number; annualRaiseRate?: number } }
  | { commandId: string; type: "SUBMIT_OWN_EXTENSION_OFFER"; payload: { playerId: string; years: number; year1Salary: number; annualRaiseRate?: number; salaryByYear?: number[]; finalYearOption?: ContractYearOption; guaranteedPercent: number; rolePromised: PromisedRole } }
  | { commandId: string; type: "SUBMIT_FA_OFFER"; payload: { playerId: string; years: number; year1Salary: number; annualRaiseRate?: number; salaryByYear?: number[]; finalYearOption?: ContractYearOption; guaranteedPercent: number; rolePromised: PromisedRole } }
  | { commandId: string; type: "WITHDRAW_FA_OFFER"; payload: { offerId: string } }
  | { commandId: string; type: "ADVANCE_FA_DAY"; payload: Record<string, never> }
  | { commandId: string; type: "RESOLVE_USER_RFA"; payload: { decision: "MATCH" | "DECLINE" } };

export interface FreeAgentOfferDraft {
  years: number;
  year1Salary: number;
  annualRaiseRate?: number;
  salaryByYear?: number[];
  finalYearOption?: ContractYearOption;
  guaranteedPercent: number;
  rolePromised: PromisedRole;
}

export interface FreeAgentOfferPreview {
  draft: FreeAgentOfferDraft;
  salaryByYear: number[];
  totalValue: number;
  guaranteedValue: number;
  annualRaiseRate: number;
  maximumAnnualRaiseRate: number;
  finalYearOption: ContractYearOption;
  optionByYear: ContractYearOption[];
  valid: boolean;
  reason?: string;
}

export interface FreeAgentContractTerms {
  salaryByYear: number[];
  totalValue: number;
  guaranteedValue: number;
  annualRaiseRate: number;
  maximumAnnualRaiseRate: number;
  finalYearOption: ContractYearOption;
  optionByYear: ContractYearOption[];
}

const cfg = BALANCE_CONFIG.freeAgency;
export const MAIN_FREE_AGENCY_DAYS = 120;
const regularUfaPhases = ["REGULAR_SEASON", "REGULAR_PRE_DEADLINE", "REGULAR_POST_DEADLINE"] as const;
const offerPhases = ["OFFSEASON_POST_DRAFT", "PRESEASON", ...regularUfaPhases] as const;
const isRegularUfaPhase = (phase: GameState["league"]["currentPhase"]): boolean => (regularUfaPhases as readonly string[]).includes(phase);
const aiOfferRosterLimit = (state: GameState, teamId: string): number => teamId === state.userTeamId
  ? getRosterLimit(state.league.currentPhase)
  : Math.min(getRosterLimit(state.league.currentPhase), LEAGUE_FINANCE_CONFIG.rosterLimits.regularSeasonMaximum);
function ensureRegularSeasonMarket(state: GameState): void {
  if ((isRegularUfaPhase(state.league.currentPhase) || state.league.currentPhase === "PRESEASON") && !state.freeAgency?.opened) {
    state.freeAgency = { opened: true, currentDay: state.calendar.currentDateIndex + 1, offers: {}, markets: {}, settledPlayerDay: {}, transactionLog: [] };
  }
}
const clamp = (value: number): number => Math.max(0, Math.min(100, value));
const salaryDisplayRoundingTolerance = 5_000;
const contractYearOptions: ContractYearOption[] = ["NONE", "TEAM_OPTION", "PLAYER_OPTION"];

function hasSubmittedOfferInCurrentWindow(freeAgency: FreeAgencyState, teamId: string, playerId: string, offersForPlayer?: FreeAgentOffer[]): boolean {
  const market = freeAgency?.markets[playerId];
  return market?.marketWindowStatus === "OPEN"
    && (offersForPlayer ?? Object.values(freeAgency.offers)).some((offer) => offer.teamId === teamId
      && offer.playerId === playerId
      && offer.createdDay >= market.marketWindowStartDay
      && offer.status !== "WITHDRAWN");
}

function maxSalary(player: Player, seasonYear = 2026): number {
  const percentages = LEAGUE_FINANCE_CONFIG.maximumSalaryPercentages;
  const percent = player.serviceYears >= 10 ? percentages.tenPlusYears : player.serviceYears >= 7 ? percentages.sevenToNineYears : percentages.zeroToSixYears;
  return Math.round(getSeasonFinanceConfig(seasonYear).salaryCap * percent);
}

function hasOwnBirdUfaRights(state: GameState, player: Player, teamId: string): boolean {
  return player.contract.status === "UFA"
    && player.birdTeamId === teamId
    && (player.birdYears ?? 0) >= LEAGUE_FINANCE_CONFIG.capHolds.birdEligibilityYears
    && state.freeAgency?.markets[player.id]?.originalTeamId === teamId
    && state.capState.capHolds.some((hold) => hold.teamId === teamId && hold.playerId === player.id && hold.type === "BIRD_UFA");
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
  const marketSalary = Math.round(getCurrentFreeAgentAsk(state, player) / 10_000) * 10_000;
  const careerStage = cfg.ageCareerStage;
  const years = player.age <= careerStage.youngMaximumAge
    ? careerStage.targetYears.young
    : player.age >= careerStage.veteranMinimumAge ? careerStage.targetYears.veteran : careerStage.targetYears.prime;
  const rolePromised = expectedRole(player);
  const originalTeamId = state.freeAgency?.markets[playerId]?.originalTeamId;
  const maxYears = originalTeamId === teamId ? LEAGUE_FINANCE_CONFIG.contractYears.ownTeamMaximum : LEAGUE_FINANCE_CONFIG.contractYears.otherTeamMaximum;
  const annualRaiseRate = originalTeamId === teamId
    ? LEAGUE_FINANCE_CONFIG.annualRaisePercentages.ownTeam
    : LEAGUE_FINANCE_CONFIG.annualRaisePercentages.otherTeam;
  return {
    years: Math.max(LEAGUE_FINANCE_CONFIG.contractYears.minimum, Math.min(maxYears, years)),
    year1Salary: Math.min(maxSalary(player, state.league.seasonYear), Math.max(Math.ceil(getSeasonFinanceConfig(state.league.seasonYear).minimumSalary / 10_000) * 10_000, marketSalary)),
    annualRaiseRate,
    finalYearOption: "NONE",
    guaranteedPercent: BALANCE_CONFIG.ai.freeAgency.guaranteedPercent,
    rolePromised,
  };
}

export function getRecommendedOwnPlayerExtension(state: GameState, playerId: string): Pick<FreeAgentOfferDraft, "years" | "year1Salary" | "annualRaiseRate"> {
  const player = state.players[playerId];
  if (!player) throw new Error("Unknown player");
  const careerStage = cfg.ageCareerStage;
  const targetYears = player.age <= careerStage.youngMaximumAge
    ? careerStage.targetYears.young
    : player.age >= careerStage.veteranMinimumAge ? careerStage.targetYears.veteran : careerStage.targetYears.prime;
  return {
    years: Math.max(LEAGUE_FINANCE_CONFIG.contractYears.minimum, Math.min(LEAGUE_FINANCE_CONFIG.contractYears.ownTeamMaximum, targetYears)),
    year1Salary: Math.min(maxSalary(player, state.league.seasonYear + 1), Math.max(player.contract.salary, Math.ceil(getProjectedMarketSalary(player, state.league.seasonYear + 1) / 10_000) * 10_000)),
    annualRaiseRate: LEAGUE_FINANCE_CONFIG.annualRaisePercentages.ownTeam,
  };
}

export function getFreeAgentContractTerms(
  state: GameState,
  playerId: string,
  draft: FreeAgentOfferDraft,
  teamId = state.userTeamId,
): FreeAgentContractTerms {
  const player = state.players[playerId];
  if (!player) throw new Error("Unknown free agent");
  const originalTeamId = state.freeAgency?.markets[playerId]?.originalTeamId;
  const ownExtension = player.teamId === teamId && player.contract.status === "STANDARD" && player.contract.yearsRemaining === 1;
  const maximumAnnualRaiseRate = ownExtension || originalTeamId === teamId
    ? LEAGUE_FINANCE_CONFIG.annualRaisePercentages.ownTeam
    : LEAGUE_FINANCE_CONFIG.annualRaisePercentages.otherTeam;
  const annualRaiseRate = draft.annualRaiseRate ?? maximumAnnualRaiseRate;
  const salaryByYear = draft.salaryByYear
    ? [...draft.salaryByYear]
    : Array.from(
      { length: draft.years },
      (_, index) => Math.round(draft.year1Salary * Math.pow(1 + annualRaiseRate, index)),
    );
  const finalYearOption = draft.finalYearOption ?? "NONE";
  const optionByYear = Array.from(
    { length: draft.years },
    (_, index): ContractYearOption => index === draft.years - 1 ? finalYearOption : "NONE",
  );
  const totalValue = salaryByYear.reduce((sum, salary) => sum + salary, 0);
  const guaranteeEligibleValue = finalYearOption === "TEAM_OPTION"
    ? totalValue - (salaryByYear[salaryByYear.length - 1] ?? 0)
    : totalValue;
  return {
    salaryByYear,
    totalValue,
    guaranteedValue: Math.round(guaranteeEligibleValue * draft.guaranteedPercent),
    annualRaiseRate,
    maximumAnnualRaiseRate,
    finalYearOption,
    optionByYear,
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
  if (!freeAgency?.opened && !isRegularUfaPhase(state.league.currentPhase)) return { ...preview, valid: false, reason: "自由市场尚未开启" };
  if (!player || !["UFA", "RFA"].includes(player.contract.status) || player.teamId !== "FREE_AGENT") return { ...preview, valid: false, reason: "球员已不在自由市场" };
  if (isRegularUfaPhase(state.league.currentPhase) && player.contract.status !== "UFA") return { ...preview, valid: false, reason: "常规赛仅可向 UFA 报价" };
  const market = freeAgency?.markets[playerId];
  if (market?.marketWindowStatus === "RFA_MATCHING") return { ...preview, valid: false, reason: "RFA 正在等待原球队匹配" };
  if (freeAgency && hasSubmittedOfferInCurrentWindow(freeAgency, teamId, playerId)) return { ...preview, valid: false, reason: "本队已向该球员提交报价" };
  const maxYears = market?.originalTeamId === teamId ? LEAGUE_FINANCE_CONFIG.contractYears.ownTeamMaximum : LEAGUE_FINANCE_CONFIG.contractYears.otherTeamMaximum;
  if (!Number.isInteger(draft.years) || draft.years < LEAGUE_FINANCE_CONFIG.contractYears.minimum || draft.years > maxYears) return { ...preview, valid: false, reason: `合同年限必须为 ${LEAGUE_FINANCE_CONFIG.contractYears.minimum}～${maxYears} 年` };
  if (!contractYearOptions.includes(terms.finalYearOption)) return { ...preview, valid: false, reason: "末年选项类型无效" };
  if (terms.finalYearOption !== "NONE" && draft.years < 2) return { ...preview, valid: false, reason: "球队/球员选项只能用于至少 2 年的合同" };
  if (terms.salaryByYear.length !== draft.years) return { ...preview, valid: false, reason: "逐年薪资数量必须与合同年限一致" };
  if (terms.salaryByYear[0] !== draft.year1Salary) return { ...preview, valid: false, reason: "首年薪资与逐年薪资表不一致" };
  const minimumSalary = getSeasonFinanceConfig(state.league.seasonYear).minimumSalary;
  if (!Number.isFinite(draft.year1Salary) || draft.year1Salary > maxSalary(player, state.league.seasonYear)) return { ...preview, valid: false, reason: "首年薪资超过该球员允许的最高合同" };
  if (terms.salaryByYear.some((salary) => !Number.isFinite(salary) || salary < minimumSalary)) return { ...preview, valid: false, reason: `每年薪资不得低于 ${Math.round(minimumSalary / 10_000)} 万美元` };
  const annualRaiseRate = terms.annualRaiseRate;
  if (!Number.isFinite(annualRaiseRate) || annualRaiseRate < 0 || annualRaiseRate > terms.maximumAnnualRaiseRate) return { ...preview, valid: false, reason: `年涨幅必须为 0～${Math.round(terms.maximumAnnualRaiseRate * 100)}%` };
  if (terms.salaryByYear.some((salary, index) => salary > Math.round(maxSalary(player, state.league.seasonYear) * Math.pow(1 + terms.maximumAnnualRaiseRate, index)) + salaryDisplayRoundingTolerance)) return { ...preview, valid: false, reason: "逐年薪资超过该球员允许的最高合同" };
  if (terms.salaryByYear.some((salary, index) => index > 0 && Math.abs(salary - terms.salaryByYear[index - 1]) > Math.ceil(terms.salaryByYear[index - 1] * terms.maximumAnnualRaiseRate) + salaryDisplayRoundingTolerance)) return { ...preview, valid: false, reason: `相邻年份薪资变动不能超过 ${Math.round(terms.maximumAnnualRaiseRate * 100)}%` };
  if (!Number.isFinite(draft.guaranteedPercent) || draft.guaranteedPercent < 0 || draft.guaranteedPercent > 1) return { ...preview, valid: false, reason: "保障比例必须为 0～100%" };
  if (state.teams[teamId].playerIds.length >= getRosterLimit(state.league.currentPhase)) return { ...preview, valid: false, reason: "球队名单已满" };
  const available = getAvailableCapSpace(state, teamId);
  const hold = state.capState.capHolds.find((entry) => entry.teamId === teamId && entry.playerId === playerId)?.amount ?? 0;
  const ownRfaRights = player.contract.status === "RFA" && market?.originalTeamId === teamId && hold > 0;
  if (Math.max(0, draft.year1Salary - hold) > available && !ownRfaRights && !hasOwnBirdUfaRights(state, player, teamId)) return { ...preview, valid: false, reason: "可用薪资空间不足" };
  return { ...preview, valid: true };
}

function isOwnPlayerExpiringNextSeason(state: GameState, playerId: string): boolean {
  const player = state.players[playerId];
  if (!player || player.teamId !== state.userTeamId || player.contract.status !== "STANDARD" || player.contract.yearsRemaining !== 1) return false;
  const salaryYears = player.contract.salaryByYear;
  return salaryYears?.length && player.contract.currentYearIndex !== undefined
    ? player.contract.currentYearIndex + 1 >= salaryYears.length
    : true;
}

export function getOwnPlayerExtensionPreview(state: GameState, playerId: string, draft: FreeAgentOfferDraft): FreeAgentOfferPreview {
  const player = state.players[playerId];
  if (!player) throw new Error("Unknown player");
  const terms = getFreeAgentContractTerms(state, playerId, draft, state.userTeamId);
  const preview = { draft, ...terms };
  if (!(regularUfaPhases as readonly string[]).includes(state.league.currentPhase) && state.league.currentPhase !== "PRESEASON") return { ...preview, valid: false, reason: "当前阶段不能提交提前续约" };
  if (!isOwnPlayerExpiringNextSeason(state, playerId)) return { ...preview, valid: false, reason: "仅可续约下赛季到期的本队标准合同球员" };
  if (Object.values(state.freeAgency?.offers ?? {}).some((offer) => offer.playerId === playerId && offer.teamId === state.userTeamId && offer.kind === "OWN_EXTENSION_OFFER" && offer.status === "ACTIVE")) return { ...preview, valid: false, reason: "已提交提前续约报价，等待球员决定" };
  const maxYears = LEAGUE_FINANCE_CONFIG.contractYears.ownTeamMaximum;
  if (!Number.isInteger(draft.years) || draft.years < LEAGUE_FINANCE_CONFIG.contractYears.minimum || draft.years > maxYears) return { ...preview, valid: false, reason: `合同年限必须为 ${LEAGUE_FINANCE_CONFIG.contractYears.minimum}～${maxYears} 年` };
  if (!contractYearOptions.includes(terms.finalYearOption)) return { ...preview, valid: false, reason: "末年选项类型无效" };
  if (terms.finalYearOption !== "NONE" && draft.years < 2) return { ...preview, valid: false, reason: "球队/球员选项只能用于至少 2 年的合同" };
  if (terms.salaryByYear.length !== draft.years || terms.salaryByYear[0] !== draft.year1Salary) return { ...preview, valid: false, reason: "逐年薪资表与合同年限或首年薪资不一致" };
  const firstExtensionYear = state.league.seasonYear + 1;
  const minimumSalary = getSeasonFinanceConfig(firstExtensionYear).minimumSalary;
  if (!Number.isFinite(draft.year1Salary) || draft.year1Salary < minimumSalary || draft.year1Salary > maxSalary(player, firstExtensionYear)) return { ...preview, valid: false, reason: "续约首年薪资超过该球员允许的范围" };
  if (terms.salaryByYear.some((salary) => !Number.isFinite(salary) || salary < minimumSalary)) return { ...preview, valid: false, reason: `每年薪资不得低于 ${Math.round(minimumSalary / 10_000)} 万美元` };
  if (!Number.isFinite(terms.annualRaiseRate) || terms.annualRaiseRate < 0 || terms.annualRaiseRate > LEAGUE_FINANCE_CONFIG.annualRaisePercentages.ownTeam) return { ...preview, valid: false, reason: `年涨幅必须为 0～${Math.round(LEAGUE_FINANCE_CONFIG.annualRaisePercentages.ownTeam * 100)}%` };
  if (terms.salaryByYear.some((salary, index) => salary > Math.round(maxSalary(player, firstExtensionYear) * Math.pow(1 + LEAGUE_FINANCE_CONFIG.annualRaisePercentages.ownTeam, index)) + salaryDisplayRoundingTolerance)) return { ...preview, valid: false, reason: "逐年薪资超过该球员允许的最高合同" };
  if (terms.salaryByYear.some((salary, index) => index > 0 && Math.abs(salary - terms.salaryByYear[index - 1]) > Math.ceil(terms.salaryByYear[index - 1] * LEAGUE_FINANCE_CONFIG.annualRaisePercentages.ownTeam) + salaryDisplayRoundingTolerance)) return { ...preview, valid: false, reason: "相邻年份薪资变动超过本队续约涨幅上限" };
  if (!Number.isFinite(draft.guaranteedPercent) || draft.guaranteedPercent < 0 || draft.guaranteedPercent > 1) return { ...preview, valid: false, reason: "保障比例必须为 0～100%" };
  return { ...preview, valid: true };
}

export function getFreeAgentOfferPreview(state: GameState, playerId: string, teamId = state.userTeamId): FreeAgentOfferPreview {
  return getFreeAgentCustomOfferPreview(state, playerId, getRecommendedFreeAgentOffer(state, playerId, teamId), teamId);
}

export function getProjectedMarketSalary(player: Player, seasonYear = 2026): number {
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
  const finance = getSeasonFinanceConfig(seasonYear);
  return Math.max(finance.minimumSalary, Math.min(maxSalary(player, seasonYear), baseSalary * ageMultiplier * finance.salaryCap / LEAGUE_FINANCE_CONFIG.salaryCap));
}

function uncontestedFreeAgentDays(player: Player): number {
  const days = player.freeAgentDemand?.uncontestedDays;
  return typeof days === "number" && Number.isFinite(days) ? Math.max(0, Math.floor(days)) : 0;
}

export function getCurrentFreeAgentAsk(state: GameState, player: Player): number {
  const base = getProjectedMarketSalary(player, state.league.seasonYear);
  const days = Math.max(0, uncontestedFreeAgentDays(player) - cfg.demand.graceDays);
  const overall = Math.round(calculatePlayerOverall(player));
  const tier = cfg.demand.tiers.find((entry) => overall >= entry.minimumOverall) ?? cfg.demand.tiers[cfg.demand.tiers.length - 1];
  const discount = Math.min(tier.maximumDiscount, days * tier.dailyDiscount);
  return Math.max(getSeasonFinanceConfig(state.league.seasonYear).minimumSalary, base * (1 - discount));
}

function roleScore(player: Player, role: PromisedRole): number {
  const expected = expectedRole(player);
  const order: PromisedRole[] = ["BENCH", "ROTATION", "SIXTH_MAN", "STARTER"];
  return clamp(cfg.utilityScales.roleBase + (order.indexOf(role) - order.indexOf(expected)) * cfg.utilityScales.roleStep);
}

function offerUtility(state: GameState, offer: Omit<FreeAgentOffer, "utility">, player: Player): number {
  const ownExtension = offer.kind === "OWN_EXTENSION_OFFER";
  const askingSalary = ownExtension
    ? getProjectedMarketSalary(player, state.league.seasonYear + 1)
    : getCurrentFreeAgentAsk(state, player);
  const salaryRatio = offer.year1Salary / askingSalary;
  const salaryValue = clamp(salaryRatio * cfg.utilityScales.salary);
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
  const relationship = ownExtension || marketState?.originalTeamId === offer.teamId ? cfg.originalTeamRelationship : cfg.otherTeamRelationship;
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
  const lowballPenalty = Math.max(0, cfg.demand.lowballPenaltyThreshold - salaryRatio) * cfg.demand.lowballPenaltyPointsPerRatio;
  return Math.round(clamp(base + rng.int(cfg.preferenceNoiseMin, cfg.preferenceNoiseMax) - lowballPenalty) * 100) / 100;
}

function refreshActiveOfferUtilities(state: GameState): void {
  for (const offer of Object.values(state.freeAgency?.offers ?? {})) {
    if (offer.status !== "ACTIVE") continue;
    const player = state.players[offer.playerId];
    if (!player || player.teamId !== "FREE_AGENT") continue;
    const askingSalary = getCurrentFreeAgentAsk(state, player);
    if (offer.pricedAgainstAsk === undefined) {
      offer.pricedAgainstAsk = askingSalary;
    } else if (offer.pricedAgainstAsk !== askingSalary) {
      offer.utility = offerUtility(state, offer, player);
      offer.pricedAgainstAsk = askingSalary;
    }
  }
}

function advanceFreeAgentDemand(state: GameState): void {
  const freeAgency = state.freeAgency as FreeAgencyState;
  const activeByPlayer = new Map<string, FreeAgentOffer[]>();
  for (const offer of Object.values(freeAgency.offers)) {
    if (offer.status !== "ACTIVE" || offer.expiresDay < freeAgency.currentDay) continue;
    const active = activeByPlayer.get(offer.playerId) ?? [];
    active.push(offer);
    activeByPlayer.set(offer.playerId, active);
  }
  for (const player of Object.values(state.players)) {
    if (player.teamId !== "FREE_AGENT" || !["UFA", "RFA"].includes(player.contract.status)
      || isRegularUfaPhase(state.league.currentPhase) && player.contract.status !== "UFA"
      || freeAgency.markets[player.id]?.marketWindowStatus === "RFA_MATCHING") continue;
    player.freeAgentDemand = { uncontestedDays: uncontestedFreeAgentDays(player) };
    const askingSalary = getCurrentFreeAgentAsk(state, player);
    if (activeByPlayer.get(player.id)?.some((offer) => offer.year1Salary >= askingSalary * cfg.demand.qualifyingOfferRatio)) continue;
    player.freeAgentDemand.uncontestedDays += 1;
  }
  refreshActiveOfferUtilities(state);
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
  const continuingBirdYears = player.birdTeamId === destinationTeamId ? (player.birdYears ?? 0) : 1;
  if (team.playerIds.length >= getRosterLimit(state.league.currentPhase)) throw new Error(`${team.fullName} has reached its roster limit`);
  const offeredSalaryByYear = offer.salaryByYear ?? [offer.year1Salary];
  const guaranteeEligibleValue = offer.finalYearOption === "TEAM_OPTION"
    ? offer.totalValue - (offeredSalaryByYear[offeredSalaryByYear.length - 1] ?? 0)
    : offer.totalValue;
  const terms = getFreeAgentContractTerms(state, player.id, {
    years: offer.years,
    year1Salary: offer.year1Salary,
    annualRaiseRate: offer.annualRaiseRate,
    salaryByYear: offer.salaryByYear,
    finalYearOption: offer.finalYearOption,
    guaranteedPercent: guaranteeEligibleValue > 0 ? offer.guaranteedValue / guaranteeEligibleValue : 0,
    rolePromised: offer.rolePromised,
  }, offer.teamId);
  const salaryByYear = terms.salaryByYear;
  player.teamId = destinationTeamId;
  delete player.freeAgentDemand;
  player.contract = {
    salary: salaryByYear[0], yearsRemaining: offer.years, guaranteedAmount: offer.guaranteedValue,
    status: "STANDARD",
    optionType: terms.finalYearOption === "TEAM_OPTION" ? "TEAM" : terms.finalYearOption === "PLAYER_OPTION" ? "PLAYER" : "NONE",
    optionDecision: "NOT_APPLICABLE",
    contractId: stableHash(offer.offerId, destinationTeamId, "contract"), contractType: "STANDARD",
    startSeason: state.league.seasonYear, endSeason: state.league.seasonYear + offer.years - 1,
    currentYearIndex: 0, salaryByYear,
    guaranteedByYear: salaryByYear.map((salary, index) => Math.min(salary, Math.max(0, offer.guaranteedValue - salaryByYear.slice(0, index).reduce((sum, value) => sum + value, 0)))),
    optionByYear: terms.optionByYear, signedTeamId: destinationTeamId, signedPhase: state.league.currentPhase,
    signedOn: tradeCalendarDate(state),
  };
  player.birdTeamId = destinationTeamId;
  player.birdYears = continuingBirdYears;
  if (player.career) { player.career.unemployedGameDays = 0; player.career.unemployedLeagueYears = 0; }
  team.playerIds.push(player.id);
  if (isRegularUfaPhase(state.league.currentPhase) && team.rotationPlan) {
    const roster = team.playerIds.map((id) => state.players[id]).filter(Boolean);
    if (roster.filter((entry) => entry.available && !entry.injury).length >= 5) team.rotationPlan = reconcileRotationAfterRosterChange(roster, team.rotationPlan);
  }
  offer.status = "ACCEPTED";
  releaseReservation(state, offer.offerId);
  state.capState.capHolds = state.capState.capHolds.filter((entry) => entry.playerId !== player.id);
  rejectOtherOffers(state, offer, destinationTeamId);
  const market = (state.freeAgency as FreeAgencyState).markets[player.id];
  market.marketWindowStatus = "SIGNED";
  (state.freeAgency as FreeAgencyState).transactionLog.unshift(`${player.name} 与 ${team.fullName} 签约 ${offer.years} 年 / ${Math.round(offer.totalValue / 1_000_000)}M`);
}

function resolveOwnExtensionOffer(state: GameState, offer: FreeAgentOffer): void {
  const freeAgency = state.freeAgency as FreeAgencyState;
  const player = state.players[offer.playerId];
  const market = freeAgency.markets[offer.playerId];
  if (!player || player.teamId !== state.userTeamId || !market) throw new Error("OWN_EXTENSION_STATE_INVALID");
  const existingSalaryByYear = player.contract.salaryByYear?.slice() ?? [player.contract.salary];
  const existingGuaranteedByYear = player.contract.guaranteedByYear?.slice() ?? existingSalaryByYear.slice();
  const existingOptionByYear = player.contract.optionByYear?.slice() ?? existingSalaryByYear.map(() => "NONE" as ContractYearOption);
  const extensionSalaryByYear = offer.salaryByYear ?? [offer.year1Salary];
  const guaranteeEligibleValue = offer.finalYearOption === "TEAM_OPTION"
    ? offer.totalValue - (extensionSalaryByYear[extensionSalaryByYear.length - 1] ?? 0)
    : offer.totalValue;
  const guaranteedPercent = guaranteeEligibleValue > 0 ? offer.guaranteedValue / guaranteeEligibleValue : 0;
  const extensionGuaranteedByYear = extensionSalaryByYear.map((salary, index) => {
    if (offer.finalYearOption === "TEAM_OPTION" && index === extensionSalaryByYear.length - 1) return 0;
    return Math.round(salary * guaranteedPercent);
  });
  player.contract.salaryByYear = [...existingSalaryByYear, ...extensionSalaryByYear];
  player.contract.guaranteedByYear = [...existingGuaranteedByYear, ...extensionGuaranteedByYear];
  player.contract.optionByYear = [...existingOptionByYear, ...extensionSalaryByYear.map((_, index) => index === extensionSalaryByYear.length - 1
    ? (offer.finalYearOption === "TEAM_OPTION" ? "TEAM_OPTION" : offer.finalYearOption === "PLAYER_OPTION" ? "PLAYER_OPTION" : "NONE")
    : "NONE")];
  player.contract.yearsRemaining += offer.years;
  player.contract.guaranteedAmount += offer.guaranteedValue;
  player.contract.endSeason = (player.contract.endSeason ?? state.league.seasonYear) + offer.years;
  player.contract.optionType = offer.finalYearOption === "TEAM_OPTION" ? "TEAM" : offer.finalYearOption === "PLAYER_OPTION" ? "PLAYER" : player.contract.optionType;
  offer.status = "ACCEPTED";
  market.marketWindowStatus = "SIGNED";
  freeAgency.transactionLog.unshift(`你与 ${player.name} 完成提前续约 ${offer.years} 年`);
  state.contractLifecycle ??= { rolloverSeasonId: state.league.seasonId, pendingUserTeamOptionPlayerIds: [], transactionLog: [], completed: true };
  state.contractLifecycle.transactionLog.push(`你与 ${player.name} 完成提前续约 ${offer.years} 年`);
}

function createOfferMutable(state: GameState, teamId: string, playerId: string, years: number, year1Salary: number, guaranteedPercent: number, rolePromised: PromisedRole, annualRaiseRate?: number, salaryByYear?: number[], finalYearOption: ContractYearOption = "NONE", offerIndex?: Map<string, FreeAgentOffer[]>): FreeAgentOffer {
  assertPhaseAllowed(state, "Submit free-agent offer", offerPhases);
  ensureRegularSeasonMarket(state);
  const freeAgency = state.freeAgency;
  const player = state.players[playerId];
  if (!freeAgency?.opened || !player || !["UFA", "RFA"].includes(player.contract.status) || player.teamId !== "FREE_AGENT") throw new Error("Player is not available in free agency");
  if (isRegularUfaPhase(state.league.currentPhase) && player.contract.status !== "UFA") throw new Error("RFA offers are not allowed during the regular season");
  if (freeAgency.markets[playerId]?.marketWindowStatus === "RFA_MATCHING") throw new Error("RFA is already in a matching window");
  if (hasSubmittedOfferInCurrentWindow(freeAgency, teamId, playerId, offerIndex?.get(playerId))) {
    throw new Error("Team already submitted an offer to this player in the current market window");
  }
  const originalTeamId = freeAgency.markets[playerId]?.originalTeamId;
  const maxYears = originalTeamId === teamId ? LEAGUE_FINANCE_CONFIG.contractYears.ownTeamMaximum : LEAGUE_FINANCE_CONFIG.contractYears.otherTeamMaximum;
  if (!Number.isInteger(years) || years < LEAGUE_FINANCE_CONFIG.contractYears.minimum || years > maxYears) throw new Error(`Contract length must be ${LEAGUE_FINANCE_CONFIG.contractYears.minimum}-${maxYears} years`);
  const minimumSalary = getSeasonFinanceConfig(state.league.seasonYear).minimumSalary;
  if (!Number.isFinite(year1Salary) || year1Salary < minimumSalary || year1Salary > maxSalary(player, state.league.seasonYear)) throw new Error("Year-one salary is outside legal limits");
  if (guaranteedPercent < 0 || guaranteedPercent > 1) throw new Error("Guaranteed percentage is invalid");
  if (state.teams[teamId].playerIds.length >= getRosterLimit(state.league.currentPhase)) throw new Error("Team roster is already full");
  const terms = getFreeAgentContractTerms(state, playerId, { years, year1Salary, annualRaiseRate, salaryByYear, finalYearOption, guaranteedPercent, rolePromised }, teamId);
  if (!contractYearOptions.includes(terms.finalYearOption)) throw new Error("Final-year option type is invalid");
  if (terms.finalYearOption !== "NONE" && years < 2) throw new Error("Contract options require at least two years");
  if (terms.salaryByYear.length !== years || terms.salaryByYear[0] !== year1Salary) throw new Error("Salary schedule must match contract length and year-one salary");
  if (terms.salaryByYear.some((salary) => !Number.isFinite(salary) || salary < minimumSalary)) throw new Error("Each contract year must meet the minimum salary");
  if (!Number.isFinite(terms.annualRaiseRate) || terms.annualRaiseRate < 0 || terms.annualRaiseRate > terms.maximumAnnualRaiseRate) throw new Error("Annual raise rate exceeds the legal limit");
  if (terms.salaryByYear.some((salary, index) => salary > Math.round(maxSalary(player, state.league.seasonYear) * Math.pow(1 + terms.maximumAnnualRaiseRate, index)) + salaryDisplayRoundingTolerance)) throw new Error("Salary schedule exceeds legal limits");
  if (terms.salaryByYear.some((salary, index) => index > 0 && Math.abs(salary - terms.salaryByYear[index - 1]) > Math.ceil(terms.salaryByYear[index - 1] * terms.maximumAnnualRaiseRate) + salaryDisplayRoundingTolerance)) throw new Error("Salary schedule exceeds the annual change limit");
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
    years, year1Salary, annualRaiseRate: terms.annualRaiseRate, salaryByYear: terms.salaryByYear,
    finalYearOption: terms.finalYearOption, totalValue, guaranteedValue, rolePromised,
    capReservation: year1Salary, status: "ACTIVE",
    kind: player.contract.status === "RFA"
      ? originalTeamId === teamId ? "RFA_OWN_TEAM_OFFER" : "RFA_OFFER_PROPOSAL"
      : "UFA_OFFER",
  };
  const offer: FreeAgentOffer = { ...draftOffer, utility: offerUtility(state, draftOffer, player), pricedAgainstAsk: getCurrentFreeAgentAsk(state, player) };
  const available = getAvailableCapSpace(state, teamId);
  const hold = state.capState.capHolds.find((entry) => entry.teamId === teamId && entry.playerId === playerId)?.amount ?? 0;
  const required = Math.max(0, year1Salary - hold);
  const ownRfaRights = player.contract.status === "RFA" && originalTeamId === teamId && hold > 0;
  if (required > available && !ownRfaRights && !hasOwnBirdUfaRights(state, player, teamId)) throw new Error("Insufficient cap space for this offer reservation");
  freeAgency.offers[offerId] = offer;
  if (offerIndex) {
    const indexed = offerIndex.get(playerId) ?? [];
    indexed.push(offer);
    offerIndex.set(playerId, indexed);
  }
  state.capState.offerReservations.push({ offerId, playerId, teamId, amount: year1Salary });
  const active = (offerIndex?.get(playerId) ?? Object.values(freeAgency.offers)).filter((entry) => entry.playerId === playerId && entry.status === "ACTIVE")
    .sort((a, b) => b.utility - a.utility || b.guaranteedValue - a.guaranteedValue || b.year1Salary - a.year1Salary || a.offerId.localeCompare(b.offerId));
  for (const rejected of active.slice(cfg.maxActiveOffersPerPlayer)) {
    rejected.status = "REJECTED";
    rejected.resolutionReason = "ACTIVE_OFFER_LIMIT";
    releaseReservation(state, rejected.offerId);
  }
  return offer;
}

function replaceFreeAgentCapHold(state: GameState, player: Player, teamId: string): void {
  state.capState.capHolds = state.capState.capHolds.filter((hold) => hold.playerId !== player.id);
  if (player.contract.status === "RFA") {
    state.capState.capHolds.push({ playerId: player.id, teamId, amount: getRfaCapHoldAmount(player, state.league.seasonYear), type: "RFA" });
  } else if ((player.birdYears ?? 0) >= LEAGUE_FINANCE_CONFIG.capHolds.birdEligibilityYears) {
    state.capState.capHolds.push({
      playerId: player.id,
      teamId,
      amount: Math.min(
        Math.max(player.contract.salary * LEAGUE_FINANCE_CONFIG.capHolds.birdUfaPreviousSalaryMultiplier, getSeasonFinanceConfig(state.league.seasonYear).minimumSalary),
        maxSalary(player, state.league.seasonYear),
      ),
      type: "BIRD_UFA",
    });
  }
}

export function getPendingUserQualifyingOfferPlayers(state: GameState): Player[] {
  if (state.freeAgency?.opened) return [];
  return Object.values(state.players)
    .filter((player) => player.teamId === "FREE_AGENT"
      && player.contract.status === "RFA"
      && player.birdTeamId === state.userTeamId
      && !["TENDERED", "DECLINED"].includes(player.contract.qualifyingOfferDecision ?? "PENDING"))
    .sort((left, right) => publicPlayerValue(right) - publicPlayerValue(left) || left.id.localeCompare(right.id));
}

export function resolveQualifyingOffer(input: GameState, playerId: string, decision: "TENDER" | "DECLINE"): GameState {
  assertPhaseAllowed(input, "Resolve qualifying offer", ["OFFSEASON_POST_DRAFT"]);
  if (input.freeAgency?.opened) throw new Error("Qualifying offers must be resolved before free agency opens");
  const player = input.players[playerId];
  if (!player || player.teamId !== "FREE_AGENT" || player.contract.status !== "RFA" || player.birdTeamId !== input.userTeamId) throw new Error("QUALIFYING_OFFER_NOT_CONTROLLED");
  if (["TENDERED", "DECLINED"].includes(player.contract.qualifyingOfferDecision ?? "PENDING")) throw new Error("QUALIFYING_OFFER_ALREADY_RESOLVED");
  const state = structuredClone(input);
  const nextPlayer = state.players[playerId];
  if (decision === "TENDER") {
    nextPlayer.contract.qualifyingOfferDecision = "TENDERED";
  } else {
    nextPlayer.contract.qualifyingOfferDecision = "DECLINED";
    nextPlayer.contract.status = "UFA";
  }
  replaceFreeAgentCapHold(state, nextPlayer, state.userTeamId);
  state.contractLifecycle?.transactionLog.push(decision === "TENDER"
    ? `你向 ${nextPlayer.name} 提交了资质报价 ${Math.round(getQualifyingOfferAmount(nextPlayer, state.league.seasonYear) / 10_000)} 万美元`
    : `你未向 ${nextPlayer.name} 提交资质报价，球员转为 UFA`);
  return state;
}

function resolveAiQualifyingOffers(state: GameState): void {
  for (const player of Object.values(state.players).sort((left, right) => left.id.localeCompare(right.id))) {
    if (player.teamId !== "FREE_AGENT" || player.contract.status !== "RFA" || player.contract.qualifyingOfferDecision === "TENDERED") continue;
    const originalTeamId = player.birdTeamId ?? undefined;
    if (!originalTeamId || originalTeamId === state.userTeamId) continue;
    const tender = publicPlayerValue(player) >= BALANCE_CONFIG.ai.freeAgency.rfaMatchValue;
    player.contract.qualifyingOfferDecision = tender ? "TENDERED" : "DECLINED";
    if (!tender) player.contract.status = "UFA";
    replaceFreeAgentCapHold(state, player, originalTeamId);
  }
}

function renewAiOwnPlayers(input: GameState): GameState {
  const lifecycle = input.contractLifecycle;
  if (lifecycle?.rolloverSeasonId !== input.league.seasonId) return input;
  const config = cfg.ownTeamRenewal;
  const eligibleIds = lifecycle.renewalEligiblePlayerIds && new Set(lifecycle.renewalEligiblePlayerIds);
  const candidates = getFreeAgents(input).filter((player) => {
    const teamId = input.freeAgency!.markets[player.id]?.originalTeamId;
    if (!teamId || teamId === input.userTeamId || !input.teams[teamId]
      || player.contract.yearsRemaining !== 0
      || calculatePlayerOverall(player) < config.minimumOverall) return false;
    if (eligibleIds) return eligibleIds.has(player.id);
    // Older saves lack the rollover list. Only recently expired standard contracts qualify.
    return !!player.contract.contractId && player.contract.contractType !== "EMERGENCY"
      && !(player.contract.optionType === "TEAM" && player.contract.optionDecision === "DECLINED")
      && (player.contract.optionType === "PLAYER" && player.contract.optionDecision === "DECLINED"
        ? (player.contract.startSeason ?? 0) + (player.contract.currentYearIndex ?? -1) === input.league.seasonYear
        : player.contract.endSeason === input.league.seasonYear - 1);
  }).sort((left, right) => calculatePlayerOverall(right) - calculatePlayerOverall(left) || left.id.localeCompare(right.id));
  let state = input;
  for (const candidate of candidates) {
    const player = state.players[candidate.id];
    const teamId = state.freeAgency!.markets[player.id].originalTeamId!;
    const record = state.standings[teamId];
    const games = (record?.wins ?? 0) + (record?.losses ?? 0);
    const winRate = games ? record.wins / games : 0.5;
    const probability = config.baseAcceptanceProbability
      + (calculatePlayerOverall(player) >= config.starMinimumOverall ? config.starAcceptanceBonus : 0)
      + (player.personality === "LOYAL" ? config.loyalBonus : 0)
      - (player.personality === "COMPETITIVE" && winRate < config.losingTeamWinRate ? config.competitiveLosingTeamPenalty : 0)
      - (player.morale < config.lowMoraleThreshold ? config.lowMoralePenalty : 0);
    if (createRng(stableHash(state.seeds.seasonSeed, "own-team-renewal", teamId, player.id)).nextFloat() >= probability) continue;
    const team = state.teams[teamId];
    const full = team.playerIds.length >= aiOfferRosterLimit(state, teamId);
    if (full && calculatePlayerOverall(player) <= Math.min(...team.playerIds.map((id) => calculatePlayerOverall(state.players[id]))) + config.rosterUpgradeMargin) continue;
    // A failed negotiation must not leave a waiver, offer or cap reservation behind.
    const transaction = structuredClone(state);
    if (full) reserveAiFreeAgencySlot(transaction, teamId);
    const draft = { ...getRecommendedFreeAgentOffer(transaction, player.id, teamId), guaranteedPercent: 1 };
    if (!getFreeAgentCustomOfferPreview(transaction, player.id, draft, teamId).valid) continue;
    const offer = createOfferMutable(transaction, teamId, player.id, draft.years, draft.year1Salary,
      draft.guaranteedPercent, draft.rolePromised, draft.annualRaiseRate, draft.salaryByYear, draft.finalYearOption);
    if (offer.utility < cfg.minimumAcceptThreshold) continue;
    signAcceptedOffer(transaction, offer);
    const renewalLog = `${player.name} 与 ${team.fullName} 在自由市场开放前完成续约`;
    transaction.contractLifecycle?.transactionLog.push(renewalLog);
    transaction.freeAgency!.transactionLog.unshift(renewalLog);
    state = transaction;
  }
  return state;
}

export function enterFreeAgency(input: GameState): GameState {
  assertPhaseAllowed(input, "Enter free agency", ["OFFSEASON_POST_DRAFT"]);
  if (!input.rookieDraft?.completed) throw new Error("Rookie Draft must be completed first");
  if (input.freeAgency?.opened) return input;
  if (getPendingUserQualifyingOfferPlayers(input).length) throw new Error("Resolve every qualifying offer before entering free agency");
  let state = structuredClone(input);
  resolveAiQualifyingOffers(state);
  let freeAgency: FreeAgencyState = { opened: true, currentDay: 1, offers: {}, markets: {}, settledPlayerDay: {}, transactionLog: [] };
  state.freeAgency = freeAgency;
  for (const player of Object.values(state.players).sort((a, b) => a.id.localeCompare(b.id))) {
    if (player.teamId === "UNDRAFTED" || !["UFA", "RFA"].includes(player.contract.status)) continue;
    if (player.teamId !== "FREE_AGENT") player.freeAgentDemand = { uncontestedDays: 0 };
    const originalTeamId = player.teamId !== "FREE_AGENT" ? player.teamId : player.birdTeamId ?? undefined;
    if (originalTeamId && state.teams[originalTeamId]) state.teams[originalTeamId].playerIds = state.teams[originalTeamId].playerIds.filter((id) => id !== player.id);
    player.teamId = "FREE_AGENT";
    freeAgency.markets[player.id] = { playerId: player.id, marketWindowStartDay: 0, decisionDeadline: 0, marketWindowStatus: "CLOSED_NO_SIGNING", originalTeamId };
    if (originalTeamId) replaceFreeAgentCapHold(state, player, originalTeamId);
  }
  prepareAiFreeAgencyRosters(state);
  state = renewAiOwnPlayers(state);
  freeAgency = state.freeAgency!;
  const priorityFreeAgents = Object.values(state.players).filter((player) => player.teamId === "FREE_AGENT"
    && ["UFA", "RFA"].includes(player.contract.status)
    && calculatePlayerOverall(player) >= cfg.roleOverallThresholds.starter);
  for (const team of Object.values(state.teams).filter((entry) => entry.id !== state.userTeamId)) {
    if (team.playerIds.length < LEAGUE_FINANCE_CONFIG.rosterLimits.regularSeasonMaximum) continue;
    const weakestOverall = Math.min(...team.playerIds.map((id) => calculatePlayerOverall(state.players[id])));
    const capSpace = getAvailableCapSpace(state, team.id);
    const canPursueUpgrade = priorityFreeAgents.some((player) => {
      if (calculatePlayerOverall(player) <= weakestOverall + 4) return false;
      const rights = hasOwnBirdUfaRights(state, player, team.id)
        || player.contract.status === "RFA" && freeAgency.markets[player.id]?.originalTeamId === team.id
        && state.capState.capHolds.some((hold) => hold.playerId === player.id && hold.teamId === team.id);
      return rights || capSpace >= getProjectedMarketSalary(player, state.league.seasonYear);
    });
    if (canPursueUpgrade) reserveAiFreeAgencySlot(state, team.id);
  }
  freeAgency.transactionLog.push("自由市场开启：UFA 与 RFA 已进入统一报价状态机");
  return state;
}

export function submitFreeAgentOffer(input: GameState, payload: Extract<FreeAgencyCommand, { type: "SUBMIT_FA_OFFER" }>["payload"]): GameState {
  const state = structuredClone(input);
  createOfferMutable(state, state.userTeamId, payload.playerId, payload.years, payload.year1Salary, payload.guaranteedPercent, payload.rolePromised, payload.annualRaiseRate, payload.salaryByYear, payload.finalYearOption);
  return state;
}

export function submitOwnPlayerExtensionOffer(input: GameState, payload: Extract<FreeAgencyCommand, { type: "SUBMIT_OWN_EXTENSION_OFFER" }>["payload"]): GameState {
  assertPhaseAllowed(input, "Submit own-player extension offer", ["REGULAR_SEASON", "REGULAR_PRE_DEADLINE", "REGULAR_POST_DEADLINE", "PRESEASON"]);
  const state = structuredClone(input);
  ensureRegularSeasonMarket(state);
  const preview = getOwnPlayerExtensionPreview(state, payload.playerId, payload);
  if (!preview.valid) throw new Error(preview.reason ?? "Invalid own-player extension offer");
  const freeAgency = state.freeAgency as FreeAgencyState;
  const existing = Object.values(freeAgency.offers).find((offer) => offer.playerId === payload.playerId && offer.teamId === state.userTeamId && offer.kind === "OWN_EXTENSION_OFFER" && offer.status === "ACTIVE");
  if (existing) throw new Error("Team already submitted an extension offer to this player");
  const player = state.players[payload.playerId];
  const market = freeAgency.markets[payload.playerId] ?? {
    playerId: payload.playerId,
    marketWindowStartDay: freeAgency.currentDay,
    decisionDeadline: freeAgency.currentDay,
    marketWindowStatus: "OPEN" as const,
    originalTeamId: state.userTeamId,
  };
  market.marketWindowStartDay = freeAgency.currentDay;
  market.decisionDeadline = freeAgency.currentDay;
  market.marketWindowStatus = "OPEN";
  market.originalTeamId = state.userTeamId;
  freeAgency.markets[payload.playerId] = market;
  const offerId = stableHash(state.seeds.seasonSeed, "own-extension-offer", state.userTeamId, payload.playerId, freeAgency.currentDay, Object.keys(freeAgency.offers).length);
  const draftOffer: Omit<FreeAgentOffer, "utility"> = {
    offerId,
    playerId: payload.playerId,
    teamId: state.userTeamId,
    createdDay: freeAgency.currentDay,
    expiresDay: freeAgency.currentDay,
    years: payload.years,
    year1Salary: payload.year1Salary,
    salaryByYear: preview.salaryByYear,
    annualRaiseRate: preview.annualRaiseRate,
    finalYearOption: preview.finalYearOption,
    totalValue: preview.totalValue,
    guaranteedValue: preview.guaranteedValue,
    rolePromised: payload.rolePromised,
    capReservation: 0,
    status: "ACTIVE",
    kind: "OWN_EXTENSION_OFFER",
  };
  freeAgency.offers[offerId] = { ...draftOffer, utility: offerUtility(state, draftOffer, player) };
  freeAgency.transactionLog.unshift(`你向 ${player.name} 提交了提前续约报价`);
  return state;
}

export function withdrawFreeAgentOffer(input: GameState, offerId: string): GameState {
  assertPhaseAllowed(input, "Withdraw free-agent offer", offerPhases);
  const state = structuredClone(input);
  const freeAgency = state.freeAgency;
  const offer = freeAgency?.offers[offerId];
  if (!offer || offer.teamId !== state.userTeamId || offer.status !== "ACTIVE") throw new Error("Offer cannot be withdrawn");
  offer.status = "WITHDRAWN";
  releaseReservation(state, offerId);
  const market = freeAgency.markets[offer.playerId];
  if (market?.marketWindowStatus === "OPEN"
    && !Object.values(freeAgency.offers).some((entry) => entry.playerId === offer.playerId && entry.status === "ACTIVE")) {
    market.marketWindowStatus = "CLOSED_NO_SIGNING";
  }
  return state;
}

export function renewOwnPlayer(input: GameState, payload: Extract<FreeAgencyCommand, { type: "RENEW_OWN_PLAYER" }>['payload']): GameState {
  assertPhaseAllowed(input, "Renew own player", ["REGULAR_SEASON", "REGULAR_PRE_DEADLINE", "REGULAR_POST_DEADLINE", "PRESEASON"]);
  const player = input.players[payload.playerId];
  if (!player || player.teamId !== input.userTeamId || player.contract.status !== "STANDARD") throw new Error("OWN_PLAYER_RENEWAL_NOT_ALLOWED");
  const salaryYears = player.contract.salaryByYear;
  const expiresAfterSeason = salaryYears?.length && player.contract.currentYearIndex !== undefined
    ? player.contract.currentYearIndex + 1 >= salaryYears.length
    : player.contract.yearsRemaining === 1;
  if (!expiresAfterSeason || player.contract.yearsRemaining !== 1) throw new Error("PLAYER_IS_NOT_EXPIRING");
  if (!Number.isInteger(payload.years) || payload.years < LEAGUE_FINANCE_CONFIG.contractYears.minimum || payload.years > LEAGUE_FINANCE_CONFIG.contractYears.ownTeamMaximum) throw new Error("CONTRACT_LENGTH_INVALID");
  const annualRaiseRate = payload.annualRaiseRate ?? LEAGUE_FINANCE_CONFIG.annualRaisePercentages.ownTeam;
  const minimumSalary = getSeasonFinanceConfig(input.league.seasonYear + 1).minimumSalary;
  if (!Number.isFinite(payload.year1Salary) || payload.year1Salary < minimumSalary || payload.year1Salary > maxSalary(player, input.league.seasonYear + 1)) throw new Error("YEAR_ONE_SALARY_INVALID");
  if (!Number.isFinite(annualRaiseRate) || annualRaiseRate < 0 || annualRaiseRate > LEAGUE_FINANCE_CONFIG.annualRaisePercentages.ownTeam) throw new Error("ANNUAL_RAISE_INVALID");
  const salaryByYear = Array.from({ length: payload.years }, (_, index) => Math.round(payload.year1Salary * Math.pow(1 + annualRaiseRate, index)));
  const state = structuredClone(input);
  ensureRegularSeasonMarket(state);
  const nextPlayer = state.players[payload.playerId];
  const contract = nextPlayer.contract;
  const existingSalaryByYear = contract.salaryByYear?.slice() ?? [contract.salary];
  const existingGuaranteedByYear = contract.guaranteedByYear?.slice() ?? existingSalaryByYear.slice();
  const existingOptionByYear = contract.optionByYear?.slice() ?? existingSalaryByYear.map(() => "NONE" as ContractYearOption);
  contract.salaryByYear = [...existingSalaryByYear, ...salaryByYear];
  contract.guaranteedByYear = [...existingGuaranteedByYear, ...salaryByYear];
  contract.optionByYear = [...existingOptionByYear, ...salaryByYear.map(() => "NONE" as ContractYearOption)];
  contract.yearsRemaining += payload.years;
  contract.guaranteedAmount += salaryByYear.reduce((sum, salary) => sum + salary, 0);
  contract.endSeason = (contract.endSeason ?? state.league.seasonYear) + payload.years;
  state.contractLifecycle ??= { rolloverSeasonId: state.league.seasonId, pendingUserTeamOptionPlayerIds: [], transactionLog: [], completed: true };
  state.contractLifecycle?.transactionLog.push(`你与 ${nextPlayer.name} 完成提前续约 ${payload.years} 年`);
  state.freeAgency?.transactionLog.unshift(`你与 ${nextPlayer.name} 完成提前续约 ${payload.years} 年`);
  return state;
}

function generateAiOffers(state: GameState): void {
  const freeAgency = state.freeAgency as FreeAgencyState;
  const players = Object.values(state.players).filter((player) => player.teamId === "FREE_AGENT" && (isRegularUfaPhase(state.league.currentPhase) ? player.contract.status === "UFA" : ["UFA", "RFA"].includes(player.contract.status)));
  const playerValues = new Map(players.map((player) => [player.id, publicPlayerValue(player)]));
  const finance = getSeasonFinanceConfig(state.league.seasonYear);
  const offersByTeam = new Map<string, Map<string, FreeAgentOffer[]>>();
  const offersByPlayer = new Map<string, FreeAgentOffer[]>();
  const offersTodayByTeam = new Map<string, number>();
  for (const offer of Object.values(freeAgency.offers)) {
    const playerOffers = offersByPlayer.get(offer.playerId) ?? [];
    playerOffers.push(offer);
    offersByPlayer.set(offer.playerId, playerOffers);
    if (!offersByTeam.has(offer.teamId)) offersByTeam.set(offer.teamId, new Map());
    const teamOffers = offersByTeam.get(offer.teamId) as Map<string, FreeAgentOffer[]>;
    if (!teamOffers.has(offer.playerId)) teamOffers.set(offer.playerId, []);
    teamOffers.get(offer.playerId)?.push(offer);
    if (offer.createdDay === freeAgency.currentDay) offersTodayByTeam.set(offer.teamId, (offersTodayByTeam.get(offer.teamId) ?? 0) + 1);
  }
  for (const teamId of Object.keys(state.teams).sort()) {
    if (teamId === state.userTeamId || state.teams[teamId].playerIds.length >= aiOfferRosterLimit(state, teamId)) continue;
    const alreadyToday = offersTodayByTeam.get(teamId) ?? 0;
    const allowance = Math.max(0, BALANCE_CONFIG.ai.maxNewFreeAgentOffersPerTeamDay - alreadyToday);
    if (!allowance) continue;
    let availableCapSpace = getAvailableCapSpace(state, teamId);
    if (availableCapSpace < finance.minimumSalary && !state.capState.capHolds.some((hold) => hold.teamId === teamId)) continue;
    const tieHashes = new Map<string, string>();
    const tieHash = (playerId: string): string => {
      let hash = tieHashes.get(playerId);
      if (hash === undefined) {
        hash = stableHash(state.seeds.seasonSeed, teamId, freeAgency.currentDay, playerId);
        tieHashes.set(playerId, hash);
      }
      return hash;
    };
    const candidates = players.filter((player) => {
      const priorOffers = offersByTeam.get(teamId)?.get(player.id) ?? [];
      const market = freeAgency.markets[player.id];
      return !priorOffers.some((offer) => offer.status === "ACTIVE")
        && !(market?.marketWindowStatus === "OPEN" && priorOffers.some((offer) => offer.createdDay >= market.marketWindowStartDay && offer.status !== "WITHDRAWN"));
    })
      .sort((a, b) => (playerValues.get(b.id) as number) - (playerValues.get(a.id) as number) || tieHash(a.id).localeCompare(tieHash(b.id)));
    const aiFa = BALANCE_CONFIG.ai.freeAgency;
    let createdOffers = 0;
    for (const target of candidates) {
      if (createdOffers >= allowance) break;
      const salaryMultiplier = aiFa.salaryOfferMinMultiplier + createRng(stableHash(state.seeds.seasonSeed, "ai-fa", teamId, target.id, freeAgency.currentDay)).nextFloat()
        * (aiFa.salaryOfferMaxMultiplier - aiFa.salaryOfferMinMultiplier);
      const salary = Math.max(Math.ceil(finance.minimumSalary / 10_000) * 10_000,
        Math.round(getCurrentFreeAgentAsk(state, target) * salaryMultiplier / 10_000) * 10_000);
      const offeredSalary = Math.min(salary, maxSalary(target, state.league.seasonYear));
      const hold = state.capState.capHolds.find((entry) => entry.teamId === teamId && entry.playerId === target.id)?.amount ?? 0;
      const required = Math.max(0, offeredSalary - hold);
      const originalTeamId = freeAgency.markets[target.id]?.originalTeamId;
      const ownRfaRights = target.contract.status === "RFA" && originalTeamId === teamId && hold > 0;
      if (offeredSalary >= finance.minimumSalary && required > availableCapSpace && !ownRfaRights && !hasOwnBirdUfaRights(state, target, teamId)) continue;
      try {
        const created = createOfferMutable(
          state,
          teamId,
          target.id,
          target.age <= aiFa.longOfferMaximumAge ? aiFa.longOfferYears : aiFa.veteranOfferYears,
          offeredSalary,
          aiFa.guaranteedPercent,
          expectedRole(target),
          undefined,
          undefined,
          "NONE",
          offersByPlayer,
        );
        if (!offersByTeam.has(teamId)) offersByTeam.set(teamId, new Map());
        const teamOffers = offersByTeam.get(teamId) as Map<string, FreeAgentOffer[]>;
        if (!teamOffers.has(target.id)) teamOffers.set(target.id, []);
        teamOffers.get(target.id)?.push(created);
        createdOffers += 1;
        availableCapSpace = getAvailableCapSpace(state, teamId);
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
  market.matchingDeadline = freeAgency.currentDay + 2;
  rejectOtherOffers(state, offer, originalTeamId, "PLAYER_REJECTED");
  if (originalTeamId === state.userTeamId) {
    freeAgency.pendingUserRfaDecision ??= { playerId: offer.playerId, offerId: offer.offerId, originalTeamId, deadline: market.matchingDeadline };
    return;
  }
  const player = state.players[offer.playerId];
  const canFit = state.teams[originalTeamId].playerIds.length < aiOfferRosterLimit(state, originalTeamId);
  const rfaHold = state.capState.capHolds.find((hold) => hold.teamId === originalTeamId && hold.playerId === player.id);
  const canAfford = Boolean(rfaHold) || getCapSheet(state, originalTeamId).availableCapSpace >= offer.year1Salary;
  const match = canFit && canAfford && publicPlayerValue(player) >= BALANCE_CONFIG.ai.freeAgency.rfaMatchValue;
  signAcceptedOffer(state, offer, match ? originalTeamId : offer.teamId);
  freeAgency.transactionLog.unshift(`${state.teams[originalTeamId].fullName}${match ? "匹配" : "放弃匹配"} ${player.name} 的报价单`);
}

function nextUserRfaDecision(freeAgency: FreeAgencyState, userTeamId: string): FreeAgencyState["pendingUserRfaDecision"] {
  const market = Object.values(freeAgency.markets)
    .filter((entry) => entry.originalTeamId === userTeamId && entry.marketWindowStatus === "RFA_MATCHING"
      && entry.signedOfferSheetId && freeAgency.offers[entry.signedOfferSheetId]?.status === "SIGNED_OFFER_SHEET")
    .sort((left, right) => left.playerId.localeCompare(right.playerId))[0];
  if (!market?.signedOfferSheetId || market.matchingDeadline === undefined) return undefined;
  return { playerId: market.playerId, offerId: market.signedOfferSheetId, originalTeamId: userTeamId, deadline: market.matchingDeadline };
}

function settlePlayers(state: GameState): void {
  const freeAgency = state.freeAgency as FreeAgencyState;
  const offersByPlayer = new Map<string, FreeAgentOffer[]>();
  for (const offer of Object.values(freeAgency.offers)) {
    if (!offersByPlayer.has(offer.playerId)) offersByPlayer.set(offer.playerId, []);
    offersByPlayer.get(offer.playerId)?.push(offer);
  }
  for (const market of Object.values(freeAgency.markets).sort((a, b) => a.playerId.localeCompare(b.playerId))) {
    if (freeAgency.settledPlayerDay[market.playerId] === freeAgency.currentDay || market.marketWindowStatus !== "OPEN") continue;
    const active = (offersByPlayer.get(market.playerId) ?? []).filter((offer) => offer.status === "ACTIVE");
    for (const offer of active.filter((entry) => entry.expiresDay < freeAgency.currentDay)) {
      offer.status = "EXPIRED";
      releaseReservation(state, offer.offerId);
    }
    for (const offer of active.filter((entry) => entry.status === "ACTIVE")) {
      if (offer.kind === "OWN_EXTENSION_OFFER") continue;
      if (state.teams[offer.teamId].playerIds.length < aiOfferRosterLimit(state, offer.teamId)) continue;
      offer.status = "REJECTED";
      offer.resolutionReason = "ROSTER_FULL";
      releaseReservation(state, offer.offerId);
      if (offer.teamId === state.userTeamId) freeAgency.transactionLog.unshift(`${state.players[offer.playerId].name} 的报价因球队名单已满失效`);
    }
    const remaining = active.filter((offer) => offer.status === "ACTIVE").sort((a, b) => b.utility - a.utility || b.guaranteedValue - a.guaranteedValue || b.year1Salary - a.year1Salary || a.offerId.localeCompare(b.offerId));
    const best = remaining[0];
    if (!best) {
      market.marketWindowStatus = "CLOSED_NO_SIGNING";
    } else if (best.utility >= cfg.earlyAcceptThreshold || freeAgency.currentDay >= market.decisionDeadline && best.utility >= cfg.minimumAcceptThreshold) {
      if (best.kind === "RFA_OFFER_PROPOSAL") resolveRfaOfferSheet(state, best);
      else if (best.kind === "OWN_EXTENSION_OFFER") resolveOwnExtensionOffer(state, best);
      else signAcceptedOffer(state, best);
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

function isOpeningQualityFreeAgent(player: Player): boolean {
  const overall = calculatePlayerOverall(player);
  const quality = BALANCE_CONFIG.ai.freeAgency;
  return overall >= quality.openingQualityMinimumOverall
    || player.age <= quality.openingYoungQualityMaximumAge && overall >= quality.openingYoungQualityMinimumOverall;
}

/**
 * A short early-close market should still give AI teams one last chance to
 * claim obvious rotation upgrades. This pass only signs legal UFA contracts;
 * it never bypasses cap space or the roster upgrade check.
 */
function placeOpeningQualityFreeAgents(state: GameState): void {
  const candidates = Object.values(state.players)
    .filter((player) => player.teamId === "FREE_AGENT" && player.contract.status === "UFA" && isOpeningQualityFreeAgent(player))
    .sort((left, right) => calculatePlayerOverall(right) - calculatePlayerOverall(left) || left.id.localeCompare(right.id));
  for (const candidate of candidates) {
    const teams = Object.values(state.teams)
      .filter((team) => team.id !== state.userTeamId)
      .sort((left, right) => left.id.localeCompare(right.id));
    for (const team of teams) {
      if (state.players[candidate.id].teamId !== "FREE_AGENT") break;
      const currentTeam = state.teams[team.id];
      const currentPlayers = currentTeam.playerIds.map((id) => state.players[id]).filter(Boolean);
      const rosterLimit = aiOfferRosterLimit(state, team.id);
      const weakestOverall = currentPlayers.length ? Math.min(...currentPlayers.map(calculatePlayerOverall)) : 0;
      if (currentPlayers.length >= rosterLimit && calculatePlayerOverall(candidate) <= weakestOverall) continue;
      const transaction = structuredClone(state);
      if (transaction.teams[team.id].playerIds.length >= rosterLimit) {
        reserveAiFreeAgencySlot(transaction, team.id);
      }
      const draft = getRecommendedFreeAgentOffer(transaction, candidate.id, team.id);
      const preview = getFreeAgentCustomOfferPreview(transaction, candidate.id, draft, team.id);
      if (!preview.valid) continue;
      try {
        const offer = createOfferMutable(transaction, team.id, candidate.id, draft.years, draft.year1Salary,
          1, draft.rolePromised, draft.annualRaiseRate, draft.salaryByYear, draft.finalYearOption);
        offer.utility = 100;
        signAcceptedOffer(transaction, offer);
        Object.assign(state, transaction);
      } catch {
        // Try the next team when the candidate does not fit this team's cap or roster.
      }
    }
  }
}

export function finishMainFreeAgencyAfterSettlement(input: GameState, options: { mutate?: boolean } = {}): GameState {
  assertPhaseAllowed(input, "Finish main free agency", ["OFFSEASON_POST_DRAFT"]);
  const state = options.mutate ? input : structuredClone(input);
  if (state.freeAgency?.pendingUserRfaDecision) {
    state.freeAgency.closeAfterPendingRfa = true;
    return state;
  }
  for (const offer of Object.values(state.freeAgency?.offers ?? {})) {
    if (offer.status !== "ACTIVE") continue;
    offer.status = "WITHDRAWN";
    releaseReservation(state, offer.offerId);
  }
  placeOpeningQualityFreeAgents(state);
  // Closing the market early advances through the unused offseason days before preseason.
  if (state.freeAgency) advanceInjuriesByDays(state, Math.max(0, MAIN_FREE_AGENCY_DAYS - state.freeAgency.currentDay + 1));
  if (state.freeAgency) delete state.freeAgency.closeAfterPendingRfa;
  state.league.currentPhase = "PRESEASON";
  return state;
}

export function advanceFreeAgencyDay(input: GameState, options: { mutate?: boolean } = {}): GameState {
  assertPhaseAllowed(input, "Advance free agency day", offerPhases);
  const state = options.mutate ? input : structuredClone(input);
  ensureRegularSeasonMarket(state);
  if (!state.freeAgency?.opened) throw new Error("Free agency is not open");
  if (state.freeAgency.pendingUserRfaDecision) throw new Error("Resolve the pending RFA offer sheet before advancing");
  if (state.league.currentPhase === "OFFSEASON_POST_DRAFT" && state.freeAgency.currentDay > MAIN_FREE_AGENCY_DAYS) throw new Error("Main free agency has reached its final day");
  const previousStatuses = Object.fromEntries(Object.values(state.freeAgency.offers).map((offer) => [offer.offerId, offer.status]));
  refreshActiveOfferUtilities(state);
  generateAiOffers(state);
  settlePlayers(state);
  advanceFreeAgentDemand(state);
  if (state.league.currentPhase === "OFFSEASON_POST_DRAFT" || state.league.currentPhase === "PRESEASON") advanceInjuriesByDays(state, 1);
  (state.freeAgency as FreeAgencyState).currentDay += 1;
  for (const offer of Object.values((state.freeAgency as FreeAgencyState).offers)) {
    if (offer.status !== "ACTIVE" || offer.expiresDay >= (state.freeAgency as FreeAgencyState).currentDay) continue;
    offer.status = "EXPIRED";
    releaseReservation(state, offer.offerId);
  }
  for (const offer of Object.values((state.freeAgency as FreeAgencyState).offers)) {
    if (offer.teamId !== state.userTeamId || offer.status === "ACTIVE" || offer.status === "WITHDRAWN") continue;
    const previousStatus = previousStatuses[offer.offerId];
    if (!previousStatus || previousStatus === offer.status) continue;
    const player = state.players[offer.playerId];
    const signedTeam = player.teamId !== "FREE_AGENT" ? state.teams[player.teamId] : undefined;
    const market = (state.freeAgency as FreeAgencyState).markets[player.id];
    if (offer.kind === "OWN_EXTENSION_OFFER") {
      const accepted = offer.status === "ACCEPTED";
      addTeamNotification(state, {
        id: `fa-offer-${offer.offerId}-${offer.status}`, category: "FREE_AGENCY", seasonId: state.league.seasonId,
        title: accepted ? "提前续约成功" : "提前续约报价被拒绝",
        message: accepted
          ? `${offer.years} 年续约合同已生效，合同薪资与续约记录已更新。`
          : "球员没有接受本次续约报价，现有合同保持不变。",
        playerId: player.id, playerName: player.name,
      });
      continue;
    }
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
  if (state.league.currentPhase === "OFFSEASON_POST_DRAFT"
    && state.freeAgency.currentDay > MAIN_FREE_AGENCY_DAYS) finishMainFreeAgencyAfterSettlement(state, { mutate: true });
  return state;
}

export function resolveUserRfa(input: GameState, decision: "MATCH" | "DECLINE"): GameState {
  const state = structuredClone(input);
  const pending = state.freeAgency?.pendingUserRfaDecision;
  if (!pending) throw new Error("No RFA decision is pending");
  const offer = state.freeAgency?.offers[pending.offerId] as FreeAgentOffer;
  const market = state.freeAgency?.markets[pending.playerId];
  if (!offer || offer.playerId !== pending.playerId || offer.status !== "SIGNED_OFFER_SHEET"
    || market?.marketWindowStatus !== "RFA_MATCHING" || market.signedOfferSheetId !== pending.offerId
    || market.originalTeamId !== pending.originalTeamId || market.matchingDeadline !== pending.deadline
    || state.freeAgency!.currentDay > pending.deadline) throw new Error("RFA_MATCHING_STATE_INVALID");
  if (decision === "MATCH") {
    if (state.teams[state.userTeamId].playerIds.length >= getRosterLimit(state.league.currentPhase)) throw new Error("RFA match requires a roster slot");
    signAcceptedOffer(state, offer, state.userTeamId);
  } else signAcceptedOffer(state, offer, offer.teamId);
  delete (state.freeAgency as FreeAgencyState).pendingUserRfaDecision;
  (state.freeAgency as FreeAgencyState).pendingUserRfaDecision = nextUserRfaDecision(state.freeAgency as FreeAgencyState, state.userTeamId);
  addTeamNotification(state, {
    id: `rfa-decision-${offer.offerId}-${decision}`, category: "FREE_AGENCY", seasonId: state.league.seasonId,
    title: decision === "MATCH" ? "已匹配受限自由球员报价" : "已放弃匹配报价",
    message: decision === "MATCH" ? "球员已加入球队，合同生效。" : "球员将加盟报价球队。",
    playerId: offer.playerId, playerName: state.players[offer.playerId]?.name,
  });
  if (state.league.currentPhase === "OFFSEASON_POST_DRAFT"
    && (state.freeAgency!.closeAfterPendingRfa || state.freeAgency!.currentDay > MAIN_FREE_AGENCY_DAYS)) finishMainFreeAgencyAfterSettlement(state, { mutate: true });
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
    case "RESOLVE_QUALIFYING_OFFER": next = resolveQualifyingOffer(state, command.payload.playerId, command.payload.decision); break;
    case "RENEW_OWN_PLAYER": next = submitOwnPlayerExtensionOffer(state, { ...command.payload, guaranteedPercent: 1, finalYearOption: "NONE", rolePromised: "ROTATION" }); break;
    case "SUBMIT_OWN_EXTENSION_OFFER": next = submitOwnPlayerExtensionOffer(state, command.payload); break;
    case "SUBMIT_FA_OFFER": next = submitFreeAgentOffer(state, command.payload); break;
    case "WITHDRAW_FA_OFFER": next = withdrawFreeAgentOffer(state, command.payload.offerId); break;
    case "ADVANCE_FA_DAY": next = advanceFreeAgencyDay(state); break;
    case "RESOLVE_USER_RFA": next = resolveUserRfa(state, command.payload.decision); break;
  }
  next.commandReceipts[command.commandId] = { payloadHash };
  return next;
}
