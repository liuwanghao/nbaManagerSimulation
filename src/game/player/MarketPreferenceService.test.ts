import { describe, expect, it } from "vitest";
import type { PlayerPersonality } from "../state/types";
import { TEAM_DEFINITIONS } from "../../data/league";
import { calculateMarketPreference, marketFitScore, personalityOfferWeights } from "./MarketPreferenceService";

describe("large-market preference", () => {
  it("derives a stable preference from personality and career stage", () => {
    expect(calculateMarketPreference("MARKET_FOCUSED", 25)).toBe(81);
    expect(calculateMarketPreference("LOYAL", 34)).toBe(35);
    expect(calculateMarketPreference("BALANCED", 28)).toBe(50);
  });

  it("rewards large markets only when a player prefers them", () => {
    expect(marketFitScore(80, 90)).toBeGreaterThan(marketFitScore(80, 60));
    expect(marketFitScore(20, 90)).toBeLessThan(marketFitScore(20, 60));
    expect(marketFitScore(50, 90)).toBe(50);
  });

  it("uses explicit city ratings rather than team-id hashes", () => {
    const ratings = new Map(TEAM_DEFINITIONS.map((team) => [team.id, team.marketRating]));
    expect(TEAM_DEFINITIONS).toHaveLength(32);
    expect(TEAM_DEFINITIONS.every((team) => Number.isInteger(team.marketRating))).toBe(true);
    expect(ratings.get("LAL")).toBe(ratings.get("LAC"));
    expect(ratings.get("NYK")).toBe(ratings.get("BKN"));
    expect(ratings.get("LAL")).toBeGreaterThan(ratings.get("OKC")!);
  });

  it("changes offer priorities by personality while keeping 100 total weight", () => {
    const personalities: PlayerPersonality[] = ["COMPETITIVE", "MONEY_FOCUSED", "LOYAL", "ROLE_FOCUSED", "MARKET_FOCUSED", "BALANCED"];
    for (const personality of personalities) {
      const weights = personalityOfferWeights(personality);
      expect(Object.values(weights).reduce((sum, value) => sum + value, 0)).toBe(100);
      expect(Object.values(weights).every((value) => value >= 0)).toBe(true);
    }
    expect(personalityOfferWeights("MONEY_FOCUSED").salaryValue).toBeGreaterThan(personalityOfferWeights("BALANCED").salaryValue);
    expect(personalityOfferWeights("LOYAL").existingTeamRelationship).toBeGreaterThan(personalityOfferWeights("BALANCED").existingTeamRelationship);
    expect(personalityOfferWeights("MARKET_FOCUSED").marketPreference).toBeGreaterThan(personalityOfferWeights("BALANCED").marketPreference);
  });
});
