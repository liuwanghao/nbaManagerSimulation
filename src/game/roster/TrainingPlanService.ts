import type { GameState, TrainingFocus } from "../state/types";

/** Only players still owned by the user franchise can occupy its training slots. */
export function getRosterTrainingAssignments(state: GameState): Record<string, TrainingFocus> {
  const roster = new Set(state.teams[state.userTeamId].playerIds);
  const assignments: Record<string, TrainingFocus> = {};
  for (const [playerId, focus] of Object.entries(state.trainingPlan?.assignments ?? {})) {
    if (focus && roster.has(playerId) && state.players[playerId]?.teamId === state.userTeamId) assignments[playerId] = focus;
  }
  return assignments;
}
