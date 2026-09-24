import { describe, expect, it } from "vitest";
import { BALANCE_CONFIG } from "../../config/balanceConfig";
import { LEAGUE_FINANCE_CONFIG } from "../../config/leagueFinance";
import { EXPANSION_BRAND_PRESETS } from "../../data/expansionBrands";
import { createExpansionCareerFromBundledDataset } from "../../data/hupuRoster";
import { getCapSheet } from "../cap/CapSheetService";
import { executeDraftCommand, getAvailableDraftProspects } from "../draft/DraftService";
import { executeExpansionCommand, getSelectableExpansionPlayers } from "../expansion/ExpansionService";
import { stableHash, stableSerialize } from "../random/hash";
import { createExpansionCareer } from "../season/career";
import { calculatePlayerOverall } from "../player/PlayerRatingService";
import type { GameState } from "../state/types";
import {
  executeFreeAgencyCommand,
  getFreeAgentOfferPreview,
  getFreeAgents,
  getProjectedMarketSalary,
  getRecommendedFreeAgentOffer,
} from "./FreeAgencyService";

function postDraftState(seed: string, bundled = false): GameState {
  const preset = EXPANSION_BRAND_PRESETS.SEA[0];
  let state = executeExpansionCommand(bundled ? createExpansionCareerFromBundledDataset(seed) : createExpansionCareer(seed), {
    commandId: "create", type: "CREATE_EXPANSION_TEAM",
    payload: { cityId: "SEA", presetId: preset.presetId, teamName: preset.teamName, primaryColor: preset.primaryColor, secondaryColor: preset.secondaryColor },
  });
  if (!state.expansion?.rightsDraw.resolved) state = executeExpansionCommand(state, { commandId: "package", type: "CHOOSE_RIGHTS_PACKAGE", payload: { packageId: "B" } });
  state = executeExpansionCommand(state, { commandId: "options", type: "RESOLVE_OPTION_PHASE", payload: {} });
  state = executeExpansionCommand(state, { commandId: "trade", type: "PREPARE_EXPANSION_TRADE", payload: {} });
  state = executeExpansionCommand(state, { commandId: "start-exp", type: "START_EXPANSION_DRAFT", payload: {} });
  while (state.league.currentPhase === "EXPANSION_DRAFT") {
    const pick = (state.expansion?.currentPickIndex ?? 0) + 1;
    state = executeExpansionCommand(state, { commandId: `exp-${pick}`, type: "SELECT_EXPANSION_PLAYER", payload: { playerId: getSelectableExpansionPlayers(state)[0].id, expectedPickNumber: pick } });
  }
  state = executeDraftCommand(state, { commandId: "prepare", type: "PREPARE_ROOKIE_DRAFT", payload: {} });
  while (state.league.currentPhase === "DRAFT") {
    const pick = state.rookieDraft?.pickOrder[state.rookieDraft.currentPickIndex];
    if (!pick) throw new Error("rookie draft pick missing");
    state = pick.ownerTeamId === state.userTeamId
      ? executeDraftCommand(state, { commandId: `rookie-${pick.pickNumber}`, type: "DRAFT_PLAYER", payload: { playerId: getAvailableDraftProspects(state)[0].id, expectedPickNumber: pick.pickNumber } })
      : executeDraftCommand(state, { commandId: `rookie-ai-${pick.pickNumber}`, type: "ADVANCE_ROOKIE_DRAFT_AI_PICK", payload: { expectedPickNumber: pick.pickNumber } });
  }
  return state;
}

describe("Stage 4 free agency", () => {
  it("identifies cap space rather than roster size as the block for a 16-player team", () => {
    const state = executeFreeAgencyCommand(postDraftState("fa-sixteen-over-cap"), { commandId: "open-over-cap", type: "ENTER_FREE_AGENCY", payload: {} });
    const team = state.teams[state.userTeamId];
    expect(team.playerIds).toHaveLength(16);
    expect(team.playerIds.length).toBeLessThan(LEAGUE_FINANCE_CONFIG.rosterLimits.offseasonMaximum);
    for (const playerId of team.playerIds) state.players[playerId].contract.salary = 20_000_000;
    expect(getCapSheet(state, state.userTeamId).availableCapSpace).toBeLessThan(0);
    const freeAgent = getFreeAgents(state).find((player) => player.contract.status === "UFA");
    if (!freeAgent) throw new Error("UFA missing from test market");
    expect(getFreeAgentOfferPreview(state, freeAgent.id).reason).toBe("可用薪资空间不足");
  });

  it("allows offers with a 16-player roster during the 21-player offseason window", () => {
    const state = executeFreeAgencyCommand(postDraftState("fa-offseason-roster-limit"), { commandId: "open", type: "ENTER_FREE_AGENCY", payload: {} });
    expect(state.teams[state.userTeamId].playerIds).toHaveLength(16);
    expect(getFreeAgents(state).some((player) => getFreeAgentOfferPreview(state, player.id).valid)).toBe(true);
  });

  it("opens the market, detaches expiring players and creates cap holds", () => {
    const state = executeFreeAgencyCommand(postDraftState("fa-open"), { commandId: "open", type: "ENTER_FREE_AGENCY", payload: {} });
    expect(state.freeAgency?.opened).toBe(true);
    expect(getFreeAgents(state).length).toBeGreaterThanOrEqual(16);
    expect(getFreeAgents(state).every((player) => player.teamId === "FREE_AGENT")).toBe(true);
    expect(state.capState.capHolds.length).toBeGreaterThan(0);
  });

  it("reserves cap, keeps the first three-day deadline and makes retries idempotent", () => {
    let state = executeFreeAgencyCommand(postDraftState("fa-offer"), { commandId: "open", type: "ENTER_FREE_AGENCY", payload: {} });
    const player = getFreeAgents(state).find((entry) => entry.contract.status === "UFA") as (typeof state.players)[string];
    const command = { commandId: "offer", type: "SUBMIT_FA_OFFER", payload: { playerId: player.id, years: 3, year1Salary: 8_000_000, guaranteedPercent: 0.8, rolePromised: "ROTATION" } } as const;
    state = executeFreeAgencyCommand(state, command);
    const deadline = state.freeAgency?.markets[player.id].decisionDeadline;
    expect(state.capState.offerReservations.some((entry) => entry.playerId === player.id)).toBe(true);
    expect(executeFreeAgencyCommand(state, command)).toBe(state);
    const next = executeFreeAgencyCommand(state, { commandId: "offer-2", type: "SUBMIT_FA_OFFER", payload: { playerId: player.id, years: 2, year1Salary: 7_000_000, guaranteedPercent: 1, rolePromised: "BENCH" } });
    expect(next.freeAgency?.markets[player.id].decisionDeadline).toBe(deadline);
  });

  it("rejects an unaffordable offer without mutating the input", () => {
    const state = executeFreeAgencyCommand(postDraftState("fa-rollback"), { commandId: "open", type: "ENTER_FREE_AGENCY", payload: {} });
    const player = getFreeAgents(state)[0];
    const before = stableHash(stableSerialize(state));
    expect(() => executeFreeAgencyCommand(state, { commandId: "bad", type: "SUBMIT_FA_OFFER", payload: { playerId: player.id, years: 4, year1Salary: 999_000_000, guaranteedPercent: 1, rolePromised: "STARTER" } })).toThrow(/legal limits/);
    expect(stableHash(stableSerialize(state))).toBe(before);
  });

  it("settles offers deterministically and releases every losing reservation", () => {
    let state = executeFreeAgencyCommand(postDraftState("fa-settle"), { commandId: "open", type: "ENTER_FREE_AGENCY", payload: {} });
    const player = getFreeAgents(state).find((entry) => entry.contract.status === "UFA") as (typeof state.players)[string];
    state = executeFreeAgencyCommand(state, { commandId: "max-offer", type: "SUBMIT_FA_OFFER", payload: { playerId: player.id, years: 4, year1Salary: 30_000_000, guaranteedPercent: 1, rolePromised: "STARTER" } });
    for (let day = 0; day < 3 && state.players[player.id].teamId === "FREE_AGENT"; day += 1) {
      state = executeFreeAgencyCommand(state, { commandId: `day-${day}`, type: "ADVANCE_FA_DAY", payload: {} });
    }
    expect(state.players[player.id].teamId).not.toBe("FREE_AGENT");
    expect(state.capState.offerReservations.some((entry) => entry.playerId === player.id)).toBe(false);
    expect(state.freeAgency?.markets[player.id].marketWindowStatus).toBe("SIGNED");
    expect(state.teamNotifications?.some((notice) => notice.playerId === player.id && !notice.read)).toBe(true);
  });

  it("continues settling after a three-day offer for Jalen Duren", () => {
    let state = executeFreeAgencyCommand(postDraftState("fa-duren-deadline", true), { commandId: "open-duren", type: "ENTER_FREE_AGENCY", payload: {} });
    const duren = state.players["nba:1631105"];
    expect(duren?.teamId).toBe("FREE_AGENT");
    expect(duren.contract.status).toBe("RFA");
    const overCap = structuredClone(state);
    for (const playerId of overCap.teams[overCap.userTeamId].playerIds) overCap.players[playerId].contract.salary = 50_000_000;
    expect(getCapSheet(overCap, overCap.userTeamId).availableCapSpace).toBeLessThan(0);
    expect(getFreeAgents(overCap).some((player) => player.id === duren.id)).toBe(true);
    expect(getFreeAgentOfferPreview(overCap, duren.id).valid).toBe(false);
    for (const playerId of state.teams[state.userTeamId].playerIds) state.players[playerId].contract.salary = 0;
    state.capState.capHolds = state.capState.capHolds.filter((hold) => hold.teamId !== state.userTeamId);
    const draft = getRecommendedFreeAgentOffer(state, duren.id);
    state = executeFreeAgencyCommand(state, { commandId: "offer-duren", type: "SUBMIT_FA_OFFER", payload: { playerId: duren.id, ...draft } });
    for (let day = 1; day <= 4; day += 1) {
      state = executeFreeAgencyCommand(state, { commandId: `advance-duren-${day}`, type: "ADVANCE_FA_DAY", payload: {} });
      expect(state.freeAgency?.currentDay).toBe(day + 1);
    }
    expect(state.teamNotifications?.some((notice) => notice.playerId === duren.id)).toBe(true);
  });

  it("replays the same opening and first settlement while respecting the configured AI offer limit", () => {
    const initial = postDraftState("fa-replay");
    const run = () => {
      let state = executeFreeAgencyCommand(structuredClone(initial), { commandId: "open", type: "ENTER_FREE_AGENCY", payload: {} });
      state.capState.capHolds = [];
      state.capState.offerReservations = [];
      for (const player of Object.values(state.players)) player.contract.salary = 0;
      state = executeFreeAgencyCommand(state, { commandId: "day", type: "ADVANCE_FA_DAY", payload: {} });
      return state;
    };
    const first = run();
    const second = run();
    expect(stableHash(stableSerialize(first))).toBe(stableHash(stableSerialize(second)));

    const offersByTeam = Object.values(first.freeAgency?.offers ?? {}).reduce<Record<string, number>>((counts, offer) => {
      if (offer.createdDay === 1 && offer.teamId !== first.userTeamId) counts[offer.teamId] = (counts[offer.teamId] ?? 0) + 1;
      return counts;
    }, {});
    expect(Math.max(...Object.values(offersByTeam))).toBe(BALANCE_CONFIG.ai.maxNewFreeAgentOffersPerTeamDay);
    expect(Object.values(offersByTeam).every((count) => count <= BALANCE_CONFIG.ai.maxNewFreeAgentOffersPerTeamDay)).toBe(true);
  });

  it("includes player age in the projected market salary", () => {
    const player = structuredClone(Object.values(createExpansionCareer("fa-market-salary-age").players)[0]);
    player.attributes = { shooting: 70, finishing: 70, playmaking: 70, perimeterDefense: 70, interiorDefense: 70, rebounding: 70, athleticism: 70, basketballIq: 70 };
    player.overallAdjustment = 0;
    player.rotationRole = "BENCH";
    player.serviceYears = 4;
    const younger = { ...player, age: 23 };
    const older = { ...player, age: 33 };

    expect(getProjectedMarketSalary(younger)).toBeGreaterThan(getProjectedMarketSalary(older));
  });

  it("keeps a 68-overall young player near the minimum instead of a star salary", () => {
    const player = structuredClone(Object.values(createExpansionCareer("fa-low-rating-price").players)[0]);
    player.age = 21;
    player.serviceYears = 0;
    player.contract.salary = 0;
    player.rotationRole = "BENCH";
    player.overallAdjustment = 68 - calculatePlayerOverall({ ...player, overallAdjustment: 0 });

    expect(calculatePlayerOverall(player)).toBe(68);
    expect(getProjectedMarketSalary(player)).toBeGreaterThanOrEqual(1_272_870);
    expect(getProjectedMarketSalary(player)).toBeLessThan(3_000_000);

    const state = createExpansionCareer("fa-low-rating-offer");
    state.players[player.id] = player;
    expect(getRecommendedFreeAgentOffer(state, player.id).rolePromised).not.toBe("STARTER");
  });

  it("builds and validates the user offer through the same engine pricing rules", () => {
    const state = executeFreeAgencyCommand(postDraftState("fa-recommended-offer"), { commandId: "open", type: "ENTER_FREE_AGENCY", payload: {} });
    state.capState.capHolds = state.capState.capHolds.filter((hold) => hold.teamId !== state.userTeamId);
    for (const playerId of state.teams[state.userTeamId].playerIds) state.players[playerId].contract.salary = 0;
    const player = getFreeAgents(state).find((candidate) => candidate.contract.status === "UFA");
    if (!player) throw new Error("UFA missing from test market");

    const recommended = getRecommendedFreeAgentOffer(state, player.id);
    const preview = getFreeAgentOfferPreview(state, player.id);
    expect(preview).toEqual({ draft: recommended, valid: true });
    expect(recommended.year1Salary).toBe(Math.round(getProjectedMarketSalary(player) / 10_000) * 10_000);
    expect(recommended.guaranteedPercent).toBe(BALANCE_CONFIG.ai.freeAgency.guaranteedPercent);

    const capped = structuredClone(state);
    for (const playerId of capped.teams[capped.userTeamId].playerIds) capped.players[playerId].contract.salary = 50_000_000;
    expect(getFreeAgentOfferPreview(capped, player.id)).toMatchObject({ valid: false, reason: "可用薪资空间不足" });
  });
});
