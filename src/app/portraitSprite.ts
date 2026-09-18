import type { CSSProperties } from "react";
import { PORTRAIT_ATLAS_PLAYER_IDS } from "../data/portraitAtlasIds";

const ATLAS_COLUMNS = 25;
const portraitIds = PORTRAIT_ATLAS_PLAYER_IDS;

const portraitIndexById = new Map<string, number>(portraitIds.map((id, index) => [id, index]));

export interface PortraitSpriteMeta {
  index: number;
  source: string;
  style: CSSProperties;
}

export function portraitSpriteMeta(playerId: string, portraitPath?: string | null): PortraitSpriteMeta | null {
  if (!portraitPath) return null;
  const nbaId = playerId.match(/^nba:(\d+)$/u)?.[1] ?? portraitPath.match(/nba-(\d+)\.png$/u)?.[1];
  if (!nbaId) return null;
  const index = portraitIndexById.get(nbaId);
  if (index === undefined) return null;
  const column = index % ATLAS_COLUMNS;
  const row = Math.floor(index / ATLAS_COLUMNS);
  const source = `./player-portraits/nba-atlas-${String(row).padStart(3, "0")}.jpg`;
  return {
    index,
    source,
    style: {
      backgroundImage: `url("${source}")`,
      backgroundPosition: `${(column / Math.max(1, ATLAS_COLUMNS - 1)) * 100}% 0%`,
      backgroundSize: `${ATLAS_COLUMNS * 100}% 100%`,
    },
  };
}

export function portraitSpriteStyle(playerId: string, portraitPath?: string | null): CSSProperties | null {
  return portraitSpriteMeta(playerId, portraitPath)?.style ?? null;
}
