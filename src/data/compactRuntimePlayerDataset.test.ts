import { describe, expect, it } from "vitest";
import { compactRuntimePlayerDataset } from "./compactRuntimePlayerDataset";
import { NBA_PLAYER_DATASET } from "./nbaPlayerDataset";

describe("runtime NBA player dataset", () => {
  it("keeps every game input while removing unused source statistics", () => {
    const full = NBA_PLAYER_DATASET;
    const runtime = compactRuntimePlayerDataset(full);
    expect(runtime).not.toBe(full);
    expect(runtime.players).toHaveLength(full.players.length);
    expect(runtime.historicalTemplates).toEqual(full.historicalTemplates);

    for (let index = 0; index < full.players.length; index += 1) {
      const { stats: fullStats, ...fullPlayer } = full.players[index];
      const { stats: runtimeStats, ...runtimePlayer } = runtime.players[index];
      expect(runtimePlayer).toEqual(fullPlayer);
      expect(runtimeStats.base?.FGA).toBe(fullStats.base?.FGA);
      expect(runtimeStats.base?.FG3A).toBe(fullStats.base?.FG3A);
      expect(runtimeStats.advanced?.USG_PCT).toBe(fullStats.advanced?.USG_PCT);
      expect(Object.keys(runtimeStats)).toEqual(["base", "advanced"]);
      expect(Object.keys(runtimeStats.base)).toEqual(["FGA", "FG3A"]);
      expect(Object.keys(runtimeStats.advanced)).toEqual(["USG_PCT"]);
    }

    expect(Object.keys(full.players[0].stats.base).length).toBeGreaterThan(3);
  });
});
