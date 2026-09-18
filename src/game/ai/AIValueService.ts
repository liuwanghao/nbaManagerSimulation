import { BALANCE_CONFIG } from "../../config/balanceConfig";
import type { DraftPickAsset, ExpansionStrategy, Player } from "../state/types";
import { calculatePlayerOverall } from "../player/PlayerRatingService";

export function publicPlayerValue(player: Player, strategy: ExpansionStrategy = "BALANCED"): number {
  const config = BALANCE_CONFIG.trade;
  const ability = calculatePlayerOverall(player);
  const age = config.ageValue;
  const ageValue = strategy === "FUTURE_FIRST"
    ? Math.max(config.valueLimits.futureFirstAgeFloor, age.futureFirstTargetAge - player.age) * config.valueWeights.futureFirstAge
    : strategy === "WIN_NOW"
      ? Math.max(config.valueLimits.winNowAgeFloor, age.winNowBase - Math.abs(player.age - age.winNowCenterAge)) * config.valueWeights.winNowAge
      : Math.max(config.valueLimits.balancedAgeFloor, age.balancedTargetAge - player.age) * config.valueWeights.balancedAge;
  const contractValue = Math.max(config.valueLimits.contractFloor, 9 - player.contract.salary / config.salaryValueDivisor);
  const roleValue = player.rotationRole === "STARTER" ? config.starterRoleValue : player.rotationRole === "SIXTH_MAN" ? config.sixthManRoleValue : 0;
  return ability * config.valueWeights.ability + ageValue + contractValue * config.valueWeights.contract + roleValue * config.valueWeights.role;
}

export function negativeContractScore(player: Player): number {
  return player.contract.salary / BALANCE_CONFIG.trade.negativeContract.salaryMillionsDivisor
    - publicPlayerValue(player) * BALANCE_CONFIG.trade.negativeContract.playerValueMultiplier;
}

export function publicDraftPickValue(pick: DraftPickAsset, currentSeasonYear: number, projectedLottery = false): number {
  const config = BALANCE_CONFIG.trade.draftPickValue;
  const base = pick.round === 1 ? config.firstRound : config.secondRound;
  const yearsAway = Math.max(0, pick.year - currentSeasonYear - 1);
  return base * Math.pow(config.yearlyDecay, yearsAway) * (projectedLottery && pick.round === 1 ? config.lotteryPremium : 1);
}
