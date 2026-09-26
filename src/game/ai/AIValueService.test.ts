import { describe, expect, it } from "vitest";
import { calculatePlayerOverall } from "../player/PlayerRatingService";
import { createCareer } from "../season/career";
import { publicPlayerValue, tradeDraftPickValue } from "./AIValueService";

function ratedPlayer(overall: number) {
  const player = structuredClone(Object.values(createCareer("trade-value-tests").players)[0]);
  player.overallAdjustment = overall - calculatePlayerOverall(player);
  player.age = 28;
  player.scoutedPotentialGrade = "C";
  player.contract.salary = 8_000_000;
  player.contract.yearsRemaining = 3;
  player.contract.status = "STANDARD";
  return player;
}

describe("AI trade asset value", () => {
  it("prices elite ability above a pair of replacement-level players", () => {
    const elite = ratedPlayer(90);
    const depth = ratedPlayer(70);
    expect(publicPlayerValue(elite)).toBeGreaterThan(publicPlayerValue(depth) * 2);
  });

  it("does not treat the original team's rotation role or hidden potential as transferable value", () => {
    const player = ratedPlayer(80);
    const value = publicPlayerValue(player);
    player.rotationRole = player.rotationRole === "STARTER" ? "BENCH" : "STARTER";
    player.truePotential = 99;
    expect(publicPlayerValue(player)).toBe(value);
  });

  it("values a cheap long contract and visible young upside without giving a full bonus to an expiring deal", () => {
    const player = ratedPlayer(80);
    player.contract.salary = 5_000_000;
    const longDeal = publicPlayerValue(player);
    player.contract.yearsRemaining = 1;
    expect(publicPlayerValue(player)).toBeLessThan(longDeal);
    player.contract.yearsRemaining = 3;
    player.age = 21;
    player.scoutedPotentialGrade = "S";
    expect(publicPlayerValue(player)).toBeGreaterThan(longDeal);
  });

  it("prices a weak team's next first-round pick above a strong team's pick", () => {
    const state = createCareer("trade-pick-value-tests");
    const pick = Object.values(state.draftPicks).find((asset) => asset.round === 1);
    if (!pick) throw new Error("Expected a first-round pick");
    const values = Object.values(state.teams).map((team) => tradeDraftPickValue(state, { ...pick, originalTeamId: team.id }));
    expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(10);
    expect(Math.min(...values)).toBeGreaterThan(0);
  });
});
