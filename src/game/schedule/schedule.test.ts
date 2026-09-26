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
    const dailyCounts = new Map<number, number>();
    for (const game of schedule) dailyCounts.set(game.dateIndex, (dailyCounts.get(game.dateIndex) ?? 0) + 1);
    expect(new Set([...dailyCounts.values()]).size).toBeGreaterThan(5);
    expect(dailyCounts.get(0)).toBe(3);
    expect(dailyCounts.get(66)).toBe(5); // Christmas Day
    expect(dailyCounts.get(173)).toBe(16);
    for (const day of [14, 37, 65, 122, 123, 124, 125, 126, 127, 172]) expect(dailyCounts.has(day)).toBe(false);
    expect(dailyCounts.size).toBe(164);
  });

  it("is byte-for-byte deterministic for the same seed", () => {
    const { teams } = createFixtureDataset("schedule-replay");
    const args = [teams, "2026-27", "2026-10-20", 3, "schedule-seed"] as const;
    expect(generateSchedule(...args)).toEqual(generateSchedule(...args));
  });

  it("keeps the daily calendar valid across seeds and later seasons", () => {
    const { teams } = createFixtureDataset("schedule-multi-season");
    for (const year of [2026, 2027, 2028]) {
      for (const seed of ["calendar-a", "calendar-b", "calendar-c"]) {
        const schedule = generateSchedule(teams, `${year}-${String((year + 1) % 100).padStart(2, "0")}`, `${year}-10-20`, 0, seed);
        expect(validateSchedule(schedule, teams).errors).toEqual([]);
      }
    }
  });
});
