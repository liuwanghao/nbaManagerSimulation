import { BALANCE_CONFIG } from "../../config/balanceConfig";
import { stableHash } from "../random/hash";
import { createRng } from "../random/xoshiro";
import {
  emptyPlayerSeasonStats,
  type GameState,
  type Player,
  type PlayerAttributes,
  type PlayerCareerRecord,
  type PlayerLifecycleReport,
  type PlayerSeasonStats,
  type TrainingFocus,
} from "../state/types";
import { calculatePlayerOverall } from "../player/PlayerRatingService";

const cfg = BALANCE_CONFIG.playerLifecycle;
const ATTRIBUTE_KEYS = Object.keys(cfg.regressionMultipliers) as Array<keyof PlayerAttributes>;

export function playerOverall(player: Player): number {
  return calculatePlayerOverall(player);
}

function sumStats(target: PlayerSeasonStats, source: PlayerSeasonStats): void {
  for (const key of Object.keys(target) as Array<keyof PlayerSeasonStats>) target[key] += source[key];
}

function ensureCareer(player: Player): PlayerCareerRecord {
  player.career ??= {
    seasonsPlayed: 0,
    totals: emptyPlayerSeasonStats(),
    peakOverall: playerOverall(player),
    peakImpact: playerOverall(player),
    unemployedGameDays: 0,
    unemployedLeagueYears: 0,
    careerInjuryGamesMissed: 0,
  };
  player.career.honors ??= { allStar: 0, mvp: 0, dpoy: 0, roy: 0, mip: 0, sixthMan: 0, championships: 0, finalsMvp: 0 };
  player.career.hallOfFameEligibleData ??= player.profileSource !== "HUPU_LIVE_ROSTER";
  return player.career;
}

function updateCareerSnapshot(player: Player): void {
  const career = ensureCareer(player);
  if (player.seasonStats.games > 0) {
    career.seasonsPlayed += 1;
    sumStats(career.totals, player.seasonStats);
    career.lastSeasonStats = structuredClone(player.seasonStats);
  }
  const overall = playerOverall(player);
  career.peakOverall = Math.max(career.peakOverall, overall);
  career.peakImpact = Math.max(career.peakImpact, overall + (player.rotationRole === "STARTER" ? 3 : player.rotationRole === "SIXTH_MAN" ? 1 : 0));
}

function calculateAge(player: Player, seasonYear: number): number {
  if (player.ageSource !== "SNAPSHOT_FALLBACK" && /^\d{4}-\d{2}-\d{2}$/u.test(player.birthDate)) {
    const [birthYear, birthMonth, birthDay] = player.birthDate.split("-").map(Number);
    const currentMonth = cfg.ageCalculation.seasonMonth;
    const currentDay = cfg.ageCalculation.seasonDay;
    return Math.max(cfg.ageCalculation.minimumAge, seasonYear - birthYear - (currentMonth < birthMonth || currentMonth === birthMonth && currentDay < birthDay ? 1 : 0));
  }
  return player.ageAtSnapshot + Math.max(0, seasonYear - cfg.snapshotSeasonYear);
}

function ageCurve(age: number): number {
  if (age <= 21) return cfg.ageCurve.age21AndUnder;
  if (age <= 25) return cfg.ageCurve.age22To25;
  if (age <= 29) return cfg.ageCurve.age26To29;
  if (age <= 32) return cfg.ageCurve.age30To32;
  if (age <= 35) return cfg.ageCurve.age33To35;
  return cfg.ageCurve.age36AndOver;
}

function minutesFactor(player: Player): number {
  const minutesPerGame = player.seasonStats.games > 0 ? player.seasonStats.seconds / player.seasonStats.games / 60 : 0;
  return cfg.development.minutesBands.find((band) => minutesPerGame >= band.minimumMinutes)?.multiplier
    ?? cfg.development.minutesBands.at(-1)?.multiplier
    ?? 1;
}

function roleFactor(player: Player): number {
  const multipliers = cfg.development.roleMultipliers;
  if (player.teamRole === "DEVELOPMENT") return multipliers.development;
  if (player.teamRole === "FRANCHISE_CORE" || player.rotationRole === "STARTER") return multipliers.coreOrStarter;
  if (player.rotationRole === "OUT") return multipliers.out;
  return multipliers.default;
}

function hiddenDevelopmentFields(state: GameState, player: Player, currentOverall: number): { potential: number; rate: number; volatility: number } {
  const rng = createRng(stableHash(state.seeds.careerSeed, "development-profile", player.id));
  const hiddenConfig = cfg.hiddenPotential;
  player.truePotential ??= Math.min(cfg.attributeMaximum, Math.max(currentOverall, currentOverall
    + rng.int(hiddenConfig.minimumGap, player.age <= hiddenConfig.youngMaximumAge ? hiddenConfig.youngMaximumGap : hiddenConfig.olderMaximumGap)));
  player.developmentRate ??= cfg.development.developmentRateMin + rng.nextFloat() * cfg.development.developmentRateRange;
  player.developmentVolatility ??= cfg.development.volatilityMin + rng.nextFloat() * cfg.development.volatilityRange;
  return { potential: player.truePotential, rate: player.developmentRate, volatility: player.developmentVolatility };
}

function evolveAttributes(state: GameState, player: Player, trainingFocus?: TrainingFocus): { before: number; after: number } {
  const before = playerOverall(player);
  const hidden = hiddenDevelopmentFields(state, player, before);
  const curve = ageCurve(player.age);
  const healthFactor = cfg.development.healthBase + player.injuryRating / cfg.development.injuryRatingDivisor;
  const iqFactor = cfg.development.iqBase + player.attributes.basketballIq / cfg.development.iqDivisor;
  const potentialGap = hidden.potential - before;
  const growthOpportunity = Math.max(cfg.development.potentialInfluenceMin, Math.min(cfg.development.potentialInfluenceMax, potentialGap / cfg.development.potentialGapDivisor));
  const positiveBase = curve > 0 ? curve * hidden.rate * minutesFactor(player) * roleFactor(player) * healthFactor * iqFactor * growthOpportunity : 0;
  const negativeBase = curve < 0 ? curve * (cfg.development.regressionBase - player.injuryRating / cfg.development.regressionInjuryDivisor) : 0;

  for (const key of ATTRIBUTE_KEYS) {
    const rng = createRng(stableHash(state.seeds.seasonSeed, "development", player.id, key));
    const noise = (rng.nextFloat() * 2 - 1) * hidden.volatility;
    const trainingWeight = trainingFocus ? BALANCE_CONFIG.training.weights[trainingFocus][key] : 1;
    const base = positiveBase > 0 ? positiveBase * trainingWeight : negativeBase * cfg.regressionMultipliers[key];
    const delta = Math.max(cfg.maximumAnnualRegression, Math.min(cfg.maximumAnnualGrowth, Math.round(base + noise)));
    player.attributes[key] = Math.max(cfg.attributeMinimum, Math.min(cfg.attributeMaximum, player.attributes[key] + delta));
  }
  return { before, after: playerOverall(player) };
}

function updateUnemployment(player: Player): void {
  const career = ensureCareer(player);
  if (player.teamId === "FREE_AGENT" && player.contract.status === "UFA") {
    career.unemployedGameDays += cfg.retirement.offseasonUnemploymentDays;
    career.unemployedLeagueYears += 1;
  } else if (player.contract.status === "STANDARD") {
    career.unemployedGameDays = 0;
    career.unemployedLeagueYears = 0;
  }
}

function retirementProbability(player: Player): number {
  const career = ensureCareer(player);
  const overall = playerOverall(player);
  const retirement = cfg.retirement;
  let probability = retirement.ageProbability.find((band) => player.age >= band.minimumAge)?.probability
    ?? retirement.ageProbability.at(-1)?.probability
    ?? 0;
  probability -= Math.max(retirement.overallModifierMin, Math.min(retirement.overallModifierMax, (overall - retirement.overallBaseline) * retirement.overallProbabilityPerPoint));
  if (player.contract.status === "STANDARD") probability -= retirement.underContractReduction;
  if (player.rotationRole === "STARTER") probability -= retirement.starterReduction;
  if (player.injuryRating < retirement.lowInjuryRatingThreshold) probability += retirement.lowInjuryRatingAddition;
  if (player.personality === "COMPETITIVE") probability -= retirement.competitiveReduction;
  if (player.age >= retirement.unemploymentAgeMinimum && career.unemployedGameDays >= retirement.unemploymentDaysThreshold) probability += retirement.unemploymentAddition;
  if (player.age >= retirement.unemploymentAgeMinimum && career.unemployedLeagueYears >= retirement.unemploymentYearsThreshold) probability = Math.max(probability, retirement.unemploymentProbabilityFloor);
  return Math.max(retirement.probabilityMin, Math.min(retirement.probabilityMax, probability));
}

function hallOfFameScore(player: Player): number {
  const career = ensureCareer(player);
  const honors = career.honors as NonNullable<PlayerCareerRecord["honors"]>;
  const hall = cfg.hallOfFame;
  const awardScore = honors.mvp * hall.awardWeights.mvp + honors.finalsMvp * hall.awardWeights.finalsMvp + honors.dpoy * hall.awardWeights.dpoy
    + honors.championships * hall.awardWeights.championships + honors.allStar * hall.awardWeights.allStar + honors.roy * hall.awardWeights.roy
    + honors.sixthMan * hall.awardWeights.sixthMan + honors.mip * hall.awardWeights.mip;
  const production = Math.min(hall.production.maximum, career.totals.pts / hall.production.pointsDivisor + career.totals.reb / hall.production.reboundsDivisor + career.totals.ast / hall.production.assistsDivisor);
  const peak = Math.min(hall.peak.maximum, Math.max(0, career.peakImpact - hall.peak.baseline) * hall.peak.multiplier);
  const longevity = Math.min(hall.longevity.maximum, career.seasonsPlayed * hall.longevity.perSeason);
  return Math.round((awardScore + Math.min(hall.nonAwardMaximum, production + peak + longevity)) * 100) / 100;
}

function retirePlayer(state: GameState, player: Player): boolean {
  if (state.teams[player.teamId]) state.teams[player.teamId].playerIds = state.teams[player.teamId].playerIds.filter((id) => id !== player.id);
  player.teamId = "RETIRED";
  player.contract = {
    salary: 0,
    yearsRemaining: 0,
    guaranteedAmount: 0,
    status: "RETIRED",
    optionType: "NONE",
    optionDecision: "NOT_APPLICABLE",
  };
  player.birdTeamId = null;
  player.birdYears = 0;
  const career = ensureCareer(player);
  career.retirementSeason = state.league.seasonId;
  const score = hallOfFameScore(player);
  career.hallOfFameScore = score;
  if (career.hallOfFameEligibleData && score >= cfg.hallOfFame.threshold) {
    career.hallOfFame = true;
    career.hallOfFameClass = state.league.seasonYear;
  }
  if (!state.history.retiredPlayerIds.includes(player.id)) state.history.retiredPlayerIds.push(player.id);
  state.capState.capHolds = state.capState.capHolds.filter((hold) => hold.playerId !== player.id);
  state.capState.offerReservations = state.capState.offerReservations.filter((reservation) => reservation.playerId !== player.id);
  return Boolean(career.hallOfFame);
}

function shouldRetire(state: GameState, player: Player): boolean {
  if (player.contract.status === "RETIRED") return false;
  const rng = createRng(stableHash(state.seeds.seasonSeed, "retirement", player.id));
  return rng.nextFloat() < retirementProbability(player);
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

export function processOffseasonPlayerLifecycle(input: GameState): GameState {
  const state = structuredClone(input);
  state.history.retiredPlayerIds ??= [];
  const trainingAssignments = { ...(state.trainingPlan?.assignments ?? {}) };
  const players = Object.values(state.players).sort((left, right) => left.id.localeCompare(right.id));
  const eligibleBefore = players.filter((player) => player.contract.status !== "RETIRED");
  const beforeValues = eligibleBefore.map(playerOverall);
  const developedPlayerIds: string[] = [];
  const regressedPlayerIds: string[] = [];
  const retiredPlayerIds: string[] = [];
  const hallOfFameInducteeIds: string[] = [];

  for (const player of players) {
    if (player.contract.status === "RETIRED") continue;
    updateCareerSnapshot(player);
    player.age = calculateAge(player, state.league.seasonYear);
    updateUnemployment(player);
    const { before, after } = evolveAttributes(state, player, trainingAssignments[player.id]);
    if (after > before + cfg.changeReportEpsilon) developedPlayerIds.push(player.id);
    if (after < before - cfg.changeReportEpsilon) regressedPlayerIds.push(player.id);
    const career = ensureCareer(player);
    career.peakOverall = Math.max(career.peakOverall, after);
    career.peakImpact = Math.max(career.peakImpact, after + (player.rotationRole === "STARTER" ? 3 : 0));
    if (shouldRetire(state, player)) {
      if (retirePlayer(state, player)) hallOfFameInducteeIds.push(player.id);
      retiredPlayerIds.push(player.id);
    }
  }

  const remaining = Object.values(state.players).filter((player) => player.contract.status !== "RETIRED");
  const report: PlayerLifecycleReport = {
    processedSeasonId: state.league.seasonId,
    developedPlayerIds,
    regressedPlayerIds,
    retiredPlayerIds,
    hallOfFameInducteeIds,
    trainedPlayerIds: Object.keys(trainingAssignments).filter((playerId) => Boolean(state.players[playerId])),
    activePlayerCount: remaining.filter((player) => state.teams[player.teamId]).length,
    freeAgentCount: remaining.filter((player) => player.teamId === "FREE_AGENT").length,
    retiredPlayerCount: Object.values(state.players).filter((player) => player.contract.status === "RETIRED").length,
    rookieInflow: players.filter((player) => (player.profileSource === "PROCEDURAL_DRAFT" || player.profileSource === "HISTORICAL_ARCHETYPE") && player.id.startsWith(`DRAFT-${state.league.seasonYear - 1}-`)).length,
    retirementOutflow: retiredPlayerIds.length,
    averageOverallBefore: Math.round(average(beforeValues) * 100) / 100,
    averageOverallAfter: Math.round(average(remaining.map(playerOverall)) * 100) / 100,
  };
  state.playerLifecycle = report;
  state.trainingPlan = { seasonId: state.league.seasonId, assignments: {} };
  return state;
}
