import { describe, expect, it } from "vitest";
import { NBA_PLAYER_DATASET } from "./nbaPlayerDataset";
import retiredLegend2kRatings from "./retiredLegend2kRatings.json";
import retiredLegendDesignRatings from "./retiredLegendDesignRatings.json";
import { calculateAttributeOverall } from "../game/player/PlayerRatingService";
import { RETIRED_LEGEND_IDS, RETIRED_LEGEND_NAMES_ZH, RETIRED_LEGEND_TEMPLATES } from "./retiredLegendTemplates";

describe("retired legend templates", () => {
  it("contains 90 unique retired identities for 30 draft classes", () => {
    expect(RETIRED_LEGEND_TEMPLATES).toHaveLength(90);
    expect(new Set(RETIRED_LEGEND_IDS).size).toBe(90);
    expect(new Set(RETIRED_LEGEND_TEMPLATES.map((template) => template.sourceName)).size).toBe(90);
    expect(RETIRED_LEGEND_TEMPLATES.map((template) => template.sourcePlayerId)).toEqual(RETIRED_LEGEND_IDS);
    expect(RETIRED_LEGEND_IDS).not.toContain("nba:202681"); // Kyrie Irving is active.
    expect(RETIRED_LEGEND_TEMPLATES.every((template) => template.eligible)).toBe(true);
    expect(RETIRED_LEGEND_TEMPLATES.every((template) => RETIRED_LEGEND_NAMES_ZH[template.sourceName.toLowerCase()])).toBe(true);
    expect(RETIRED_LEGEND_IDS).toContain("nba:201146");
    expect(RETIRED_LEGEND_IDS).not.toContain("nba:201149");
    expect(retiredLegend2kRatings.gameVersions).toEqual(["2K27", "2K26"]);
    expect(retiredLegend2kRatings.players).toHaveLength(87);
    expect(retiredLegend2kRatings.unmatched.map((player) => player.sourceName)).toEqual(["Charles Barkley", "Reggie Miller", "Yi Jianlian"]);
    expect(new Set([...retiredLegend2kRatings.players, ...retiredLegend2kRatings.unmatched].map((player) => player.sourcePlayerId)))
      .toEqual(new Set(RETIRED_LEGEND_IDS));
    expect(RETIRED_LEGEND_TEMPLATES.every((template) => template.secondaryPosition)).toBe(true);
    expect(RETIRED_LEGEND_TEMPLATES.find((template) => template.sourceName === "Michael Jordan")?.secondaryPosition).toBe("SF");
    expect(RETIRED_LEGEND_TEMPLATES.find((template) => template.sourceName === "Jerry West")?.secondaryPosition).toBe("PG");
    expect(RETIRED_LEGEND_TEMPLATES.find((template) => template.sourceName === "Charles Barkley")?.secondaryPosition).toBe("SF");
  });

  it("preserves measured bundled templates and marks newly derived profiles as curated", () => {
    const bundledById = new Map(NBA_PLAYER_DATASET.historicalTemplates.map((template) => [template.sourcePlayerId, template]));
    const sourcedPeaks = new Map(
      (retiredLegend2kRatings.players as Array<{ sourcePlayerId: string; peakOverall: number; peakAttributes: Record<string, number> | null }>)
        .map((entry) => [entry.sourcePlayerId, entry]),
    );
    const reused = RETIRED_LEGEND_TEMPLATES.filter((template) => bundledById.has(template.sourcePlayerId));
    const derived = RETIRED_LEGEND_TEMPLATES.filter((template) => !bundledById.has(template.sourcePlayerId));
    expect(reused).toHaveLength(13);
    expect(derived).toHaveLength(77);
    for (const template of reused) {
      const original = bundledById.get(template.sourcePlayerId)!;
      const sourced = sourcedPeaks.get(template.sourcePlayerId);
      expect(template.peakOverall).toBe(sourced?.peakOverall ?? original.peakOverall);
      if (sourced?.peakAttributes) {
        expect(Math.abs(calculateAttributeOverall(template.rookieAttributes, template.position)
          - calculateAttributeOverall(original.rookieAttributes, template.position))).toBeLessThan(2);
      } else {
        expect(template.rookieAttributes).toEqual(original.rookieAttributes);
      }
    }
    expect(RETIRED_LEGEND_TEMPLATES.find((template) => template.sourceName === "Ben Wallace")?.position).toBe("C");
    expect(RETIRED_LEGEND_TEMPLATES.find((template) => template.sourceName === "Dwyane Wade")?.position).toBe("SG");
    const iverson = RETIRED_LEGEND_TEMPLATES.find((template) => template.sourcePlayerId === "nba:947");
    expect(iverson?.position).toBe("SG");
    expect(iverson?.secondaryPosition).toBe("PG");
    for (const rating of retiredLegendDesignRatings.players) {
      expect(RETIRED_LEGEND_TEMPLATES.find((template) => template.sourcePlayerId === rating.sourcePlayerId)?.peakOverall)
        .toBe(rating.peakOverall);
    }
    for (const template of derived) {
      expect(template.sourceSeason).toBe("CURATED");
      expect(template.peakSeason).toBe("CURATED");
      expect(template.era).toBe("LEGEND");
      expect(Object.values(template.rookieAttributes).every((value) => Number.isInteger(value) && value >= 25 && value <= 99)).toBe(true);
    }
  });
});
