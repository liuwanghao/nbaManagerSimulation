import { describe, expect, it } from "vitest";
import { getCapSheet } from "../cap/CapSheetService";
import { stableHash, stableSerialize } from "../random/hash";
import { createCareer } from "../season/career";
import { calculateTeamFit } from "../team/TeamFitService";
import { calculateTeamOverall } from "../team/TeamRatingService";
import { acceptTradeOffer, evaluateTradeOffer, generateTradeOffers } from "./TradeService";
import { previewTradeImpact } from "./TradeImpactPreview";

describe("trade impact preview", () => {
  it("keeps a roster-repairing trade legal when its before rotation cannot be previewed", () => {
    const state = createCareer("trade-impact-preview");
    state.league.currentPhase = "OFFSEASON_PRE_DRAFT";
    state.league.seasonYear = 2027;
    state.league.seasonId = "2027-28";
    const quoted = generateTradeOffers(state, state.teams[state.userTeamId].playerIds[5], false);
    const offer = quoted.tradeDesk.offers[0];
    quoted.teams[quoted.userTeamId].playerIds.forEach((id, index) => { quoted.players[id].available = index < 4; });
    const before = stableHash(stableSerialize(quoted));
    expect(evaluateTradeOffer(quoted, offer.offerId).legal).toBe(true);
    expect(previewTradeImpact(quoted, offer.offerId)).toBeNull();
    expect(stableHash(stableSerialize(quoted))).toBe(before);
    const committed = acceptTradeOffer(quoted, offer.offerId);
    expect(committed.tradeDesk.offers[0].status).toBe("ACCEPTED");
    expect(committed.teams[committed.userTeamId].playerIds.filter((id) => committed.players[id].available && !committed.players[id].injury)).toHaveLength(5);
  });

  it("keeps a pick-only trade available when fewer than five players are healthy", () => {
    const state = createCareer("trade-impact-picks-short-handed");
    state.league.currentPhase = "OFFSEASON_PRE_DRAFT";
    const outgoingPick = Object.values(state.draftPicks).find((pick) => pick.ownerTeamId === state.userTeamId && pick.round === 2)!;
    const incomingPick = Object.values(state.draftPicks).find((pick) => pick.ownerTeamId === "CHA" && pick.round === 2 && pick.year === outgoingPick.year)!;
    state.teams[state.userTeamId].playerIds.forEach((id, index) => { state.players[id].available = index < 4; });
    state.tradeDesk.offers = [{
      offerId: "short-handed-picks", inquiryKey: "picks", inquiryCount: 0, counterpartyTeamId: "CHA", status: "AVAILABLE",
      userOutgoingPlayerIds: [], userIncomingPlayerIds: [], userOutgoingPickIds: [outgoingPick.id], userIncomingPickIds: [incomingPick.id],
    }];
    const roster = [...state.teams[state.userTeamId].playerIds];
    expect(evaluateTradeOffer(state, "short-handed-picks").legal).toBe(true);
    expect(previewTradeImpact(state, "short-handed-picks")).toBeNull();
    const committed = acceptTradeOffer(state, "short-handed-picks");
    expect(committed.teams[state.userTeamId].playerIds).toEqual(roster);
    expect(committed.draftPicks[incomingPick.id].ownerTeamId).toBe(state.userTeamId);
  });

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
