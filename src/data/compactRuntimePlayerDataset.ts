import type { NbaPlayerDataset } from "./nbaPlayerDataset.ts";

export function compactRuntimePlayerDataset(dataset: NbaPlayerDataset): NbaPlayerDataset {
  return {
    ...dataset,
    players: dataset.players.map((player) => ({
      ...player,
      stats: {
        base: {
          FGA: player.stats.base?.FGA,
          FG3A: player.stats.base?.FG3A,
        },
        advanced: { USG_PCT: player.stats.advanced?.USG_PCT },
      },
    })),
  };
}
