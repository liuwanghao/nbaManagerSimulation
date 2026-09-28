import { describe, expect, it } from "vitest";
import { formatBeijingSaveTime } from "./saveTime";

describe("formatBeijingSaveTime", () => {
  it("formats UTC save metadata in Beijing time", () => {
    expect(formatBeijingSaveTime("2026-09-28T00:05:59.000Z")).toBe("2026-09-28 08:05");
  });

  it("rolls the displayed date forward in the Beijing time zone", () => {
    expect(formatBeijingSaveTime("2026-09-28T18:30:00.000Z")).toBe("2026-09-29 02:30");
  });

  it("falls back safely for malformed legacy metadata", () => {
    expect(formatBeijingSaveTime("not-a-date")).toBe("时间未知");
  });
});
