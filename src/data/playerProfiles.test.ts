import { describe, expect, it } from "vitest";
import { createFixtureDataset } from "./fixture";
import { calculateMarketPreference } from "../game/player/MarketPreferenceService";

describe("fictional fixture player profiles", () => {
  it("creates deterministic, unique names without placeholder labels", () => {
    const first = createFixtureDataset("player-profile-seed");
    const second = createFixtureDataset("player-profile-seed");
    const names = Object.values(first.players).map((player) => player.name);
    expect(names).toEqual(Object.values(second.players).map((player) => player.name));
    expect(names).toHaveLength(480);
    expect(new Set(names).size).toBe(480);
    expect(names.some((name) => / Player \d+$/u.test(name))).toBe(false);
  });

  it("fills the V1.5 public Player Core fields inside valid ranges", () => {
    const dataset = createFixtureDataset("player-profile-ranges");
    for (const player of Object.values(dataset.players)) {
      expect(player.heightCm).toBeGreaterThanOrEqual(183);
      expect(player.heightCm).toBeLessThanOrEqual(218);
      expect(player.weightKg).toBeGreaterThanOrEqual(78);
      expect(player.weightKg).toBeLessThanOrEqual(132);
      expect(player.secondaryPosition).not.toBe(player.position);
      expect(player.birthDate).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
      expect(player.ageAtSnapshot).toBe(player.age);
      expect(player.serviceYears).toBeGreaterThanOrEqual(0);
      expect(player.injuryRating).toBeGreaterThanOrEqual(25);
      expect(player.injuryRating).toBeLessThanOrEqual(99);
      expect(player.marketPreference).toBeGreaterThanOrEqual(0);
      expect(player.marketPreference).toBeLessThanOrEqual(100);
      expect(player.marketPreference).toBe(calculateMarketPreference(player.personality, player.ageAtSnapshot));
      expect(player.profileSource).toBe("FICTIONAL_FIXTURE");
    }
  });
});
