import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createCareer } from "../game/season/career";
import { evaluateTradeOffer, generateTradeOffers } from "../game/trade/TradeService";
import { playerNameZh } from "./playerNameZh";
import { TradeOfferDetail } from "./TradeOfferDetail";

describe("trade offer detail", () => {
  it("shows the team impact preview with two asset columns", () => {
    const state = createCareer("trade-detail-impact");
    state.league.currentPhase = "REGULAR_PRE_DEADLINE";
    const quoted = generateTradeOffers(state, state.teams[state.userTeamId].playerIds[5], false);
    const offer = quoted.tradeDesk.offers[0];
    const markup = renderToStaticMarkup(createElement(TradeOfferDetail, {
      state: quoted, offer, evaluation: evaluateTradeOffer(quoted, offer.offerId), busy: false,
      onBack: () => {}, onAccept: () => {},
    }));
    expect(markup).toContain("球队综合评分");
    expect(markup).toContain("战术适配");
    expect(markup).toContain("首发与轮换");
    expect(markup).toContain("阵容优劣变化");
    expect(markup).toContain("本赛季工资帽空间");
    expect(markup).toContain('data-testid="trade-assets-outgoing"');
    expect(markup).toContain('data-testid="trade-assets-incoming"');
    expect(markup.match(/aria-label="查看[^"]+球员资料"/g)).toHaveLength(offer.userOutgoingPlayerIds.length + offer.userIncomingPlayerIds.length);
    expect(markup).toContain("资产价值差");
    expect(markup).toContain("估值 <b>");
    expect(markup).not.toContain("游戏内估值合计");
    expect(markup.indexOf("trade-detail-assets")).toBeLessThan(markup.indexOf("trade-detail-salary"));
    expect(markup.indexOf("trade-detail-salary")).toBeLessThan(markup.indexOf("trade-detail-impact-section"));
  });

  it("lists every player and pick on its own side when an offer has multiple assets", () => {
    const state = createCareer("trade-detail-multi-assets");
    state.league.currentPhase = "REGULAR_PRE_DEADLINE";
    const quoted = generateTradeOffers(state, state.teams[state.userTeamId].playerIds[5], false);
    const offer = quoted.tradeDesk.offers[0];
    const other = quoted.teams[offer.counterpartyTeamId];
    const extraOutgoing = quoted.teams[quoted.userTeamId].playerIds.find((id) => !offer.userOutgoingPlayerIds.includes(id));
    const extraIncoming = other.playerIds.find((id) => !offer.userIncomingPlayerIds.includes(id));
    const outgoingPick = Object.values(quoted.draftPicks).find((pick) => pick.ownerTeamId === quoted.userTeamId);
    const incomingPick = Object.values(quoted.draftPicks).find((pick) => pick.ownerTeamId === other.id);
    if (!extraOutgoing || !extraIncoming || !outgoingPick || !incomingPick) throw new Error("Missing test assets");
    offer.userOutgoingPlayerIds.push(extraOutgoing);
    offer.userIncomingPlayerIds.push(extraIncoming);
    offer.userOutgoingPickIds.push(outgoingPick.id);
    offer.userIncomingPickIds.push(incomingPick.id);

    const markup = renderToStaticMarkup(createElement(TradeOfferDetail, {
      state: quoted, offer, evaluation: evaluateTradeOffer(quoted, offer.offerId), busy: false,
      onBack: () => {}, onAccept: () => {},
    }));
    const outgoingStart = markup.indexOf('data-testid="trade-assets-outgoing"');
    const incomingStart = markup.indexOf('data-testid="trade-assets-incoming"');
    const outgoingColumn = markup.slice(outgoingStart, incomingStart);
    const incomingColumn = markup.slice(incomingStart, markup.indexOf("trade-detail-value-summary", incomingStart));
    expect(outgoingColumn).toContain(playerNameZh(quoted.players[extraOutgoing].name, extraOutgoing));
    expect(incomingColumn).toContain(playerNameZh(quoted.players[extraIncoming].name, extraIncoming));
    expect(outgoingColumn).toContain(`${outgoingPick.year} 年`);
    expect(incomingColumn).toContain(`${incomingPick.year} 年`);
    expect(outgoingColumn.match(/class="trade-detail-asset-item(?: |")/g)).toHaveLength(offer.userOutgoingPlayerIds.length + offer.userOutgoingPickIds.length);
    expect(incomingColumn.match(/class="trade-detail-asset-item(?: |")/g)).toHaveLength(offer.userIncomingPlayerIds.length + offer.userIncomingPickIds.length);
  });

  it("renders a pick-only exchange without assuming either side has a player", () => {
    const state = createCareer("trade-detail-picks-only");
    state.league.currentPhase = "REGULAR_PRE_DEADLINE";
    const quoted = generateTradeOffers(state, state.teams[state.userTeamId].playerIds[5], false);
    const offer = quoted.tradeDesk.offers[0];
    const outgoingPick = Object.values(quoted.draftPicks).find((pick) => pick.ownerTeamId === quoted.userTeamId);
    const incomingPick = Object.values(quoted.draftPicks).find((pick) => pick.ownerTeamId === offer.counterpartyTeamId);
    if (!outgoingPick || !incomingPick) throw new Error("Missing test picks");
    offer.userOutgoingPlayerIds = [];
    offer.userIncomingPlayerIds = [];
    offer.userOutgoingPickIds = [outgoingPick.id];
    offer.userIncomingPickIds = [incomingPick.id];
    const markup = renderToStaticMarkup(createElement(TradeOfferDetail, {
      state: quoted, offer, evaluation: evaluateTradeOffer(quoted, offer.offerId), busy: false,
      onBack: () => {}, onAccept: () => {},
    }));
    expect(markup).toContain("首发位置保持不变");
    expect(markup).toContain(`${outgoingPick.year} 年`);
    expect(markup).toContain(`${incomingPick.year} 年`);
    expect(markup.match(/class="trade-detail-asset-item pick"/g)).toHaveLength(2);
    expect(markup).not.toMatch(/aria-label="查看[^"]+球员资料"/);
  });
});
