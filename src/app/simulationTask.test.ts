import { describe, expect, it } from "vitest";
import { createCareer, simulateLeagueDay, simulateRegularSeason, simulateToNextEvent } from "../game/season/career";
import { applyRegularPregameSelection, offerCoachingReview } from "../game/coaching/CoachingService";
import { blockingEvent } from "../game/events/EventService";
import { hasRemainingScheduledDay, userInjuryList } from "./seasonCommandView";
import { executeSimulationTask } from "./simulationTask";

describe("background simulation contract", () => {
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
