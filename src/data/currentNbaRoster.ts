import rawRoster from "./nba-current-roster.json";

export interface CurrentNbaRosterPlayer {
  nbaPlayerId: string;
  fullName: string;
  teamAbbreviation: string;
  jerseyNumber: string | null;
  position: string;
  height: string | null;
  weight: number | null;
}

export interface CurrentNbaRoster {
  schemaVersion: 1;
  rosterVersion: string;
  retrievedAt: string;
  sourceId: string;
  players: CurrentNbaRosterPlayer[];
}

function validateCurrentNbaRoster(value: unknown): CurrentNbaRoster {
  if (!value || typeof value !== "object") throw new Error("Current NBA roster must be an object");
  const roster = value as CurrentNbaRoster;
  if (roster.schemaVersion !== 1 || !roster.rosterVersion || !["embedded-current-roster-snapshot", "nba.com-official-players-directory"].includes(roster.sourceId)) {
    throw new Error("Current NBA roster metadata is invalid");
  }
  if (!Array.isArray(roster.players) || roster.players.length < 450) throw new Error("Current NBA roster is incomplete");
  const playerIds = new Set<string>();
  const teamCounts = new Map<string, number>();
  for (const player of roster.players) {
    if (!player.nbaPlayerId || playerIds.has(player.nbaPlayerId)) throw new Error(`Duplicate current NBA player ${player.nbaPlayerId}`);
    if (!/^[A-Z]{3}$/u.test(player.teamAbbreviation)) throw new Error(`Invalid current NBA team for ${player.fullName}`);
    playerIds.add(player.nbaPlayerId);
    teamCounts.set(player.teamAbbreviation, (teamCounts.get(player.teamAbbreviation) ?? 0) + 1);
  }
  if (teamCounts.size !== 30) throw new Error(`Current NBA roster covers ${teamCounts.size}/30 teams`);
  return roster;
}

export const CURRENT_NBA_ROSTER = validateCurrentNbaRoster(rawRoster);
export const CURRENT_NBA_ROSTER_BY_ID = new Map(CURRENT_NBA_ROSTER.players.map((player) => [player.nbaPlayerId, player] as const));
