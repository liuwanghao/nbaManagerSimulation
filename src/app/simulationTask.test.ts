import { describe, expect, it } from "vitest";
import { createCareer, simulateLeagueDay, simulateRegularSeason, simulateToNextEvent } from "../game/season/career";
import { applyRegularPregameSelection, nextRegularUserGame, offerCoachingReview } from "../game/coaching/CoachingService";
import { blockingEvent } from "../game/events/EventService";
import { BALANCE_CONFIG } from "../config/balanceConfig";
import { hasRemainingScheduledDay, userInjuryList } from "./seasonCommandView";
import { executeSimulationTask, type CalendarTarget, type SimulationRequest } from "./simulationTask";

describe("background simulation contract", () => {
  it.each([
    { target: { kind: "ONE_GAME" } as CalendarTarget, games: 1, dates: ["2026-10-22"], finalDateIndex: 3, total: 1 },
    { target: { kind: "FIVE_GAMES" } as CalendarTarget, games: 5,
      dates: ["2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29"], finalDateIndex: 10, total: 5 },
    { target: { kind: "DATE", date: "2026-10-24" } as CalendarTarget, games: 2,
      dates: ["2026-10-22", "2026-10-23", "2026-10-24"], finalDateIndex: 5, total: 171 },
  ])("preserves the input and calendar boundaries for $target.kind", ({ target, games, dates, finalDateIndex, total }) => {
    const state = createCareer("worker-calendar-owned-equality");
    state.calendar.currentDateIndex = 2;
    const original = structuredClone(state);
    const request: SimulationRequest = { state, pregameSelection: null, action: { kind: "CALENDAR", target } };
    const progress: Array<[number, number]> = [];
    const result = executeSimulationTask(request, (completed, count) => progress.push([completed, count]));
    const ownedRequest = structuredClone(request);
    const ownedProgress: Array<[number, number]> = [];
    const ownedResult = executeSimulationTask(ownedRequest, (completed, count) => ownedProgress.push([completed, count]), { ownsState: true });

    expect(state).toEqual(original);
    expect(ownedResult).toEqual(result);
    expect(ownedProgress).toEqual(progress);
    expect(ownedRequest.state.calendar.currentDateIndex).toBe(finalDateIndex);
    expect(result.kind).toBe("CALENDAR");
    if (result.kind !== "CALENDAR") return;
    expect(result.completedGames).toBe(games);
    expect(result.frames.map((frame) => frame.date)).toEqual(dates);
    expect(result.state.calendar.currentDateIndex).toBe(finalDateIndex);
    expect(progress).toEqual(dates.map((_, index) => [index + 1, total]));
  });

  it("records the trade deadline interruption without advancing or losing its frame", () => {
    const state = createCareer("worker-calendar-deadline-interruption");
    state.league.currentPhase = "REGULAR_PRE_DEADLINE";
    state.calendar.currentDateIndex = BALANCE_CONFIG.ai.tradeDeadlineDateIndex;
    const original = structuredClone(state);
    const request: SimulationRequest = {
      state, pregameSelection: null, action: { kind: "CALENDAR", target: { kind: "DATE", date: "2027-03-01" } },
    };
    const progress: Array<[number, number]> = [];
    const result = executeSimulationTask(request, (completed, count) => progress.push([completed, count]));
    const ownedRequest = structuredClone(request);
    const ownedProgress: Array<[number, number]> = [];
    const ownedResult = executeSimulationTask(ownedRequest, (completed, count) => ownedProgress.push([completed, count]), { ownsState: true });

    expect(state).toEqual(original);
    expect(ownedResult).toEqual(result);
    expect(ownedProgress).toEqual(progress);
    expect(blockingEvent(ownedRequest.state)?.definitionId).toBe("trade_deadline_001");
    expect(result.kind).toBe("CALENDAR");
    if (result.kind !== "CALENDAR") return;
    expect(result.completedGames).toBe(0);
    expect(result.frames).toEqual([{ date: "2027-02-02", game: undefined, injuries: [] }]);
    expect(result.state.calendar.currentDateIndex).toBe(original.calendar.currentDateIndex);
    expect(blockingEvent(result.state)?.definitionId).toBe("trade_deadline_001");
    expect(progress).toEqual([[1, original.calendar.finalDateIndex - original.calendar.currentDateIndex]]);
  });

  it("records an emergency roster interruption without advancing or simulating a game", () => {
    const state = createCareer("worker-calendar-owned-equality");
    state.calendar.currentDateIndex = 2;
    state.teams[state.userTeamId].playerIds.slice(5).forEach((id) => { state.players[id].available = false; });
    const original = structuredClone(state);
    const request: SimulationRequest = { state, pregameSelection: null, action: { kind: "CALENDAR", target: { kind: "FIVE_GAMES" } } };
    const progress: Array<[number, number]> = [];
    const result = executeSimulationTask(request, (completed, count) => progress.push([completed, count]));
    const ownedRequest = structuredClone(request);
    const ownedProgress: Array<[number, number]> = [];
    const ownedResult = executeSimulationTask(ownedRequest, (completed, count) => ownedProgress.push([completed, count]), { ownsState: true });

    expect(state).toEqual(original);
    expect(ownedResult).toEqual(result);
    expect(ownedProgress).toEqual(progress);
    expect(ownedRequest.state.injuryState.pendingEmergencyRoster).toBeDefined();
    expect(result.kind).toBe("CALENDAR");
    if (result.kind !== "CALENDAR") return;
    expect(result.completedGames).toBe(0);
    expect(result.frames).toHaveLength(1);
    expect(result.frames[0]).toEqual({ date: "2026-10-22", game: undefined, injuries: userInjuryList(result.state) });
    expect(result.state.calendar.currentDateIndex).toBe(original.calendar.currentDateIndex);
    expect(result.state.injuryState.pendingEmergencyRoster).toEqual({ teamId: state.userTeamId, availableCount: 5, requiredCount: 8 });
    expect(progress).toEqual([[1, 5]]);
  });

  it("applies an unlocked pregame choice identically while preserving the default input", () => {
    const state = createCareer("worker-calendar-owned-equality");
    const game = nextRegularUserGame(state)!;
    state.calendar.currentDateIndex = game.dateIndex;
    state.coaching!.regularVideoGameId = game.id;
    const original = structuredClone(state);
    const request: SimulationRequest = {
      state, pregameSelection: { gameId: game.id, choice: "DEFENSE" }, action: { kind: "CALENDAR", target: { kind: "ONE_GAME" } },
    };
    const progress: Array<[number, number]> = [];
    const result = executeSimulationTask(request, (completed, count) => progress.push([completed, count]));
    const ownedRequest = structuredClone(request);
    const ownedProgress: Array<[number, number]> = [];
    const ownedResult = executeSimulationTask(ownedRequest, (completed, count) => ownedProgress.push([completed, count]), { ownsState: true });

    expect(state).toEqual(original);
    expect(ownedResult).toEqual(result);
    expect(ownedProgress).toEqual(progress);
    expect(result.kind).toBe("CALENDAR");
    if (result.kind !== "CALENDAR") return;
    expect(result.completedGames).toBe(1);
    expect(result.state.userGameDetails[game.id].coaching).toEqual({ teamId: state.userTeamId, focus: "DEFENSE", efficiencyPoints: 1 });
    expect(result.frames[0].game?.coaching).toEqual(result.state.userGameDetails[game.id].coaching);
    expect(result.state.coaching?.regularPlan).toBeUndefined();
    expect(result.state.coaching?.regularVideoGameId).toBeUndefined();
    expect(progress).toEqual([[1, 1]]);
  });

  it("keeps a pending major injury blocked with no frames, progress, or state changes in either mode", () => {
    const state = createCareer("worker-calendar-owned-equality");
    state.calendar.currentDateIndex = 2;
    state.injuryState.pendingUserMajorInjury = {
      injuryId: "pending-major-injury", playerId: state.teams[state.userTeamId].playerIds[0], teamId: state.userTeamId,
      severity: "LONG", gamesOut: 30, daysOut: 60, gameId: "previous-game", seasonId: state.league.seasonId,
    };
    const original = structuredClone(state);
    const request: SimulationRequest = { state, pregameSelection: null, action: { kind: "CALENDAR", target: { kind: "FIVE_GAMES" } } };
    const progress: Array<[number, number]> = [];
    const result = executeSimulationTask(request, (completed, count) => progress.push([completed, count]));
    const ownedRequest = structuredClone(request);
    const ownedProgress: Array<[number, number]> = [];
    const ownedResult = executeSimulationTask(ownedRequest, (completed, count) => ownedProgress.push([completed, count]), { ownsState: true });

    expect(state).toEqual(original);
    expect(ownedRequest.state).toEqual(original);
    expect(ownedResult).toEqual(result);
    expect(ownedProgress).toEqual(progress);
    expect(result).toEqual({ kind: "CALENDAR", state: original, frames: [], completedGames: 0 });
    expect(progress).toEqual([]);
  });

  it("keeps the next game, calendar frames, and coaching review identical", () => {
    const state = createCareer("worker-next-game-equality");
    const prepared = applyRegularPregameSelection(state, null);
    let expected = prepared;
    const frames: Array<{ date: string; gameId?: string; injuries: ReturnType<typeof userInjuryList> }> = [];
    while (hasRemainingScheduledDay(expected.schedule, expected.calendar.currentDateIndex, expected.calendar.finalDateIndex)
      && !expected.injuryState.pendingUserMajorInjury && !expected.injuryState.pendingEmergencyRoster && !blockingEvent(expected)) {
      const dateIndex = expected.calendar.currentDateIndex;
      const knownGames = new Set(Object.keys(expected.userGameDetails));
      const day = simulateLeagueDay(expected);
      if (day === expected) break;
      const game = Object.values(day.userGameDetails).find((entry) => !knownGames.has(entry.gameId));
      const date = new Date(`${expected.calendar.openingDate}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() + dateIndex);
      frames.push({ date: date.toISOString().slice(0, 10), gameId: game?.gameId, injuries: userInjuryList(day) });
      expected = day;
      if (game) break;
    }
    expected = offerCoachingReview(expected, frames.flatMap((frame) => frame.gameId ? [frame.gameId] : []));
    const result = executeSimulationTask({ state, pregameSelection: null, action: { kind: "CALENDAR", target: { kind: "ONE_GAME" } } });
    expect(result.kind).toBe("CALENDAR");
    if (result.kind !== "CALENDAR") return;
    expect(result.frames.map((frame) => ({ date: frame.date, gameId: frame.game?.gameId, injuries: frame.injuries }))).toEqual(frames);
    expect(result.state).toEqual(expected);
  });

  it("keeps next-event simulation identical", () => {
    const state = createCareer("worker-next-event-equality");
    const result = executeSimulationTask({ state, pregameSelection: null, action: { kind: "OPERATION", operation: "NEXT_EVENT", usePregameSelection: true } });
    expect(result.kind).toBe("OPERATION");
    if (result.kind !== "OPERATION") return;
    expect(result.state).toEqual(simulateToNextEvent(applyRegularPregameSelection(state, null)));
  });

  it("reports regular-season progress without changing the resulting state", () => {
    const state = createCareer("worker-season-progress-equality");
    const progress: Array<[number, number]> = [];
    const result = executeSimulationTask({
      state,
      pregameSelection: null,
      action: { kind: "OPERATION", operation: "REGULAR_SEASON", usePregameSelection: false },
    }, (completed, total) => progress.push([completed, total]));
    expect(result.kind).toBe("OPERATION");
    if (result.kind !== "OPERATION") return;
    expect(progress.length).toBeGreaterThan(0);
    expect(progress.every(([completed, total]) => completed > 0 && completed <= total)).toBe(true);
    expect(result.state).toEqual(simulateRegularSeason(state));
  });
});
