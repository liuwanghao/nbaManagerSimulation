import rawProjections from "./nba-free-agent-projections.json";
import { CURRENT_NBA_ROSTER_BY_ID } from "./currentNbaRoster";
import { NBA_2026_FREE_AGENTS } from "./nbaFreeAgents";
import type { NbaPlayerProjection } from "./nbaPlayerDataset";

const snapshotById = new Map(NBA_2026_FREE_AGENTS.players.map((player) => [player.nbaPlayerId, player]));
const projections = rawProjections as NbaPlayerProjection[];
const seen = new Set<string>();
for (const player of projections) {
  if (!snapshotById.has(player.nbaPlayerId) || CURRENT_NBA_ROSTER_BY_ID.has(player.nbaPlayerId) || seen.has(player.nbaPlayerId)) {
    throw new Error(`Invalid free-agent projection identity ${player.nbaPlayerId}`);
  }
  if (!Object.values(player.projection.attributes).every((value) => Number.isInteger(value) && value >= 25 && value <= 99)) {
    throw new Error(`Invalid free-agent attributes for ${player.nbaPlayerId}`);
  }
  if (!Number.isInteger(player.age) || player.age < 18 || player.age > 50
    || !Number.isInteger(player.projection.overall) || player.projection.overall < 25 || player.projection.overall > 99) {
    throw new Error(`Invalid free-agent age or rating for ${player.nbaPlayerId}`);
  }
  seen.add(player.nbaPlayerId);
}
if (seen.size !== snapshotById.size) throw new Error(`Free-agent profile coverage is ${seen.size}/${snapshotById.size}`);

export const NBA_FREE_AGENT_PROJECTIONS = projections;
