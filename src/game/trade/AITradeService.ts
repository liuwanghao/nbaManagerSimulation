import { BALANCE_CONFIG } from "../../config/balanceConfig";
import { publicPlayerValue } from "../ai/AIValueService";
import { assertPhaseAllowed } from "../policy/TransactionPolicyService";
import { stableHash } from "../random/hash";
import { createRng } from "../random/xoshiro";
import type { GameState, Player, Team } from "../state/types";
import { validateSalaryMatch } from "./SalaryMatchValidator";
import { refreshAiDirection } from "../ai/AIManagementService";
import type { TeamDirection } from "../state/types";

const legalPhases = ["REGULAR_SEASON", "REGULAR_PRE_DEADLINE"] as const;

function seasonTeamKey(state: GameState, teamId: string): string {
  return `${state.league.seasonId}:${teamId}`;
}

function completedTrades(state: GameState, teamId: string): number {
  return state.aiTradeState.completedByTeamSeason[seasonTeamKey(state, teamId)] ?? 0;
}

function rosterNeed(team: Team, state: GameState, player: Player): number {
  const count = team.playerIds.filter((id) => state.players[id]?.position === player.position).length;
  return Math.max(BALANCE_CONFIG.ai.rosterNeedFloor, BALANCE_CONFIG.ai.rosterNeedTargetPerPosition - count) * BALANCE_CONFIG.ai.rosterNeedWeight;
}

function directionValue(player: Player, direction: TeamDirection): number {
  const base = publicPlayerValue(player, direction === "REBUILD" ? "FUTURE_FIRST" : direction === "CONTEND" ? "WIN_NOW" : "BALANCED");
  const weights = BALANCE_CONFIG.ai.directionWeights[direction];
  return base * weights.currentAbility
    + Math.max(BALANCE_CONFIG.trade.valueLimits.futureFirstAgeFloor, BALANCE_CONFIG.trade.ageValue.futureFirstTargetAge - player.age) * weights.youth
    + (player.rotationRole === "STARTER" ? weights.starterBonus : 0);
}

function acceptanceScore(state: GameState, team: Team, incoming: Player, outgoing: Player, counter: number, direction: TeamDirection): number {
  const rng = createRng(stableHash(state.seeds.seasonSeed, team.id, "ai_trade", counter, incoming.id, outgoing.id));
  const variance = rng.int(BALANCE_CONFIG.ai.deterministicVarianceMin, BALANCE_CONFIG.ai.deterministicVarianceMax);
  return directionValue(incoming, direction) - directionValue(outgoing, direction) + rosterNeed(team, state, incoming) - rosterNeed(team, state, outgoing) + variance;
}

function tradeablePlayers(state: GameState, team: Team, counter: number): Player[] {
  return team.playerIds.map((id) => state.players[id])
    .filter((player) => player?.contract.status === "STANDARD" && player.contract.contractType !== "EMERGENCY" && player.contract.yearsRemaining > 0)
    .sort((left, right) => stableHash(state.seeds.seasonSeed, "ai-trade-player", counter, team.id, left.id)
      .localeCompare(stableHash(state.seeds.seasonSeed, "ai-trade-player", counter, team.id, right.id)))
    .slice(0, BALANCE_CONFIG.ai.tradeCandidatePlayersPerTeam);
}

function commitOneForOne(state: GameState, leftTeam: Team, rightTeam: Team, leftPlayer: Player, rightPlayer: Player): void {
  leftTeam.playerIds = leftTeam.playerIds.filter((id) => id !== leftPlayer.id).concat(rightPlayer.id);
  rightTeam.playerIds = rightTeam.playerIds.filter((id) => id !== rightPlayer.id).concat(leftPlayer.id);
  leftPlayer.teamId = rightTeam.id;
  leftPlayer.birdTeamId = rightTeam.id;
  rightPlayer.teamId = leftTeam.id;
  rightPlayer.birdTeamId = leftTeam.id;
  const leftKey = seasonTeamKey(state, leftTeam.id);
  const rightKey = seasonTeamKey(state, rightTeam.id);
  state.aiTradeState.completedByTeamSeason[leftKey] = completedTrades(state, leftTeam.id) + 1;
  state.aiTradeState.completedByTeamSeason[rightKey] = completedTrades(state, rightTeam.id) + 1;
  state.aiTradeState.transactionLog.unshift(`${leftTeam.name} / ${rightTeam.name}：${leftPlayer.name} ↔ ${rightPlayer.name}`);
  state.aiTradeState.transactionLog = state.aiTradeState.transactionLog.slice(0, BALANCE_CONFIG.ai.transactionLogLimit);
}

export function isAiTradeEvaluationDay(dateIndex: number): boolean {
  const deadline = BALANCE_CONFIG.ai.tradeDeadlineDateIndex;
  return dateIndex % 7 === 0 || (dateIndex >= deadline - 7 && dateIndex <= deadline);
}

export function runAiTradeEvaluation(input: GameState, dateIndex: number, options: { mutate?: boolean } = {}): GameState {
  assertPhaseAllowed(input, "AI trade evaluation", legalPhases);
  if (!isAiTradeEvaluationDay(dateIndex)) return input;
  const state = options.mutate ? input : (() => {
    const { history, ...mutableState } = input;
    return { ...structuredClone(mutableState), history } as GameState;
  })();
  const counter = state.aiTradeState.evaluationCounter;
  state.aiTradeState.evaluationCounter += 1;
  const teams = Object.values(state.teams).filter((team) => team.id !== state.userTeamId && completedTrades(state, team.id) < BALANCE_CONFIG.ai.maxTradesPerTeamSeason)
    .sort((left, right) => stableHash(state.seeds.seasonSeed, "ai-trade-team", counter, left.id)
      .localeCompare(stableHash(state.seeds.seasonSeed, "ai-trade-team", counter, right.id)));

  for (const leftTeam of teams) {
    const leftDirection = refreshAiDirection(state, leftTeam.id, dateIndex);
    const partners = teams.filter((team) => team.id !== leftTeam.id).slice(0, BALANCE_CONFIG.ai.tradePartnerTeamsPerEvaluation);
    for (const rightTeam of partners) {
      const rightDirection = refreshAiDirection(state, rightTeam.id, dateIndex);
      if (completedTrades(state, leftTeam.id) >= BALANCE_CONFIG.ai.maxTradesPerTeamSeason
        || completedTrades(state, rightTeam.id) >= BALANCE_CONFIG.ai.maxTradesPerTeamSeason) continue;
      for (const leftPlayer of tradeablePlayers(state, leftTeam, counter)) {
        for (const rightPlayer of tradeablePlayers(state, rightTeam, counter)) {
          try {
            validateSalaryMatch(state, leftTeam.id, [leftPlayer.id], [rightPlayer.id]);
            validateSalaryMatch(state, rightTeam.id, [rightPlayer.id], [leftPlayer.id]);
          } catch { continue; }
          const leftScore = acceptanceScore(state, leftTeam, rightPlayer, leftPlayer, counter, leftDirection);
          const rightScore = acceptanceScore(state, rightTeam, leftPlayer, rightPlayer, counter, rightDirection);
          if (leftScore < BALANCE_CONFIG.ai.tradeAcceptanceThreshold || rightScore < BALANCE_CONFIG.ai.tradeAcceptanceThreshold) continue;
          commitOneForOne(state, leftTeam, rightTeam, leftPlayer, rightPlayer);
          return state;
        }
      }
    }
  }
  return state;
}
