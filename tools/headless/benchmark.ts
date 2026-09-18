import { performance } from "node:perf_hooks";
import { advanceSeason, createCareer } from "../../src/game/season/career";
import { validateSchedule } from "../../src/game/schedule/schedule";
import type { GameResult, GameState, TeamBoxScore } from "../../src/game/state/types";
import { encodeStoredString } from "../../src/platform/storage/StorageAdapter";

function numericArgument(name: string, fallback: number): number {
  const index = process.argv.indexOf(name);
  return index >= 0 ? Number(process.argv[index + 1]) : fallback;
}

const requestedEquivalents = Math.max(1, Math.floor(numericArgument("--season-equivalents", 10)));
const seasonsPerCareer = Math.max(1, Math.floor(numericArgument("--seasons-per-career", 30)));
const progressEvery = Math.max(1, Math.floor(numericArgument("--progress-every", 10)));

function validateBox(box: TeamBoxScore, game: GameResult): void {
  const sum = (key: keyof Omit<TeamBoxScore["playerStats"][number], "playerId">): number => box.playerStats.reduce((total, stat) => total + stat[key], 0);
  if (sum("pts") !== box.score || box.totals.pts !== box.score) throw new Error(`${game.gameId}: box-score points do not reconcile`);
  if (sum("seconds") !== (240 + game.overtimePeriods * 25) * 60) throw new Error(`${game.gameId}: team minutes do not reconcile`);
  for (const stat of box.playerStats) {
    if (stat.fgm > stat.fga || stat.threePm > stat.threePa || stat.threePm > stat.fgm || stat.ftm > stat.fta) throw new Error(`${game.gameId}: invalid shooting line`);
    if (2 * (stat.fgm - stat.threePm) + 3 * stat.threePm + stat.ftm !== stat.pts) throw new Error(`${game.gameId}: player points do not reconcile`);
  }
}

function validateCompletedSeason(state: GameState, expectedSeasonId: string): void {
  const archive = state.history.seasons.find((season) => season.seasonId === expectedSeasonId);
  if (!archive) throw new Error(`${expectedSeasonId}: missing season archive`);
  if (archive.regularSeasonResults.length !== 1312) throw new Error(`${expectedSeasonId}: expected 1312 regular-season games`);
  if (Object.keys(archive.userRegularGameDetails).length !== 82) throw new Error(`${expectedSeasonId}: expected 82 user game details`);
  for (const standing of Object.values(archive.standings)) if (standing.wins + standing.losses !== 82) throw new Error(`${expectedSeasonId}: invalid standing total`);
  const rosterIds = Object.values(state.teams).flatMap((team) => team.playerIds);
  if (new Set(rosterIds).size !== rosterIds.length) throw new Error(`${expectedSeasonId}: duplicate active roster ownership`);
  if (Object.values(state.players).some((player) => Object.values(player.attributes).some((rating) => !Number.isFinite(rating) || rating < 25 || rating > 99))) {
    throw new Error(`${expectedSeasonId}: invalid player attribute`);
  }
  for (const game of [...Object.values(archive.userRegularGameDetails), ...Object.values(archive.postseasonGameDetails)]) {
    if (!game.homeBoxScore || !game.awayBoxScore) throw new Error(`${game.gameId}: missing required full box score`);
    validateBox(game.homeBoxScore, game);
    validateBox(game.awayBoxScore, game);
  }
  const scheduleReport = validateSchedule(state.schedule, state.teams);
  if (!scheduleReport.valid) throw new Error(`${state.league.seasonId}: ${scheduleReport.errors.join("; ")}`);
  const capNumbers = [
    ...state.capState.capHolds.map((entry) => entry.amount),
    ...state.capState.deadMoney.flatMap((entry) => Object.values(entry.salaryBySeason)),
    ...state.capState.offerReservations.map((entry) => entry.amount),
    ...(state.capState.emergencySalaryCharges ?? []).map((entry) => entry.amount),
  ];
  if (capNumbers.some((amount) => !Number.isFinite(amount) || amount < 0)) throw new Error(`${expectedSeasonId}: invalid cap ledger amount`);
}

const startedAt = performance.now();
let completed = 0;
let careers = 0;
let postseasonGames = 0;
let hallOfFamers = 0;
let lastProgressAt = startedAt;
let maxSaveBytes = 0;
let maxStoredBytes = 0;
let minHeapBytes = Number.POSITIVE_INFINITY;
let maxHeapBytes = 0;
let rookieInflow = 0;
let retirementOutflow = 0;
let maxFreeAgents = 0;
const championDistribution: Record<string, number> = {};
const overallSamples: number[] = [];

while (completed < requestedEquivalents) {
  const seed = `benchmark-${careers}`;
  let state = createCareer(seed);
  careers += 1;
  for (let seasonIndex = 0; seasonIndex < seasonsPerCareer && completed < requestedEquivalents; seasonIndex += 1) {
    const seasonId = state.league.seasonId;
    state = advanceSeason(state);
    validateCompletedSeason(state, seasonId);
    const archive = state.history.seasons.find((season) => season.seasonId === seasonId) as GameState["history"]["seasons"][number];
    postseasonGames += Object.keys(archive.postseasonGameDetails).length;
    hallOfFamers = Object.values(state.players).filter((player) => player.career?.hallOfFame).length;
    const champion = archive.championTeamId;
    championDistribution[champion] = (championDistribution[champion] ?? 0) + 1;
    rookieInflow += state.playerLifecycle?.rookieInflow ?? 0;
    retirementOutflow += state.playerLifecycle?.retirementOutflow ?? 0;
    maxFreeAgents = Math.max(maxFreeAgents, Object.values(state.players).filter((player) => player.teamId === "FREE_AGENT").length);
    const serializedState = JSON.stringify(state);
    maxSaveBytes = Math.max(maxSaveBytes, Buffer.byteLength(serializedState, "utf8"));
    maxStoredBytes = Math.max(maxStoredBytes, Buffer.byteLength(await encodeStoredString(serializedState), "utf8"));
    const heap = process.memoryUsage().heapUsed;
    minHeapBytes = Math.min(minHeapBytes, heap);
    maxHeapBytes = Math.max(maxHeapBytes, heap);
    overallSamples.push(...Object.values(state.players).filter((player) => !player.career?.retirementSeason).map((player) => Object.values(player.attributes).reduce((sum, value) => sum + value, 0) / 8));
    completed += 1;
    if (completed % progressEvery === 0 || completed === requestedEquivalents) {
      const now = performance.now();
      process.stderr.write(`[benchmark] ${completed}/${requestedEquivalents} · last ${Math.round(now - lastProgressAt)}ms\n`);
      lastProgressAt = now;
    }
  }
}

const durationMs = Math.round(performance.now() - startedAt);
console.log(JSON.stringify({
  requestedSeasonEquivalents: requestedEquivalents,
  completedSeasonEquivalents: completed,
  careers,
  seasonsPerCareer,
  durationMs,
  averageMsPerSeason: Math.round(durationMs / completed),
  postseasonGames,
  hallOfFamersInLastCareer: hallOfFamers,
  rookieInflow,
  retirementOutflow,
  maxFreeAgents,
  overallDistribution: {
    average: Number((overallSamples.reduce((sum, value) => sum + value, 0) / Math.max(1, overallSamples.length)).toFixed(2)),
    players90Plus: overallSamples.filter((value) => value >= 90).length,
    maximum: Number(Math.max(...overallSamples).toFixed(2)),
  },
  championDistribution,
  maxSaveBytes,
  maxSaveMegabytes: Number((maxSaveBytes / 1024 / 1024).toFixed(2)),
  maxStoredBytes,
  maxStoredMegabytes: Number((maxStoredBytes / 1024 / 1024).toFixed(2)),
  heapGrowthBytes: Math.max(0, maxHeapBytes - minHeapBytes),
  severeConsistencyErrors: 0,
}, null, 2));
