import {
  EXPANSION_BRAND_PRESETS,
  EXPANSION_CITY_NAMES,
  SAFE_TEAM_COLORS,
  getCityAbbreviation,
  pickAiBrand,
} from "../../data/expansionBrands";
import { BALANCE_CONFIG } from "../../config/balanceConfig";
import { publicPlayerValue, negativeContractScore } from "../ai/AIValueService";
import { unlockAchievement } from "../career/AchievementService";
import { stableHash } from "../random/hash";
import { createRng } from "../random/xoshiro";
import { assertPhaseAllowed } from "../policy/TransactionPolicyService";
import type {
  ExpansionBrand,
  ExpansionCityId,
  ExpansionPackage,
  ExpansionPick,
  ExpansionState,
  ExpansionStrategy,
  ExpansionTradeCommitment,
  ExpansionTradeOffer,
  GameState,
  Player,
} from "../state/types";

export type ExpansionCommand =
  | { commandId: string; type: "CREATE_EXPANSION_TEAM"; payload: CreateExpansionTeamInput }
  | { commandId: string; type: "CHOOSE_RIGHTS_PACKAGE"; payload: { packageId: ExpansionPackage } }
  | { commandId: string; type: "ENTER_EXPANSION_DRAFT_PREP"; payload: { packageId?: ExpansionPackage } }
  | { commandId: string; type: "RESOLVE_OPTION_PHASE"; payload: Record<string, never> }
  | { commandId: string; type: "PREPARE_EXPANSION_TRADE"; payload: Record<string, never> }
  | { commandId: string; type: "ACCEPT_EXPANSION_TRADE"; payload: { offerId: string } }
  | { commandId: string; type: "START_EXPANSION_DRAFT"; payload: Record<string, never> }
  | { commandId: string; type: "SELECT_EXPANSION_PLAYER"; payload: { playerId: string; expectedPickNumber: number } };

export interface CreateExpansionTeamInput {
  cityId: ExpansionCityId;
  presetId: string;
  teamName: string;
  primaryColor: string;
  secondaryColor: string;
}

const EXPANSION_TEAM_IDS: ExpansionCityId[] = ["SEA", "LVG"];
const EXISTING_TEAM_IDS = (state: GameState): string[] =>
  Object.keys(state.teams).filter((teamId) => !EXPANSION_TEAM_IDS.includes(teamId as ExpansionCityId)).sort();

const ensurePhase = (state: GameState, phase: GameState["league"]["currentPhase"]): void => {
  assertPhaseAllowed(state, "Expansion command", [phase]);
};

const colorSet = new Set([
  ...SAFE_TEAM_COLORS,
  ...Object.values(EXPANSION_BRAND_PRESETS).flat().flatMap((brand) => [brand.primaryColor, brand.secondaryColor]),
].map((color) => color.toUpperCase()));

function graphemeCount(input: string): number {
  if (typeof Intl.Segmenter === "function") {
    return [...new Intl.Segmenter("zh-CN", { granularity: "grapheme" }).segment(input)].length;
  }
  return Array.from(input).length;
}

export function normalizeAndValidateTeamName(input: string, state: GameState, cityId: ExpansionCityId): string {
  const normalized = input.trim().normalize("NFKC");
  const length = graphemeCount(normalized);
  if (length < 2 || length > 20) throw new Error("球队名称必须为 2～20 个字符");
  if (!/^[\p{Script=Han}A-Za-z0-9 '-]+$/u.test(normalized)) throw new Error("球队名称包含不允许的字符");
  if (/\s{2,}/u.test(normalized)) throw new Error("球队名称不能包含连续空格");
  if (/^\d+$/u.test(normalized)) throw new Error("球队名称不能仅由数字组成");
  if (/\bNBA\b|National Basketball Association/iu.test(normalized)) throw new Error("球队名称包含禁用品牌词");
  const displayName = `${EXPANSION_CITY_NAMES[cityId]} ${normalized}`.toLocaleLowerCase();
  const duplicates = Object.values(state.teams).some((team) =>
    !EXPANSION_TEAM_IDS.includes(team.id as ExpansionCityId)
    && (team.name.toLocaleLowerCase() === normalized.toLocaleLowerCase() || team.fullName.toLocaleLowerCase() === displayName));
  if (duplicates) throw new Error("球队名称与联盟现有球队重复");
  return normalized;
}

function strategyFor(careerSeed: string, aiTeamId: ExpansionCityId): ExpansionStrategy {
  const roll = createRng(stableHash(careerSeed, aiTeamId, "expansion_strategy")).int(1, 100);
  const weights = BALANCE_CONFIG.expansion.aiStrategyWeights;
  return roll <= weights.FUTURE_FIRST ? "FUTURE_FIRST" : roll <= weights.FUTURE_FIRST + weights.BALANCED ? "BALANCED" : "WIN_NOW";
}

function applyBrand(state: GameState, teamId: ExpansionCityId, brand: ExpansionBrand): void {
  const team = state.teams[teamId];
  const city = EXPANSION_CITY_NAMES[teamId];
  team.city = city;
  team.name = brand.teamName;
  team.fullName = `${city} ${brand.teamName}`;
  team.englishName = brand.teamName;
  team.abbreviation = getCityAbbreviation(teamId);
  team.primaryColor = brand.primaryColor;
  team.secondaryColor = brand.secondaryColor;
  team.dayColor = brand.primaryColor.slice(1).toUpperCase();
  team.nightColor = brand.secondaryColor.slice(1).toUpperCase();
  team.logoUrl = brand.logoUrl;
}

export function createExpansionTeam(state: GameState, input: CreateExpansionTeamInput): GameState {
  ensurePhase(state, "TEAM_CREATION");
  const next = structuredClone(state);
  const preset = EXPANSION_BRAND_PRESETS[input.cityId].find((brand) => brand.presetId === input.presetId);
  if (!preset) throw new Error("无效的预审核 Logo 方案");
  const primaryColor = input.primaryColor.toUpperCase();
  const secondaryColor = input.secondaryColor.toUpperCase();
  if (!colorSet.has(primaryColor) || !colorSet.has(secondaryColor)) throw new Error("颜色必须来自安全色板");
  if (primaryColor === secondaryColor) throw new Error("主色和辅色不能相同");
  const teamName = normalizeAndValidateTeamName(input.teamName, next, input.cityId);
  const playerBrand: ExpansionBrand = {
    ...structuredClone(preset),
    teamName,
    shortName: teamName,
    primaryColor,
    secondaryColor,
  };
  const aiTeamId: ExpansionCityId = input.cityId === "SEA" ? "LVG" : "SEA";
  const aiBrand = pickAiBrand(next.seeds.careerSeed, aiTeamId);
  const aiStrategy = strategyFor(next.seeds.careerSeed, aiTeamId);
  next.aiTeamProfiles[aiTeamId] = {
    personality: aiStrategy === "FUTURE_FIRST" ? "DRAFT_FOCUSED" : aiStrategy === "WIN_NOW" ? "AGGRESSIVE" : "CONSERVATIVE",
    direction: aiStrategy === "FUTURE_FIRST" ? "REBUILD" : "COMPETE",
    directionLockUntilCareerDay: next.league.seasonYear * BALANCE_CONFIG.ai.careerDaysPerSeason + BALANCE_CONFIG.ai.directionLockDays,
    lastDirectionChangeSeasonId: next.league.seasonId,
  };
  applyBrand(next, input.cityId, playerBrand);
  applyBrand(next, aiTeamId, aiBrand);
  next.userTeamId = input.cityId;
  const rightsSeed = stableHash(next.seeds.careerSeed, "expansion_rights");
  const rightsDraw: ExpansionState["rightsDraw"] = {
    seed: rightsSeed,
    winnerTeamId: input.cityId,
    packageByTeam: {},
    resolved: false,
  };
  next.expansion = {
    playerTeamId: input.cityId,
    aiTeamId,
    brands: { [input.cityId]: playerBrand, [aiTeamId]: aiBrand },
    aiStrategy,
    rightsDraw,
    optionPhaseResolved: false,
    protectionLists: {},
    poolStatusByPlayerId: {},
    sourceTeamLossOwner: {},
    tradeOffers: [],
    commitments: [],
    draftOrder: [],
    picks: [],
    currentPickIndex: 0,
    finalized: false,
  };
  next.league.currentPhase = "EXPANSION_RIGHTS";
  validateExpansionState(next);
  return next;
}

export function chooseRightsPackage(state: GameState, packageId: ExpansionPackage): GameState {
  ensurePhase(state, "EXPANSION_RIGHTS");
  if (!state.expansion) throw new Error("扩军状态不存在");
  if (state.expansion.rightsDraw.winnerTeamId !== state.expansion.playerTeamId) throw new Error("本次权益抽签由 AI 中奖");
  if (state.expansion.rightsDraw.resolved) throw new Error("权益 Package 已经确认");
  const next = structuredClone(state);
  const expansion = next.expansion as ExpansionState;
  expansion.rightsDraw.selectedPackage = packageId;
  expansion.rightsDraw.packageByTeam[expansion.playerTeamId] = packageId;
  expansion.rightsDraw.packageByTeam[expansion.aiTeamId] = packageId === "A" ? "B" : "A";
  expansion.rightsDraw.resolved = true;
  validateExpansionState(next);
  return next;
}

export function resolveOptionPhase(state: GameState): GameState {
  ensurePhase(state, "EXPANSION_RIGHTS");
  if (!state.expansion?.rightsDraw.resolved) throw new Error("必须先确认权益 Package");
  const next = structuredClone(state);
  for (const player of Object.values(next.players).sort((a, b) => a.id.localeCompare(b.id))) {
    if (player.contract.optionDecision !== "PENDING") continue;
    const exercised = createRng(stableHash(next.seeds.careerSeed, player.id, "option_decision")).nextFloat() < BALANCE_CONFIG.expansion.optionExerciseProbability;
    player.contract.optionDecision = exercised ? "EXERCISED" : "DECLINED";
    if (!exercised) {
      player.contract.status = "UFA";
      player.contract.yearsRemaining = 0;
      player.contract.guaranteedAmount = 0;
    }
  }
  (next.expansion as ExpansionState).optionPhaseResolved = true;
  (next.expansion as ExpansionState).lastNotice = "球员与球队选项已按固定 Seed 结算；UFA、RFA 与未执行选项球员不会进入扩军池。";
  next.league.currentPhase = "OPTION_PHASE";
  validateExpansionState(next);
  return next;
}

export function enterExpansionDraftPrep(state: GameState, packageId?: ExpansionPackage): GameState {
  ensurePhase(state, "EXPANSION_RIGHTS");
  if (!state.expansion) throw new Error("扩军状态不存在");
  let next = state;
  if (!state.expansion.rightsDraw.resolved) {
    if (!packageId) throw new Error("抽签赢家必须先选择权益方案");
    next = chooseRightsPackage(next, packageId);
  }
  next = resolveOptionPhase(next);
  next = prepareExpansionTrade(next);
  if (next.expansion) next.expansion.lastNotice = "合同选项已在后台结算，保护名单、扩军池与交易报价已经冻结。";
  validateExpansionState(next);
  return next;
}

function sortedPlayers(state: GameState, playerIds: string[], strategy: ExpansionStrategy): Player[] {
  return playerIds.map((id) => state.players[id]).filter(Boolean)
    .sort((a, b) => publicPlayerValue(b, strategy) - publicPlayerValue(a, strategy) || a.id.localeCompare(b.id));
}

function generateProtectionLists(state: GameState): void {
  const expansion = state.expansion as ExpansionState;
  for (const teamId of EXISTING_TEAM_IDS(state)) {
    const eligibleIds = state.teams[teamId].playerIds.filter((playerId) => {
      const contract = state.players[playerId]?.contract;
      return contract?.status === "STANDARD"
        && contract.contractType !== "EMERGENCY"
        && contract.yearsRemaining > 0
        && contract.optionDecision !== "PENDING"
        && contract.optionDecision !== "DECLINED";
    });
    const roster = sortedPlayers(state, eligibleIds, "BALANCED");
    if (roster.length <= BALANCE_CONFIG.expansion.protectedPlayersPerExistingTeam) throw new Error(`${teamId} 没有足够球员生成保护名单`);
    const protectedCount = BALANCE_CONFIG.expansion.protectedPlayersPerExistingTeam;
    const protectedPlayerIds = roster.slice(0, protectedCount).map((player) => player.id);
    const exposedPlayerIds = roster.slice(protectedCount).map((player) => player.id);
    expansion.protectionLists[teamId] = { teamId, protectedPlayerIds, exposedPlayerIds };
    for (const playerId of protectedPlayerIds) expansion.poolStatusByPlayerId[playerId] = "PROTECTED";
    for (const playerId of exposedPlayerIds) expansion.poolStatusByPlayerId[playerId] = "AVAILABLE";
  }
}

function pickOfferAsset(state: GameState, sourceTeamId: string, targetTeamId: ExpansionCityId, type: ExpansionTradeOffer["type"], index: number): string {
  const compensation = BALANCE_CONFIG.expansion.compensationPick;
  const year = compensation.startYear + ((index + (targetTeamId === "SEA" ? 0 : 2)) % compensation.yearWindow);
  const round = type === "SELECT_PLAYER" ? compensation.selectPlayerRound : compensation.protectPlayerRound;
  const id = `${year}-R${round}-${sourceTeamId}`;
  if (!state.draftPicks[id]) throw new Error(`补偿资产不存在: ${id}`);
  return id;
}

function generateTradeOffers(state: GameState): void {
  const expansion = state.expansion as ExpansionState;
  expansion.tradeOffers = [];
  EXISTING_TEAM_IDS(state).forEach((sourceTeamId, index) => {
    const exposed = expansion.protectionLists[sourceTeamId].exposedPlayerIds.map((id) => state.players[id]);
    for (const targetExpansionTeamId of EXPANSION_TEAM_IDS) {
      const rng = createRng(stableHash(state.seeds.careerSeed, "expansion_trade", sourceTeamId, targetExpansionTeamId));
      const type: ExpansionTradeOffer["type"] = rng.nextFloat() < BALANCE_CONFIG.expansion.protectPlayerOfferProbability ? "PROTECT_PLAYER" : "SELECT_PLAYER";
      const ranked = [...exposed].sort((a, b) => {
        const left = type === "PROTECT_PLAYER" ? publicPlayerValue(a) : negativeContractScore(a);
        const right = type === "PROTECT_PLAYER" ? publicPlayerValue(b) : negativeContractScore(b);
        return right - left || a.id.localeCompare(b.id);
      });
      const targetPlayerId = ranked[0].id;
      const compensationAssetIds = [pickOfferAsset(state, sourceTeamId, targetExpansionTeamId, type, index)];
      expansion.tradeOffers.push({
        id: stableHash(state.seeds.careerSeed, "expansion_offer", sourceTeamId, targetExpansionTeamId),
        sourceTeamId,
        targetExpansionTeamId,
        type,
        targetPlayerId,
        compensationAssetIds,
        status: "AVAILABLE",
      });
    }
  });
  expansion.tradeOffers.sort((a, b) => a.id.localeCompare(b.id));
}

function acceptOfferMutable(state: GameState, offerId: string, expectedTeamId: ExpansionCityId): void {
  const expansion = state.expansion as ExpansionState;
  const offer = expansion.tradeOffers.find((entry) => entry.id === offerId);
  if (!offer || offer.status !== "AVAILABLE") throw new Error("报价不可接受或已经处理");
  if (offer.targetExpansionTeamId !== expectedTeamId) throw new Error("该报价不属于当前扩军球队");
  const accepted = expansion.commitments.filter((entry) => entry.expansionTeamId === expectedTeamId && entry.status === "ACTIVE");
  if (accepted.length >= BALANCE_CONFIG.expansion.maxAcceptedTradesPerTeam) throw new Error(`每支扩军队最多接受 ${BALANCE_CONFIG.expansion.maxAcceptedTradesPerTeam} 笔 Expansion Trade`);
  if (accepted.some((entry) => entry.sourceTeamId === offer.sourceTeamId)) throw new Error("同一老球队只能向该扩军队完成一笔协议");
  for (const assetId of offer.compensationAssetIds) {
    const asset = state.draftPicks[assetId];
    if (!asset || asset.ownerTeamId !== offer.sourceTeamId || asset.reservedByCommitmentId) throw new Error("补偿资产已被占用");
  }
  if (offer.type === "SELECT_PLAYER") {
    if (expansion.poolStatusByPlayerId[offer.targetPlayerId] !== "AVAILABLE") throw new Error("指定球员已不可选");
    if (expansion.sourceTeamLossOwner[offer.sourceTeamId]) throw new Error("该球队的扩军损失名额已被占用");
  }
  const commitmentId = stableHash(offer.id, "commitment");
  const commitment: ExpansionTradeCommitment = {
    id: commitmentId,
    offerId: offer.id,
    expansionTeamId: expectedTeamId,
    sourceTeamId: offer.sourceTeamId,
    type: offer.type,
    targetPlayerId: offer.targetPlayerId,
    compensationAssetIds: [...offer.compensationAssetIds],
    status: "ACTIVE",
    acceptedOrder: expansion.commitments.length,
  };
  for (const assetId of offer.compensationAssetIds) state.draftPicks[assetId].reservedByCommitmentId = commitmentId;
  if (offer.type === "SELECT_PLAYER") {
    for (const playerId of expansion.protectionLists[offer.sourceTeamId].exposedPlayerIds) {
      if (expansion.poolStatusByPlayerId[playerId] === "AVAILABLE") {
        expansion.poolStatusByPlayerId[playerId] = "LOCKED_BY_COMMITMENT";
      }
    }
    expansion.sourceTeamLossOwner[offer.sourceTeamId] = expectedTeamId;
    for (const conflicting of expansion.tradeOffers) {
      if (conflicting.id !== offer.id && conflicting.status === "AVAILABLE" && conflicting.type === "SELECT_PLAYER"
        && (conflicting.sourceTeamId === offer.sourceTeamId || conflicting.targetPlayerId === offer.targetPlayerId)) {
        conflicting.status = "REJECTED";
      }
    }
  }
  offer.status = "ACCEPTED";
  offer.commitmentId = commitmentId;
  expansion.commitments.push(commitment);
  expansion.lastNotice = offer.type === "SELECT_PLAYER"
    ? `已接受指定选择协议：${state.players[offer.targetPlayerId].name} 将在下一可用签位自动加入。`
    : `已接受保护协议：${state.players[offer.targetPlayerId].name} 不会被本队选择。`;
  validatePoolFeasibility(state);
}

function acceptAiOffers(state: GameState): void {
  const aiTeamId = (state.expansion as ExpansionState).aiTeamId;
  const offers = (state.expansion as ExpansionState).tradeOffers
    .filter((offer) => offer.targetExpansionTeamId === aiTeamId)
    .sort((a, b) => (a.type === "SELECT_PLAYER" ? -1 : 1) - (b.type === "SELECT_PLAYER" ? -1 : 1) || a.id.localeCompare(b.id));
  for (const offer of offers) {
    const activeExpansion = state.expansion as ExpansionState;
    if (activeExpansion.commitments.filter((entry) => entry.expansionTeamId === aiTeamId).length >= BALANCE_CONFIG.expansion.aiAcceptedTradeTarget) break;
    try {
      const candidate = structuredClone(state);
      acceptOfferMutable(candidate, offer.id, aiTeamId);
      state.expansion = candidate.expansion;
      state.draftPicks = candidate.draftPicks;
    } catch { /* deterministic skip with no partial mutation */ }
  }
}

export function prepareExpansionTrade(state: GameState): GameState {
  ensurePhase(state, "OPTION_PHASE");
  if (!state.expansion?.optionPhaseResolved) throw new Error("必须先完成 Option Phase");
  const next = structuredClone(state);
  generateProtectionLists(next);
  generateTradeOffers(next);
  acceptAiOffers(next);
  next.league.currentPhase = "EXPANSION_TRADE";
  (next.expansion as ExpansionState).lastNotice = `Option Phase 已完成；${EXISTING_TEAM_IDS(next).length} 支老球队已各保护 ${BALANCE_CONFIG.expansion.protectedPlayersPerExistingTeam} 名合格球员，扩军池与交易报价已冻结。`;
  validateExpansionState(next);
  return next;
}

export function acceptExpansionTrade(state: GameState, offerId: string): GameState {
  ensurePhase(state, "EXPANSION_TRADE");
  if (!state.expansion) throw new Error("扩军状态不存在");
  const next = structuredClone(state);
  acceptOfferMutable(next, offerId, (next.expansion as ExpansionState).playerTeamId);
  validateExpansionState(next);
  return next;
}

function buildDraftOrder(expansion: ExpansionState): ExpansionCityId[] {
  const packageATeam = EXPANSION_TEAM_IDS.find((teamId) => expansion.rightsDraw.packageByTeam[teamId] === "A");
  if (!packageATeam) throw new Error("Package A 尚未分配");
  const packageBTeam: ExpansionCityId = packageATeam === "SEA" ? "LVG" : "SEA";
  const firstTeam = BALANCE_CONFIG.expansion.package.A.firstExpansionPick < BALANCE_CONFIG.expansion.package.B.firstExpansionPick ? packageATeam : packageBTeam;
  const secondTeam = firstTeam === packageATeam ? packageBTeam : packageATeam;
  const order: ExpansionCityId[] = [];
  for (let round = 0; round < BALANCE_CONFIG.expansion.rosterPlayersPerExpansionTeam; round += 1) {
    order.push(...(round % 2 === 0 ? [firstTeam, secondTeam] : [secondTeam, firstTeam]));
  }
  return order;
}

function activeSelectCommitment(expansion: ExpansionState, teamId: ExpansionCityId): ExpansionTradeCommitment | undefined {
  return expansion.commitments
    .filter((entry) => entry.expansionTeamId === teamId && entry.type === "SELECT_PLAYER" && entry.status === "ACTIVE")
    .sort((a, b) => a.acceptedOrder - b.acceptedOrder)[0];
}

function canSelect(state: GameState, teamId: ExpansionCityId, playerId: string, commitment?: ExpansionTradeCommitment): boolean {
  const expansion = state.expansion as ExpansionState;
  const player = state.players[playerId];
  if (!player || EXPANSION_TEAM_IDS.includes(player.teamId as ExpansionCityId)) return false;
  const status = expansion.poolStatusByPlayerId[playerId];
  if (commitment) return commitment.targetPlayerId === playerId && status === "LOCKED_BY_COMMITMENT";
  if (status !== "AVAILABLE") return false;
  if (expansion.sourceTeamLossOwner[player.teamId]) return false;
  return !expansion.commitments.some((entry) =>
    entry.status === "ACTIVE" && entry.expansionTeamId === teamId && entry.type === "PROTECT_PLAYER" && entry.targetPlayerId === playerId);
}

function sourceHasSelectablePlayer(state: GameState, teamId: ExpansionCityId, sourceTeamId: string): boolean {
  const expansion = state.expansion as ExpansionState;
  return expansion.protectionLists[sourceTeamId]?.exposedPlayerIds.some((playerId) => {
    const status = expansion.poolStatusByPlayerId[playerId];
    if (status !== "AVAILABLE") return false;
    return !expansion.commitments.some((entry) => entry.status === "ACTIVE"
      && entry.expansionTeamId === teamId
      && entry.type === "PROTECT_PLAYER"
      && entry.targetPlayerId === playerId);
  }) ?? false;
}

export function validatePoolFeasibility(state: GameState): void {
  const expansion = state.expansion;
  if (!expansion || Object.keys(expansion.protectionLists).length === 0) return;
  const pickedByTeam = Object.fromEntries(EXPANSION_TEAM_IDS.map((teamId) => [teamId, expansion.picks.filter((pick) => pick.teamId === teamId).length])) as Record<ExpansionCityId, number>;
  const forcedByTeam = Object.fromEntries(EXPANSION_TEAM_IDS.map((teamId) => [teamId, expansion.commitments.filter((entry) => entry.status === "ACTIVE" && entry.type === "SELECT_PLAYER" && entry.expansionTeamId === teamId).length])) as Record<ExpansionCityId, number>;
  const rosterTarget = BALANCE_CONFIG.expansion.rosterPlayersPerExpansionTeam;
  const need: Record<ExpansionCityId, number> = {
    SEA: rosterTarget - pickedByTeam.SEA - forcedByTeam.SEA,
    LVG: rosterTarget - pickedByTeam.LVG - forcedByTeam.LVG,
  };
  if (need.SEA < 0 || need.LVG < 0) throw new Error("SELECT_PLAYER 协议超过剩余名单名额");
  let onlySea = 0;
  let onlyLvg = 0;
  let shared = 0;
  for (const sourceTeamId of EXISTING_TEAM_IDS(state)) {
    if (expansion.sourceTeamLossOwner[sourceTeamId]) continue;
    const sea = sourceHasSelectablePlayer(state, "SEA", sourceTeamId);
    const lvg = sourceHasSelectablePlayer(state, "LVG", sourceTeamId);
    if (sea && lvg) shared += 1;
    else if (sea) onlySea += 1;
    else if (lvg) onlyLvg += 1;
  }
  if (need.SEA > onlySea + shared || need.LVG > onlyLvg + shared || need.SEA + need.LVG > onlySea + onlyLvg + shared) {
    throw new Error(`该协议会使剩余扩军池无法完成 ${rosterTarget * EXPANSION_TEAM_IDS.length} 次选择`);
  }
}

function transferCompensation(state: GameState, commitment: ExpansionTradeCommitment): void {
  for (const assetId of commitment.compensationAssetIds) {
    const asset = state.draftPicks[assetId];
    if (asset.reservedByCommitmentId !== commitment.id) throw new Error("补偿资产 Reserve 状态损坏");
    asset.ownerTeamId = commitment.expansionTeamId;
    delete asset.reservedByCommitmentId;
  }
  commitment.status = "FULFILLED";
  const offer = (state.expansion as ExpansionState).tradeOffers.find((entry) => entry.id === commitment.offerId);
  if (offer) offer.status = "FULFILLED";
}

function commitPickMutable(state: GameState, teamId: ExpansionCityId, playerId: string, commitment?: ExpansionTradeCommitment): void {
  const expansion = state.expansion as ExpansionState;
  if (!canSelect(state, teamId, playerId, commitment)) throw new Error("该球员当前不可被选择");
  const player = state.players[playerId];
  const sourceTeamId = player.teamId;
  const sourceTeam = state.teams[sourceTeamId];
  const destinationTeam = state.teams[teamId];
  if (destinationTeam.playerIds.length >= BALANCE_CONFIG.expansion.rosterPlayersPerExpansionTeam) throw new Error("扩军球队已达到名单人数上限");
  sourceTeam.playerIds = sourceTeam.playerIds.filter((id) => id !== playerId);
  destinationTeam.playerIds.push(playerId);
  player.teamId = teamId;
  expansion.sourceTeamLossOwner[sourceTeamId] = teamId;
  expansion.poolStatusByPlayerId[playerId] = "SELECTED";
  for (const exposedId of expansion.protectionLists[sourceTeamId].exposedPlayerIds) {
    if (exposedId !== playerId && expansion.poolStatusByPlayerId[exposedId] !== "SELECTED") {
      expansion.poolStatusByPlayerId[exposedId] = "REMOVED_BY_TEAM_LOSS";
    }
  }
  const pick: ExpansionPick = {
    pickNumber: expansion.currentPickIndex + 1,
    round: Math.floor(expansion.currentPickIndex / 2) + 1,
    teamId,
    playerId,
    sourceTeamId,
    commitmentId: commitment?.id,
  };
  expansion.picks.push(pick);
  expansion.currentPickIndex += 1;
  if (commitment) transferCompensation(state, commitment);
  expansion.lastNotice = teamId === expansion.aiTeamId
    ? `${state.teams[teamId].fullName} 选择了 ${player.name}。${state.teams[sourceTeamId].fullName} 其余暴露球员已退出扩军池。`
    : `你选择了 ${player.name}，并继承其剩余合同。`;
}

function selectablePlayers(state: GameState, teamId: ExpansionCityId): Player[] {
  const expansion = state.expansion as ExpansionState;
  return Object.keys(expansion.poolStatusByPlayerId)
    .filter((playerId) => canSelect(state, teamId, playerId))
    .map((playerId) => state.players[playerId])
    .sort((a, b) => publicPlayerValue(b, teamId === expansion.aiTeamId ? expansion.aiStrategy : "BALANCED")
      - publicPlayerValue(a, teamId === expansion.aiTeamId ? expansion.aiStrategy : "BALANCED") || a.id.localeCompare(b.id));
}

function finalizeExpansionDraftMutable(state: GameState): void {
  const expansion = state.expansion as ExpansionState;
  const totalPicks = BALANCE_CONFIG.expansion.rosterPlayersPerExpansionTeam * EXPANSION_TEAM_IDS.length;
  if (expansion.picks.length !== totalPicks) throw new Error(`扩军选秀尚未完成 ${totalPicks} 次选择`);
  for (const teamId of EXPANSION_TEAM_IDS) {
    if (state.teams[teamId].playerIds.length !== BALANCE_CONFIG.expansion.rosterPlayersPerExpansionTeam) throw new Error(`${teamId} 名单人数不正确`);
  }
  for (const commitment of expansion.commitments) {
    if (commitment.status === "ACTIVE" && commitment.type === "PROTECT_PLAYER") transferCompensation(state, commitment);
  }
  for (const offer of expansion.tradeOffers) if (offer.status === "AVAILABLE") offer.status = "REJECTED";
  expansion.finalized = true;
  expansion.lastNotice = `${totalPicks} 次扩军选择全部完成，协议补偿已经结算。`;
  unlockAchievement(state, "EXPANSION_COMPLETE");
  state.league.currentPhase = "ROOKIE_DRAFT_PENDING";
}

function autoAdvanceNonPlayerTurns(state: GameState): void {
  const expansion = state.expansion as ExpansionState;
  while (expansion.currentPickIndex < expansion.draftOrder.length) {
    const teamId = expansion.draftOrder[expansion.currentPickIndex];
    const forcedCommitment = activeSelectCommitment(expansion, teamId);
    if (forcedCommitment) {
      commitPickMutable(state, teamId, forcedCommitment.targetPlayerId, forcedCommitment);
      continue;
    }
    if (teamId === expansion.playerTeamId) break;
    const target = selectablePlayers(state, teamId)[0];
    if (!target) throw new Error("AI 没有合法的扩军选择");
    commitPickMutable(state, teamId, target.id);
  }
  if (expansion.currentPickIndex === expansion.draftOrder.length) finalizeExpansionDraftMutable(state);
}

export function startExpansionDraft(state: GameState): GameState {
  ensurePhase(state, "EXPANSION_TRADE");
  if (!state.expansion) throw new Error("扩军状态不存在");
  const next = structuredClone(state);
  const expansion = next.expansion as ExpansionState;
  expansion.draftOrder = buildDraftOrder(expansion);
  next.league.currentPhase = "EXPANSION_DRAFT";
  autoAdvanceNonPlayerTurns(next);
  validateExpansionState(next);
  return next;
}

export function selectExpansionPlayer(state: GameState, playerId: string, expectedPickNumber: number): GameState {
  ensurePhase(state, "EXPANSION_DRAFT");
  if (!state.expansion) throw new Error("扩军状态不存在");
  if (state.expansion.currentPickIndex + 1 !== expectedPickNumber) throw new Error("该签位已经变化，请刷新后重试");
  if (state.expansion.draftOrder[state.expansion.currentPickIndex] !== state.expansion.playerTeamId) throw new Error("当前不是玩家签位");
  const next = structuredClone(state);
  commitPickMutable(next, (next.expansion as ExpansionState).playerTeamId, playerId);
  autoAdvanceNonPlayerTurns(next);
  validateExpansionState(next);
  return next;
}

export function getSelectableExpansionPlayers(state: GameState): Player[] {
  if (!state.expansion) return [];
  return selectablePlayers(state, state.expansion.playerTeamId);
}

export function validateExpansionState(state: GameState): void {
  const expansion = state.expansion;
  if (!expansion) return;
  const rosterOwner = new Map<string, string>();
  for (const team of Object.values(state.teams)) {
    for (const playerId of team.playerIds) {
      if (rosterOwner.has(playerId)) throw new Error(`球员重复归属: ${playerId}`);
      rosterOwner.set(playerId, team.id);
      if (state.players[playerId]?.teamId !== team.id) throw new Error(`球员与名单归属不一致: ${playerId}`);
    }
  }
  for (const player of Object.values(state.players)) {
    if (rosterOwner.get(player.id) !== player.teamId) throw new Error(`球员缺少或错误的名单归属: ${player.id}`);
  }
  if (new Set(expansion.picks.map((pick) => pick.playerId)).size !== expansion.picks.length) throw new Error("Expansion Pick 出现重复球员");
  if (new Set(expansion.picks.map((pick) => pick.sourceTeamId)).size !== expansion.picks.length) throw new Error("老球队损失超过 1 人");
  if (expansion.currentPickIndex !== expansion.picks.length) throw new Error("Expansion Draft 游标与 Pick 数不一致");
  for (const teamId of EXPANSION_TEAM_IDS) if (state.teams[teamId].playerIds.length > BALANCE_CONFIG.expansion.rosterPlayersPerExpansionTeam) throw new Error(`${teamId} 超过扩军名单人数上限`);
  for (const commitment of expansion.commitments.filter((entry) => entry.status === "ACTIVE")) {
    for (const assetId of commitment.compensationAssetIds) {
      if (state.draftPicks[assetId]?.reservedByCommitmentId !== commitment.id) throw new Error("Commitment 资产 Reserve 不一致");
    }
  }
  validatePoolFeasibility(state);
}

export function executeExpansionCommand(state: GameState, command: ExpansionCommand): GameState {
  const payloadHash = stableHash(command.type, command.payload);
  const receipt = state.commandReceipts[command.commandId];
  if (receipt) {
    if (receipt.payloadHash !== payloadHash) throw new Error("Command ID 已被不同 Payload 使用");
    return state;
  }
  let next: GameState;
  switch (command.type) {
    case "CREATE_EXPANSION_TEAM": next = createExpansionTeam(state, command.payload); break;
    case "CHOOSE_RIGHTS_PACKAGE": next = chooseRightsPackage(state, command.payload.packageId); break;
    case "ENTER_EXPANSION_DRAFT_PREP": next = enterExpansionDraftPrep(state, command.payload.packageId); break;
    case "RESOLVE_OPTION_PHASE": next = resolveOptionPhase(state); break;
    case "PREPARE_EXPANSION_TRADE": next = prepareExpansionTrade(state); break;
    case "ACCEPT_EXPANSION_TRADE": next = acceptExpansionTrade(state, command.payload.offerId); break;
    case "START_EXPANSION_DRAFT": next = startExpansionDraft(state); break;
    case "SELECT_EXPANSION_PLAYER": next = selectExpansionPlayer(state, command.payload.playerId, command.payload.expectedPickNumber); break;
  }
  next.commandReceipts[command.commandId] = { payloadHash };
  validateExpansionState(next);
  return next;
}
