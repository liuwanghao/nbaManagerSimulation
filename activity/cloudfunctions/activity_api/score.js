"use strict";

// Keep these values aligned with BALANCE_CONFIG in src/config/balanceConfig.ts.
const REWARDS = Object.freeze({
  EXPANSION_COMPLETE: 25, FIRST_WIN: 10, TEN_WINS: 15, TWENTY_FIVE_WINS: 20,
  FIFTY_CAREER_WINS: 30, HUNDRED_WINS: 50, TWO_HUNDRED_WINS: 80,
  FIRST_PLAY_IN: 15, FIRST_PLAYOFFS: 25, FIRST_SERIES_WIN: 40,
  TWO_SERIES_WINS: 50, THREE_SERIES_WINS: 70, CONFERENCE_FINALS: 60,
  FINALS_APPEARANCE: 80, FIRST_CHAMPIONSHIP: 150, SECOND_CHAMPIONSHIP: 180,
  THIRD_CHAMPIONSHIP: 250, THIRTY_WIN_SEASON: 20, FORTY_WIN_SEASON: 25,
  FIFTY_WIN_SEASON: 30, SIXTY_WIN_SEASON: 50, HOMEGROWN_ALL_STAR: 35,
  ROOKIE_OF_YEAR: 40, MVP_WINNER: 80, DPOY_WINNER: 60,
  MOST_IMPROVED_WINNER: 40, SIXTH_MAN_WINNER: 40, DYNASTY_TWO_OF_THREE: 200,
});
const SEASON_POINTS = Object.freeze({
  playoffs: 100, seriesWin: 150, conferenceFinals: 250, finals: 400,
  championship: 1000, eliteSeasonWins: 60, eliteSeason: 300,
});

function badProof(message = "成绩记录不完整或不合理，请返回游戏后重试") {
  const error = new Error(message);
  error.statusCode = 400;
  throw error;
}

function record(value, max, complete = false) {
  if (!value || typeof value !== "object" || Array.isArray(value)) badProof();
  const { wins, losses } = value;
  if (!Number.isInteger(wins) || !Number.isInteger(losses) || wins < 0 || losses < 0 || wins + losses > max || (complete && wins + losses !== max)) badProof();
  return wins;
}

function validateScoreProof(proof) {
  if (!proof || typeof proof !== "object" || proof.version !== 1 || !Array.isArray(proof.seasons)
    || proof.seasons.length > 100 || !Array.isArray(proof.achievements)
    || !Number.isSafeInteger(proof.score) || proof.score < 0 || proof.score > 1000000) badProof();
  if (proof.achievements.length > Object.keys(REWARDS).length || new Set(proof.achievements).size !== proof.achievements.length
    || proof.achievements.some((id) => !Object.hasOwn(REWARDS, id))) badProof();

  const seen = new Set();
  let seasonPoints = 0;
  let careerWins = 0;
  let bestWins = 0;
  let maxSeries = 0;
  let titles = 0;
  const titleYears = [];
  const flags = { enteredPlayIn: false, enteredPlayoffs: false, conferenceFinals: false, finalsAppearance: false };
  for (const season of proof.seasons) {
    if (typeof season.seasonId !== "string" || !/^\d{4}-\d{2}$/.test(season.seasonId) || seen.has(season.seasonId)) badProof();
    seen.add(season.seasonId);
    const wins = record(season, 82, true);
    careerWins += wins;
    bestWins = Math.max(bestWins, wins);
    if (!Number.isInteger(season.seriesWins) || season.seriesWins < 0 || season.seriesWins > 4
      || !Number.isInteger(season.playoffWins) || season.playoffWins < 0 || season.playoffWins > 16
      || !Number.isInteger(season.playoffLosses) || season.playoffLosses < 0 || season.playoffLosses > 16) badProof();
    for (const key of ["enteredPlayIn", "enteredPlayoffs", "conferenceFinals", "finalsAppearance", "champion"]) {
      if (typeof season[key] !== "boolean") badProof();
    }
    if ((season.seriesWins > 0 && !season.enteredPlayoffs)
      || (season.conferenceFinals && (!season.enteredPlayoffs || season.seriesWins < 2))
      || (season.finalsAppearance && (!season.conferenceFinals || season.seriesWins < 3))
      || (season.champion && (!season.finalsAppearance || season.seriesWins !== 4))) badProof();
    maxSeries = Math.max(maxSeries, season.seriesWins);
    for (const key of Object.keys(flags)) flags[key] ||= season[key];
    if (season.champion) { titles++; titleYears.push(Number(season.seasonId.slice(0, 4))); }
    if (season.enteredPlayoffs) seasonPoints += SEASON_POINTS.playoffs;
    if (season.seriesWins >= 1) seasonPoints += SEASON_POINTS.seriesWin;
    if (season.conferenceFinals) seasonPoints += SEASON_POINTS.conferenceFinals;
    if (season.finalsAppearance) seasonPoints += SEASON_POINTS.finals;
    if (season.champion) seasonPoints += SEASON_POINTS.championship;
    if (wins >= SEASON_POINTS.eliteSeasonWins) seasonPoints += SEASON_POINTS.eliteSeason;
  }
  if (proof.current !== null) {
    careerWins += record(proof.current, 82);
    bestWins = Math.max(bestWins, proof.current.wins);
  }
  const achieved = new Set(proof.achievements);
  const thresholds = {
    FIRST_WIN: careerWins >= 1, TEN_WINS: careerWins >= 10, TWENTY_FIVE_WINS: careerWins >= 25,
    FIFTY_CAREER_WINS: careerWins >= 50, HUNDRED_WINS: careerWins >= 100, TWO_HUNDRED_WINS: careerWins >= 200,
    THIRTY_WIN_SEASON: bestWins >= 30, FORTY_WIN_SEASON: bestWins >= 40,
    FIFTY_WIN_SEASON: bestWins >= 50, SIXTY_WIN_SEASON: bestWins >= 60,
    FIRST_PLAY_IN: flags.enteredPlayIn, FIRST_PLAYOFFS: flags.enteredPlayoffs,
    FIRST_SERIES_WIN: maxSeries >= 1, TWO_SERIES_WINS: maxSeries >= 2,
    THREE_SERIES_WINS: maxSeries >= 3, CONFERENCE_FINALS: flags.conferenceFinals,
    FINALS_APPEARANCE: flags.finalsAppearance, FIRST_CHAMPIONSHIP: titles >= 1,
    SECOND_CHAMPIONSHIP: titles >= 2, THIRD_CHAMPIONSHIP: titles >= 3,
    DYNASTY_TWO_OF_THREE: titleYears.some((year) => titleYears.filter((other) => other >= year && other < year + 3).length >= 2),
  };
  for (const [id, valid] of Object.entries(thresholds)) if (achieved.has(id) && !valid) badProof();
  if (achieved.has("EXPANSION_COMPLETE") && !proof.current && proof.seasons.length === 0) badProof();

  const score = seasonPoints + proof.achievements.reduce((total, id) => total + REWARDS[id], 0);
  if (score !== proof.score) badProof("王朝积分与赛季记录不一致，请返回游戏后重试");
  return score;
}

module.exports = { REWARDS, SEASON_POINTS, validateScoreProof };
