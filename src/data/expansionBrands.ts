import { stableHash } from "../game/random/hash";
import { createRng } from "../game/random/xoshiro";
import type { ExpansionBrand, ExpansionCityId } from "../game/state/types";

const expansionLogo = (fileName: string): string => `./expansion-logos/${fileName}`;

export const EXPANSION_CITY_NAMES: Record<ExpansionCityId, string> = {
  SEA: "西雅图",
  LVG: "拉斯维加斯",
};

export const SAFE_TEAM_COLORS = [
  "#19d3ae", "#0f766e", "#38bdf8", "#1d4ed8", "#a78bfa", "#7e22ce",
  "#fb7185", "#dc2626", "#f97316", "#facc15", "#84cc16", "#e5e7eb",
  "#072e33", "#172554", "#052e16", "#111827", "#4c1d95", "#431407", "#312e81", "#581c87",
];

export const EXPANSION_BRAND_PRESETS: Record<ExpansionCityId, ExpansionBrand[]> = {
  SEA: [
    { presetId: "sea-emerald-tide", teamName: "翡翠潮", shortName: "翡翠潮", logoAssetId: "seattle-default", logoUrl: expansionLogo("seattle-default.png"), primaryColor: "#19d3ae", secondaryColor: "#072e33" },
  ],
  LVG: [
    { presetId: "lvg-voltage", teamName: "电压", shortName: "电压", logoAssetId: "las-vegas-default", logoUrl: expansionLogo("las-vegas-default.png"), primaryColor: "#581c87", secondaryColor: "#facc15" },
  ],
};

export const getCityAbbreviation = (cityId: ExpansionCityId): ExpansionCityId => cityId;

export function pickAiBrand(careerSeed: string, cityId: ExpansionCityId): ExpansionBrand {
  const presets = EXPANSION_BRAND_PRESETS[cityId];
  const rng = createRng(stableHash(careerSeed, cityId, "brand"));
  return structuredClone(presets[rng.int(0, presets.length - 1)]);
}
