import type { GameState } from "../state/types";
import { LEAGUE_FINANCE_CONFIG } from "../../config/leagueFinance";

export type LeaguePhase = GameState["league"]["currentPhase"];

export function assertPhaseAllowed(state: GameState, action: string, allowedPhases: readonly LeaguePhase[]): void {
  if (!allowedPhases.includes(state.league.currentPhase)) {
    throw new Error(`${action} is not allowed during ${state.league.currentPhase}`);
  }
}

export function getRosterLimit(phase: LeaguePhase): number {
  if (["OFFSEASON_PRE_DRAFT", "DRAFT", "OFFSEASON_POST_DRAFT", "PRESEASON", "ROOKIE_DRAFT_PENDING"].includes(phase)) return LEAGUE_FINANCE_CONFIG.rosterLimits.offseasonMaximum;
  if (["REGULAR_SEASON", "REGULAR_PRE_DEADLINE", "REGULAR_POST_DEADLINE", "PLAY_IN", "PLAYOFFS", "POSTSEASON"].includes(phase)) return LEAGUE_FINANCE_CONFIG.rosterLimits.regularSeasonMaximum;
  return LEAGUE_FINANCE_CONFIG.rosterLimits.offseasonMaximum;
}
