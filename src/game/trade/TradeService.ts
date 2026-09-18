import { BALANCE_CONFIG } from "../../config/balanceConfig";
import { publicDraftPickValue, publicPlayerValue } from "../ai/AIValueService";
import { assertPhaseAllowed, getRosterLimit } from "../policy/TransactionPolicyService";
import { stableHash } from "../random/hash";
import type { GameState, TradeOffer } from "../state/types";
import { validateSalaryMatch } from "./SalaryMatchValidator";

export type TradeCommand =
  | { commandId: string; type: "GENERATE_TRADE_OFFERS"; payload: { playerId: string; refresh: boolean } }
  | { commandId: string; type: "ACCEPT_TRADE_OFFER"; payload: { offerId: string } };

const phases = ["OFFSEASON_PRE_DRAFT", "OFFSEASON_POST_DRAFT", "PRESEASON", "REGULAR_PRE_DEADLINE"] as const;

function validatePickRule(state: GameState, movingPickIds: string[], fromTeamId: string): void {
  const moving = new Set(movingPickIds);
  for (const pickId of moving) if (state.draftPicks[pickId]?.ownerTeamId !== fromTeamId) throw new Error("DRAFT_PICK_NOT_OWNED");
  const years = Array.from({ length: BALANCE_CONFIG.trade.futurePickHorizonYears }, (_, i) => state.league.seasonYear + 1 + i);
  for (let i = 0; i < years.length - 1; i += 1) {
    const count = (year: number) => Object.values(state.draftPicks).filter((pick) => pick.year === year && pick.round === 1 && pick.ownerTeamId === fromTeamId && !moving.has(pick.id)).length;
    if (count(years[i]) === 0 && count(years[i + 1]) === 0) throw new Error("CONSECUTIVE_FIRST_ROUND_LIMIT");
  }
}

export function generateTradeOffers(input: GameState, playerId: string, refresh: boolean): GameState {
  assertPhaseAllowed(input, "Generate trade offers", phases);
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
  const offers: TradeOffer[] = [];
  for (const team of teams) {
    const candidate = team.playerIds.map((id) => state.players[id]).filter((player) => player?.contract.status === "STANDARD" && player.contract.contractType !== "EMERGENCY")
      .sort((a, b) => Math.abs(publicPlayerValue(a) - publicPlayerValue(outgoing)) - Math.abs(publicPlayerValue(b) - publicPlayerValue(outgoing)) || a.id.localeCompare(b.id))[0];
    if (!candidate) continue;
    try {
      validateSalaryMatch(state, state.userTeamId, [playerId], [candidate.id]);
      validateSalaryMatch(state, team.id, [candidate.id], [playerId]);
    } catch { continue; }
    const penalties = BALANCE_CONFIG.trade.refreshPenaltyByInquiry;
    const penalty = penalties[Math.min(count, penalties.length - 1)];
    const incomingPicks: string[] = [];
    const pick = Object.values(state.draftPicks).find((asset) => asset.ownerTeamId === team.id && asset.round === 2);
    const pickValue = pick ? publicDraftPickValue(pick, state.league.seasonYear) : BALANCE_CONFIG.trade.addSecondRoundPickValueGap;
    if (pick && publicPlayerValue(outgoing) - publicPlayerValue(candidate) > pickValue + penalty) incomingPicks.push(pick.id);
    offers.push({
      offerId: stableHash(seed, team.id, candidate.id), inquiryKey, inquiryCount: count,
      counterpartyTeamId: team.id, userOutgoingPlayerIds: [playerId], userOutgoingPickIds: [],
      userIncomingPlayerIds: [candidate.id], userIncomingPickIds: incomingPicks, status: "AVAILABLE",
    });
    if (offers.length === BALANCE_CONFIG.trade.generatedOfferCount) break;
  }
  if (offers.length < BALANCE_CONFIG.trade.generatedOfferCount) throw new Error("NOT_ENOUGH_LEGAL_TRADE_OFFERS");
  state.tradeDesk = { selectedPlayerId: playerId, offers };
  return state;
}

export function acceptTradeOffer(input: GameState, offerId: string): GameState {
  assertPhaseAllowed(input, "Execute trade", phases);
  const offer = input.tradeDesk.offers.find((entry) => entry.offerId === offerId && entry.status === "AVAILABLE");
  if (!offer) throw new Error("Trade offer is no longer available");
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
  for (const id of committed.userOutgoingPickIds) state.draftPicks[id].ownerTeamId = other.id;
  for (const id of committed.userIncomingPickIds) state.draftPicks[id].ownerTeamId = mine.id;
  if (!state.gmCareer.tradeHistory.some((entry) => entry.offerId === committed.offerId)) {
    const outgoingNames = committed.userOutgoingPlayerIds.map((id) => state.players[id].name).join("、") || "选秀权";
    const incomingNames = committed.userIncomingPlayerIds.map((id) => state.players[id].name).join("、") || "选秀权";
    state.gmCareer.tradeHistory.push({ seasonId: state.league.seasonId, offerId: committed.offerId, summary: `${outgoingNames} → ${incomingNames}` });
  }
  committed.status = "ACCEPTED";
  for (const entry of state.tradeDesk.offers) if (entry.offerId !== committed.offerId) entry.status = "REJECTED";
  return state;
}

export function executeTradeCommand(state: GameState, command: TradeCommand): GameState {
  const payloadHash = stableHash(command.type, command.payload);
  const receipt = state.commandReceipts[command.commandId];
  if (receipt) { if (receipt.payloadHash !== payloadHash) throw new Error("Command ID 已被不同 Payload 使用"); return state; }
  const next = command.type === "GENERATE_TRADE_OFFERS" ? generateTradeOffers(state, command.payload.playerId, command.payload.refresh) : acceptTradeOffer(state, command.payload.offerId);
  next.commandReceipts[command.commandId] = { payloadHash };
  return next;
}
