import { describe, expect, it } from "vitest";
import { EXPANSION_BRAND_PRESETS } from "../../data/expansionBrands";
import { getSeasonFinanceConfig } from "../../config/leagueFinance";
import { REAL_2026_DRAFT } from "../../data/real2026Draft";
import { NBA_PLAYER_DATASET } from "../../data/nbaPlayerDataset";
import { RETIRED_LEGEND_TEMPLATES } from "../../data/retiredLegendTemplates";
import { BUNDLED_RETIRED_PORTRAIT_IDS } from "../../data/retiredLegendPortraitIds";
import { playerOverall } from "../development/PlayerDevelopmentService";
import { executeExpansionCommand, getSelectableExpansionPlayers } from "../expansion/ExpansionService";
import { stableHash, stableSerialize } from "../random/hash";
import { createCareer, createExpansionCareer } from "../season/career";
import { createExpansionCareerFromBundledDataset } from "../../data/hupuRoster";
import { enterFreeAgency, getFreeAgents } from "../freeAgency/FreeAgencyService";
import type { GameState } from "../state/types";
import { executeDraftCommand, getAvailableDraftProspects, getDraftLotteryPreview, getNextAiDraftProspect, replaceIneligibleUnpickedHistoricalProspects, type DraftCommand } from "./DraftService";

function finishExpansionState(initial: GameState): GameState {
  const preset = EXPANSION_BRAND_PRESETS.SEA[0];
  let state = executeExpansionCommand(initial, {
    commandId: "create", type: "CREATE_EXPANSION_TEAM",
    payload: { cityId: "SEA", presetId: preset.presetId, teamName: preset.teamName, primaryColor: preset.primaryColor, secondaryColor: preset.secondaryColor },
  });
  if (!state.expansion?.rightsDraw.resolved) state = executeExpansionCommand(state, { commandId: "package", type: "CHOOSE_RIGHTS_PACKAGE", payload: { packageId: "A" } });
  state = executeExpansionCommand(state, { commandId: "options", type: "RESOLVE_OPTION_PHASE", payload: {} });
  state = executeExpansionCommand(state, { commandId: "trade", type: "PREPARE_EXPANSION_TRADE", payload: {} });
  state = executeExpansionCommand(state, { commandId: "start", type: "START_EXPANSION_DRAFT", payload: {} });
  while (state.league.currentPhase === "EXPANSION_DRAFT") {
    const expectedPickNumber = (state.expansion?.currentPickIndex ?? 0) + 1;
    const player = getSelectableExpansionPlayers(state)[0];
    state = executeExpansionCommand(state, { commandId: `exp-${expectedPickNumber}`, type: "SELECT_EXPANSION_PLAYER", payload: { playerId: player.id, expectedPickNumber } });
  }
  return executeExpansionCommand(state, { commandId: "confirm-expansion-summary", type: "CONFIRM_EXPANSION_SUMMARY", payload: {} });
}

function finishExpansion(seed: string): GameState {
  return finishExpansionState(createExpansionCareer(seed));
}

function advanceAiPicksUntilUserTurn(input: GameState, commandPrefix: string): GameState {
  let state = input;
  while (state.league.currentPhase === "DRAFT") {
    const pick = state.rookieDraft?.pickOrder[state.rookieDraft.currentPickIndex];
    if (!pick || pick.ownerTeamId === state.userTeamId) break;
    state = executeDraftCommand(state, {
      commandId: `${commandPrefix}-ai-${pick.pickNumber}`,
      type: "ADVANCE_ROOKIE_DRAFT_AI_PICK",
      payload: { expectedPickNumber: pick.pickNumber },
    });
  }
  return state;
}

function finishRookieDraft(seed: string): GameState {
  let state = executeDraftCommand(finishExpansion(seed), { commandId: "prepare-rookies", type: "PREPARE_ROOKIE_DRAFT", payload: {} });
  while (state.league.currentPhase === "DRAFT") {
    const pick = state.rookieDraft?.pickOrder[state.rookieDraft.currentPickIndex];
    if (!pick) throw new Error("rookie pick missing");
    state = pick.ownerTeamId === state.userTeamId
      ? executeDraftCommand(state, {
        commandId: `rookie-${pick.pickNumber}`,
        type: "DRAFT_PLAYER",
        payload: { playerId: getAvailableDraftProspects(state)[0].id, expectedPickNumber: pick.pickNumber },
      })
      : executeDraftCommand(state, {
        commandId: `rookie-ai-${pick.pickNumber}`,
        type: "ADVANCE_ROOKIE_DRAFT_AI_PICK",
        payload: { expectedPickNumber: pick.pickNumber },
      });
  }
  return state;
}

describe("Stage 4 rookie draft", () => {
  it("uses the draft season's salary scale for a future first-round pick", () => {
    const state = createCareer("future-rookie-salary-scale");
    state.league.currentPhase = "OFFSEASON_PRE_DRAFT";
    state.league.seasonYear = 2027;
    state.league.seasonId = "2027-28";
    state.seeds.seasonSeed = stableHash(state.seeds.careerSeed, "season", state.league.seasonId);
    const prepared = executeDraftCommand(state, { commandId: "future-salary-prepare", type: "PREPARE_ROOKIE_DRAFT", payload: {} });
    const acknowledged = executeDraftCommand(prepared, { commandId: "future-salary-ack", type: "ACKNOWLEDGE_DRAFT_LOTTERY", payload: {} });
    const pick = acknowledged.rookieDraft!.pickOrder[0];
    const drafted = pick.ownerTeamId === acknowledged.userTeamId
      ? executeDraftCommand(acknowledged, { commandId: "future-salary-user", type: "DRAFT_PLAYER", payload: { playerId: getAvailableDraftProspects(acknowledged)[0].id, expectedPickNumber: pick.pickNumber } })
      : executeDraftCommand(acknowledged, { commandId: "future-salary-ai", type: "ADVANCE_ROOKIE_DRAFT_AI_PICK", payload: { expectedPickNumber: pick.pickNumber } });
    const salary = Math.round(getSeasonFinanceConfig(2027).rookieScale[1] * 1.2 / 10_000) * 10_000;
    expect(drafted.players[drafted.rookieDraft!.pickOrder[0].playerId!].contract.salary).toBe(salary);
  });

  it("keeps future rookies' entry ratings below established stars across fixed seeds", () => {
    const topEightRatings: number[] = [];
    const historicalRookieRatings: number[] = [];
    let immediateNinetyPlus = 0;
    for (let seedIndex = 0; seedIndex < 20; seedIndex += 1) {
      const future = createCareer(`rookie-balance-${seedIndex}`);
      future.league.currentPhase = "OFFSEASON_PRE_DRAFT";
      future.league.seasonYear = 2027;
      future.league.seasonId = "2027-28";
      future.seeds.seasonSeed = stableHash(future.seeds.careerSeed, "season", future.league.seasonId);
      const prepared = executeDraftCommand(future, {
        commandId: `prepare-rookie-balance-${seedIndex}`,
        type: "PREPARE_ROOKIE_DRAFT",
        payload: {},
      });
      const prospects = prepared.rookieDraft?.classPlayerIds.map((id) => prepared.players[id]) ?? [];
      expect(prospects).toHaveLength(80);
      topEightRatings.push(...prospects.slice(0, 8).map(playerOverall));
      const historicalRookies = prospects.filter((player) => player.profileSource === "HISTORICAL_ARCHETYPE");
      expect(historicalRookies).toHaveLength(3);
      expect(historicalRookies.every((player) => (player.truePotential ?? 0) >= 90)).toBe(true);
      historicalRookieRatings.push(...historicalRookies.map(playerOverall));
      immediateNinetyPlus += prospects.filter((player) => playerOverall(player) >= 90).length;
    }
    const averageTopEight = topEightRatings.reduce((sum, rating) => sum + rating, 0) / topEightRatings.length;
    expect(averageTopEight).toBeGreaterThan(77);
    expect(averageTopEight).toBeLessThan(82);
    expect(immediateNinetyPlus).toBe(0);
    const historicalAverage = historicalRookieRatings.reduce((sum, rating) => sum + rating, 0) / historicalRookieRatings.length;
    expect(historicalAverage).toBeGreaterThan(72);
    expect(historicalAverage).toBeLessThan(78);
    expect(Math.max(...historicalRookieRatings)).toBeLessThan(81);
  });

  it("previews the future lottery from the same standings and seed used to prepare the draft", () => {
    const state = finishExpansion("lottery-preview");
    state.league.currentPhase = "OFFSEASON_PRE_DRAFT";
    state.league.seasonYear = 2027;
    state.league.seasonId = "2027-28";
    state.seeds.seasonSeed = stableHash(state.seeds.careerSeed, "season", state.league.seasonId);
    const before = stableHash(stableSerialize(state));
    const preview = getDraftLotteryPreview(state);
    expect(preview).toEqual(getDraftLotteryPreview(state));
    expect(preview).toHaveLength(18);
    expect(preview.filter((entry) => entry.lotteryBalls === 3)).toHaveLength(9);
    expect(preview.filter((entry) => entry.lotteryBalls === 2)).toHaveLength(7);
    expect(preview.filter((entry) => entry.lotteryBalls === 1)).toHaveLength(2);
    expect(preview.reduce((sum, entry) => sum + entry.lotteryBalls, 0)).toBe(43);
    expect(preview.find((entry) => entry.lotteryBalls === 3)?.firstPickWeight).toBeCloseTo(300 / 43);
    expect(preview.find((entry) => entry.lotteryBalls === 2)?.firstPickWeight).toBeCloseTo(200 / 43);
    expect(preview.find((entry) => entry.lotteryBalls === 1)?.firstPickWeight).toBeCloseTo(100 / 43);
    expect(preview.reduce((sum, entry) => sum + entry.firstPickWeight, 0)).toBeCloseTo(100);
    expect(stableHash(stableSerialize(state))).toBe(before);
    const prepared = executeDraftCommand(state, { commandId: "lottery-preview-prepare", type: "PREPARE_ROOKIE_DRAFT", payload: {} });
    expect(prepared.rookieDraft?.lotteryPresented).toBe(false);
    expect(prepared.rookieDraft?.lotteryRevealComplete).toBe(false);
    const firstRound = prepared.rookieDraft?.pickOrder.filter((pick) => pick.round === 1) ?? [];
    expect(firstRound).toHaveLength(32);
    expect(new Set(firstRound.slice(0, preview.length).map((pick) => pick.originalTeamId))).toEqual(new Set(preview.map((entry) => entry.teamId)));
    for (const entry of preview.filter((team) => team.draftRelegated)) {
      expect(firstRound.find((pick) => pick.originalTeamId === entry.teamId)?.pickNumber).toBeLessThanOrEqual(12);
    }
    const revealed = executeDraftCommand(prepared, { commandId: "lottery-preview-reveal", type: "COMPLETE_DRAFT_LOTTERY_REVEAL", payload: {} });
    expect(revealed.rookieDraft?.lotteryRevealComplete).toBe(true);
    expect(revealed.rookieDraft?.lotteryPresented).toBe(false);
    expect(revealed.rookieDraft?.pickOrder).toEqual(prepared.rookieDraft?.pickOrder);
    const saved = structuredClone(revealed);
    const acknowledged = executeDraftCommand(saved, { commandId: "lottery-preview-ack", type: "ACKNOWLEDGE_DRAFT_LOTTERY", payload: {} });
    expect(acknowledged.rookieDraft?.lotteryPresented).toBe(true);
    expect(acknowledged.rookieDraft?.lotteryRevealComplete).toBe(true);
    expect(acknowledged.rookieDraft?.pickOrder).toEqual(prepared.rookieDraft?.pickOrder);
    expect(saved.rookieDraft?.lotteryPresented).toBe(false);
    expect(executeDraftCommand(acknowledged, { commandId: "lottery-preview-ack", type: "ACKNOWLEDGE_DRAFT_LOTTERY", payload: {} })).toBe(acknowledged);
    expect(() => executeDraftCommand(acknowledged, { commandId: "lottery-preview-ack-again", type: "ACKNOWLEDGE_DRAFT_LOTTERY", payload: {} })).toThrow("乐透抽签已公布");
  });

  it("requires lottery acknowledgement before player, AI, or fast-forward picks from restored saves", () => {
    const future = createCareer("draft-lottery-hard-gate");
    future.league.currentPhase = "OFFSEASON_PRE_DRAFT";
    future.league.seasonYear = 2027;
    future.league.seasonId = "2027-28";
    const prepared = executeDraftCommand(future, { commandId: "gate-prepare", type: "PREPARE_ROOKIE_DRAFT", payload: {} });
    const firstPick = prepared.rookieDraft!.pickOrder[0];
    const commands: DraftCommand[] = [
      { commandId: "gate-player", type: "DRAFT_PLAYER", payload: { playerId: getAvailableDraftProspects(prepared)[0].id, expectedPickNumber: firstPick.pickNumber } },
      { commandId: "gate-ai", type: "ADVANCE_ROOKIE_DRAFT_AI_PICK", payload: { expectedPickNumber: firstPick.pickNumber } },
      { commandId: "gate-fast", type: "FAST_FORWARD_ROOKIE_DRAFT", payload: { expectedPickNumber: firstPick.pickNumber } },
    ];
    for (const command of commands) {
      const restored = structuredClone(prepared);
      const before = stableHash(stableSerialize(restored));
      expect(() => executeDraftCommand(restored, command)).toThrow("请先确认乐透抽签结果");
      expect(stableHash(stableSerialize(restored))).toBe(before);
      expect(restored.commandReceipts[command.commandId]).toBeUndefined();
    }

    const legacy = structuredClone(prepared);
    delete legacy.rookieDraft!.lotteryPresented;
    expect(() => executeDraftCommand(legacy, commands[1])).toThrow("请先确认乐透抽签结果");
    const acknowledged = executeDraftCommand(legacy, { commandId: "gate-ack", type: "ACKNOWLEDGE_DRAFT_LOTTERY", payload: {} });
    expect(acknowledged.rookieDraft?.lotteryPresented).toBe(true);
    const nextPick = acknowledged.rookieDraft!.pickOrder[0];
    const afterPick = nextPick.ownerTeamId === acknowledged.userTeamId
      ? executeDraftCommand(acknowledged, { commandId: "gate-after-ack-player", type: "DRAFT_PLAYER", payload: { playerId: getAvailableDraftProspects(acknowledged)[0].id, expectedPickNumber: nextPick.pickNumber } })
      : executeDraftCommand(acknowledged, { commandId: "gate-after-ack-ai", type: "ADVANCE_ROOKIE_DRAFT_AI_PICK", payload: { expectedPickNumber: nextPick.pickNumber } });
    expect(afterPick.rookieDraft?.currentPickIndex).toBe(1);
  });

  it("rerolls future lottery deterministically with distinct legal picks and preserves ownership", () => {
    const future = finishExpansion("lottery-reroll");
    future.league.currentPhase = "OFFSEASON_PRE_DRAFT";
    future.league.seasonYear = 2027;
    future.league.seasonId = "2027-28";
    future.seeds.seasonSeed = stableHash(future.seeds.careerSeed, "season", future.league.seasonId);
    const prepared = executeDraftCommand(future, { commandId: "reroll-prepare", type: "PREPARE_ROOKIE_DRAFT", payload: {} });
    const originalOrder = prepared.rookieDraft!.pickOrder;
    const preview = getDraftLotteryPreview(prepared);
    const revealed = executeDraftCommand(prepared, { commandId: "reroll-before-reveal", type: "COMPLETE_DRAFT_LOTTERY_REVEAL", payload: {} });
    const command: DraftCommand = { commandId: "reroll-1", type: "REROLL_DRAFT_LOTTERY", payload: {} };
    const first = executeDraftCommand(revealed, command);
    const firstRound = first.rookieDraft!.pickOrder.filter((pick) => pick.round === 1);
    expect(first.rookieDraft?.lotteryRerollCount).toBe(1);
    expect(first.rookieDraft?.lotteryRevealComplete).toBe(false);
    expect(first.rookieDraft?.draftSeed).toBe(prepared.rookieDraft?.draftSeed);
    expect(first.rookieDraft?.classPlayerIds).toEqual(prepared.rookieDraft?.classPlayerIds);
    expect(firstRound.slice(0, preview.length).map((pick) => pick.originalTeamId))
      .not.toEqual(originalOrder.slice(0, preview.length).map((pick) => pick.originalTeamId));
    expect(new Set(firstRound.map((pick) => pick.originalTeamId)).size).toBe(firstRound.length);
    expect(firstRound.every((pick) => pick.ownerTeamId === (first.draftPicks[`2027-R1-${pick.originalTeamId}`]?.ownerTeamId ?? pick.originalTeamId))).toBe(true);
    expect(first.rookieDraft?.pickOrder.slice(preview.length)).toEqual(originalOrder.slice(preview.length));
    expect(executeDraftCommand(first, command)).toBe(first);

    const restored = structuredClone(first);
    const secondCommand: DraftCommand = { commandId: "reroll-2", type: "REROLL_DRAFT_LOTTERY", payload: {} };
    const second = executeDraftCommand(restored, secondCommand);
    expect(second.rookieDraft?.lotteryRerollCount).toBe(2);
    expect(second.rookieDraft?.pickOrder.slice(0, preview.length).map((pick) => pick.originalTeamId))
      .not.toEqual(first.rookieDraft?.pickOrder.slice(0, preview.length).map((pick) => pick.originalTeamId));
    expect(executeDraftCommand(structuredClone(first), secondCommand)).toEqual(second);
    expect(prepared.rookieDraft?.lotteryRerollCount).toBeUndefined();

    const acknowledged = executeDraftCommand(second, { commandId: "reroll-ack", type: "ACKNOWLEDGE_DRAFT_LOTTERY", payload: {} });
    const before = stableHash(stableSerialize(acknowledged));
    expect(() => executeDraftCommand(acknowledged, { commandId: "reroll-after-ack", type: "REROLL_DRAFT_LOTTERY", payload: {} }))
      .toThrow("乐透已确认");
    expect(stableHash(stableSerialize(acknowledged))).toBe(before);
    expect(acknowledged.commandReceipts["reroll-after-ack"]).toBeUndefined();
  });
  it("blocks consecutive first picks based on the original team even when its pick was traded", () => {
    const state = finishExpansion("lottery-repeat-limit");
    state.league.currentPhase = "OFFSEASON_PRE_DRAFT";
    state.league.seasonYear = 2027;
    state.league.seasonId = "2027-28";
    const restrictedTeamId = getDraftLotteryPreview(state)[0].teamId;
    state.history.draftFirstRoundResults = [{ year: 2026, pickNumber: 1, originalTeamId: restrictedTeamId }];
    state.draftPicks[`2027-R1-${restrictedTeamId}`].ownerTeamId = state.userTeamId;
    expect(getDraftLotteryPreview(state).find((entry) => entry.teamId === restrictedTeamId)?.firstPickWeight).toBe(0);
    const prepared = executeDraftCommand(state, { commandId: "prepare-repeat-limit", type: "PREPARE_ROOKIE_DRAFT", payload: {} });
    expect(prepared.rookieDraft?.pickOrder[0].originalTeamId).not.toBe(restrictedTeamId);
  });
  it("keeps an original pick out of the top five after two straight top-five results", () => {
    const state = finishExpansion("lottery-top-five-limit");
    state.league.currentPhase = "OFFSEASON_PRE_DRAFT";
    state.league.seasonYear = 2028;
    state.league.seasonId = "2028-29";
    const restrictedTeamId = getDraftLotteryPreview(state)[0].teamId;
    state.history.draftFirstRoundResults = [
      { year: 2026, pickNumber: 2, originalTeamId: restrictedTeamId },
      { year: 2027, pickNumber: 4, originalTeamId: restrictedTeamId },
    ];
    const prepared = executeDraftCommand(state, { commandId: "prepare-top-five-limit", type: "PREPARE_ROOKIE_DRAFT", payload: {} });
    expect(prepared.rookieDraft?.pickOrder.find((pick) => pick.round === 1 && pick.originalTeamId === restrictedTeamId)?.pickNumber).toBeGreaterThan(5);
  });
  it("keeps generated undrafted prospects out of the bundled real-player free market", () => {
    let state = executeDraftCommand(finishExpansionState(createExpansionCareerFromBundledDataset("real-free-agent-market")), {
      commandId: "prepare-real-market", type: "PREPARE_ROOKIE_DRAFT", payload: {},
    });
    while (state.league.currentPhase === "DRAFT") {
      const pick = state.rookieDraft?.pickOrder[state.rookieDraft.currentPickIndex];
      if (!pick) throw new Error("missing rookie draft pick");
      state = pick.ownerTeamId === state.userTeamId
        ? executeDraftCommand(state, { commandId: `real-pick-${pick.pickNumber}`, type: "DRAFT_PLAYER", payload: { playerId: getAvailableDraftProspects(state)[0].id, expectedPickNumber: pick.pickNumber } })
        : executeDraftCommand(state, { commandId: `real-ai-${pick.pickNumber}`, type: "ADVANCE_ROOKIE_DRAFT_AI_PICK", payload: { expectedPickNumber: pick.pickNumber } });
    }
    state = enterFreeAgency(state);
    const market = getFreeAgents(state);
    expect(market.length).toBeGreaterThanOrEqual(20);
    const draftedIds = new Set(state.rookieDraft?.pickOrder.map((pick) => pick.playerId).filter(Boolean));
    expect(market.filter((player) => player.profileSource === "PROCEDURAL_DRAFT")
      .every((player) => draftedIds.has(player.id))).toBe(true);
    expect(market.some((player) => player.id === "nba:1628467")).toBe(true);
    expect(Object.values(state.players).some((player) => player.profileSource === "PROCEDURAL_DRAFT" && player.teamId === "UNDRAFTED")).toBe(true);
  });
  it("persists rewarded prospect reveals through an idempotent draft command", () => {
    const prepared = executeDraftCommand(finishExpansion("draft-prospect-reveal"), { commandId: "prepare-reveal", type: "PREPARE_ROOKIE_DRAFT", payload: {} });
    const playerId = prepared.rookieDraft?.classPlayerIds[0];
    if (!playerId) throw new Error("draft prospect missing");
    const command = { commandId: "reveal-prospect", type: "REVEAL_DRAFT_PROSPECT" as const, payload: { playerId } };
    const revealed = executeDraftCommand(prepared, command);

    expect(prepared.rookieDraft?.revealedProspectIds).toEqual([]);
    expect(revealed.rookieDraft?.revealedProspectIds).toEqual([playerId]);
    expect(executeDraftCommand(revealed, command)).toBe(revealed);
    expect(() => executeDraftCommand(prepared, { commandId: "reveal-invalid", type: "REVEAL_DRAFT_PROSPECT", payload: { playerId: "UNKNOWN" } })).toThrow("current draft class");
  });

  it("fast-forwards atomically to each player pick and then directly completes the draft", () => {
    let state = executeDraftCommand(finishExpansion("draft-fast-forward"), { commandId: "prepare-fast-forward", type: "PREPARE_ROOKIE_DRAFT", payload: {} });
    const firstAiPick = state.rookieDraft?.pickOrder[state.rookieDraft.currentPickIndex];
    if (!firstAiPick) throw new Error("first AI pick missing");
    const firstFastForward = {
      commandId: "fast-forward-first-user-pick",
      type: "FAST_FORWARD_ROOKIE_DRAFT" as const,
      payload: { expectedPickNumber: firstAiPick.pickNumber },
    };
    state = executeDraftCommand(state, firstFastForward);
    const firstUserPick = state.rookieDraft?.pickOrder[state.rookieDraft.currentPickIndex];
    expect(firstUserPick?.ownerTeamId).toBe(state.userTeamId);
    expect(state.rookieDraft?.currentPickIndex).toBeGreaterThan(1);
    expect(executeDraftCommand(state, firstFastForward)).toEqual(state);

    state = executeDraftCommand(state, {
      commandId: "draft-first-user-pick",
      type: "DRAFT_PLAYER",
      payload: { playerId: getAvailableDraftProspects(state)[0].id, expectedPickNumber: firstUserPick?.pickNumber as number },
    });
    const nextAiPick = state.rookieDraft?.pickOrder[state.rookieDraft.currentPickIndex];
    if (!nextAiPick) throw new Error("next AI pick missing");
    state = executeDraftCommand(state, {
      commandId: "fast-forward-second-user-pick",
      type: "FAST_FORWARD_ROOKIE_DRAFT",
      payload: { expectedPickNumber: nextAiPick.pickNumber },
    });
    const secondUserPick = state.rookieDraft?.pickOrder[state.rookieDraft.currentPickIndex];
    expect(secondUserPick?.ownerTeamId).toBe(state.userTeamId);

    state = executeDraftCommand(state, {
      commandId: "draft-second-user-pick",
      type: "DRAFT_PLAYER",
      payload: { playerId: getAvailableDraftProspects(state)[0].id, expectedPickNumber: secondUserPick?.pickNumber as number },
    });
    const finalAiPick = state.rookieDraft?.pickOrder[state.rookieDraft.currentPickIndex];
    if (!finalAiPick) throw new Error("final AI pick missing");
    state = executeDraftCommand(state, {
      commandId: "fast-forward-finish-draft",
      type: "FAST_FORWARD_ROOKIE_DRAFT",
      payload: { expectedPickNumber: finalAiPick.pickNumber },
    });
    expect(state.league.currentPhase).toBe("OFFSEASON_POST_DRAFT");
    expect(state.rookieDraft?.completed).toBe(true);
    expect(state.rookieDraft?.pickOrder.filter((pick) => pick.playerId)).toHaveLength(64);
  });

  it("advances one AI pick per command and stops at the player turn", () => {
    const prepared = executeDraftCommand(finishExpansion("draft-live-sim"), { commandId: "prepare-live", type: "PREPARE_ROOKIE_DRAFT", payload: {} });
    const firstPick = prepared.rookieDraft?.pickOrder[0];
    const preview = getNextAiDraftProspect(prepared);
    if (!firstPick || !preview) throw new Error("first AI pick missing");
    const command = { commandId: "live-ai-1", type: "ADVANCE_ROOKIE_DRAFT_AI_PICK" as const, payload: { expectedPickNumber: firstPick.pickNumber } };
    const advanced = executeDraftCommand(prepared, command);
    expect(advanced.rookieDraft?.currentPickIndex).toBe(1);
    expect(advanced.rookieDraft?.pickOrder[0].playerId).toBe(preview.id);
    expect(executeDraftCommand(advanced, command)).toEqual(advanced);
    const playerTurn = advanceAiPicksUntilUserTurn(advanced, "live");
    const userPick = playerTurn.rookieDraft?.pickOrder[playerTurn.rookieDraft.currentPickIndex];
    expect(userPick?.ownerTeamId).toBe(playerTurn.userTeamId);
    expect(() => executeDraftCommand(playerTurn, {
      commandId: "live-ai-user-turn",
      type: "ADVANCE_ROOKIE_DRAFT_AI_PICK",
      payload: { expectedPickNumber: userPick?.pickNumber as number },
    })).toThrow("player team");
  });

  it("continues through the real 2026 second-round Memphis pick", () => {
    let state = executeDraftCommand(finishExpansion("draft-memphis-34"), { commandId: "prepare-memphis-34", type: "PREPARE_ROOKIE_DRAFT", payload: {} });
    while (state.league.currentPhase === "DRAFT" && (state.rookieDraft?.pickOrder[state.rookieDraft.currentPickIndex]?.pickNumber ?? 0) < 34) {
      const pick = state.rookieDraft?.pickOrder[state.rookieDraft.currentPickIndex];
      if (!pick) throw new Error("draft pick missing before Memphis pick");
      state = pick.ownerTeamId === state.userTeamId
        ? executeDraftCommand(state, { commandId: `memphis-fill-${pick.pickNumber}`, type: "DRAFT_PLAYER", payload: { playerId: getAvailableDraftProspects(state)[0].id, expectedPickNumber: pick.pickNumber } })
        : executeDraftCommand(state, { commandId: `memphis-ai-${pick.pickNumber}`, type: "ADVANCE_ROOKIE_DRAFT_AI_PICK", payload: { expectedPickNumber: pick.pickNumber } });
    }
    const memphisPick = state.rookieDraft?.pickOrder[state.rookieDraft.currentPickIndex];
    expect(memphisPick?.pickNumber).toBe(34);
    expect(memphisPick?.ownerTeamId).toBe("MEM");
    state = executeDraftCommand(state, { commandId: "memphis-ai-34", type: "ADVANCE_ROOKIE_DRAFT_AI_PICK", payload: { expectedPickNumber: 34 } });
    expect(state.rookieDraft?.currentPickIndex).toBeGreaterThan(33);
    expect(state.rookieDraft?.pickOrder[33].playerId).toBeTruthy();
  });

  it("fast-forwards from the Memphis second-round pick to the next user pick", () => {
    let state = executeDraftCommand(finishExpansion("draft-fast-forward-memphis-34"), { commandId: "prepare-fast-forward-memphis-34", type: "PREPARE_ROOKIE_DRAFT", payload: {} });
    while (state.league.currentPhase === "DRAFT" && (state.rookieDraft?.pickOrder[state.rookieDraft.currentPickIndex]?.pickNumber ?? 0) < 34) {
      const pick = state.rookieDraft?.pickOrder[state.rookieDraft.currentPickIndex];
      if (!pick) throw new Error("draft pick missing before Memphis pick");
      state = pick.ownerTeamId === state.userTeamId
        ? executeDraftCommand(state, { commandId: `fast-memphis-fill-${pick.pickNumber}`, type: "DRAFT_PLAYER", payload: { playerId: getAvailableDraftProspects(state)[0].id, expectedPickNumber: pick.pickNumber } })
        : executeDraftCommand(state, { commandId: `fast-memphis-ai-${pick.pickNumber}`, type: "ADVANCE_ROOKIE_DRAFT_AI_PICK", payload: { expectedPickNumber: pick.pickNumber } });
    }
    state = executeDraftCommand(state, { commandId: "fast-forward-memphis-34", type: "FAST_FORWARD_ROOKIE_DRAFT", payload: { expectedPickNumber: 34 } });
    const nextPick = state.rookieDraft?.pickOrder[state.rookieDraft.currentPickIndex];
    expect(state.rookieDraft?.currentPickIndex).toBeGreaterThan(33);
    expect(state.rookieDraft?.pickOrder[33].playerId).toBeTruthy();
    expect(nextPick?.ownerTeamId).toBe(state.userTeamId);
  });

  it("creates the 80-player curated 2026 class and inserts expansion picks at 5/6 and 37/38", () => {
    let state = executeDraftCommand(finishExpansion("draft-prepare"), { commandId: "prepare", type: "PREPARE_ROOKIE_DRAFT", payload: {} });
    expect(state.league.currentPhase).toBe("DRAFT");
    expect(state.rookieDraft?.classPlayerIds).toHaveLength(80);
    expect(state.rookieDraft?.pickOrder).toHaveLength(64);
    const draft = state.rookieDraft;
    expect(draft).toBeDefined();
    if (!draft) throw new Error("draft missing");
    expect(draft.source).toBe("CURATED_2026");
    expect(draft.lotteryPresented).toBe(true);
    expect(() => executeDraftCommand(state, { commandId: "no-2026-lottery", type: "ACKNOWLEDGE_DRAFT_LOTTERY", payload: {} })).toThrow("本届没有待确认的乐透抽签");
    expect(REAL_2026_DRAFT.every((entry) => draft.classPlayerIds.includes(entry.playerId))).toBe(true);
    for (const playerId of ["nba:1643516", "nba:1642889", "nba:1642923", "nba:1643551", "nba:1643576", "nba:1643590", "nba:1643555"]) {
      const projection = NBA_PLAYER_DATASET.players.find((player) => player.canonicalPlayerId === playerId);
      expect(state.players[playerId]?.attributes, playerId).toEqual(projection?.projection.attributes);
      expect(state.players[playerId]?.age, playerId).toBe(projection?.age);
    }
    expect(draft.pickOrder.slice(0, 4).map((pick) => pick.scriptedPlayerId)).toEqual(REAL_2026_DRAFT.slice(0, 4).map((entry) => entry.playerId));
    expect(new Set(draft.pickOrder.slice(4, 6).map((pick) => pick.ownerTeamId))).toEqual(new Set(["SEA", "LVG"]));
    expect(draft.pickOrder[6].scriptedPlayerId).toBe(REAL_2026_DRAFT[4].playerId);
    expect(draft.pickOrder[32].scriptedPlayerId).toBe(REAL_2026_DRAFT[30].playerId);
    expect(new Set(draft.pickOrder.slice(36, 38).map((pick) => pick.ownerTeamId))).toEqual(new Set(["SEA", "LVG"]));
    expect(draft.pickOrder[38].scriptedPlayerId).toBe(REAL_2026_DRAFT[34].playerId);
    expect(draft.currentPickIndex).toBe(0);
    expect(draft.pickOrder[draft.currentPickIndex].ownerTeamId).not.toBe("SEA");
    state = advanceAiPicksUntilUserTurn(state, "prepare");
    expect(state.rookieDraft?.pickOrder[state.rookieDraft.currentPickIndex].ownerTeamId).toBe("SEA");
    expect([5, 6]).toContain((state.rookieDraft?.currentPickIndex ?? -1) + 1);
    const publicProspect = getAvailableDraftProspects(state)[0];
    expect(state.players[publicProspect.id].truePotential).toBeTypeOf("number");
    expect(publicProspect.scoutedPotentialGrade).toBeTruthy();
    expect(JSON.stringify(publicProspect)).not.toMatch(/truePotential|developmentRate|developmentVolatility|historicalSourcePlayerId/u);
  });

  it("preserves every unaffected real pick and gives an intercepted pick an equivalent fictional rookie", () => {
    let state = executeDraftCommand(finishExpansion("draft-intercept"), { commandId: "prepare-intercept", type: "PREPARE_ROOKIE_DRAFT", payload: {} });
    state = advanceAiPicksUntilUserTurn(state, "intercept");
    const intercepted = REAL_2026_DRAFT.find((entry) => entry.realPickNumber === 30);
    if (!intercepted) throw new Error("missing real pick 30");
    const firstUserPick = state.rookieDraft?.pickOrder[state.rookieDraft.currentPickIndex];
    state = executeDraftCommand(state, {
      commandId: "intercept-real-rookie",
      type: "DRAFT_PLAYER",
      payload: { playerId: intercepted.playerId, expectedPickNumber: firstUserPick?.pickNumber as number },
    });
    while (state.league.currentPhase === "DRAFT") {
      const pick = state.rookieDraft?.pickOrder[state.rookieDraft.currentPickIndex];
      if (!pick) throw new Error("missing draft pick");
      if (pick.ownerTeamId !== state.userTeamId) {
        const beforePreview = pick.scriptedPlayerId === intercepted.playerId ? stableSerialize(state) : undefined;
        const preview = beforePreview ? getNextAiDraftProspect(state) : undefined;
        if (preview) expect(stableSerialize(state)).toBe(beforePreview);
        state = executeDraftCommand(state, {
          commandId: `finish-intercept-ai-${pick.pickNumber}`,
          type: "ADVANCE_ROOKIE_DRAFT_AI_PICK",
          payload: { expectedPickNumber: pick.pickNumber },
        });
        if (preview) expect(state.rookieDraft?.pickOrder[pick.pickNumber - 1].playerId).toBe(preview.id);
        continue;
      }
      const prospects = getAvailableDraftProspects(state);
      const filler = prospects.find((player) => player.id.startsWith("DRAFT-")) ?? prospects.at(-1);
      if (!filler) throw new Error("missing user prospect");
      state = executeDraftCommand(state, {
        commandId: `finish-intercept-${pick.pickNumber}`,
        type: "DRAFT_PLAYER",
        payload: { playerId: filler.id, expectedPickNumber: pick.pickNumber },
      });
    }

    const scriptedSlot = state.rookieDraft?.pickOrder.find((pick) => pick.scriptedPlayerId === intercepted.playerId);
    const rosterOccurrences = Object.values(state.teams).reduce((count, team) => count + team.playerIds.filter((id) => id === intercepted.playerId).length, 0);
    expect(state.players[intercepted.playerId].teamId).toBe(state.userTeamId);
    expect(rosterOccurrences).toBe(1);
    expect(scriptedSlot?.ownerTeamId).toBe(intercepted.finalTeamId);
    expect(scriptedSlot?.playerId).not.toBe(intercepted.playerId);
    const replacement = state.players[scriptedSlot?.playerId as string];
    const original = state.players[intercepted.playerId];
    expect(replacement.profileSource).toBe("PROCEDURAL_DRAFT");
    expect(replacement.name).not.toBe(original.name);
    expect(replacement.attributes).toEqual(original.attributes);
    expect(replacement.overallAdjustment).toBe(original.overallAdjustment);
    expect(replacement.truePotential).toBe(original.truePotential);
    expect(replacement.position).toBe(original.position);
    for (const pick of state.rookieDraft?.pickOrder.filter((entry) => entry.scriptedPlayerId) ?? []) {
      const drafted = state.players[pick.playerId as string];
      const scripted = state.players[pick.scriptedPlayerId as string];
      if (scripted.teamId === pick.ownerTeamId) {
        expect(pick.playerId).toBe(pick.scriptedPlayerId);
      } else {
        expect(["SEA", "LVG"]).toContain(scripted.teamId);
        expect(drafted.profileSource).toBe("PROCEDURAL_DRAFT");
        expect(drafted.attributes).toEqual(scripted.attributes);
        expect(drafted.truePotential).toBe(scripted.truePotential);
      }
    }
    expect(new Set(state.rookieDraft?.pickOrder.map((pick) => pick.playerId)).size).toBe(64);
  });

  it("uses the same equivalent replacement when fast-forwarding past the intercepted pick", () => {
    let state = executeDraftCommand(finishExpansion("draft-intercept-fast"), { commandId: "prepare-intercept-fast", type: "PREPARE_ROOKIE_DRAFT", payload: {} });
    state = advanceAiPicksUntilUserTurn(state, "intercept-fast");
    const intercepted = REAL_2026_DRAFT.find((entry) => entry.realPickNumber === 30);
    if (!intercepted) throw new Error("missing real pick 30");
    const userPick = state.rookieDraft?.pickOrder[state.rookieDraft.currentPickIndex];
    state = executeDraftCommand(state, { commandId: "fast-intercept-pick", type: "DRAFT_PLAYER", payload: { playerId: intercepted.playerId, expectedPickNumber: userPick?.pickNumber as number } });
    const nextPick = state.rookieDraft?.pickOrder[state.rookieDraft.currentPickIndex];
    state = executeDraftCommand(state, { commandId: "fast-intercept-sim", type: "FAST_FORWARD_ROOKIE_DRAFT", payload: { expectedPickNumber: nextPick?.pickNumber as number } });
    const replacedPick = state.rookieDraft?.pickOrder.find((pick) => pick.scriptedPlayerId === intercepted.playerId);
    const replacement = state.players[replacedPick?.playerId as string];
    expect(replacement.profileSource).toBe("PROCEDURAL_DRAFT");
    expect(replacement.attributes).toEqual(state.players[intercepted.playerId].attributes);
    expect(replacedPick?.ownerTeamId).toBe(intercepted.finalTeamId);
    expect(state.rookieDraft?.pickOrder.filter((pick) => pick.scriptedPlayerId && pick.pickNumber <= (replacedPick?.pickNumber ?? 0)
      && pick.playerId === pick.scriptedPlayerId).length).toBeGreaterThan(20);
  });

  it("completes 64 unique picks, leaves 16 UFA and signs fixed rookie contracts", () => {
    const state = finishRookieDraft("draft-complete");
    expect(state.league.currentPhase).toBe("OFFSEASON_POST_DRAFT");
    expect(state.rookieDraft?.pickOrder.filter((pick) => pick.playerId)).toHaveLength(64);
    expect(new Set(state.rookieDraft?.pickOrder.map((pick) => pick.playerId)).size).toBe(64);
    const undrafted = state.rookieDraft?.classPlayerIds.filter((id) => state.players[id].teamId === "FREE_AGENT") ?? [];
    expect(undrafted).toHaveLength(16);
    expect(undrafted.every((id) => state.players[id].contract.status === "UFA")).toBe(true);
    const firstPick = state.players[state.rookieDraft?.pickOrder[0].playerId as string];
    const secondRoundPick = state.players[state.rookieDraft?.pickOrder[32].playerId as string];
    expect(firstPick.contract.contractType).toBe("ROOKIE_FIRST");
    expect(firstPick.contract.optionByYear).toEqual(["NONE", "NONE", "TEAM_OPTION", "TEAM_OPTION"]);
    expect(secondRoundPick.contract.contractType).toBe("ROOKIE_SECOND");
    expect(secondRoundPick.contract.optionByYear).toEqual(["NONE", "TEAM_OPTION"]);
  });

  it("replays the complete draft from the same seed", () => {
    expect(stableHash(stableSerialize(finishRookieDraft("draft-replay"))))
      .toBe(stableHash(stableSerialize(finishRookieDraft("draft-replay"))));
  });

  it("mixes named historical stars into future classes without exposing hidden source IDs", () => {
    const future = finishExpansion("draft-historical");
    future.league.currentPhase = "OFFSEASON_PRE_DRAFT";
    future.league.seasonYear = 2027;
    future.league.seasonId = "2027-28";
    future.seeds.seasonSeed = stableHash(future.seeds.careerSeed, "season", future.league.seasonId);
    const state = executeDraftCommand(future, { commandId: "prepare-future", type: "PREPARE_ROOKIE_DRAFT", payload: {} });
    const reborn = state.rookieDraft?.classPlayerIds.map((id) => state.players[id]).filter((player) => player.profileSource === "HISTORICAL_ARCHETYPE") ?? [];

    expect(state.rookieDraft?.source).toBe("MIXED_FUTURE");
    expect(reborn).toHaveLength(3);
    expect(new Set(reborn.map((player) => player.historicalSourcePlayerId)).size).toBe(reborn.length);
    expect(reborn.every((player) => player.name === RETIRED_LEGEND_TEMPLATES.find((template) => template.sourcePlayerId === player.historicalSourcePlayerId)?.sourceName)).toBe(true);
    expect(state.history.rebornHistoricalSourceIds).toEqual(reborn.map((player) => player.historicalSourcePlayerId));
    expect(getAvailableDraftProspects(state).every((player) => !JSON.stringify(player).includes("historicalSourcePlayerId"))).toBe(true);
  });

  it("draws a different reproducible set of three historical sources for different career seeds", () => {
    const prepare = (seed: string): string[] => {
      const future = finishExpansion(seed);
      future.league.currentPhase = "OFFSEASON_PRE_DRAFT";
      future.league.seasonYear = 2027;
      future.league.seasonId = "2027-28";
      future.seeds.seasonSeed = stableHash(future.seeds.careerSeed, "season", future.league.seasonId);
      const state = executeDraftCommand(future, { commandId: "prepare-random-three", type: "PREPARE_ROOKIE_DRAFT", payload: {} });
      return (state.rookieDraft?.classPlayerIds ?? [])
        .map((id) => state.players[id].historicalSourcePlayerId)
        .filter((id): id is string => Boolean(id));
    };
    const first = prepare("historical-random-a");
    const replay = prepare("historical-random-a");
    const second = prepare("historical-random-b");
    expect(first).toHaveLength(3);
    expect(replay).toEqual(first);
    expect(second).toHaveLength(3);
    expect(second).not.toEqual(first);
  });

  it("repairs an undrafted active-player archetype in an older saved draft", () => {
    const future = finishExpansion("legacy-historical-rookie");
    future.league.currentPhase = "OFFSEASON_PRE_DRAFT";
    future.league.seasonYear = 2027;
    future.league.seasonId = "2027-28";
    future.seeds.seasonSeed = stableHash(future.seeds.careerSeed, "season", future.league.seasonId);
    const state = executeDraftCommand(future, { commandId: "prepare-legacy", type: "PREPARE_ROOKIE_DRAFT", payload: {} });
    const historicalId = state.rookieDraft?.classPlayerIds.find((id) => state.players[id].profileSource === "HISTORICAL_ARCHETYPE");
    expect(historicalId).toBeTruthy();
    const player = state.players[historicalId as string];
    const oldSourceId = player.historicalSourcePlayerId as string;
    player.name = "Kyrie Irving";
    player.historicalSourcePlayerId = "nba:202681";
    state.history.rebornHistoricalSourceIds[state.history.rebornHistoricalSourceIds.lastIndexOf(oldSourceId)] = "nba:202681";
    const classIds = [...(state.rookieDraft?.classPlayerIds ?? [])];

    replaceIneligibleUnpickedHistoricalProspects(state);

    expect(state.rookieDraft?.classPlayerIds).toEqual(classIds);
    expect(state.players[historicalId as string].name).not.toBe("Kyrie Irving");
    expect(state.players[historicalId as string].historicalSourcePlayerId).not.toBe("nba:202681");
    expect(state.history.rebornHistoricalSourceIds).not.toContain("nba:202681");
    const repaired = stableHash(stableSerialize(state));
    replaceIneligibleUnpickedHistoricalProspects(state);
    expect(stableHash(stableSerialize(state))).toBe(repaired);
  });

  it("uses all 90 retired legends exactly once across 30 future draft classes", () => {
    const future = finishExpansion("draft-generations");
    future.league.currentPhase = "OFFSEASON_PRE_DRAFT";
    const names = new Set<string>();
    const starNames = new Set(RETIRED_LEGEND_TEMPLATES.map((template) => template.sourceName));
    const portraitIds = new Set<string>(BUNDLED_RETIRED_PORTRAIT_IDS);
    const seenArchetypes = new Set<string>();
    for (let year = 2027; year < 2057; year += 1) {
      future.league.seasonYear = year;
      future.league.seasonId = `${year}-${String(year + 1).slice(-2)}`;
      future.seeds.seasonSeed = stableHash(future.seeds.careerSeed, "season", future.league.seasonId);
      const state = executeDraftCommand(future, { commandId: `prepare-${year}`, type: "PREPARE_ROOKIE_DRAFT", payload: {} });
      const draftPlayers = state.rookieDraft?.classPlayerIds.map((id) => state.players[id]) ?? [];
      const publicProspects = getAvailableDraftProspects(state);
      const archetypes = publicProspects.filter((player) => player.historicalArchetypeName);
      expect(draftPlayers).toHaveLength(80);
      expect(archetypes.length).toBeGreaterThanOrEqual(2);
      expect(archetypes.length).toBeLessThanOrEqual(3);
      expect(new Set(archetypes.map((player) => player.historicalArchetypeName)).size).toBe(archetypes.length);
      expect(archetypes.every((player) => starNames.has(player.historicalArchetypeName as string))).toBe(true);
      expect(archetypes.every((player) => player.historicalArchetypeName === player.name)).toBe(true);
      expect(archetypes.every((player) => state.players[player.id].truePotential! >= 90)).toBe(true);
      expect(archetypes.every((player) => playerOverall(state.players[player.id]) < 82)).toBe(true);
      expect(publicProspects.every((player) => !/truePotential|developmentRate|historicalSourcePlayerId/u.test(JSON.stringify(player)))).toBe(true);
      archetypes.forEach((player) => seenArchetypes.add(player.historicalArchetypeName as string));
      for (const player of draftPlayers) {
        if (player.profileSource === "HISTORICAL_ARCHETYPE") {
          const nbaId = player.historicalSourcePlayerId?.replace(/^nba:/u, "");
          expect(player.portraitPath).toBe(nbaId && portraitIds.has(nbaId)
            ? `./retired-portraits/nba-${nbaId}.webp`
            : null);
        }
        if (player.profileSource === "PROCEDURAL_DRAFT") {
          expect(names.has(player.name)).toBe(false);
          names.add(player.name);
        }
        expect(Number(player.birthDate.slice(0, 4))).toBe(year - player.age);
      }
      future.history.rebornHistoricalSourceIds = state.history.rebornHistoricalSourceIds;
    }
    expect(names.size).toBe(30 * (80 - 3));
    expect(seenArchetypes).toEqual(starNames);
  });

  it("keeps public ranking independent from hidden development fields", () => {
    const state = executeDraftCommand(finishExpansion("draft-public"), { commandId: "prepare-public", type: "PREPARE_ROOKIE_DRAFT", payload: {} });
    const before = getAvailableDraftProspects(state);
    const changed = structuredClone(state);
    for (const playerId of changed.rookieDraft?.classPlayerIds ?? []) {
      changed.players[playerId].truePotential = 25;
      changed.players[playerId].developmentRate = 99;
      changed.players[playerId].developmentVolatility = 99;
    }
    expect(getAvailableDraftProspects(changed)).toEqual(before);
  });
});
