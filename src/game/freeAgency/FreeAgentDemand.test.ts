import { describe, expect, it } from "vitest";
import { getSeasonFinanceConfig } from "../../config/leagueFinance";
import { calculatePlayerOverall } from "../player/PlayerRatingService";
import { waivePlayer } from "../roster/RosterService";
import { createCareer } from "../season/career";
import type { FreeAgentOffer, GameState, Player } from "../state/types";
import { advanceFreeAgencyDay, executeFreeAgencyCommand, getCurrentFreeAgentAsk, getProjectedMarketSalary, getRecommendedFreeAgentOffer } from "./FreeAgencyService";

function regularSeasonFreeAgent(seed: string): { state: GameState; player: Player } {
  const state = createCareer(seed);
  state.league.currentPhase = "REGULAR_PRE_DEADLINE";
  const team = state.teams[state.userTeamId];
  const player = state.players[team.playerIds.pop() as string];
  player.teamId = "FREE_AGENT";
  player.contract.status = "UFA";
  player.freeAgentDemand = { uncontestedDays: 0 };
  for (const other of Object.values(state.teams)) {
    if (other.id === state.userTeamId) continue;
    other.playerIds = Array.from({ length: 15 }, (_, index) => `blocked-${other.id}-${index}`);
  }
  return { state, player };
}

function setOverall(player: Player, target: number): void {
  player.overallAdjustment = target - calculatePlayerOverall({ ...player, overallAdjustment: 0 });
}

function addActiveOffer(state: GameState, player: Player, salaryRatio: number): FreeAgentOffer {
  const askingSalary = getCurrentFreeAgentAsk(state, player);
  const offer: FreeAgentOffer = {
    offerId: "test-offer", playerId: player.id, teamId: state.userTeamId,
    createdDay: 1, expiresDay: 10, years: 1, year1Salary: Math.round(askingSalary * salaryRatio),
    totalValue: Math.round(askingSalary * salaryRatio), guaranteedValue: Math.round(askingSalary * salaryRatio),
    rolePromised: "ROTATION", capReservation: Math.round(askingSalary * salaryRatio),
    utility: 40, pricedAgainstAsk: askingSalary, status: "ACTIVE", kind: "UFA_OFFER",
  };
  state.freeAgency = {
    opened: true, currentDay: 1, settledPlayerDay: {}, transactionLog: [],
    markets: { [player.id]: { playerId: player.id, marketWindowStartDay: 1, decisionDeadline: 10, marketWindowStatus: "OPEN" } },
    offers: { [offer.offerId]: offer },
  };
  return offer;
}

describe("free-agent asking salary", () => {
  it("keeps the reference valuation stable across phases and applies tiered discounts after 14 days", () => {
    const { state, player } = regularSeasonFreeAgent("fa-demand-tiers");
    for (const [overall, daily, maximum] of [[85, 0.001, 0.10], [80, 0.002, 0.20], [74, 0.003, 0.35]] as const) {
      setOverall(player, overall);
      player.freeAgentDemand = { uncontestedDays: 14 };
      const reference = getProjectedMarketSalary(player, state.league.seasonYear);
      expect(getCurrentFreeAgentAsk(state, player)).toBe(reference);
      player.freeAgentDemand.uncontestedDays = 15;
      expect(getCurrentFreeAgentAsk(state, player)).toBeCloseTo(reference * (1 - daily), 4);
      player.freeAgentDemand.uncontestedDays = 300;
      expect(getCurrentFreeAgentAsk(state, player)).toBeCloseTo(reference * (1 - maximum), 4);
      expect(Number.isFinite(getCurrentFreeAgentAsk(state, player))).toBe(true);
      expect(getCurrentFreeAgentAsk(state, player)).toBeGreaterThanOrEqual(getSeasonFinanceConfig(state.league.seasonYear).minimumSalary);
      state.league.currentPhase = "OFFSEASON_POST_DRAFT";
      expect(getCurrentFreeAgentAsk(state, player)).toBeCloseTo(reference * (1 - maximum), 4);
      state.league.currentPhase = "REGULAR_PRE_DEADLINE";
    }
    setOverall(player, 65);
    player.freeAgentDemand = { uncontestedDays: 300 };
    const minimumSalary = getSeasonFinanceConfig(state.league.seasonYear).minimumSalary;
    expect(getCurrentFreeAgentAsk(state, player)).toBe(minimumSalary);
    expect(getRecommendedFreeAgentOffer(state, player.id).year1Salary).toBe(Math.ceil(minimumSalary / 10_000) * 10_000);
  });

  it("counts days without qualifying offers and uses the new asking salary in recommendations", () => {
    let { state, player } = regularSeasonFreeAgent("fa-demand-grace");
    setOverall(player, 80);
    player.freeAgentDemand = { uncontestedDays: 13 };
    const reference = getProjectedMarketSalary(player, state.league.seasonYear);
    state = advanceFreeAgencyDay(state);
    expect(state.players[player.id].freeAgentDemand?.uncontestedDays).toBe(14);
    expect(getCurrentFreeAgentAsk(state, state.players[player.id])).toBe(reference);
    state = advanceFreeAgencyDay(state);
    expect(state.players[player.id].freeAgentDemand?.uncontestedDays).toBe(15);
    const currentAsk = getCurrentFreeAgentAsk(state, state.players[player.id]);
    expect(currentAsk).toBeLessThan(reference);
    expect(getRecommendedFreeAgentOffer(state, player.id).year1Salary).toBe(Math.round(currentAsk / 10_000) * 10_000);
  });

  it("pauses the discount for a qualifying live offer and reprices a lower live offer when demand falls", () => {
    const qualifying = regularSeasonFreeAgent("fa-demand-qualified");
    setOverall(qualifying.player, 80);
    qualifying.player.freeAgentDemand = { uncontestedDays: 14 };
    addActiveOffer(qualifying.state, qualifying.player, 0.8);
    const paused = advanceFreeAgencyDay(qualifying.state);
    expect(paused.players[qualifying.player.id].freeAgentDemand?.uncontestedDays).toBe(14);
    expect(paused.freeAgency?.offers["test-offer"].status).toBe("ACTIVE");

    const lowball = regularSeasonFreeAgent("fa-demand-lowball");
    setOverall(lowball.player, 80);
    lowball.player.freeAgentDemand = { uncontestedDays: 14 };
    const originalAsk = getCurrentFreeAgentAsk(lowball.state, lowball.player);
    addActiveOffer(lowball.state, lowball.player, 0.5);
    const advanced = advanceFreeAgencyDay(lowball.state);
    expect(advanced.players[lowball.player.id].freeAgentDemand?.uncontestedDays).toBe(15);
    expect(advanced.freeAgency?.offers["test-offer"].status).toBe("ACTIVE");
    expect(advanced.freeAgency?.offers["test-offer"].pricedAgainstAsk).toBeLessThan(originalAsk);
    expect(advanced.freeAgency?.offers["test-offer"].utility).not.toBe(40);
    const restored = JSON.parse(JSON.stringify(advanced)) as GameState;
    expect(getCurrentFreeAgentAsk(restored, restored.players[lowball.player.id])).toBe(getCurrentFreeAgentAsk(advanced, advanced.players[lowball.player.id]));
    expect(restored.freeAgency?.offers["test-offer"].utility).toBe(advanced.freeAgency?.offers["test-offer"].utility);
  });

  it("resets accumulated no-offer days when a player is waived into free agency", () => {
    const state = createCareer("fa-demand-waiver-reset");
    state.league.currentPhase = "REGULAR_PRE_DEADLINE";
    const playerId = state.teams[state.userTeamId].playerIds[0];
    state.players[playerId].freeAgentDemand = { uncontestedDays: 200 };
    const waived = waivePlayer(state, playerId);
    expect(waived.players[playerId].freeAgentDemand?.uncontestedDays).toBe(0);
    expect(getCurrentFreeAgentAsk(waived, waived.players[playerId])).toBe(getProjectedMarketSalary(waived.players[playerId], waived.league.seasonYear));
  });

  it("allows a below-ask offer but penalizes a severe lowball in the same market", () => {
    const { state, player } = regularSeasonFreeAgent("fa-demand-lowball-penalty");
    setOverall(player, 80);
    for (const id of state.teams[state.userTeamId].playerIds) state.players[id].contract.salary = 0;
    state.capState.capHolds = [];
    const recommended = getRecommendedFreeAgentOffer(state, player.id);
    const offerAtRatio = (ratio: number) => {
      const proposed = executeFreeAgencyCommand(state, {
        commandId: "same-market-offer", type: "SUBMIT_FA_OFFER",
        payload: { playerId: player.id, ...recommended, year1Salary: Math.round(recommended.year1Salary * ratio / 10_000) * 10_000 },
      });
      return Object.values(proposed.freeAgency?.offers ?? {})[0];
    };
    const nearAsk = offerAtRatio(0.9);
    const lowball = offerAtRatio(0.5);
    expect(nearAsk.status).toBe("ACTIVE");
    expect(lowball.status).toBe("ACTIVE");
    expect(nearAsk.utility).toBeGreaterThan(lowball.utility + 20);
  });
});
