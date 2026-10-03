import {
  enterPostseason,
  isUserPostseasonEliminated,
  simulateLeagueDay,
  simulatePostseason,
  simulatePostseasonGame,
  simulatePostseasonRound,
  simulatePostseasonToNextUserGame,
  simulateRegularSeason,
  simulateToNextEvent,
} from "../game/season/career";
import { blockingEvent } from "../game/events/EventService";
import { applyRegularPregameSelection, offerCoachingReview, type RegularPregameSelection } from "../game/coaching/CoachingService";
import type { GameResult, GameState } from "../game/state/types";
import { hasRemainingScheduledDay, userInjuryList, type InjuryListEntry } from "./seasonCommandView";

export type SimulationOperation = "NEXT_EVENT" | "REGULAR_SEASON" | "POSTSEASON" | "POSTSEASON_ROUND" | "POSTSEASON_NEXT" | "ENTER_POSTSEASON";
export type CalendarTarget = { kind: "ONE_GAME" | "FIVE_GAMES" } | { kind: "DATE"; date: string };
export type CalendarFrame = { date: string; game?: GameResult; injuries: InjuryListEntry[] };
export type SimulationRequest = {
  state: GameState;
  pregameSelection: RegularPregameSelection | null;
  action: { kind: "CALENDAR"; target: CalendarTarget } | { kind: "OPERATION"; operation: SimulationOperation; usePregameSelection: boolean };
};
export type SimulationResult = { kind: "CALENDAR"; state: GameState; frames: CalendarFrame[]; completedGames: number }
  | { kind: "OPERATION"; state: GameState };

function calendarDateAtIndex(openingDate: string, dateIndex: number): string {
  const date = new Date(`${openingDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + dateIndex);
  return date.toISOString().slice(0, 10);
}

export function executeSimulationTask(
  request: SimulationRequest,
  onProgress?: (completed: number, total: number) => void,
  options: { ownsState?: boolean } = {},
): SimulationResult {
  const { action } = request;
  if (action.kind === "OPERATION") {
    const prepared = action.usePregameSelection ? applyRegularPregameSelection(request.state, request.pregameSelection) : request.state;
    let state: GameState;
    switch (action.operation) {
      case "NEXT_EVENT": state = simulateToNextEvent(prepared); break;
      case "REGULAR_SEASON": state = simulateRegularSeason(prepared, { onProgress: (completed, total) => {
        if (completed % 5 === 0 || completed === total) onProgress?.(completed, total);
      } }); break;
      case "POSTSEASON": state = simulatePostseason(prepared); break;
      case "POSTSEASON_ROUND": state = simulatePostseasonRound(prepared); break;
      case "POSTSEASON_NEXT": state = isUserPostseasonEliminated(prepared) ? simulatePostseasonGame(prepared) : simulatePostseasonToNextUserGame(prepared); break;
      case "ENTER_POSTSEASON": state = enterPostseason(prepared); break;
    }
    return { kind: "OPERATION", state };
  }

  const initialDateIndex = request.state.calendar.currentDateIndex;
  let next = applyRegularPregameSelection(request.state, request.pregameSelection);
  const frames: CalendarFrame[] = [];
  let completedGames = 0;
  while (hasRemainingScheduledDay(next.schedule, next.calendar.currentDateIndex, next.calendar.finalDateIndex)
    && !next.injuryState.pendingUserMajorInjury && !next.injuryState.pendingEmergencyRoster && !blockingEvent(next)) {
    const dateIndex = next.calendar.currentDateIndex;
    const knownGames = new Set(Object.keys(next.userGameDetails));
    const day = simulateLeagueDay(next, dateIndex, { mutate: options.ownsState });
    // A Worker owns its input: both a simulated day and a newly queued interruption can update it in place.
    if (!options.ownsState && day === next) break;
    const game = Object.values(day.userGameDetails).find((entry) => !knownGames.has(entry.gameId));
    frames.push({ date: calendarDateAtIndex(next.calendar.openingDate, dateIndex), game, injuries: userInjuryList(day) });
    if (game) completedGames += 1;
    next = day;
    onProgress?.(frames.length, action.target.kind === "ONE_GAME" ? 1 : action.target.kind === "FIVE_GAMES" ? 5 : Math.max(1, next.calendar.finalDateIndex - initialDateIndex));
    if (action.target.kind === "ONE_GAME" && completedGames >= 1
      || action.target.kind === "FIVE_GAMES" && completedGames >= 5
      || action.target.kind === "DATE" && calendarDateAtIndex(next.calendar.openingDate, next.calendar.currentDateIndex) > action.target.date) break;
  }
  if (completedGames > 0) next = offerCoachingReview(next, frames.flatMap((frame) => frame.game ? [frame.game.gameId] : []));
  return { kind: "CALENDAR", state: next, frames, completedGames };
}
