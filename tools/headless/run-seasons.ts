import { advanceSeason, createCareer, simulatePostseason, simulateRegularSeason } from "../../src/game/season/career";

const valueAfter = (flag: string, fallback: string): string => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
};

const seedCount = Number.parseInt(valueAfter("--seeds", "2"), 10);
const seasons = Number.parseInt(valueAfter("--seasons", "2"), 10);
const startedAt = performance.now();
const reports: Array<{ seed: string; champions: string[] }> = [];

for (let seedIndex = 0; seedIndex < seedCount; seedIndex += 1) {
  const seed = `regression-${seedIndex + 1}`;
  let state = createCareer(seed);
  const champions: string[] = [];
  for (let season = 0; season < seasons; season += 1) {
    state = simulatePostseason(simulateRegularSeason(state, { autoAcknowledgeMajorInjuries: true, autoResolveEmergencyRosters: true, autoResolveEvents: true }));
    champions.push(state.history.champions.at(-1)?.teamId ?? "UNKNOWN");
    if (season < seasons - 1) state = advanceSeason(state);
  }
  reports.push({ seed, champions });
}

process.stdout.write(`${JSON.stringify({
  seedCount,
  seasons,
  seasonEquivalents: seedCount * seasons,
  durationMs: Math.round(performance.now() - startedAt),
  reports,
}, null, 2)}\n`);
