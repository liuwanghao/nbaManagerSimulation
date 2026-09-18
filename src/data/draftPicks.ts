import type { DraftPickAsset, Team } from "../game/state/types";

export function createFutureDraftPicks(teams: Record<string, Team>, startYear = 2027): Record<string, DraftPickAsset> {
  const assets: Record<string, DraftPickAsset> = {};
  for (const teamId of Object.keys(teams).sort()) {
    for (let year = startYear; year <= startYear + 6; year += 1) {
      for (const round of [1, 2] as const) {
        const id = `${year}-R${round}-${teamId}`;
        assets[id] = { id, year, round, originalTeamId: teamId, ownerTeamId: teamId };
      }
    }
  }
  return assets;
}
