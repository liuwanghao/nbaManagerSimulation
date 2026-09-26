import rawSnapshot from "./nba-2026-free-agents.json";
import retiredPlayers from "./nba-retired-players.json";

export interface NbaFreeAgentSnapshot {
  schemaVersion: 1;
  season: "2026";
  sourceId: "NBA_OFFICIAL_FREE_AGENT_TRACKER";
  retrievedAt: string;
  players: Array<{
    nbaPlayerId: string;
    fullName: string;
    status: "UFA" | "RFA";
    previousNbaTeamId: string;
    twoWay: boolean;
  }>;
}

export function validateNbaFreeAgents(value: unknown): NbaFreeAgentSnapshot {
  const snapshot = value as NbaFreeAgentSnapshot;
  if (snapshot?.schemaVersion !== 1 || snapshot.season !== "2026" || snapshot.sourceId !== "NBA_OFFICIAL_FREE_AGENT_TRACKER" || !Number.isFinite(Date.parse(snapshot.retrievedAt)) || !Array.isArray(snapshot.players)) {
    throw new Error("Invalid NBA free-agent snapshot metadata");
  }
  const seen = new Set<string>();
  const retiredIds = new Set(retiredPlayers.players.map((player) => player.nbaPlayerId));
  for (const player of snapshot.players) {
    if (!/^\d+$/u.test(player.nbaPlayerId) || !player.fullName || !["UFA", "RFA"].includes(player.status) || !/^\d+$/u.test(player.previousNbaTeamId) || typeof player.twoWay !== "boolean" || seen.has(player.nbaPlayerId) || retiredIds.has(player.nbaPlayerId)) {
      throw new Error(`Invalid or duplicate NBA free agent: ${player.nbaPlayerId}`);
    }
    seen.add(player.nbaPlayerId);
  }
  return snapshot;
}

export const NBA_2026_FREE_AGENTS = validateNbaFreeAgents(rawSnapshot);

// NBA team IDs in the free-agent tracker are different from this game's team IDs.
export const NBA_TEAM_ID_TO_GAME_TEAM_ID: Record<string, string> = {
  "1610612737": "ATL", "1610612738": "BOS", "1610612739": "CLE", "1610612740": "NOP",
  "1610612741": "CHI", "1610612742": "DAL", "1610612743": "DEN", "1610612744": "GSW",
  "1610612745": "HOU", "1610612746": "LAC", "1610612747": "LAL", "1610612748": "MIA",
  "1610612749": "MIL", "1610612750": "MIN", "1610612751": "BKN", "1610612752": "NYK",
  "1610612753": "ORL", "1610612754": "IND", "1610612755": "PHI", "1610612756": "PHX",
  "1610612757": "POR", "1610612758": "SAC", "1610612759": "SAS", "1610612760": "OKC",
  "1610612761": "TOR", "1610612762": "UTA", "1610612763": "MEM", "1610612764": "WAS",
  "1610612765": "DET", "1610612766": "CHA",
};
