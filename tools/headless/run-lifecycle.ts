import { playerOverall } from "../../src/game/development/PlayerDevelopmentService";
import { advanceSeason, createCareer, simulatePostseason, simulateRegularSeason } from "../../src/game/season/career";
import type { GameState } from "../../src/game/state/types";

function argument(name: string, fallback: number): number {
  const index = process.argv.indexOf(name);
  return index >= 0 ? Number(process.argv[index + 1]) : fallback;
}

const seedCount = argument("--seeds", 1);
const seasonCount = argument("--seasons", 10);

function metrics(state: GameState) {
  const living = Object.values(state.players).filter((player) => player.contract.status !== "RETIRED");
  const values = living.map(playerOverall);
  const sortedValues = [...values].sort((left, right) => left - right);
  const rosterIds = Object.values(state.teams).flatMap((team) => team.playerIds);
  if (new Set(rosterIds).size !== rosterIds.length) throw new Error(`${state.league.seasonId}: duplicate player ownership`);
  for (const team of Object.values(state.teams)) if (team.playerIds.length < 14 || team.playerIds.length > 15) throw new Error(`${state.league.seasonId}: illegal roster ${team.id} ${team.playerIds.length}`);
  if (Object.values(state.players).some((player) => Object.values(player.attributes).some((value) => !Number.isFinite(value) || value < 25 || value > 99))) {
    throw new Error(`${state.league.seasonId}: invalid player attribute`);
  }
  return {
    seasonId: state.league.seasonId,
    averageOverall: Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 100) / 100,
    players90Plus: values.filter((value) => value >= 90).length,
    maximumOverall: Math.round((sortedValues.at(-1) ?? 0) * 100) / 100,
    p95Overall: Math.round((sortedValues[Math.floor((sortedValues.length - 1) * 0.95)] ?? 0) * 100) / 100,
    activePlayers: rosterIds.length,
    freeAgents: living.filter((player) => player.teamId === "FREE_AGENT").length,
    livingPlayers: living.length,
    retiredPlayers: Object.values(state.players).filter((player) => player.contract.status === "RETIRED").length,
    hallOfFameInductees: Object.values(state.players).filter((player) => player.career?.hallOfFame).length,
    totalPlayers: Object.values(state.players).length,
    rookieInflow: state.playerLifecycle?.rookieInflow ?? 0,
    retirementOutflow: state.playerLifecycle?.retirementOutflow ?? 0,
  };
}

for (let seedIndex = 0; seedIndex < seedCount; seedIndex += 1) {
  const seed = `lifecycle-${seedIndex}`;
  let state = createCareer(seed);
  const baseline = metrics(state).averageOverall;
  const seasons = [];
  for (let index = 0; index < seasonCount; index += 1) {
    state = simulatePostseason(simulateRegularSeason(state, { autoAcknowledgeMajorInjuries: true, autoResolveEmergencyRosters: true, autoResolveEvents: true }));
    state = advanceSeason(state);
    if (state.schedule.length !== 1312) throw new Error(`${seed}: invalid schedule after rollover`);
    seasons.push(metrics(state));
  }
  const final = seasons.at(-1) as ReturnType<typeof metrics>;
  console.log(JSON.stringify({ seed, baselineAverageOverall: baseline, finalDrift: Math.round((final.averageOverall - baseline) * 100) / 100, seasons }, null, 2));
}
