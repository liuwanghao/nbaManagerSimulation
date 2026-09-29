import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildDefaultRotationPlan } from "../game/roster/RotationPlanService";
import { createCareer } from "../game/season/career";
import type { TeamRotationPlan } from "../game/state/types";
import { RotationEditor, limitedRotationMinutes, swapRotationPositions } from "./RotationEditor";

const plan: TeamRotationPlan = {
  starters: { PG: "pg", SG: "sg", SF: "sf", PF: "pf", C: "c" },
  targetMinutes: { pg: 34, sg: 32, sf: 30, pf: 34, c: 34, bench: 20, bench2: 18, bench3: 0, bench4: 0 },
  benchOrder: ["bench", "bench2", "bench3", "bench4"],
  selectionMode: "AUTO",
};

describe("rotation card position swap", () => {
  it("caps typed and stepped minutes at the remaining team allowance", () => {
    expect(limitedRotationMinutes(20, 238, 30, 40)).toBe(22);
    expect(limitedRotationMinutes(20, 240, 21, 40)).toBe(20);
    expect(limitedRotationMinutes(20, 240, 19, 40)).toBe(19);
    expect(limitedRotationMinutes(20, 230, 50, 40)).toBe(30);
    expect(limitedRotationMinutes(20, 230, -1, 40)).toBe(0);
  });

  it("disables every increase button when all 240 team minutes are assigned", () => {
    const state = createCareer("rotation-minute-cap");
    const players = state.teams[state.userTeamId].playerIds.map((id) => state.players[id]);
    const rotation = buildDefaultRotationPlan(players);
    const markup = renderToStaticMarkup(createElement(RotationEditor, {
      players, plan: rotation, postseason: false, busy: false, onSave: () => {},
    }));
    expect(markup).toContain("时间已分配完，先减少再增加");
    expect(markup.match(/aria-label="[^"]+增加一分钟" disabled=""/g)).toHaveLength(players.length);
  });

  it("explains why a five-player roster cannot reach 240 minutes", () => {
    const state = createCareer("rotation-five-available");
    const players = state.teams[state.userTeamId].playerIds.map((id) => state.players[id]);
    for (const player of players.slice(5)) player.available = false;
    const markup = renderToStaticMarkup(createElement(RotationEditor, {
      players, plan: buildDefaultRotationPlan(players), postseason: false, busy: false, onSave: () => {},
    }));
    expect(markup).toContain("200 / 240");
    expect(markup).toContain("至少需要 6 名可出战球员才能分配 240 分钟");
    expect(markup).toContain('data-testid="save-rotation-plan" disabled=""');
  });

  it("exchanges two starter slots without changing either player's minutes", () => {
    const swapped = swapRotationPositions(plan, "pg", "sg");
    expect(swapped?.starters).toEqual({ PG: "sg", SG: "pg", SF: "sf", PF: "pf", C: "c" });
    expect(swapped?.targetMinutes).toEqual(plan.targetMinutes);
    expect(swapped?.selectionMode).toBe("MANUAL");
    expect(plan.starters.PG).toBe("pg");
  });

  it("promotes a bench player while leaving minutes attached to each player", () => {
    const swapped = swapRotationPositions(plan, "bench", "pg");
    expect(swapped?.starters.PG).toBe("bench");
    expect(Object.values(swapped!.starters)).not.toContain("pg");
    expect(swapped?.targetMinutes.pg).toBe(34);
    expect(swapped?.targetMinutes.bench).toBe(20);
  });

  it("swaps two active reserves' numbered order without moving their minutes", () => {
    const swapped = swapRotationPositions(plan, "bench", "bench2");
    expect(swapped?.benchOrder).toEqual(["bench2", "bench", "bench3", "bench4"]);
    expect(swapped?.targetMinutes).toEqual(plan.targetMinutes);
    expect(swapped?.selectionMode).toBe("MANUAL");
    expect(plan.benchOrder).toEqual(["bench", "bench2", "bench3", "bench4"]);
  });

  it("keeps a promoted reserve's former bench rank for the demoted starter", () => {
    expect(swapRotationPositions(plan, "pg", "bench")?.benchOrder).toEqual(["pg", "bench2", "bench3", "bench4"]);
  });

  it("lets a zero-minute reserve replace an active reserve and inherit the target minutes", () => {
    const swapped = swapRotationPositions(plan, "bench", "bench3");
    expect(swapped?.benchOrder).toEqual(["bench3", "bench2", "bench", "bench4"]);
    expect(swapped?.targetMinutes.bench3).toBe(20);
    expect(swapped?.targetMinutes.bench).toBe(0);
  });

  it("lets two zero-minute reserves exchange their depth order", () => {
    expect(swapRotationPositions(plan, "bench3", "bench4")?.benchOrder).toEqual(["bench", "bench2", "bench4", "bench3"]);
  });

  it("shows all non-starters in one bench list, with zero-minute players and injured players last", () => {
    const state = createCareer("rotation-card-layout");
    const players = state.teams[state.userTeamId].playerIds.map((id) => state.players[id]);
    const injured = players[players.length - 1];
    injured.available = false;
    injured.injury = {
      injuryId: "rotation-card-injury", severity: "MINOR", gamesRemaining: 3,
      occurredSeasonId: state.league.seasonId, occurredGameId: "rotation-card-game",
      previousRotationRole: injured.rotationRole,
    };
    const rotation = buildDefaultRotationPlan(players);
    const starterIds = new Set(Object.values(rotation.starters));
    const zeroMinute = players.find((player) => !starterIds.has(player.id) && !player.injury && !rotation.targetMinutes[player.id]);
    expect(zeroMinute).toBeDefined();
    const markup = renderToStaticMarkup(createElement(RotationEditor, {
      players, plan: rotation, postseason: false, busy: false, onSave: () => {},
    }));
    const benchMarkup = markup.split('aria-label="主要替补"')[1]?.split("</section>")[0] ?? "";
    const benchIds = [...benchMarkup.matchAll(/data-player-id="([^"]+)"/g)].map((match) => match[1]);
    expect(markup.match(/class="rotation-assigned-slot/g)).toHaveLength(10);
    expect(benchMarkup).toContain('title="替补第 6 顺位"');
    expect(benchMarkup).toContain('title="替补第 10 顺位"');
    expect(markup.match(/class="rotation-player-pick"/g)).toHaveLength(players.length);
    expect(markup.match(/class="gemini-prospect-avatar rotation-player-avatar/g)).toHaveLength(players.length);
    expect(markup).not.toContain('aria-label="其他球员"');
    expect(benchIds).toHaveLength(players.length - 5);
    expect(benchIds).toContain(zeroMinute!.id);
    expect(benchMarkup.split(`data-player-id="${zeroMinute!.id}"`)[1]?.split("</article>")[0]).toContain('value="0"');
    expect(benchIds.at(-1)).toBe(injured.id);
    expect(benchMarkup).toContain("伤停约 7 天");
    expect(markup).toContain("一键自动匹配");
    expect(markup).toContain("PG");
    expect(markup).not.toMatch(/LINEUP CONTROL|STARTERS|BENCH|>MIN</u);
    expect(markup).not.toContain("rotation-starter-select");
  });

  it("shows ranks 11 and 12 when the manager assigns twelve active players", () => {
    const state = createCareer("rotation-twelve-bench-ranks");
    const players = state.teams[state.userTeamId].playerIds.map((id) => state.players[id]);
    const rotation = buildDefaultRotationPlan(players);
    const extras = players.filter((player) => player.available && !player.injury && !rotation.targetMinutes[player.id]).slice(0, 2);
    const donors = players.filter((player) => (rotation.targetMinutes[player.id] ?? 0) > 20).slice(0, 2);
    extras.forEach((player, index) => { rotation.targetMinutes[player.id] = 8; rotation.targetMinutes[donors[index].id] -= 8; });
    rotation.selectionMode = "MANUAL";
    const markup = renderToStaticMarkup(createElement(RotationEditor, {
      players, plan: rotation, postseason: false, busy: false, onSave: () => {},
    }));
    expect(markup).toContain('title="替补第 11 顺位"');
    expect(markup).toContain('title="替补第 12 顺位"');
  });
});
