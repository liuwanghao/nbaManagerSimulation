import { describe, expect, it } from "vitest";
import { openingNbaServiceYears } from "./nbaServiceYears";

describe("opening NBA service years", () => {
  it("uses documented completed seasons for Taj Gibson", () => {
    expect(openingNbaServiceYears("nba:201959", 41)).toEqual({ years: 17, source: "DOCUMENTED_DEBUT" });
  });

  it("caps official NBA experience at the 2026-27 opening without dropping injury seasons", () => {
    expect(openingNbaServiceYears("nba:1630166", 25)).toEqual({ years: 6, source: "NBA_OFFICIAL_PROFILE" });
    expect(openingNbaServiceYears("nba:201145", 40)).toEqual({ years: 19, source: "NBA_OFFICIAL_PROFILE" });
    expect(openingNbaServiceYears("nba:202691", 36)).toEqual({ years: 15, source: "NBA_OFFICIAL_PROFILE" });
  });

  it("marks an unknown NBA career length as an age estimate", () => {
    expect(openingNbaServiceYears("nba:999999999", 24)).toEqual({ years: 4, source: "AGE_ESTIMATE" });
  });
});
