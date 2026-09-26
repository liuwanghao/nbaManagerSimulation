import { BALANCE_CONFIG } from "../../config/balanceConfig";
import type { DraftPickAsset, ExpansionStrategy, GameState, Player } from "../state/types";
import { calculatePlayerOverall } from "../player/PlayerRatingService";

function interpolate(value: number, anchors: readonly { overall: number; value: number }[]): number {
  if (value <= anchors[0].overall) return Math.max(0, anchors[0].value + (value - anchors[0].overall));
  for (let index = 1; index < anchors.length; index += 1) {
    if (value <= anchors[index].overall) {
      const previous = anchors[index - 1];
      const next = anchors[index];
      return previous.value + (next.value - previous.value) * (value - previous.overall) / (next.overall - previous.overall);
    }
  }
  return anchors[anchors.length - 1].value + (value - anchors[anchors.length - 1].overall) * 3.6;
}

function marketSalary(overall: number): number {
  const anchors = BALANCE_CONFIG.freeAgency.marketSalary.ratingAnchors;
  if (overall <= anchors[0].overall) return anchors[0].annualSalary;
  for (let index = 1; index < anchors.length; index += 1) {
    if (overall <= anchors[index].overall) {
      const previous = anchors[index - 1];
      const next = anchors[index];
      return previous.annualSalary + (next.annualSalary - previous.annualSalary) * (overall - previous.overall) / (next.overall - previous.overall);
    }
  }
  return anchors[anchors.length - 1].annualSalary;
}

export function publicPlayerValue(player: Player, strategy: ExpansionStrategy = "BALANCED"): number {
  const config = BALANCE_CONFIG.trade;
  const ability = calculatePlayerOverall(player);
  const age = config.ageValue;
  const ageValue = strategy === "FUTURE_FIRST"
    ? Math.max(config.valueLimits.futureFirstAgeFloor, age.futureFirstTargetAge - player.age) * config.valueWeights.futureFirstAge
    : strategy === "WIN_NOW"
      ? Math.max(config.valueLimits.winNowAgeFloor, age.winNowBase - Math.abs(player.age - age.winNowCenterAge)) * config.valueWeights.winNowAge
      : Math.max(config.valueLimits.balancedAgeFloor, age.balancedTargetAge - player.age) * config.valueWeights.balancedAge;
  const potentialAgeWeight = Math.max(0, Math.min(1, (config.potentialBonusEndAge - player.age) / (config.potentialBonusEndAge - config.potentialBonusFullAge)));
  const potentialValue = (player.scoutedPotentialGrade ? config.potentialBonusByGrade[player.scoutedPotentialGrade] : 0) * potentialAgeWeight;
  const contractYears = player.contract.status === "STANDARD" ? Math.max(0, player.contract.yearsRemaining) : 0;
  const contractWeight = contractYears ? Math.min(1, config.contractTermFirstYearWeight + (contractYears - 1) * config.contractTermAdditionalYearWeight) : 0;
  const salarySurplus = (marketSalary(ability) - player.contract.salary) / config.contractValueDivisor;
  const contractValue = Math.max(-config.contractValueLimit, Math.min(config.contractValueLimit, salarySurplus)) * contractWeight;
  return Math.max(0, Math.min(100, interpolate(ability, config.abilityValueAnchors) + ageValue + potentialValue + contractValue));
}

export function negativeContractScore(player: Player): number {
  return player.contract.salary / BALANCE_CONFIG.trade.negativeContract.salaryMillionsDivisor
    - publicPlayerValue(player) * BALANCE_CONFIG.trade.negativeContract.playerValueMultiplier;
}

export function publicDraftPickValue(pick: DraftPickAsset, currentSeasonYear: number, projectedStrength = 0.5): number {
  const config = BALANCE_CONFIG.trade.draftPickValue;
  const base = pick.round === 1 ? config.firstRound : config.secondRound;
  const yearsAway = Math.max(0, pick.year - currentSeasonYear - 1);
  const strength = Math.max(0, Math.min(1, projectedStrength));
  const multiplier = strength < 0.5
    ? 1 + (0.5 - strength) * 2 * ((pick.round === 1 ? config.lotteryPremium : config.lotterySecondMultiplier) - 1)
    : 1 - (strength - 0.5) * 2 * (1 - (pick.round === 1 ? config.lateFirstMultiplier : config.lateSecondMultiplier));
  const projectionConfidence = Math.max(0, 1 - yearsAway * 0.2);
  return base * Math.pow(config.yearlyDecay, yearsAway) * (1 + (multiplier - 1) * projectionConfidence);
}

/** Estimate the original team's pick range using roster strength and the current record. */
export function projectedDraftPickStrength(state: GameState, pick: DraftPickAsset): number {
  const teams = Object.values(state.teams);
  const strengths = new Map(teams.map((team) => {
    const topEight = team.playerIds.map((id) => state.players[id]).filter(Boolean)
      .map(calculatePlayerOverall).sort((left, right) => right - left).slice(0, 8);
    const rosterOverall = topEight.length ? topEight.reduce((sum, overall) => sum + overall, 0) / topEight.length : 65;
    const record = state.standings[team.id];
    const games = record ? record.wins + record.losses : 0;
    const recordAdjustment = record && games >= 10 ? (record.wins / games - 0.5) * Math.min(12, games / 3) : 0;
    return [team.id, rosterOverall + recordAdjustment] as const;
  }));
  const ranked = teams.sort((left, right) => (strengths.get(left.id) ?? 65) - (strengths.get(right.id) ?? 65) || left.id.localeCompare(right.id));
  const rank = ranked.findIndex((team) => team.id === pick.originalTeamId);
  return rank < 0 || ranked.length < 2 ? 0.5 : rank / (ranked.length - 1);
}

export function tradeDraftPickValue(state: GameState, pick: DraftPickAsset): number {
  return publicDraftPickValue(pick, state.league.seasonYear, projectedDraftPickStrength(state, pick));
}
