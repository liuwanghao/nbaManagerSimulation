import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { getFreeAgents } from "../game/freeAgency/FreeAgencyService";
import { createExpansionCareerFromBundledDataset } from "../data/hupuRoster";
import { createCareer } from "../game/season/career";
import { generateTradeOffers } from "../game/trade/TradeService";
import { TradeDesk } from "./Stage4Flow";
import { RegularSeasonFreeAgents } from "./RegularSeasonFreeAgents";
import { MarketTradeRecords } from "./MarketTradeRecords";
import { tradeAssetPositionCounts, tradeInquiryCommandId, tradeOfferStatusLabel, tradePickLabel } from "./tradeView";

describe("regular-season market", () => {
  it("shows free agents during the season without offering an unsupported signing action", () => {
    const state = createCareer("regular-season-free-agents");
    state.league.currentPhase = "REGULAR_PRE_DEADLINE";
    const player = state.players[state.teams[state.userTeamId].playerIds[0]];
    player.teamId = "FREE_AGENT";
    player.contract.status = "UFA";
    const markup = renderToStaticMarkup(createElement(RegularSeasonFreeAgents, { state, onOpenPlayer: () => {} }));
    expect(markup).toContain(`data-player-id="${player.id}"`);
    expect(markup.match(/data-player-id="/g)).toHaveLength(getFreeAgents(state).length);
    expect(markup).toContain("赛季中可浏览未签约球员");
    expect(markup).not.toContain("FREE AGENTS");
    expect(markup).not.toContain('data-testid="submit-fa-offer"');
  });

  it("offers regular-season UFA bids and displays both user and AI trade records", () => {
    const state = createExpansionCareerFromBundledDataset("market-regular-signing");
    state.league.currentPhase = "REGULAR_PRE_DEADLINE";
    const market = renderToStaticMarkup(createElement(RegularSeasonFreeAgents, {
      state, onOpenPlayer: () => {}, onCommand: async () => {},
    }));
    expect(market).toContain("发起报价");
    expect(market).toContain("RFA 报价仅在休赛期开放");
    const records = renderToStaticMarkup(createElement(MarketTradeRecords, {
      userTrades: [{ offerId: "user-offer", seasonId: "2026-27", summary: "我方成交：LeBron James" }],
      aiTrades: ["凯尔特人 / 灰熊：Paul George ↔ Jerami Grant"],
      players: state.players,
    }));
    expect(records).toContain("我方成交");
    expect(records).toContain("联盟交易");
    expect(records).not.toMatch(/TRADE HISTORY|MY TRADES|LEAGUE TRADES/);
    expect(records).toContain("凯尔特人 / 灰熊");
    expect(records).toContain("勒布朗·詹姆斯");
    expect(records).toContain("保罗·乔治");
    expect(records).toContain("杰拉米·格兰特");
    expect(records).not.toContain("Paul George");
    expect(records).toContain("2 笔");
  });

  it("shows every inquiry offer directly and gives each saved inquiry a fresh id", () => {
    const state = createCareer("market-inquiry-ids");
    state.league.currentPhase = "REGULAR_PRE_DEADLINE";
    const firstPlayerId = state.teams[state.userTeamId].playerIds[0];
    const secondPlayerId = state.teams[state.userTeamId].playerIds[1];
    const firstId = tradeInquiryCommandId(state, firstPlayerId);
    state.commandReceipts[firstId] = { payloadHash: "first" };
    const secondId = tradeInquiryCommandId(state, secondPlayerId);
    state.commandReceipts[secondId] = { payloadHash: "second" };
    expect(tradeInquiryCommandId(state, firstPlayerId)).not.toBe(firstId);
    const quoted = generateTradeOffers(state, firstPlayerId, false);
    const markup = renderToStaticMarkup(createElement(TradeDesk, { state: quoted, busy: false, onTradeCommand: async () => {} }));
    expect(markup.match(/class="trade-console-offer-card"/g)).toHaveLength(quoted.tradeDesk.offers.length);
    expect(markup).toContain(`${quoted.tradeDesk.offers.length} 个方案`);
    expect(markup).toContain("刷新报价");
    expect(markup).not.toMatch(/OUTGOING ASSET|TRADE PROPOSAL|ASSET EXCHANGE|RULE CHECK|TEAM IMPACT/);
    expect(markup).not.toContain("⟳");
    expect(markup).not.toContain('aria-label="筛选交易报价球员"');
    expect(markup).not.toContain("重置");
  });

  it("names the pick assets and statuses that can appear in generated offers", () => {
    const state = createCareer("market-trade-assets");
    const pick = Object.values(state.draftPicks)[0];
    expect(tradePickLabel(state, pick.id)).toContain(`${pick.year} 年${pick.round === 1 ? "首轮" : "次轮"}`);
    expect(tradeOfferStatusLabel({
      offerId: "offer", inquiryKey: "query", inquiryCount: 0, counterpartyTeamId: state.userTeamId,
      userOutgoingPlayerIds: [], userOutgoingPickIds: [], userIncomingPlayerIds: [], userIncomingPickIds: [], status: "REJECTED",
    })).toBe("已失效");
  });

  it("counts tradeable roster players once by primary position", () => {
    const state = createCareer("trade-assets-by-position");
    const roster = state.teams[state.userTeamId].playerIds.map((id) => state.players[id]);
    const counts = tradeAssetPositionCounts(roster);
    expect(counts.ALL).toBe(roster.length);
    expect(counts.PG + counts.SG + counts.SF + counts.PF + counts.C).toBe(roster.length);
    expect(counts.PG).toBe(roster.filter((player) => player.position === "PG").length);
  });
});
