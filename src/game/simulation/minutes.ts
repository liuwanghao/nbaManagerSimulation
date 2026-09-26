import type { Player, TeamRotationPlan } from "../state/types";
import { SIMULATION_CONFIG } from "./config";

export function allocateInteger(total: number, weights: number[], caps?: number[]): number[] {
  if (weights.length === 0) throw new Error("Cannot allocate without recipients");
  const normalized = weights.map((weight) => Math.max(0, weight));
  const result = normalized.map(() => 0);
  let remaining = total;
  while (remaining > 0) {
    const available = result.map((value, index) => ({
      index,
      capacity: caps ? caps[index] - value : Number.POSITIVE_INFINITY,
      weight: normalized[index],
    })).filter((entry) => entry.capacity > 0);
    if (available.length === 0) throw new Error(`Allocation capacity exhausted with ${remaining} remaining`);
    const weightSum = available.reduce((sum, entry) => sum + entry.weight, 0) || available.length;
    let distributed = 0;
    const fractions: Array<{ index: number; fraction: number }> = [];
    for (const entry of available) {
      const exact = remaining * ((entry.weight || 1) / weightSum);
      const amount = Math.min(entry.capacity, Math.floor(exact));
      result[entry.index] += amount;
      distributed += amount;
      fractions.push({ index: entry.index, fraction: exact - Math.floor(exact) });
    }
    remaining -= distributed;
    if (remaining === 0) break;
    fractions.sort((a, b) => b.fraction - a.fraction || a.index - b.index);
    let progressed = false;
    for (const entry of fractions) {
      if (remaining === 0) break;
      if (!caps || result[entry.index] < caps[entry.index]) {
        result[entry.index] += 1;
        remaining -= 1;
        progressed = true;
      }
    }
    if (!progressed) throw new Error("Allocation made no progress");
  }
  return result;
}

export function solveRotationSeconds(players: Player[], postseason: boolean, plan?: TeamRotationPlan): Record<string, number> {
  const config = SIMULATION_CONFIG.rotation;
  const maxSeconds = (postseason ? config.postseasonMaximumMinutes : config.regularSeasonMaximumMinutes) * 60;
  const minimumForMinuteCapacity = Math.ceil(SIMULATION_CONFIG.regulationTeamSeconds / maxSeconds);
  const available = players.filter((player) => player.available && player.rotationRole !== "OUT");
  const planned = plan ? available.filter((player) => (plan.targetMinutes[player.id] ?? 0) > 0)
    .sort((left, right) => (plan.targetMinutes[right.id] ?? 0) - (plan.targetMinutes[left.id] ?? 0) || left.id.localeCompare(right.id)) : [];
  const emergencyFallbacks = plan ? available.filter((player) => !planned.some((plannedPlayer) => plannedPlayer.id === player.id)) : [];
  const active = plan
    ? [...planned, ...emergencyFallbacks].slice(0, Math.max(config.minimumPlayers, minimumForMinuteCapacity, Math.min(config.maximumPlayers, planned.length)))
    : available.slice(0, config.maximumPlayers);
  if (active.length < Math.max(config.minimumPlayers, minimumForMinuteCapacity)) throw new Error(`A team needs at least ${Math.max(config.minimumPlayers, minimumForMinuteCapacity)} available players under the minute cap`);
  const roleBonus = (player: Player): number => player.teamRole === "FRANCHISE_CORE"
    ? config.franchiseCoreMinuteBonus
    : player.teamRole === "KEY_PLAYER" ? config.keyPlayerMinuteBonus : 0;
  const weights = active.map((player) => {
    const plannedTarget = plan?.targetMinutes[player.id];
    const target = plannedTarget !== undefined ? plannedTarget : SIMULATION_CONFIG.roleMinutes[player.rotationRole] + roleBonus(player);
    return Math.max(1, target * (1 - Math.max(0, player.fatigue - config.fatigueAdjustmentThreshold) / config.fatigueAdjustmentDivisor));
  });
  const seconds = allocateInteger(SIMULATION_CONFIG.regulationTeamSeconds, weights, active.map(() => maxSeconds));
  return Object.fromEntries(active.map((player, index) => [player.id, seconds[index]]));
}

export function addOvertimeSeconds(
  regulation: Record<string, number>,
  players: Player[],
  overtimePeriods: number,
): Record<string, number> {
  const result = { ...regulation };
  const priority = players
    .filter((player) => (result[player.id] ?? 0) > 0)
    .sort((a, b) => (result[b.id] ?? 0) - (result[a.id] ?? 0) || b.attributes.basketballIq - a.attributes.basketballIq)
    .slice(0, SIMULATION_CONFIG.rotation.overtimePlayers);
  const overtimeSecondsPerPlayer = SIMULATION_CONFIG.overtimeTeamSeconds / SIMULATION_CONFIG.rotation.overtimePlayers;
  for (const player of priority) result[player.id] += overtimePeriods * overtimeSecondsPerPlayer;
  return result;
}
