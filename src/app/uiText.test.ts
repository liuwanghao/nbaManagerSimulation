import { describe, expect, it } from "vitest";
import { adaptiveMoneyLabel, freeAgencyTransactionLabel, hundredMillionDollarLabel, humanizeUiText, positionLabel, positionPairLabel } from "./uiText";

describe("position display labels", () => {
  it("uses compact NBA position codes everywhere in the UI", () => {
    expect(positionLabel("PG")).toBe("PG");
    expect(positionLabel("C")).toBe("C");
    expect(positionPairLabel("SG", "SF")).toBe("SG / SF");
  });
});

describe("salary display labels", () => {
  it("switches offer displays to hundred-million-dollar units at one hundred million", () => {
    expect(adaptiveMoneyLabel(99_990_000)).toBe("9,999 万美元");
    expect(adaptiveMoneyLabel(100_000_000)).toBe("1.0 亿美元");
    expect(adaptiveMoneyLabel(125_000_000)).toBe("1.25 亿美元");
  });

  it("formats cap thresholds in hundred-million-dollar units", () => {
    expect(hundredMillionDollarLabel(165_000_000)).toBe("1.650 亿美元");
    expect(hundredMillionDollarLabel(200_400_000)).toBe("2.004 亿美元");
    expect(hundredMillionDollarLabel(-5_000_000)).toBe("-0.050 亿美元");
  });

  it("shows saved free-agent signing logs in Chinese money units", () => {
    expect(freeAgencyTransactionLabel("Player 与 Team 签约 2 年 / 25M")).toBe("Player 与 Team 签约 2 年 / 2,500 万美元");
    expect(freeAgencyTransactionLabel("Player 与 Team 签约 4 年 / 125M")).toBe("Player 与 Team 签约 4 年 / 1.25 亿美元");
  });
});

describe("contract option messages", () => {
  it("identifies who declined an option, including logs in older saves", () => {
    expect(humanizeUiText("LeBron James · PLAYER_OPTION_DECLINED · 进入 UFA")).toBe("LeBron James · 拒绝执行球员选项 · 成为完全自由球员");
    expect(humanizeUiText("LeBron James · PLAYER_OPTION_DECLINED · 成为UFA")).toBe("LeBron James · 拒绝执行球员选项 · 成为完全自由球员");
    expect(humanizeUiText("LeBron James · TEAM_OPTION_DECLINED · 成为UFA")).toBe("球队放弃LeBron James的球队选项 · 成为完全自由球员");
    expect(humanizeUiText("TEAM_OPTION_DECLINED")).toBe("球队放弃该球员的球队选项");
  });
});
