import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import portraitManifest from "./retiredLegendPortraits.json";
import { BUNDLED_RETIRED_PORTRAIT_IDS } from "./retiredLegendPortraitIds";
import { RETIRED_LEGEND_IDS } from "./retiredLegendTemplates";

describe("retired legend portraits", () => {
  it("tracks the source of every retired legend portrait", () => {
    expect(portraitManifest.portraits).toHaveLength(90);
    expect(new Set(portraitManifest.portraits.map((entry) => `nba:${entry.nbaPlayerId}`)))
      .toEqual(new Set(RETIRED_LEGEND_IDS));
    const official = portraitManifest.portraits.filter((entry) => entry.source === "nba-official-cdn");
    const china = portraitManifest.portraits.filter((entry) => entry.source === "nba-china");
    const commons = portraitManifest.portraits.filter((entry) => !("source" in entry));
    expect(official).toHaveLength(85);
    expect(china.map((entry) => entry.name)).toEqual(["Patrick Ewing"]);
    expect(new Set(commons.map((entry) => entry.name))).toEqual(new Set(["Jason Kidd", "Lenny Wilkens", "Tim Hardaway"]));
    for (const entry of portraitManifest.portraits) {
      if (entry.nbaPlayerId === "201146") {
        expect(entry.source).toBe("user-provided");
        expect(entry).not.toHaveProperty("commonsPage");
        continue;
      }
      if (entry.source === "nba-official-cdn" || entry.source === "nba-china") {
        expect(entry.sourceUrl).toMatch(/^https:\/\/(?:cdn\.nba\.com|res\.nba\.cn)\//u);
        expect(entry).not.toHaveProperty("commonsPage");
        continue;
      }
      expect(entry.commonsPage).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/u);
      expect(entry.license).toBeTruthy();
      expect(entry.artist).toBeTruthy();
    }
  });

  it("only advertises portraits that exist and match the recorded hash", () => {
    expect(BUNDLED_RETIRED_PORTRAIT_IDS).toHaveLength(90);
    expect(new Set(BUNDLED_RETIRED_PORTRAIT_IDS)).toEqual(new Set(portraitManifest.portraits
      .filter((entry) => entry.qualityStatus === "approved" && entry.sha256)
      .map((entry) => entry.nbaPlayerId)));
    for (const entry of portraitManifest.portraits) {
      if (!("sha256" in entry) || !entry.sha256) continue;
      const path = new URL(`../../public/retired-portraits/nba-${entry.nbaPlayerId}.webp`, import.meta.url);
      expect(existsSync(path), entry.name).toBe(true);
      expect(createHash("sha256").update(readFileSync(path)).digest("hex"), entry.name).toBe(entry.sha256);
    }
  });
});
