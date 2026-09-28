import { describe, expect, it } from "vitest";
import { SAFE_TEAM_COLORS } from "../data/expansionBrands";
import { TEAM_DEFINITIONS } from "../data/league";
import { postgameAccentColor } from "./postgameAccentColor";

const luminance = (hex: string): number => {
  const channels = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255);
  const [red, green, blue] = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
};

describe("postgameAccentColor", () => {
  it("brightens dark team colors while keeping their hue recognizable", () => {
    const purple = postgameAccentColor("#581c87");
    expect(purple).not.toBe("#581c87");
    const channels = [1, 3, 5].map((index) => Number.parseInt(purple.slice(index, index + 2), 16));
    expect(channels[2]).toBeGreaterThan(channels[0]);
    expect(channels[0]).toBeGreaterThan(channels[1]);
  });

  it("keeps already legible team colors unchanged", () => {
    expect(postgameAccentColor("#facc15")).toBe("#facc15");
  });

  it("gives every league and selectable expansion color readable small-text contrast", () => {
    const background = luminance("#10182a");
    const colors = [...TEAM_DEFINITIONS.map((team) => team.primaryColor), ...SAFE_TEAM_COLORS];
    for (const color of colors) {
      const accent = postgameAccentColor(color);
      const contrast = (luminance(accent) + 0.05) / (background + 0.05);
      expect(contrast, `${color} became ${accent}`).toBeGreaterThanOrEqual(7);
    }
  });
});
