import { describe, expect, it } from "vitest";
import { BALANCE_CONFIG } from "../../config/balanceConfig";
import { getSeasonFinanceConfig, LEAGUE_FINANCE_CONFIG } from "../../config/leagueFinance";
import { EXPANSION_BRAND_PRESETS } from "../../data/expansionBrands";
import { createExpansionCareerFromBundledDataset } from "../../data/hupuRoster";
import { getCapSheet } from "../cap/CapSheetService";
import { executeDraftCommand, getAvailableDraftProspects } from "../draft/DraftService";
import { executeExpansionCommand, getSelectableExpansionPlayers } from "../expansion/ExpansionService";
import { stableHash, stableSerialize } from "../random/hash";
import { createCareer, createExpansionCareer } from "../season/career";
import { calculatePlayerOverall } from "../player/PlayerRatingService";
import { publicPlayerValue } from "../ai/AIValueService";
import { executeRosterCommand } from "../roster/RosterService";
import type { GameState } from "../state/types";
import {
  advanceFreeAgencyDay,
  executeFreeAgencyCommand,
  getFreeAgentContractTerms,
  getFreeAgentCustomOfferPreview,
  getFreeAgentOfferPreview,
  getFreeAgents,
  getOwnPlayerExtensionPreview,
  getRecommendedOwnPlayerExtension,
  enterFreeAgency,
  getPendingUserQualifyingOfferPlayers,
  getProjectedMarketSalary,
  getRecommendedFreeAgentOffer,
  renewOwnPlayer,
  submitOwnPlayerExtensionOffer,
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

function expiringStarState(seed: string) {
  const state = postDraftState(seed);
  const player = state.players[state.teams.ATL.playerIds[0]];
  for (const key of Object.keys(player.attributes) as Array<keyof typeof player.attributes>) player.attributes[key] = 92;
  player.overallAdjustment = 0;
  player.age = 27;
  player.personality = "LOYAL";
  player.morale = 80;
  player.birdTeamId = "ATL";
  player.birdYears = 4;
  player.teamId = "FREE_AGENT";
  player.contract = {
    salary: 30_000_000, yearsRemaining: 0, guaranteedAmount: 0, status: "UFA",
    optionType: "NONE", optionDecision: "NOT_APPLICABLE", contractType: "STANDARD",
    contractId: "expiring-star", startSeason: state.league.seasonYear - 3, endSeason: state.league.seasonYear - 1,
    currentYearIndex: 3, salaryByYear: [30_000_000, 30_000_000, 30_000_000, 30_000_000], signedTeamId: "ATL",
  };
  state.teams.ATL.playerIds = state.teams.ATL.playerIds.filter((id) => id !== player.id);
  state.contractLifecycle = { rolloverSeasonId: state.league.seasonId, pendingUserTeamOptionPlayerIds: [], renewalEligiblePlayerIds: [player.id], transactionLog: [], completed: true };
  return { state, player };
}

describe("AI renewals before the public market", () => {
  it("retains a willing expiring star at market salary with Bird rights and deterministic atomic settlement", () => {
    const { state, player } = expiringStarState("pre-market-renewal");
    for (const id of state.teams.ATL.playerIds) state.players[id].contract.salary = 30_000_000;
    const before = stableSerialize(state);
    const next = enterFreeAgency(state);
    const renewed = next.players[player.id];
    expect(renewed.teamId).toBe("ATL");
    expect(renewed.contract.status).toBe("STANDARD");
    expect(renewed.contract.yearsRemaining).toBe(3);
    expect(renewed.contract.salary).toBeCloseTo(getProjectedMarketSalary(player, state.league.seasonYear), -4);
    expect(renewed.contract.signedTeamId).toBe("ATL");
    expect(renewed.contract.startSeason).toBe(state.league.seasonYear);
    expect(renewed.contract.guaranteedAmount).toBe(renewed.contract.salaryByYear!.reduce((sum, salary) => sum + salary, 0));
    expect(renewed.birdYears).toBe(4);
    expect(getFreeAgents(next).some((entry) => entry.id === player.id)).toBe(false);
    expect(next.capState.capHolds.some((entry) => entry.playerId === player.id)).toBe(false);
    expect(next.capState.offerReservations.some((entry) => entry.playerId === player.id)).toBe(false);
    expect(next.freeAgency!.transactionLog.some((entry) => entry.includes(player.name) && entry.includes("续约"))).toBe(true);
    expect(next.contractLifecycle?.transactionLog.some((entry) => entry.includes(player.name) && entry.includes("续约"))).toBe(true);
    expect(stableHash(stableSerialize(state))).toBe(stableHash(before));
    expect(stableHash(stableSerialize(enterFreeAgency(structuredClone(state))))).toBe(stableHash(stableSerialize(next)));
    const loaded = JSON.parse(JSON.stringify(state)) as GameState;
    expect(stableHash(JSON.stringify(enterFreeAgency(loaded)))).toBe(stableHash(JSON.stringify(next)));
    expect(enterFreeAgency(next)).toBe(next);
  });

  it("keeps unaffordable non-Bird stars available without leaving a partial offer", () => {
    const { state, player } = expiringStarState("pre-market-renewal");
    player.birdYears = 1;
    for (const id of state.teams.ATL.playerIds) state.players[id].contract.salary = 30_000_000;
    const next = enterFreeAgency(state);
    expect(next.players[player.id].teamId).toBe("FREE_AGENT");
    expect(Object.values(next.freeAgency!.offers).some((entry) => entry.playerId === player.id)).toBe(false);
    expect(next.capState.offerReservations).toHaveLength(0);
  });

  it("leaves the user's expirings, stale free agents and team-option rejections to normal market decisions", () => {
    const { state, player } = expiringStarState("pre-market-renewal");
    const user = structuredClone(state);
    user.players[player.id].birdTeamId = user.userTeamId;
    user.players[player.id].contract.signedTeamId = user.userTeamId;
    expect(enterFreeAgency(user).players[player.id].teamId).toBe("FREE_AGENT");
    state.contractLifecycle!.renewalEligiblePlayerIds = [];
    expect(enterFreeAgency(state).players[player.id].teamId).toBe("FREE_AGENT");
    delete state.contractLifecycle!.renewalEligiblePlayerIds;
    player.contract.optionType = "TEAM";
    player.contract.optionDecision = "DECLINED";
    expect(enterFreeAgency(state).players[player.id].teamId).toBe("FREE_AGENT");
    player.contract.optionType = "NONE";
    player.contract.optionDecision = "NOT_APPLICABLE";
    player.contract.endSeason = state.league.seasonYear - 2;
    expect(enterFreeAgency(state).players[player.id].teamId).toBe("FREE_AGENT");
    player.contract.optionType = "PLAYER";
    player.contract.optionDecision = "DECLINED";
    player.contract.endSeason = state.league.seasonYear - 1;
    player.contract.currentYearIndex = 2;
    expect(enterFreeAgency(state).players[player.id].teamId).toBe("FREE_AGENT");
  });

  it("supports fresh expirings in older saves and own-team RFA renewals", () => {
    const { state, player } = expiringStarState("pre-market-renewal");
    delete state.contractLifecycle!.renewalEligiblePlayerIds;
    expect(enterFreeAgency(state).players[player.id].teamId).toBe("ATL");
    player.contract.optionType = "PLAYER";
    player.contract.optionDecision = "DECLINED";
    expect(enterFreeAgency(state).players[player.id].teamId).toBe("ATL");
    player.contract.status = "RFA";
    player.contract.qualifyingOfferDecision = "PENDING";
    const next = enterFreeAgency(state);
    expect(next.players[player.id].teamId).toBe("ATL");
    expect(Object.values(next.freeAgency!.offers).find((entry) => entry.playerId === player.id)?.kind).toBe("RFA_OWN_TEAM_OFFER");
  });

  it("allows the current team to retain traded players whose contract was signed elsewhere", () => {
    const { state, player } = expiringStarState("pre-market-renewal");
    player.contract.signedTeamId = "BOS";
    expect(enterFreeAgency(state).players[player.id].teamId).toBe("ATL");
    delete state.contractLifecycle!.renewalEligiblePlayerIds;
    expect(enterFreeAgency(state).players[player.id].teamId).toBe("ATL");
  });

  it("makes a roster slot only for a successful upgrade and rolls it back when the cap blocks renewal", () => {
    const { state, player } = expiringStarState("pre-market-renewal");
    while (state.teams.ATL.playerIds.length < 15) {
      const replacement = structuredClone(state.players[state.teams.ATL.playerIds.at(-1)!]);
      replacement.id = `atl-full-${state.teams.ATL.playerIds.length}`;
      state.players[replacement.id] = replacement;
      state.teams.ATL.playerIds.push(replacement.id);
    }
    for (const id of state.teams.ATL.playerIds) {
      state.players[id].contract.salary = 30_000_000;
      state.players[id].contract.status = "STANDARD";
    }
    const next = enterFreeAgency(state);
    expect(next.players[player.id].teamId).toBe("ATL");
    expect(next.teams.ATL.playerIds).toHaveLength(15);
    player.birdYears = 1;
    const blocked = enterFreeAgency(state);
    const withoutRenewals = structuredClone(state);
    withoutRenewals.contractLifecycle!.renewalEligiblePlayerIds = [];
    const baseline = enterFreeAgency(withoutRenewals);
    expect(blocked.players[player.id].teamId).toBe("FREE_AGENT");
    expect(blocked.teams.ATL.playerIds).toEqual(baseline.teams.ATL.playerIds);
    expect(blocked.capState.deadMoney.filter((entry) => entry.teamId === "ATL")).toEqual(baseline.capState.deadMoney.filter((entry) => entry.teamId === "ATL"));
  });

  it("substantially reduces high-rated free agents while retaining some star departures", () => {
    const { state, player } = expiringStarState("pre-market-population");
    const stars = Object.values(state.teams).filter((team) => team.id !== state.userTeamId).map((team) => {
      const star = structuredClone(player);
      star.id = team.playerIds[0];
      star.personality = "BALANCED";
      star.birdTeamId = team.id;
      star.contract.signedTeamId = team.id;
      state.players[star.id] = star;
      team.playerIds = team.playerIds.filter((id) => id !== star.id);
      return star;
    });
    state.contractLifecycle!.renewalEligiblePlayerIds = stars.map((star) => star.id);
    const next = enterFreeAgency(state);
    const retained = stars.filter((star) => next.players[star.id].teamId === star.birdTeamId);
    expect(retained.length).toBeGreaterThan(stars.length * 0.6);
    expect(retained.length).toBeLessThan(stars.length);
    expect(Object.values(next.teams).filter((team) => team.id !== next.userTeamId).every((team) => team.playerIds.length <= 15)).toBe(true);
    const middleTier = structuredClone(state);
    for (const star of stars) {
      const attributes = middleTier.players[star.id].attributes;
      for (const key of Object.keys(attributes) as Array<keyof typeof attributes>) attributes[key] = 82;
    }
    const middleMarket = enterFreeAgency(middleTier);
    const retainedMiddle = stars.filter((star) => middleMarket.players[star.id].teamId === star.birdTeamId);
    expect(retainedMiddle.length).toBeLessThan(retained.length);
    expect(stars.length - retainedMiddle.length).toBeGreaterThanOrEqual(stars.length * 0.3);
  });
});

describe("whole-dollar maximum salaries", () => {
  const cases = [
    { seasonYear: 2027, serviceYears: 3, percentage: 0.25 },
    { seasonYear: 2027, serviceYears: 10, percentage: 0.35 },
    { seasonYear: 2028, serviceYears: 8, percentage: 0.3 },
  ];

  function maximumSalaryState(seasonYear: number, serviceYears: number) {
    const state = createCareer(`rounded-max-${seasonYear}-${serviceYears}`);
    state.league = { currentPhase: "REGULAR_PRE_DEADLINE", seasonYear, seasonId: `${seasonYear}-${String(seasonYear + 1).slice(-2)}` };
    const player = state.players[state.teams[state.userTeamId].playerIds[0]];
    player.age = 27;
    player.serviceYears = serviceYears;
    for (const key of Object.keys(player.attributes) as Array<keyof typeof player.attributes>) player.attributes[key] = 92;
    player.contract = { ...player.contract, status: "STANDARD", yearsRemaining: 1,
      salary: 8_000_000, guaranteedAmount: 8_000_000, salaryByYear: [8_000_000],
      guaranteedByYear: [8_000_000], optionByYear: ["NONE"], currentYearIndex: 0,
      startSeason: seasonYear, endSeason: seasonYear };
    return { state, player };
  }

  it.each(cases)("submits and settles a rounded maximum UFA offer in $seasonYear with $serviceYears service years", ({ seasonYear, serviceYears, percentage }) => {
    const { state, player } = maximumSalaryState(seasonYear, serviceYears);
    const maximum = Math.round(getSeasonFinanceConfig(seasonYear).salaryCap * percentage);
    state.teams[state.userTeamId].playerIds = state.teams[state.userTeamId].playerIds.filter((id) => id !== player.id);
    for (const id of state.teams[state.userTeamId].playerIds) state.players[id].contract.salary = 0;
    player.teamId = "FREE_AGENT";
    player.contract.status = "UFA";
    player.contract.yearsRemaining = 0;
    const recommended = getRecommendedFreeAgentOffer(state, player.id);
    expect(Number.isInteger(recommended.year1Salary)).toBe(true);
    expect(getFreeAgentCustomOfferPreview(state, player.id, recommended).valid).toBe(true);
    const draft = { ...recommended, year1Salary: maximum, guaranteedPercent: 1, rolePromised: "STARTER" as const };
    const preview = getFreeAgentCustomOfferPreview(state, player.id, draft);
    expect(preview.valid).toBe(true);
    expect(preview.salaryByYear[0]).toBe(draft.year1Salary);
    expect(getFreeAgentCustomOfferPreview(state, player.id, { ...draft, year1Salary: maximum + 1 }).valid).toBe(false);
    const mismatched = { ...draft, salaryByYear: preview.salaryByYear.map((salary, index) => salary + (index === 0 ? 1 : 0)) };
    expect(getFreeAgentCustomOfferPreview(state, player.id, mismatched).reason).toBe("首年薪资与逐年薪资表不一致");
    expect(() => executeFreeAgencyCommand(state, { commandId: "mismatched", type: "SUBMIT_FA_OFFER", payload: { playerId: player.id, ...mismatched } })).toThrow(/Salary schedule/);
    const command = { commandId: "rounded-max", type: "SUBMIT_FA_OFFER", payload: { playerId: player.id, ...draft } } as const;
    let next = executeFreeAgencyCommand(state, command);
    const loaded = JSON.parse(JSON.stringify(next)) as GameState;
    expect(executeFreeAgencyCommand(loaded, command)).toBe(loaded);
    for (let day = 0; day < 3 && next.players[player.id].teamId === "FREE_AGENT"; day += 1) next = advanceFreeAgencyDay(next);
    expect(next.players[player.id].teamId).toBe(state.userTeamId);
    expect(next.players[player.id].contract.salaryByYear?.[0]).toBe(maximum);
    expect(next.capState.offerReservations.some((reservation) => reservation.playerId === player.id)).toBe(false);
  });

  it.each(cases)("submits and settles a rounded maximum extension starting in $seasonYear with $serviceYears service years", ({ seasonYear, serviceYears, percentage }) => {
    const { state, player } = maximumSalaryState(seasonYear - 1, serviceYears);
    const maximum = Math.round(getSeasonFinanceConfig(seasonYear).salaryCap * percentage);
    const recommended = { ...getRecommendedOwnPlayerExtension(state, player.id), guaranteedPercent: 1, rolePromised: "STARTER" as const };
    expect(Number.isInteger(recommended.year1Salary)).toBe(true);
    expect(getOwnPlayerExtensionPreview(state, player.id, recommended).valid).toBe(true);
    const draft = { ...recommended, year1Salary: maximum };
    const preview = getOwnPlayerExtensionPreview(state, player.id, draft);
    expect(preview.valid).toBe(true);
    expect(preview.salaryByYear[0]).toBe(draft.year1Salary);
    expect(getOwnPlayerExtensionPreview(state, player.id, { ...draft, year1Salary: maximum + 1 }).valid).toBe(false);
    const command = { commandId: "rounded-extension", type: "SUBMIT_OWN_EXTENSION_OFFER", payload: { playerId: player.id, ...draft } } as const;
    const submitted = executeFreeAgencyCommand(state, command);
    expect(submitted.players[player.id].contract.salaryByYear).toEqual([8_000_000]);
    const loaded = JSON.parse(JSON.stringify(submitted)) as GameState;
    expect(executeFreeAgencyCommand(loaded, command)).toBe(loaded);
    const settled = advanceFreeAgencyDay(loaded);
    expect(settled.players[player.id].contract.salaryByYear?.[1]).toBe(maximum);
    expect(Object.values(settled.freeAgency!.offers).find((offer) => offer.kind === "OWN_EXTENSION_OFFER")?.status).toBe("ACCEPTED");
  });
});

describe("user early extensions", () => {
  function expiringOwnPlayerState(seed: string) {
    const state = createCareer(seed);
    state.league.currentPhase = "REGULAR_PRE_DEADLINE";
    const player = state.players[state.teams[state.userTeamId].playerIds[0]];
    player.contract = {
      ...player.contract,
      status: "STANDARD",
      yearsRemaining: 1,
      salary: 8_000_000,
      guaranteedAmount: 8_000_000,
      salaryByYear: [8_000_000],
      guaranteedByYear: [8_000_000],
      optionByYear: ["NONE"],
      currentYearIndex: 0,
      startSeason: state.league.seasonYear,
      endSeason: state.league.seasonYear,
    };
    return { state, player };
  }

  it("submits an offer first and only appends the extension after next-day acceptance", () => {
    const { state, player } = expiringOwnPlayerState("user-extension-offer-flow");
    const extension = { ...getRecommendedOwnPlayerExtension(state, player.id), guaranteedPercent: 1, finalYearOption: "NONE" as const, rolePromised: "ROTATION" as const };
    expect(getOwnPlayerExtensionPreview(state, player.id, extension).valid).toBe(true);
    const submitted = submitOwnPlayerExtensionOffer(state, { playerId: player.id, ...extension });
    expect(submitted.players[player.id].contract.salaryByYear).toEqual([8_000_000]);
    const offer = Object.values(submitted.freeAgency!.offers).find((entry) => entry.kind === "OWN_EXTENSION_OFFER");
    expect(offer?.status).toBe("ACTIVE");
    expect(offer?.capReservation).toBe(0);
    offer!.utility = 100;
    const settled = advanceFreeAgencyDay(submitted);
    expect(settled.players[player.id].contract.salaryByYear).toHaveLength(1 + extension.years);
    expect(settled.freeAgency!.offers[offer!.offerId].status).toBe("ACCEPTED");
    expect(settled.teamNotifications?.some((entry) => entry.title === "提前续约成功")).toBe(true);
    expect(settled.contractLifecycle?.transactionLog.some((entry) => entry.includes("提前续约"))).toBe(true);
  });

  it("keeps the current contract when the player rejects the offer and notifies the team", () => {
    const { state, player } = expiringOwnPlayerState("user-extension-rejection-flow");
    const extension = { ...getRecommendedOwnPlayerExtension(state, player.id), guaranteedPercent: 0, finalYearOption: "NONE" as const, rolePromised: "BENCH" as const };
    const submitted = submitOwnPlayerExtensionOffer(state, { playerId: player.id, ...extension });
    const offer = Object.values(submitted.freeAgency!.offers).find((entry) => entry.kind === "OWN_EXTENSION_OFFER");
    if (!offer) throw new Error("extension offer missing");
    offer.utility = 0;
    const settled = advanceFreeAgencyDay(submitted);
    expect(settled.players[player.id].contract.salaryByYear).toEqual([8_000_000]);
    expect(settled.freeAgency!.offers[offer.offerId].status).toBe("REJECTED");
    expect(settled.teamNotifications?.some((entry) => entry.title === "提前续约报价被拒绝")).toBe(true);
  });

  it("appends a legal extension after the current season and removes the player from upcoming expirings", () => {
    const state = createCareer("user-own-player-extension");
    state.league.currentPhase = "REGULAR_PRE_DEADLINE";
    const player = state.players[state.teams[state.userTeamId].playerIds[0]];
    player.contract = {
      ...player.contract,
      status: "STANDARD",
      yearsRemaining: 1,
      salary: 8_000_000,
      guaranteedAmount: 8_000_000,
      salaryByYear: [8_000_000],
      guaranteedByYear: [8_000_000],
      optionByYear: ["NONE"],
      currentYearIndex: 0,
      startSeason: state.league.seasonYear,
      endSeason: state.league.seasonYear,
    };
    const extension = getRecommendedOwnPlayerExtension(state, player.id);
    const next = renewOwnPlayer(state, { playerId: player.id, ...extension });
    const renewed = next.players[player.id].contract;
    expect(renewed.salary).toBe(8_000_000);
    expect(renewed.salaryByYear?.[0]).toBe(8_000_000);
    expect(renewed.salaryByYear).toHaveLength(1 + extension.years);
    expect(renewed.yearsRemaining).toBe(1 + extension.years);
    expect(renewed.endSeason).toBe(state.league.seasonYear + extension.years);
    expect(next.contractLifecycle?.transactionLog.some((entry) => entry.includes(player.name) && entry.includes("提前续约"))).toBe(true);
    expect(stableHash(stableSerialize(state))).not.toBe(stableHash(stableSerialize(next)));
    expect(next.players[player.id].teamId).toBe(state.userTeamId);
  });

  it("rejects another team's player and non-expiring contracts", () => {
    const state = createCareer("user-own-player-extension-guards");
    state.league.currentPhase = "REGULAR_PRE_DEADLINE";
    const player = state.players[state.teams[state.userTeamId].playerIds[0]];
    expect(() => renewOwnPlayer(state, { playerId: player.id, years: 2, year1Salary: 5_000_000 })).toThrow("PLAYER_IS_NOT_EXPIRING");
    player.contract.yearsRemaining = 1;
    const otherTeamPlayer = state.players[state.teams.BOS.playerIds[0]];
    expect(() => renewOwnPlayer(state, { playerId: otherTeamPlayer.id, years: 2, year1Salary: 5_000_000 })).toThrow("OWN_PLAYER_RENEWAL_NOT_ALLOWED");
  });
});

describe("Stage 4 free agency", () => {
  it("does not repeatedly attempt AI offers when a team has no cap room", () => {
    const state = createCareer("ai-fa-no-cap-room");
    const team = state.teams.BOS;
    const removedId = team.playerIds.pop();
    if (!removedId) throw new Error("Expected a Boston roster player");
    state.players[removedId].teamId = "FREE_AGENT";
    state.players[removedId].contract.status = "UFA";
    for (const playerId of team.playerIds) state.players[playerId].contract.salary = 30_000_000;
    state.capState.capHolds = [];
    expect(getCapSheet(state, team.id).availableCapSpace).toBeLessThan(0);
    const first = advanceFreeAgencyDay(state);
    const second = advanceFreeAgencyDay(first);
    expect(Object.values(second.freeAgency!.offers).filter((offer) => offer.teamId === team.id)).toHaveLength(0);
    expect(second.teams[team.id].playerIds).toHaveLength(team.playerIds.length);
  });

  it("settles the current day before an early close and withdraws only unresolved offers", () => {
    let state = executeFreeAgencyCommand(postDraftState("fa-early-close"), { commandId: "open", type: "ENTER_FREE_AGENCY", payload: {} });
    const player = getFreeAgents(state).find((entry) => entry.contract.status === "UFA");
    if (!player) throw new Error("UFA missing from test market");
    state = executeFreeAgencyCommand(state, { commandId: "offer", type: "SUBMIT_FA_OFFER", payload: { playerId: player.id, years: 1, year1Salary: 8_000_000, guaranteedPercent: 1, rolePromised: "ROTATION" } });
    const offer = Object.values(state.freeAgency!.offers).find((entry) => entry.playerId === player.id && entry.teamId === state.userTeamId);
    if (!offer) throw new Error("User offer missing");
    offer.utility = 100;
    const closed = executeRosterCommand(state, { commandId: "close-early", type: "CLOSE_FREE_AGENCY", payload: {} });
    expect(closed.freeAgency!.currentDay).toBe(state.freeAgency!.currentDay + 1);
    expect(closed.freeAgency!.offers[offer.offerId].status).toBe("ACCEPTED");
    expect(closed.players[player.id].teamId).toBe(state.userTeamId);
    expect(closed.league.currentPhase).toBe("PRESEASON");
    expect(Object.values(closed.freeAgency!.offers).every((entry) => entry.status !== "ACTIVE")).toBe(true);
    expect(executeRosterCommand(closed, { commandId: "close-early", type: "CLOSE_FREE_AGENCY", payload: {} })).toBe(closed);
  });

  it("keeps an offer valid on expiresDay and expires it only on the next day", () => {
    let state = executeFreeAgencyCommand(postDraftState("fa-expiry-inclusive"), { commandId: "open", type: "ENTER_FREE_AGENCY", payload: {} });
    const player = getFreeAgents(state).find((entry) => entry.contract.status === "UFA");
    if (!player) throw new Error("UFA missing from test market");
    state = executeFreeAgencyCommand(state, { commandId: "offer", type: "SUBMIT_FA_OFFER", payload: { playerId: player.id, years: 1, year1Salary: 8_000_000, guaranteedPercent: 1, rolePromised: "ROTATION" } });
    const offer = Object.values(state.freeAgency!.offers).find((entry) => entry.playerId === player.id && entry.teamId === state.userTeamId);
    if (!offer) throw new Error("User offer missing");
    offer.expiresDay = 1;
    state.freeAgency!.markets[player.id].decisionDeadline = 3;
    for (const team of Object.values(state.teams)) {
      if (team.id !== state.userTeamId) team.playerIds = Array.from({ length: LEAGUE_FINANCE_CONFIG.rosterLimits.offseasonMaximum }, (_, index) => `blocked-${team.id}-${index}`);
    }

    const acceptedInput = structuredClone(state);
    acceptedInput.freeAgency!.offers[offer.offerId].utility = 100;
    const accepted = executeFreeAgencyCommand(acceptedInput, { commandId: "settle-expiry-day", type: "ADVANCE_FA_DAY", payload: {} });
    expect(accepted.freeAgency!.offers[offer.offerId].status).toBe("ACCEPTED");

    state.freeAgency!.offers[offer.offerId].utility = 0;
    state = executeFreeAgencyCommand(state, { commandId: "settle-day-one", type: "ADVANCE_FA_DAY", payload: {} });
    expect(state.freeAgency!.currentDay).toBe(2);
    expect(state.freeAgency!.offers[offer.offerId].status).toBe("EXPIRED");
    expect(state.capState.offerReservations.some((entry) => entry.offerId === offer.offerId)).toBe(false);
  });

  it("lets an own-team Bird UFA sign over the cap but keeps other UFA offers cap-limited", () => {
    const state = executeFreeAgencyCommand(postDraftState("fa-bird-ufa"), { commandId: "open", type: "ENTER_FREE_AGENCY", payload: {} });
    const player = getFreeAgents(state).find((entry) => entry.contract.status === "UFA");
    if (!player) throw new Error("UFA missing from test market");
    player.birdTeamId = state.userTeamId;
    player.birdYears = 4;
    state.freeAgency!.markets[player.id].originalTeamId = state.userTeamId;
    state.capState.capHolds.push({ playerId: player.id, teamId: state.userTeamId, amount: 10_000_000, type: "BIRD_UFA" });
    for (const playerId of state.teams[state.userTeamId].playerIds) state.players[playerId].contract.salary = 20_000_000;
    expect(getCapSheet(state, state.userTeamId).availableCapSpace).toBeLessThan(0);
    const maxSalaryPercent = player.serviceYears >= 10 ? LEAGUE_FINANCE_CONFIG.maximumSalaryPercentages.tenPlusYears
      : player.serviceYears >= 7 ? LEAGUE_FINANCE_CONFIG.maximumSalaryPercentages.sevenToNineYears
        : LEAGUE_FINANCE_CONFIG.maximumSalaryPercentages.zeroToSixYears;
    const draft = { years: 1, year1Salary: LEAGUE_FINANCE_CONFIG.salaryCap * maxSalaryPercent, guaranteedPercent: 1, rolePromised: "STARTER" as const };
    expect(getFreeAgentCustomOfferPreview(state, player.id, draft).valid).toBe(true);
    expect(getFreeAgentCustomOfferPreview(state, player.id, { ...draft, year1Salary: draft.year1Salary + 1 }).valid).toBe(false);
    const submitted = executeFreeAgencyCommand(state, { commandId: "bird-offer", type: "SUBMIT_FA_OFFER", payload: { playerId: player.id, ...draft } });
    expect(Object.values(submitted.freeAgency!.offers).some((offer) => offer.playerId === player.id && offer.teamId === state.userTeamId && offer.status === "ACTIVE")).toBe(true);
    const birdOffer = Object.values(submitted.freeAgency!.offers).find((offer) => offer.playerId === player.id && offer.teamId === state.userTeamId);
    if (!birdOffer) throw new Error("Bird offer missing");
    birdOffer.utility = 100;
    const signed = executeFreeAgencyCommand(submitted, { commandId: "settle-bird-offer", type: "ADVANCE_FA_DAY", payload: {} });
    expect(signed.players[player.id].teamId).toBe(state.userTeamId);
    expect(signed.players[player.id].contract.salary).toBe(draft.year1Salary);
    expect(signed.players[player.id].birdYears).toBe(4);

    const withoutRights = structuredClone(state);
    withoutRights.players[player.id].birdYears = LEAGUE_FINANCE_CONFIG.capHolds.birdEligibilityYears - 1;
    expect(getFreeAgentCustomOfferPreview(withoutRights, player.id, draft).reason).toBe("可用薪资空间不足");
    expect(() => executeFreeAgencyCommand(withoutRights, { commandId: "no-bird-offer", type: "SUBMIT_FA_OFFER", payload: { playerId: player.id, ...draft } })).toThrow(/Insufficient cap space/);
    const withoutHold = structuredClone(state);
    withoutHold.capState.capHolds = withoutHold.capState.capHolds.filter((hold) => hold.playerId !== player.id);
    expect(getFreeAgentCustomOfferPreview(withoutHold, player.id, draft).reason).toBe("可用薪资空间不足");
  });

  it("settles day 120 exactly once and automatically ends the main market", () => {
    let state = executeFreeAgencyCommand(postDraftState("fa-day-120"), { commandId: "open", type: "ENTER_FREE_AGENCY", payload: {} });
    state.freeAgency!.currentDay = 120;
    for (const team of Object.values(state.teams)) {
      if (team.id !== state.userTeamId) team.playerIds = Array.from({ length: LEAGUE_FINANCE_CONFIG.rosterLimits.offseasonMaximum }, (_, index) => `blocked-${team.id}-${index}`);
    }
    state = executeFreeAgencyCommand(state, { commandId: "last-day", type: "ADVANCE_FA_DAY", payload: {} });
    expect(state.freeAgency!.currentDay).toBe(121);
    expect(state.league.currentPhase).toBe("PRESEASON");
    expect(Object.values(state.freeAgency!.offers).every((offer) => offer.status !== "ACTIVE")).toBe(true);
    expect(executeFreeAgencyCommand(state, { commandId: "last-day", type: "ADVANCE_FA_DAY", payload: {} })).toBe(state);
  });

  it("waits for a day-120 RFA match decision before closing the main market", () => {
    let state = executeFreeAgencyCommand(postDraftState("fa-last-day-rfa"), { commandId: "open", type: "ENTER_FREE_AGENCY", payload: {} });
    const player = getFreeAgents(state).find((entry) => entry.contract.status === "RFA");
    const bidder = Object.values(state.teams).find((team) => team.id !== state.userTeamId);
    if (!player || !bidder) throw new Error("RFA or bidder missing from test market");
    state.freeAgency!.currentDay = 120;
    state.freeAgency!.markets[player.id] = { playerId: player.id, originalTeamId: state.userTeamId, marketWindowStartDay: 120, decisionDeadline: 120, marketWindowStatus: "OPEN" };
    player.birdTeamId = state.userTeamId;
    for (const team of Object.values(state.teams)) {
      if (team.id !== state.userTeamId && team.id !== bidder.id) team.playerIds = Array.from({ length: LEAGUE_FINANCE_CONFIG.rosterLimits.offseasonMaximum }, (_, index) => `blocked-${team.id}-${index}`);
    }
    const salary = LEAGUE_FINANCE_CONFIG.minimumSalary;
    state.freeAgency!.offers.sheet = {
      offerId: "sheet", playerId: player.id, teamId: bidder.id, createdDay: 120, expiresDay: 120,
      years: 1, year1Salary: salary, totalValue: salary, guaranteedValue: salary,
      rolePromised: "BENCH", capReservation: salary, utility: 100, status: "ACTIVE", kind: "RFA_OFFER_PROPOSAL",
    };
    state.capState.offerReservations.push({ offerId: "sheet", playerId: player.id, teamId: bidder.id, amount: salary });
    for (let index = 0; index < BALANCE_CONFIG.ai.maxNewFreeAgentOffersPerTeamDay; index += 1) {
      state.freeAgency!.offers[`skip-ai-${index}`] = { ...state.freeAgency!.offers.sheet, offerId: `skip-ai-${index}`, playerId: `unused-player-${index}`, status: "WITHDRAWN" };
    }
    state = executeFreeAgencyCommand(state, { commandId: "last-day", type: "ADVANCE_FA_DAY", payload: {} });
    expect(state.freeAgency!.currentDay).toBe(121);
    expect(state.freeAgency!.closeAfterPendingRfa).toBe(true);
    expect(state.league.currentPhase).toBe("OFFSEASON_POST_DRAFT");
    expect(state.freeAgency!.pendingUserRfaDecision?.offerId).toBe("sheet");
    state = executeFreeAgencyCommand(state, { commandId: "decline-match", type: "RESOLVE_USER_RFA", payload: { decision: "DECLINE" } });
    expect(state.players[player.id].teamId).toBe(bidder.id);
    expect(state.league.currentPhase).toBe("PRESEASON");
    expect(state.freeAgency!.closeAfterPendingRfa).toBeUndefined();
  });

  it("pauses for two market days of RFA matching and preserves Bird years only if the original team matches", () => {
    const state = executeFreeAgencyCommand(postDraftState("fa-rfa-bird-continuity"), { commandId: "open", type: "ENTER_FREE_AGENCY", payload: {} });
    const player = getFreeAgents(state).find((entry) => entry.contract.status === "RFA");
    const bidder = Object.values(state.teams).find((team) => team.id !== state.userTeamId && team.playerIds.length < LEAGUE_FINANCE_CONFIG.rosterLimits.offseasonMaximum);
    if (!player || !bidder) throw new Error("RFA or bidder missing from test market");
    state.freeAgency!.currentDay = 7;
    state.freeAgency!.markets[player.id] = {
      playerId: player.id, originalTeamId: state.userTeamId, marketWindowStartDay: 7,
      decisionDeadline: 7, marketWindowStatus: "OPEN",
    };
    player.birdTeamId = state.userTeamId;
    player.birdYears = 4;
    state.capState.capHolds = state.capState.capHolds.filter((hold) => hold.playerId !== player.id);
    state.capState.capHolds.push({ playerId: player.id, teamId: state.userTeamId, amount: 10_000_000, type: "RFA" });
    const salary = LEAGUE_FINANCE_CONFIG.minimumSalary;
    state.freeAgency!.offers.sheet = {
      offerId: "sheet", playerId: player.id, teamId: bidder.id, createdDay: 7, expiresDay: 7,
      years: 2, year1Salary: salary, totalValue: salary * 2, guaranteedValue: salary * 2,
      rolePromised: "BENCH", capReservation: salary, utility: 100, status: "ACTIVE", kind: "RFA_OFFER_PROPOSAL",
    };
    state.capState.offerReservations.push({ offerId: "sheet", playerId: player.id, teamId: bidder.id, amount: salary });

    const pending = executeFreeAgencyCommand(state, { commandId: "settle-seven", type: "ADVANCE_FA_DAY", payload: {} });
    expect(pending.freeAgency!.currentDay).toBe(8);
    expect(pending.freeAgency!.pendingUserRfaDecision).toMatchObject({ playerId: player.id, offerId: "sheet", deadline: 9 });
    expect(pending.freeAgency!.markets[player.id].matchingDeadline).toBe(9);
    expect(() => executeFreeAgencyCommand(pending, { commandId: "skip-decision", type: "ADVANCE_FA_DAY", payload: {} })).toThrow(/pending RFA/);

    const restored = JSON.parse(JSON.stringify(pending)) as GameState;
    const matched = executeFreeAgencyCommand(restored, { commandId: "match-sheet", type: "RESOLVE_USER_RFA", payload: { decision: "MATCH" } });
    expect(matched.players[player.id]).toMatchObject({ teamId: state.userTeamId, birdTeamId: state.userTeamId, birdYears: 4 });
    const declined = executeFreeAgencyCommand(pending, { commandId: "decline-sheet", type: "RESOLVE_USER_RFA", payload: { decision: "DECLINE" } });
    expect(declined.players[player.id]).toMatchObject({ teamId: bidder.id, birdTeamId: bidder.id, birdYears: 1 });

    const legacy = structuredClone(pending);
    legacy.freeAgency!.pendingUserRfaDecision!.deadline = legacy.freeAgency!.currentDay;
    legacy.freeAgency!.markets[player.id].matchingDeadline = legacy.freeAgency!.currentDay;
    expect(executeFreeAgencyCommand(legacy, { commandId: "legacy-match", type: "RESOLVE_USER_RFA", payload: { decision: "MATCH" } }).players[player.id].birdYears).toBe(4);
    legacy.freeAgency!.pendingUserRfaDecision!.deadline -= 1;
    legacy.freeAgency!.markets[player.id].matchingDeadline = legacy.freeAgency!.currentDay - 1;
    expect(() => executeFreeAgencyCommand(legacy, { commandId: "invalid-match", type: "RESOLVE_USER_RFA", payload: { decision: "MATCH" } })).toThrow("RFA_MATCHING_STATE_INVALID");
  });

  it("keeps every same-day user RFA sheet pending until each is decided", () => {
    const state = executeFreeAgencyCommand(postDraftState("fa-two-rfa-sheets"), { commandId: "open", type: "ENTER_FREE_AGENCY", payload: {} });
    const players = getFreeAgents(state).filter((entry) => entry.contract.status === "RFA").slice(0, 2);
    const bidders = Object.values(state.teams).filter((team) => team.id !== state.userTeamId && team.playerIds.length < LEAGUE_FINANCE_CONFIG.rosterLimits.regularSeasonMaximum).slice(0, 2);
    if (players.length !== 2 || bidders.length !== 2) throw new Error("Two RFAs and bidders required");
    const salary = LEAGUE_FINANCE_CONFIG.minimumSalary;
    state.freeAgency!.currentDay = 120;
    players.forEach((player, index) => {
      player.birdTeamId = state.userTeamId;
      player.birdYears = 4;
      state.freeAgency!.markets[player.id] = {
        playerId: player.id, originalTeamId: state.userTeamId, marketWindowStartDay: 120,
        decisionDeadline: 120, marketWindowStatus: "OPEN",
      };
      const offerId = `sheet-${index}`;
      state.freeAgency!.offers[offerId] = {
        offerId, playerId: player.id, teamId: bidders[index].id, createdDay: 120, expiresDay: 120,
        years: 1, year1Salary: salary, totalValue: salary, guaranteedValue: salary,
        rolePromised: "BENCH", capReservation: salary, utility: 100, status: "ACTIVE", kind: "RFA_OFFER_PROPOSAL",
      };
      state.capState.offerReservations.push({ offerId, playerId: player.id, teamId: bidders[index].id, amount: salary });
    });
    const settled = executeFreeAgencyCommand(state, { commandId: "settle-last-day", type: "ADVANCE_FA_DAY", payload: {} });
    expect(settled.freeAgency!.currentDay).toBe(121);
    expect(settled.freeAgency!.pendingUserRfaDecision).toBeDefined();
    expect(players.map((player) => settled.freeAgency!.markets[player.id].marketWindowStatus)).toEqual(["RFA_MATCHING", "RFA_MATCHING"]);
    expect(() => executeFreeAgencyCommand(settled, { commandId: "skip-both", type: "ADVANCE_FA_DAY", payload: {} })).toThrow(/pending RFA/);

    const first = executeFreeAgencyCommand(settled, { commandId: "decide-first", type: "RESOLVE_USER_RFA", payload: { decision: "MATCH" } });
    expect(first.league.currentPhase).toBe("OFFSEASON_POST_DRAFT");
    expect(first.freeAgency!.pendingUserRfaDecision).toBeDefined();
    expect(first.freeAgency!.pendingUserRfaDecision?.offerId).not.toBe(settled.freeAgency!.pendingUserRfaDecision?.offerId);
    expect(() => executeFreeAgencyCommand(first, { commandId: "skip-second", type: "ADVANCE_FA_DAY", payload: {} })).toThrow(/pending RFA/);
    const second = executeFreeAgencyCommand(first, { commandId: "decide-second", type: "RESOLVE_USER_RFA", payload: { decision: "DECLINE" } });
    expect(second.freeAgency!.pendingUserRfaDecision).toBeUndefined();
    expect(second.league.currentPhase).toBe("PRESEASON");
    expect(players.map((player) => second.players[player.id].birdYears).sort()).toEqual([1, 4]);
  });

  it("lets the rights team sign an elite RFA before opening night without cutting rotation veterans", () => {
    let state = executeFreeAgencyCommand(postDraftState("expansion-era-demo", true), {
      commandId: "opening-fa", type: "ENTER_FREE_AGENCY", payload: {},
    });
    const durenId = "nba:1631105";
    state.players[durenId].birdTeamId = "DET";
    state.players[durenId].birdYears = 4;
    const durenBirdYears = state.players[durenId].birdYears;
    expect(state.freeAgency?.markets[durenId].originalTeamId).toBe("DET");
    expect(state.capState.capHolds).toContainEqual(expect.objectContaining({ playerId: durenId, teamId: "DET", type: "RFA" }));
    expect(state.teams.DET.playerIds).toHaveLength(14);
    for (let day = 1; day <= 3; day += 1) {
      state = executeFreeAgencyCommand(state, { commandId: `opening-fa-${day}`, type: "ADVANCE_FA_DAY", payload: {} });
    }
    expect(state.players[durenId]).toMatchObject({ teamId: "DET", contract: { status: "STANDARD" } });
    expect(state.players[durenId].birdYears).toBe(durenBirdYears);
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

  it("releases a withdrawn offer and accepts a revised offer on the same day after save reload", () => {
    let state = executeFreeAgencyCommand(postDraftState("fa-withdraw-rebid"), { commandId: "open", type: "ENTER_FREE_AGENCY", payload: {} });
    const player = getFreeAgents(state).find((entry) => entry.contract.status === "UFA");
    if (!player) throw new Error("UFA missing from test market");
    const first = { commandId: "first-offer", type: "SUBMIT_FA_OFFER", payload: { playerId: player.id, years: 3, year1Salary: 8_000_000, guaranteedPercent: 0.8, rolePromised: "ROTATION" } } as const;
    state = executeFreeAgencyCommand(state, first);
    const original = Object.values(state.freeAgency?.offers ?? {}).find((entry) => entry.playerId === player.id && entry.teamId === state.userTeamId);
    if (!original) throw new Error("Original offer missing");
    const beforeWithdrawal = state;
    state = executeFreeAgencyCommand(state, { commandId: "withdraw-first", type: "WITHDRAW_FA_OFFER", payload: { offerId: original.offerId } });
    expect(beforeWithdrawal.freeAgency?.offers[original.offerId].status).toBe("ACTIVE");
    expect(state.freeAgency?.offers[original.offerId].status).toBe("WITHDRAWN");
    expect(state.freeAgency?.markets[player.id].marketWindowStatus).toBe("CLOSED_NO_SIGNING");
    expect(state.capState.offerReservations.some((entry) => entry.offerId === original.offerId)).toBe(false);
    expect(getFreeAgentOfferPreview(state, player.id).valid).toBe(true);

    const restored = JSON.parse(JSON.stringify(state)) as GameState;
    const failedInput = structuredClone(restored);
    expect(() => executeFreeAgencyCommand(restored, { commandId: "invalid-rebid", type: "SUBMIT_FA_OFFER", payload: { ...first.payload, year1Salary: 0 } })).toThrow();
    expect(restored).toEqual(failedInput);
    const revised = { commandId: "revised-offer", type: "SUBMIT_FA_OFFER", payload: { ...first.payload, years: 2, year1Salary: 7_000_000 } } as const;
    const rebid = executeFreeAgencyCommand(restored, revised);
    const active = Object.values(rebid.freeAgency?.offers ?? {}).filter((entry) => entry.playerId === player.id && entry.teamId === state.userTeamId && entry.status === "ACTIVE");
    expect(active).toHaveLength(1);
    expect(active[0].offerId).not.toBe(original.offerId);
    expect(rebid.capState.offerReservations.filter((entry) => entry.playerId === player.id && entry.teamId === state.userTeamId)).toEqual([expect.objectContaining({ offerId: active[0].offerId })]);
    expect(rebid.freeAgency?.markets[player.id]).toMatchObject({ marketWindowStartDay: rebid.freeAgency?.currentDay, marketWindowStatus: "OPEN" });
    expect(executeFreeAgencyCommand(rebid, revised)).toBe(rebid);
    expect(() => executeFreeAgencyCommand(rebid, { commandId: "withdraw-first-again", type: "WITHDRAW_FA_OFFER", payload: { offerId: original.offerId } })).toThrow(/cannot be withdrawn/);
  });

  it("keeps another team's active offer open after withdrawal and resets a fully closed window", () => {
    let state = executeFreeAgencyCommand(postDraftState("fa-withdraw-window"), { commandId: "open", type: "ENTER_FREE_AGENCY", payload: {} });
    const player = getFreeAgents(state).find((entry) => entry.contract.status === "UFA");
    if (!player) throw new Error("UFA missing from test market");
    const draft = { playerId: player.id, years: 3, year1Salary: 8_000_000, guaranteedPercent: 0.8, rolePromised: "ROTATION" } as const;
    state = executeFreeAgencyCommand(state, { commandId: "first-offer", type: "SUBMIT_FA_OFFER", payload: draft });
    const original = Object.values(state.freeAgency?.offers ?? {}).find((entry) => entry.playerId === player.id && entry.teamId === state.userTeamId);
    if (!original || !state.freeAgency) throw new Error("Original offer missing");
    const otherTeamId = Object.keys(state.teams).find((teamId) => teamId !== state.userTeamId);
    if (!otherTeamId) throw new Error("Opponent team missing");
    state.freeAgency.currentDay = 2;
    const onlyUserOffer = structuredClone(state);
    state.freeAgency.offers.otherTeamOffer = { ...original, offerId: "otherTeamOffer", teamId: otherTeamId };
    state = executeFreeAgencyCommand(state, { commandId: "withdraw-with-opponent", type: "WITHDRAW_FA_OFFER", payload: { offerId: original.offerId } });
    expect(state.freeAgency?.markets[player.id]).toMatchObject({ marketWindowStatus: "OPEN", decisionDeadline: 3 });

    const closed = executeFreeAgencyCommand(onlyUserOffer, { commandId: "withdraw-last-offer", type: "WITHDRAW_FA_OFFER", payload: { offerId: original.offerId } });
    expect(closed.freeAgency?.markets[player.id].marketWindowStatus).toBe("CLOSED_NO_SIGNING");
    const reopened = executeFreeAgencyCommand(closed, { commandId: "same-day-rebid", type: "SUBMIT_FA_OFFER", payload: draft });
    expect(reopened.freeAgency?.markets[player.id]).toMatchObject({ marketWindowStatus: "OPEN", marketWindowStartDay: 2, decisionDeadline: 4 });
    expect(reopened.freeAgency?.offers[original.offerId].status).toBe("WITHDRAWN");
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
    expect(Object.values(signedElsewhere.freeAgency!.offers).filter((offer) => offer.playerId === player.id && offer.status === "ACCEPTED")).toHaveLength(1);
    expect(signedElsewhere.capState.offerReservations.some((reservation) => reservation.playerId === player.id)).toBe(false);
    expect(Object.values(signedElsewhere.teams).filter((team) => team.playerIds.includes(player.id))).toHaveLength(1);
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
    expect(getProjectedMarketSalary(younger, 2027)).toBeGreaterThan(getProjectedMarketSalary(younger, 2026));
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
