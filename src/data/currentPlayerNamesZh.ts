import rawNames from "./nba-player-names-zh.json";

export interface CurrentPlayerNamesZh {
  schemaVersion: 1;
  version: string;
  retrievedAt: string;
  sourceUrl: "https://china.nba.cn/playerindex";
  namesByNbaPlayerId: Record<string, string>;
}

function validateCurrentPlayerNamesZh(value: unknown): CurrentPlayerNamesZh {
  if (!value || typeof value !== "object") throw new Error("Current player Chinese names must be an object");
  const snapshot = value as CurrentPlayerNamesZh;
  if (snapshot.schemaVersion !== 1 || !snapshot.version || snapshot.sourceUrl !== "https://china.nba.cn/playerindex") {
    throw new Error("Current player Chinese name metadata is invalid");
  }
  const entries = Object.entries(snapshot.namesByNbaPlayerId ?? {});
  if (entries.length < 450) throw new Error(`Current player Chinese name snapshot is incomplete (${entries.length})`);
  for (const [playerId, name] of entries) {
    if (!/^\d+$/u.test(playerId) || !name || !/\p{Script=Han}/u.test(name)) {
      throw new Error(`Invalid current player Chinese name ${playerId}:${name}`);
    }
  }
  return snapshot;
}

export const CURRENT_PLAYER_NAMES_ZH = validateCurrentPlayerNamesZh(rawNames);

export function nbaPlayerIdFromCanonicalId(canonicalId: string | undefined): string | undefined {
  if (!canonicalId) return undefined;
  const match = canonicalId.match(/(?:^|:)\s*(\d+)$/u);
  return match?.[1];
}

export function currentPlayerNameZh(nbaPlayerId: string | undefined): string | undefined {
  return nbaPlayerId ? CURRENT_PLAYER_NAMES_ZH.namesByNbaPlayerId[nbaPlayerId] : undefined;
}
