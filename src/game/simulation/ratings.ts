import type { Player } from "../state/types";
import { SIMULATION_CONFIG } from "./config";

export const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(maximum, value));

export function playerOffenseImpact(player: Player): number {
  const a = player.attributes;
  const weights = SIMULATION_CONFIG.ratings.offenseWeights;
  return weights.shooting * a.shooting + weights.finishing * a.finishing + weights.playmaking * a.playmaking
    + weights.basketballIq * a.basketballIq + weights.athleticism * a.athleticism;
}

export function playerDefenseImpact(player: Player): number {
  const a = player.attributes;
  const weights = SIMULATION_CONFIG.ratings.defenseWeights;
  return weights.perimeterDefense * a.perimeterDefense + weights.interiorDefense * a.interiorDefense + weights.rebounding * a.rebounding
    + weights.basketballIq * a.basketballIq + weights.athleticism * a.athleticism;
}

export function fatiguePenalty(player: Player): number {
  const config = SIMULATION_CONFIG.fatigue;
  return player.fatigue <= config.noPenaltyThreshold ? 0 : Math.min(config.maxPenalty, (player.fatigue - config.noPenaltyThreshold) * config.penaltyPerPoint);
}

export function minutesWeightedAttribute(players: Player[], seconds: Record<string, number>, key: keyof Player["attributes"]): number {
  const total = Object.values(seconds).reduce((sum, value) => sum + value, 0);
  return players.reduce((sum, player) => sum + player.attributes[key] * (seconds[player.id] ?? 0) / total, 0);
}

export function teamTalents(players: Player[], seconds: Record<string, number>): {
  offense: number;
  defense: number;
  athleticism: number;
  playmaking: number;
  basketballIq: number;
  finishing: number;
  rebounding: number;
  threeRate: number;
  starPower: number;
} {
  const total = Object.values(seconds).reduce((sum, value) => sum + value, 0);
  const active = players.filter((player) => (seconds[player.id] ?? 0) > 0);
  const weighted = (getter: (player: Player) => number): number =>
    active.reduce((sum, player) => sum + getter(player) * (seconds[player.id] ?? 0) / total, 0);
  const starImpacts = active
    .map((player) => (playerOffenseImpact(player) + playerDefenseImpact(player)) / 2)
    .sort((a, b) => b - a);
  return {
    offense: weighted((player) => playerOffenseImpact(player) - fatiguePenalty(player)),
    defense: weighted((player) => playerDefenseImpact(player) - fatiguePenalty(player)),
    athleticism: minutesWeightedAttribute(active, seconds, "athleticism"),
    playmaking: minutesWeightedAttribute(active, seconds, "playmaking"),
    basketballIq: minutesWeightedAttribute(active, seconds, "basketballIq"),
    finishing: minutesWeightedAttribute(active, seconds, "finishing"),
    rebounding: minutesWeightedAttribute(active, seconds, "rebounding"),
    threeRate: clamp(weighted((player) => player.threeRate), SIMULATION_CONFIG.boxScore.threeRate.minimum, SIMULATION_CONFIG.boxScore.threeRate.maximum),
    starPower: SIMULATION_CONFIG.starPower.bestStarWeight * (starImpacts[0] ?? SIMULATION_CONFIG.starPower.baseline)
      + SIMULATION_CONFIG.starPower.secondStarWeight * (starImpacts[1] ?? starImpacts[0] ?? SIMULATION_CONFIG.starPower.baseline),
  };
}
