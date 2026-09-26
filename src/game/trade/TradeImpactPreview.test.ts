import { describe, expect, it } from "vitest";
import { getCapSheet } from "../cap/CapSheetService";
import { stableHash, stableSerialize } from "../random/hash";
import { createCareer } from "../season/career";
import { calculateTeamFit } from "../team/TeamFitService";
import { calculateTeamOverall } from "../team/TeamRatingService";
import { acceptTradeOffer, generateTradeOffers } from "./TradeService";
import { previewTradeImpact } from "./TradeImpactPreview";

describe("trade impact preview", () => {
  it("matches the committed rotation, rating, fit and cap space without mutating the offer", () => {
    const state = createCareer("trade-impact-preview");
    state.league.currentPhase = "REGULAR_PRE_DEADLINE";
    const playerId = state.teams[state.userTeamId].playerIds[5];
    const queried = generateTradeOffers(state, playerId, false);
    const offer = queried.tradeDesk.offers[0];
    const before = stableHash(stableSerialize(queried));
    const preview = previewTradeImpact(queried, offer.offerId);
    expect(preview).not.toBeNull();
    if (!preview) return;
    expect(stableHash(stableSerialize(queried))).toBe(before);
    expect(preview.overallBefore).toEqual(calculateTeamOverall(queried, queried.userTeamId));
    expect(preview.capSpaceBefore).toBe(getCapSheet(queried, queried.userTeamId).availableCapSpace);

    const committed = acceptTradeOffer(queried, offer.offerId);
    expect(preview.overallAfter).toEqual(calculateTeamOverall(committed, committed.userTeamId));
    expect(preview.fitAfter.score).toBeCloseTo(calculateTeamFit(committed, committed.userTeamId).score);
    expect(preview.minutesAfter).toEqual(committed.teams[committed.userTeamId].rotationPlan?.targetMinutes);
    expect(preview.capSpaceAfter).toBe(getCapSheet(committed, committed.userTeamId).availableCapSpace);
    expect(stableHash(stableSerialize(queried))).toBe(before);
  });

  it("does not present a rotation forecast for an illegal offer", () => {
    const state = createCareer("trade-impact-invalid");
    state.league.currentPhase = "REGULAR_PRE_DEADLINE";
    const queried = generateTradeOffers(state, state.teams[state.userTeamId].playerIds[5], false);
    queried.league.currentPhase = "REGULAR_POST_DEADLINE";
    expect(previewTradeImpact(queried, queried.tradeDesk.offers[0].offerId)).toBeNull();
  });
});
