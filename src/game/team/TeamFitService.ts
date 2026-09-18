import type { GameState, Player } from "../state/types";
import { BALANCE_CONFIG } from "../../config/balanceConfig";
import { playerDefenseImpact, playerOffenseImpact } from "../simulation/ratings";

const clamp = (value: number): number => Math.max(0, Math.min(100, value));
const average = (values: number[]): number => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

export interface TeamFitBreakdown {
  creation: number;
  spacing: number;
  perimeterDefense: number;
  rimProtection: number;
  rebounding: number;
  sizeBalance: number;
  benchDepth: number;
  usageConflict: number;
  score: number;
  modifier: number;
  offense: number;
  defense: number;
  depth: number;
  starPower: number;
  health: number;
}

function gradeValue(players: Player[], getter: (player: Player) => number, take = 5): number {
  return average(players.map(getter).sort((a, b) => b - a).slice(0, take));
}

export function calculateTeamFitForPlayers(players: Player[]): TeamFitBreakdown {
  const config = BALANCE_CONFIG.teamFit;
  const roster = players.filter(Boolean);
  const active = roster.filter((player) => player.available && player.rotationRole !== "OUT")
    .sort((left, right) => (playerOffenseImpact(right) + playerDefenseImpact(right)) - (playerOffenseImpact(left) + playerDefenseImpact(left)));
  const rotation = active.slice(0, config.rotationSize);
  const top = rotation.slice(0, config.topUnitSize);
  const guards = rotation.filter((player) => player.position === "PG" || player.position === "SG");
  const wings = rotation.filter((player) => player.position === "SF" || player.secondaryPosition === "SF");
  const bigs = rotation.filter((player) => player.position === "PF" || player.position === "C");
  const creators = rotation.map((player) => player.attributes.playmaking).sort((a, b) => b - a);
  const creation = clamp((creators[0] ?? config.attributeFloor) * config.creatorWeights.primary + (creators[1] ?? config.attributeFloor) * config.creatorWeights.secondary);
  const spacing = clamp(gradeValue(top, (player) => player.attributes.shooting * config.spacingWeights.shooting + player.threeRate * 100 * config.spacingWeights.threeRate));
  const perimeterDefense = clamp(gradeValue([...guards, ...wings], (player) => player.attributes.perimeterDefense));
  const rimProtection = clamp(gradeValue(bigs, (player) => player.attributes.interiorDefense, config.rimProtectionPlayers));
  const rebounding = clamp(gradeValue(rotation, (player) => player.attributes.rebounding));
  const positionCoverage = new Set(rotation.flatMap((player) => [player.position, player.secondaryPosition].filter(Boolean))).size;
  const heightBalance = rotation.length ? clamp(100 - Math.abs(average(rotation.map((player) => player.heightCm ?? config.defaultHeightCm)) - config.idealAverageHeightCm) * config.heightPenaltyPerCm) : 0;
  const sizeBalance = clamp(positionCoverage / config.positionCount * config.sizeWeights.positionCoverage * 100 + heightBalance * config.sizeWeights.heightBalance);
  const benchDepth = clamp(gradeValue(rotation.slice(config.benchStartIndex, config.benchEndIndex), (player) => (playerOffenseImpact(player) + playerDefenseImpact(player)) / 2));
  const highUsage = rotation.filter((player) => player.usageTendency >= config.highUsageThreshold);
  const conflictPenalty = highUsage.length <= config.acceptableHighUsagePlayers ? 0
    : (highUsage.length - config.acceptableHighUsagePlayers) * config.conflictPenaltyPerExtraPlayer
      + Math.max(0, average(highUsage.map((player) => player.usageTendency)) - config.conflictUsageBaseline) * config.conflictUsagePenalty;
  const usageConflict = clamp(config.conflictScoreBaseline - conflictPenalty);
  const weights = config.scoreWeights;
  const score = clamp(
    creation * weights.creation + spacing * weights.spacing + perimeterDefense * weights.perimeterDefense + rimProtection * weights.rimProtection
      + rebounding * weights.rebounding + sizeBalance * weights.sizeBalance + benchDepth * weights.benchDepth + usageConflict * weights.usageConflict,
  );
  const impacts = rotation.map((player) => (playerOffenseImpact(player) + playerDefenseImpact(player)) / 2).sort((a, b) => b - a);
  return {
    creation, spacing, perimeterDefense, rimProtection, rebounding, sizeBalance, benchDepth, usageConflict,
    score,
    modifier: Math.max(config.modifier.minimum, Math.min(config.modifier.maximum, (score - config.modifier.baseline) / config.modifier.divisor)),
    offense: gradeValue(top, playerOffenseImpact),
    defense: gradeValue(top, playerDefenseImpact),
    depth: benchDepth,
    starPower: config.starWeights.primary * (impacts[0] ?? 0) + config.starWeights.secondary * (impacts[1] ?? impacts[0] ?? 0),
    health: roster.length ? clamp(roster.reduce((sum, player) => sum + (player.health ?? (player.available ? config.healthFallbackAvailable : config.healthFallbackUnavailable)), 0) / roster.length) : 0,
  };
}

export function calculateTeamFit(state: GameState, teamId: string): TeamFitBreakdown {
  return calculateTeamFitForPlayers(state.teams[teamId].playerIds.map((id) => state.players[id]).filter(Boolean));
}

export const fitGrade = (score: number): string => BALANCE_CONFIG.teamFit.gradeThresholds.find((entry) => score >= entry.minimum)?.grade ?? "D";
