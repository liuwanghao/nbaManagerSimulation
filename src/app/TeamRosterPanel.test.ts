import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LINEUP_POSITIONS, buildDefaultRotationPlan, projectedRotationBench } from "../game/roster/RotationPlanService";
import { createCareer } from "../game/season/career";
import { TeamRosterPanel, filterPreviewRosterPlayers } from "./TeamRosterPanel";

describe("TeamRosterPanel", () => {
  it("keeps the full-roster position filters and one card per player", () => {
    const state = createCareer("roster-panel-filters");
    const players = state.teams[state.userTeamId].playerIds.map((id) => state.players[id]);
    const markup = renderToStaticMarkup(createElement(TeamRosterPanel, { players, variant: "season", onOpenPlayer: () => {} }));

    expect(markup).toContain("按主位置筛选球队阵容");
    for (const label of ["全部", "PG", "SG", "SF", "PF", "C"]) expect(markup).toContain(`>${label}</b>`);
    expect(markup.match(/data-testid="season-player-/g)).toHaveLength(players.length);
  });

  it("shows every player while distinguishing starters, reserves, non-rotation, and injury", () => {
    const state = createCareer("roster-panel-preview");
    const players = state.teams[state.userTeamId].playerIds.map((id) => state.players[id]);
    const plan = buildDefaultRotationPlan(players);
    const originalPg = plan.starters.PG;
    plan.starters.PG = plan.starters.SG;
    plan.starters.SG = originalPg;
    const starterIds = new Set(Object.values(plan.starters));
    const starterPositions = new Map(LINEUP_POSITIONS.map((position) => [plan.starters[position], position] as const));
    const reserveIds = new Set(projectedRotationBench(players, plan, starterIds).map((player) => player.id));
    const injuredPlayer = players.find((player) => !starterIds.has(player.id) && !reserveIds.has(player.id))!;
    injuredPlayer.available = false;
    injuredPlayer.injury = {
      injuryId: "preview-injury",
      severity: "MINOR",
      gamesRemaining: 2,
      occurredSeasonId: state.league.seasonId,
      occurredGameId: "preview-game",
      previousRotationRole: injuredPlayer.rotationRole,
    };

    const markup = renderToStaticMarkup(createElement(TeamRosterPanel, {
      players, variant: "preview", onOpenPlayer: () => {},
      previewRotation: { starterIds, starterPositions, reserveIds, targetMinutes: plan.targetMinutes },
    }));
    expect(markup).toContain("按上场状态筛选球队阵容");
    for (const label of ["全部", "首发", "轮换", "未激活"]) expect(markup).toContain(`>${label}</b>`);
    expect(markup.match(/data-testid="preview-player-/g)).toHaveLength(players.length);
    expect(markup.match(/roster-preview-status status-0/g)).toHaveLength(5);
    expect(markup.match(/class="roster-preview-slot"/g)).toHaveLength(5);
    for (const position of ["PG", "SG", "SF", "PF", "C"]) expect(markup).toContain(`class="roster-preview-slot">${position}</b>`);
    const pgCard = markup.split(`data-player-id="${plan.starters.PG}"`)[1]?.split("</article>")[0];
    expect(pgCard).toContain('class="roster-preview-slot">PG</b>');
    expect(markup.match(/roster-preview-status status-1/g)).toHaveLength(5);
    expect(markup.match(/roster-preview-status status-2/g)).toHaveLength(players.length - 10);
    expect(markup).toContain("伤病");

    const rotation = { starterIds, starterPositions, reserveIds, targetMinutes: plan.targetMinutes };
    expect(filterPreviewRosterPlayers(players, "ALL", rotation)).toHaveLength(players.length);
    expect(filterPreviewRosterPlayers(players, "STARTER", rotation).map((player) => player.id)).toEqual(LINEUP_POSITIONS.map((position) => plan.starters[position]));
    expect(filterPreviewRosterPlayers(players, "STARTER", rotation)).toHaveLength(starterIds.size);
    expect(filterPreviewRosterPlayers(players, "ROTATION", rotation)).toHaveLength(reserveIds.size);
    const inactive = filterPreviewRosterPlayers(players, "INACTIVE", rotation);
    expect(inactive).toHaveLength(players.length - starterIds.size - reserveIds.size);
    expect(inactive.map((player) => player.id)).toContain(injuredPlayer.id);
  });
});
