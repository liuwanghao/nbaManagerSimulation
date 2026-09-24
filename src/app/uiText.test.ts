import { describe, expect, it } from "vitest";
import { adaptiveMoneyLabel, hundredMillionDollarLabel, positionLabel, positionPairLabel } from "./uiText";

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
});
