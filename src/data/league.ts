import type { Conference, Division, Team } from "../game/state/types";
import { BALANCE_CONFIG } from "../config/balanceConfig";
import { EXISTING_TEAM_BRANDING } from "./teamBranding";

type TeamDefinition = Omit<Team, "playerIds">;

export const TEAM_MARKET_RATINGS: Record<string, number> = BALANCE_CONFIG.teamCore.marketRatings;

const team = (
  id: string,
  city: string,
  abbreviation: string,
  conference: Conference,
  division: Division,
  primaryColor: string,
  secondaryColor: string,
): TeamDefinition => {
  const branding = EXISTING_TEAM_BRANDING[id];
  const dayColor = branding?.dayColor ?? primaryColor.replace("#", "").toUpperCase();
  const nightColor = branding?.nightColor ?? secondaryColor.replace("#", "").toUpperCase();
  const cityCore = id === "SEA" ? { marketRating: TEAM_MARKET_RATINGS.SEA, franchiseReputation: 42, fanSupport: 58 }
    : id === "LVG" ? { marketRating: TEAM_MARKET_RATINGS.LVG, franchiseReputation: 42, fanSupport: 58 }
      : {
        marketRating: TEAM_MARKET_RATINGS[id],
        franchiseReputation: 52 + [...id].reduce((sum, character) => sum + character.charCodeAt(0) * 3, 0) % 34,
        fanSupport: 52 + [...id].reduce((sum, character) => sum + character.charCodeAt(0) * 5, 0) % 35,
      };
  return {
    id,
    sourceTeamId: branding?.sourceTeamId,
    city,
    name: branding?.name ?? `${city}队`,
    fullName: branding?.fullName ?? `${city}队`,
    englishName: branding?.englishName ?? `${city} Club`,
    abbreviation,
    conference,
    division,
    primaryColor: `#${dayColor}`,
    secondaryColor: `#${nightColor}`,
    dayColor,
    nightColor,
    logoUrl: branding?.logoUrl,
    arena: branding?.arena,
    ...cityCore,
    currentStreak: 0,
  };
};

export const TEAM_DEFINITIONS: TeamDefinition[] = [
  team("SEA", "西雅图", "SEA", "WEST", "PACIFIC_NORTHWEST", "#19d3ae", "#072e33"),
  team("POR", "波特兰", "POR", "WEST", "PACIFIC_NORTHWEST", "#ef4444", "#311111"),
  team("SAC", "萨克拉门托", "SAC", "WEST", "PACIFIC_NORTHWEST", "#a78bfa", "#25124a"),
  team("GSW", "金州", "GSW", "WEST", "PACIFIC_NORTHWEST", "#f8c33a", "#153e75"),
  team("LVG", "拉斯维加斯", "LVG", "WEST", "PACIFIC_SOUTH", "#f97316", "#3f1707"),
  team("PHX", "菲尼克斯", "PHX", "WEST", "PACIFIC_SOUTH", "#fb923c", "#431407"),
  team("LAL", "洛杉矶", "LAG", "WEST", "PACIFIC_SOUTH", "#facc15", "#3b1b68"),
  team("LAC", "洛杉矶", "LAB", "WEST", "PACIFIC_SOUTH", "#60a5fa", "#1e293b"),
  team("UTA", "犹他", "UTA", "WEST", "MOUNTAIN", "#38bdf8", "#082f49"),
  team("DEN", "丹佛", "DEN", "WEST", "MOUNTAIN", "#fbbf24", "#172554"),
  team("OKC", "俄克拉荷马城", "OKC", "WEST", "MOUNTAIN", "#38bdf8", "#7c2d12"),
  team("DAL", "达拉斯", "DAL", "WEST", "MOUNTAIN", "#2563eb", "#0f172a"),
  team("HOU", "休斯顿", "HOU", "WEST", "SOUTHWEST", "#dc2626", "#2b0b0b"),
  team("SAS", "圣安东尼奥", "SAS", "WEST", "SOUTHWEST", "#cbd5e1", "#111827"),
  team("MEM", "孟菲斯", "MEM", "WEST", "SOUTHWEST", "#93c5fd", "#172554"),
  team("NOP", "新奥尔良", "NOP", "WEST", "SOUTHWEST", "#eab308", "#172554"),
  team("BOS", "波士顿", "BOS", "EAST", "NORTHEAST", "#22c55e", "#052e16"),
  team("BKN", "布鲁克林", "BKN", "EAST", "NORTHEAST", "#e5e7eb", "#111827"),
  team("NYK", "纽约", "NYK", "EAST", "NORTHEAST", "#fb923c", "#1e3a8a"),
  team("TOR", "多伦多", "TOR", "EAST", "NORTHEAST", "#ef4444", "#18181b"),
  team("PHI", "费城", "PHI", "EAST", "MID_ATLANTIC", "#60a5fa", "#7f1d1d"),
  team("WAS", "华盛顿", "WAS", "EAST", "MID_ATLANTIC", "#ef4444", "#172554"),
  team("CLE", "克里夫兰", "CLE", "EAST", "MID_ATLANTIC", "#facc15", "#450a0a"),
  team("DET", "底特律", "DET", "EAST", "MID_ATLANTIC", "#60a5fa", "#7f1d1d"),
  team("MIN", "明尼苏达", "MIN", "EAST", "CENTRAL", "#4ade80", "#172554"),
  team("MIL", "密尔沃基", "MIL", "EAST", "CENTRAL", "#22c55e", "#f5f5dc"),
  team("CHI", "芝加哥", "CHI", "EAST", "CENTRAL", "#ef4444", "#18181b"),
  team("IND", "印第安纳", "IND", "EAST", "CENTRAL", "#facc15", "#172554"),
  team("ATL", "亚特兰大", "ATL", "EAST", "SOUTHEAST", "#ef4444", "#facc15"),
  team("CHA", "夏洛特", "CHA", "EAST", "SOUTHEAST", "#22d3ee", "#581c87"),
  team("ORL", "奥兰多", "ORL", "EAST", "SOUTHEAST", "#38bdf8", "#111827"),
  team("MIA", "迈阿密", "MIA", "EAST", "SOUTHEAST", "#fb7185", "#18181b"),
];

export const teamsByConference = (conference: Conference): TeamDefinition[] =>
  TEAM_DEFINITIONS.filter((entry) => entry.conference === conference);
