const assert = require("node:assert/strict");
const test = require("node:test");
const { REWARDS, SEASON_POINTS, validateScoreProof } = require("./score");

function season(overrides = {}) {
  return {
    seasonId: "2025-26", wins: 50, losses: 32,
    enteredPlayIn: false, enteredPlayoffs: true, seriesWins: 1,
    conferenceFinals: false, finalsAppearance: false, champion: false,
    playoffWins: 4, playoffLosses: 2, ...overrides,
  };
}

test("server recomputes dynasty score instead of trusting the claimed number", () => {
  const proof = {
    version: 1, score: 100 + 150 + 25 + 10 + 15 + 20 + 25 + 40 + 20 + 25 + 30,
    seasons: [season()], current: { wins: 0, losses: 0 },
    achievements: ["EXPANSION_COMPLETE", "FIRST_WIN", "TEN_WINS", "TWENTY_FIVE_WINS", "FIRST_PLAYOFFS", "FIRST_SERIES_WIN", "THIRTY_WIN_SEASON", "FORTY_WIN_SEASON", "FIFTY_WIN_SEASON"],
  };
  assert.equal(validateScoreProof(proof), proof.score);
  assert.throws(() => validateScoreProof({ ...proof, score: proof.score + 1 }), /王朝积分/);
  assert.throws(() => validateScoreProof({ ...proof, achievements: [...proof.achievements, "FIRST_CHAMPIONSHIP"] }), /不合理/);
  assert.throws(() => validateScoreProof({ ...proof, seasons: [season({ wins: 83, losses: -1 })] }), /不合理/);
});

test("duplicate seasons and achievements are rejected", () => {
  const proof = { version: 1, score: 0, seasons: [], current: { wins: 0, losses: 0 }, achievements: [] };
  assert.equal(validateScoreProof(proof), 0);
  assert.throws(() => validateScoreProof({ ...proof, achievements: ["FIRST_WIN", "FIRST_WIN"] }), /不合理/);
  assert.throws(() => validateScoreProof({ ...proof, seasons: [season(), season()] }), /不合理/);
});

test("server constants track game balance config", async () => {
  const { BALANCE_CONFIG } = await import("../../../src/config/balanceConfig.ts");
  for (const [id, points] of Object.entries(REWARDS)) assert.equal(BALANCE_CONFIG.achievements[id].reward.dynastyScore, points, id);
  assert.deepEqual(BALANCE_CONFIG.dynastyScore, SEASON_POINTS);
});

test("a real career produces a proof accepted by the server", async () => {
  const { createCareer } = await import("../../../src/game/season/career.ts");
  const { evaluateRegularSeasonAchievements } = await import("../../../src/game/career/AchievementService.ts");
  const { saveLeaderboardProof } = await import("../../../src/app/leaderboardProof.ts");
  const state = createCareer("leaderboard-proof");
  state.standings[state.userTeamId].wins = 50;
  state.standings[state.userTeamId].losses = 32;
  evaluateRegularSeasonAchievements(state);
  let saved;
  globalThis.sessionStorage = { setItem: (_key, value) => { saved = value; } };
  try { saveLeaderboardProof(state); } finally { delete globalThis.sessionStorage; }
  const proof = JSON.parse(saved);
  assert.equal(validateScoreProof(proof), state.gmCareer.dynastyScore);
});
