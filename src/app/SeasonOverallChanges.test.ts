import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { rolloverLeagueYear } from "../game/contracts/ContractLifecycleService";
import { createCareer } from "../game/season/career";
import { SeasonOverallChanges } from "./SeasonOverallChanges";

describe("new-season team OVR report", () => {
  it("lists every current roster player with their before and after OVR", () => {
    const state = createCareer("new-season-overall-view");
    state.league.currentPhase = "OFFSEASON";
    const next = rolloverLeagueYear(state);
    const markup = renderToStaticMarkup(createElement(SeasonOverallChanges, { state: next }));
    expect(markup).toContain("本队球员总评变化");
    const rows = markup.match(/class="option-phase-overall-row"/gu) ?? [];
    expect(rows).toHaveLength(next.teams[next.userTeamId].playerIds.length);
    for (const playerId of next.teams[next.userTeamId].playerIds) {
      const change = next.playerLifecycle?.userTeamOverallChanges?.find((entry) => entry.playerId === playerId);
      expect(change).toBeDefined();
      expect(markup).toContain(`data-player-id="${playerId}"`);
      expect(markup).toContain(`>${change!.before}</small><i aria-hidden="true">→</i>`);
    }
  });

  it("does not invent OVR changes for a save without the rollover snapshot", () => {
    const state = createCareer("old-season-overall-view");
    expect(renderToStaticMarkup(createElement(SeasonOverallChanges, { state }))).toBe("");
  });
});
