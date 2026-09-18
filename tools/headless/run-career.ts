import { advanceSeason, createCareer, simulatePostseason, simulateRegularSeason } from "../../src/game/season/career";

const valueAfter = (flag: string, fallback: string): string => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
};

const seed = valueAfter("--seed", "12345");
const seasons = Number.parseInt(valueAfter("--seasons", "3"), 10);
let state = createCareer(seed);
const completed: Array<{ seasonId: string; champion: string; games: number }> = [];
const startedAt = performance.now();

for (let index = 0; index < seasons; index += 1) {
  state = simulateRegularSeason(state, { autoAcknowledgeMajorInjuries: true, autoResolveEmergencyRosters: true, autoResolveEvents: true });
  state = simulatePostseason(state);
  completed.push({
    seasonId: state.league.seasonId,
    champion: state.history.champions.at(-1)?.teamId ?? "UNKNOWN",
    games: state.lightweightResults.length,
  });
  if (index < seasons - 1) state = advanceSeason(state);
}

process.stdout.write(`${JSON.stringify({
  seed,
  seasons,
  completed,
  durationMs: Math.round(performance.now() - startedAt),
  finalPhase: state.league.currentPhase,
}, null, 2)}\n`);
