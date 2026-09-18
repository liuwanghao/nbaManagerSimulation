import { createRng } from "../random/xoshiro";
import type { Player, PlayerBoxScore, TeamBoxScore } from "../state/types";
import { SIMULATION_CONFIG } from "./config";
import { allocateInteger } from "./minutes";
import { clamp, playerOffenseImpact, teamTalents } from "./ratings";

interface ReconciledShooting {
  fga: number;
  threePa: number;
  fta: number;
  twoPm: number;
  threePm: number;
  ftm: number;
}

function reconcileShooting(score: number, initialFga: number, initialThreePa: number, initialFta: number): ReconciledShooting {
  const config = SIMULATION_CONFIG.boxScore.reconciliation;
  const adjustments: Array<[number, number, number]> = [];
  for (let fgaDelta = config.fgaDeltaMin; fgaDelta <= config.fgaDeltaMax; fgaDelta += 1) {
    for (let threeDelta = config.threePaDeltaMin; threeDelta <= config.threePaDeltaMax; threeDelta += 1) {
      for (let ftaDelta = config.ftaDeltaMin; ftaDelta <= config.ftaDeltaMax; ftaDelta += 1) adjustments.push([fgaDelta, threeDelta, ftaDelta]);
    }
  }
  adjustments.sort((a, b) => a.reduce((sum, value) => sum + Math.abs(value), 0) - b.reduce((sum, value) => sum + Math.abs(value), 0));
  for (const [fgaDelta, threeDelta, ftaDelta] of adjustments) {
    const fga = Math.max(config.minimumFga, initialFga + fgaDelta);
    const threePa = clamp(initialThreePa + threeDelta, config.minimumThreePa, fga - config.minimumTwoPointAttempts);
    const fta = Math.max(config.minimumFta, initialFta + ftaDelta);
    const twoPointCapacity = fga - threePa;
    let best: (ReconciledShooting & { cost: number }) | null = null;
    for (let threePm = 0; threePm <= threePa; threePm += 1) {
      const residual = score - 3 * threePm;
      const minimumFtm = Math.max(0, residual - 2 * twoPointCapacity);
      const maximumFtm = Math.min(fta, residual);
      if (minimumFtm > maximumFtm) continue;
      let ftm = clamp(Math.round(fta * config.targetFreeThrowPercentage), minimumFtm, maximumFtm);
      if ((residual - ftm) % 2 !== 0) {
        if (ftm + 1 <= maximumFtm) ftm += 1;
        else if (ftm - 1 >= minimumFtm) ftm -= 1;
        else continue;
      }
      const twoPm = (residual - ftm) / 2;
      const cost = Math.abs(threePm - threePa * config.targetThreePointPercentage) + Math.abs(ftm - fta * config.targetFreeThrowPercentage);
      if (!best || cost < best.cost) best = { fga, threePa, fta, twoPm, threePm, ftm, cost };
    }
    if (best) {
      const { cost: _cost, ...shooting } = best;
      return shooting;
    }
  }
  throw new Error(`Unable to reconcile legal shooting for score ${score}`);
}

function allocateWithCaps(total: number, weights: number[], caps: number[]): number[] {
  return allocateInteger(total, weights, caps);
}

export function buildTeamBoxScore(
  teamId: string,
  players: Player[],
  seconds: Record<string, number>,
  score: number,
  pace: number,
  seed: string,
): TeamBoxScore {
  const rng = createRng(seed);
  const config = SIMULATION_CONFIG.boxScore;
  const active = players.filter((player) => (seconds[player.id] ?? 0) > 0);
  const talents = teamTalents(active, seconds);
  const baseline = SIMULATION_CONFIG.ratings.baseline;
  const tovRate = clamp(config.turnover.baseRate - config.turnover.playmakingCoefficient * (talents.playmaking - baseline)
    - config.turnover.iqCoefficient * (talents.basketballIq - baseline) + rng.normalLike(config.turnover.noise), config.turnover.minimumRate, config.turnover.maximumRate);
  const tov = Math.round(pace * tovRate);
  const fta = Math.round(pace * clamp(config.freeThrows.baseRate + config.freeThrows.finishingCoefficient * (talents.finishing - baseline)
    + rng.normalLike(config.freeThrows.noise), config.freeThrows.minimumRate, config.freeThrows.maximumRate));
  const offensiveRebounds = Math.round(pace * clamp(config.offensiveRebounds.baseRate + config.offensiveRebounds.reboundingCoefficient * (talents.rebounding - baseline)
    + rng.normalLike(config.offensiveRebounds.noise), config.offensiveRebounds.minimumRate, config.offensiveRebounds.maximumRate));
  const fga = Math.round(pace - config.freeThrows.possessionCoefficient * fta + offensiveRebounds - tov);
  const threePa = Math.round(fga * talents.threeRate);
  const shooting = reconcileShooting(score, fga, threePa, fta);
  const fgm = shooting.twoPm + shooting.threePm;
  const rebounds = offensiveRebounds + Math.round(config.rebounds.defensiveBase + rng.normalLike(config.rebounds.noise));
  const assists = Math.min(fgm, Math.max(config.assists.minimum, Math.round(fgm * clamp(config.assists.baseMadeFieldGoalRate
    + (talents.playmaking - baseline) * config.assists.playmakingCoefficient, config.assists.minimumRate, config.assists.maximumRate))));
  const steals = Math.max(config.steals.minimum, Math.round(config.steals.base + rng.normalLike(config.steals.noise)));
  const blocks = Math.max(config.blocks.minimum, Math.round(config.blocks.base + rng.normalLike(config.blocks.noise)));

  const minuteWeights = active.map((player) => seconds[player.id]);
  const usageWeights = active.map((player) => {
    const ratingRange = SIMULATION_CONFIG.ratings.maximum - SIMULATION_CONFIG.ratings.minimum;
    const usage = config.usage.tendencyWeight * clamp((player.usageTendency - SIMULATION_CONFIG.ratings.minimum) / ratingRange, 0, 1)
      + config.usage.offenseImpactWeight * clamp((playerOffenseImpact(player) - SIMULATION_CONFIG.ratings.minimum) / ratingRange, 0, 1);
    return seconds[player.id] * SIMULATION_CONFIG.usageRoleMultiplier[player.teamRole] * usage;
  });
  const fgaByPlayer = allocateInteger(shooting.fga, usageWeights);
  const threeAttemptWeights = active.map((player, index) => minuteWeights[index] * player.threeRate * player.attributes.shooting);
  const threePaByPlayer = allocateWithCaps(shooting.threePa, threeAttemptWeights, fgaByPlayer);
  const threePmByPlayer = allocateWithCaps(shooting.threePm, active.map((player, index) => threePaByPlayer[index] * player.attributes.shooting), threePaByPlayer);
  const twoCaps = fgaByPlayer.map((attempts, index) => attempts - threePaByPlayer[index]);
  const twoPmByPlayer = allocateWithCaps(shooting.twoPm, active.map((player, index) => twoCaps[index] * player.attributes.finishing), twoCaps);
  const ftaByPlayer = allocateInteger(shooting.fta, active.map((player, index) => usageWeights[index] * player.attributes.finishing));
  const ftmByPlayer = allocateWithCaps(shooting.ftm, active.map((player, index) => ftaByPlayer[index] * (player.attributes.shooting + player.attributes.basketballIq)), ftaByPlayer);
  const rebByPlayer = allocateInteger(rebounds, active.map((player, index) => minuteWeights[index] * player.attributes.rebounding));
  const astByPlayer = allocateInteger(assists, active.map((player, index) => minuteWeights[index] * (player.attributes.playmaking + player.attributes.basketballIq)));
  const stlByPlayer = allocateInteger(steals, active.map((player, index) => minuteWeights[index] * player.attributes.perimeterDefense));
  const blkByPlayer = allocateInteger(blocks, active.map((player, index) => minuteWeights[index] * (player.attributes.interiorDefense + player.attributes.athleticism)));
  const tovByPlayer = allocateInteger(tov, usageWeights);

  const playerStats: PlayerBoxScore[] = active.map((player, index) => {
    const playerFgm = twoPmByPlayer[index] + threePmByPlayer[index];
    const pts = 2 * twoPmByPlayer[index] + 3 * threePmByPlayer[index] + ftmByPlayer[index];
    return {
      playerId: player.id,
      games: 1,
      seconds: seconds[player.id],
      pts,
      fgm: playerFgm,
      fga: fgaByPlayer[index],
      threePm: threePmByPlayer[index],
      threePa: threePaByPlayer[index],
      ftm: ftmByPlayer[index],
      fta: ftaByPlayer[index],
      reb: rebByPlayer[index],
      ast: astByPlayer[index],
      stl: stlByPlayer[index],
      blk: blkByPlayer[index],
      tov: tovByPlayer[index],
    };
  });

  return {
    teamId,
    score,
    playerStats,
    totals: {
      seconds: Object.values(seconds).reduce((sum, value) => sum + value, 0),
      pts: score,
      fgm,
      fga: shooting.fga,
      threePm: shooting.threePm,
      threePa: shooting.threePa,
      ftm: shooting.ftm,
      fta: shooting.fta,
      reb: rebounds,
      ast: assists,
      stl: steals,
      blk: blocks,
      tov,
    },
  };
}
