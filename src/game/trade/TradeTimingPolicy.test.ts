import { describe, expect, it } from "vitest";
import { createCareer } from "../season/career";
import { generateTradeOffers, validateTradePackage } from "./TradeService";
import { playerTradeWaitingReason, tradeCalendarDate } from "./TradeTimingPolicy";

describe("NBA player trade waiting periods", () => {
  it("blocks a newly signed free agent even when an otherwise legal quote exists", () => {
    const state = createCareer("audit-seed-1");
    state.league.currentPhase = "OFFSEASON_POST_DRAFT";
    const outgoingId = state.teams[state.userTeamId].playerIds[5];
    const quoted = generateTradeOffers(state, outgoingId, false);
    const offer = quoted.tradeDesk.offers.find((entry) => entry.userIncomingPlayerIds.length > 0);
    expect(offer).toBeDefined();
    const trade = {
      leftTeamId: quoted.userTeamId, rightTeamId: offer!.counterpartyTeamId,
      leftPlayerIds: offer!.userOutgoingPlayerIds, rightPlayerIds: offer!.userIncomingPlayerIds,
      leftPickIds: offer!.userOutgoingPickIds, rightPickIds: offer!.userIncomingPickIds,
    };
    expect(() => validateTradePackage(quoted, trade)).not.toThrow();
    const signed = quoted.players[offer!.userIncomingPlayerIds[0]];
    signed.contract.signedPhase = "OFFSEASON_POST_DRAFT";
    signed.contract.startSeason = quoted.league.seasonYear;
    signed.contract.signedOn = tradeCalendarDate(quoted);
    expect(() => validateTradePackage(quoted, trade)).toThrow("FREE_AGENT_TRADE_WAITING_PERIOD");
    quoted.league.currentPhase = "REGULAR_PRE_DEADLINE";
    quoted.calendar.currentDateIndex = 56;
    expect(playerTradeWaitingReason(quoted, signed)).toBeUndefined();
  });

  it("holds signed rookies for 30 days and leaves dataset contracts tradable", () => {
    const state = createCareer("rookie-trade-hold");
    state.league.currentPhase = "OFFSEASON_POST_DRAFT";
    state.freeAgency = {
      opened: true, currentDay: 20, offers: {}, markets: {}, settledPlayerDay: {}, transactionLog: [],
    };
    const rookie = state.players[state.teams[state.userTeamId].playerIds[0]];
    rookie.contract.signedPhase = "DRAFT";
    rookie.contract.signedOn = `${state.league.seasonYear}-06-27`;
    rookie.contract.startSeason = state.league.seasonYear;
    expect(playerTradeWaitingReason(state, rookie)).toBe("ROOKIE_TRADE_WAITING_PERIOD");
    state.freeAgency.currentDay = 28;
    expect(playerTradeWaitingReason(state, rookie)).toBeUndefined();
    rookie.contract.signedPhase = "DATASET";
    delete rookie.contract.signedOn;
    expect(playerTradeWaitingReason(state, rookie)).toBeUndefined();
  });

  it("uses the later of three months and December 15 for a new standard contract", () => {
    const state = createCareer("regular-trade-hold");
    const player = state.players[state.teams[state.userTeamId].playerIds[0]];
    player.contract.signedPhase = "REGULAR_SEASON";
    player.contract.startSeason = state.league.seasonYear;
    player.contract.signedOn = "2026-11-10";
    state.calendar.currentDateIndex = 91;
    expect(playerTradeWaitingReason(state, player)).toBe("FREE_AGENT_TRADE_WAITING_PERIOD");
    state.calendar.currentDateIndex = 113;
    expect(playerTradeWaitingReason(state, player)).toBeUndefined();
  });
});
