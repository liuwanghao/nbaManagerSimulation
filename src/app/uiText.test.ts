import { describe, expect, it } from "vitest";
import { hundredMillionDollarLabel, positionLabel, positionPairLabel } from "./uiText";

describe("position display labels", () => {
  it("uses compact NBA position codes everywhere in the UI", () => {
    expect(positionLabel("PG")).toBe("PG");
    expect(positionLabel("C")).toBe("C");
    expect(positionPairLabel("SG", "SF")).toBe("SG / SF");
  });
});

describe("salary display labels", () => {
  it("formats cap thresholds in hundred-million-dollar units", () => {
    expect(hundredMillionDollarLabel(165_000_000)).toBe("1.650 亿美元");
    expect(hundredMillionDollarLabel(200_400_000)).toBe("2.004 亿美元");
    expect(hundredMillionDollarLabel(-5_000_000)).toBe("-0.050 亿美元");
  });
});
