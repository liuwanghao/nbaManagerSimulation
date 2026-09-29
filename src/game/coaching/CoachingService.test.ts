import { describe, expect, it } from "vitest";
import { createCareer, simulateNextGameDay } from "../season/career";
import { simulateGame } from "../simulation/simulateGame";
import type { ScheduleGame } from "../state/types";
import {
  applyRegularPregameSelection, consumePlayoffCoachingForGame, consumeRegularCoachingForGame, executeCoachingCommand,
  fiveGameReviewView, nextRegularUserGame, offerCoachingReview,
  playoffCoachingView, regularCoachingView,
} from "./CoachingService";

describe("coaching interventions", () => {
  it("retains losing-streak notifications as regular news after simulation", () => {
    let state = createCareer("five-game-streak-check-13");
    for (let game = 0; game < 5; game += 1) state = simulateNextGameDay(state);
    const notice = state.teamNotifications?.find((item) => item.title === "三连败");
    expect(notice).toBeDefined();
    expect(state.teams[state.userTeamId].currentStreak).toBe(2);
  });

  it("allows regular-season choices to change until tipoff and applies only the final choice", () => {
    const state = createCareer("coaching-regular");
    const game = nextRegularUserGame(state)!;
    delete state.coaching; // A save made before coaching was added has no coaching field.
    const planned = executeCoachingCommand(state, { type: "SET_REGULAR_PLAN", gameId: game.id, focus: "OFFENSE" });
    const withoutVideo = structuredClone(planned);
    expect(consumeRegularCoachingForGame(withoutVideo, game)).toBeUndefined();
    const unlocked = executeCoachingCommand(planned, { type: "UNLOCK_REGULAR_PREP", gameId: game.id });
    expect(regularCoachingView(unlocked)?.videoUnlocked).toBe(true);
    expect(() => executeCoachingCommand(unlocked, { type: "UNLOCK_REGULAR_PREP", gameId: game.id })).toThrow("COACHING_PREGAME_UNAVAILABLE");
    const offense = executeCoachingCommand(unlocked, { type: "SET_REGULAR_PLAN", gameId: game.id, focus: "OFFENSE" });
    const defense = executeCoachingCommand(offense, { type: "SET_REGULAR_PLAN", gameId: game.id, focus: "DEFENSE" });
    expect(regularCoachingView(offense)?.selected?.focus).toBe("OFFENSE");
    expect(regularCoachingView(defense)?.selected?.focus).toBe("DEFENSE");
    const other = state.schedule.find((entry) => entry.status === "SCHEDULED" && entry.id !== game.id)!;
    expect(consumeRegularCoachingForGame(defense, other)).toBeUndefined();
    expect(consumeRegularCoachingForGame(defense, game)).toEqual({ teamId: state.userTeamId, focus: "DEFENSE", efficiencyPoints: 1 });
    expect(defense.coaching?.regularVideoGameId).toBeUndefined();
    expect(consumeRegularCoachingForGame(defense, game)).toBeUndefined();
  });

  it("uses the same seeded game engine for a one-game offensive or defensive modifier", () => {
    const state = createCareer("coaching-game-modifier");
    const game = nextRegularUserGame(state)!;
    const baseline = simulateGame(game, state.teams[game.homeTeamId], state.teams[game.awayTeamId], state.players, state.seeds.seasonSeed);
    const offense = simulateGame(game, state.teams[game.homeTeamId], state.teams[game.awayTeamId], state.players, state.seeds.seasonSeed, false,
      { teamId: game.homeTeamId, focus: "OFFENSE", efficiencyPoints: 20 });
    const defense = simulateGame(game, state.teams[game.homeTeamId], state.teams[game.awayTeamId], state.players, state.seeds.seasonSeed, false,
      { teamId: game.homeTeamId, focus: "DEFENSE", efficiencyPoints: 20 });
    expect(offense.homeScore).toBeGreaterThan(baseline.homeScore);
    expect(defense.awayScore).toBeLessThan(baseline.awayScore);
    expect(simulateGame(game, state.teams[game.homeTeamId], state.teams[game.awayTeamId], state.players, state.seeds.seasonSeed)).toEqual(baseline);
  });

  it("consumes the regular game plan through actual league-day simulation", () => {
    const state = createCareer("coaching-league-day");
    const game = nextRegularUserGame(state)!;
    expect(simulateNextGameDay(state).userGameDetails[game.id].coaching).toBeUndefined();
    const withoutVideo = executeCoachingCommand(state, { type: "SET_REGULAR_PLAN", gameId: game.id, focus: "OFFENSE" });
    expect(simulateNextGameDay(withoutVideo).userGameDetails[game.id].coaching).toBeUndefined();
    const unusedVideo = executeCoachingCommand(state, { type: "UNLOCK_REGULAR_PREP", gameId: game.id });
    expect(simulateNextGameDay(unusedVideo).coaching?.regularVideoGameId).toBeUndefined();
    const unlocked = executeCoachingCommand(state, { type: "UNLOCK_REGULAR_PREP", gameId: game.id });
    const planned = executeCoachingCommand(unlocked, { type: "SET_REGULAR_PLAN", gameId: game.id, focus: "OFFENSE" });
    const advanced = simulateNextGameDay(planned);
    expect(advanced.schedule.find((entry) => entry.id === game.id)?.status).toBe("FINAL");
    expect(advanced.coaching?.regularPlan).toBeUndefined();
    expect(advanced.coaching?.regularVideoGameId).toBeUndefined();
    expect(advanced.userGameDetails[game.id]).toBeDefined();
    expect(advanced.userGameDetails[game.id].coaching).toEqual({ teamId: state.userTeamId, focus: "OFFENSE", efficiencyPoints: 1 });
    expect(planned.coaching?.regularPlan?.gameId).toBe(game.id);
  });

  it("simulates normally when a selected direction has no video confirmation", () => {
    const state = createCareer("coaching-unconfirmed-preview");
    const game = nextRegularUserGame(state)!;
    const draft = { gameId: game.id, choice: "OFFENSE" as const };
    const normal = applyRegularPregameSelection(state, draft);
    expect(normal).toBe(state);
    expect(simulateNextGameDay(normal).userGameDetails[game.id].coaching).toBeUndefined();
    const oldPlan = executeCoachingCommand(state, { type: "SET_REGULAR_PLAN", gameId: game.id, focus: "OFFENSE" });
    expect(applyRegularPregameSelection(oldPlan, draft).coaching?.regularPlan).toBeUndefined();
    const unlocked = executeCoachingCommand(state, { type: "UNLOCK_REGULAR_PREP", gameId: game.id });
    const ready = applyRegularPregameSelection(unlocked, draft);
    expect(simulateNextGameDay(ready).userGameDetails[game.id].coaching?.focus).toBe("OFFENSE");
    const skipped = applyRegularPregameSelection(ready, { gameId: game.id, choice: "NONE" });
    expect(skipped.coaching?.regularPlan).toBeUndefined();
    expect(simulateNextGameDay(skipped).userGameDetails[game.id].coaching).toBeUndefined();
  });

  it("ignores a pending two-player recovery plan from an older save", () => {
    const state = createCareer("coaching-legacy-recovery");
    const game = nextRegularUserGame(state)!;
    const ids = state.teams[state.userTeamId].playerIds.slice(0, 2) as [string, string];
    state.players[ids[0]].fatigue = 75;
    state.players[ids[1]].fatigue = 82;
    state.coaching!.regularVideoGameId = game.id;
    state.coaching!.regularPlan = { gameId: game.id, recoveryPlayerIds: ids };
    expect(regularCoachingView(state)?.selected).toBeUndefined();
    expect(consumeRegularCoachingForGame(state, game)).toBeUndefined();
    expect(state.players[ids[0]].fatigue).toBe(75);
    expect(state.players[ids[1]].fatigue).toBe(82);
    expect(state.coaching?.regularPlan).toBeUndefined();
    expect(state.coaching?.regularVideoGameId).toBeUndefined();
  });

  it("applies a video-unlocked plan only to the first game of a five-game run", () => {
    let state = createCareer("five-game-streak-check-13");
    const firstGame = nextRegularUserGame(state)!;
    state = executeCoachingCommand(state, { type: "UNLOCK_REGULAR_PREP", gameId: firstGame.id });
    state = executeCoachingCommand(state, { type: "SET_REGULAR_PLAN", gameId: firstGame.id, focus: "OFFENSE" });
    const completedGameIds: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const before = new Set(Object.keys(state.userGameDetails));
      state = simulateNextGameDay(state);
      completedGameIds.push(...Object.keys(state.userGameDetails).filter((id) => !before.has(id)));
    }
    expect(completedGameIds).toHaveLength(5);
    expect(completedGameIds[0]).toBe(firstGame.id);
    expect(state.userGameDetails[firstGame.id].coaching).toEqual({ teamId: state.userTeamId, focus: "OFFENSE", efficiencyPoints: 1 });
    for (const gameId of completedGameIds.slice(1)) expect(state.userGameDetails[gameId].coaching).toBeUndefined();
    expect(state.coaching?.regularVideoGameId).toBeUndefined();
    expect(state.coaching?.regularPlan).toBeUndefined();
  });

  it("offers one five-game review only after five completed user games with improvable status", () => {
    const state = createCareer("coaching-five-game-review");
    const games = state.schedule.filter((game) => game.homeTeamId === state.userTeamId || game.awayTeamId === state.userTeamId)
      .sort((left, right) => left.dateIndex - right.dateIndex || left.id.localeCompare(right.id));
    const ids = games.slice(0, 5).map((game) => game.id);
    games.slice(0, 5).forEach((game) => { game.status = "FINAL"; });
    const playerIds = state.teams[state.userTeamId].playerIds.slice(0, 2);
    state.players[playerIds[0]].fatigue = 77;
    state.players[playerIds[1]].morale = 41;
    expect(offerCoachingReview(state, ids.slice(0, 4))).toBe(state);
    const offered = offerCoachingReview(state, ids);
    expect(fiveGameReviewView(offered)?.afterGameId).toBe(ids[4]);
    const recovered = executeCoachingCommand(offered, { type: "USE_FIVE_GAME_REVIEW", afterGameId: ids[4], benefit: "FATIGUE", playerIds: [playerIds[0]] });
    expect(recovered.players[playerIds[0]].fatigue).toBe(59);
    expect(offered.players[playerIds[0]].fatigue).toBe(77);
    expect(fiveGameReviewView(recovered)).toBeUndefined();
    expect(() => executeCoachingCommand(recovered, { type: "USE_FIVE_GAME_REVIEW", afterGameId: ids[4], benefit: "MORALE" })).toThrow("COACHING_REVIEW_UNAVAILABLE");
    const encouraged = executeCoachingCommand(offered, { type: "USE_FIVE_GAME_REVIEW", afterGameId: ids[4], benefit: "MORALE" });
    for (const id of state.teams[state.userTeamId].playerIds) {
      expect(encouraged.players[id].morale).toBe(Math.min(100, offered.players[id].morale + 1));
      expect(encouraged.players[id]).not.toBe(offered.players[id]);
    }
    expect(encouraged.players[playerIds[1]].morale).toBe(42);
    const twoTargets = fiveGameReviewView(offered)?.moraleTwoTargets ?? [];
    expect(twoTargets).toHaveLength(2);
    expect(twoTargets).toContain(playerIds[1]);
    expect(fiveGameReviewView(structuredClone(offered))?.moraleTwoTargets).toEqual(twoTargets);
    const twoEncouraged = executeCoachingCommand(offered, { type: "USE_FIVE_GAME_REVIEW", afterGameId: ids[4], benefit: "MORALE_TWO" });
    for (const id of state.teams[state.userTeamId].playerIds) {
      expect(twoEncouraged.players[id].morale).toBe(offered.players[id].morale + (twoTargets.includes(id) ? 1 : 0));
    }
    expect(fiveGameReviewView(twoEncouraged)).toBeUndefined();
    expect(() => executeCoachingCommand(twoEncouraged, { type: "USE_FIVE_GAME_REVIEW", afterGameId: ids[4], benefit: "MORALE" })).toThrow("COACHING_REVIEW_UNAVAILABLE");
    const teamRecovered = executeCoachingCommand(offered, { type: "USE_FIVE_GAME_REVIEW", afterGameId: ids[4], benefit: "TEAM_FATIGUE" });
    for (const id of state.teams[state.userTeamId].playerIds) {
      expect(teamRecovered.players[id].fatigue).toBe(Math.max(0, offered.players[id].fatigue - 1));
      expect(offered.players[id].fatigue).toBe(state.players[id].fatigue);
    }
    expect(teamRecovered.players[playerIds[0]].fatigue).toBe(76);
    expect(teamRecovered.players[playerIds[1]].fatigue).toBe(0);
    expect(fiveGameReviewView(teamRecovered)).toBeUndefined();
    expect(() => executeCoachingCommand(teamRecovered, { type: "USE_FIVE_GAME_REVIEW", afterGameId: ids[4], benefit: "FATIGUE", playerIds: [playerIds[0]] })).toThrow("COACHING_REVIEW_UNAVAILABLE");
    const moraleOnly = structuredClone(offered);
    for (const id of moraleOnly.teams[moraleOnly.userTeamId].playerIds) moraleOnly.players[id].fatigue = 0;
    expect(() => executeCoachingCommand(moraleOnly, { type: "USE_FIVE_GAME_REVIEW", afterGameId: ids[4], benefit: "TEAM_FATIGUE" })).toThrow("COACHING_REVIEW_UNAVAILABLE");
    const expired = structuredClone(offered);
    consumeRegularCoachingForGame(expired, games[5]);
    expect(fiveGameReviewView(expired)).toBeUndefined();
  });

  it("offers the same review after five individually simulated games", () => {
    let state = createCareer("coaching-five-individual-games");
    const games = state.schedule.filter((game) => game.homeTeamId === state.userTeamId || game.awayTeamId === state.userTeamId)
      .sort((left, right) => left.dateIndex - right.dateIndex || left.id.localeCompare(right.id));
    state.players[state.teams[state.userTeamId].playerIds[0]].fatigue = 75;
    for (let index = 0; index < 5; index += 1) {
      games[index].status = "FINAL";
      const advanced = offerCoachingReview(state, [games[index].id]);
      expect(fiveGameReviewView(advanced)?.afterGameId).toBe(index === 4 ? games[4].id : undefined);
      state = advanced;
    }
    expect(state.coaching?.lastReviewAtGameCount).toBe(5);
    const reviewed = executeCoachingCommand(state, { type: "USE_FIVE_GAME_REVIEW", afterGameId: games[4].id, benefit: "TEAM_FATIGUE" });
    expect(reviewed.coaching?.lastReviewAtGameCount).toBe(5);
  });

  it("counts mixed single and five-game runs from the last review", () => {
    let state = createCareer("coaching-mixed-review-cadence");
    const games = state.schedule.filter((game) => game.homeTeamId === state.userTeamId || game.awayTeamId === state.userTeamId)
      .sort((left, right) => left.dateIndex - right.dateIndex || left.id.localeCompare(right.id));
    state.players[state.teams[state.userTeamId].playerIds[0]].fatigue = 75;
    for (let index = 0; index < 3; index += 1) {
      games[index].status = "FINAL";
      state = offerCoachingReview(state, [games[index].id]);
    }
    games.slice(3, 8).forEach((game) => { game.status = "FINAL"; });
    state = offerCoachingReview(state, games.slice(3, 8).map((game) => game.id));
    expect(fiveGameReviewView(state)?.afterGameId).toBe(games[7].id);
    expect(state.coaching?.lastReviewAtGameCount).toBe(8);
    for (let index = 8; index < 13; index += 1) {
      games[index].status = "FINAL";
      state = offerCoachingReview(state, [games[index].id]);
      expect(Boolean(fiveGameReviewView(state))).toBe(index === 12);
    }
    expect(state.coaching?.lastReviewAtGameCount).toBe(13);
  });

  it("advances the five-game checkpoint even when no player needs intervention", () => {
    let state = createCareer("coaching-review-no-needs");
    const games = state.schedule.filter((game) => game.homeTeamId === state.userTeamId || game.awayTeamId === state.userTeamId)
      .sort((left, right) => left.dateIndex - right.dateIndex || left.id.localeCompare(right.id));
    for (const id of state.teams[state.userTeamId].playerIds) {
      state.players[id].fatigue = 0;
      state.players[id].morale = 70;
    }
    games.slice(0, 5).forEach((game) => { game.status = "FINAL"; });
    state = offerCoachingReview(state, games.slice(0, 5).map((game) => game.id));
    expect(state.coaching?.lastReviewAtGameCount).toBe(5);
    expect(fiveGameReviewView(state)).toBeUndefined();
    state.players[state.teams[state.userTeamId].playerIds[0]].fatigue = 75;
    games[5].status = "FINAL";
    state = offerCoachingReview(state, [games[5].id]);
    expect(fiveGameReviewView(state)).toBeUndefined();
    games.slice(6, 10).forEach((game) => { game.status = "FINAL"; });
    state = offerCoachingReview(state, games.slice(6, 10).map((game) => game.id));
    expect(fiveGameReviewView(state)?.afterGameId).toBe(games[9].id);
  });

  it("allows only one playoff plan per round, including multiple play-in games", () => {
    const state = createCareer("coaching-playoff-round");
    state.league.currentPhase = "PLAY_IN";
    const game: ScheduleGame = { ...nextRegularUserGame({ ...state, league: { ...state.league, currentPhase: "REGULAR_SEASON" } })!, id: "USER-PLAYIN-A", status: "SCHEDULED" };
    state.postseason = {
      seasonId: state.league.seasonId, schedule: [game], gameDetails: {},
      series: [{ id: "WEST-PLAYIN-A", conference: "WEST", round: "PLAY_IN", teamAId: game.homeTeamId, teamBId: game.awayTeamId, winsA: 0, winsB: 0, bestOf: 1, gameIds: [game.id] }],
      seeds: { WEST: [], EAST: [] }, sevenEightLoserTeamIds: [],
    };
    const planned = executeCoachingCommand(state, { type: "SET_PLAYOFF_PLAN", gameId: game.id, seriesId: "WEST-PLAYIN-A", focus: "DEFENSE" });
    planned.coaching!.regularPlan = { gameId: game.id, focus: "OFFENSE" };
    expect(playoffCoachingView(planned)?.used).toBe(true);
    expect(() => executeCoachingCommand(planned, { type: "SET_PLAYOFF_PLAN", gameId: game.id, seriesId: "WEST-PLAYIN-A", focus: "OFFENSE" })).toThrow("COACHING_PLAYOFF_UNAVAILABLE");
    expect(consumePlayoffCoachingForGame(planned, game)).toEqual({ teamId: state.userTeamId, focus: "DEFENSE", efficiencyPoints: 1.5 });
    expect(planned.coaching?.regularPlan?.focus).toBe("OFFENSE");
    expect(consumePlayoffCoachingForGame(planned, game)).toBeUndefined();
    const next = { ...game, id: "USER-PLAYIN-C" };
    planned.postseason!.schedule = [next];
    planned.postseason!.series.push({ ...planned.postseason!.series[0], id: "WEST-PLAYIN-C", gameIds: [next.id] });
    expect(playoffCoachingView(planned)?.used).toBe(true);
    expect(() => executeCoachingCommand(planned, { type: "SET_PLAYOFF_PLAN", gameId: next.id, seriesId: "WEST-PLAYIN-C", focus: "OFFENSE" })).toThrow("COACHING_PLAYOFF_UNAVAILABLE");
  });

  it("allows a fresh per-game preparation for each postseason game", () => {
    const state = createCareer("coaching-each-playoff-game");
    const regularUserGame = nextRegularUserGame(state)!;
    state.league.currentPhase = "PLAYOFFS";
    const first: ScheduleGame = { ...regularUserGame, id: "PLAYOFF-GAME-1", status: "SCHEDULED" };
    const second: ScheduleGame = { ...first, id: "PLAYOFF-GAME-2", dateIndex: first.dateIndex + 2 };
    state.postseason = {
      seasonId: state.league.seasonId, schedule: [first, second], gameDetails: {},
      series: [{ id: "WEST-R1-0", conference: "WEST", round: "R1", teamAId: first.homeTeamId, teamBId: first.awayTeamId, winsA: 0, winsB: 0, bestOf: 7, gameIds: [first.id, second.id] }],
      seeds: { WEST: [], EAST: [] }, sevenEightLoserTeamIds: [],
    };
    const unlocked = executeCoachingCommand(state, { type: "UNLOCK_REGULAR_PREP", gameId: first.id });
    const planned = applyRegularPregameSelection(unlocked, { gameId: first.id, choice: "DEFENSE" });
    expect(consumeRegularCoachingForGame(planned, first)).toEqual({ teamId: state.userTeamId, focus: "DEFENSE", efficiencyPoints: 1.5 });
    first.status = "FINAL";
    expect(regularCoachingView(planned)?.gameId).toBe(second.id);
    const next = executeCoachingCommand(planned, { type: "UNLOCK_REGULAR_PREP", gameId: second.id });
    expect(regularCoachingView(next)?.videoUnlocked).toBe(true);
  });
});
