import type { GameState, Player, TradeOffer } from "../game/state/types";

export const TRADE_ASSET_POSITIONS = ["ALL", "PG", "SG", "SF", "PF", "C"] as const;
export type TradeAssetPosition = typeof TRADE_ASSET_POSITIONS[number];

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

export function tradeInquiryCommandId(state: GameState, playerId: string): string {
  return `trade-query-${state.league.seasonId}-${playerId}-${Object.keys(state.commandReceipts).length}`;
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
