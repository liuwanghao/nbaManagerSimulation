import type { GameState, Player, TradeOffer } from "../game/state/types";
import { calculatePlayerOverall } from "../game/player/PlayerRatingService";

export const TRADE_ASSET_POSITIONS = ["ALL", "PG", "SG", "SF", "PF", "C"] as const;
export type TradeAssetPosition = typeof TRADE_ASSET_POSITIONS[number];

export function tradeOfferPortraitPlayer(state: GameState, offer: TradeOffer, mode: "ASSET" | "TARGET"): Player | undefined {
  if (mode === "ASSET") return state.players[offer.userIncomingPlayerIds[0]];
  return offer.userOutgoingPlayerIds.reduce<Player | undefined>((best, id) => {
    const player = state.players[id];
    if (!player || player.teamId !== state.userTeamId || !state.teams[state.userTeamId]?.playerIds.includes(id)) return best;
    if (!best) return player;
    const overallDifference = calculatePlayerOverall(player) - calculatePlayerOverall(best);
    return overallDifference > 0 || (overallDifference === 0 && player.id < best.id) ? player : best;
  }, undefined);
}

export function tradeAssetPositionCounts(roster: Player[]): Record<TradeAssetPosition, number> {
  return {
    ALL: roster.length,
    PG: roster.filter((player) => player.position === "PG").length,
    SG: roster.filter((player) => player.position === "SG").length,
    SF: roster.filter((player) => player.position === "SF").length,
    PF: roster.filter((player) => player.position === "PF").length,
    C: roster.filter((player) => player.position === "C").length,
  };
}

export function tradeInquiryCommandId(state: GameState, playerIdOrIds: string | string[], pickIds: string[] = []): string {
  const playerIds = typeof playerIdOrIds === "string" ? [playerIdOrIds] : playerIdOrIds;
  const assetKey = [...playerIds.map((id) => `p:${id}`), ...pickIds.map((id) => `d:${id}`)].sort().join("-");
  return `trade-query-${state.league.seasonId}-${assetKey}-${Object.keys(state.commandReceipts).length}`;
}

export function targetedTradeInquiryCommandId(state: GameState, targetPlayerIds: string[]): string {
  return `trade-target-${state.league.seasonId}-${[...targetPlayerIds].sort().join("-")}-${Object.keys(state.commandReceipts).length}`;
}

export function tradeSelectionCommandId(state: GameState, playerIds: string[], pickIds: string[]): string {
  const assetKey = [...playerIds.map((id) => `p:${id}`), ...pickIds.map((id) => `d:${id}`)].sort().join("-") || "none";
  return `trade-select-${state.league.seasonId}-${assetKey}-${Object.keys(state.commandReceipts).length}`;
}

export function tradePickLabel(state: GameState, pickId: string): string {
  const pick = state.draftPicks[pickId];
  if (!pick) return `选秀权 ${pickId}`;
  const originalTeam = state.teams[pick.originalTeamId]?.name ?? pick.originalTeamId;
  return `${pick.year} 年${pick.round === 1 ? "首轮" : "次轮"} · ${originalTeam}原签`;
}

export function tradeOfferStatusLabel(offer: TradeOffer): string {
  return offer.status === "AVAILABLE" ? "可接受" : offer.status === "ACCEPTED" ? "已接受" : "已失效";
}
