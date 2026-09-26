import { BALANCE_CONFIG } from "../../config/balanceConfig";
import { calculatePlayerOverall } from "../player/PlayerRatingService";
import type { Player, Position, TeamRotationPlan } from "../state/types";

export const LINEUP_POSITIONS: Position[] = ["PG", "SG", "SF", "PF", "C"];

const positionIndex = (position: Position): number => LINEUP_POSITIONS.indexOf(position);

export function positionMismatchPenalty(player: Pick<Player, "position" | "secondaryPosition">, slot: Position): number {
  if (player.position === slot || player.secondaryPosition === slot) return 0;
  const distance = Math.abs(positionIndex(player.position) - positionIndex(slot));
  return BALANCE_CONFIG.rotationPlan.positionMismatchPenaltyByDistance[distance] ?? BALANCE_CONFIG.rotationPlan.positionMismatchPenaltyByDistance.at(-1)!;
}

export function positionCompatibilityLabel(player: Pick<Player, "position" | "secondaryPosition">, slot: Position): string {
  if (player.position === slot) return "主位置";
  if (player.secondaryPosition === slot) return "副位置";
  const penalty = positionMismatchPenalty(player, slot);
  return penalty <= 1.5 ? "轻微错位" : penalty <= 4 ? "一般错位" : penalty <= 8 ? "明显错位" : "严重错位";
}

function assignmentPositionPenalty(player: Pick<Player, "position" | "secondaryPosition">, slot: Position): number {
  if (player.position === slot) return 0;
  if (player.secondaryPosition === slot) return BALANCE_CONFIG.rotationPlan.secondaryPositionAssignmentPenalty;
  return positionMismatchPenalty(player, slot) * 3;
}

function assignLegacyStarters(players: Player[]): Record<Position, string> {
  const available = players.filter((player) => player.available && !player.injury);
  const assigned = {} as Record<Position, string>;
  const used = new Set<string>();
  for (const slot of ["C", "PG", "PF", "SG", "SF"] as Position[]) {
    const choice = available.filter((player) => !used.has(player.id)).sort((left, right) => {
      const leftScore = calculatePlayerOverall(left) - positionMismatchPenalty(left, slot) * 3;
      const rightScore = calculatePlayerOverall(right) - positionMismatchPenalty(right, slot) * 3;
      return rightScore - leftScore || left.id.localeCompare(right.id);
    })[0];
    assigned[slot] = choice.id;
    used.add(choice.id);
  }
  return assigned;
}

/** Optimize all five slots together, so filling SG cannot leave a better SG stranded at SF. */
function assignDefaultStarters(players: Player[], fixed: Partial<Record<Position, string>> = {}): Record<Position, string> {
  const available = players.filter((player) => player.available && !player.injury);
  if (available.length < LINEUP_POSITIONS.length) throw new Error("ROTATION_REQUIRES_FIVE_AVAILABLE_PLAYERS");
  const fixedIds = new Set(Object.values(fixed));
  const openSlots = LINEUP_POSITIONS.filter((slot) => !fixed[slot]);
  type Assignment = { score: number; ids: string[] };
  const best: Array<Assignment | undefined> = Array.from({ length: 1 << openSlots.length });
  best[0] = { score: 0, ids: [] };
  for (const player of available.filter((candidate) => !fixedIds.has(candidate.id)).sort((a, b) => a.id.localeCompare(b.id))) {
    const overall = calculatePlayerOverall(player);
    const next = best.slice();
    for (let mask = 0; mask < best.length; mask++) {
      const current = best[mask];
      if (!current) continue;
      for (let slotIndex = 0; slotIndex < openSlots.length; slotIndex++) {
        const bit = 1 << slotIndex;
        if (mask & bit) continue;
        const nextMask = mask | bit;
        const score = current.score + overall - assignmentPositionPenalty(player, openSlots[slotIndex]);
        const ids = [...current.ids];
        ids[slotIndex] = player.id;
        const prior = next[nextMask];
        if (!prior || score > prior.score + 1e-9 || (Math.abs(score - prior.score) < 1e-9 && ids.join("|") < prior.ids.join("|"))) next[nextMask] = { score, ids };
      }
    }
    for (let mask = 0; mask < best.length; mask++) best[mask] = next[mask];
  }
  const chosen = best[best.length - 1];
  if (!chosen) throw new Error("ROTATION_REQUIRES_FIVE_AVAILABLE_PLAYERS");
  return Object.fromEntries(LINEUP_POSITIONS.map((slot) => [slot, fixed[slot] ?? chosen.ids[openSlots.indexOf(slot)]])) as Record<Position, string>;
}

function allocateMinutes(weights: number[], maximum: number): number[] {
  const result = weights.map(() => 0);
  let remaining = BALANCE_CONFIG.rotationPlan.regulationMinutes;
  while (remaining > 0) {
    const candidates = weights.map((weight, index) => ({ weight, index }))
      .filter(({ index }) => result[index] < maximum);
    if (!candidates.length) throw new Error("ROTATION_MINUTE_CAPACITY_EXHAUSTED");
    const totalWeight = candidates.reduce((sum, entry) => sum + entry.weight, 0) || candidates.length;
    const exact = candidates.map((entry) => ({ ...entry, share: remaining * entry.weight / totalWeight }));
    let distributed = 0;
    for (const entry of exact) {
      const amount = Math.min(maximum - result[entry.index], Math.floor(entry.share));
      result[entry.index] += amount;
      distributed += amount;
    }
    remaining -= distributed;
    if (remaining === 0) break;
    exact.sort((left, right) => (right.share - Math.floor(right.share)) - (left.share - Math.floor(left.share)) || left.index - right.index);
    for (const entry of exact) {
      if (remaining === 0) break;
      if (result[entry.index] < maximum) {
        result[entry.index] += 1;
        remaining -= 1;
      }
    }
  }
  return result;
}

function orderedBenchRoster(players: Player[], plan: Pick<TeamRotationPlan, "targetMinutes" | "benchOrder">, starterIds: ReadonlySet<string>): Player[] {
  const benchRank = new Map(plan.benchOrder?.map((id, index) => [id, index]));
  return players.filter((player) => !starterIds.has(player.id)).sort((left, right) => {
    const leftRank = benchRank.get(left.id);
    const rightRank = benchRank.get(right.id);
    if (leftRank !== undefined || rightRank !== undefined) return (leftRank ?? Infinity) - (rightRank ?? Infinity);
    const availabilityRank = (player: Player) => player.injury ? 2 : player.available ? 0 : 1;
    return availabilityRank(left) - availabilityRank(right)
      || Number((plan.targetMinutes[right.id] ?? 0) > 0) - Number((plan.targetMinutes[left.id] ?? 0) > 0)
      || (plan.targetMinutes[right.id] ?? 0) - (plan.targetMinutes[left.id] ?? 0)
      || calculatePlayerOverall(right) - calculatePlayerOverall(left)
      || left.id.localeCompare(right.id);
  });
}

function buildPlanWithStarters(players: Player[], starters: Record<Position, string>): TeamRotationPlan {
  const starterIds = new Set(Object.values(starters));
  const ordered = [...players].filter((player) => player.available && !player.injury)
    .sort((left, right) => {
      const starterDifference = Number(starterIds.has(right.id)) - Number(starterIds.has(left.id));
      return starterDifference || calculatePlayerOverall(right) - calculatePlayerOverall(left) || left.id.localeCompare(right.id);
    });
  // The automatic plan keeps its ten-player baseline; managers may assign up to twelve manually.
  const active = ordered.slice(0, Math.min(BALANCE_CONFIG.rotationPlan.defaultMinuteWeights.length, ordered.length));
  const weights = BALANCE_CONFIG.rotationPlan.defaultMinuteWeights.slice(0, active.length);
  const minutes = allocateMinutes(weights, BALANCE_CONFIG.rotationPlan.regularSeasonMaximumMinutes);
  const targetMinutes = Object.fromEntries(players.map((player) => [player.id, 0]).concat(active.map((player, index) => [player.id, minutes[index]])));
  return {
    starters,
    targetMinutes,
    benchOrder: orderedBenchRoster(players, { targetMinutes }, starterIds).map((player) => player.id),
    selectionMode: "AUTO",
  };
}

export function buildDefaultRotationPlan(players: Player[]): TeamRotationPlan {
  return buildPlanWithStarters(players, assignDefaultStarters(players));
}

/** Only exact old automatic plans are upgraded; custom slots or minutes are never inferred as automatic. */
export function upgradeLegacyAutomaticRotationPlan(players: Player[], plan: TeamRotationPlan): TeamRotationPlan {
  if (plan.selectionMode) return plan;
  const legacy = buildPlanWithStarters(players, assignLegacyStarters(players));
  const sameStarters = LINEUP_POSITIONS.every((slot) => plan.starters[slot] === legacy.starters[slot]);
  const sameMinutes = players.every((player) => (plan.targetMinutes[player.id] ?? 0) === legacy.targetMinutes[player.id]);
  return sameStarters && sameMinutes ? buildDefaultRotationPlan(players) : { ...plan, selectionMode: "MANUAL" };
}

export function effectiveStarterAssignments(players: Player[], plan?: TeamRotationPlan): Record<Position, string> {
  const available = players.filter((player) => player.available && !player.injury);
  if (available.length < LINEUP_POSITIONS.length) throw new Error("ROTATION_REQUIRES_FIVE_AVAILABLE_PLAYERS");
  if (plan?.selectionMode === "AUTO") return assignDefaultStarters(available);
  const effective = {} as Record<Position, string>;
  const used = new Set<string>();
  for (const slot of LINEUP_POSITIONS) {
    const requested = plan?.starters[slot];
    const requestedPlayer = requested ? available.find((player) => player.id === requested) : undefined;
    if (requestedPlayer && !used.has(requestedPlayer.id)) {
      effective[slot] = requestedPlayer.id;
      used.add(requestedPlayer.id);
      continue;
    }
    // Missing or injured manual starters are filled after all remaining requested slots are reserved.
  }
  return assignDefaultStarters(available, effective);
}

/** Preview only configured positive-minute reserves, capped to the remaining rotation slots. */
export function projectedRotationBench(players: Player[], plan: TeamRotationPlan | undefined, starterIds: ReadonlySet<string>): Player[] {
  const remainingSlots = Math.max(0, BALANCE_CONFIG.rotationPlan.maximumActivePlayers - starterIds.size);
  return orderedBenchRoster(players, plan ?? { targetMinutes: {} }, starterIds)
    .filter((player) => player.available && !player.injury && !starterIds.has(player.id) && (!plan || (plan.targetMinutes[player.id] ?? 0) > 0))
    .slice(0, remainingSlots);
}

export function normalizeRotationPlan(players: Player[], plan?: TeamRotationPlan): TeamRotationPlan {
  if (!plan) return buildDefaultRotationPlan(players);
  if (plan.selectionMode === "AUTO") return buildDefaultRotationPlan(players);
  const rosterIds = new Set(players.map((player) => player.id));
  const starters = effectiveStarterAssignments(players, plan);
  const requested = players.map((player) => Math.max(0, Math.round(plan.targetMinutes[player.id] ?? 0)));
  const activeIndices = requested.map((minutes, index) => ({ minutes, index }))
    .filter((entry) => entry.minutes > 0 && players[entry.index].available && !players[entry.index].injury)
    .sort((left, right) => right.minutes - left.minutes || players[left.index].id.localeCompare(players[right.index].id))
    .slice(0, BALANCE_CONFIG.rotationPlan.maximumActivePlayers)
    .map((entry) => entry.index);
  for (const starterId of Object.values(starters)) {
    const index = players.findIndex((player) => player.id === starterId);
    if (!activeIndices.includes(index)) activeIndices.push(index);
  }
  const selected = activeIndices.slice(0, BALANCE_CONFIG.rotationPlan.maximumActivePlayers);
  const minimumForMinuteCapacity = Math.ceil(BALANCE_CONFIG.rotationPlan.regulationMinutes
    / BALANCE_CONFIG.rotationPlan.regularSeasonMaximumMinutes);
  if (selected.length < minimumForMinuteCapacity) {
    const replacements = players.map((player, index) => ({ player, index }))
      .filter(({ player, index }) => player.available && !player.injury && !selected.includes(index))
      .sort((left, right) => calculatePlayerOverall(right.player) - calculatePlayerOverall(left.player)
        || left.player.id.localeCompare(right.player.id));
    for (const replacement of replacements) {
      selected.push(replacement.index);
      if (selected.length >= minimumForMinuteCapacity) break;
    }
  }
  const weights = selected.map((index) => Math.max(1, requested[index]));
  const allocated = allocateMinutes(weights, BALANCE_CONFIG.rotationPlan.regularSeasonMaximumMinutes);
  const targetMinutes = Object.fromEntries(players.filter((player) => rosterIds.has(player.id)).map((player) => [player.id, 0]).concat(selected.map((index, offset) => [players[index].id, allocated[offset]])));
  const normalizedPlan = { ...plan, starters, targetMinutes };
  return {
    starters,
    targetMinutes,
    benchOrder: orderedBenchRoster(players, normalizedPlan, new Set(Object.values(starters))).map((player) => player.id),
    selectionMode: "MANUAL",
  };
}

/** Builds a legal 240-minute rotation for a manager's response to a player's role request. */
export function planPlayerRotationResponse(
  players: Player[], currentPlan: TeamRotationPlan | undefined, playerId: string, requestStarter: boolean,
): TeamRotationPlan | null {
  const player = players.find((candidate) => candidate.id === playerId && candidate.available && !candidate.injury);
  if (!player || players.filter((candidate) => candidate.available && !candidate.injury).length
    * BALANCE_CONFIG.rotationPlan.regularSeasonMaximumMinutes < BALANCE_CONFIG.rotationPlan.regulationMinutes) return null;
  const plan = normalizeRotationPlan(players, currentPlan);
  const previousMinutes = plan.targetMinutes[playerId] ?? 0;
  const wasStarter = Object.values(plan.starters).includes(playerId);
  if (requestStarter && !wasStarter) {
    const slot = [...LINEUP_POSITIONS].sort((left, right) =>
      assignmentPositionPenalty(player, left) - assignmentPositionPenalty(player, right)
      || calculatePlayerOverall(players.find((candidate) => candidate.id === plan.starters[left])!)
        - calculatePlayerOverall(players.find((candidate) => candidate.id === plan.starters[right])!)
      || left.localeCompare(right))[0];
    plan.starters[slot] = playerId;
  }
  const starterIds = new Set(Object.values(plan.starters));
  const active = players.filter((candidate) => (plan.targetMinutes[candidate.id] ?? 0) > 0);
  if (previousMinutes === 0 && active.length >= BALANCE_CONFIG.rotationPlan.maximumActivePlayers) {
    const outgoing = active.filter((candidate) => !starterIds.has(candidate.id))
      .sort((left, right) => (plan.targetMinutes[left.id] ?? 0) - (plan.targetMinutes[right.id] ?? 0)
        || left.id.localeCompare(right.id))[0];
    if (!outgoing) return null;
    plan.targetMinutes[outgoing.id] = 0;
  }
  plan.targetMinutes[playerId] = Math.min(BALANCE_CONFIG.rotationPlan.regularSeasonMaximumMinutes,
    Math.max(previousMinutes + 6, requestStarter ? 24 : 8));
  const adjusted = normalizeRotationPlan(players, { ...plan, selectionMode: "MANUAL" });
  if ((adjusted.targetMinutes[playerId] ?? 0) <= previousMinutes && wasStarter === Object.values(adjusted.starters).includes(playerId)) return null;
  validateRotationPlan(players, adjusted);
  return adjusted;
}

export function validateRotationPlan(players: Player[], plan: TeamRotationPlan, postseason = false): void {
  const rosterById = new Map(players.map((player) => [player.id, player]));
  const starterIds = LINEUP_POSITIONS.map((slot) => plan.starters[slot]);
  if (starterIds.some((id) => !id || !rosterById.has(id))) throw new Error("ROTATION_STARTER_NOT_ON_ROSTER");
  if (new Set(starterIds).size !== LINEUP_POSITIONS.length) throw new Error("ROTATION_STARTERS_MUST_BE_UNIQUE");
  if (plan.benchOrder && (new Set(plan.benchOrder).size !== plan.benchOrder.length
    || plan.benchOrder.some((id) => !rosterById.has(id) || starterIds.includes(id)))) throw new Error("ROTATION_BENCH_ORDER_INVALID");
  if (starterIds.some((id) => !rosterById.get(id)?.available || rosterById.get(id)?.injury)) throw new Error("ROTATION_STARTER_UNAVAILABLE");
  const maximum = postseason ? BALANCE_CONFIG.rotationPlan.postseasonMaximumMinutes : BALANCE_CONFIG.rotationPlan.regularSeasonMaximumMinutes;
  const minutes = players.map((player) => plan.targetMinutes[player.id] ?? 0);
  if (minutes.some((value) => !Number.isInteger(value) || value < 0 || value > maximum)) throw new Error("ROTATION_MINUTES_OUT_OF_RANGE");
  if (minutes.reduce((sum, value) => sum + value, 0) !== BALANCE_CONFIG.rotationPlan.regulationMinutes) throw new Error("ROTATION_MINUTES_MUST_TOTAL_240");
  const activeIds = players.filter((player) => (plan.targetMinutes[player.id] ?? 0) > 0).map((player) => player.id);
  if (activeIds.length < BALANCE_CONFIG.rotationPlan.minimumActivePlayers || activeIds.length > BALANCE_CONFIG.rotationPlan.maximumActivePlayers) throw new Error("ROTATION_ACTIVE_PLAYER_COUNT_INVALID");
  if (starterIds.some((id) => (plan.targetMinutes[id] ?? 0) <= 0)) throw new Error("ROTATION_STARTER_REQUIRES_MINUTES");
  if (players.some((player) => (!player.available || player.injury) && (plan.targetMinutes[player.id] ?? 0) > 0)) throw new Error("ROTATION_UNAVAILABLE_PLAYER_HAS_MINUTES");
  const extraMinuteIds = Object.keys(plan.targetMinutes).filter((id) => !rosterById.has(id) && plan.targetMinutes[id] !== 0);
  if (extraMinuteIds.length) throw new Error("ROTATION_MINUTES_PLAYER_NOT_ON_ROSTER");
}

export function applyRotationPlanToPlayers(players: Player[], plan: TeamRotationPlan): void {
  const starterIds = new Set(Object.values(effectiveStarterAssignments(players, plan)));
  const reserves = projectedRotationBench(players, plan, starterIds);
  players.forEach((player) => {
    if (!player.available || player.injury) player.rotationRole = "OUT";
    else if (starterIds.has(player.id)) player.rotationRole = "STARTER";
    else if (reserves[0]?.id === player.id) player.rotationRole = "SIXTH_MAN";
    else if ((plan.targetMinutes[player.id] ?? 0) > 0) player.rotationRole = "ROTATION";
    else player.rotationRole = "BENCH";
  });
}

export function reconcileRotationAfterRosterChange(
  players: Player[],
  plan?: TeamRotationPlan,
  replacements: Record<string, string> = {},
): TeamRotationPlan {
  if (!plan) {
    const created = buildDefaultRotationPlan(players);
    applyRotationPlanToPlayers(players, created);
    return created;
  }
  const remapped = structuredClone(plan);
  for (const slot of LINEUP_POSITIONS) if (replacements[remapped.starters[slot]]) remapped.starters[slot] = replacements[remapped.starters[slot]];
  if (remapped.benchOrder) remapped.benchOrder = remapped.benchOrder.map((id) => replacements[id] ?? id);
  for (const [outgoingId, incomingId] of Object.entries(replacements)) {
    const transferredMinutes = remapped.targetMinutes[outgoingId] ?? 0;
    delete remapped.targetMinutes[outgoingId];
    remapped.targetMinutes[incomingId] = (remapped.targetMinutes[incomingId] ?? 0) + transferredMinutes;
  }
  const normalized = normalizeRotationPlan(players, remapped);
  applyRotationPlanToPlayers(players, normalized);
  return normalized;
}
