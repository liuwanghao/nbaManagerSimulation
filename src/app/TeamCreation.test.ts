import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createExpansionCareer } from "../game/season/career";
import { EXPANSION_BRAND_PRESETS, EXPANSION_CITY_NAMES, EXPANSION_TEAM_NAME_OPTIONS } from "../data/expansionBrands";
import { createExpansionTeam } from "../game/expansion/ExpansionService";
import { ExpansionFlow } from "./ExpansionFlow";

describe("preset expansion team names", () => {
  it("offers the exact six names for each city", () => {
    expect(EXPANSION_TEAM_NAME_OPTIONS.LVG).toEqual(["闪电", "幻影", "毒蛇", "皇家", "霓虹", "毒液"]);
    expect(EXPANSION_TEAM_NAME_OPTIONS.SEA).toEqual(["超音速", "翡翠", "领航者", "虎鲸", "登山者", "大脚怪"]);
  });
  it("creates a valid team for every supplied city and name", () => {
    for (const cityId of ["LVG", "SEA"] as const) {
      const preset = EXPANSION_BRAND_PRESETS[cityId][0];
      for (const teamName of EXPANSION_TEAM_NAME_OPTIONS[cityId]) {
        const state = createExpansionTeam(createExpansionCareer("preset-team-names"), { cityId, teamName, presetId: preset.presetId, primaryColor: preset.primaryColor, secondaryColor: preset.secondaryColor });
        expect(state.teams[cityId].fullName).toBe(`${EXPANSION_CITY_NAMES[cityId]}${teamName}`);
        expect(state.teams[cityId].logoUrl).toBe(preset.logoUrl);
      }
    }
  });
  it("shows name choices and a community contribution entry without a free-text name input", () => {
    const markup = renderToStaticMarkup(createElement(ExpansionFlow, { state: createExpansionCareer("team-name-ui"), busy: false, status: "", onCommand: async () => true, onSave: async () => {}, onLoad: async () => true, onLoadLatest: async () => true, saveSlots: [], activeSlot: 1, onSlotChange: () => {} }));
    expect(markup).toContain('aria-labelledby="team-name-label"');
    for (const name of EXPANSION_TEAM_NAME_OPTIONS.SEA) expect(markup).toContain(`<span>${name}</span>`);
    expect(markup).toContain("西雅图超音速");
    expect(markup).toContain("投稿球队名字");
    expect(markup).not.toContain('id="team-name"');
  });
});
