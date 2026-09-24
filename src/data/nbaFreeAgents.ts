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
