import { describe, expect, it } from "vitest";
import { NBA_PLAYER_DATASET } from "./nbaPlayerDataset";
import { RETIRED_LEGEND_IDS, RETIRED_LEGEND_NAMES_ZH, RETIRED_LEGEND_TEMPLATES } from "./retiredLegendTemplates";

describe("retired legend templates", () => {
  it("contains 90 unique retired identities for 30 three-player drafts", () => {
    expect(RETIRED_LEGEND_TEMPLATES).toHaveLength(90);
    expect(new Set(RETIRED_LEGEND_IDS).size).toBe(90);
    expect(new Set(RETIRED_LEGEND_TEMPLATES.map((template) => template.sourceName)).size).toBe(90);
    expect(RETIRED_LEGEND_TEMPLATES.map((template) => template.sourcePlayerId)).toEqual(RETIRED_LEGEND_IDS);
    expect(RETIRED_LEGEND_IDS).not.toContain("nba:202681"); // Kyrie Irving is active.
    expect(RETIRED_LEGEND_TEMPLATES.every((template) => template.eligible)).toBe(true);
    expect(RETIRED_LEGEND_TEMPLATES.every((template) => RETIRED_LEGEND_NAMES_ZH[template.sourceName.toLowerCase()])).toBe(true);
  });

  it("preserves measured bundled templates and marks newly derived profiles as curated", () => {
    const bundledById = new Map(NBA_PLAYER_DATASET.historicalTemplates.map((template) => [template.sourcePlayerId, template]));
    const reused = RETIRED_LEGEND_TEMPLATES.filter((template) => bundledById.has(template.sourcePlayerId));
    const derived = RETIRED_LEGEND_TEMPLATES.filter((template) => !bundledById.has(template.sourcePlayerId));
    expect(reused).toHaveLength(14);
    expect(derived).toHaveLength(76);
    for (const template of reused) {
      expect(template).toMatchObject({
        ...bundledById.get(template.sourcePlayerId),
        position: template.position,
      });
    }
    expect(RETIRED_LEGEND_TEMPLATES.find((template) => template.sourceName === "Ben Wallace")?.position).toBe("C");
    expect(RETIRED_LEGEND_TEMPLATES.find((template) => template.sourceName === "Dwyane Wade")?.position).toBe("SG");
    for (const template of derived) {
      expect(template.sourceSeason).toBe("CURATED");
      expect(template.peakSeason).toBe("CURATED");
      expect(template.era).toBe("LEGEND");
      expect(Object.values(template.rookieAttributes).every((value) => Number.isInteger(value) && value >= 25 && value <= 99)).toBe(true);
    }
  });
});
