import { BALANCE_CONFIG } from "../../config/balanceConfig";
import { publicPlayerValue, tradeDraftPickValue } from "../ai/AIValueService";
import { assertPhaseAllowed, getRosterLimit } from "../policy/TransactionPolicyService";
import { low32FromHash, stableHash } from "../random/hash";
import type { GameState, TradeOffer } from "../state/types";
import { calculateTeamFitForPlayers } from "../team/TeamFitService";
import { validateSalaryMatch } from "./SalaryMatchValidator";
import { reconcileRotationAfterRosterChange } from "../roster/RotationPlanService";

export type TradeCommand =
  | { commandId: string; type: "GENERATE_TRADE_OFFERS"; payload: { playerId: string; refresh: boolean } }
  | { commandId: string; type: "ACCEPT_TRADE_OFFER"; payload: { offerId: string } };

export const TRADE_PHASES = ["OFFSEASON_PRE_DRAFT", "OFFSEASON_POST_DRAFT", "PRESEASON", "REGULAR_PRE_DEADLINE"] as const;
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

function validatePickRule(state: GameState, movingPickIds: string[], fromTeamId: string): void {
  const moving = new Set(movingPickIds);
  if (moving.size !== movingPickIds.length) throw new Error("DUPLICATE_DRAFT_PICK");
  for (const pickId of moving) {
    const pick = state.draftPicks[pickId];
    if (pick?.ownerTeamId !== fromTeamId) throw new Error("DRAFT_PICK_NOT_OWNED");
    if (pick.reservedByCommitmentId) throw new Error("DRAFT_PICK_RESERVED");
  }
  const years = Array.from({ length: BALANCE_CONFIG.trade.futurePickHorizonYears }, (_, i) => state.league.seasonYear + 1 + i);
  for (let i = 0; i < years.length - 1; i += 1) {
    const count = (year: number) => Object.values(state.draftPicks).filter((pick) => pick.year === year && pick.round === 1 && pick.ownerTeamId === fromTeamId && !moving.has(pick.id)).length;
    if (count(years[i]) === 0 && count(years[i + 1]) === 0) throw new Error("CONSECUTIVE_FIRST_ROUND_LIMIT");
  }
}

export function generateTradeOffers(input: GameState, playerId: string, refresh: boolean): GameState {
  assertPhaseAllowed(input, "Generate trade offers", TRADE_PHASES);
  if (!input.teams[input.userTeamId].playerIds.includes(playerId)) throw new Error("Player is not on the user roster");
  if (input.players[playerId].contract.contractType === "EMERGENCY") throw new Error("EMERGENCY_CONTRACT_NOT_TRADEABLE");
  const state = structuredClone(input);
  const inquiryKey = stableHash([playerId].sort(), []);
  if (refresh) state.tradeInquiryCount[inquiryKey] = (state.tradeInquiryCount[inquiryKey] ?? 0) + 1;
  const count = state.tradeInquiryCount[inquiryKey] ?? 0;
  const seed = stableHash(state.seeds.seasonSeed, "trade_offer", inquiryKey, count);
  const outgoing = state.players[playerId];
  const teams = Object.values(state.teams).filter((team) => team.id !== state.userTeamId)
    .sort((a, b) => stableHash(seed, a.id).localeCompare(stableHash(seed, b.id)));
  const offers: Array<{ offer: TradeOffer; score: number }> = [];
  const outgoingValue = publicPlayerValue(outgoing);
  const myRoster = state.teams[state.userTeamId].playerIds.map((id) => state.players[id]).filter(Boolean);
  const myFitBefore = calculateTeamFitForPlayers(myRoster).score;
  const penalty = BALANCE_CONFIG.trade.refreshPenaltyByInquiry[Math.min(count, BALANCE_CONFIG.trade.refreshPenaltyByInquiry.length - 1)];
  for (const team of teams) {
    const theirRoster = team.playerIds.map((id) => state.players[id]).filter(Boolean);
    const theirFitBefore = calculateTeamFitForPlayers(theirRoster).score;
    const secondRoundPick = Object.values(state.draftPicks)
      .filter((pick) => pick.ownerTeamId === team.id && pick.round === 2 && !pick.reservedByCommitmentId)
      .sort((a, b) => a.year - b.year || a.id.localeCompare(b.id))[0];
    const pickValue = secondRoundPick ? tradeDraftPickValue(state, secondRoundPick) : 0;
    const candidates = theirRoster.filter((player) => player.contract.status === "STANDARD" && player.contract.contractType !== "EMERGENCY");
    let best: { offer: TradeOffer; score: number } | null = null;
    for (const candidate of candidates) {
      try {
        validateSalaryMatch(state, state.userTeamId, [playerId], [candidate.id]);
        validateSalaryMatch(state, team.id, [candidate.id], [playerId]);
      } catch { continue; }
      const candidateValue = publicPlayerValue(candidate);
      const includePick = Boolean(secondRoundPick && outgoingValue - candidateValue > pickValue + penalty);
      const effectivePickValue = includePick ? pickValue : 0;
      const valueGap = outgoingValue - candidateValue - effectivePickValue;
      const theirFitDelta = calculateTeamFitForPlayers([...theirRoster.filter((player) => player.id !== candidate.id), outgoing]).score - theirFitBefore;
      // A counterparty will not offer a materially stronger asset for a worse roster fit.
      if (valueGap < -4 + penalty || theirFitDelta < -8) continue;
      const myFitDelta = calculateTeamFitForPlayers([...myRoster.filter((player) => player.id !== playerId), candidate]).score - myFitBefore;
      const variety = low32FromHash(stableHash(seed, team.id, candidate.id)) / 0xffffffff * 3;
      const score = -Math.abs(valueGap) + myFitDelta * 0.55 + theirFitDelta * 0.35 + (includePick ? 1 : 0) + variety;
      const offer: TradeOffer = {
        offerId: stableHash(seed, team.id, candidate.id), inquiryKey, inquiryCount: count,
        counterpartyTeamId: team.id, userOutgoingPlayerIds: [playerId], userOutgoingPickIds: [],
        userIncomingPlayerIds: [candidate.id], userIncomingPickIds: includePick && secondRoundPick ? [secondRoundPick.id] : [], status: "AVAILABLE",
      };
      if (!best || score > best.score || (score === best.score && offer.offerId < best.offer.offerId)) best = { offer, score };
    }
    if (best) offers.push(best);
  }
  if (!offers.length) throw new Error("NOT_ENOUGH_LEGAL_TRADE_OFFERS");
  offers.sort((a, b) => b.score - a.score || stableHash(seed, a.offer.offerId).localeCompare(stableHash(seed, b.offer.offerId)));
  state.tradeDesk = { selectedPlayerId: playerId, offers: offers.slice(0, BALANCE_CONFIG.trade.generatedOfferCount).map(({ offer }) => offer) };
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
  const other = state.teams[committed.counterpartyTeamId];
  const mine = state.teams[state.userTeamId];
  for (const id of [...committed.userOutgoingPlayerIds, ...committed.userIncomingPlayerIds]) {
    if (state.players[id].contract.contractType === "EMERGENCY") throw new Error("EMERGENCY_CONTRACT_NOT_TRADEABLE");
  }
  for (const id of committed.userOutgoingPlayerIds) if (!mine.playerIds.includes(id)) throw new Error("OUTGOING_ASSET_NOT_OWNED");
  for (const id of committed.userIncomingPlayerIds) if (!other.playerIds.includes(id)) throw new Error("INCOMING_ASSET_NOT_OWNED");
  validateSalaryMatch(state, mine.id, committed.userOutgoingPlayerIds, committed.userIncomingPlayerIds);
  validateSalaryMatch(state, other.id, committed.userIncomingPlayerIds, committed.userOutgoingPlayerIds);
  validatePickRule(state, committed.userOutgoingPickIds, mine.id);
  validatePickRule(state, committed.userIncomingPickIds, other.id);
  const mineSize = mine.playerIds.length - committed.userOutgoingPlayerIds.length + committed.userIncomingPlayerIds.length;
  const otherSize = other.playerIds.length - committed.userIncomingPlayerIds.length + committed.userOutgoingPlayerIds.length;
  if (mineSize > getRosterLimit(state.league.currentPhase) || otherSize > getRosterLimit(state.league.currentPhase)) throw new Error("ROSTER_LIMIT_EXCEEDED");
  mine.playerIds = mine.playerIds.filter((id) => !committed.userOutgoingPlayerIds.includes(id)).concat(committed.userIncomingPlayerIds);
  other.playerIds = other.playerIds.filter((id) => !committed.userIncomingPlayerIds.includes(id)).concat(committed.userOutgoingPlayerIds);
  for (const id of committed.userOutgoingPlayerIds) { state.players[id].teamId = other.id; state.players[id].birdTeamId = other.id; }
  for (const id of committed.userIncomingPlayerIds) { state.players[id].teamId = mine.id; state.players[id].birdTeamId = mine.id; }
  const mineReplacements = Object.fromEntries(committed.userOutgoingPlayerIds.map((id, index) => [id, committed.userIncomingPlayerIds[index]]).filter((entry): entry is [string, string] => Boolean(entry[1])));
  const otherReplacements = Object.fromEntries(committed.userIncomingPlayerIds.map((id, index) => [id, committed.userOutgoingPlayerIds[index]]).filter((entry): entry is [string, string] => Boolean(entry[1])));
  mine.rotationPlan = reconcileRotationAfterRosterChange(mine.playerIds.map((id) => state.players[id]).filter(Boolean), mine.rotationPlan, mineReplacements);
  other.rotationPlan = reconcileRotationAfterRosterChange(other.playerIds.map((id) => state.players[id]).filter(Boolean), other.rotationPlan, otherReplacements);
  for (const id of committed.userOutgoingPickIds) state.draftPicks[id].ownerTeamId = other.id;
  for (const id of committed.userIncomingPickIds) state.draftPicks[id].ownerTeamId = mine.id;
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
  if (!isTradePhaseAllowed(state.league.currentPhase)) return result(false, "当前阶段不开放交易");
  if (offer.status !== "AVAILABLE") return result(false, "交易方案已失效");
  try {
    if (new Set(offer.userOutgoingPlayerIds).size !== offer.userOutgoingPlayerIds.length || new Set(offer.userIncomingPlayerIds).size !== offer.userIncomingPlayerIds.length) throw new Error("交易球员重复");
    for (const player of [...outgoing, ...incoming]) if (player.contract.contractType === "EMERGENCY") throw new Error("临时合同不可交易");
    if (!outgoing.every((player) => mine.playerIds.includes(player.id))) throw new Error("我方资产已发生变化");
    if (!incoming.every((player) => other.playerIds.includes(player.id))) throw new Error("对方资产已发生变化");
    validateSalaryMatch(state, mine.id, offer.userOutgoingPlayerIds, offer.userIncomingPlayerIds);
    validateSalaryMatch(state, other.id, offer.userIncomingPlayerIds, offer.userOutgoingPlayerIds);
    validatePickRule(state, offer.userOutgoingPickIds, mine.id);
    validatePickRule(state, offer.userIncomingPickIds, other.id);
    const mineSize = mine.playerIds.length - offer.userOutgoingPlayerIds.length + offer.userIncomingPlayerIds.length;
    const otherSize = other.playerIds.length - offer.userIncomingPlayerIds.length + offer.userOutgoingPlayerIds.length;
    if (mineSize > getRosterLimit(state.league.currentPhase) || otherSize > getRosterLimit(state.league.currentPhase)) throw new Error("名单人数超过阶段上限");
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const reason = ({
      SECOND_APRON_SALARY_MATCH_FAILED: "第二土豪线球队的薪资配平未通过",
      FIRST_APRON_SALARY_MATCH_FAILED: "第一土豪线球队的薪资配平未通过",
      SALARY_MATCH_FAILED: "交易双方的薪资未配平",
      DRAFT_PICK_NOT_OWNED: "选秀权归属已变化",
      DRAFT_PICK_RESERVED: "选秀权已被其他承诺占用",
      CONSECUTIVE_FIRST_ROUND_LIMIT: "交易后将连续两年没有首轮签",
      ROSTER_LIMIT_EXCEEDED: "交易后名单人数超过上限",
    } as Record<string, string>)[code] ?? (code || "交易校验失败");
    return result(false, reason);
  }
  return result(true);
}

export function executeTradeCommand(state: GameState, command: TradeCommand): GameState {
  const payloadHash = stableHash(command.type, command.payload);
  const receipt = state.commandReceipts[command.commandId];
  if (receipt) { if (receipt.payloadHash !== payloadHash) throw new Error("Command ID 已被不同 Payload 使用"); return state; }
  const next = command.type === "GENERATE_TRADE_OFFERS" ? generateTradeOffers(state, command.payload.playerId, command.payload.refresh) : acceptTradeOffer(state, command.payload.offerId);
  next.commandReceipts[command.commandId] = { payloadHash };
  return next;
}
