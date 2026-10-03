import { describe, expect, it } from "vitest";
import { stableHash, stableSerialize } from "../random/hash";
import { createCareer } from "../season/career";
import { publicPlayerValue, tradeDraftPickValue } from "../ai/AIValueService";
import { tradePlayerValue } from "./TradePlayerValue";
import { calculatePlayerOverall } from "../player/PlayerRatingService";
import { acceptTradeOffer, applyTradePackage, evaluateTradeOffer, executeCustomTrade, executeTradeCommand, generateTargetedTradeOffers, generateTradeOffers, isTradePhaseAllowed, validateTradePackage } from "./TradeService";
import { isUntouchable, untouchablePlayerIds } from "./TradeAvailabilityService";
import { setTrainingFocus } from "../roster/RosterService";
import { LEAGUE_FINANCE_CONFIG } from "../../config/leagueFinance";

function tradeState() {
  const state = createCareer("player-trade-tests");
  state.league.currentPhase = "OFFSEASON_POST_DRAFT";
  return state;
}

describe("TradeService", () => {
  it.each(["user", "counterparty"] as const)("rejects a saved quote leaving the %s with only four available players without transferring assets", (side) => {
    const state = tradeState();
    const quoted = generateTradeOffers(state, state.teams[state.userTeamId].playerIds[5], false);
    const offer = quoted.tradeDesk.offers.find((entry) => entry.userIncomingPlayerIds.length === 1)!;
    const teamId = side === "user" ? quoted.userTeamId : offer.counterpartyTeamId;
    const outgoingIds = side === "user" ? offer.userOutgoingPlayerIds : offer.userIncomingPlayerIds;
    const incomingIds = side === "user" ? offer.userIncomingPlayerIds : offer.userOutgoingPlayerIds;
    const healthyIds = new Set([...outgoingIds, ...quoted.teams[teamId].playerIds.filter((id) => !outgoingIds.includes(id)).slice(0, 4)]);
    for (const id of quoted.teams[teamId].playerIds) quoted.players[id].available = healthyIds.has(id);
    for (const id of incomingIds) quoted.players[id].available = false;
    const trade = {
      leftTeamId: quoted.userTeamId, rightTeamId: offer.counterpartyTeamId,
      leftPlayerIds: offer.userOutgoingPlayerIds, rightPlayerIds: offer.userIncomingPlayerIds,
      leftPickIds: offer.userOutgoingPickIds, rightPickIds: offer.userIncomingPickIds,
    };
    const before = stableHash(stableSerialize(quoted));
    expect(evaluateTradeOffer(quoted, offer.offerId)).toMatchObject({ legal: false, reason: "交易后任一球队可用球员不能少于 5 人" });
    expect(() => executeTradeCommand(quoted, { commandId: `unavailable-${side}`, type: "ACCEPT_TRADE_OFFER", payload: { offerId: offer.offerId } })).toThrow("可用球员不能少于 5 人");
    expect(() => applyTradePackage(quoted, trade)).toThrow("ROSTER_BELOW_AVAILABLE_MINIMUM");
    expect(() => executeCustomTrade(quoted, trade)).toThrow("ROSTER_BELOW_AVAILABLE_MINIMUM");
    expect(stableHash(stableSerialize(quoted))).toBe(before);
  });

  it("does not generate targeted quotes that reduce five available players to four", () => {
    const state = createCareer("trade-black-screen-generated");
    state.league.currentPhase = "OFFSEASON_PRE_DRAFT";
    state.league.seasonYear = 2027;
    state.league.seasonId = "2027-28";
    state.teams[state.userTeamId].playerIds.forEach((id, index) => { state.players[id].available = index < 5; });
    state.players["POR-P04"].available = false;
    const quoted = generateTargetedTradeOffers(state, ["POR-P04"]);
    expect(quoted.tradeDesk.offers.length).toBeGreaterThan(0);
    for (const offer of quoted.tradeDesk.offers) {
      const remaining = quoted.teams[quoted.userTeamId].playerIds.filter((id) => !offer.userOutgoingPlayerIds.includes(id));
      const available = remaining.concat(offer.userIncomingPlayerIds).filter((id) => quoted.players[id].available && !quoted.players[id].injury);
      expect(available.length).toBeGreaterThanOrEqual(5);
      expect(evaluateTradeOffer(quoted, offer.offerId).legal).toBe(true);
    }
  });

  it("rejects incomplete quote assets instead of throwing during evaluation", () => {
    const state = tradeState();
    const quoted = generateTradeOffers(state, state.teams[state.userTeamId].playerIds[5], false);
    const offer = quoted.tradeDesk.offers[0];
    Reflect.deleteProperty(offer, "userIncomingPickIds");
    const before = stableHash(stableSerialize(quoted));
    expect(evaluateTradeOffer(quoted, offer.offerId)).toMatchObject({ legal: false, reason: "交易方案数据不完整，请重新获取报价" });
    expect(() => acceptTradeOffer(quoted, offer.offerId)).toThrow("交易方案数据不完整");
    expect(stableHash(stableSerialize(quoted))).toBe(before);
  });

  it("executes a player-selected pick swap through the same trade validation path", () => {
    const state = tradeState();
    const leftTeamId = state.userTeamId;
    const rightTeamId = Object.keys(state.teams).find((id) => id !== leftTeamId) as string;
    const leftPick = Object.values(state.draftPicks).find((pick) => pick.ownerTeamId === leftTeamId && pick.round === 2)!;
    const rightPick = Object.values(state.draftPicks).find((pick) => pick.ownerTeamId === rightTeamId && pick.round === 2)!;
    const next = executeCustomTrade(state, { leftTeamId, rightTeamId, leftPlayerIds: [], rightPlayerIds: [], leftPickIds: [leftPick.id], rightPickIds: [rightPick.id] });
    expect(next.draftPicks[leftPick.id].ownerTeamId).toBe(rightTeamId);
    expect(next.draftPicks[rightPick.id].ownerTeamId).toBe(leftTeamId);
    expect(next.gmCareer.tradeHistory.at(-1)?.summary).toContain("签");
  });

  it("releases training slots on either trade side and does not restore a plan after a return trade", () => {
    for (const userOnLeft of [true, false]) {
      let state = createCareer(`trade-training-${userOnLeft}`);
      state.league.currentPhase = "PRESEASON";
      const userTeam = state.teams[state.userTeamId];
      const counterpart = state.teams.CHA;
      const outgoing = userTeam.playerIds.filter((id) => state.players[id].contract.status === "STANDARD")
        .sort((a, b) => calculatePlayerOverall(state.players[a]) - calculatePlayerOverall(state.players[b]))[0];
      const incoming = counterpart.playerIds.find((id) => state.players[id].contract.status === "STANDARD" && !isUntouchable(state, id))!;
      for (const team of [userTeam, counterpart]) for (const id of team.playerIds) state.players[id].contract.salary = LEAGUE_FINANCE_CONFIG.minimumSalary;
      state = setTrainingFocus(state, outgoing, "SHOOTING");
      const trade = {
        leftTeamId: userOnLeft ? userTeam.id : counterpart.id,
        rightTeamId: userOnLeft ? counterpart.id : userTeam.id,
        leftPlayerIds: [userOnLeft ? outgoing : incoming], rightPlayerIds: [userOnLeft ? incoming : outgoing],
        leftPickIds: [], rightPickIds: [],
      };
      applyTradePackage(state, trade);
      expect(state.players[outgoing].teamId).toBe(counterpart.id);
      expect(state.trainingPlan?.assignments).toEqual({});
      const [first, second] = state.teams[state.userTeamId].playerIds;
      state = setTrainingFocus(state, first, "DEFENSE");
      state = setTrainingFocus(state, second, "BALANCED");
      expect(Object.keys(state.trainingPlan!.assignments)).toHaveLength(2);
      applyTradePackage(state, { ...trade, leftPlayerIds: trade.rightPlayerIds, rightPlayerIds: trade.leftPlayerIds });
      expect(state.players[outgoing].teamId).toBe(state.userTeamId);
      expect(state.trainingPlan?.assignments[outgoing]).toBeUndefined();
    }
  });

  it("rejects untouchables in direct packages, targeted inquiries and saved offers", () => {
    const state = tradeState();
    const protectedTeam = Object.values(state.teams).find((team) => team.id !== state.userTeamId
      && untouchablePlayerIds(state, team.id).length > 0);
    if (!protectedTeam) throw new Error("Expected a protected AI player");
    const protectedId = untouchablePlayerIds(state, protectedTeam.id)[0];
    const outgoingId = state.teams[state.userTeamId].playerIds[5];
    expect(isUntouchable(state, protectedId)).toBe(true);
    const packageWithProtected = {
      leftTeamId: state.userTeamId, rightTeamId: protectedTeam.id,
      leftPlayerIds: [outgoingId], rightPlayerIds: [protectedId], leftPickIds: [], rightPickIds: [],
    };
    const before = stableHash(stableSerialize(state));
    expect(() => validateTradePackage(state, packageWithProtected)).toThrow("PLAYER_UNTOUCHABLE");
    expect(() => applyTradePackage(state, packageWithProtected)).toThrow("PLAYER_UNTOUCHABLE");
    expect(() => generateTargetedTradeOffers(state, [protectedId])).toThrow("PLAYER_UNTOUCHABLE");
    expect(stableHash(stableSerialize(state))).toBe(before);
    expect(Object.keys(state.tradeInquiryCount)).toHaveLength(0);

    const quoted = generateTradeOffers(state, outgoingId, false);
    expect(quoted.tradeDesk.offers.every((offer) => !offer.userIncomingPlayerIds.some((id) => isUntouchable(quoted, id)))).toBe(true);
    const legacy = structuredClone(state);
    legacy.tradeDesk = {
      selectedPlayerId: outgoingId, selectedPlayerIds: [outgoingId], selectedPickIds: [],
      offers: [{
        offerId: "legacy-protected-quote", inquiryKey: "legacy", inquiryCount: 0, counterpartyTeamId: protectedTeam.id,
        userOutgoingPlayerIds: [outgoingId], userOutgoingPickIds: [], userIncomingPlayerIds: [protectedId],
        userIncomingPickIds: [], status: "AVAILABLE",
      }],
    };
    const restored = JSON.parse(JSON.stringify(legacy)) as typeof legacy;
    expect(evaluateTradeOffer(restored, "legacy-protected-quote")).toMatchObject({
      legal: false, gmWillingness: "拒绝", reason: "对方将该球员列为非卖品，无法交易",
    });
    expect(() => acceptTradeOffer(restored, "legacy-protected-quote")).toThrow("对方将该球员列为非卖品，无法交易");
    expect(restored.players[protectedId].teamId).toBe(protectedTeam.id);
  });

  it("asks one team for legal multi-player target packages and commits every target", () => {
    const state = tradeState();
    const targetIds = state.teams.MIA.playerIds.slice(5, 7);
    const myIds = state.teams[state.userTeamId].playerIds.slice(5, 7);
    for (const id of [...targetIds, ...myIds]) {
      const player = state.players[id];
      player.overallAdjustment = 76 - calculatePlayerOverall(player);
      player.age = 27;
      player.scoutedPotentialGrade = "C";
      player.contract.salary = 5_000_000;
      player.contract.guaranteedAmount = 5_000_000;
      player.contract.guaranteedByYear = [5_000_000];
      player.contract.yearsRemaining = 1;
    }
    const before = stableHash(stableSerialize(state));
    const queried = executeTradeCommand(state, {
      commandId: "targeted-mia-two", type: "GENERATE_TARGETED_TRADE_OFFERS", payload: { targetPlayerIds: [...targetIds].reverse() },
    });
    expect(stableHash(stableSerialize(state))).toBe(before);
    expect(queried.tradeDesk).toMatchObject({ inquiryMode: "TARGET", targetPlayerIds: [...targetIds].sort() });
    expect(queried.tradeDesk.offers.length).toBeGreaterThan(0);
    expect(queried.tradeDesk.offers.length).toBeLessThanOrEqual(3);
    expect(generateTargetedTradeOffers(state, targetIds).tradeDesk.offers).toEqual(queried.tradeDesk.offers);
    const refreshed = generateTargetedTradeOffers(queried, targetIds, true);
    expect(refreshed.tradeDesk.offers[0].inquiryCount).toBe(1);
    expect(queried.tradeDesk.offers[0].inquiryCount).toBe(0);
    for (const offer of queried.tradeDesk.offers) {
      expect(offer.counterpartyTeamId).toBe("MIA");
      expect(offer.userIncomingPlayerIds).toEqual([...targetIds].sort());
      expect(offer.userOutgoingPlayerIds.length + offer.userOutgoingPickIds.length).toBeGreaterThan(0);
      expect(evaluateTradeOffer(queried, offer.offerId).legal).toBe(true);
    }
    expect(executeTradeCommand(queried, {
      commandId: "targeted-mia-two", type: "GENERATE_TARGETED_TRADE_OFFERS", payload: { targetPlayerIds: [...targetIds].reverse() },
    })).toBe(queried);
    const loaded = JSON.parse(JSON.stringify(queried)) as typeof queried;
    const accepted = executeTradeCommand(loaded, {
      commandId: "accept-targeted", type: "ACCEPT_TRADE_OFFER", payload: { offerId: loaded.tradeDesk.offers[0].offerId },
    });
    for (const id of targetIds) expect(accepted.players[id].teamId).toBe(state.userTeamId);
    expect(accepted.tradeDesk).toMatchObject({ targetPlayerIds: [], selectedPlayerIds: [], selectedPickIds: [] });
    expect(accepted.tradeDesk.offers.find((offer) => offer.offerId === loaded.tradeDesk.offers[0].offerId)?.status).toBe("ACCEPTED");
    expect(executeTradeCommand(accepted, {
      commandId: "accept-targeted", type: "ACCEPT_TRADE_OFFER", payload: { offerId: loaded.tradeDesk.offers[0].offerId },
    })).toBe(accepted);
  });

  it("can quote and transfer multiple picks for a high-value target", () => {
    const state = createCareer("multipick-probe");
    state.league.currentPhase = "OFFSEASON_POST_DRAFT";
    const targetId = Object.values(state.teams)
      .filter((team) => team.id !== state.userTeamId)
      .flatMap((team) => team.playerIds)
      .filter((id) => !isUntouchable(state, id))
      .sort((a, b) => tradePlayerValue(state.players[b]) - tradePlayerValue(state.players[a]))[0];
    const queried = generateTargetedTradeOffers(state, [targetId]);
    const offer = queried.tradeDesk.offers.find((entry) => entry.userOutgoingPickIds.length > 1);
    expect(offer).toBeDefined();
    expect(evaluateTradeOffer(queried, offer!.offerId).legal).toBe(true);
    const accepted = acceptTradeOffer(queried, offer!.offerId);
    for (const id of offer!.userOutgoingPickIds) expect(accepted.draftPicks[id].ownerTeamId).toBe(offer!.counterpartyTeamId);
    expect(accepted.players[targetId].teamId).toBe(state.userTeamId);
  });

  it("rejects invalid targeted requests without changing the save or inquiry counter", () => {
    const state = tradeState();
    const target = state.teams.MIA.playerIds[5];
    const anotherTeam = Object.values(state.teams).find((team) => team.id !== state.userTeamId && team.id !== "MIA");
    if (!anotherTeam) throw new Error("Missing opposing team");
    const before = stableHash(stableSerialize(state));
    expect(() => generateTargetedTradeOffers(state, [])).toThrow("TARGET_PLAYER_REQUIRED");
    expect(() => generateTargetedTradeOffers(state, [target, target])).toThrow("DUPLICATE_TRADE_ASSET");
    expect(() => generateTargetedTradeOffers(state, [target, anotherTeam.playerIds[5]])).toThrow("TARGET_TEAM_INVALID");
    expect(() => generateTargetedTradeOffers(state, [state.teams[state.userTeamId].playerIds[5]])).toThrow("TARGET_TEAM_INVALID");
    expect(() => generateTargetedTradeOffers(state, [target, ...state.teams.MIA.playerIds.slice(6, 9)])).toThrow("TOO_MANY_TARGET_PLAYERS");
    state.players[target].contract.status = "UFA";
    const withIllegalTarget = stableHash(stableSerialize(state));
    expect(() => generateTargetedTradeOffers(state, [target])).toThrow("TARGET_PLAYER_NOT_TRADEABLE");
    expect(stableHash(stableSerialize(state))).toBe(withIllegalTarget);
    expect(Object.keys(state.tradeInquiryCount)).toHaveLength(0);
    expect(before).not.toBe(withIllegalTarget);
  });
  it("invalidates a saved quote that swaps a core player and a second for two lower-rated players", () => {
    const state = tradeState();
    // A rebuilding club's older star can still be traded, but the normal core-return premium applies.
    state.aiTeamProfiles.MIA.direction = "REBUILD";
    const outgoingIds = state.teams[state.userTeamId].playerIds.slice(5, 7);
    const coreId = state.teams.MIA.playerIds[0];
    const second = Object.values(state.draftPicks).find((pick) => pick.ownerTeamId === "MIA" && pick.round === 2 && pick.year === 2027);
    if (outgoingIds.length !== 2 || !coreId || !second) throw new Error("Missing trade fixture assets");
    for (const id of state.teams[state.userTeamId].playerIds) state.players[id].contract.salary = 1_000_000;
    for (const [id, overall, salary, age] of [
      [outgoingIds[0], 78, 14_500_000, 29],
      [outgoingIds[1], 75, 15_510_000, 33],
      [coreId, 86, 53_450_000, 33],
    ] as const) {
      const player = state.players[id];
      player.overallAdjustment = overall - calculatePlayerOverall(player);
      player.age = age;
      player.scoutedPotentialGrade = "C";
      player.contract.salary = salary;
      player.contract.yearsRemaining = 3;
      player.contract.guaranteedAmount = salary;
      player.contract.guaranteedByYear = [salary, salary, salary];
    }
    const offer = {
      offerId: "legacy-core-quote", inquiryKey: "legacy", inquiryCount: 0, counterpartyTeamId: "MIA",
      userOutgoingPlayerIds: outgoingIds, userOutgoingPickIds: [],
      userIncomingPlayerIds: [coreId], userIncomingPickIds: [second.id], status: "AVAILABLE" as const,
    };
    state.tradeDesk = { selectedPlayerId: outgoingIds[0], selectedPlayerIds: outgoingIds, selectedPickIds: [], offers: [offer] };
    const publicGap = outgoingIds.reduce((sum, id) => sum + publicPlayerValue(state.players[id]), 0)
      - publicPlayerValue(state.players[coreId]) - tradeDraftPickValue(state, second);
    expect(publicGap).toBeGreaterThanOrEqual(-4);
    expect(publicGap).toBeLessThan(16);
    expect(() => validateTradePackage(state, {
      leftTeamId: state.userTeamId, rightTeamId: "MIA", leftPlayerIds: outgoingIds, rightPlayerIds: [coreId], leftPickIds: [], rightPickIds: [second.id],
    })).not.toThrow();
    expect(evaluateTradeOffer(state, offer.offerId)).toMatchObject({ legal: false, gmWillingness: "拒绝", reason: "对方核心球员换成较低评分球员，需要更高价值的回报" });
    expect(() => acceptTradeOffer(state, offer.offerId)).toThrow("对方核心球员换成较低评分球员，需要更高价值的回报");
    const fresh = generateTradeOffers(state, { playerIds: outgoingIds, pickIds: [] }, false);
    expect(fresh.tradeDesk.offers.some((candidate) => candidate.counterpartyTeamId === "MIA"
      && candidate.userIncomingPlayerIds.includes(coreId))).toBe(false);
  });
  it("generates three stable offers and increments inquiry count only on refresh", () => {
    const state = tradeState();
    const playerId = state.teams[state.userTeamId].playerIds[5];
    const first = generateTradeOffers(state, playerId, false);
    expect(first.tradeDesk.offers).toHaveLength(3);
    expect(first.tradeDesk.offers[0].inquiryCount).toBe(0);
    expect(generateTradeOffers(first, playerId, false).tradeDesk.offers[0].inquiryCount).toBe(0);
    expect(generateTradeOffers(first, playerId, true).tradeDesk.offers[0].inquiryCount).toBe(1);
  });

  it("invalidates a saved offer when season production changes its asset-value balance", () => {
    const state = tradeState();
    const playerId = state.teams[state.userTeamId].playerIds[5];
    const queried = generateTradeOffers(state, playerId, false);
    const offer = queried.tradeDesk.offers.find((entry) => entry.userIncomingPlayerIds.length > 0);
    if (!offer) throw new Error("Expected a player offer");
    expect(evaluateTradeOffer(queried, offer.offerId).legal).toBe(true);
    const outgoing = queried.players[playerId];
    const incoming = queried.players[offer.userIncomingPlayerIds[0]];
    outgoing.seasonStats = { ...outgoing.seasonStats, games: 30, seconds: 30 * 30 * 60 };
    incoming.seasonStats = {
      ...incoming.seasonStats, games: 30, seconds: 30 * 30 * 60,
      pts: 30 * 38, fgm: 30 * 15, fga: 30 * 24, reb: 30 * 10,
      ast: 30 * 9, stl: 30 * 2, blk: 30 * 2,
    };
    const evaluation = evaluateTradeOffer(queried, offer.offerId);
    expect(evaluation.legal).toBe(false);
    expect(evaluation.reason).toContain("重新获取报价");
    const loaded = JSON.parse(JSON.stringify(queried)) as typeof queried;
    expect(evaluateTradeOffer(loaded, offer.offerId)).toMatchObject({ legal: false, reason: evaluation.reason });
  });

  it("prices fresh inquiries with the same season-adjusted value shown in the offer", () => {
    const state = tradeState();
    const playerId = state.teams[state.userTeamId].playerIds[5];
    const player = state.players[playerId];
    player.seasonStats = {
      ...player.seasonStats, games: 25, seconds: 25 * 30 * 60,
      pts: 25 * 24, fgm: 25 * 9, fga: 25 * 17,
      reb: 25 * 7, ast: 25 * 6, stl: 25, blk: 25,
    };
    const quoted = generateTradeOffers(state, playerId, false);
    const value = tradePlayerValue(quoted.players[playerId]);
    for (const offer of quoted.tradeDesk.offers) {
      expect(offer.playerValueSnapshot?.[playerId]).toBe(value);
      expect(evaluateTradeOffer(quoted, offer.offerId).outgoingAssetValue).toBeCloseTo(value);
    }
  });

  it("persists an empty asset selection and discards quotes tied to the removed chips", () => {
    const state = tradeState();
    const playerId = state.teams[state.userTeamId].playerIds[5];
    const quoted = generateTradeOffers(state, playerId, false);
    const cleared = executeTradeCommand(quoted, {
      commandId: "clear-trade-assets", type: "SET_TRADE_ASSETS", payload: { playerIds: [], pickIds: [] },
    });
    expect(cleared.tradeDesk).toMatchObject({ selectedPlayerIds: [], selectedPickIds: [], offers: [] });
    expect(quoted.tradeDesk.offers.length).toBeGreaterThan(0);
    expect(executeTradeCommand(cleared, {
      commandId: "clear-trade-assets", type: "SET_TRADE_ASSETS", payload: { playerIds: [], pickIds: [] },
    })).toBe(cleared);
    expect(() => generateTradeOffers(cleared, { playerIds: [], pickIds: [] }, false)).toThrow("TRADE_ASSET_REQUIRED");
  });

  it("keeps legal quotes available across 20 fixed seeds after core-player protection", () => {
    for (let index = 0; index < 20; index += 1) {
      const state = createCareer(`core-quote-balance-${index}`);
      state.league.currentPhase = "OFFSEASON_POST_DRAFT";
      const selectedId = state.teams[state.userTeamId].playerIds[5];
      const quoted = generateTradeOffers(state, selectedId, false);
      expect(quoted.tradeDesk.offers.length, `seed ${index}`).toBe(3);
      expect(quoted.tradeDesk.offers.every((offer) => evaluateTradeOffer(quoted, offer.offerId).legal), `seed ${index}`).toBe(true);
    }
  }, 90_000);

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

  it("records an incoming draft pick in the completed trade summary", () => {
    const state = tradeState();
    const playerId = state.teams[state.userTeamId].playerIds[5];
    const queried = generateTradeOffers(state, playerId, false);
    const offer = queried.tradeDesk.offers[0];
    const pick = Object.values(queried.draftPicks).find((asset) => asset.ownerTeamId === offer.counterpartyTeamId && asset.round === 2);
    if (!pick) throw new Error("Expected a counterparty second-round pick");
    offer.userIncomingPickIds = [pick.id];
    const accepted = acceptTradeOffer(queried, offer.offerId);
    expect(accepted.draftPicks[pick.id].ownerTeamId).toBe(accepted.userTeamId);
    expect(accepted.gmCareer.tradeHistory.at(-1)?.summary).toContain(`${pick.year}年次轮签`);
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

  it("returns only legal offers that preserve reasonable counterparty value", () => {
    const state = tradeState();
    const playerId = state.teams[state.userTeamId].playerIds[5];
    const queried = generateTradeOffers(state, playerId, false);
    for (const offer of queried.tradeDesk.offers) {
      const incoming = queried.players[offer.userIncomingPlayerIds[0]];
      const pickValue = offer.userIncomingPickIds.reduce((sum, id) => sum + tradeDraftPickValue(queried, queried.draftPicks[id]), 0);
      const evaluation = evaluateTradeOffer(queried, offer.offerId);
      expect(evaluation.legal).toBe(true);
      expect(evaluation.userValueDelta).toBeCloseTo(evaluation.incomingAssetValue - evaluation.outgoingAssetValue);
      expect(publicPlayerValue(queried.players[playerId]) - publicPlayerValue(incoming) - pickValue).toBeGreaterThanOrEqual(-4);
    }
    expect(new Set(queried.tradeDesk.offers.map((offer) => offer.counterpartyTeamId)).size).toBe(queried.tradeDesk.offers.length);
  });

  it("refuses a reserved draft pick before committing any assets", () => {
    const state = tradeState();
    const playerId = state.teams[state.userTeamId].playerIds[5];
    const queried = generateTradeOffers(state, playerId, false);
    const offer = queried.tradeDesk.offers[0];
    const pick = Object.values(queried.draftPicks).find((asset) => asset.ownerTeamId === offer.counterpartyTeamId && asset.round === 2);
    if (!pick) throw new Error("Expected a counterparty second-round pick");
    pick.reservedByCommitmentId = "future-obligation";
    offer.userIncomingPickIds = [pick.id];
    expect(evaluateTradeOffer(queried, offer.offerId).legal).toBe(false);
    expect(() => acceptTradeOffer(queried, offer.offerId)).toThrow("选秀权已被其他承诺占用");
    expect(queried.teams[queried.userTeamId].playerIds).toContain(playerId);
  });

  it("generates legal pick-only quotes with the bundle command payload", () => {
    const state = tradeState();
    const pick = Object.values(state.draftPicks).find((asset) => asset.ownerTeamId === state.userTeamId && asset.round === 2);
    if (!pick) throw new Error("Expected a second-round pick");
    const quoted = executeTradeCommand(state, {
      commandId: "pick-only", type: "GENERATE_TRADE_OFFERS", payload: { playerIds: [], pickIds: [pick.id], refresh: false },
    });
    expect(quoted.tradeDesk.selectedPlayerIds).toEqual([]);
    expect(quoted.tradeDesk.selectedPickIds).toEqual([pick.id]);
    expect(quoted.tradeDesk.offers.length).toBeGreaterThan(0);
    expect(quoted.tradeDesk.offers.every((offer) => evaluateTradeOffer(quoted, offer.offerId).legal)).toBe(true);
    const accepted = acceptTradeOffer(quoted, quoted.tradeDesk.offers[0].offerId);
    expect(accepted.draftPicks[pick.id].ownerTeamId).not.toBe(state.userTeamId);
  });

  it("quotes a two-player package with a draft pick and transfers every selected asset", () => {
    const state = tradeState();
    const playerIds = state.teams[state.userTeamId].playerIds.slice(5, 7);
    const pick = Object.values(state.draftPicks).find((asset) => asset.ownerTeamId === state.userTeamId && asset.round === 2);
    if (!pick) throw new Error("Expected a second-round pick");
    const quoted = generateTradeOffers(state, { playerIds, pickIds: [pick.id] }, false);
    expect(quoted.tradeDesk.offers.length).toBeGreaterThan(0);
    const offer = quoted.tradeDesk.offers[0];
    expect(offer.userOutgoingPlayerIds).toEqual([...playerIds].sort());
    expect(offer.userOutgoingPickIds).toEqual([pick.id]);
    const accepted = acceptTradeOffer(quoted, offer.offerId);
    for (const id of playerIds) expect(accepted.players[id].teamId).toBe(offer.counterpartyTeamId);
    expect(accepted.draftPicks[pick.id].ownerTeamId).toBe(offer.counterpartyTeamId);
  });

  it("enforces Stepien on the final pick ledger, including firsts received in the same trade", () => {
    const state = tradeState();
    const leftTeamId = state.userTeamId;
    const rightTeamId = Object.keys(state.teams).find((id) => id !== leftTeamId) as string;
    const ownFirsts = Object.values(state.draftPicks).filter((pick) => pick.ownerTeamId === leftTeamId && pick.originalTeamId === leftTeamId && pick.round === 1)
      .sort((a, b) => a.year - b.year);
    const otherFirst = Object.values(state.draftPicks).find((pick) => pick.ownerTeamId === rightTeamId && pick.year === ownFirsts[1].year && pick.round === 1);
    const otherSecond = Object.values(state.draftPicks).find((pick) => pick.ownerTeamId === rightTeamId && pick.round === 2);
    if (!otherFirst || !otherSecond) throw new Error("Expected draft assets");
    const trade = {
      leftTeamId, rightTeamId, leftPlayerIds: [], rightPlayerIds: [],
      leftPickIds: ownFirsts.slice(0, 2).map((pick) => pick.id), rightPickIds: [otherSecond.id],
    };
    const before = stableHash(stableSerialize(state));
    expect(() => validateTradePackage(state, trade)).toThrow("CONSECUTIVE_FIRST_ROUND_LIMIT");
    expect(() => applyTradePackage(state, trade)).toThrow("CONSECUTIVE_FIRST_ROUND_LIMIT");
    expect(stableHash(stableSerialize(state))).toBe(before);
    const balanced = { ...trade, rightPickIds: [otherFirst.id] };
    expect(() => validateTradePackage(state, balanced)).not.toThrow();
    applyTradePackage(state, balanced);
    expect(state.draftPicks[otherFirst.id].ownerTeamId).toBe(leftTeamId);
  });

  it("rejects draft picks outside the seven-year window", () => {
    const state = tradeState();
    const leftTeamId = state.userTeamId;
    const rightTeamId = Object.keys(state.teams).find((id) => id !== leftTeamId) as string;
    const id = `${state.league.seasonYear + 8}-R2-${leftTeamId}`;
    state.draftPicks[id] = { id, year: state.league.seasonYear + 8, round: 2, originalTeamId: leftTeamId, ownerTeamId: leftTeamId };
    const otherPick = Object.values(state.draftPicks).find((pick) => pick.ownerTeamId === rightTeamId && pick.round === 2);
    if (!otherPick) throw new Error("Expected a second-round pick");
    expect(() => validateTradePackage(state, {
      leftTeamId, rightTeamId, leftPlayerIds: [], rightPlayerIds: [], leftPickIds: [id], rightPickIds: [otherPick.id],
    })).toThrow("DRAFT_PICK_OUTSIDE_SEVEN_YEAR_WINDOW");
  });

  it("allows the current draft's pick before the draft and blocks it afterward", () => {
    const state = tradeState();
    state.league.seasonYear = 2027;
    state.league.currentPhase = "OFFSEASON_PRE_DRAFT";
    const leftTeamId = state.userTeamId;
    const rightTeamId = Object.keys(state.teams).find((id) => id !== leftTeamId) as string;
    const currentSecond = Object.values(state.draftPicks).find((pick) => pick.ownerTeamId === leftTeamId && pick.year === 2027 && pick.round === 2);
    const otherSecond = Object.values(state.draftPicks).find((pick) => pick.ownerTeamId === rightTeamId && pick.year === 2027 && pick.round === 2);
    if (!currentSecond || !otherSecond) throw new Error("Expected current-draft picks");
    const trade = { leftTeamId, rightTeamId, leftPlayerIds: [], rightPlayerIds: [], leftPickIds: [currentSecond.id], rightPickIds: [otherSecond.id] };
    expect(() => validateTradePackage(state, trade)).not.toThrow();
    state.league.currentPhase = "OFFSEASON_POST_DRAFT";
    expect(() => validateTradePackage(state, trade)).toThrow("DRAFT_PICK_OUTSIDE_SEVEN_YEAR_WINDOW");
  });
});
