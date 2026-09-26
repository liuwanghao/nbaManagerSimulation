import { describe, expect, it } from "vitest";
import { BALANCE_CONFIG } from "../../config/balanceConfig";
import { stableHash, stableSerialize } from "../random/hash";
import { createCareer } from "../season/career";
import { isAiTradeEvaluationDay, runAiTradeEvaluation } from "./AITradeService";

describe("AITradeService", () => {
  it("evaluates only on the fixed cadence and replays from the same seed", () => {
    const state = createCareer("ai-trade-cadence");
    expect(isAiTradeEvaluationDay(6)).toBe(false);
    expect(isAiTradeEvaluationDay(7)).toBe(true);
    expect(isAiTradeEvaluationDay(BALANCE_CONFIG.ai.tradeDeadlineDateIndex - 3)).toBe(true);
    expect(runAiTradeEvaluation(state, 6)).toBe(state);
    const first = runAiTradeEvaluation(state, 7);
    const second = runAiTradeEvaluation(state, 7);
    expect(first.aiTradeState.evaluationCounter).toBe(1);
    expect(stableHash(stableSerialize(first))).toBe(stableHash(stableSerialize(second)));
  });

  it("never involves the user team or exceeds the three-trade per-team cap", () => {
    let state = createCareer("ai-trade-cap");
    const originalUserRoster = [...state.teams[state.userTeamId].playerIds];
    for (let date = 0; date <= BALANCE_CONFIG.ai.tradeDeadlineDateIndex; date += 1) {
      if (isAiTradeEvaluationDay(date)) state = runAiTradeEvaluation(state, date);
    }
    expect(state.aiTradeState.transactionLog.length).toBeGreaterThan(0);
    expect(state.aiTradeState.transactionLog[0]).toContain(state.league.seasonId);
    expect(state.teams[state.userTeamId].playerIds).toEqual(originalUserRoster);
    expect(Object.values(state.aiTradeState.completedByTeamSeason).every((count) => count <= 3)).toBe(true);
    expect(new Set(Object.values(state.teams).flatMap((team) => team.playerIds)).size)
      .toBe(Object.values(state.teams).flatMap((team) => team.playerIds).length);
  });
});
