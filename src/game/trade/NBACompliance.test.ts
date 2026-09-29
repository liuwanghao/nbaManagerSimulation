import { describe, expect, it } from "vitest";
import { BALANCE_CONFIG } from "../../config/balanceConfig";
import { LEAGUE_FINANCE_CONFIG as FINANCE } from "../../config/leagueFinance";
import { MemoryStorageAdapter } from "../../platform/storage/StorageAdapter";
import { SaveService } from "../../storage/SaveService";
import { getCapSheet } from "../cap/CapSheetService";
import { stableHash, stableSerialize } from "../random/hash";
import { advanceSeason, createCareer } from "../season/career";
import type { GameState } from "../state/types";
import { runAiTradeEvaluation, isAiTradeEvaluationDay } from "./AITradeService";
import { validateSalaryMatch } from "./SalaryMatchValidator";
import { applyTradePackage, executeTradeCommand, generateTradeOffers, validateTradePackage, type TradePackage } from "./TradeService";

// NBA/NBPA 2023 CBA, Article VII §§2(e), 6(j), 8; Article XXIX §2.
// https://www.nbpa.com/cba
const stateForTrade = (seed = "nba-cba-audit") => {
  const state = createCareer(seed);
  state.league.currentPhase = "OFFSEASON_POST_DRAFT";
  return state;
};

function twoTeams(state: GameState) {
  const leftTeamId = state.userTeamId;
  const rightTeamId = Object.keys(state.teams).find((id) => id !== leftTeamId)!;
  return { leftTeamId, rightTeamId };
}

function pickSwap(state: GameState, round: 1 | 2 = 2): TradePackage {
  const { leftTeamId, rightTeamId } = twoTeams(state);
  const left = Object.values(state.draftPicks).find((p) => p.ownerTeamId === leftTeamId && p.round === round && p.year === state.league.seasonYear + 1)!;
  const right = Object.values(state.draftPicks).find((p) => p.ownerTeamId === rightTeamId && p.round === round && p.year === state.league.seasonYear + 1)!;
  return { leftTeamId, rightTeamId, leftPlayerIds: [], rightPlayerIds: [], leftPickIds: [left.id], rightPickIds: [right.id] };
}

function salaryScenario(outgoingSalaries: number[], incomingSalary: number, preSalary: number) {
  const state = stateForTrade(`salary-${outgoingSalaries.join("-")}-${incomingSalary}-${preSalary}`);
  const { leftTeamId, rightTeamId } = twoTeams(state);
  const outgoingIds = state.teams[leftTeamId].playerIds.slice(0, outgoingSalaries.length);
  const incomingId = state.teams[rightTeamId].playerIds[0];
  for (const id of state.teams[leftTeamId].playerIds) state.players[id].contract.salary = 1_000_000;
  outgoingIds.forEach((id, index) => { state.players[id].contract.salary = outgoingSalaries[index]; });
  state.players[incomingId].contract.salary = incomingSalary;
  const current = getCapSheet(state, leftTeamId).activeContractSalary + getCapSheet(state, leftTeamId).deadMoney;
  state.capState.deadMoney.push({ id: "audit-dead-money", teamId: leftTeamId, salaryBySeason: { [state.league.seasonId]: preSalary - current } });
  return { state, teamId: leftTeamId, outgoingIds, incomingId };
}

function assertAssetConservation(state: GameState, originalPlayerIds: Set<string>, originalPickIds: Set<string>) {
  const rosterIds = Object.values(state.teams).flatMap((team) => team.playerIds);
  expect(new Set(rosterIds).size).toBe(rosterIds.length);
  for (const id of rosterIds) expect(state.players[id].teamId).toBeDefined();
  for (const [teamId, team] of Object.entries(state.teams)) {
    for (const id of team.playerIds) expect(state.players[id].teamId).toBe(teamId);
  }
  expect(new Set(Object.keys(state.players))).toEqual(originalPlayerIds);
  expect(new Set(Object.keys(state.draftPicks))).toEqual(originalPickIds);
  for (const pick of Object.values(state.draftPicks)) expect(state.teams[pick.ownerTeamId]).toBeDefined();
}

describe("NBA trade rules audit: salary boundaries", () => {
  it("uses the season's growing cap for trade room", () => {
    const scenario = salaryScenario([1_000_000], 20_000_000, 155_000_000);
    expect(() => validateSalaryMatch(scenario.state, scenario.teamId, scenario.outgoingIds, [scenario.incomingId])).toThrow("SALARY_MATCH_FAILED");
    const deadMoney = scenario.state.capState.deadMoney.find((entry) => entry.id === "audit-dead-money")!;
    deadMoney.salaryBySeason["2027-28"] = deadMoney.salaryBySeason["2026-27"];
    scenario.state.league.seasonYear = 2027;
    scenario.state.league.seasonId = "2027-28";
    expect(() => validateSalaryMatch(scenario.state, scenario.teamId, scenario.outgoingIds, [scenario.incomingId])).not.toThrow();
  });

  it.each([
    { outgoing: 5_000_000, incoming: 10_250_000, legal: true },
    { outgoing: 5_000_000, incoming: 10_250_001, legal: false },
    { outgoing: 20_000_000, incoming: 29_095_923, legal: true },
    { outgoing: 20_000_000, incoming: 29_095_924, legal: false },
  ])("expanded traded-player exception: $outgoing to $incoming", ({ outgoing, incoming, legal }) => {
    const scenario = salaryScenario([outgoing], incoming, 185_000_000);
    if (legal) expect(() => validateSalaryMatch(scenario.state, scenario.teamId, scenario.outgoingIds, [scenario.incomingId])).not.toThrow();
    else expect(() => validateSalaryMatch(scenario.state, scenario.teamId, scenario.outgoingIds, [scenario.incomingId])).toThrow("SALARY_MATCH_FAILED");
  });

  it.each([
    { pre: FINANCE.firstApron - 1_000_000, incoming: 5_000_000, legal: true },
    { pre: FINANCE.firstApron + 1, incoming: 5_000_001, legal: false },
    { pre: FINANCE.secondApron + 1, incoming: 5_000_000, legal: true },
    { pre: FINANCE.secondApron + 1, incoming: 5_000_001, legal: false },
  ])("apron salary equal-boundary at $pre", ({ pre, incoming, legal }) => {
    const s = salaryScenario([5_000_000], incoming, pre);
    if (legal) expect(() => validateSalaryMatch(s.state, s.teamId, s.outgoingIds, [s.incomingId])).not.toThrow();
    else expect(() => validateSalaryMatch(s.state, s.teamId, s.outgoingIds, [s.incomingId])).toThrow(/APRON_SALARY_MATCH_FAILED/);
  });

  it("allows cap room plus $250k and rejects the next dollar", () => {
    const room = 5_000_000;
    for (const [extra, legal] of [[250_000, true], [250_001, false]] as const) {
      const s = salaryScenario([0], room + extra, FINANCE.salaryCap - room);
      if (legal) expect(() => validateSalaryMatch(s.state, s.teamId, s.outgoingIds, [s.incomingId])).not.toThrow();
      else expect(() => validateSalaryMatch(s.state, s.teamId, s.outgoingIds, [s.incomingId])).toThrow();
    }
  });

  it("rejects aggregate salary use above the second apron, while allowing one contract to cover the incoming salary", () => {
    for (const [incoming, legal] of [[8_000_000, true], [10_000_001, false]] as const) {
      const s = salaryScenario([10_000_000, 3_000_000], incoming, FINANCE.secondApron + 5_000_000);
      if (legal) expect(() => validateSalaryMatch(s.state, s.teamId, s.outgoingIds, [s.incomingId])).not.toThrow();
      else expect(() => validateSalaryMatch(s.state, s.teamId, s.outgoingIds, [s.incomingId])).toThrow("SECOND_APRON_SALARY_MATCH_FAILED");
    }
  });

  it("uses guaranteed salary rather than full base salary for outgoing trade credit", () => {
    const s = salaryScenario([4_000_000], 6_000_000, 185_000_000);
    const contract = s.state.players[s.outgoingIds[0]].contract;
    contract.yearsRemaining = 1;
    contract.currentYearIndex = 0;
    contract.salaryByYear = [4_000_000];
    contract.guaranteedByYear = [2_000_000];
    contract.guaranteedAmount = 2_000_000;
    // NBPA agent FAQ example: $4m base / $2m protected gets $4.25m trade credit.
    expect(() => validateSalaryMatch(s.state, s.teamId, s.outgoingIds, [s.incomingId])).toThrow("SALARY_MATCH_FAILED");
  });
});

describe("NBA trade rules audit: transaction boundaries", () => {
  it.each(["TEAM_CREATION", "DRAFT", "REGULAR_POST_DEADLINE", "PLAYOFFS"] as const)("closes trades in %s", (phase) => {
    const state = stateForTrade();
    state.league.currentPhase = phase;
    expect(() => validateTradePackage(state, pickSwap(state))).toThrow("TRADE_PHASE_CLOSED");
  });

  it("closes regular-season trades immediately after the configured deadline", () => {
    const state = stateForTrade();
    state.league.currentPhase = "REGULAR_SEASON";
    state.calendar.currentDateIndex = BALANCE_CONFIG.ai.tradeDeadlineDateIndex;
    expect(() => validateTradePackage(state, pickSwap(state))).not.toThrow();
    state.calendar.currentDateIndex += 1;
    expect(() => validateTradePackage(state, pickSwap(state))).toThrow("TRADE_PHASE_CLOSED");
  });

  it.each(["left", "right"] as const)("rejects an asset owned by the wrong %s team", (side) => {
    const state = stateForTrade();
    const trade = pickSwap(state);
    const id = side === "left" ? trade.leftPickIds[0] : trade.rightPickIds[0];
    state.draftPicks[id].ownerTeamId = side === "left" ? trade.rightTeamId : trade.leftTeamId;
    expect(() => validateTradePackage(state, trade)).toThrow("DRAFT_PICK_NOT_OWNED");
  });

  it.each(["DUPLICATE_DRAFT_PICK", "DUPLICATE_PLAYER"] as const)("rejects %s without mutating state", (code) => {
    const state = stateForTrade();
    const trade = pickSwap(state);
    if (code === "DUPLICATE_DRAFT_PICK") trade.leftPickIds.push(trade.leftPickIds[0]);
    else {
      trade.leftPlayerIds = [state.teams[trade.leftTeamId].playerIds[0]];
      trade.rightPlayerIds = [trade.leftPlayerIds[0]];
    }
    const before = stableHash(stableSerialize(state));
    expect(() => applyTradePackage(state, trade)).toThrow(code);
    expect(stableHash(stableSerialize(state))).toBe(before);
  });

  it("blocks reserved picks, eight-year picks and consecutive missing future firsts", () => {
    const state = stateForTrade();
    const secondSwap = pickSwap(state);
    state.draftPicks[secondSwap.leftPickIds[0]].reservedByCommitmentId = "audit";
    expect(() => validateTradePackage(state, secondSwap)).toThrow("DRAFT_PICK_RESERVED");
    delete state.draftPicks[secondSwap.leftPickIds[0]].reservedByCommitmentId;
    const farId = `far-${state.userTeamId}`;
    state.draftPicks[farId] = { id: farId, year: state.league.seasonYear + 8, round: 2, originalTeamId: state.userTeamId, ownerTeamId: state.userTeamId };
    expect(() => validateTradePackage(state, { ...secondSwap, leftPickIds: [farId] })).toThrow("DRAFT_PICK_OUTSIDE_SEVEN_YEAR_WINDOW");
    const firsts = Object.values(state.draftPicks).filter((p) => p.ownerTeamId === state.userTeamId && p.round === 1)
      .sort((a, b) => a.year - b.year);
    expect(() => validateTradePackage(state, { ...secondSwap, leftPickIds: firsts.slice(0, 2).map((p) => p.id) })).toThrow("CONSECUTIVE_FIRST_ROUND_LIMIT");
  });

  it.each(["UFA", "RFA", "RETIRED"] as const)("refuses a %s player contract", (status) => {
    const state = stateForTrade();
    const trade = pickSwap(state);
    const playerId = state.teams[trade.leftTeamId].playerIds[0];
    state.players[playerId].contract.status = status;
    trade.leftPlayerIds = [playerId];
    expect(() => validateTradePackage(state, trade)).toThrow("PLAYER_NOT_TRADEABLE");
  });

  it("rejects a projected 16-player regular-season roster", () => {
    const state = stateForTrade();
    state.league.currentPhase = "REGULAR_PRE_DEADLINE";
    const trade = pickSwap(state);
    trade.leftPlayerIds = [state.teams[trade.leftTeamId].playerIds[0]];
    trade.rightPlayerIds = state.teams[trade.rightTeamId].playerIds.slice(0, 2);
    for (const id of [...state.teams[trade.leftTeamId].playerIds, ...state.teams[trade.rightTeamId].playerIds]) state.players[id].contract.salary = 1_000_000;
    expect(() => validateTradePackage(state, trade)).toThrow("ROSTER_LIMIT_EXCEEDED");
  });

  it("rejects an 11-player regular-season roster even within the temporary minimum exception", () => {
    const state = stateForTrade();
    state.league.currentPhase = "REGULAR_PRE_DEADLINE";
    const trade = pickSwap(state);
    for (const [teamId, keep] of [[trade.leftTeamId, 12], [trade.rightTeamId, 14]] as const) {
      const team = state.teams[teamId];
      for (const id of team.playerIds.slice(keep)) state.players[id].teamId = "FREE_AGENT";
      team.playerIds = team.playerIds.slice(0, keep);
      for (const id of team.playerIds) state.players[id].contract.salary = 1_000_000;
    }
    trade.leftPlayerIds = [state.teams[trade.leftTeamId].playerIds[0]];
    expect(() => validateTradePackage(state, trade)).toThrow("ROSTER_BELOW_NBA_MINIMUM");
  });

  it("keeps transferred Bird rights and conserves all assets", () => {
    const state = stateForTrade();
    const trade = pickSwap(state);
    const leftId = state.teams[trade.leftTeamId].playerIds[4];
    const rightId = state.teams[trade.rightTeamId].playerIds[4];
    state.players[leftId].birdYears = 3;
    state.players[rightId].birdYears = 2;
    trade.leftPlayerIds = [leftId];
    trade.rightPlayerIds = [rightId];
    const players = new Set(Object.keys(state.players));
    const picks = new Set(Object.keys(state.draftPicks));
    applyTradePackage(state, trade);
    expect(state.players[leftId]).toMatchObject({ teamId: trade.rightTeamId, birdTeamId: trade.rightTeamId, birdYears: 3 });
    expect(state.players[rightId]).toMatchObject({ teamId: trade.leftTeamId, birdTeamId: trade.leftTeamId, birdYears: 2 });
    assertAssetConservation(state, players, picks);
  });

  it("rechecks stale offers and makes repeat command IDs idempotent", () => {
    const state = stateForTrade();
    const playerId = state.teams[state.userTeamId].playerIds[5];
    const queried = executeTradeCommand(state, { commandId: "q", type: "GENERATE_TRADE_OFFERS", payload: { playerId, refresh: false } });
    const offerId = queried.tradeDesk.offers[0].offerId;
    const stale = structuredClone(queried);
    stale.players[stale.tradeDesk.offers[0].userIncomingPlayerIds[0]].teamId = "FREE_AGENT";
    const before = stableHash(stableSerialize(stale));
    expect(() => executeTradeCommand(stale, { commandId: "accept", type: "ACCEPT_TRADE_OFFER", payload: { offerId } })).toThrow();
    expect(stableHash(stableSerialize(stale))).toBe(before);
    const accepted = executeTradeCommand(queried, { commandId: "accept", type: "ACCEPT_TRADE_OFFER", payload: { offerId } });
    expect(executeTradeCommand(accepted, { commandId: "accept", type: "ACCEPT_TRADE_OFFER", payload: { offerId } })).toBe(accepted);
    expect(() => executeTradeCommand(accepted, { commandId: "accept", type: "GENERATE_TRADE_OFFERS", payload: { playerId, refresh: false } })).toThrow("Command ID 已被不同 Payload 使用");
  });

  it("replays offers from state plus refresh count and survives save reload", async () => {
    const state = stateForTrade();
    const playerId = state.teams[state.userTeamId].playerIds[5];
    const first = generateTradeOffers(state, playerId, false);
    expect(generateTradeOffers(state, playerId, false).tradeDesk.offers).toEqual(first.tradeDesk.offers);
    const refreshed = generateTradeOffers(first, playerId, true);
    expect(refreshed.tradeDesk.offers[0].inquiryCount).toBe(1);
    const service = new SaveService(new MemoryStorageAdapter());
    await service.save(1, refreshed);
    const loaded = await service.load(1);
    expect(loaded?.tradeDesk.offers).toEqual(refreshed.tradeDesk.offers);
    expect(loaded?.tradeInquiryCount).toEqual(refreshed.tradeInquiryCount);
    expect(generateTradeOffers(loaded!, playerId, false).tradeDesk.offers).toEqual(refreshed.tradeDesk.offers);
  });

  it("persists an accepted trade and rejects replay after loading the save", async () => {
    const state = stateForTrade("accepted-trade-save-audit");
    const playerId = state.teams[state.userTeamId].playerIds[5];
    const queried = executeTradeCommand(state, { commandId: "saved-query", type: "GENERATE_TRADE_OFFERS", payload: { playerId, refresh: false } });
    const offer = queried.tradeDesk.offers[0];
    const accepted = executeTradeCommand(queried, { commandId: "saved-accept", type: "ACCEPT_TRADE_OFFER", payload: { offerId: offer.offerId } });
    const service = new SaveService(new MemoryStorageAdapter());
    await service.save(1, accepted);
    const loaded = (await service.load(1))!;
    expect(loaded.tradeDesk.offers.find((entry) => entry.offerId === offer.offerId)?.status).toBe("ACCEPTED");
    expect(loaded.gmCareer.tradeHistory.filter((entry) => entry.offerId === offer.offerId)).toHaveLength(1);
    expect(executeTradeCommand(loaded, { commandId: "saved-accept", type: "ACCEPT_TRADE_OFFER", payload: { offerId: offer.offerId } })).toBe(loaded);
    expect(() => executeTradeCommand(loaded, { commandId: "another-accept", type: "ACCEPT_TRADE_OFFER", payload: { offerId: offer.offerId } })).toThrow();
  });
});

describe("NBA trade rules audit: AI and season flow", () => {
  it("replays every AI evaluation and keeps all assets conserved through one fixed-seed season", () => {
    let state = createCareer("nba-cba-long-flow-2026");
    const players = new Set(Object.keys(state.players));
    const picks = new Set(Object.keys(state.draftPicks));
    const untouchedUserRoster = [...state.teams[state.userTeamId].playerIds];
    for (let day = 0; day < BALANCE_CONFIG.ai.tradeDeadlineDateIndex; day += 1) {
      if (!isAiTradeEvaluationDay(day)) continue;
      state.calendar.currentDateIndex = day;
      state = runAiTradeEvaluation(state, day);
      assertAssetConservation(state, players, picks);
    }
    expect(state.aiTradeState.transactionLog.length).toBeGreaterThan(0);
    expect(state.teams[state.userTeamId].playerIds).toEqual(untouchedUserRoster);
    expect(Object.values(state.aiTradeState.completedByTeamSeason).every((count) => count <= BALANCE_CONFIG.ai.maxTradesPerTeamSeason)).toBe(true);
    const replay = createCareer("nba-cba-long-flow-2026");
    let second = replay;
    for (let day = 0; day < BALANCE_CONFIG.ai.tradeDeadlineDateIndex; day += 1) {
      if (!isAiTradeEvaluationDay(day)) continue;
      second.calendar.currentDateIndex = day;
      second = runAiTradeEvaluation(second, day);
    }
    expect(second.aiTradeState.transactionLog).toEqual(state.aiTradeState.transactionLog);
    state = advanceSeason(state);
    expect(state.league.seasonYear).toBe(2027);
    expect(state.league.currentPhase).toBe("REGULAR_PRE_DEADLINE");
    state.calendar.currentDateIndex = 7;
    state = runAiTradeEvaluation(state, 7);
    expect(new Set(Object.values(state.teams).flatMap((team) => team.playerIds)).size)
      .toBe(Object.values(state.teams).flatMap((team) => team.playerIds).length);
    for (const [teamId, team] of Object.entries(state.teams)) {
      for (const id of team.playerIds) expect(state.players[id].teamId).toBe(teamId);
    }
    for (const pick of Object.values(state.draftPicks)) expect(state.teams[pick.ownerTeamId]).toBeDefined();
  }, 120_000);
});
