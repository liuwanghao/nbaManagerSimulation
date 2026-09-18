import { describe, expect, it } from "vitest";
import { calculateAttributeOverall, calculatePlayerOverall } from "./PlayerRatingService";

describe("configurable player OVR", () => {
  it("uses the position-specific weight table without affecting simulation inputs", () => {
    const attributes = {
      shooting: 90,
      finishing: 80,
      playmaking: 70,
      perimeterDefense: 60,
      interiorDefense: 50,
      rebounding: 40,
      athleticism: 30,
      basketballIq: 90,
    };
    expect(calculateAttributeOverall(attributes, "PG")).toBeCloseTo(70.6, 5);
    expect(calculateAttributeOverall(attributes, "C")).toBeCloseTo(59.1, 5);
  });

  it("keeps source-season calibration separate from simulation attributes", () => {
    const attributes = {
      shooting: 77,
      finishing: 72,
      playmaking: 90,
      perimeterDefense: 56,
      interiorDefense: 54,
      rebounding: 50,
      athleticism: 70,
      basketballIq: 86,
    };
    const rawOverall = calculateAttributeOverall(attributes, "PG");
    expect(rawOverall).toBeCloseTo(75.34, 5);
    expect(calculatePlayerOverall({ attributes, position: "PG", overallAdjustment: 92 - rawOverall })).toBe(92);
  });
});
