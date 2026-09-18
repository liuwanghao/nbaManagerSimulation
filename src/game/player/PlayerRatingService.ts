import { BALANCE_CONFIG } from "../../config/balanceConfig";
import type { Player, PlayerAttributes, Position } from "../state/types";

export function calculateAttributeOverall(attributes: PlayerAttributes, position: Position): number {
  const weights = BALANCE_CONFIG.overall.attributeWeightsByPosition[position];
  return (Object.keys(weights) as Array<keyof PlayerAttributes>)
    .reduce((sum, key) => sum + attributes[key] * weights[key], 0);
}

export function calculatePlayerOverall(player: Pick<Player, "attributes" | "position" | "overallAdjustment">): number {
  return Math.max(25, Math.min(99, calculateAttributeOverall(player.attributes, player.position) + (player.overallAdjustment ?? 0)));
}
