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
import { publicPlayerValue } from "../ai/AIValueService";
import { executeRosterCommand } from "../roster/RosterService";
import type { GameState } from "../state/types";
import {
  executeFreeAgencyCommand,
  getFreeAgentContractTerms,
  getFreeAgentCustomOfferPreview,
  getFreeAgentOfferPreview,
  getFreeAgents,
  getPendingUserQualifyingOfferPlayers,
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
  it("lets the rights team sign an elite RFA before opening night without cutting rotation veterans", () => {
    let state = executeFreeAgencyCommand(postDraftState("expansion-era-demo", true), {
      commandId: "opening-fa", type: "ENTER_FREE_AGENCY", payload: {},
    });
    const durenId = "nba:1631105";
    expect(state.freeAgency?.markets[durenId].originalTeamId).toBe("DET");
    expect(state.capState.capHolds).toContainEqual(expect.objectContaining({ playerId: durenId, teamId: "DET", type: "RFA" }));
    expect(state.teams.DET.playerIds).toHaveLength(14);
    for (let day = 1; day <= 3; day += 1) {
      state = executeFreeAgencyCommand(state, { commandId: `opening-fa-${day}`, type: "ADVANCE_FA_DAY", payload: {} });
    }
    expect(state.players[durenId]).toMatchObject({ teamId: "DET", contract: { status: "STANDARD" } });
    expect(Object.values(state.freeAgency?.offers ?? {}).some((offer) => offer.playerId === durenId
      && offer.teamId === "DET" && offer.kind === "RFA_OWN_TEAM_OFFER" && offer.status === "ACCEPTED")).toBe(true);

    state = executeRosterCommand(state, { commandId: "opening-close-fa", type: "CLOSE_FREE_AGENCY", payload: {} });
    while (state.teams[state.userTeamId].playerIds.length > LEAGUE_FINANCE_CONFIG.rosterLimits.regularSeasonMaximum) {
      const lowest = state.teams[state.userTeamId].playerIds.map((id) => state.players[id])
        .sort((left, right) => publicPlayerValue(left) - publicPlayerValue(right))[0];
      state = executeRosterCommand(state, { commandId: `opening-waive-${lowest.id}`, type: "WAIVE_PLAYER", payload: { playerId: lowest.id } });
    }
    state = executeRosterCommand(state, { commandId: "opening-lock", type: "LOCK_OPENING_ROSTER", payload: { confirmMinimumFill: true } });
    for (const playerId of ["nba:1628398", "nba:201572", "nba:203078", "nba:203084", "nba:203903", "nba:202691", "nba:1627739"]) {
      expect(state.players[playerId].teamId, state.players[playerId].name).not.toBe("FREE_AGENT");
    }
    expect(Math.max(...getFreeAgents(state).map(calculatePlayerOverall))).toBeLessThan(78);
  });

  it("requires the user to resolve qualifying offers before opening the market", () => {
    const input = postDraftState("fa-qualifying-offer");
    const player = Object.values(input.players).find((candidate) => candidate.teamId === "FREE_AGENT" && candidate.contract.status === "UFA");
    if (!player) throw new Error("Free agent missing from test state");
    player.contract.status = "RFA";
    player.contract.qualifyingOfferDecision = "PENDING";
    player.birdTeamId = input.userTeamId;
    player.birdYears = 4;
    input.capState.capHolds = input.capState.capHolds.filter((hold) => hold.playerId !== player.id);

    expect(getPendingUserQualifyingOfferPlayers(input).map((candidate) => candidate.id)).toContain(player.id);
    expect(() => executeFreeAgencyCommand(input, { commandId: "open-too-soon", type: "ENTER_FREE_AGENCY", payload: {} })).toThrow(/qualifying offer/);

    const tendered = executeFreeAgencyCommand(input, { commandId: "tender-qo", type: "RESOLVE_QUALIFYING_OFFER", payload: { playerId: player.id, decision: "TENDER" } });
    expect(tendered.players[player.id].contract).toMatchObject({ status: "RFA", qualifyingOfferDecision: "TENDERED" });
    expect(tendered.capState.capHolds).toContainEqual(expect.objectContaining({ playerId: player.id, teamId: input.userTeamId, type: "RFA" }));
    expect(getPendingUserQualifyingOfferPlayers(tendered)).toHaveLength(0);

    const declined = executeFreeAgencyCommand(input, { commandId: "decline-qo", type: "RESOLVE_QUALIFYING_OFFER", payload: { playerId: player.id, decision: "DECLINE" } });
    expect(declined.players[player.id].contract).toMatchObject({ status: "UFA", qualifyingOfferDecision: "DECLINED" });
    expect(declined.capState.capHolds).toContainEqual(expect.objectContaining({ playerId: player.id, teamId: input.userTeamId, type: "BIRD_UFA" }));
    expect(executeFreeAgencyCommand(declined, { commandId: "open-after-qo", type: "ENTER_FREE_AGENCY", payload: {} }).freeAgency?.opened).toBe(true);
  });

  it("generates later salaries from the selected raise and enforces the 5% or 8% rights limit", () => {
    const state = executeFreeAgencyCommand(postDraftState("fa-selected-raise"), { commandId: "open", type: "ENTER_FREE_AGENCY", payload: {} });
    state.capState.capHolds = [];
    for (const playerId of state.teams[state.userTeamId].playerIds) state.players[playerId].contract.salary = 0;
    const player = getFreeAgents(state).find((candidate) => candidate.contract.status === "UFA");
    if (!player) throw new Error("UFA missing from test market");
    const draft = { years: 4, year1Salary: 10_000_000, annualRaiseRate: 0.03, guaranteedPercent: 0.8, rolePromised: "ROTATION" as const };
    const preview = getFreeAgentCustomOfferPreview(state, player.id, draft);
    expect(preview).toMatchObject({ valid: true, annualRaiseRate: 0.03, maximumAnnualRaiseRate: 0.05 });
    expect(preview.salaryByYear).toEqual([10_000_000, 10_300_000, 10_609_000, 10_927_270]);
    expect(getFreeAgentCustomOfferPreview(state, player.id, { ...draft, annualRaiseRate: 0.06 })).toMatchObject({ valid: false, reason: "年涨幅必须为 0～5%" });
    expect(() => executeFreeAgencyCommand(state, { commandId: "illegal-raise", type: "SUBMIT_FA_OFFER", payload: { playerId: player.id, ...draft, annualRaiseRate: 0.06 } })).toThrow(/Annual raise rate/);

    state.freeAgency!.markets[player.id].originalTeamId = state.userTeamId;
    expect(getFreeAgentCustomOfferPreview(state, player.id, { ...draft, annualRaiseRate: 0.08 })).toMatchObject({ valid: true, maximumAnnualRaiseRate: 0.08 });
  });

  it("stores a final-year team or player option and carries it into the signed contract", () => {
    let state = executeFreeAgencyCommand(postDraftState("fa-contract-options"), { commandId: "open", type: "ENTER_FREE_AGENCY", payload: {} });
    state.capState.capHolds = [];
    for (const playerId of state.teams[state.userTeamId].playerIds) state.players[playerId].contract.salary = 0;
    const player = getFreeAgents(state).find((candidate) => candidate.contract.status === "UFA");
    if (!player) throw new Error("UFA missing from test market");
    const draft = {
      years: 4,
      year1Salary: 30_000_000,
      annualRaiseRate: 0,
      finalYearOption: "TEAM_OPTION" as const,
      guaranteedPercent: 1,
      rolePromised: "STARTER" as const,
    };
    const teamOptionPreview = getFreeAgentCustomOfferPreview(state, player.id, draft);
    expect(teamOptionPreview).toMatchObject({ valid: true, finalYearOption: "TEAM_OPTION", guaranteedValue: 90_000_000 });
    expect(teamOptionPreview.optionByYear).toEqual(["NONE", "NONE", "NONE", "TEAM_OPTION"]);
    expect(getFreeAgentCustomOfferPreview(state, player.id, { ...draft, finalYearOption: "PLAYER_OPTION" })).toMatchObject({
      valid: true,
      guaranteedValue: 120_000_000,
      optionByYear: ["NONE", "NONE", "NONE", "PLAYER_OPTION"],
    });
    expect(getFreeAgentCustomOfferPreview(state, player.id, { ...draft, years: 1 })).toMatchObject({
      valid: false,
      reason: "球队/球员选项只能用于至少 2 年的合同",
    });

    state = executeFreeAgencyCommand(state, { commandId: "team-option-offer", type: "SUBMIT_FA_OFFER", payload: { playerId: player.id, ...draft } });
    const offer = Object.values(state.freeAgency?.offers ?? {}).find((entry) => entry.playerId === player.id && entry.teamId === state.userTeamId);
    if (!offer) throw new Error("Option offer missing");
    expect(offer).toMatchObject({ finalYearOption: "TEAM_OPTION", guaranteedValue: 90_000_000 });
    offer.utility = 100;
    state = executeFreeAgencyCommand(state, { commandId: "settle-team-option", type: "ADVANCE_FA_DAY", payload: {} });
    expect(state.players[player.id].teamId).toBe(state.userTeamId);
    expect(state.players[player.id].contract).toMatchObject({
      optionType: "TEAM",
      optionByYear: ["NONE", "NONE", "NONE", "TEAM_OPTION"],
      guaranteedByYear: [30_000_000, 30_000_000, 30_000_000, 0],
    });
  });

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

  it("reserves cap, keeps the first three-day deadline and prevents duplicate offers in one market window", () => {
    let state = executeFreeAgencyCommand(postDraftState("fa-offer"), { commandId: "open", type: "ENTER_FREE_AGENCY", payload: {} });
    const player = getFreeAgents(state).find((entry) => entry.contract.status === "UFA") as (typeof state.players)[string];
    const command = { commandId: "offer", type: "SUBMIT_FA_OFFER", payload: { playerId: player.id, years: 3, year1Salary: 8_000_000, guaranteedPercent: 0.8, rolePromised: "ROTATION" } } as const;
    state = executeFreeAgencyCommand(state, command);
    const deadline = state.freeAgency?.markets[player.id].decisionDeadline;
    expect(state.capState.offerReservations.some((entry) => entry.playerId === player.id)).toBe(true);
    expect(executeFreeAgencyCommand(state, command)).toBe(state);
    expect(getFreeAgentOfferPreview(state, player.id).reason).toBe("本队已向该球员提交报价");
    expect(() => executeFreeAgencyCommand(state, { commandId: "offer-2", type: "SUBMIT_FA_OFFER", payload: { playerId: player.id, years: 2, year1Salary: 7_000_000, guaranteedPercent: 1, rolePromised: "BENCH" } })).toThrow(/already submitted an offer/);
    expect(state.freeAgency?.markets[player.id].decisionDeadline).toBe(deadline);
  });

  it("does not reopen bidding after a team offer is rejected during the current market window", () => {
    let state = executeFreeAgencyCommand(postDraftState("fa-rejected-reoffer"), { commandId: "open", type: "ENTER_FREE_AGENCY", payload: {} });
    const player = getFreeAgents(state).find((entry) => entry.contract.status === "UFA") as (typeof state.players)[string];
    state = executeFreeAgencyCommand(state, { commandId: "offer", type: "SUBMIT_FA_OFFER", payload: { playerId: player.id, years: 3, year1Salary: 8_000_000, guaranteedPercent: 0.8, rolePromised: "ROTATION" } });
    const offer = Object.values(state.freeAgency?.offers ?? {}).find((entry) => entry.playerId === player.id && entry.teamId === state.userTeamId);
    if (!offer) throw new Error("User offer missing");
    offer.status = "REJECTED";
    offer.resolutionReason = "ACTIVE_OFFER_LIMIT";
    state.capState.offerReservations = state.capState.offerReservations.filter((entry) => entry.offerId !== offer.offerId);
    expect(getFreeAgentOfferPreview(state, player.id)).toMatchObject({ valid: false, reason: "本队已向该球员提交报价" });
    expect(() => executeFreeAgencyCommand(state, { commandId: "retry", type: "SUBMIT_FA_OFFER", payload: { playerId: player.id, years: 3, year1Salary: 9_000_000, guaranteedPercent: 1, rolePromised: "ROTATION" } })).toThrow(/already submitted an offer/);
    state.freeAgency!.markets[player.id].marketWindowStatus = "CLOSED_NO_SIGNING";
    expect(getFreeAgentOfferPreview(state, player.id).valid).toBe(true);
    const reopened = executeFreeAgencyCommand(state, { commandId: "new-window", type: "SUBMIT_FA_OFFER", payload: { playerId: player.id, years: 3, year1Salary: 9_000_000, guaranteedPercent: 1, rolePromised: "ROTATION" } });
    expect(Object.values(reopened.freeAgency?.offers ?? {}).filter((entry) => entry.playerId === player.id && entry.teamId === state.userTeamId && entry.status === "ACTIVE")).toHaveLength(1);
  });

  it("stores an editable yearly salary schedule and carries it into the signed contract", () => {
    let state = executeFreeAgencyCommand(postDraftState("fa-custom-salary-schedule"), { commandId: "open", type: "ENTER_FREE_AGENCY", payload: {} });
    state.capState.capHolds = [];
    for (const player of Object.values(state.players)) player.contract.salary = 0;
    const player = getFreeAgents(state).find((entry) => entry.contract.status === "UFA");
    if (!player) throw new Error("UFA missing from test market");
    const salaryByYear = [20_000_000, 20_500_000, 21_000_000, 21_500_000];
    const draft = { years: 4, year1Salary: salaryByYear[0], salaryByYear, guaranteedPercent: 1, rolePromised: "STARTER" as const };
    expect(getFreeAgentCustomOfferPreview(state, player.id, draft).valid).toBe(true);
    state = executeFreeAgencyCommand(state, { commandId: "custom-offer", type: "SUBMIT_FA_OFFER", payload: { playerId: player.id, ...draft } });
    const offer = Object.values(state.freeAgency?.offers ?? {}).find((entry) => entry.playerId === player.id && entry.teamId === state.userTeamId);
    expect(offer?.salaryByYear).toEqual(salaryByYear);
    expect(offer?.totalValue).toBe(salaryByYear.reduce((sum, salary) => sum + salary, 0));
    for (let day = 0; day < 3 && state.players[player.id].teamId === "FREE_AGENT"; day += 1) {
      state = executeFreeAgencyCommand(state, { commandId: `custom-day-${day}`, type: "ADVANCE_FA_DAY", payload: {} });
    }
    expect(state.players[player.id].teamId).toBe(state.userTeamId);
    expect(state.players[player.id].contract.salaryByYear).toEqual(salaryByYear);
  });

  it("rejects a custom yearly schedule that exceeds the annual change limit", () => {
    const state = executeFreeAgencyCommand(postDraftState("fa-illegal-salary-schedule"), { commandId: "open", type: "ENTER_FREE_AGENCY", payload: {} });
    const player = getFreeAgents(state).find((entry) => entry.contract.status === "UFA");
    if (!player) throw new Error("UFA missing from test market");
    const draft = { years: 2, year1Salary: 8_000_000, salaryByYear: [8_000_000, 9_000_000], guaranteedPercent: 0.8, rolePromised: "ROTATION" as const };
    expect(getFreeAgentCustomOfferPreview(state, player.id, draft).reason).toMatch(/5%/);
    expect(() => executeFreeAgencyCommand(state, { commandId: "bad-schedule", type: "SUBMIT_FA_OFFER", payload: { playerId: player.id, ...draft } })).toThrow(/annual change limit/);
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
    const accepted = Object.values(state.freeAgency?.offers ?? {}).find((offer) => offer.playerId === player.id && offer.status === "ACCEPTED");
    expect(accepted).toBeDefined();
    expect(state.players[player.id].contract.salaryByYear).toHaveLength(accepted?.years ?? 0);
    expect(state.players[player.id].contract.salaryByYear?.reduce((sum, salary) => sum + salary, 0)).toBe(accepted?.totalValue);
  });

  it("distinguishes a rejected contract, a signing elsewhere and a roster-system rejection", () => {
    let offered = executeFreeAgencyCommand(postDraftState("fa-rejection-notifications"), { commandId: "open", type: "ENTER_FREE_AGENCY", payload: {} });
    offered.capState.capHolds = [];
    for (const player of Object.values(offered.players)) player.contract.salary = 0;
    const player = getFreeAgents(offered).find((candidate) => candidate.contract.status === "UFA");
    if (!player) throw new Error("UFA missing from test market");
    offered = executeFreeAgencyCommand(offered, {
      commandId: "user-offer",
      type: "SUBMIT_FA_OFFER",
      payload: {
        playerId: player.id,
        years: 1,
        year1Salary: LEAGUE_FINANCE_CONFIG.minimumSalary,
        guaranteedPercent: 0,
        rolePromised: "BENCH",
      },
    });
    const userOffer = Object.values(offered.freeAgency?.offers ?? {}).find((offer) => offer.teamId === offered.userTeamId && offer.playerId === player.id);
    if (!userOffer || !offered.freeAgency) throw new Error("User offer missing");

    const fillAiRosters = (state: GameState, exceptTeamId?: string) => {
      for (const team of Object.values(state.teams)) {
        if (team.id === state.userTeamId || team.id === exceptTeamId) continue;
        team.playerIds = Array.from({ length: LEAGUE_FINANCE_CONFIG.rosterLimits.offseasonMaximum }, (_, index) => `blocked-${team.id}-${index}`);
      }
    };

    const rejectedInput = structuredClone(offered);
    fillAiRosters(rejectedInput);
    rejectedInput.freeAgency!.offers[userOffer.offerId].utility = 0;
    rejectedInput.freeAgency!.markets[player.id].decisionDeadline = rejectedInput.freeAgency!.currentDay;
    const rejected = executeFreeAgencyCommand(rejectedInput, { commandId: "reject-day", type: "ADVANCE_FA_DAY", payload: {} });
    expect(rejected.freeAgency?.offers[userOffer.offerId]).toMatchObject({ status: "REJECTED", resolutionReason: "PLAYER_REJECTED" });
    expect(rejected.teamNotifications).toContainEqual(expect.objectContaining({
      playerId: player.id,
      title: "球员拒绝合同报价",
      message: "球员拒绝了本队的合同报价，预留薪资已释放。",
    }));

    const signedElsewhereInput = structuredClone(offered);
    const originalTeamId = signedElsewhereInput.freeAgency!.markets[player.id].originalTeamId;
    const destinationTeamId = Object.keys(signedElsewhereInput.teams).find((teamId) => teamId !== signedElsewhereInput.userTeamId && teamId !== originalTeamId);
    if (!destinationTeamId) throw new Error("AI destination team missing");
    fillAiRosters(signedElsewhereInput, destinationTeamId);
    signedElsewhereInput.freeAgency!.offers[userOffer.offerId].utility = 0;
    signedElsewhereInput.freeAgency!.markets[player.id].decisionDeadline = signedElsewhereInput.freeAgency!.currentDay;
    const destinationDraft = { ...getRecommendedFreeAgentOffer(signedElsewhereInput, player.id, destinationTeamId), years: 1 };
    const destinationTerms = getFreeAgentContractTerms(signedElsewhereInput, player.id, destinationDraft, destinationTeamId);
    const destinationOfferId = "test-destination-offer";
    signedElsewhereInput.freeAgency!.offers[destinationOfferId] = {
      offerId: destinationOfferId,
      playerId: player.id,
      teamId: destinationTeamId,
      createdDay: signedElsewhereInput.freeAgency!.currentDay,
      expiresDay: signedElsewhereInput.freeAgency!.currentDay,
      years: destinationDraft.years,
      year1Salary: destinationDraft.year1Salary,
      totalValue: destinationTerms.totalValue,
      guaranteedValue: destinationTerms.guaranteedValue,
      rolePromised: destinationDraft.rolePromised,
      capReservation: destinationDraft.year1Salary,
      utility: 100,
      status: "ACTIVE",
      kind: "UFA_OFFER",
    };
    signedElsewhereInput.capState.offerReservations.push({
      offerId: destinationOfferId,
      playerId: player.id,
      teamId: destinationTeamId,
      amount: destinationDraft.year1Salary,
    });
    for (let index = 1; index < BALANCE_CONFIG.ai.maxNewFreeAgentOffersPerTeamDay; index += 1) {
      signedElsewhereInput.freeAgency!.offers[`test-ai-slot-${index}`] = {
        ...signedElsewhereInput.freeAgency!.offers[destinationOfferId],
        offerId: `test-ai-slot-${index}`,
        playerId: `unused-player-${index}`,
        status: "WITHDRAWN",
      };
    }
    const signedElsewhere = executeFreeAgencyCommand(signedElsewhereInput, { commandId: "sign-day", type: "ADVANCE_FA_DAY", payload: {} });
    expect(signedElsewhere.players[player.id].teamId).toBe(destinationTeamId);
    expect(signedElsewhere.teamNotifications).toContainEqual(expect.objectContaining({
      playerId: player.id,
      title: "球员拒绝合同报价",
      message: `球员拒绝了本队的合同报价，并与 ${signedElsewhere.teams[destinationTeamId].fullName} 签约。预留薪资已释放。`,
    }));

    const rosterFullInput = structuredClone(offered);
    fillAiRosters(rosterFullInput);
    rosterFullInput.teams[rosterFullInput.userTeamId].playerIds = Array.from(
      { length: LEAGUE_FINANCE_CONFIG.rosterLimits.offseasonMaximum },
      (_, index) => `user-roster-slot-${index}`,
    );
    const rosterFull = executeFreeAgencyCommand(rosterFullInput, { commandId: "roster-full-day", type: "ADVANCE_FA_DAY", payload: {} });
    const rosterNotice = rosterFull.teamNotifications?.find((notice) => notice.playerId === player.id && notice.title === "报价因名单已满失效");
    expect(rosterFull.freeAgency?.offers[userOffer.offerId]).toMatchObject({ status: "REJECTED", resolutionReason: "ROSTER_FULL" });
    expect(rosterNotice?.message).toBe("球队名单已满，系统已撤销本次合同报价并释放预留薪资。");
    expect(rosterNotice?.message).not.toContain("球员拒绝");
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
    expect(preview).toMatchObject({ draft: recommended, valid: true });
    expect(preview.salaryByYear).toHaveLength(recommended.years);
    expect(preview.salaryByYear[0]).toBe(recommended.year1Salary);
    expect(preview.totalValue).toBe(preview.salaryByYear.reduce((sum, salary) => sum + salary, 0));
    expect(preview.guaranteedValue).toBe(Math.round(preview.totalValue * recommended.guaranteedPercent));
    expect(preview.salaryByYear.slice(1).every((salary, index) => salary >= preview.salaryByYear[index])).toBe(true);
    expect(recommended.year1Salary).toBe(Math.round(getProjectedMarketSalary(player) / 10_000) * 10_000);
    expect(recommended.guaranteedPercent).toBe(BALANCE_CONFIG.ai.freeAgency.guaranteedPercent);
    expect(getFreeAgentCustomOfferPreview(state, player.id, {
      ...recommended,
      salaryByYear: preview.salaryByYear.map((salary) => Math.round(salary / 10_000) * 10_000),
    }).valid).toBe(true);

    const capped = structuredClone(state);
    for (const playerId of capped.teams[capped.userTeamId].playerIds) capped.players[playerId].contract.salary = 50_000_000;
    expect(getFreeAgentOfferPreview(capped, player.id)).toMatchObject({ valid: false, reason: "可用薪资空间不足" });
  });
});
