import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { rolloverLeagueYear } from "../game/contracts/ContractLifecycleService";
import { createCareer } from "../game/season/career";
import { SeasonOverallChanges } from "./SeasonOverallChanges";

describe("new-season team OVR report", () => {
  it("summarizes the entire roster but only lists players whose OVR changed", () => {
    const state = createCareer("new-season-overall-view");
    state.league.currentPhase = "OFFSEASON";
    const next = rolloverLeagueYear(state);
    const changes = next.playerLifecycle?.userTeamOverallChanges;
    expect(changes).toBeDefined();
    for (const entry of changes ?? []) entry.after = entry.before;
    const rosterIds = new Set(next.teams[next.userTeamId].playerIds);
    const currentChanges = changes!.filter((entry) => rosterIds.has(entry.playerId));
    expect(currentChanges.length).toBeGreaterThan(5);
    for (const entry of currentChanges.slice(0, 5)) entry.after += 2;
    currentChanges[1].after -= 3;
    const markup = renderToStaticMarkup(createElement(SeasonOverallChanges, { state: next }));
    expect(markup).toContain("本队球员总评变化");
    const rows = markup.match(/class="option-phase-overall-row"/gu) ?? [];
    expect(rows).toHaveLength(5);
    for (const entry of currentChanges.slice(0, 5)) expect(markup).toContain(`data-player-id="${entry.playerId}"`);
    expect(markup).not.toContain(`data-player-id="${currentChanges[5].playerId}"`);
    const currentRosterSize = next.teams[next.userTeamId].playerIds.length;
    expect(markup).toContain(`持平 <b>${currentRosterSize - 5}</b>`);
    expect(markup).toContain(`${currentRosterSize} 人`);
  });

  it("keeps a summary when every player's OVR is unchanged", () => {
    const state = createCareer("all-overall-unchanged");
    state.league.currentPhase = "OFFSEASON";
    const next = rolloverLeagueYear(state);
    for (const entry of next.playerLifecycle?.userTeamOverallChanges ?? []) entry.after = entry.before;
    const markup = renderToStaticMarkup(createElement(SeasonOverallChanges, { state: next }));
    expect(markup).toContain("本赛季暂无总评变化的球员");
    expect(markup).not.toContain("option-phase-overall-row");
  });

  it("does not invent OVR changes for a save without the rollover snapshot", () => {
    const state = createCareer("old-season-overall-view");
    expect(renderToStaticMarkup(createElement(SeasonOverallChanges, { state }))).toBe("");
  });
});
