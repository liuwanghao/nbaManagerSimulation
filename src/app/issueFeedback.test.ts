import { describe, expect, it } from "vitest";
import { buildGameIssueFeedback } from "./issueFeedback";

describe("game issue feedback", () => {
  it("includes only bounded diagnostic context for a failed transition", () => {
    const report = buildGameIssueFeedback({
      kind: "年度切换失败", step: "保存新赛季存档", phase: "OFFSEASON", seasonId: "2026-27", slotId: 2,
      error: "QuotaExceededError: storage quota reached",
    });
    expect(report).toContain("处理步骤：保存新赛季存档");
    expect(report).toContain("赛季：2026-27");
    expect(report).toContain("存档槽位：2");
    expect(report).toContain("QuotaExceededError");
    expect(report).not.toContain("puid");
  });

  it("keeps a long error below the feedback service's Unicode limit", () => {
    const report = buildGameIssueFeedback({
      kind: "年度切换耗时过长", step: "计算下一联盟年度", phase: "POSTSEASON", seasonId: "2026-27", slotId: 1,
      error: "🏀".repeat(3000),
    });
    expect(Array.from(report).length).toBeLessThanOrEqual(2000);
  });
});
