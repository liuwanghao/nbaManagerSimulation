import { describe, expect, it } from "vitest";
import { createFixtureDataset } from "../../data/fixture";
import { stableHash } from "../random/hash";
import { generateSchedule, validateSchedule } from "./schedule";

describe("82-game schedule", () => {
  it("satisfies the frozen 32-team schedule invariants", () => {
    const { teams } = createFixtureDataset("schedule-test");
    const schedule = generateSchedule(
      teams,
      "2026-27",
      "2026-10-20",
      0,
      stableHash("schedule-test", "2026-27", "schedule"),
    );
    const report = validateSchedule(schedule, teams);
    expect(report.errors).toEqual([]);
    expect(report.valid).toBe(true);
    expect(schedule).toHaveLength(1312);
  });

  it("is byte-for-byte deterministic for the same seed", () => {
    const { teams } = createFixtureDataset("schedule-replay");
    const args = [teams, "2026-27", "2026-10-20", 3, "schedule-seed"] as const;
    expect(generateSchedule(...args)).toEqual(generateSchedule(...args));
  });
});
