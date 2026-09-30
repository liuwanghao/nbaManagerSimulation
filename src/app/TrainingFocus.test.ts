import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createCareer } from "../game/season/career";
import { executeRosterCommand } from "../game/roster/RosterService";
import App from "./App";
import { trainingFocusCommandId } from "./Stage4Flow";

describe("preseason training intents", () => {
  it("can switch back to a prior focus, cancel, and reselect after reload", () => {
    let state = createCareer("training-ui-intents");
    state.league.currentPhase = "PRESEASON";
    const playerId = state.teams[state.userTeamId].playerIds[0];
    const ids: string[] = [];
    for (const focus of ["SHOOTING", "DEFENSE", "SHOOTING", null, "SHOOTING"] as const) {
      const command = { commandId: trainingFocusCommandId(state, playerId), type: "SET_TRAINING_FOCUS" as const, payload: { playerId, focus } };
      ids.push(command.commandId);
      state = executeRosterCommand(state, command);
      expect(state.trainingPlan?.assignments[playerId] ?? null).toBe(focus);
      expect(executeRosterCommand(state, command)).toBe(state);
      state = JSON.parse(JSON.stringify(state));
    }
    expect(new Set(ids).size).toBe(ids.length);
    expect(trainingFocusCommandId(state, playerId)).not.toBe(trainingFocusCommandId(state, playerId));
  });

  it("keeps training controls available when an old save contains departed assignments", () => {
    const state = createCareer("training-ui-stale-assignments");
    state.league.currentPhase = "PRESEASON";
    const departed = state.teams.CHA.playerIds[0];
    state.trainingPlan = { seasonId: state.league.seasonId, assignments: { [departed]: "SHOOTING", missing: "DEFENSE" } };
    const markup = renderToStaticMarkup(createElement(App, { initialState: state }));
    expect(markup).toContain("<b>0 / 2</b>");
    expect(markup).not.toMatch(/data-testid="preseason-focus-[^"]+"[^>]*disabled/);
    expect(state.trainingPlan.assignments).toEqual({ [departed]: "SHOOTING", missing: "DEFENSE" });
  });
});
