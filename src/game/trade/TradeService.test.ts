import { describe, expect, it } from "vitest";
import { stableHash, stableSerialize } from "../random/hash";
import { createCareer } from "../season/career";
import { publicPlayerValue, tradeDraftPickValue } from "../ai/AIValueService";
import { calculatePlayerOverall } from "../player/PlayerRatingService";
import { acceptTradeOffer, applyTradePackage, evaluateTradeOffer, executeTradeCommand, generateTradeOffers, isTradePhaseAllowed, validateTradePackage } from "./TradeService";

function tradeState() {
  const state = createCareer("player-trade-tests");
  state.league.currentPhase = "OFFSEASON_POST_DRAFT";
  return state;
}

describe("TradeService", () => {
  it("invalidates a saved quote that swaps a core player and a second for two lower-rated players", () => {
    const state = tradeState();
    const outgoingIds = state.teams[state.userTeamId].playerIds.slice(5, 7);
    const coreId = state.teams.MIA.playerIds[0];
    const second = Object.values(state.draftPicks).find((pick) => pick.ownerTeamId === "MIA" && pick.round === 2 && pick.year === 2027);
    if (outgoingIds.length !== 2 || !coreId || !second) throw new Error("Missing trade fixture assets");
    for (const id of state.teams[state.userTeamId].playerIds) state.players[id].contract.salary = 1_000_000;
    for (const [id, overall, salary, age] of [
      [outgoingIds[0], 78, 14_500_000, 29],
      [outgoingIds[1], 75, 15_510_000, 33],
      [coreId, 86, 53_450_000, 29],
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

  it("keeps legal quotes available across 20 fixed seeds after core-player protection", () => {
    for (let index = 0; index < 20; index += 1) {
      const state = createCareer(`core-quote-balance-${index}`);
      state.league.currentPhase = "OFFSEASON_POST_DRAFT";
      const selectedId = state.teams[state.userTeamId].playerIds[5];
      const quoted = generateTradeOffers(state, selectedId, false);
      expect(quoted.tradeDesk.offers.length, `seed ${index}`).toBe(3);
      expect(quoted.tradeDesk.offers.every((offer) => evaluateTradeOffer(quoted, offer.offerId).legal), `seed ${index}`).toBe(true);
    }
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
