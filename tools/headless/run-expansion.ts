import { EXPANSION_BRAND_PRESETS } from "../../src/data/expansionBrands";
import { executeExpansionCommand, getSelectableExpansionPlayers } from "../../src/game/expansion/ExpansionService";
import { createExpansionCareer } from "../../src/game/season/career";
import type { ExpansionCityId, GameState } from "../../src/game/state/types";

const countIndex = process.argv.indexOf("--seeds");
const seedCount = countIndex >= 0 ? Number(process.argv[countIndex + 1]) : 10;

function run(seed: string, cityId: ExpansionCityId): GameState {
  const preset = EXPANSION_BRAND_PRESETS[cityId][0];
  let state = executeExpansionCommand(createExpansionCareer(seed), {
    commandId: "create-team",
    type: "CREATE_EXPANSION_TEAM",
    payload: { cityId, presetId: preset.presetId, teamName: preset.teamName, primaryColor: preset.primaryColor, secondaryColor: preset.secondaryColor },
  });
  if (!state.expansion?.rightsDraw.resolved) {
    state = executeExpansionCommand(state, { commandId: "choose-package", type: "CHOOSE_RIGHTS_PACKAGE", payload: { packageId: "A" } });
  }
  state = executeExpansionCommand(state, { commandId: "resolve-options", type: "RESOLVE_OPTION_PHASE", payload: {} });
  state = executeExpansionCommand(state, { commandId: "prepare", type: "PREPARE_EXPANSION_TRADE", payload: {} });
  const offer = state.expansion?.tradeOffers.find((entry) => entry.targetExpansionTeamId === cityId && entry.status === "AVAILABLE");
  if (offer) state = executeExpansionCommand(state, { commandId: `accept-${offer.id}`, type: "ACCEPT_EXPANSION_TRADE", payload: { offerId: offer.id } });
  state = executeExpansionCommand(state, { commandId: "start", type: "START_EXPANSION_DRAFT", payload: {} });
  while (state.league.currentPhase === "EXPANSION_DRAFT") {
    const expectedPickNumber = (state.expansion?.currentPickIndex ?? 0) + 1;
    const player = getSelectableExpansionPlayers(state)[0];
    if (!player) throw new Error(`${seed}: no selectable player at pick ${expectedPickNumber}`);
    state = executeExpansionCommand(state, {
      commandId: `pick-${expectedPickNumber}-${player.id}`,
      type: "SELECT_EXPANSION_PLAYER",
      payload: { playerId: player.id, expectedPickNumber },
    });
  }
  if (state.expansion?.picks.length !== 28 || state.teams.SEA.playerIds.length !== 14 || state.teams.LVG.playerIds.length !== 14) {
    throw new Error(`${seed}: invalid finalized expansion draft`);
  }
  return state;
}

for (let index = 0; index < seedCount; index += 1) {
  const seed = `stage3-headless-${index}`;
  const state = run(seed, index % 2 === 0 ? "SEA" : "LVG");
  console.log(`${seed}: player selected package ${state.expansion?.rightsDraw.packageByTeam[state.userTeamId as "SEA" | "LVG"]} · SEA 14 · LVG 14 · ${state.expansion?.commitments.length} commitments`);
}
