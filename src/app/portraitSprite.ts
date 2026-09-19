import type { CSSProperties } from "react";
import { PORTRAIT_ATLAS_PLAYER_IDS } from "../data/portraitAtlasIds";

const ATLAS_COLUMNS = 25;
// Explicit paths make every runtime sprite resource auditable in the static package.
const ATLAS_IMAGES = [
  "./player-portraits/nba-atlas-000.jpg",
  "./player-portraits/nba-atlas-001.jpg",
  "./player-portraits/nba-atlas-002.jpg",
  "./player-portraits/nba-atlas-003.jpg",
  "./player-portraits/nba-atlas-004.jpg",
  "./player-portraits/nba-atlas-005.jpg",
  "./player-portraits/nba-atlas-006.jpg",
  "./player-portraits/nba-atlas-007.jpg",
  "./player-portraits/nba-atlas-008.jpg",
  "./player-portraits/nba-atlas-009.jpg",
  "./player-portraits/nba-atlas-010.jpg",
  "./player-portraits/nba-atlas-011.jpg",
  "./player-portraits/nba-atlas-012.jpg",
  "./player-portraits/nba-atlas-013.jpg",
  "./player-portraits/nba-atlas-014.jpg",
  "./player-portraits/nba-atlas-015.jpg",
  "./player-portraits/nba-atlas-016.jpg",
  "./player-portraits/nba-atlas-017.jpg",
  "./player-portraits/nba-atlas-018.jpg",
  "./player-portraits/nba-atlas-019.jpg",
  "./player-portraits/nba-atlas-020.jpg",
  "./player-portraits/nba-atlas-021.jpg",
  "./player-portraits/nba-atlas-022.jpg",
  "./player-portraits/nba-atlas-023.jpg",
  "./player-portraits/nba-atlas-024.jpg",
  "./player-portraits/nba-atlas-025.jpg",
] as const;
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
  const source = ATLAS_IMAGES[row];
  if (!source) return null;
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
