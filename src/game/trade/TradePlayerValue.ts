import { BALANCE_CONFIG } from "../../config/balanceConfig";
import { publicPlayerValue } from "../ai/AIValueService";
import { calculatePlayerOverall } from "../player/PlayerRatingService";
import type { ExpansionStrategy, Player, PlayerSeasonStats } from "../state/types";

const clamp = (value: number, minimum: number, maximum: number): number => Math.max(minimum, Math.min(maximum, value));

function seasonPerformanceAdjustment(player: Player, stats: PlayerSeasonStats): number {
  if (stats.seconds <= 0 || stats.games <= 0) return 0;
  const config = BALANCE_CONFIG.trade.performance;
  const per36 = 36 * 60 / stats.seconds;
  const shootingPossessions = stats.fga + 0.44 * stats.fta;
  const trueShooting = shootingPossessions > 0 ? stats.pts / (2 * shootingPossessions) : config.expectedTrueShooting;
  const impact = per36 * (
    stats.pts * config.pointsWeight
    + stats.reb * config.reboundsWeight
    + stats.ast * config.assistsWeight
    + (stats.stl + stats.blk) * config.defensiveStatsWeight
    - stats.tov * config.turnoversWeight
    + (trueShooting - config.expectedTrueShooting) * stats.fga * config.efficiencyWeight
  );
  const expected = config.expectedImpactAt70
    + (calculatePlayerOverall(player) - 70) * config.expectedImpactPerOverall;
  return clamp((impact - expected) * config.pointsPerImpact, -config.maximumAdjustment, config.maximumAdjustment);
}

/** A bounded, sample-weighted market adjustment; contracts and expansion keep their existing value model. */
export function tradePerformanceAdjustment(player: Player): number {
  const config = BALANCE_CONFIG.trade.performance;
  const current = player.seasonStats;
  const currentWeight = clamp(current.seconds / (config.fullWeightMinutes * 60), 0, 1);
  const previous = player.career?.lastSeasonStatsSource === "SYNTHETIC_OPENING"
    ? undefined : player.career?.lastSeasonStats;
  const previousWeight = previous ? clamp(previous.seconds / (config.fullWeightMinutes * 60), 0, 1) : 0;
  const previousAdjustment = previous ? seasonPerformanceAdjustment(player, previous) * previousWeight : 0;
  const recentWeight = clamp(current.seconds / (config.recentFormFullWeightMinutes * 60), 0, 1);
  return clamp(previousAdjustment * (1 - currentWeight)
    + seasonPerformanceAdjustment(player, current) * currentWeight
    + player.form * config.recentFormWeight * recentWeight,
  -config.maximumAdjustment, config.maximumAdjustment);
}

export function tradePlayerValue(player: Player, strategy: ExpansionStrategy = "BALANCED"): number {
  return clamp(publicPlayerValue(player, strategy) + tradePerformanceAdjustment(player), 0, 100);
}
