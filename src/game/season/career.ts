import { createFixtureDataset } from "../../data/fixture";
import { createFutureDraftPicks } from "../../data/draftPicks";
import { BALANCE_CONFIG } from "../../config/balanceConfig";
import { GAME_CONFIG } from "../../config/gameConfig";
import { LEAGUE_FINANCE_CONFIG } from "../../config/leagueFinance";
import { stableHash } from "../random/hash";
import { assertPhaseAllowed } from "../policy/TransactionPolicyService";
import { runAiTradeEvaluation } from "../trade/AITradeService";
import { advanceFreeAgencyDay } from "../freeAgency/FreeAgencyService";
import { finalizeOptionPhase, resolveTeamOption, rolloverLeagueYear, shouldPickUpTeamOption } from "../contracts/ContractLifecycleService";
import { lockOpeningRoster, waivePlayer } from "../roster/RosterService";
import { draftPlayer, executeDraftCommand, fastForwardRookieDraft, getAvailableDraftProspects, prepareRookieDraft } from "../draft/DraftService";
import { publicPlayerValue } from "../ai/AIValueService";
import { finalizeFinalsAwards, finalizeRegularSeasonAwards } from "../awards/AwardsService";
import { generateSchedule, validateSchedule } from "../schedule/schedule";
import { simulateGame } from "../simulation/simulateGame";
import { consumePlayoffCoachingForGame, consumeRegularCoachingForGame, nextPlayoffUserGame } from "../coaching/CoachingService";
import { advanceInjuriesByDays, applyInjuryEvents, availablePlayerCount, recordInjuryMissedGames } from "../simulation/injuries";
import {
  chargeEmergencySalariesAtRosterLock,
  fillEmergencyRoster,
  prepareEmergencyRostersForDay,
} from "../injuries/EmergencyRosterService";
import {
  createAchievementState,
  createGmCareerState,
  evaluatePostseasonAchievements,
  evaluateRegularSeasonAchievements,
  rebuildGmCareerFromHistory,
} from "../career/AchievementService";
import { createFranchiseStatsState, recordFranchiseRegularGame } from "../career/FranchiseStats";
import { blockingEvent, createEventState, enqueueAfterUserGameEvents, enqueueCareerMilestoneEvents, enqueueEvent, nextPendingEvent, resolveAllEvents } from "../events/EventService";
import { applyFanSupportAfterGame, applySeasonTeamCoreUpdate, type PostseasonTeamMilestone } from "../team/TeamSystemService";
import { applyPlayerStatusAfterGame, recoverFatigueBeforeGameDay, recoverFatigueForRestDays } from "../simulation/PlayerStatusService";
import { createAiTeamProfiles } from "../ai/AIManagementService";
import { applyResultToStandings, resolveConferenceStandings } from "../standings/standings";
import { applyRotationPlanToPlayers, buildDefaultRotationPlan } from "../roster/RotationPlanService";
import {
  emptyPlayerSeasonStats,
  emptyStanding,
  type GameResult,
  type GameState,
  type InjuryEvent,
  type PlayerBoxScore,
  type PostseasonSeries,
  type ScheduleGame,
  type StandingRecord,
} from "../state/types";

const seasonLabel = (year: number): string => `${year}-${String((year + 1) % 100).padStart(2, "0")}`;
const openingDateForYear = (year: number): string => `${year}-10-20`;

export function createCareer(careerSeed: string, userTeamId = "SEA"): GameState {
  const fixture = createFixtureDataset(careerSeed);
  const seasonYear = 2026;
  const seasonId = seasonLabel(seasonYear);
  const seasonSeed = stableHash(careerSeed, "season", seasonId);
  const schedule = generateSchedule(fixture.teams, seasonId, openingDateForYear(seasonYear), 0, stableHash(seasonSeed, "schedule"));
  const report = validateSchedule(schedule, fixture.teams);
  if (!report.valid) throw new Error(`Generated invalid schedule: ${report.errors.join("; ")}`);
  const state: GameState = {
    meta: {
      schemaVersion: 18,
      gameVersion: "0.1.0",
      dataVersion: "fixture.2026.offseason.manager-core.v18",
      generatorVersion: 1,
      configVersion: GAME_CONFIG.version,
      prngAlgorithm: "xoshiro128ss-v1",
      hashAlgorithm: "fnv1a64-utf8-v1",
    },
    seeds: { careerSeed, seasonSeed },
    league: { currentPhase: "REGULAR_SEASON", seasonYear, seasonId },
    calendar: { currentDateIndex: 0, openingDate: openingDateForYear(seasonYear), finalDateIndex: 173 },
    userTeamId,
    scheduleCycleYear: 0,
    teams: fixture.teams,
    players: fixture.players,
    schedule,
    standings: Object.fromEntries(Object.keys(fixture.teams).map((teamId) => [teamId, emptyStanding(teamId)])),
    lightweightResults: [],
    userGameDetails: {},
    coaching: { seasonId, usedPlayoffRounds: [] },
    franchiseStats: createFranchiseStatsState(),
    history: { champions: [], retiredPlayerIds: [], rebornHistoricalSourceIds: [], seasonAwards: [], seasons: [] },
    achievements: createAchievementState(),
    gmCareer: createGmCareerState(),
    eventState: createEventState(),
    teamNotifications: [],
    draftPicks: createFutureDraftPicks(fixture.teams),
    capState: { capHolds: [], deadMoney: [], offerReservations: [], emergencySalaryCharges: [] },
    tradeInquiryCount: {},
    tradeDesk: { offers: [] },
    aiTradeState: { evaluationCounter: 0, completedByTeamSeason: {}, transactionLog: [] },
    aiTeamProfiles: createAiTeamProfiles(Object.keys(fixture.teams), careerSeed, seasonYear),
    trainingPlan: { seasonId, assignments: {} },
    injuryState: { recentEvents: [] },
    commandReceipts: {},
  };
  for (const team of Object.values(state.teams)) {
    const players = team.playerIds.map((id) => state.players[id]).filter(Boolean);
    if (players.length < BALANCE_CONFIG.rotationPlan.minimumActivePlayers) continue;
    team.rotationPlan = buildDefaultRotationPlan(players);
    applyRotationPlanToPlayers(players, team.rotationPlan);
  }
  return state;
}

export function createExpansionCareer(careerSeed: string): GameState {
  const state = createCareer(careerSeed, "SEA");
  state.meta.schemaVersion = 18;
  state.meta.gameVersion = "0.5.0";
  state.meta.dataVersion = "fixture.2026.expansion-manager-core.v18";
  state.league.currentPhase = "TEAM_CREATION";
  state.schedule = [];
  state.lightweightResults = [];
  state.userGameDetails = {};
  state.calendar.currentDateIndex = 0;
  for (const expansionTeamId of ["SEA", "LVG"] as const) {
    for (const playerId of state.teams[expansionTeamId].playerIds) delete state.players[playerId];
    state.teams[expansionTeamId].playerIds = [];
    delete state.teams[expansionTeamId].rotationPlan;
  }
  return state;
}

function aggregatePlayerGame(state: GameState, stat: PlayerBoxScore): void {
  const season = state.players[stat.playerId].seasonStats;
  for (const key of Object.keys(season) as Array<keyof typeof season>) season[key] += stat[key];
}

function aggregatePlayerPostseasonGame(state: GameState, stat: PlayerBoxScore): void {
  const postseason = state.players[stat.playerId].postseasonStats ??= emptyPlayerSeasonStats();
  for (const key of Object.keys(postseason) as Array<keyof typeof postseason>) postseason[key] += stat[key];
}

function commitGameResult(state: GameState, game: ScheduleGame, result: GameResult): void {
  game.status = "FINAL";
  game.homeScore = result.homeScore;
  game.awayScore = result.awayScore;
  game.winnerTeamId = result.winnerTeamId;
  applyResultToStandings(state.standings, state.teams, result);
  applyFanSupportAfterGame(state, result);
  evaluateRegularSeasonAchievements(state);
  result.homeBoxScore?.playerStats.forEach((stat) => aggregatePlayerGame(state, stat));
  result.awayBoxScore?.playerStats.forEach((stat) => aggregatePlayerGame(state, stat));
  const {
    homeBoxScore: _homeBoxScore,
    awayBoxScore: _awayBoxScore,
    injuryEvents: _injuryEvents,
    homePeriodScores: _homePeriodScores,
    awayPeriodScores: _awayPeriodScores,
    ...lightweightResult
  } = result;
  state.lightweightResults.push(lightweightResult);
  if (game.homeTeamId === state.userTeamId || game.awayTeamId === state.userTeamId) {
    recordFranchiseRegularGame(state, result);
    state.userGameDetails[game.id] = result;
    enqueueAfterUserGameEvents(state);
  }
  for (const teamId of [game.homeTeamId, game.awayTeamId]) {
    for (const playerId of state.teams[teamId].playerIds) {
      const player = state.players[playerId];
      if (player?.contract.status === "STANDARD" && player.contract.contractType !== "EMERGENCY") {
        player.serviceRosterDays = (player.serviceRosterDays ?? 0) + 1;
      }
    }
  }
}

function cloneForLeagueDay(input: GameState): GameState {
  const { history, ...mutableState } = input;
  return { ...structuredClone(mutableState), history } as GameState;
}

export function simulateLeagueDay(
  input: GameState,
  dateIndex = input.calendar.currentDateIndex,
  options: { mutate?: boolean } = {},
): GameState {
  assertPhaseAllowed(input, "Simulate league day", ["REGULAR_SEASON", "REGULAR_PRE_DEADLINE", "REGULAR_POST_DEADLINE"]);
  if (input.injuryState.pendingUserMajorInjury) throw new Error("MAJOR_INJURY_ACK_REQUIRED");
  if (input.injuryState.pendingEmergencyRoster) return input;
  if (blockingEvent(input)) return input;
  // Completed-season archives are immutable during a regular-season day. Reusing that branch avoids
  // repeatedly cloning years of historical box scores on every one of the 174 calendar ticks.
  const state = options.mutate ? input : cloneForLeagueDay(input);
  if (dateIndex === BALANCE_CONFIG.ai.tradeDeadlineDateIndex) {
    enqueueEvent(state, "trade_deadline_001", {}, `${state.league.seasonId}:D${dateIndex}:START`);
    if (blockingEvent(state)) return state;
  }
  const games = state.schedule
    .filter((game) => game.dateIndex === dateIndex && game.status === "SCHEDULED")
    .sort((a, b) => a.id.localeCompare(b.id));
  const participatingTeamIds = games.flatMap((game) => [game.homeTeamId, game.awayTeamId]);
  const backToBackTeamIds = new Set([...new Set(participatingTeamIds)].filter((teamId) => state.schedule.some((game) => game.status === "FINAL" && game.dateIndex === dateIndex - 1 && (game.homeTeamId === teamId || game.awayTeamId === teamId))));
  recoverFatigueBeforeGameDay(state, participatingTeamIds, dateIndex);
  prepareEmergencyRostersForDay(state, participatingTeamIds);
  if (state.injuryState.pendingEmergencyRoster) return state;
  for (const teamId of new Set(participatingTeamIds)) {
    if (availablePlayerCount(state, teamId) < LEAGUE_FINANCE_CONFIG.rosterLimits.hardPlayableMinimum) throw new Error(`${teamId}: EMERGENCY_HARD_BLOCK`);
  }
  chargeEmergencySalariesAtRosterLock(state, participatingTeamIds, dateIndex);
  const injuryEvents: InjuryEvent[] = [];
  for (const game of games) {
    const coaching = consumeRegularCoachingForGame(state, game);
    const result = simulateGame(
      game,
      state.teams[game.homeTeamId],
      state.teams[game.awayTeamId],
      state.players,
      state.seeds.seasonSeed,
      false,
      coaching,
    );
    applyPlayerStatusAfterGame(state, [result.homeBoxScore, result.awayBoxScore], backToBackTeamIds);
    commitGameResult(state, game, result);
    injuryEvents.push(...(result.injuryEvents ?? []));
  }
  recordInjuryMissedGames(state, participatingTeamIds);
  advanceInjuriesByDays(state, 1);
  applyInjuryEvents(state, injuryEvents);
  state.calendar.currentDateIndex = Math.min(state.calendar.finalDateIndex, dateIndex + 1);
  let next = state;
  if (dateIndex <= BALANCE_CONFIG.ai.tradeDeadlineDateIndex && state.league.currentPhase !== "REGULAR_POST_DEADLINE") {
    next = runAiTradeEvaluation(state, dateIndex, { mutate: options.mutate });
  }
  if (dateIndex >= BALANCE_CONFIG.ai.tradeDeadlineDateIndex) next.league.currentPhase = "REGULAR_POST_DEADLINE";
  else if (next.league.currentPhase === "REGULAR_SEASON") next.league.currentPhase = "REGULAR_PRE_DEADLINE";
  const advanced = advanceFreeAgencyDay(next, { mutate: true });
  // The final regular-season day fixes the awards before the player enters the
  // postseason. finalizeRegularSeasonAwards is idempotent for a settled season.
  return advanced.schedule.every((game) => game.status === "FINAL")
    ? finalizeRegularSeasonAwards(advanced)
    : advanced;
}

export function simulateNextGameDay(input: GameState): GameState {
  assertPhaseAllowed(input, "Simulate next game day", ["REGULAR_SEASON", "REGULAR_PRE_DEADLINE", "REGULAR_POST_DEADLINE"]);
  const nextUserDate = input.schedule
    .filter((game) => game.status === "SCHEDULED"
      && game.dateIndex >= input.calendar.currentDateIndex
      && (game.homeTeamId === input.userTeamId || game.awayTeamId === input.userTeamId))
    .reduce((minimum, game) => Math.min(minimum, game.dateIndex), Number.POSITIVE_INFINITY);
  if (!Number.isFinite(nextUserDate)) return input;
  if (blockingEvent(input) || input.injuryState.pendingUserMajorInjury || input.injuryState.pendingEmergencyRoster) return input;
  let state = cloneForLeagueDay(input);
  for (let dateIndex = input.calendar.currentDateIndex; dateIndex <= nextUserDate; dateIndex += 1) {
    const next = simulateLeagueDay(state, dateIndex, { mutate: true });
    if (blockingEvent(next) || next.injuryState.pendingUserMajorInjury || next.injuryState.pendingEmergencyRoster) return next;
    state = next;
  }
  return state;
}

export function simulateToNextEvent(input: GameState): GameState {
  assertPhaseAllowed(input, "Simulate to next event", ["REGULAR_SEASON", "REGULAR_PRE_DEADLINE", "REGULAR_POST_DEADLINE"]);
  if (nextPendingEvent(input) || input.injuryState.pendingUserMajorInjury || input.injuryState.pendingEmergencyRoster) return input;
  let state = input;
  for (let gameCount = 0; gameCount < 82; gameCount += 1) {
    const next = simulateNextGameDay(state);
    if (next === state) return state;
    state = next;
    if (nextPendingEvent(state) || state.injuryState.pendingUserMajorInjury || state.injuryState.pendingEmergencyRoster) return state;
    if (state.schedule.every((game) => game.status === "FINAL")) return state;
  }
  return state;
}

function postseasonGame(
  state: GameState,
  homeTeamId: string,
  awayTeamId: string,
  label: string,
  gameNumber: number,
  dateOffset: number,
  scheduledGame?: ScheduleGame,
): GameResult {
  const game: ScheduleGame = scheduledGame ?? {
    id: stableHash(state.league.seasonId, "postseason", label, homeTeamId, awayTeamId, gameNumber),
    seasonId: state.league.seasonId,
    dateIndex: state.calendar.finalDateIndex + dateOffset,
    date: `POST-${String(dateOffset).padStart(3, "0")}`,
    homeTeamId,
    awayTeamId,
    matchupOrdinal: gameNumber,
    status: "SCHEDULED",
  };
  state.injuryState.lastProcessedDateIndexByTeam ??= {};
  for (const teamId of [homeTeamId, awayTeamId]) {
    const previousDate = state.injuryState.lastProcessedDateIndexByTeam[teamId] ?? state.calendar.finalDateIndex;
    advanceInjuriesByDays(state, Math.max(0, game.dateIndex - previousDate), [teamId]);
    state.injuryState.lastProcessedDateIndexByTeam[teamId] = game.dateIndex;
  }
  prepareEmergencyRostersForDay(state, [homeTeamId, awayTeamId]);
  if (state.injuryState.pendingEmergencyRoster?.teamId === state.userTeamId) fillEmergencyRoster(state, state.userTeamId);
  for (const teamId of [homeTeamId, awayTeamId]) {
    if (availablePlayerCount(state, teamId) < LEAGUE_FINANCE_CONFIG.rosterLimits.hardPlayableMinimum) throw new Error(`${teamId}: EMERGENCY_HARD_BLOCK`);
  }
  chargeEmergencySalariesAtRosterLock(state, [homeTeamId, awayTeamId], game.dateIndex);
  recoverFatigueForRestDays(state, [homeTeamId, awayTeamId], 1);
  const coaching = consumeRegularCoachingForGame(state, game) ?? consumePlayoffCoachingForGame(state, game);
  const result = simulateGame(game, state.teams[homeTeamId], state.teams[awayTeamId], state.players, state.seeds.seasonSeed, true, coaching);
  applyPlayerStatusAfterGame(state, [result.homeBoxScore, result.awayBoxScore], new Set());
  applyFanSupportAfterGame(state, result);
  result.homeBoxScore?.playerStats.forEach((stat) => aggregatePlayerPostseasonGame(state, stat));
  result.awayBoxScore?.playerStats.forEach((stat) => aggregatePlayerPostseasonGame(state, stat));
  recordInjuryMissedGames(state, [homeTeamId, awayTeamId]);
  applyInjuryEvents(state, result.injuryEvents ?? []);
  return result;
}

function playSeries(
  state: GameState,
  higherSeedId: string,
  lowerSeedId: string,
  label: string,
  startingOffset: number,
): { winner: string; games: GameResult[] } {
  const pattern = [higherSeedId, higherSeedId, lowerSeedId, lowerSeedId, higherSeedId, lowerSeedId, higherSeedId];
  const wins: Record<string, number> = { [higherSeedId]: 0, [lowerSeedId]: 0 };
  const games: GameResult[] = [];
  for (let index = 0; index < pattern.length && Math.max(...Object.values(wins)) < 4; index += 1) {
    const home = pattern[index];
    const away = home === higherSeedId ? lowerSeedId : higherSeedId;
    const result = postseasonGame(state, home, away, label, index + 1, startingOffset + index * 2);
    games.push(result);
    wins[result.winnerTeamId] += 1;
  }
  return { winner: wins[higherSeedId] === 4 ? higherSeedId : lowerSeedId, games };
}

function playInSeeds(
  state: GameState,
  standings: StandingRecord[],
  conference: string,
  offset: number,
): { seeds: string[]; games: GameResult[] } {
  const ids = standings.map((record) => record.teamId);
  const gameA = postseasonGame(state, ids[6], ids[7], `${conference}-PLAYIN-A`, 1, offset);
  const gameB = postseasonGame(state, ids[8], ids[9], `${conference}-PLAYIN-B`, 1, offset + 1);
  const gameALoser = gameA.winnerTeamId === ids[6] ? ids[7] : ids[6];
  const gameC = postseasonGame(state, gameALoser, gameB.winnerTeamId, `${conference}-PLAYIN-C`, 1, offset + 3);
  return { seeds: [...ids.slice(0, 6), gameA.winnerTeamId, gameC.winnerTeamId], games: [gameA, gameB, gameC] };
}

function conferenceChampion(
  state: GameState,
  seeds: string[],
  conference: string,
  offset: number,
): { winner: string; games: GameResult[]; seriesWinners: string[]; conferenceFinalists: string[] } {
  const firstRoundPairs: Array<[number, number]> = [[0, 7], [3, 4], [1, 6], [2, 5]];
  const firstRoundSeries = firstRoundPairs.map(([higher, lower], index) =>
    playSeries(state, seeds[higher], seeds[lower], `${conference}-R1-${index}`, offset + index * 16),
  );
  const semifinalA = playSeries(state, firstRoundSeries[0].winner, firstRoundSeries[1].winner, `${conference}-SF-A`, offset + 70);
  const semifinalB = playSeries(state, firstRoundSeries[2].winner, firstRoundSeries[3].winner, `${conference}-SF-B`, offset + 86);
  const conferenceFinal = playSeries(state, semifinalA.winner, semifinalB.winner, `${conference}-FINAL`, offset + 104);
  return {
    winner: conferenceFinal.winner,
    games: [...firstRoundSeries.flatMap((series) => series.games), ...semifinalA.games, ...semifinalB.games, ...conferenceFinal.games],
    seriesWinners: [...firstRoundSeries.map((series) => series.winner), semifinalA.winner, semifinalB.winner, conferenceFinal.winner],
    conferenceFinalists: [semifinalA.winner, semifinalB.winner],
  };
}

function archiveCompletedSeason(
  state: GameState,
  championTeamId: string,
  postseasonGames: GameResult[],
  userPostseason: GameState["history"]["seasons"][number]["userPostseason"],
  sevenEightLoserTeamIds: string[],
): void {
  const archive = {
    seasonId: state.league.seasonId,
    championTeamId,
    standings: Object.fromEntries(Object.entries(state.standings).map(([teamId, record]) => [teamId, { wins: record.wins, losses: record.losses }])),
    regularSeasonResults: structuredClone(state.lightweightResults),
    userRegularGameDetails: structuredClone(state.userGameDetails),
    postseasonGameDetails: Object.fromEntries(postseasonGames.map((game) => [game.gameId, structuredClone(game)])),
    lotteryContext: { sevenEightLoserTeamIds },
    userPostseason,
  };
  const existingIndex = state.history.seasons.findIndex((season) => season.seasonId === state.league.seasonId);
  if (existingIndex >= 0) state.history.seasons[existingIndex] = archive;
  else state.history.seasons.push(archive);
}

const postseasonRoundStart = { PLAY_IN: 2, R1: 10, SF: 30, CF: 50, FINALS: 70 } as const;
const postseasonHomePattern = [0, 0, 1, 1, 0, 1, 0] as const;

function postseasonDate(state: GameState, dateIndex: number): string {
  const opening = new Date(`${state.calendar.openingDate}T00:00:00.000Z`);
  opening.setUTCDate(opening.getUTCDate() + dateIndex);
  return opening.toISOString().slice(0, 10);
}

function scheduleSeriesGame(state: GameState, series: PostseasonSeries, dateIndex: number): void {
  const number = series.gameIds.length + 1;
  const home = postseasonHomePattern[number - 1] === 1 ? series.teamBId : series.teamAId;
  const away = home === series.teamAId ? series.teamBId : series.teamAId;
  const game: ScheduleGame = {
    id: stableHash(state.league.seasonId, "postseason-interactive", series.id, number),
    seasonId: state.league.seasonId,
    dateIndex,
    date: postseasonDate(state, dateIndex),
    homeTeamId: home,
    awayTeamId: away,
    matchupOrdinal: number,
    status: "SCHEDULED",
  };
  state.postseason!.schedule.push(game);
  state.postseason!.schedule.sort((left, right) => left.dateIndex - right.dateIndex || left.id.localeCompare(right.id));
  series.gameIds.push(game.id);
}

function addPostseasonSeries(
  state: GameState,
  id: string,
  conference: PostseasonSeries["conference"],
  round: PostseasonSeries["round"],
  teamAId: string,
  teamBId: string,
  dateIndex: number,
): void {
  const series: PostseasonSeries = {
    id, conference, round, teamAId, teamBId,
    winsA: 0, winsB: 0, bestOf: round === "PLAY_IN" ? 1 : 7, gameIds: [],
  };
  state.postseason!.series.push(series);
  scheduleSeriesGame(state, series, dateIndex);
}

function seriesById(state: GameState, id: string): PostseasonSeries | undefined {
  return state.postseason?.series.find((series) => series.id === id);
}

function higherSeedFirst(state: GameState, conference: "WEST" | "EAST", left: string, right: string): [string, string] {
  const seeds = state.postseason!.seeds[conference];
  return seeds.indexOf(left) < seeds.indexOf(right) ? [left, right] : [right, left];
}

function addConferenceSeries(state: GameState, conference: "WEST" | "EAST", round: "SF" | "CF", suffix: string, left: string, right: string): void {
  const [higher, lower] = higherSeedFirst(state, conference, left, right);
  addPostseasonSeries(state, `${conference}-${round === "CF" ? "FINAL" : `SF-${suffix}`}`, conference, round, higher, lower, state.calendar.finalDateIndex + postseasonRoundStart[round]);
}

function advancePostseasonBracket(state: GameState): void {
  const postseason = state.postseason!;
  for (const conference of ["WEST", "EAST"] as const) {
    const a = seriesById(state, `${conference}-PLAYIN-A`);
    const b = seriesById(state, `${conference}-PLAYIN-B`);
    if (a?.winnerTeamId && b?.winnerTeamId && !seriesById(state, `${conference}-PLAYIN-C`)) {
      const loserA = a.winnerTeamId === a.teamAId ? a.teamBId : a.teamAId;
      postseason.sevenEightLoserTeamIds.push(loserA);
      postseason.seeds[conference][6] = a.winnerTeamId;
      addPostseasonSeries(state, `${conference}-PLAYIN-C`, conference, "PLAY_IN", loserA, b.winnerTeamId, state.calendar.finalDateIndex + 5);
    }
    const c = seriesById(state, `${conference}-PLAYIN-C`);
    if (c?.winnerTeamId) postseason.seeds[conference][7] = c.winnerTeamId;
  }

  if (["WEST", "EAST"].every((conference) => Boolean(seriesById(state, `${conference}-PLAYIN-C`)?.winnerTeamId))
    && !seriesById(state, "WEST-R1-0")) {
    const pairs: Array<[number, number]> = [[0, 7], [3, 4], [1, 6], [2, 5]];
    for (const conference of ["WEST", "EAST"] as const) {
      pairs.forEach(([higher, lower], index) => addPostseasonSeries(
        state, `${conference}-R1-${index}`, conference, "R1", postseason.seeds[conference][higher], postseason.seeds[conference][lower],
        state.calendar.finalDateIndex + postseasonRoundStart.R1,
      ));
    }
    state.league.currentPhase = "PLAYOFFS";
  }

  if (postseason.series.filter((series) => series.round === "R1").length === 8
    && postseason.series.filter((series) => series.round === "R1").every((series) => series.winnerTeamId)
    && !seriesById(state, "WEST-SF-A")) {
    for (const conference of ["WEST", "EAST"] as const) {
      addConferenceSeries(state, conference, "SF", "A", seriesById(state, `${conference}-R1-0`)!.winnerTeamId!, seriesById(state, `${conference}-R1-1`)!.winnerTeamId!);
      addConferenceSeries(state, conference, "SF", "B", seriesById(state, `${conference}-R1-2`)!.winnerTeamId!, seriesById(state, `${conference}-R1-3`)!.winnerTeamId!);
    }
  }

  if (postseason.series.filter((series) => series.round === "SF").length === 4
    && postseason.series.filter((series) => series.round === "SF").every((series) => series.winnerTeamId)
    && !seriesById(state, "WEST-FINAL")) {
    for (const conference of ["WEST", "EAST"] as const) {
      addConferenceSeries(state, conference, "CF", "", seriesById(state, `${conference}-SF-A`)!.winnerTeamId!, seriesById(state, `${conference}-SF-B`)!.winnerTeamId!);
    }
  }

  const westChampion = seriesById(state, "WEST-FINAL")?.winnerTeamId;
  const eastChampion = seriesById(state, "EAST-FINAL")?.winnerTeamId;
  if (westChampion && eastChampion && !seriesById(state, "FINALS")) {
    const westRecord = state.standings[westChampion];
    const eastRecord = state.standings[eastChampion];
    const westHasHome = westRecord.wins > eastRecord.wins
      || (westRecord.wins === eastRecord.wins && westRecord.pointsFor - westRecord.pointsAgainst >= eastRecord.pointsFor - eastRecord.pointsAgainst);
    addPostseasonSeries(state, "FINALS", "FINALS", "FINALS", westHasHome ? westChampion : eastChampion, westHasHome ? eastChampion : westChampion, state.calendar.finalDateIndex + postseasonRoundStart.FINALS);
  }
}

export function isUserPostseasonQualified(state: GameState): boolean {
  const conference = state.teams[state.userTeamId]?.conference;
  if (!conference) return false;
  return resolveConferenceStandings(conference, state.standings, state.teams, state.seeds.seasonSeed)
    .slice(0, 10).some((record) => record.teamId === state.userTeamId);
}

export function isUserPostseasonEliminated(state: GameState): boolean {
  const conference = state.teams[state.userTeamId]?.conference;
  return Boolean(state.postseason?.series.some((series) => series.winnerTeamId && series.winnerTeamId !== state.userTeamId
    && (series.teamAId === state.userTeamId || series.teamBId === state.userTeamId)
    && series.id !== `${conference}-PLAYIN-A`));
}

export function enterPostseason(input: GameState): GameState {
  assertPhaseAllowed(input, "Enter postseason", ["REGULAR_SEASON", "REGULAR_PRE_DEADLINE", "REGULAR_POST_DEADLINE"]);
  if (input.schedule.some((game) => game.status !== "FINAL")) throw new Error("REGULAR_SEASON_NOT_COMPLETE");
  if (!isUserPostseasonQualified(input)) throw new Error("USER_NOT_POSTSEASON_QUALIFIED");
  const state = finalizeRegularSeasonAwards(input);
  const west = resolveConferenceStandings("WEST", state.standings, state.teams, state.seeds.seasonSeed);
  const east = resolveConferenceStandings("EAST", state.standings, state.teams, state.seeds.seasonSeed);
  state.postseason = {
    seasonId: state.league.seasonId,
    schedule: [], gameDetails: {}, series: [],
    seeds: { WEST: west.slice(0, 10).map((record) => record.teamId), EAST: east.slice(0, 10).map((record) => record.teamId) },
    sevenEightLoserTeamIds: [],
  };
  for (const conference of ["WEST", "EAST"] as const) {
    const ids = state.postseason.seeds[conference];
    addPostseasonSeries(state, `${conference}-PLAYIN-A`, conference, "PLAY_IN", ids[6], ids[7], state.calendar.finalDateIndex + postseasonRoundStart.PLAY_IN);
    addPostseasonSeries(state, `${conference}-PLAYIN-B`, conference, "PLAY_IN", ids[8], ids[9], state.calendar.finalDateIndex + postseasonRoundStart.PLAY_IN);
  }
  state.league.currentPhase = "PLAY_IN";
  return state;
}

function finalizeInteractivePostseason(state: GameState): void {
  const postseason = state.postseason!;
  const finals = seriesById(state, "FINALS")!;
  const champion = finals.winnerTeamId!;
  const games = postseason.schedule.map((game) => postseason.gameDetails[game.id]);
  state.history.champions.push({ seasonId: state.league.seasonId, teamId: champion });
  finalizeFinalsAwards(state, champion, finals.gameIds.map((id) => postseason.gameDetails[id]));
  const userConference = state.teams[state.userTeamId].conference;
  const userSeeds = postseason.seeds[userConference];
  const userSeries = postseason.series.filter((series) => series.teamAId === state.userTeamId || series.teamBId === state.userTeamId);
  const userPostseason = {
    enteredPlayIn: userSeeds.slice(6, 10).includes(state.userTeamId) || userSeries.some((series) => series.round === "PLAY_IN"),
    enteredPlayoffs: userSeeds.slice(0, 8).includes(state.userTeamId),
    seriesWins: userSeries.filter((series) => series.bestOf === 7 && series.winnerTeamId === state.userTeamId).length,
    conferenceFinals: userSeries.some((series) => series.round === "CF"),
    finalsAppearance: userSeries.some((series) => series.round === "FINALS"),
    champion: champion === state.userTeamId,
    playoffWins: games.filter((game) => game.winnerTeamId === state.userTeamId).length,
    playoffLosses: games.filter((game) => (game.homeTeamId === state.userTeamId || game.awayTeamId === state.userTeamId) && game.winnerTeamId !== state.userTeamId).length,
  };
  const milestones: Record<string, PostseasonTeamMilestone> = Object.fromEntries(Object.keys(state.teams).map((teamId) => {
    const teamSeries = postseason.series.filter((series) => series.teamAId === teamId || series.teamBId === teamId);
    return [teamId, {
      enteredPlayIn: teamSeries.some((series) => series.round === "PLAY_IN"),
      enteredPlayoffs: teamSeries.some((series) => series.round === "R1"),
      seriesWins: teamSeries.filter((series) => series.bestOf === 7 && series.winnerTeamId === teamId).length,
      conferenceFinals: teamSeries.some((series) => series.round === "CF"),
      finalsAppearance: teamSeries.some((series) => series.round === "FINALS"),
      champion: champion === teamId,
    }];
  }));
  applySeasonTeamCoreUpdate(state, milestones, state.history.seasonAwards.find((entry) => entry.seasonId === state.league.seasonId));
  evaluatePostseasonAchievements(state, userPostseason);
  enqueueCareerMilestoneEvents(state);
  archiveCompletedSeason(state, champion, games, userPostseason, postseason.sevenEightLoserTeamIds);
  rebuildGmCareerFromHistory(state);
  state.league.currentPhase = "OFFSEASON";
}

function simulatePostseasonGameInternal(input: GameState, mutate: boolean): GameState {
  assertPhaseAllowed(input, "Simulate postseason game", ["PLAY_IN", "PLAYOFFS"]);
  if (!input.postseason || input.postseason.seasonId !== input.league.seasonId) throw new Error("POSTSEASON_NOT_STARTED");
  if (blockingEvent(input) || input.injuryState.pendingUserMajorInjury || input.injuryState.pendingEmergencyRoster) return input;
  const state = mutate ? input : structuredClone(input);
  const game = state.postseason!.schedule.filter((item) => item.status === "SCHEDULED")
    .sort((left, right) => left.dateIndex - right.dateIndex || left.id.localeCompare(right.id))[0];
  if (!game) throw new Error("POSTSEASON_SCHEDULE_EMPTY");
  const series = state.postseason!.series.find((item) => item.gameIds.includes(game.id))!;
  const result = postseasonGame(state, game.homeTeamId, game.awayTeamId, series.id, game.matchupOrdinal, game.dateIndex - state.calendar.finalDateIndex, game);
  game.status = "FINAL";
  game.homeScore = result.homeScore;
  game.awayScore = result.awayScore;
  game.winnerTeamId = result.winnerTeamId;
  state.postseason!.gameDetails[game.id] = result;
  if (result.winnerTeamId === series.teamAId) series.winsA += 1;
  else series.winsB += 1;
  if (series.winsA === Math.ceil(series.bestOf / 2) || series.winsB === Math.ceil(series.bestOf / 2)) {
    series.winnerTeamId = series.winsA > series.winsB ? series.teamAId : series.teamBId;
  } else {
    scheduleSeriesGame(state, series, game.dateIndex + 2);
  }
  advancePostseasonBracket(state);
  state.calendar.currentDateIndex = state.postseason!.schedule
    .filter((item) => item.status === "SCHEDULED")
    .reduce((earliest, item) => Math.min(earliest, item.dateIndex), game.dateIndex + 1);
  if (seriesById(state, "FINALS")?.winnerTeamId) finalizeInteractivePostseason(state);
  return state;
}

export function simulatePostseasonGame(input: GameState): GameState {
  return simulatePostseasonGameInternal(input, false);
}

export function simulatePostseasonToNextUserGame(input: GameState): GameState {
  const targetId = nextPlayoffUserGame(input)?.game.id;
  let next = input;
  for (let index = 0; index < 120 && ["PLAY_IN", "PLAYOFFS"].includes(next.league.currentPhase); index += 1) {
    const targetPlayed = !targetId || next.postseason?.schedule.find((game) => game.id === targetId)?.status === "FINAL";
    if (targetPlayed && (nextPlayoffUserGame(next) || isUserPostseasonEliminated(next))) break;
    const advanced = simulatePostseasonGame(next);
    if (advanced === next) break;
    next = advanced;
  }
  return next;
}

export function simulatePostseasonRound(input: GameState): GameState {
  const nextScheduled = (state: GameState) => state.postseason?.schedule.filter((game) => game.status === "SCHEDULED")
    .sort((left, right) => left.dateIndex - right.dateIndex || left.id.localeCompare(right.id))[0];
  const first = nextScheduled(input);
  const round = input.postseason?.series.find((series) => series.gameIds.includes(first?.id ?? ""))?.round;
  if (!round) return input;
  let next = input;
  for (let index = 0; index < 120 && ["PLAY_IN", "PLAYOFFS"].includes(next.league.currentPhase); index += 1) {
    const game = nextScheduled(next);
    if (next.postseason?.series.find((series) => series.gameIds.includes(game?.id ?? ""))?.round !== round) break;
    const advanced = simulatePostseasonGame(next);
    if (advanced === next) break;
    next = advanced;
  }
  return next;
}

export function simulatePostseason(input: GameState): GameState {
  if (input.postseason && ["PLAY_IN", "PLAYOFFS"].includes(input.league.currentPhase)) {
    let state = structuredClone(input);
    while (state.league.currentPhase !== "OFFSEASON") {
      if (state.injuryState.pendingUserMajorInjury) state.injuryState.pendingUserMajorInjury = undefined;
      if (state.injuryState.pendingEmergencyRoster) fillEmergencyRoster(state, state.userTeamId);
      if (blockingEvent(state)) state = resolveAllEvents(state);
      simulatePostseasonGameInternal(state, true);
    }
    return state;
  }
  assertPhaseAllowed(input, "Simulate postseason", ["REGULAR_SEASON", "REGULAR_PRE_DEADLINE", "REGULAR_POST_DEADLINE", "OFFSEASON"]);
  if (input.league.currentPhase === "OFFSEASON") return input;
  const state = finalizeRegularSeasonAwards(input);
  state.league.currentPhase = "PLAY_IN";
  const west = resolveConferenceStandings("WEST", state.standings, state.teams, state.seeds.seasonSeed);
  const east = resolveConferenceStandings("EAST", state.standings, state.teams, state.seeds.seasonSeed);
  const westPlayIn = playInSeeds(state, west, "WEST", 2);
  const eastPlayIn = playInSeeds(state, east, "EAST", 2);
  state.league.currentPhase = "PLAYOFFS";
  const westConference = conferenceChampion(state, westPlayIn.seeds, "WEST", 10);
  const eastConference = conferenceChampion(state, eastPlayIn.seeds, "EAST", 10);
  const westChampion = westConference.winner;
  const eastChampion = eastConference.winner;
  const westRecord = state.standings[westChampion];
  const eastRecord = state.standings[eastChampion];
  const westHasHome = westRecord.wins > eastRecord.wins
    || (westRecord.wins === eastRecord.wins && westRecord.pointsFor - westRecord.pointsAgainst >= eastRecord.pointsFor - eastRecord.pointsAgainst);
  const finals = playSeries(
    state,
    westHasHome ? westChampion : eastChampion,
    westHasHome ? eastChampion : westChampion,
    "FINALS",
    140,
  );
  state.history.champions.push({ seasonId: state.league.seasonId, teamId: finals.winner });
  finalizeFinalsAwards(state, finals.winner, finals.games);
  const postseasonGames = [
    ...westPlayIn.games,
    ...eastPlayIn.games,
    ...westConference.games,
    ...eastConference.games,
    ...finals.games,
  ];
  const userConferenceStandings = state.teams[state.userTeamId].conference === "WEST" ? west : east;
  const userPlayoffSeeds = state.teams[state.userTeamId].conference === "WEST" ? westPlayIn.seeds : eastPlayIn.seeds;
  const userConference = state.teams[state.userTeamId].conference === "WEST" ? westConference : eastConference;
  const userPostseason = {
    enteredPlayIn: userConferenceStandings.slice(6, 10).some((record) => record.teamId === state.userTeamId),
    enteredPlayoffs: userPlayoffSeeds.includes(state.userTeamId),
    seriesWins: userConference.seriesWinners.filter((teamId) => teamId === state.userTeamId).length + (finals.winner === state.userTeamId ? 1 : 0),
    conferenceFinals: userConference.conferenceFinalists.includes(state.userTeamId),
    finalsAppearance: westChampion === state.userTeamId || eastChampion === state.userTeamId,
    champion: finals.winner === state.userTeamId,
    playoffWins: postseasonGames.filter((game) => game.winnerTeamId === state.userTeamId).length,
    playoffLosses: postseasonGames.filter((game) => (game.homeTeamId === state.userTeamId || game.awayTeamId === state.userTeamId) && game.winnerTeamId !== state.userTeamId).length,
  };
  const postseasonMilestones: Record<string, PostseasonTeamMilestone> = Object.fromEntries(Object.keys(state.teams).map((teamId) => [teamId, {
    enteredPlayIn: [...west.slice(6, 10), ...east.slice(6, 10)].some((record) => record.teamId === teamId),
    enteredPlayoffs: westPlayIn.seeds.includes(teamId) || eastPlayIn.seeds.includes(teamId),
    seriesWins: [...westConference.seriesWinners, ...eastConference.seriesWinners].filter((winner) => winner === teamId).length + (finals.winner === teamId ? 1 : 0),
    conferenceFinals: [...westConference.conferenceFinalists, ...eastConference.conferenceFinalists].includes(teamId),
    finalsAppearance: westChampion === teamId || eastChampion === teamId,
    champion: finals.winner === teamId,
  }]));
  applySeasonTeamCoreUpdate(state, postseasonMilestones, state.history.seasonAwards.find((entry) => entry.seasonId === state.league.seasonId));
  evaluatePostseasonAchievements(state, userPostseason);
  enqueueCareerMilestoneEvents(state);
  const sevenEightLoserTeamIds = [westPlayIn.games[0], eastPlayIn.games[0]]
    .map((game) => game.winnerTeamId === game.homeTeamId ? game.awayTeamId : game.homeTeamId);
  archiveCompletedSeason(state, finals.winner, postseasonGames, userPostseason, sevenEightLoserTeamIds);
  rebuildGmCareerFromHistory(state);
  state.league.currentPhase = "OFFSEASON";
  return state;
}

export function simulateRegularSeason(
  input: GameState,
  options: { autoAcknowledgeMajorInjuries?: boolean; autoResolveEmergencyRosters?: boolean; autoResolveEvents?: boolean; onProgress?: (completedDays: number, totalDays: number) => void } = {},
): GameState {
  assertPhaseAllowed(input, "Simulate regular season", ["REGULAR_SEASON", "REGULAR_PRE_DEADLINE", "REGULAR_POST_DEADLINE"]);
  let state = cloneForLeagueDay(input);
  const lastScheduledDate = Math.max(...state.schedule.filter((game) => game.status === "SCHEDULED").map((game) => game.dateIndex));
  const totalDays = Math.max(0, lastScheduledDate - state.calendar.currentDateIndex + 1);
  const firstDate = state.calendar.currentDateIndex;
  for (let dateIndex = state.calendar.currentDateIndex; dateIndex <= lastScheduledDate; dateIndex += 1) {
    if (blockingEvent(state)) {
      if (!options.autoResolveEvents) break;
      state = resolveAllEvents(state);
    }
    if (state.injuryState.pendingUserMajorInjury) {
      if (!options.autoAcknowledgeMajorInjuries) break;
      state.injuryState.pendingUserMajorInjury = undefined;
    }
    state = simulateLeagueDay(state, dateIndex, { mutate: true });
    if (state.injuryState.pendingEmergencyRoster && options.autoResolveEmergencyRosters) {
      fillEmergencyRoster(state, state.userTeamId);
      state = simulateLeagueDay(state, dateIndex, { mutate: true });
    }
    if (state.injuryState.pendingUserMajorInjury && options.autoAcknowledgeMajorInjuries) {
      state.injuryState.pendingUserMajorInjury = undefined;
    }
    if (blockingEvent(state) && options.autoResolveEvents) {
      state = resolveAllEvents(state);
      if (state.calendar.currentDateIndex <= dateIndex || state.schedule.some((game) => game.dateIndex === dateIndex && game.status === "SCHEDULED")) {
        state = simulateLeagueDay(state, dateIndex, { mutate: true });
        if (state.injuryState.pendingEmergencyRoster && options.autoResolveEmergencyRosters) {
          fillEmergencyRoster(state, state.userTeamId);
          state = simulateLeagueDay(state, dateIndex, { mutate: true });
        }
        if (state.injuryState.pendingUserMajorInjury && options.autoAcknowledgeMajorInjuries) state.injuryState.pendingUserMajorInjury = undefined;
        if (blockingEvent(state)) state = resolveAllEvents(state);
      }
    }
    options.onProgress?.(dateIndex - firstDate + 1, totalDays);
  }
  return state;
}

export function advanceSeason(input: GameState): GameState {
  assertPhaseAllowed(input, "Advance season", ["REGULAR_SEASON", "REGULAR_PRE_DEADLINE", "REGULAR_POST_DEADLINE", "PLAY_IN", "PLAYOFFS", "OFFSEASON"]);
  let state = input.league.currentPhase === "OFFSEASON" ? structuredClone(input)
    : input.league.currentPhase === "PLAY_IN" || input.league.currentPhase === "PLAYOFFS" ? simulatePostseason(input)
      : simulatePostseason(simulateRegularSeason(input, {
        autoAcknowledgeMajorInjuries: true,
        autoResolveEmergencyRosters: true,
        autoResolveEvents: true,
      }));
  state = rolloverLeagueYear(state);
  state.postseason = undefined;
  for (const playerId of [...(state.contractLifecycle?.pendingUserTeamOptionPlayerIds ?? [])]) {
    const player = state.players[playerId];
    state = resolveTeamOption(state, playerId, shouldPickUpTeamOption(player, player.contract.salary) ? "PICK_UP" : "DECLINE");
  }
  state = finalizeOptionPhase(state);
  state = prepareRookieDraft(state);
  if (state.rookieDraft?.lotteryPresented !== true) {
    state = executeDraftCommand(state, {
      commandId: stableHash(state.seeds.seasonSeed, "headless-lottery-acknowledgement"),
      type: "ACKNOWLEDGE_DRAFT_LOTTERY",
      payload: {},
    });
  }
  while (state.league.currentPhase === "DRAFT") {
    const pick = state.rookieDraft?.pickOrder[state.rookieDraft.currentPickIndex];
    if (!pick) throw new Error("Headless season advance could not resolve the rookie draft");
    state = pick.ownerTeamId === state.userTeamId
      ? draftPlayer(state, getAvailableDraftProspects(state)[0].id, pick.pickNumber)
      : fastForwardRookieDraft(state, pick.pickNumber);
  }
  while (state.teams[state.userTeamId].playerIds.length > LEAGUE_FINANCE_CONFIG.rosterLimits.regularSeasonMaximum) {
    const cut = state.teams[state.userTeamId].playerIds.map((id) => state.players[id])
      .sort((left, right) => publicPlayerValue(left) - publicPlayerValue(right) || left.id.localeCompare(right.id))[0];
    state = waivePlayer(state, cut.id);
  }
  state.league.currentPhase = "PRESEASON";
  state = lockOpeningRoster(state, true);
  for (const player of Object.values(state.players)) {
    player.seasonStats = emptyPlayerSeasonStats();
    player.postseasonStats = emptyPlayerSeasonStats();
  }
  return state;
}

export function standingsForConference(state: GameState, conference: "WEST" | "EAST"): StandingRecord[] {
  return resolveConferenceStandings(conference, state.standings, state.teams, state.seeds.seasonSeed);
}
