import { BALANCE_CONFIG } from "../../config/balanceConfig";
import { corePlayerTradePremium, publicPlayerValue, tradeDraftPickValue } from "../ai/AIValueService";
import { assertPhaseAllowed } from "../policy/TransactionPolicyService";
import { stableHash } from "../random/hash";
import { createRng } from "../random/xoshiro";
import type { DraftPickAsset, GameState, Player, Team } from "../state/types";
import { refreshAiDirection } from "../ai/AIManagementService";
import type { TeamDirection } from "../state/types";
import { applyTradePackage, validateTradePackage, type TradePackage } from "./TradeService";

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

function pickDirectionValue(state: GameState, pick: DraftPickAsset, direction: TeamDirection): number {
  return tradeDraftPickValue(state, pick) * (0.8 + BALANCE_CONFIG.ai.directionWeights[direction].youth);
}

function acceptanceScore(
  state: GameState, team: Team, incomingPlayers: Player[], outgoingPlayers: Player[],
  incomingPicks: DraftPickAsset[], outgoingPicks: DraftPickAsset[], counter: number, direction: TeamDirection,
): number {
  const rng = createRng(stableHash(state.seeds.seasonSeed, team.id, "ai_trade", counter,
    incomingPlayers.map((player) => player.id), outgoingPlayers.map((player) => player.id)));
  const variance = rng.int(BALANCE_CONFIG.ai.deterministicVarianceMin, BALANCE_CONFIG.ai.deterministicVarianceMax);
  const playerValue = (players: Player[]) => players.reduce((sum, player) => sum + directionValue(player, direction), 0);
  const pickValue = (picks: DraftPickAsset[]) => picks.reduce((sum, pick) => sum + pickDirectionValue(state, pick, direction), 0);
  const need = (players: Player[]) => players.reduce((sum, player) => sum + rosterNeed(team, state, player), 0);
  return playerValue(incomingPlayers) - playerValue(outgoingPlayers)
    + pickValue(incomingPicks) - pickValue(outgoingPicks)
    + need(incomingPlayers) - need(outgoingPlayers) + variance
    - corePlayerTradePremium(outgoingPlayers, incomingPlayers);
}

function tradeablePlayers(state: GameState, team: Team, counter: number): Player[] {
  return team.playerIds.map((id) => state.players[id])
    .filter((player) => player?.contract.status === "STANDARD" && player.contract.contractType !== "EMERGENCY" && player.contract.yearsRemaining > 0)
    .sort((left, right) => stableHash(state.seeds.seasonSeed, "ai-trade-player", counter, team.id, left.id)
      .localeCompare(stableHash(state.seeds.seasonSeed, "ai-trade-player", counter, team.id, right.id)))
    .slice(0, BALANCE_CONFIG.ai.tradeCandidatePlayersPerTeam);
}

function playerBundles(players: Player[], preferPairs: boolean): Player[][] {
  const singles = players.map((player) => [player]);
  const pairs: Player[][] = [];
  // Bound pair searches because every league evaluation considers many partners.
  for (let first = 0; first < Math.min(4, players.length); first += 1) {
    for (let second = first + 1; second < Math.min(4, players.length); second += 1) {
      pairs.push([players[first], players[second]]);
    }
  }
  return [...(preferPairs ? pairs : singles), ...(preferPairs ? singles : pairs), []];
}

function availablePicks(state: GameState, teamId: string): DraftPickAsset[] {
  const firstYear = state.league.seasonYear + 1;
  const lastYear = state.league.seasonYear + BALANCE_CONFIG.trade.futurePickHorizonYears;
  const owned = Object.values(state.draftPicks)
    .filter((pick) => pick.ownerTeamId === teamId && !pick.reservedByCommitmentId && pick.year >= firstYear && pick.year <= lastYear)
    .sort((left, right) => left.year - right.year || left.id.localeCompare(right.id));
  return [...owned.filter((pick) => pick.round === 2).slice(0, 2), ...owned.filter((pick) => pick.round === 1).slice(0, 2)];
}

function packageLabel(state: GameState, players: string[], picks: string[]): string {
  return [...players.map((id) => state.players[id].name), ...picks.map((id) => {
    const pick = state.draftPicks[id];
    return `${pick.year}年${pick.round === 1 ? "首轮" : "次轮"}签（${state.teams[pick.originalTeamId]?.name ?? pick.originalTeamId}原签）`;
  })].join("、");
}

function commitAiTrade(state: GameState, trade: TradePackage): void {
  const left = state.teams[trade.leftTeamId];
  const right = state.teams[trade.rightTeamId];
  const leftLabel = packageLabel(state, trade.leftPlayerIds, trade.leftPickIds);
  const rightLabel = packageLabel(state, trade.rightPlayerIds, trade.rightPickIds);
  applyTradePackage(state, trade);
  for (const team of [left, right]) {
    const key = seasonTeamKey(state, team.id);
    state.aiTradeState.completedByTeamSeason[key] = completedTrades(state, team.id) + 1;
  }
  state.aiTradeState.transactionLog.unshift(`${state.league.seasonId} · ${left.name} / ${right.name}：${leftLabel} ↔ ${rightLabel}`);
}

function tryTrade(
  state: GameState, left: Team, right: Team, leftPlayers: Player[], rightPlayers: Player[],
  leftPicks: DraftPickAsset[], rightPicks: DraftPickAsset[],
): boolean {
  const trade: TradePackage = {
    leftTeamId: left.id, rightTeamId: right.id,
    leftPlayerIds: leftPlayers.map((player) => player.id), rightPlayerIds: rightPlayers.map((player) => player.id),
    leftPickIds: leftPicks.map((pick) => pick.id), rightPickIds: rightPicks.map((pick) => pick.id),
  };
  try { validateTradePackage(state, trade); } catch { return false; }
  commitAiTrade(state, trade);
  return true;
}

export function isAiTradeEvaluationDay(dateIndex: number): boolean {
  const deadline = BALANCE_CONFIG.ai.tradeDeadlineDateIndex;
  return dateIndex % 7 === 0 || (dateIndex >= deadline - 7 && dateIndex <= deadline);
}

export function runAiTradeEvaluation(input: GameState, dateIndex: number, options: { mutate?: boolean } = {}): GameState {
  assertPhaseAllowed(input, "AI trade evaluation", legalPhases);
  if (dateIndex >= BALANCE_CONFIG.ai.tradeDeadlineDateIndex || !isAiTradeEvaluationDay(dateIndex)) return input;
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
      const leftPicks = availablePicks(state, leftTeam.id);
      const rightPicks = availablePicks(state, rightTeam.id);
      const preferPairs = counter % 3 === 0;
      for (const leftPlayers of playerBundles(tradeablePlayers(state, leftTeam, counter), preferPairs)) {
        for (const rightPlayers of playerBundles(tradeablePlayers(state, rightTeam, counter), preferPairs)) {
          if (!leftPlayers.length && !rightPlayers.length) continue;
          const leftScore = acceptanceScore(state, leftTeam, rightPlayers, leftPlayers, [], [], counter, leftDirection);
          const rightScore = acceptanceScore(state, rightTeam, leftPlayers, rightPlayers, [], [], counter, rightDirection);
          const threshold = BALANCE_CONFIG.ai.tradeAcceptanceThreshold;
          if (leftScore >= threshold && rightScore >= threshold
            && tryTrade(state, leftTeam, rightTeam, leftPlayers, rightPlayers, [], [])) return state;
          // The side receiving more player value can add a selection as compensation.
          if (leftScore < threshold && rightScore >= threshold) {
            for (const pick of rightPicks) {
              if (leftScore + pickDirectionValue(state, pick, leftDirection) >= threshold
                && rightScore - pickDirectionValue(state, pick, rightDirection) >= threshold
                && tryTrade(state, leftTeam, rightTeam, leftPlayers, rightPlayers, [], [pick])) return state;
            }
          } else if (rightScore < threshold && leftScore >= threshold) {
            for (const pick of leftPicks) {
              if (rightScore + pickDirectionValue(state, pick, rightDirection) >= threshold
                && leftScore - pickDirectionValue(state, pick, leftDirection) >= threshold
                && tryTrade(state, leftTeam, rightTeam, leftPlayers, rightPlayers, [pick], [])) return state;
            }
          }
        }
      }
    }
  }
  return state;
}
