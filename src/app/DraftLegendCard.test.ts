import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { executeDraftCommand, getAvailableDraftProspects } from "../game/draft/DraftService";
import { stableHash } from "../game/random/hash";
import { createCareer } from "../game/season/career";
import App from "./App";
import { playerNameZh } from "./playerNameZh";

describe("future draft legend cards", () => {
  it("shows every historical archetype in the prospect list", () => {
    const state = createCareer("draft-legend-card");
    state.league.seasonYear = 2027;
    state.league.seasonId = "2027-28";
    state.league.currentPhase = "OFFSEASON_PRE_DRAFT";
    state.seeds.seasonSeed = stableHash(state.seeds.careerSeed, "season", state.league.seasonId);
    const prepared = executeDraftCommand(state, { commandId: "prepare-legend-card", type: "PREPARE_ROOKIE_DRAFT", payload: {} });
    const entered = executeDraftCommand(prepared, { commandId: "ack-legend-card", type: "ACKNOWLEDGE_DRAFT_LOTTERY", payload: {} });
    const legends = getAvailableDraftProspects(entered).filter((player) => player.historicalArchetypeName);
    expect(legends).toHaveLength(3);
    const markup = renderToStaticMarkup(createElement(App, { initialState: entered }));
    for (const player of legends) {
      expect(player.name).toBe(player.historicalArchetypeName);
      expect(markup).toContain(playerNameZh(player.name, player.id));
    }
    expect(markup).not.toContain("历史巨星");
  });
});
