import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { advanceSeason, createCareer, simulatePostseason, simulateRegularSeason } from "../../src/game/season/career";
import { executeContractLifecycleCommand } from "../../src/game/contracts/ContractLifecycleService";
import { stableHash, stableSerialize } from "../../src/game/random/hash";

const argument = (flag: string, fallback: string): string => {
  const index = process.argv.indexOf(flag);
  return index < 0 ? fallback : process.argv[index + 1] ?? fallback;
};
const seed = argument("--seed", "rollover-2028-29-reproduction");
const output = resolve(argument("--output", "reports/rollover-2026-10-02"));
await mkdir(output, { recursive: true });

let state = createCareer(seed);
for (let index = 0; index < 3; index += 1) {
  state = simulatePostseason(simulateRegularSeason(state, {
    autoAcknowledgeMajorInjuries: true, autoResolveEmergencyRosters: true, autoResolveEvents: true,
  }));
  console.log(`${state.league.seasonId}: ${state.league.currentPhase}`);
  if (index < 2) state = advanceSeason(state);
}
if (state.league.seasonId !== "2028-29" || state.league.currentPhase !== "OFFSEASON") throw new Error("Unexpected reproduction phase");

const stateHash = stableHash(stableSerialize(state));
const envelope = {
  saveId: stableHash(seed, "save", 1), slotId: 1,
  schemaVersion: state.meta.schemaVersion, gameVersion: state.meta.gameVersion,
  dataVersion: state.meta.dataVersion, generatorVersion: state.meta.generatorVersion,
  careerSeed: seed, revision: 1, parentRevision: null, syncBaseRevision: null,
  stateHash, updatedAt: new Date().toISOString(), pendingSync: true, state,
};
const before = JSON.stringify(envelope);
// These are isolated QA files. Never overwrite an existing reproduction save.
await writeFile(resolve(output, "before-rollover.save.json"), before, { flag: "wx" });
const started = performance.now();
const next = executeContractLifecycleCommand(state, {
  commandId: "rollover-2028-29", type: "ROLLOVER_LEAGUE_YEAR", payload: {},
});
const calculationMs = Math.round(performance.now() - started);
const nextStateHash = stableHash(stableSerialize(next));
await writeFile(resolve(output, "expected-after-rollover.state.json"), JSON.stringify(next), { flag: "wx" });
const report = {
  seed, seasonId: state.league.seasonId, phase: state.league.currentPhase, slotId: 1,
  stateHash, nextStateHash, calculationMs, bytes: Buffer.byteLength(before),
  players: Object.keys(state.players).length, archivedSeasons: state.history.seasons.length,
  note: "Generated fixed-seed QA career; not a player's uploaded save.",
};
await writeFile(resolve(output, "reproduction.json"), JSON.stringify(report, null, 2), { flag: "wx" });
console.log(JSON.stringify(report, null, 2));
