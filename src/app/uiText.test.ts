import { describe, expect, it } from "vitest";
import { positionLabel, positionPairLabel } from "./uiText";

describe("position display labels", () => {
  it("uses compact NBA position codes everywhere in the UI", () => {
    expect(positionLabel("PG")).toBe("PG");
    expect(positionLabel("C")).toBe("C");
    expect(positionPairLabel("SG", "SF")).toBe("SG / SF");
  });
});
