import rawDataset from "./nba-player-dataset.json";
import type { PlayerAttributes, PlayerTrait, Position } from "../game/state/types";

export interface NbaPlayerProjection {
  canonicalPlayerId: string;
  nbaPlayerId: string;
  hupuPlayerId: string | null;
  fullName: string;
  aliases: string[];
  teamAbbreviation: string;
  jerseyNumber: string | null;
  position: Position;
  secondaryPosition: Position | null;
  positionSource: "NBA2K" | "MANUAL_OVERRIDE" | "INFERRED";
  age: number;
  heightCm: number | null;
  weightKg: number | null;
  portraitPath?: string | null;
  season: string;
  stats: Record<string, Record<string, number | string | null>>;
  projection: {
    attributes: PlayerAttributes;
    overall: number;
    potential: number;
    durability: number;
    personalitySeed: string;
    qualityFlags: string[];
  };
}

export interface HistoricalPlayerTemplate {
  sourcePlayerId: string;
  sourceName: string;
  sourceSeason: string;
  peakSeason: string;
  era: string;
  position: Position;
  heightCm: number;
  weightKg: number;
  rookieAttributes: PlayerAttributes;
  peakOverall: number;
  durability: number;
  tendencies: { threeRate: number; assistRate: number; rimRate: number; usageTendency: number };
  traits: PlayerTrait[];
  eligible: boolean;
}

export interface NbaPlayerDataset {
  schemaVersion: 2;
  datasetVersion: string;
  generatedAt: string;
  ratingModelVersion: string;
  positionModelVersion: string;
  source: {
    nbaApiVersion: string;
    currentSeason: string;
    historicalSeasons: string[];
    endpoints: string[];
    hupuMappingVersion: string;
    nba2k?: {
      snapshotVersion: string;
      provider: string;
      sourceId: string;
      official: boolean;
      mappingVersion: string;
      syncedAt?: string;
    };
  };
  players: NbaPlayerProjection[];
  historicalTemplates: HistoricalPlayerTemplate[];
}

const POSITIONS = new Set<Position>(["PG", "SG", "SF", "PF", "C"]);
const POSITION_SOURCES = new Set<NbaPlayerProjection["positionSource"]>(["NBA2K", "MANUAL_OVERRIDE", "INFERRED"]);
const ATTRIBUTE_KEYS: Array<keyof PlayerAttributes> = [
  "shooting", "finishing", "playmaking", "perimeterDefense",
  "interiorDefense", "rebounding", "athleticism", "basketballIq",
];

function assertAttributes(value: PlayerAttributes, context: string): void {
  for (const key of ATTRIBUTE_KEYS) {
    if (!Number.isInteger(value[key]) || value[key] < 25 || value[key] > 99) {
      throw new Error(`${context}.${key} must be an integer from 25 to 99`);
    }
  }
}

export function validateNbaPlayerDataset(value: unknown): NbaPlayerDataset {
  if (!value || typeof value !== "object") throw new Error("NBA player dataset must be an object");
  const dataset = value as NbaPlayerDataset;
  if (dataset.schemaVersion !== 2) throw new Error(`Unsupported NBA player dataset schema ${String(dataset.schemaVersion)}`);
  if (!dataset.datasetVersion || !dataset.generatedAt || !dataset.ratingModelVersion || !dataset.positionModelVersion) {
    throw new Error("NBA player dataset version metadata is incomplete");
  }
  if (!Array.isArray(dataset.players) || !Array.isArray(dataset.historicalTemplates)) throw new Error("NBA player dataset arrays are missing");
  const playerIds = new Set<string>();
  for (const player of dataset.players) {
    if (!player.canonicalPlayerId || playerIds.has(player.canonicalPlayerId)) throw new Error(`Duplicate NBA player ${player.canonicalPlayerId}`);
    playerIds.add(player.canonicalPlayerId);
    if (!POSITIONS.has(player.position)) throw new Error(`Invalid position for ${player.canonicalPlayerId}`);
    if (player.secondaryPosition !== null && !POSITIONS.has(player.secondaryPosition)) {
      throw new Error(`Invalid secondary position for ${player.canonicalPlayerId}`);
    }
    if (player.secondaryPosition === player.position) throw new Error(`Duplicate positions for ${player.canonicalPlayerId}`);
    if (!POSITION_SOURCES.has(player.positionSource)) throw new Error(`Invalid position source for ${player.canonicalPlayerId}`);
    assertAttributes(player.projection.attributes, player.canonicalPlayerId);
    if (!Number.isInteger(player.age) || player.age < 18 || player.age > 50
      || player.projection.qualityFlags.includes("NBA_OFFICIAL_AGE_UNAVAILABLE")) {
      throw new Error(`Invalid or unresolved age for ${player.canonicalPlayerId}`);
    }
    for (const key of ["overall", "potential", "durability"] as const) {
      if (!Number.isInteger(player.projection[key]) || player.projection[key] < 25 || player.projection[key] > 99) {
        throw new Error(`Invalid ${key} for ${player.canonicalPlayerId}`);
      }
    }
    if (player.projection.qualityFlags.includes("NBA_2K27_PROFILE_UNAVAILABLE")
      && Object.values(player.projection.attributes).every((value) => value === 25)) {
      throw new Error(`Unrated NBA player still has placeholder attributes: ${player.canonicalPlayerId}`);
    }
  }
  const historicalIds = new Set<string>();
  for (const template of dataset.historicalTemplates) {
    if (!template.sourcePlayerId || historicalIds.has(template.sourcePlayerId)) throw new Error(`Duplicate historical source ${template.sourcePlayerId}`);
    historicalIds.add(template.sourcePlayerId);
    if (!POSITIONS.has(template.position)) throw new Error(`Invalid historical position for ${template.sourcePlayerId}`);
    assertAttributes(template.rookieAttributes, template.sourcePlayerId);
  }
  return dataset;
}

export const NBA_PLAYER_DATASET = validateNbaPlayerDataset(rawDataset);

const byHupuId = new Map(NBA_PLAYER_DATASET.players.flatMap((player) => player.hupuPlayerId ? [[player.hupuPlayerId, player] as const] : []));
const normalizeName = (value: string): string => value.normalize("NFKD").replace(/[^a-z0-9]/giu, "").toLowerCase();
const normalizeJersey = (value: string): string => value.trim().replace(/^#/u, "").toUpperCase();
const byEnglishName = new Map<string, NbaPlayerProjection>();
const byTeamAndJersey = new Map<string, NbaPlayerProjection>();
const duplicateTeamJerseyKeys = new Set<string>();
for (const player of NBA_PLAYER_DATASET.players) {
  for (const name of [player.fullName, ...player.aliases]) {
    const key = normalizeName(name);
    if (key && !byEnglishName.has(key)) byEnglishName.set(key, player);
  }
  if (player.jerseyNumber) {
    const key = `${player.teamAbbreviation.toUpperCase()}:${normalizeJersey(player.jerseyNumber)}`;
    if (byTeamAndJersey.has(key)) duplicateTeamJerseyKeys.add(key);
    else byTeamAndJersey.set(key, player);
  }
}
for (const key of duplicateTeamJerseyKeys) byTeamAndJersey.delete(key);

export function findNbaProjectionForHupu(
  hupuPlayerId: string,
  englishName?: string | null,
  teamAbbreviation?: string | null,
  jerseyNumber?: string | null,
): NbaPlayerProjection | undefined {
  return byHupuId.get(hupuPlayerId)
    ?? (englishName ? byEnglishName.get(normalizeName(englishName)) : undefined)
    ?? (teamAbbreviation && jerseyNumber ? byTeamAndJersey.get(`${teamAbbreviation.toUpperCase()}:${normalizeJersey(jerseyNumber)}`) : undefined);
}

export function eligibleHistoricalTemplates(): HistoricalPlayerTemplate[] {
  return NBA_PLAYER_DATASET.historicalTemplates.filter((template) => template.eligible);
}
