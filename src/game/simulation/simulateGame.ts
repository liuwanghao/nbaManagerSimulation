import { stableHash } from "../random/hash";
import { createRng } from "../random/xoshiro";
import type { GameResult, Player, ScheduleGame, Team } from "../state/types";
import { buildTeamBoxScore } from "./boxScore";
import { SIMULATION_CONFIG } from "./config";
import { addOvertimeSeconds, solveRotationSeconds } from "./minutes";
import { clamp, teamTalents } from "./ratings";
import { generateGameInjuries } from "./injuries";
import { calculateTeamFitForPlayers } from "../team/TeamFitService";

const playersForTeam = (team: Team, players: Record<string, Player>): Player[] =>
  team.playerIds.map((id) => players[id]).filter(Boolean);

function splitPeriodScores(total: number, periods: number, seed: string): number[] {
  const rng = createRng(seed);
  const scoring = SIMULATION_CONFIG.scoring;
  const weights = Array.from({ length: periods }, (_, index) => (index >= 4 ? scoring.overtimePeriodWeight : 1)
    * (scoring.periodWeightMinimum + rng.nextFloat() * scoring.periodWeightRange));
  const weightTotal = weights.reduce((sum, value) => sum + value, 0);
  const raw = weights.map((weight) => total * weight / weightTotal);
  const scores = raw.map(Math.floor);
  let remainder = total - scores.reduce((sum, value) => sum + value, 0);
  const order = raw.map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index);
  for (let index = 0; remainder > 0; index += 1, remainder -= 1) scores[order[index % order.length].index] += 1;
  return scores;
}

function applyGarbageTimeMinutes(
  seconds: Record<string, number>,
  teamPlayers: Player[],
  scoreMargin: number,
  overtimePeriods: number,
): Record<string, number> {
  const config = SIMULATION_CONFIG.garbageTime;
  if (overtimePeriods > 0 || scoreMargin < config.scoreMarginThreshold || config.starterMinutesReduction <= 0) return seconds;
  const adjusted = { ...seconds };
  const starters = teamPlayers.filter((player) => player.rotationRole === "STARTER" && (adjusted[player.id] ?? 0) > 0);
  const reserves = teamPlayers.filter((player) => player.rotationRole !== "STARTER" && (adjusted[player.id] ?? 0) > 0);
  if (!starters.length || !reserves.length) return seconds;
  let redistributed = 0;
  for (const player of starters) {
    const configurableReduction = Math.min(config.starterMinutesReduction, config.fourthQuarterStartMinute) * 60;
    const reduction = Math.min(configurableReduction, Math.max(0, adjusted[player.id] - config.minimumStarterSecondsAfterReduction));
    adjusted[player.id] -= reduction;
    redistributed += reduction;
  }
  reserves.forEach((player, index) => {
    const share = Math.floor(redistributed / reserves.length) + (index < redistributed % reserves.length ? 1 : 0);
    adjusted[player.id] += share;
  });
  return adjusted;
}

export function moraleEfficiencyModifier(teamPlayers: Player[], seconds: Record<string, number>): number {
  const total = Object.values(seconds).reduce((sum, value) => sum + value, 0);
  if (total <= 0) return 0;
  const morale = teamPlayers.reduce((sum, player) => sum + (player.morale ?? SIMULATION_CONFIG.defaultMorale) * (seconds[player.id] ?? 0) / total, 0);
  if (morale >= SIMULATION_CONFIG.moraleNoPenaltyThreshold) return 0;
  return -SIMULATION_CONFIG.moraleMaxPenalty
    * (SIMULATION_CONFIG.moraleNoPenaltyThreshold - Math.max(SIMULATION_CONFIG.moralePenaltyFloor, morale))
    / (SIMULATION_CONFIG.moraleNoPenaltyThreshold - SIMULATION_CONFIG.moralePenaltyFloor);
}

export function simulateGame(
  game: ScheduleGame,
  homeTeam: Team,
  awayTeam: Team,
  players: Record<string, Player>,
  seasonSeed: string,
  postseason = false,
): GameResult {
  const gameSeed = stableHash(seasonSeed, "game", game.id);
  const homePlayers = playersForTeam(homeTeam, players);
  const awayPlayers = playersForTeam(awayTeam, players);
  const regulationHomeSeconds = solveRotationSeconds(homePlayers, postseason);
  const regulationAwaySeconds = solveRotationSeconds(awayPlayers, postseason);
  const homeTalent = teamTalents(homePlayers, regulationHomeSeconds);
  const awayTalent = teamTalents(awayPlayers, regulationAwaySeconds);
  const homeFit = calculateTeamFitForPlayers(homePlayers);
  const awayFit = calculateTeamFitForPlayers(awayPlayers);
  const paceRng = createRng(stableHash(gameSeed, "pace"));
  const pace = clamp(
    SIMULATION_CONFIG.leagueBasePace
      + SIMULATION_CONFIG.paceAthleticismWeight * ((homeTalent.athleticism + awayTalent.athleticism) / 2 - SIMULATION_CONFIG.talentBaseline)
      + (paceRng.nextFloat() * 2 - 1) * SIMULATION_CONFIG.paceNoise,
    SIMULATION_CONFIG.paceMin,
    SIMULATION_CONFIG.paceMax,
  );
  const starCap = postseason ? SIMULATION_CONFIG.starPower.postseasonCap : SIMULATION_CONFIG.starPower.regularSeasonCap;
  const starModifier = (starPower: number) => clamp(
    (starPower - SIMULATION_CONFIG.starPower.baseline) * SIMULATION_CONFIG.starPower.weight,
    -starCap,
    starCap,
  );
  const formModifier = (teamPlayers: Player[], seconds: Record<string, number>) => {
    const total = Object.values(seconds).reduce((sum, value) => sum + value, 0);
    return clamp(teamPlayers.reduce((sum, player) => sum + player.form * (seconds[player.id] ?? 0) / total, 0), SIMULATION_CONFIG.formModifierMin, SIMULATION_CONFIG.formModifierMax);
  };
  const noiseScale = postseason ? SIMULATION_CONFIG.playoffNoiseMultiplier : 1;
  const homeEfficiencyRng = createRng(stableHash(gameSeed, "home_efficiency"));
  const awayEfficiencyRng = createRng(stableHash(gameSeed, "away_efficiency"));
  const homeOrtg = SIMULATION_CONFIG.leagueAverageOrtg
    + SIMULATION_CONFIG.talentOffenseScale * (homeTalent.offense - SIMULATION_CONFIG.talentBaseline)
    - SIMULATION_CONFIG.talentDefenseScale * (awayTalent.defense - SIMULATION_CONFIG.talentBaseline)
    + starModifier(homeTalent.starPower)
    + homeFit.modifier
    + formModifier(homePlayers, regulationHomeSeconds)
    + moraleEfficiencyModifier(homePlayers, regulationHomeSeconds)
    + SIMULATION_CONFIG.homeOrtgModifier
    + homeEfficiencyRng.normalLike(SIMULATION_CONFIG.efficiencyNoiseSd * noiseScale);
  const awayOrtg = SIMULATION_CONFIG.leagueAverageOrtg
    + SIMULATION_CONFIG.talentOffenseScale * (awayTalent.offense - SIMULATION_CONFIG.talentBaseline)
    - SIMULATION_CONFIG.talentDefenseScale * (homeTalent.defense - SIMULATION_CONFIG.talentBaseline)
    + starModifier(awayTalent.starPower)
    + awayFit.modifier
    + formModifier(awayPlayers, regulationAwaySeconds)
    + moraleEfficiencyModifier(awayPlayers, regulationAwaySeconds)
    + SIMULATION_CONFIG.awayOrtgModifier
    + awayEfficiencyRng.normalLike(SIMULATION_CONFIG.efficiencyNoiseSd * noiseScale);

  let homeScore = Math.max(SIMULATION_CONFIG.scoring.minimumTeamScore, Math.round(pace * homeOrtg / 100));
  let awayScore = Math.max(SIMULATION_CONFIG.scoring.minimumTeamScore, Math.round(pace * awayOrtg / 100));
  let overtimePeriods = 0;
  while (homeScore === awayScore) {
    overtimePeriods += 1;
    const overtimeRng = createRng(stableHash(gameSeed, "overtime", overtimePeriods));
    homeScore += Math.max(SIMULATION_CONFIG.scoring.overtimePointsMinimum, Math.round(SIMULATION_CONFIG.scoring.overtimePointsBase + overtimeRng.normalLike(SIMULATION_CONFIG.scoring.overtimePointsNoise)));
    awayScore += Math.max(SIMULATION_CONFIG.scoring.overtimePointsMinimum, Math.round(SIMULATION_CONFIG.scoring.overtimePointsBase + overtimeRng.normalLike(SIMULATION_CONFIG.scoring.overtimePointsNoise)));
  }
  const scoreMargin = Math.abs(homeScore - awayScore);
  const homeSeconds = addOvertimeSeconds(applyGarbageTimeMinutes(regulationHomeSeconds, homePlayers, scoreMargin, overtimePeriods), homePlayers, overtimePeriods);
  const awaySeconds = addOvertimeSeconds(applyGarbageTimeMinutes(regulationAwaySeconds, awayPlayers, scoreMargin, overtimePeriods), awayPlayers, overtimePeriods);
  const homeBoxScore = buildTeamBoxScore(homeTeam.id, homePlayers, homeSeconds, homeScore, pace, stableHash(gameSeed, "home_boxscore"));
  const awayBoxScore = buildTeamBoxScore(awayTeam.id, awayPlayers, awaySeconds, awayScore, pace, stableHash(gameSeed, "away_boxscore"));
  const injuryEvents = generateGameInjuries(game, homeBoxScore, awayBoxScore, players, seasonSeed);
  const periods = 4 + overtimePeriods;
  const homePeriodScores = splitPeriodScores(homeScore, periods, stableHash(gameSeed, "home-periods"));
  const awayPeriodScores = splitPeriodScores(awayScore, periods, stableHash(gameSeed, "away-periods"));

  return {
    gameId: game.id,
    date: game.date,
    homeTeamId: homeTeam.id,
    awayTeamId: awayTeam.id,
    homeScore,
    awayScore,
    winnerTeamId: homeScore > awayScore ? homeTeam.id : awayTeam.id,
    overtimePeriods,
    homePeriodScores,
    awayPeriodScores,
    homeBoxScore,
    awayBoxScore,
    injuryEvents,
  };
}
