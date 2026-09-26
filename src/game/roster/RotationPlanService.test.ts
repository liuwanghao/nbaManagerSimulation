import { describe, expect, it } from "vitest";
import { createCareer } from "../season/career";
import { solveRotationSeconds } from "../simulation/minutes";
import { teamTalents } from "../simulation/ratings";
import { setRotationPlan } from "./RosterService";
import { LINEUP_POSITIONS, buildDefaultRotationPlan, effectiveStarterAssignments, planPlayerRotationResponse, positionMismatchPenalty, projectedRotationBench, upgradeLegacyAutomaticRotationPlan, validateRotationPlan } from "./RotationPlanService";

describe("RotationPlanService", () => {
  it("prefers each starter's primary position when two dual-position forwards can swap", () => {
    const state = createCareer("rotation-primary-position");
    const players = state.teams[state.userTeamId].playerIds.slice(0, 6)
      .map((id) => structuredClone(state.players[id])).sort((a, b) => a.id.localeCompare(b.id));
    const roles = [["PF", "SF"], ["SF", "PF"], ["PG", "PG"], ["SG", "SG"], ["C", "C"], ["PG", "PG"]] as const;
    players.forEach((player, index) => {
      player.position = roles[index][0];
      player.secondaryPosition = roles[index][1];
      for (const key of Object.keys(player.attributes) as Array<keyof typeof player.attributes>) player.attributes[key] = 75;
      player.overallAdjustment = index === 0 ? 1 : index === 1 ? 6 : index === 5 ? -50 : 0;
      player.available = true;
      player.injury = undefined;
    });
    const plan = buildDefaultRotationPlan(players);
    expect(plan.starters.SF).toBe(players[1].id);
    expect(plan.starters.PF).toBe(players[0].id);
  });

  it("uses the primary slot first when promoting a dual-position reserve", () => {
    const state = createCareer("rotation-role-primary-position");
    const players = state.teams[state.userTeamId].playerIds.map((id) => structuredClone(state.players[id]));
    const plan = buildDefaultRotationPlan(players);
    plan.selectionMode = "MANUAL";
    const reserve = players.find((player) => player.available && !player.injury && !Object.values(plan.starters).includes(player.id))!;
    reserve.position = "SF";
    reserve.secondaryPosition = "PF";
    players.find((player) => player.id === plan.starters.SF)!.overallAdjustment = 50;
    players.find((player) => player.id === plan.starters.PF)!.overallAdjustment = -50;
    const response = planPlayerRotationResponse(players, plan, reserve.id, true);
    expect(response?.starters.SF).toBe(reserve.id);
  });

  it("optimizes all automatic starter slots together instead of leaving a guard on the wing", () => {
    const state = createCareer("rotation-global-assignment");
    const players = state.teams[state.userTeamId].playerIds.slice(0, 6).map((id) => structuredClone(state.players[id]));
    const roles = [["PG", "PG"], ["SF", "PG"], ["SG", "SF"], ["PF", "PF"], ["C", "C"], ["PG", "PG"]] as const;
    players.forEach((player, index) => {
      player.position = roles[index][0];
      player.secondaryPosition = roles[index][1];
      for (const key of Object.keys(player.attributes) as Array<keyof typeof player.attributes>) player.attributes[key] = 75;
      player.overallAdjustment = index === 0 ? 15 : index === 1 ? 7 : index === 3 ? 6 : index === 4 ? 10 : index === 5 ? -50 : 0;
      player.available = true;
      player.injury = undefined;
    });
    const plan = buildDefaultRotationPlan(players);
    expect(plan.starters.SG).toBe(players[2].id);
    expect(plan.starters.SF).toBe(players[1].id);
    expect(plan.selectionMode).toBe("AUTO");
    const legacy = { ...plan, starters: { ...plan.starters, SG: players[1].id, SF: players[2].id }, selectionMode: undefined };
    expect(effectiveStarterAssignments(players, { ...legacy, selectionMode: "MANUAL" }).SG).toBe(players[1].id);
    expect(upgradeLegacyAutomaticRotationPlan(players, legacy).starters).toEqual(plan.starters);
    expect(upgradeLegacyAutomaticRotationPlan(players, legacy).selectionMode).toBe("AUTO");
    expect(upgradeLegacyAutomaticRotationPlan(players, { ...legacy, targetMinutes: { ...legacy.targetMinutes, [players[0].id]: 39 } }).selectionMode).toBe("MANUAL");
  });
  it("builds five unique fixed slots and exactly 240 target minutes", () => {
    const state = createCareer("rotation-default");
    const players = state.teams[state.userTeamId].playerIds.map((id) => state.players[id]);
    const plan = buildDefaultRotationPlan(players);
    expect(new Set(Object.keys(plan.starters))).toEqual(new Set(LINEUP_POSITIONS));
    expect(new Set(Object.values(plan.starters)).size).toBe(5);
    expect(Object.values(plan.targetMinutes).reduce((sum, minutes) => sum + minutes, 0)).toBe(240);
    expect(Object.values(plan.targetMinutes).filter((minutes) => minutes > 0)).toHaveLength(10);
    expect(() => validateRotationPlan(players, plan)).not.toThrow();
  });

  it.each([11, 12])("persists and simulates a manual %i-player rotation", (activeCount) => {
    const state = createCareer(`rotation-${activeCount}-players`);
    state.league.currentPhase = "REGULAR_PRE_DEADLINE";
    const team = state.teams[state.userTeamId];
    const players = team.playerIds.map((id) => state.players[id]);
    const plan = buildDefaultRotationPlan(players);
    const donors = players.filter((player) => (plan.targetMinutes[player.id] ?? 0) > 20);
    const extras = players.filter((player) => player.available && !player.injury && !plan.targetMinutes[player.id]).slice(0, activeCount - 10);
    expect(extras).toHaveLength(activeCount - 10);
    extras.forEach((player, index) => {
      plan.targetMinutes[player.id] = 8;
      plan.targetMinutes[donors[index].id] -= 8;
    });
    plan.selectionMode = "MANUAL";
    expect(() => validateRotationPlan(players, plan)).not.toThrow();
    const next = setRotationPlan(state, plan);
    const saved = next.teams[next.userTeamId].rotationPlan!;
    expect(Object.values(saved.targetMinutes).filter((minutes) => minutes > 0)).toHaveLength(activeCount);
    const nextPlayers = next.teams[next.userTeamId].playerIds.map((id) => next.players[id]);
    expect(projectedRotationBench(nextPlayers, saved, new Set(Object.values(saved.starters)))).toHaveLength(activeCount - 5);
    const seconds = solveRotationSeconds(nextPlayers, false, saved);
    expect(Object.keys(seconds)).toHaveLength(activeCount);
    expect(Object.values(seconds).reduce((sum, value) => sum + value, 0)).toBe(14_400);
    for (const player of extras) expect(seconds[player.id]).toBeGreaterThan(0);
  });

  it("previews only the five planned reserves in a ten-player rotation", () => {
    const state = createCareer("rotation-preview-ten");
    const team = state.teams[state.userTeamId];
    const players = team.playerIds.map((id) => state.players[id]);
    const plan = buildDefaultRotationPlan(players);
    const starters = new Set(Object.values(plan.starters));
    const bench = projectedRotationBench(players, plan, starters);
    expect(bench).toHaveLength(5);
    expect(bench.every((player) => !starters.has(player.id) && (plan.targetMinutes[player.id] ?? 0) > 0)).toBe(true);
    expect(new Set([...starters, ...bench.map((player) => player.id)]).size).toBe(10);
  });

  it("saves a manual reserve order and assigns the sixth-man role to rank six", () => {
    const state = createCareer("rotation-bench-order");
    state.league.currentPhase = "REGULAR_PRE_DEADLINE";
    const players = state.teams[state.userTeamId].playerIds.map((id) => state.players[id]);
    const plan = buildDefaultRotationPlan(players);
    const originalOrder = [...plan.benchOrder!];
    [plan.benchOrder![0], plan.benchOrder![1]] = [originalOrder[1], originalOrder[0]];
    const next = setRotationPlan(state, plan);
    const saved = next.teams[next.userTeamId].rotationPlan!;
    expect(saved.selectionMode).toBe("MANUAL");
    expect(saved.benchOrder?.slice(0, 2)).toEqual([originalOrder[1], originalOrder[0]]);
    expect(saved.targetMinutes).toEqual(plan.targetMinutes);
    expect(next.players[originalOrder[1]].rotationRole).toBe("SIXTH_MAN");
    expect(next.players[originalOrder[0]].rotationRole).toBe("ROTATION");
    expect(projectedRotationBench(players, saved, new Set(Object.values(saved.starters)))[0].id).toBe(originalOrder[1]);
  });

  it("honors a short manual rotation and hides unavailable reserves", () => {
    const state = createCareer("rotation-preview-short");
    const team = state.teams[state.userTeamId];
    const players = team.playerIds.map((id) => state.players[id]);
    const plan = buildDefaultRotationPlan(players);
    const starters = new Set(Object.values(plan.starters));
    const reserves = players.filter((player) => !starters.has(player.id) && (plan.targetMinutes[player.id] ?? 0) > 0);
    plan.targetMinutes = Object.fromEntries(players.map((player) => [player.id, starters.has(player.id) ? 40 : 0]));
    plan.targetMinutes[reserves[0].id] = 22;
    plan.targetMinutes[reserves[1].id] = 18;
    plan.benchOrder = [reserves[0].id, reserves[1].id];
    expect(projectedRotationBench(players, plan, starters).map((player) => player.id)).toEqual([reserves[0].id, reserves[1].id]);
    reserves[0].available = false;
    expect(projectedRotationBench(players, plan, starters).map((player) => player.id)).toEqual([reserves[1].id]);
  });

  it("treats a matching secondary position as natural and scales true mismatches by distance", () => {
    const state = createCareer("rotation-position-penalty");
    const player = state.players[state.teams[state.userTeamId].playerIds[0]];
    player.position = "PF";
    player.secondaryPosition = "C";
    expect(positionMismatchPenalty(player, "C")).toBe(0);
    player.secondaryPosition = "PF";
    expect(positionMismatchPenalty(player, "C")).toBeGreaterThan(0);
    expect(positionMismatchPenalty(player, "C")).toBeLessThan(4);
    player.position = "PG";
    player.secondaryPosition = "PG";
    expect(positionMismatchPenalty(player, "C")).toBeGreaterThan(10);
  });

  it("feeds severe starter mismatches into the actual simulation talent inputs", () => {
    const state = createCareer("rotation-simulation-penalty");
    const source = state.teams[state.userTeamId].playerIds.slice(0, 5).map((id) => structuredClone(state.players[id]));
    source.forEach((player, index) => { player.position = LINEUP_POSITIONS[index]; player.secondaryPosition = LINEUP_POSITIONS[index]; });
    const seconds = Object.fromEntries(source.map((player) => [player.id, 2_880]));
    const natural = Object.fromEntries(source.map((player, index) => [LINEUP_POSITIONS[index], player.id]));
    const crossed = { ...natural, PG: natural.C, C: natural.PG };
    const naturalTalent = teamTalents(source, seconds, natural);
    const crossedTalent = teamTalents(source, seconds, crossed);
    expect(crossedTalent.offense).toBeLessThan(naturalTalent.offense);
    expect(crossedTalent.defense).toBeLessThan(naturalTalent.defense);
  });

  it("persists a manager plan and uses its target-minute distribution", () => {
    const state = createCareer("rotation-command");
    state.league.currentPhase = "REGULAR_PRE_DEADLINE";
    const team = state.teams[state.userTeamId];
    const players = team.playerIds.map((id) => state.players[id]);
    const plan = buildDefaultRotationPlan(players);
    const active = Object.entries(plan.targetMinutes).filter(([, minutes]) => minutes > 0).map(([id]) => id);
    plan.targetMinutes = Object.fromEntries(players.map((player) => [player.id, 0]));
    active.slice(0, 5).forEach((id) => { plan.targetMinutes[id] = 40; });
    active.slice(5, 7).forEach((id) => { plan.targetMinutes[id] = 20; });
    const next = setRotationPlan(state, plan);
    expect(next.teams[next.userTeamId].rotationPlan?.targetMinutes).toEqual(plan.targetMinutes);
    const nextPlayers = next.teams[next.userTeamId].playerIds.map((id) => next.players[id]);
    nextPlayers.forEach((player) => { player.fatigue = 0; });
    const seconds = solveRotationSeconds(nextPlayers, false, next.teams[next.userTeamId].rotationPlan);
    for (const [playerId, minutes] of Object.entries(plan.targetMinutes)) expect(seconds[playerId] ?? 0).toBe(minutes * 60);
  });

  it("rejects duplicate starters and non-240 minute plans without mutating input", () => {
    const state = createCareer("rotation-invalid");
    state.league.currentPhase = "REGULAR_PRE_DEADLINE";
    const team = state.teams[state.userTeamId];
    const players = team.playerIds.map((id) => state.players[id]);
    const duplicate = structuredClone(team.rotationPlan!);
    duplicate.starters.C = duplicate.starters.PG;
    expect(() => setRotationPlan(state, duplicate)).toThrow(/ROTATION_STARTERS_MUST_BE_UNIQUE/);
    const duplicateBenchRank = structuredClone(team.rotationPlan!);
    duplicateBenchRank.benchOrder![1] = duplicateBenchRank.benchOrder![0];
    expect(() => setRotationPlan(state, duplicateBenchRank)).toThrow(/ROTATION_BENCH_ORDER_INVALID/);
    const wrongTotal = structuredClone(team.rotationPlan!);
    wrongTotal.targetMinutes[Object.keys(wrongTotal.targetMinutes)[0]] -= 1;
    expect(() => setRotationPlan(state, wrongTotal)).toThrow(/ROTATION_MINUTES_MUST_TOTAL_240/);
    expect(state.teams[state.userTeamId].rotationPlan).toEqual(team.rotationPlan);
  });
});
