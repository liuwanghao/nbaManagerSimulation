import { describe, expect, it } from "vitest";
import { createExpansionCareerFromBundledDataset } from "../../data/hupuRoster";
import { hasOpeningMipBaselines, seedOpeningMipBaselines } from "./OpeningMipBaseline";

describe("opening MIP baseline", () => {
  it("creates exactly 30 deterministic synthetic baselines once", () => {
    const first = createExpansionCareerFromBundledDataset("opening-mip-candidates");
    const second = createExpansionCareerFromBundledDataset("opening-mip-candidates");
    const baselines = (state: typeof first) => Object.values(state.players)
      .filter((player) => player.career?.lastSeasonStatsSource === "SYNTHETIC_OPENING")
      .map((player) => [player.id, player.career?.lastSeasonStats]);
    expect(hasOpeningMipBaselines(first)).toBe(true);
    expect(baselines(first)).toHaveLength(30);
    expect(baselines(first)).toEqual(baselines(second));
    seedOpeningMipBaselines(first);
    expect(baselines(first)).toEqual(baselines(second));
  });
});
