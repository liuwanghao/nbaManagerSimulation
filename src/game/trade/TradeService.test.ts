import { describe, expect, it } from "vitest";
import { stableHash, stableSerialize } from "../random/hash";
import { createCareer } from "../season/career";
import { acceptTradeOffer, evaluateTradeOffer, executeTradeCommand, generateTradeOffers, isTradePhaseAllowed } from "./TradeService";

function tradeState() {
  const state = createCareer("player-trade-tests");
  state.league.currentPhase = "OFFSEASON_POST_DRAFT";
  return state;
}

describe("TradeService", () => {
  it("generates three stable offers and increments inquiry count only on refresh", () => {
    const state = tradeState();
    const playerId = state.teams[state.userTeamId].playerIds[5];
    const first = generateTradeOffers(state, playerId, false);
    expect(first.tradeDesk.offers).toHaveLength(3);
    expect(first.tradeDesk.offers[0].inquiryCount).toBe(0);
    expect(generateTradeOffers(first, playerId, false).tradeDesk.offers[0].inquiryCount).toBe(0);
    expect(generateTradeOffers(first, playerId, true).tradeDesk.offers[0].inquiryCount).toBe(1);
  });

  it("commits owned assets atomically and treats a repeated command as already applied", () => {
    const state = tradeState();
    const playerId = state.teams[state.userTeamId].playerIds[5];
    const queried = executeTradeCommand(state, { commandId: "query", type: "GENERATE_TRADE_OFFERS", payload: { playerId, refresh: false } });
    const offer = queried.tradeDesk.offers[0];
    const incomingId = offer.userIncomingPlayerIds[0];
    const accepted = executeTradeCommand(queried, { commandId: "accept", type: "ACCEPT_TRADE_OFFER", payload: { offerId: offer.offerId } });
    expect(accepted.teams[accepted.userTeamId].playerIds).toContain(incomingId);
    expect(accepted.teams[accepted.userTeamId].playerIds).not.toContain(playerId);
    const retry = executeTradeCommand(accepted, { commandId: "accept", type: "ACCEPT_TRADE_OFFER", payload: { offerId: offer.offerId } });
    expect(retry).toBe(accepted);
  });

  it("rejects illegal phases and stale offers without mutating input", () => {
    const state = tradeState();
    const playerId = state.teams[state.userTeamId].playerIds[5];
    const queried = generateTradeOffers(state, playerId, false);
    queried.league.currentPhase = "REGULAR_POST_DEADLINE";
    const before = stableHash(stableSerialize(queried));
    expect(() => acceptTradeOffer(queried, queried.tradeDesk.offers[0].offerId)).toThrow(/not allowed/);
    expect(stableHash(stableSerialize(queried))).toBe(before);
  });

  it("evaluates phase, salary matching, ownership and fit without mutating the offer", () => {
    const state = tradeState();
    const playerId = state.teams[state.userTeamId].playerIds[5];
    const queried = generateTradeOffers(state, playerId, false);
    const offer = queried.tradeDesk.offers[0];
    const before = stableHash(stableSerialize(queried));
    const evaluation = evaluateTradeOffer(queried, offer.offerId);

    expect(isTradePhaseAllowed(queried.league.currentPhase)).toBe(true);
    expect(evaluation.legal).toBe(true);
    expect(evaluation.outgoingSalary).toBeGreaterThan(0);
    expect(evaluation.incomingSalary).toBeGreaterThan(0);
    expect(Number.isFinite(evaluation.userFitDelta)).toBe(true);
    expect(stableHash(stableSerialize(queried))).toBe(before);

    queried.league.currentPhase = "REGULAR_POST_DEADLINE";
    expect(isTradePhaseAllowed(queried.league.currentPhase)).toBe(false);
    expect(evaluateTradeOffer(queried, offer.offerId)).toMatchObject({ legal: false, reason: "当前阶段不开放交易" });
  });
});
