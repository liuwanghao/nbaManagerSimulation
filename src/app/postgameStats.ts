import type { PlayerBoxScore } from "../game/state/types";

export const POSTGAME_HIGHLIGHT_STATS = ["pts", "reb", "ast", "stl", "blk"] as const;
export type PostgameHighlightStat = typeof POSTGAME_HIGHLIGHT_STATS[number];

export function sortPostgameBoxRows(stats: readonly PlayerBoxScore[]): PlayerBoxScore[] {
  return [...stats].sort((left, right) => right.seconds - left.seconds || right.pts - left.pts || left.playerId.localeCompare(right.playerId));
}

export function postgameStatLeaders(stats: readonly PlayerBoxScore[]): Record<PostgameHighlightStat, string | undefined> {
  const rows = sortPostgameBoxRows(stats);
  const leaders = {} as Record<PostgameHighlightStat, string | undefined>;
  for (const category of POSTGAME_HIGHLIGHT_STATS) {
    leaders[category] = rows.reduce<PlayerBoxScore | undefined>((best, row) => !best || row[category] > best[category] ? row : best, undefined)?.playerId;
  }
  return leaders;
}
