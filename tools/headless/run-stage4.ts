import { EXPANSION_BRAND_PRESETS } from "../../src/data/expansionBrands";
import { executeDraftCommand, getAvailableDraftProspects } from "../../src/game/draft/DraftService";
import { executeExpansionCommand, getSelectableExpansionPlayers } from "../../src/game/expansion/ExpansionService";
import { executeFreeAgencyCommand } from "../../src/game/freeAgency/FreeAgencyService";
import { executeTradeCommand } from "../../src/game/trade/TradeService";
import { executeRosterCommand } from "../../src/game/roster/RosterService";
import { publicPlayerValue } from "../../src/game/ai/AIValueService";
import { createExpansionCareer } from "../../src/game/season/career";
import { simulatePostseason, simulateRegularSeason } from "../../src/game/season/career";
import { executeContractLifecycleCommand, shouldPickUpTeamOption } from "../../src/game/contracts/ContractLifecycleService";
import type { ExpansionCityId, GameState } from "../../src/game/state/types";

const countIndex = process.argv.indexOf("--seeds");
const seedCount = countIndex >= 0 ? Number(process.argv[countIndex + 1]) : 10;
const throughSeason2 = process.argv.includes("--through-season2");

function finishExpansion(seed: string, cityId: ExpansionCityId): GameState {
  const preset = EXPANSION_BRAND_PRESETS[cityId][0];
  let state = executeExpansionCommand(createExpansionCareer(seed), {
    commandId: "create", type: "CREATE_EXPANSION_TEAM",
    payload: { cityId, presetId: preset.presetId, teamName: preset.teamName, primaryColor: preset.primaryColor, secondaryColor: preset.secondaryColor },
  });
  if (!state.expansion?.rightsDraw.resolved) state = executeExpansionCommand(state, { commandId: "package", type: "CHOOSE_RIGHTS_PACKAGE", payload: { packageId: "B" } });
  state = executeExpansionCommand(state, { commandId: "options", type: "RESOLVE_OPTION_PHASE", payload: {} });
  state = executeExpansionCommand(state, { commandId: "trade", type: "PREPARE_EXPANSION_TRADE", payload: {} });
  state = executeExpansionCommand(state, { commandId: "start-expansion", type: "START_EXPANSION_DRAFT", payload: {} });
  while (state.league.currentPhase === "EXPANSION_DRAFT") {
    const pick = (state.expansion?.currentPickIndex ?? 0) + 1;
    const player = getSelectableExpansionPlayers(state)[0];
    state = executeExpansionCommand(state, { commandId: `exp-${pick}`, type: "SELECT_EXPANSION_PLAYER", payload: { playerId: player.id, expectedPickNumber: pick } });
  }
  return state;
}

function run(seed: string, cityId: ExpansionCityId): GameState {
  let state = executeDraftCommand(finishExpansion(seed, cityId), { commandId: "prepare-rookies", type: "PREPARE_ROOKIE_DRAFT", payload: {} });
  while (state.league.currentPhase === "DRAFT") {
    const pick = state.rookieDraft?.pickOrder[state.rookieDraft.currentPickIndex];
    if (!pick) throw new Error(`${seed}: rookie draft pick missing`);
    state = pick.ownerTeamId === state.userTeamId
      ? executeDraftCommand(state, { commandId: `rookie-${pick.pickNumber}`, type: "DRAFT_PLAYER", payload: { playerId: getAvailableDraftProspects(state)[0].id, expectedPickNumber: pick.pickNumber } })
      : executeDraftCommand(state, { commandId: `rookie-ai-${pick.pickNumber}`, type: "ADVANCE_ROOKIE_DRAFT_AI_PICK", payload: { expectedPickNumber: pick.pickNumber } });
  }
  const undraftedBeforeFreeAgency = state.rookieDraft?.classPlayerIds.filter((id) => state.players[id].teamId === "FREE_AGENT").length ?? 0;
  if (undraftedBeforeFreeAgency !== 16) throw new Error(`${seed}: expected 16 undrafted prospects before free agency`);
  state = executeFreeAgencyCommand(state, { commandId: "open-free-agency", type: "ENTER_FREE_AGENCY", payload: {} });
  for (let day = 1; day <= 3; day += 1) state = executeFreeAgencyCommand(state, { commandId: `fa-day-${day}`, type: "ADVANCE_FA_DAY", payload: {} });
  const tradePlayer = state.teams[state.userTeamId].playerIds.map((id) => state.players[id]).sort((a, b) => publicPlayerValue(b) - publicPlayerValue(a))[5];
  state = executeTradeCommand(state, { commandId: "trade-query", type: "GENERATE_TRADE_OFFERS", payload: { playerId: tradePlayer.id, refresh: false } });
  state = executeTradeCommand(state, { commandId: "trade-accept", type: "ACCEPT_TRADE_OFFER", payload: { offerId: state.tradeDesk.offers[0].offerId } });
  state = executeRosterCommand(state, { commandId: "close-fa", type: "CLOSE_FREE_AGENCY", payload: {} });
  while (state.teams[state.userTeamId].playerIds.length > 15) {
    const cut = state.teams[state.userTeamId].playerIds.map((id) => state.players[id]).sort((a, b) => publicPlayerValue(a) - publicPlayerValue(b))[0];
    state = executeRosterCommand(state, { commandId: `waive-${cut.id}`, type: "WAIVE_PLAYER", payload: { playerId: cut.id } });
  }
  state = executeRosterCommand(state, { commandId: "roster-lock", type: "LOCK_OPENING_ROSTER", payload: { confirmMinimumFill: true } });
  return state;
}

function runSecondManagerLoop(input: GameState): GameState {
  let state = simulatePostseason(simulateRegularSeason(input, { autoAcknowledgeMajorInjuries: true, autoResolveEmergencyRosters: true, autoResolveEvents: true }));
  state = executeContractLifecycleCommand(state, { commandId: `rollover-${state.league.seasonId}`, type: "ROLLOVER_LEAGUE_YEAR", payload: {} });
  for (const playerId of [...(state.contractLifecycle?.pendingUserTeamOptionPlayerIds ?? [])]) {
    const player = state.players[playerId];
    state = executeContractLifecycleCommand(state, {
      commandId: `option-${state.league.seasonId}-${playerId}`,
      type: "RESOLVE_TEAM_OPTION",
      payload: { playerId, decision: shouldPickUpTeamOption(player, player.contract.salary) ? "PICK_UP" : "DECLINE" },
    });
  }
  state = executeContractLifecycleCommand(state, { commandId: `finalize-${state.league.seasonId}`, type: "FINALIZE_OPTION_PHASE", payload: {} });
  state = executeDraftCommand(state, { commandId: `prepare-${state.league.seasonId}`, type: "PREPARE_ROOKIE_DRAFT", payload: {} });
  while (state.league.currentPhase === "DRAFT") {
    const pick = state.rookieDraft?.pickOrder[state.rookieDraft.currentPickIndex];
    if (!pick) throw new Error(`${state.league.seasonId}: rookie draft pick missing`);
    state = pick.ownerTeamId === state.userTeamId
      ? executeDraftCommand(state, { commandId: `rookie-${state.league.seasonId}-${pick.pickNumber}`, type: "DRAFT_PLAYER", payload: { playerId: getAvailableDraftProspects(state)[0].id, expectedPickNumber: pick.pickNumber } })
      : executeDraftCommand(state, { commandId: `rookie-ai-${state.league.seasonId}-${pick.pickNumber}`, type: "ADVANCE_ROOKIE_DRAFT_AI_PICK", payload: { expectedPickNumber: pick.pickNumber } });
  }
  state = executeFreeAgencyCommand(state, { commandId: `open-${state.league.seasonId}`, type: "ENTER_FREE_AGENCY", payload: {} });
  for (let day = 1; day <= 3; day += 1) state = executeFreeAgencyCommand(state, { commandId: `fa-${state.league.seasonId}-${day}`, type: "ADVANCE_FA_DAY", payload: {} });
  state = executeRosterCommand(state, { commandId: `close-${state.league.seasonId}`, type: "CLOSE_FREE_AGENCY", payload: {} });
  while (state.teams[state.userTeamId].playerIds.length > 15) {
    const cut = state.teams[state.userTeamId].playerIds.map((id) => state.players[id]).sort((a, b) => publicPlayerValue(a) - publicPlayerValue(b))[0];
    state = executeRosterCommand(state, { commandId: `waive-${state.league.seasonId}-${cut.id}`, type: "WAIVE_PLAYER", payload: { playerId: cut.id } });
  }
  return executeRosterCommand(state, { commandId: `lock-${state.league.seasonId}`, type: "LOCK_OPENING_ROSTER", payload: { confirmMinimumFill: true } });
}

for (let index = 0; index < seedCount; index += 1) {
  const seed = `stage4-headless-${index}`;
  let state = run(seed, index % 2 === 0 ? "SEA" : "LVG");
  const picked = state.rookieDraft?.pickOrder.filter((pick) => pick.playerId).length ?? 0;
  const staleOffers = Object.values(state.freeAgency?.offers ?? {}).filter((offer) => offer.status === "ACTIVE" && offer.expiresDay < (state.freeAgency?.currentDay ?? 0) - 1).length;
  if (picked !== 64 || state.league.currentPhase !== "REGULAR_PRE_DEADLINE" || staleOffers !== 0 || state.schedule.length !== 1312) throw new Error(`${seed}: invalid Stage 4 result`);
  console.log(`${seed}: 64 picks · FA day ${state.freeAgency?.currentDay} · trade accepted · ${state.teams[state.userTeamId].playerIds.length}/15 · 1312 games`);
  if (throughSeason2) {
    state = runSecondManagerLoop(state);
    const season2Picks = state.rookieDraft?.pickOrder.filter((pick) => pick.playerId).length ?? 0;
    const historicalArchetypes = state.rookieDraft?.classPlayerIds.filter((id) => state.players[id].profileSource === "HISTORICAL_ARCHETYPE").length ?? 0;
    if (state.league.seasonId !== "2027-28" || state.rookieDraft?.source !== "MIXED_FUTURE" || historicalArchetypes !== 3 || season2Picks !== 64
      || state.league.currentPhase !== "REGULAR_PRE_DEADLINE" || state.schedule.length !== 1312) throw new Error(`${seed}: invalid second-season manager loop`);
    console.log(`${seed}: second manager loop · ${state.league.seasonId} · ${season2Picks} picks · ${historicalArchetypes} historical archetypes · ${state.teams[state.userTeamId].playerIds.length}/15`);
  }
}
