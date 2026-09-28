import { BALANCE_CONFIG } from "../../config/balanceConfig";
import { corePlayerTradePremium, publicPlayerValue, tradeDraftPickValue } from "../ai/AIValueService";
import { assertPhaseAllowed, getRosterLimit } from "../policy/TransactionPolicyService";
import { low32FromHash, stableHash } from "../random/hash";
import type { DraftPickAsset, GameState, Player, TradeOffer } from "../state/types";
import { calculateTeamFitForPlayers } from "../team/TeamFitService";
import { validateSalaryMatch } from "./SalaryMatchValidator";
import { reconcileRotationAfterRosterChange } from "../roster/RotationPlanService";

export type TradeCommand =
  | { commandId: string; type: "SET_TRADE_ASSETS"; payload: TradeSelection }
  | { commandId: string; type: "GENERATE_TRADE_OFFERS"; payload: ({ playerId: string; refresh: boolean } | { playerIds: string[]; pickIds: string[]; refresh: boolean }) }
  | { commandId: string; type: "ACCEPT_TRADE_OFFER"; payload: { offerId: string } };

export interface TradePackage {
  leftTeamId: string;
  rightTeamId: string;
  leftPlayerIds: string[];
  rightPlayerIds: string[];
  leftPickIds: string[];
  rightPickIds: string[];
}

export interface TradeSelection { playerIds: string[]; pickIds: string[] }

export const TRADE_PHASES = ["OFFSEASON_PRE_DRAFT", "OFFSEASON_POST_DRAFT", "PRESEASON", "REGULAR_PRE_DEADLINE", "REGULAR_SEASON"] as const;
export type TradePhase = typeof TRADE_PHASES[number];

export interface TradeOfferEvaluation {
  legal: boolean;
  reason?: string;
  outgoingSalary: number;
  incomingSalary: number;
  salaryDifference: number;
  userFitBefore: number;
  userFitAfter: number;
  userFitDelta: number;
  counterpartyFitBefore: number;
  counterpartyFitAfter: number;
  counterpartyFitDelta: number;
  outgoingAssetValue: number;
  incomingAssetValue: number;
  userValueDelta: number;
  gmWillingness: "极高" | "较高" | "一般" | "拒绝";
}

export function isTradePhaseAllowed(phase: GameState["league"]["currentPhase"]): phase is TradePhase {
  return (TRADE_PHASES as readonly string[]).includes(phase);
}

function isTradeWindowOpen(state: GameState): boolean {
  return isTradePhaseAllowed(state.league.currentPhase)
    && (state.league.currentPhase !== "REGULAR_SEASON" || state.calendar.currentDateIndex <= BALANCE_CONFIG.ai.tradeDeadlineDateIndex);
}

function firstTradablePickYear(state: GameState): number {
  return state.league.currentPhase === "OFFSEASON_PRE_DRAFT" ? state.league.seasonYear : state.league.seasonYear + 1;
}

function validatePickRule(state: GameState, movingPickIds: string[], fromTeamId: string): void {
  const firstYear = firstTradablePickYear(state);
  const lastYear = state.league.seasonYear + BALANCE_CONFIG.trade.futurePickHorizonYears;
  for (const pickId of movingPickIds) {
    const pick = state.draftPicks[pickId];
    if (pick?.ownerTeamId !== fromTeamId) throw new Error("DRAFT_PICK_NOT_OWNED");
    if (pick.reservedByCommitmentId) throw new Error("DRAFT_PICK_RESERVED");
    if (pick.year < firstYear || pick.year > lastYear) throw new Error("DRAFT_PICK_OUTSIDE_SEVEN_YEAR_WINDOW");
  }
}

function hasDuplicate(ids: string[]): boolean { return new Set(ids).size !== ids.length; }

function validatedTradeSelection(input: GameState, selection: TradeSelection, requireAssets: boolean): TradeSelection {
  const playerIds = [...selection.playerIds].sort();
  const pickIds = [...selection.pickIds].sort();
  if (requireAssets && !playerIds.length && !pickIds.length) throw new Error("TRADE_ASSET_REQUIRED");
  if (hasDuplicate(playerIds) || hasDuplicate(pickIds)) throw new Error("DUPLICATE_TRADE_ASSET");
  for (const id of playerIds) {
    const player = input.players[id];
    if (!player || !input.teams[input.userTeamId].playerIds.includes(id) || player.teamId !== input.userTeamId) throw new Error("PLAYER_NOT_OWNED");
    if (player.contract.status !== "STANDARD" || player.contract.yearsRemaining <= 0 || player.contract.contractType === "EMERGENCY") throw new Error("PLAYER_NOT_TRADEABLE");
  }
  validatePickRule(input, pickIds, input.userTeamId);
  return { playerIds, pickIds };
}

export function setTradeAssets(input: GameState, selection: TradeSelection): GameState {
  assertPhaseAllowed(input, "Set trade assets", TRADE_PHASES);
  if (!isTradeWindowOpen(input)) throw new Error("TRADE_PHASE_CLOSED");
  const { playerIds, pickIds } = validatedTradeSelection(input, selection, false);
  const state = structuredClone(input);
  state.tradeDesk = { selectedPlayerId: playerIds[0], selectedPlayerIds: playerIds, selectedPickIds: pickIds, offers: [] };
  return state;
}

function ownedPicksAfterTrade(state: GameState, trade: TradePackage, teamId: string): DraftPickAsset[] {
  const outgoing = new Set(teamId === trade.leftTeamId ? trade.leftPickIds : trade.rightPickIds);
  const incoming = new Set(teamId === trade.leftTeamId ? trade.rightPickIds : trade.leftPickIds);
  return Object.values(state.draftPicks).filter((pick) =>
    (pick.ownerTeamId === teamId && !outgoing.has(pick.id)) || incoming.has(pick.id));
}

/** Validates both teams against the same projected post-trade roster and draft ledger. */
export function validateTradePackage(state: GameState, trade: TradePackage): void {
  if (!isTradeWindowOpen(state)) throw new Error("TRADE_PHASE_CLOSED");
  if (!state.teams[trade.leftTeamId] || !state.teams[trade.rightTeamId] || trade.leftTeamId === trade.rightTeamId) throw new Error("TRADE_TEAM_INVALID");
  const leftAssets = [...trade.leftPlayerIds, ...trade.leftPickIds];
  const rightAssets = [...trade.rightPlayerIds, ...trade.rightPickIds];
  if (!leftAssets.length || !rightAssets.length) throw new Error("TRADE_ASSET_REQUIRED");
  if (hasDuplicate([...trade.leftPlayerIds, ...trade.rightPlayerIds])) throw new Error("DUPLICATE_PLAYER");
  if (hasDuplicate([...trade.leftPickIds, ...trade.rightPickIds])) throw new Error("DUPLICATE_DRAFT_PICK");
  for (const [teamId, ids] of [[trade.leftTeamId, trade.leftPlayerIds], [trade.rightTeamId, trade.rightPlayerIds]] as const) {
    const team = state.teams[teamId];
    for (const id of ids) {
      const player = state.players[id];
      if (!player || !team.playerIds.includes(id) || player.teamId !== teamId) throw new Error("PLAYER_NOT_OWNED");
      if (player.contract.status !== "STANDARD" || player.contract.yearsRemaining <= 0 || player.contract.contractType === "EMERGENCY") throw new Error("PLAYER_NOT_TRADEABLE");
    }
  }
  validatePickRule(state, trade.leftPickIds, trade.leftTeamId);
  validatePickRule(state, trade.rightPickIds, trade.rightTeamId);
  validateSalaryMatch(state, trade.leftTeamId, trade.leftPlayerIds, trade.rightPlayerIds);
  validateSalaryMatch(state, trade.rightTeamId, trade.rightPlayerIds, trade.leftPlayerIds);
  const rosterLimit = getRosterLimit(state.league.currentPhase);
  const leftSize = state.teams[trade.leftTeamId].playerIds.length - trade.leftPlayerIds.length + trade.rightPlayerIds.length;
  const rightSize = state.teams[trade.rightTeamId].playerIds.length - trade.rightPlayerIds.length + trade.leftPlayerIds.length;
  if (leftSize > rosterLimit || rightSize > rosterLimit) throw new Error("ROSTER_LIMIT_EXCEEDED");
  if (leftSize < 5 || rightSize < 5) throw new Error("ROSTER_BELOW_PLAYABLE_MINIMUM");
  if (["REGULAR_PRE_DEADLINE", "REGULAR_SEASON"].includes(state.league.currentPhase) && (leftSize < 12 || rightSize < 12)) {
    throw new Error("ROSTER_BELOW_NBA_MINIMUM");
  }
  if ([...trade.leftPickIds, ...trade.rightPickIds].some((id) => state.draftPicks[id].round === 1)) {
    const firstYear = firstTradablePickYear(state);
    const lastYear = state.league.seasonYear + BALANCE_CONFIG.trade.futurePickHorizonYears;
    for (const teamId of [trade.leftTeamId, trade.rightTeamId]) {
      const firstYears = new Set(ownedPicksAfterTrade(state, trade, teamId)
        .filter((pick) => pick.round === 1 && pick.year >= firstYear && pick.year <= lastYear)
        .map((pick) => pick.year));
      for (let year = firstYear; year < lastYear; year += 1) {
        if (!firstYears.has(year) && !firstYears.has(year + 1)) throw new Error("CONSECUTIVE_FIRST_ROUND_LIMIT");
      }
    }
  }
}

/** Applies a previously legal package to a mutable state. All fallible work precedes asset transfer. */
export function applyTradePackage(state: GameState, trade: TradePackage): void {
  validateTradePackage(state, trade);
  if (!trade.leftPlayerIds.length && !trade.rightPlayerIds.length) {
    for (const id of trade.leftPickIds) state.draftPicks[id].ownerTeamId = trade.rightTeamId;
    for (const id of trade.rightPickIds) state.draftPicks[id].ownerTeamId = trade.leftTeamId;
    return;
  }
  const left = state.teams[trade.leftTeamId];
  const right = state.teams[trade.rightTeamId];
  const leftRoster = left.playerIds.filter((id) => !trade.leftPlayerIds.includes(id)).concat(trade.rightPlayerIds);
  const rightRoster = right.playerIds.filter((id) => !trade.rightPlayerIds.includes(id)).concat(trade.leftPlayerIds);
  const leftPlayers = leftRoster.map((id) => structuredClone(state.players[id]));
  const rightPlayers = rightRoster.map((id) => structuredClone(state.players[id]));
  const leftReplacements = Object.fromEntries(trade.leftPlayerIds.map((id, index) => [id, trade.rightPlayerIds[index]]).filter((entry): entry is [string, string] => Boolean(entry[1])));
  const rightReplacements = Object.fromEntries(trade.rightPlayerIds.map((id, index) => [id, trade.leftPlayerIds[index]]).filter((entry): entry is [string, string] => Boolean(entry[1])));
  const leftPlan = reconcileRotationAfterRosterChange(leftPlayers, left.rotationPlan, leftReplacements);
  const rightPlan = reconcileRotationAfterRosterChange(rightPlayers, right.rotationPlan, rightReplacements);
  left.playerIds = leftRoster;
  right.playerIds = rightRoster;
  left.rotationPlan = leftPlan;
  right.rotationPlan = rightPlan;
  for (const player of leftPlayers) state.players[player.id].rotationRole = player.rotationRole;
  for (const player of rightPlayers) state.players[player.id].rotationRole = player.rotationRole;
  for (const id of trade.leftPlayerIds) { state.players[id].teamId = right.id; state.players[id].birdTeamId = right.id; }
  for (const id of trade.rightPlayerIds) { state.players[id].teamId = left.id; state.players[id].birdTeamId = left.id; }
  for (const id of trade.leftPickIds) state.draftPicks[id].ownerTeamId = right.id;
  for (const id of trade.rightPickIds) state.draftPicks[id].ownerTeamId = left.id;
}

function candidatePlayerBundles(players: Player[], maxSize: number): string[][] {
  const result: string[][] = [[]];
  const visit = (start: number, ids: string[]) => {
    if (ids.length) result.push(ids);
    if (ids.length >= maxSize) return;
    for (let index = start; index < players.length; index += 1) visit(index + 1, [...ids, players[index].id]);
  };
  visit(0, []);
  return result;
}

export function generateTradeOffers(input: GameState, selectionOrPlayerId: string | TradeSelection, refresh: boolean): GameState {
  assertPhaseAllowed(input, "Generate trade offers", TRADE_PHASES);
  if (!isTradeWindowOpen(input)) throw new Error("TRADE_PHASE_CLOSED");
  const proposedSelection = typeof selectionOrPlayerId === "string"
    ? { playerIds: [selectionOrPlayerId], pickIds: [] } : selectionOrPlayerId;
  const { playerIds, pickIds } = validatedTradeSelection(input, proposedSelection, true);
  const state = structuredClone(input);
  const pickValues = new Map<string, number>();
  const pickValue = (id: string): number => {
    const cached = pickValues.get(id);
    if (cached !== undefined) return cached;
    const value = tradeDraftPickValue(state, state.draftPicks[id]);
    pickValues.set(id, value);
    return value;
  };
  const inquiryKey = stableHash(playerIds, pickIds);
  if (refresh) state.tradeInquiryCount[inquiryKey] = (state.tradeInquiryCount[inquiryKey] ?? 0) + 1;
  const count = state.tradeInquiryCount[inquiryKey] ?? 0;
  const seed = stableHash(state.seeds.seasonSeed, "trade_offer", inquiryKey, count);
  const teams = Object.values(state.teams).filter((team) => team.id !== state.userTeamId)
    .sort((a, b) => stableHash(seed, a.id).localeCompare(stableHash(seed, b.id)));
  const offers: Array<{ offer: TradeOffer; score: number }> = [];
  const myRoster = state.teams[state.userTeamId].playerIds.map((id) => state.players[id]).filter(Boolean);
  const myFitBefore = calculateTeamFitForPlayers(myRoster).score;
  const outgoingPlayers = playerIds.map((id) => state.players[id]);
  const outgoingValue = outgoingPlayers.reduce((sum, player) => sum + publicPlayerValue(player), 0)
    + pickIds.reduce((sum, id) => sum + pickValue(id), 0);
  const outgoingSalary = outgoingPlayers.reduce((sum, player) => sum + player.contract.salary, 0);
  const penalty = BALANCE_CONFIG.trade.refreshPenaltyByInquiry[Math.min(count, BALANCE_CONFIG.trade.refreshPenaltyByInquiry.length - 1)];
  for (const team of teams) {
    const theirRoster = team.playerIds.map((id) => state.players[id]).filter(Boolean);
    const theirFitBefore = calculateTeamFitForPlayers(theirRoster).score;
    const candidates = theirRoster
      .filter((player) => player.contract.status === "STANDARD" && player.contract.yearsRemaining > 0 && player.contract.contractType !== "EMERGENCY")
      .sort((left, right) => Math.abs(left.contract.salary - outgoingSalary) - Math.abs(right.contract.salary - outgoingSalary)
        || Math.abs(publicPlayerValue(left) - outgoingValue) - Math.abs(publicPlayerValue(right) - outgoingValue)
        || left.id.localeCompare(right.id))
      .slice(0, Math.max(8, playerIds.length * 3));
    const possiblePicks = Object.values(state.draftPicks)
      .filter((pick) => pick.ownerTeamId === team.id && !pick.reservedByCommitmentId
        && pick.year >= firstTradablePickYear(state) && pick.year <= state.league.seasonYear + BALANCE_CONFIG.trade.futurePickHorizonYears)
      .sort((a, b) => a.year - b.year || a.id.localeCompare(b.id));
    const pickOptions = [undefined, ...possiblePicks.filter((pick) => pick.round === 1).slice(0, 2), ...possiblePicks.filter((pick) => pick.round === 2).slice(0, 2)];
    let best: { offer: TradeOffer; score: number } | null = null;
    const bundles = candidatePlayerBundles(candidates, Math.min(3, Math.max(1, playerIds.length + 1)));
    for (const incomingIds of bundles) {
      const incomingPlayers = incomingIds.map((id) => state.players[id]);
      const incomingValue = incomingPlayers.reduce((sum, player) => sum + publicPlayerValue(player), 0);
      for (const pick of pickOptions) {
        if (!incomingIds.length && !pick) continue;
        const incomingPickIds = pick ? [pick.id] : [];
        const valueGap = outgoingValue - incomingValue - (pick ? pickValue(pick.id) : 0);
        const minimumReturn = Math.max(-4, corePlayerTradePremium(incomingPlayers, outgoingPlayers)) + penalty;
        if (valueGap < minimumReturn || valueGap > Math.max(14, outgoingValue * 0.65)) continue;
        const trade: TradePackage = {
          leftTeamId: state.userTeamId, rightTeamId: team.id,
          leftPlayerIds: playerIds, rightPlayerIds: incomingIds,
          leftPickIds: pickIds, rightPickIds: incomingPickIds,
        };
        try { validateTradePackage(state, trade); } catch { continue; }
        const incomingSet = new Set(incomingIds);
        const theirFitDelta = calculateTeamFitForPlayers([
          ...theirRoster.filter((player) => !incomingSet.has(player.id)), ...outgoingPlayers,
        ]).score - theirFitBefore;
        if (theirFitDelta < -8) continue;
        const outgoingSet = new Set(playerIds);
        const myFitDelta = calculateTeamFitForPlayers([
          ...myRoster.filter((player) => !outgoingSet.has(player.id)), ...incomingPlayers,
        ]).score - myFitBefore;
        const offerId = stableHash(seed, team.id, incomingIds, incomingPickIds);
        const variety = low32FromHash(offerId) / 0xffffffff * 3;
        const score = -Math.abs(valueGap) + myFitDelta * 0.55 + theirFitDelta * 0.35 + variety;
        const offer: TradeOffer = {
          offerId, inquiryKey, inquiryCount: count, counterpartyTeamId: team.id,
          userOutgoingPlayerIds: playerIds, userOutgoingPickIds: pickIds,
          userIncomingPlayerIds: incomingIds, userIncomingPickIds: incomingPickIds, status: "AVAILABLE",
        };
        if (!best || score > best.score || (score === best.score && offer.offerId < best.offer.offerId)) best = { offer, score };
      }
    }
    if (best) offers.push(best);
  }
  if (!offers.length) throw new Error("NOT_ENOUGH_LEGAL_TRADE_OFFERS");
  offers.sort((a, b) => b.score - a.score || stableHash(seed, a.offer.offerId).localeCompare(stableHash(seed, b.offer.offerId)));
  state.tradeDesk = {
    selectedPlayerId: playerIds[0], selectedPlayerIds: playerIds, selectedPickIds: pickIds,
    offers: offers.slice(0, BALANCE_CONFIG.trade.generatedOfferCount).map(({ offer }) => offer),
  };
  return state;
}

export function acceptTradeOffer(input: GameState, offerId: string): GameState {
  assertPhaseAllowed(input, "Execute trade", TRADE_PHASES);
  const offer = input.tradeDesk.offers.find((entry) => entry.offerId === offerId && entry.status === "AVAILABLE");
  if (!offer) throw new Error("Trade offer is no longer available");
  const evaluation = evaluateTradeOffer(input, offerId);
  if (!evaluation.legal) throw new Error(evaluation.reason ?? "TRADE_OFFER_INVALID");
  const state = structuredClone(input);
  const committed = state.tradeDesk.offers.find((entry) => entry.offerId === offerId) as TradeOffer;
  applyTradePackage(state, {
    leftTeamId: state.userTeamId, rightTeamId: committed.counterpartyTeamId,
    leftPlayerIds: committed.userOutgoingPlayerIds, rightPlayerIds: committed.userIncomingPlayerIds,
    leftPickIds: committed.userOutgoingPickIds, rightPickIds: committed.userIncomingPickIds,
  });
  if (!state.gmCareer.tradeHistory.some((entry) => entry.offerId === committed.offerId)) {
    const pickName = (id: string) => {
      const pick = state.draftPicks[id];
      return `${pick.year}年${pick.round === 1 ? "首轮" : "次轮"}签（${state.teams[pick.originalTeamId]?.name ?? pick.originalTeamId}原签）`;
    };
    const outgoingNames = [...committed.userOutgoingPlayerIds.map((id) => state.players[id].name), ...committed.userOutgoingPickIds.map(pickName)].join("、") || "选秀权";
    const incomingNames = [...committed.userIncomingPlayerIds.map((id) => state.players[id].name), ...committed.userIncomingPickIds.map(pickName)].join("、") || "选秀权";
    state.gmCareer.tradeHistory.push({ seasonId: state.league.seasonId, offerId: committed.offerId, summary: `${outgoingNames} → ${incomingNames}` });
  }
  committed.status = "ACCEPTED";
  for (const entry of state.tradeDesk.offers) if (entry.offerId !== committed.offerId) entry.status = "REJECTED";
  return state;
}

export function evaluateTradeOffer(state: GameState, offerId: string): TradeOfferEvaluation {
  const offer = state.tradeDesk.offers.find((entry) => entry.offerId === offerId);
  const empty: TradeOfferEvaluation = {
    legal: false, reason: "交易方案不存在", outgoingSalary: 0, incomingSalary: 0, salaryDifference: 0,
    userFitBefore: 0, userFitAfter: 0, userFitDelta: 0, counterpartyFitBefore: 0, counterpartyFitAfter: 0,
    counterpartyFitDelta: 0, outgoingAssetValue: 0, incomingAssetValue: 0, userValueDelta: 0, gmWillingness: "拒绝",
  };
  if (!offer) return empty;
  const outgoing = offer.userOutgoingPlayerIds.map((id) => state.players[id]).filter(Boolean);
  const incoming = offer.userIncomingPlayerIds.map((id) => state.players[id]).filter(Boolean);
  const other = state.teams[offer.counterpartyTeamId];
  const mine = state.teams[state.userTeamId];
  const outgoingSalary = outgoing.reduce((sum, player) => sum + player.contract.salary, 0);
  const incomingSalary = incoming.reduce((sum, player) => sum + player.contract.salary, 0);
  const outgoingAssetValue = outgoing.reduce((sum, player) => sum + publicPlayerValue(player), 0)
    + offer.userOutgoingPickIds.reduce((sum, id) => sum + (state.draftPicks[id] ? tradeDraftPickValue(state, state.draftPicks[id]) : 0), 0);
  const incomingAssetValue = incoming.reduce((sum, player) => sum + publicPlayerValue(player), 0)
    + offer.userIncomingPickIds.reduce((sum, id) => sum + (state.draftPicks[id] ? tradeDraftPickValue(state, state.draftPicks[id]) : 0), 0);
  if (!mine || !other) return { ...empty, outgoingSalary, incomingSalary, salaryDifference: Math.abs(outgoingSalary - incomingSalary), reason: "交易球队不存在" };
  if (outgoing.length !== offer.userOutgoingPlayerIds.length || incoming.length !== offer.userIncomingPlayerIds.length) return { ...empty, outgoingSalary, incomingSalary, reason: "球员资产已发生变化" };
  const userBefore = calculateTeamFitForPlayers(mine.playerIds.map((id) => state.players[id]).filter(Boolean));
  const otherBefore = calculateTeamFitForPlayers(other.playerIds.map((id) => state.players[id]).filter(Boolean));
  const userAfter = calculateTeamFitForPlayers([
    ...mine.playerIds.filter((id) => !offer.userOutgoingPlayerIds.includes(id)).map((id) => state.players[id]).filter(Boolean),
    ...incoming,
  ]);
  const otherAfter = calculateTeamFitForPlayers([
    ...other.playerIds.filter((id) => !offer.userIncomingPlayerIds.includes(id)).map((id) => state.players[id]).filter(Boolean),
    ...outgoing,
  ]);
  const result = (legal: boolean, reason?: string): TradeOfferEvaluation => {
    const counterpartyFitDelta = otherAfter.score - otherBefore.score;
    return {
      legal, reason, outgoingSalary, incomingSalary, salaryDifference: Math.abs(outgoingSalary - incomingSalary),
      userFitBefore: userBefore.score, userFitAfter: userAfter.score, userFitDelta: userAfter.score - userBefore.score,
      counterpartyFitBefore: otherBefore.score, counterpartyFitAfter: otherAfter.score, counterpartyFitDelta,
      outgoingAssetValue, incomingAssetValue, userValueDelta: incomingAssetValue - outgoingAssetValue,
      gmWillingness: !legal ? "拒绝" : outgoingAssetValue - incomingAssetValue >= 5 && counterpartyFitDelta >= 1 ? "极高"
        : outgoingAssetValue >= incomingAssetValue || counterpartyFitDelta >= 0 ? "较高" : "一般",
    };
  };
  if (!isTradeWindowOpen(state)) return result(false, "当前阶段不开放交易");
  if (offer.status !== "AVAILABLE") return result(false, "交易方案已失效");
  try {
    if (new Set(offer.userOutgoingPlayerIds).size !== offer.userOutgoingPlayerIds.length || new Set(offer.userIncomingPlayerIds).size !== offer.userIncomingPlayerIds.length) throw new Error("交易球员重复");
    for (const player of [...outgoing, ...incoming]) if (player.contract.contractType === "EMERGENCY") throw new Error("临时合同不可交易");
    if (!outgoing.every((player) => mine.playerIds.includes(player.id))) throw new Error("我方资产已发生变化");
    if (!incoming.every((player) => other.playerIds.includes(player.id))) throw new Error("对方资产已发生变化");
    validateTradePackage(state, {
      leftTeamId: mine.id, rightTeamId: other.id,
      leftPlayerIds: offer.userOutgoingPlayerIds, rightPlayerIds: offer.userIncomingPlayerIds,
      leftPickIds: offer.userOutgoingPickIds, rightPickIds: offer.userIncomingPickIds,
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const reason = ({
      SECOND_APRON_SALARY_MATCH_FAILED: "第二土豪线球队的薪资配平未通过",
      FIRST_APRON_SALARY_MATCH_FAILED: "第一土豪线球队的薪资配平未通过",
      SALARY_MATCH_FAILED: "交易双方的薪资未配平",
      DRAFT_PICK_NOT_OWNED: "选秀权归属已变化",
      DRAFT_PICK_RESERVED: "选秀权已被其他承诺占用",
      DRAFT_PICK_OUTSIDE_SEVEN_YEAR_WINDOW: "选秀权不在未来七届可交易范围内",
      CONSECUTIVE_FIRST_ROUND_LIMIT: "交易后将连续两年没有首轮签",
      ROSTER_LIMIT_EXCEEDED: "交易后名单人数超过上限",
      ROSTER_BELOW_PLAYABLE_MINIMUM: "交易后名单少于可比赛的五人",
      ROSTER_BELOW_NBA_MINIMUM: "交易后常规赛名单不能少于 12 人",
      PLAYER_NOT_OWNED: "球员归属已变化",
      PLAYER_NOT_TRADEABLE: "球员合同当前不可交易",
    } as Record<string, string>)[code] ?? (code || "交易校验失败");
    return result(false, reason);
  }
  const premium = corePlayerTradePremium(incoming, outgoing);
  if (premium > 0 && outgoingAssetValue - incomingAssetValue < premium) {
    return result(false, "对方核心球员换成较低评分球员，需要更高价值的回报");
  }
  return result(true);
}

export function executeTradeCommand(state: GameState, command: TradeCommand): GameState {
  const payloadHash = stableHash(command.type, command.payload);
  const receipt = state.commandReceipts[command.commandId];
  if (receipt) { if (receipt.payloadHash !== payloadHash) throw new Error("Command ID 已被不同 Payload 使用"); return state; }
  const next = command.type === "SET_TRADE_ASSETS"
    ? setTradeAssets(state, command.payload)
    : command.type === "GENERATE_TRADE_OFFERS"
      ? generateTradeOffers(state, "playerId" in command.payload ? command.payload.playerId : command.payload, command.payload.refresh)
      : acceptTradeOffer(state, command.payload.offerId);
  next.commandReceipts[command.commandId] = { payloadHash };
  return next;
}
