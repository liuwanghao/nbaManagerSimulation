import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { getFreeAgents } from "../game/freeAgency/FreeAgencyService";
import { createExpansionCareerFromBundledDataset } from "../data/hupuRoster";
import { createCareer } from "../game/season/career";
import { calculatePlayerOverall } from "../game/player/PlayerRatingService";
import type { TradeOffer } from "../game/state/types";
import App from "./App";
import { executeTradeCommand, generateTradeOffers } from "../game/trade/TradeService";
import { freeAgencyOfferCommandId, TradeDesk } from "./Stage4Flow";
import { getUpcomingFreeAgents, RegularSeasonFreeAgents } from "./RegularSeasonFreeAgents";
import { PLAYER_RATING_COLORS } from "./playerRatingColor";
import { MarketTradeRecords } from "./MarketTradeRecords";
import { targetedTradeInquiryCommandId, tradeAssetPositionCounts, tradeInquiryCommandId, tradeOfferPortraitPlayer, tradeOfferStatusLabel, tradePickLabel } from "./tradeView";

describe("regular-season market", () => {
  it.each([0, 5])("shows every offseason UFA alongside %i RFAs and reserves own-team renewals for RFAs", (rfaCount) => {
    const state = createCareer(`offseason-all-free-agents-${rfaCount}`);
    state.league.currentPhase = "OFFSEASON_POST_DRAFT";
    state.freeAgency = { opened: true, currentDay: 1, offers: {}, markets: {}, settledPlayerDay: {}, transactionLog: [] };
    const release = (teamId: string, status: "UFA" | "RFA") => {
      const playerId = state.teams[teamId].playerIds.pop()!;
      const player = state.players[playerId];
      player.teamId = "FREE_AGENT";
      player.contract.status = status;
      player.contract.yearsRemaining = 0;
      player.birdTeamId = teamId;
      return playerId;
    };
    const otherTeamId = Object.keys(state.teams).find((id) => id !== state.userTeamId)!;
    const ownUfaId = release(state.userTeamId, "UFA");
    const marketUfaId = release(otherTeamId, "UFA");
    const ownRfaId = rfaCount > 0 ? release(state.userTeamId, "RFA") : undefined;
    for (let index = 1; index < rfaCount; index += 1) release(otherTeamId, "RFA");
    const freeAgents = getFreeAgents(state);
    const markup = renderToStaticMarkup(createElement(App, { initialState: state }));
    expect(markup.match(/class="fa-reference-player-card"/g)).toHaveLength(freeAgents.length);
    for (const player of freeAgents) expect(markup).toContain(`data-testid="open-fa-offer-${player.id}"`);
    const marketSection = markup.slice(markup.indexOf("自由球员列表"));
    expect(marketSection).toContain(`data-testid="open-fa-offer-${ownUfaId}"`);
    expect(marketSection).toContain(`data-testid="open-fa-offer-${marketUfaId}"`);
    if (ownRfaId) {
      const ownSection = markup.slice(markup.indexOf('class="fa-own-free-agent-section"'), markup.indexOf("自由球员列表"));
      expect(ownSection).toContain(`data-testid="open-fa-offer-${ownRfaId}"`);
      expect(ownSection).not.toContain(`data-testid="open-fa-offer-${ownUfaId}"`);
      expect(ownSection).not.toContain(`data-testid="open-fa-offer-${marketUfaId}"`);
      expect(marketSection).not.toContain(`data-testid="open-fa-offer-${ownRfaId}"`);
    } else {
      expect(markup).not.toContain('class="fa-own-free-agent-section"');
    }
    const marketCount = freeAgents.length - (ownRfaId ? 1 : 0);
    expect(markup).toContain(`(${marketCount}/${marketCount} 人)`);
    expect(markup).not.toContain("当前显示受限制自由球员");
    expect(markup).not.toContain("当前筛选条件下暂无可用自由球员");
  });

  it("uses a fresh command id when an offseason offer is withdrawn and retried on the same day", () => {
    const state = createCareer("offseason-offer-ids");
    state.freeAgency = { opened: true, currentDay: 1, offers: {}, markets: {}, settledPlayerDay: {}, transactionLog: [] };
    const playerId = "retry-player";
    const first = freeAgencyOfferCommandId(state, playerId);
    state.freeAgency.offers.previous = { offerId: "previous", teamId: state.userTeamId, playerId, status: "WITHDRAWN" } as typeof state.freeAgency.offers[string];
    const second = freeAgencyOfferCommandId(state, playerId);
    expect(second).not.toBe(first);
    expect(freeAgencyOfferCommandId(structuredClone(state), playerId)).toBe(second);
  });
  it("explains that a rejected free-agent offer can be revised in a new decision window", () => {
    const state = createCareer("rejected-offer-market-label");
    state.league.currentPhase = "OFFSEASON_POST_DRAFT";
    const userTeam = state.teams[state.userTeamId];
    const playerId = userTeam.playerIds.pop();
    if (!playerId) throw new Error("Expected a roster player");
    state.players[playerId].teamId = "FREE_AGENT";
    state.players[playerId].contract.status = "RFA";
    state.players[playerId].birdTeamId = state.userTeamId;
    for (const id of userTeam.playerIds) state.players[id].contract.salary = 0;
    state.capState.capHolds = [];
    state.capState.offerReservations = [];
    state.freeAgency = {
      opened: true, currentDay: 4, settledPlayerDay: {}, transactionLog: [],
      markets: { [playerId]: { playerId, marketWindowStartDay: 1, decisionDeadline: 3, marketWindowStatus: "CLOSED_NO_SIGNING" } },
      offers: { rejected: {
        offerId: "rejected", playerId, teamId: state.userTeamId, createdDay: 1, expiresDay: 3,
        years: 2, year1Salary: 4_000_000, totalValue: 8_000_000, guaranteedValue: 8_000_000,
        rolePromised: "ROTATION", capReservation: 4_000_000, utility: 30,
        status: "REJECTED", resolutionReason: "PLAYER_REJECTED", kind: "RFA_OWN_TEAM_OFFER",
      } },
    };
    const markup = renderToStaticMarkup(createElement(App, { initialState: state }));
    expect(markup).toContain("此前报价被拒绝，可调整条件重新报价");
    expect(markup).toContain("当前要价");
    expect(markup).toContain("参考估值");
    expect(markup).toContain(`data-testid="open-fa-offer-${playerId}"`);
    expect(markup).toContain("重新报价");
  });
  it("shows free agents during the season without offering an unsupported signing action", () => {
    const state = createCareer("regular-season-free-agents");
    state.league.currentPhase = "REGULAR_PRE_DEADLINE";
    const player = state.players[state.teams[state.userTeamId].playerIds[0]];
    player.teamId = "FREE_AGENT";
    player.contract.status = "UFA";
    player.freeAgentDemand = { uncontestedDays: 100 };
    const markup = renderToStaticMarkup(createElement(RegularSeasonFreeAgents, { state, onOpenPlayer: () => {} }));
    expect(markup).toContain(`data-player-id="${player.id}"`);
    expect(markup.match(/data-player-id="/g)).toHaveLength(getFreeAgents(state).length);
    expect(markup).toContain("赛季中可浏览未签约球员");
    expect(markup).toContain("下一日历日结算（包括休息日）");
    expect(markup).toContain("当前要价");
    expect(markup).toContain("参考估值");
    expect(markup).not.toContain("下一比赛日结算");
    expect(markup).not.toContain("FREE AGENTS");
    expect(markup).not.toContain('data-testid="submit-fa-offer"');
    expect(markup).toContain("休赛期到期");
  });

  it("colors a rounded 80 OVR consistently in the regular-season free-agent list", () => {
    const state = createCareer("regular-free-agent-rating-color");
    state.league.currentPhase = "REGULAR_PRE_DEADLINE";
    const player = state.players[state.teams[state.userTeamId].playerIds[0]];
    player.teamId = "FREE_AGENT";
    player.contract.status = "UFA";
    player.overallAdjustment = (player.overallAdjustment ?? 0) + 79.5 - calculatePlayerOverall(player);
    const markup = renderToStaticMarkup(createElement(RegularSeasonFreeAgents, { state, onOpenPlayer: () => {} }));
    expect(markup).toContain(`<strong class="player-rating-tone" style="--player-rating-color:${PLAYER_RATING_COLORS.excellent}">80</strong>`);
  });

  it("distinguishes an active regular-season offer from the new-offer action", () => {
    const state = createCareer("regular-season-withdraw-style");
    state.league.currentPhase = "REGULAR_PRE_DEADLINE";
    const player = state.players[state.teams[state.userTeamId].playerIds[0]];
    player.teamId = "FREE_AGENT";
    player.contract.status = "UFA";
    const renderMarket = () => renderToStaticMarkup(createElement(RegularSeasonFreeAgents, {
      state, onOpenPlayer: () => {}, onCommand: async () => {},
    }));
    expect(renderMarket()).toContain('class="regular-free-agent-offer"');
    state.freeAgency = {
      opened: true, currentDay: 1, settledPlayerDay: {}, transactionLog: [], markets: {},
      offers: { active: { offerId: "active", teamId: state.userTeamId, playerId: player.id, status: "ACTIVE" } as NonNullable<typeof state.freeAgency>["offers"][string] },
    };
    expect(renderMarket()).toContain('class="regular-free-agent-offer withdraw"');
    expect(renderMarket()).toContain("撤回报价");
  });

  it("previews only rostered players whose contract expires after this season", () => {
    const state = createCareer("market-upcoming-free-agents");
    const [expiringId, continuingId, otherId, legacyId] = state.teams[state.userTeamId].playerIds;
    const expiring = state.players[expiringId];
    expiring.contract = { ...expiring.contract, status: "STANDARD", yearsRemaining: 1,
      salaryByYear: [4_000_000, 5_000_000], currentYearIndex: 1 };
    const continuing = state.players[continuingId];
    continuing.contract = { ...continuing.contract, status: "STANDARD", yearsRemaining: 2,
      salaryByYear: [4_000_000, 5_000_000], currentYearIndex: 0,
      optionByYear: ["NONE", "PLAYER_OPTION"] };
    const other = state.players[otherId];
    other.teamId = "FREE_AGENT";
    other.contract.status = "UFA";
    const legacy = state.players[legacyId];
    legacy.contract = { ...legacy.contract, status: "STANDARD", yearsRemaining: 1,
      salaryByYear: [4_000_000, 5_000_000], currentYearIndex: undefined };
    const upcoming = getUpcomingFreeAgents(state);
    expect(upcoming).toContain(expiring);
    expect(upcoming).toContain(legacy);
    expect(upcoming).not.toContain(continuing);
    expect(upcoming).not.toContain(other);
    const market = renderToStaticMarkup(createElement(RegularSeasonFreeAgents, { state, onOpenPlayer: () => {}, onCommand: async () => {} }));
    expect(market).toContain(`休赛期到期 <span>${upcoming.length}</span>`);
    expect(market).toContain("当前自由球员");
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
      renewalRecords: ["Jayson Tatum 与 凯尔特人 在自由市场开放前完成续约"],
      players: state.players,
    }));
    expect(records).toContain("交易 / 续约记录");
    expect(records).toContain("交易");
    expect(records).toContain("续约");
    expect(records).toContain("我方成交");
    expect(records).toContain("联盟交易");
    expect(records).not.toMatch(/TRADE HISTORY|MY TRADES|LEAGUE TRADES/);
    expect(records).toContain("凯尔特人 / 灰熊");
    expect(records).toContain("勒布朗·詹姆斯");
    expect(records).toContain("保罗·乔治");
    expect(records).toContain("杰拉米·格兰特");
    expect(records).not.toContain("Paul George");
    expect(records).toContain("3 笔");
    expect(records).toContain("提前续约");
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

  it("uses each target offer's highest OVR outgoing player portrait", () => {
    const state = createCareer("target-inquiry-portrait");
    const userRoster = state.teams[state.userTeamId].playerIds.map((id) => state.players[id])
      .sort((a, b) => calculatePlayerOverall(b) - calculatePlayerOverall(a) || a.id.localeCompare(b.id));
    const highestOverall = userRoster[0];
    const lowerOverall = userRoster[userRoster.length - 1];
    const otherTeam = Object.values(state.teams).find((team) => team.id !== state.userTeamId && team.playerIds.length > 0);
    if (!highestOverall || !lowerOverall || !otherTeam) throw new Error("Expected both teams to have players");
    const incomingId = otherTeam.playerIds[0];
    const offer = {
      offerId: "portrait-test", inquiryKey: "portrait-test", inquiryCount: 0, counterpartyTeamId: otherTeam.id,
      userOutgoingPlayerIds: [lowerOverall.id, highestOverall.id], userOutgoingPickIds: [], userIncomingPlayerIds: [incomingId], userIncomingPickIds: [], status: "AVAILABLE",
    } satisfies TradeOffer;
    expect(tradeOfferPortraitPlayer(state, offer, "TARGET")?.id).toBe(highestOverall.id);
    expect(tradeOfferPortraitPlayer(state, { ...offer, offerId: "second-offer", userOutgoingPlayerIds: [lowerOverall.id] }, "TARGET")?.id).toBe(lowerOverall.id);
    expect(tradeOfferPortraitPlayer(state, { ...offer, offerId: "pick-only", userOutgoingPlayerIds: [] }, "TARGET")).toBeUndefined();
    expect(tradeOfferPortraitPlayer(state, offer, "ASSET")?.id).toBe(incomingId);
  });

  it("reopens the trade tab without chips or stale quotes after clearing them", () => {
    const state = createCareer("market-clear-chips");
    state.league.currentPhase = "REGULAR_PRE_DEADLINE";
    const playerId = state.teams[state.userTeamId].playerIds[5];
    const quoted = generateTradeOffers(state, playerId, false);
    const cleared = executeTradeCommand(quoted, {
      commandId: "clear-market-chips", type: "SET_TRADE_ASSETS", payload: { playerIds: [], pickIds: [] },
    });
    const markup = renderToStaticMarkup(createElement(TradeDesk, { state: cleared, busy: false, onTradeCommand: async () => {} }));
    expect(markup).toContain("选择我方交易筹码");
    expect(markup).toContain("0 个方案");
    expect(markup).not.toContain('class="trade-console-offer-card"');
  });

  it("hides completed quotes and clears trade chips after accepting an offer", () => {
    const state = createCareer("market-accepted-quote-reset");
    state.league.currentPhase = "REGULAR_PRE_DEADLINE";
    const playerId = state.teams[state.userTeamId].playerIds[5];
    const quoted = generateTradeOffers(state, playerId, false);
    const accepted = executeTradeCommand(quoted, {
      commandId: "market-accepted-quote-reset", type: "ACCEPT_TRADE_OFFER", payload: { offerId: quoted.tradeDesk.offers[0].offerId },
    });
    const markup = renderToStaticMarkup(createElement(TradeDesk, { state: accepted, busy: false, onTradeCommand: async () => {} }));
    expect(markup).toContain("选择我方交易筹码");
    expect(markup).toContain("0 个方案");
    expect(markup).not.toContain('class="trade-console-offer-card"');
    expect(accepted.tradeDesk.offers.some((offer) => offer.status === "ACCEPTED")).toBe(true);
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

  it("shows player and draft-pick controls for a bundled inquiry", () => {
    const state = createCareer("market-bundled-inquiry");
    state.league.currentPhase = "REGULAR_PRE_DEADLINE";
    const pick = Object.values(state.draftPicks).find((asset) => asset.ownerTeamId === state.userTeamId && asset.year > state.league.seasonYear);
    if (!pick) throw new Error("Expected a future user draft pick");
    const markup = renderToStaticMarkup(createElement(TradeDesk, { state, busy: false, onTradeCommand: async () => {} }));
    expect(markup).toContain("获取报价");
    expect(markup).toContain("选择我方交易筹码");
    expect(tradeInquiryCommandId(state, [state.teams[state.userTeamId].playerIds[0]], [pick.id])).not.toBe(
      tradeInquiryCommandId(state, [state.teams[state.userTeamId].playerIds[0]], []),
    );
  });

  it("counts tradeable roster players once by primary position", () => {
    const state = createCareer("trade-assets-by-position");
    const roster = state.teams[state.userTeamId].playerIds.map((id) => state.players[id]);
    const counts = tradeAssetPositionCounts(roster);
    expect(counts.ALL).toBe(roster.length);
    expect(counts.PG + counts.SG + counts.SF + counts.PF + counts.C).toBe(roster.length);
    expect(counts.PG).toBe(roster.filter((player) => player.position === "PG").length);
  });

  it("opens with asset inquiry even when the saved quote came from target search", () => {
    const state = createCareer("targeted-trade-search");
    state.league.currentPhase = "REGULAR_PRE_DEADLINE";
    const otherTeam = Object.values(state.teams).find((team) => team.id !== state.userTeamId && team.playerIds.length > 1);
    if (!otherTeam) throw new Error("Expected another team with multiple players");
    const targetIds = otherTeam.playerIds.slice(0, 2);
    state.tradeDesk.inquiryMode = "TARGET";
    state.tradeDesk.targetPlayerIds = targetIds;
    const markup = renderToStaticMarkup(createElement(TradeDesk, { state, busy: false, onTradeCommand: async () => {} }));
    expect(markup).toContain('class="selected" aria-pressed="true">我方筹码询价');
    expect(markup).toContain('aria-pressed="false">搜索目标球员');
    expect(markup).toContain("选择筹码并获取报价后");
    expect(markup).not.toContain('aria-label="按球队筛选目标球员"');
    expect(targetedTradeInquiryCommandId(state, targetIds)).toBe(targetedTradeInquiryCommandId(structuredClone(state), [...targetIds].reverse()));
    expect(targetedTradeInquiryCommandId(state, targetIds)).not.toBe(tradeInquiryCommandId(state, targetIds));
  });
});
