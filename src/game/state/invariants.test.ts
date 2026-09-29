import { describe, expect, it } from "vitest";
import { getSeasonFinanceConfig } from "../../config/leagueFinance";
import { getCapSheet } from "../cap/CapSheetService";
import { createCareer, simulateLeagueDay, simulateNextGameDay } from "../season/career";
import type { GameState } from "./types";

function expectStateInvariants(state: GameState): void {
  const ownerByPlayer = new Map<string, string>();
  for (const team of Object.values(state.teams)) {
    expect(new Set(team.playerIds).size, `${team.id} duplicate roster ID`).toBe(team.playerIds.length);
    for (const playerId of team.playerIds) {
      expect(ownerByPlayer.has(playerId), `${playerId} appears on multiple teams`).toBe(false);
      ownerByPlayer.set(playerId, team.id);
      expect(state.players[playerId]?.teamId).toBe(team.id);
      expect(state.players[playerId]?.contract.status).not.toBe("RETIRED");
    }
    const cap = getCapSheet(state, team.id);
    for (const component of [cap.activeContractSalary, cap.deadMoney, cap.capHolds, cap.salaryFloorShortfall,
      cap.activeOfferReservations, cap.incompleteRosterCharges, cap.total, cap.availableCapSpace]) {
      expect(Number.isFinite(component), `${team.id} cap contains a nonfinite number`).toBe(true);
    }
    expect(cap.total).toBe(cap.activeContractSalary + cap.deadMoney + cap.capHolds + cap.salaryFloorShortfall
      + cap.activeOfferReservations + cap.incompleteRosterCharges);
    expect(cap.availableCapSpace).toBe(getSeasonFinanceConfig(state.league.seasonYear).salaryCap - cap.total);
  }
  for (const player of Object.values(state.players)) {
    expect(Number.isFinite(player.age), `${player.id} age`).toBe(true);
    expect(Number.isFinite(player.contract.salary), `${player.id} salary`).toBe(true);
    expect(player.contract.salary).toBeGreaterThanOrEqual(0);
    if (state.teams[player.teamId]) expect(ownerByPlayer.get(player.id)).toBe(player.teamId);
    if (player.contract.status === "RETIRED") expect(ownerByPlayer.has(player.id)).toBe(false);
  }

  expect(new Set(state.schedule.map((game) => game.id)).size).toBe(state.schedule.length);
  const completedByTeam = new Map<string, number>();
  for (const game of state.schedule) {
    expect(game.homeTeamId).not.toBe(game.awayTeamId);
    expect(state.teams[game.homeTeamId]).toBeDefined();
    expect(state.teams[game.awayTeamId]).toBeDefined();
    if (game.status !== "FINAL") continue;
    expect(Number.isFinite(game.homeScore)).toBe(true);
    expect(Number.isFinite(game.awayScore)).toBe(true);
    expect(game.homeScore).not.toBe(game.awayScore);
    expect(game.winnerTeamId).toBe(game.homeScore! > game.awayScore! ? game.homeTeamId : game.awayTeamId);
    completedByTeam.set(game.homeTeamId, (completedByTeam.get(game.homeTeamId) ?? 0) + 1);
    completedByTeam.set(game.awayTeamId, (completedByTeam.get(game.awayTeamId) ?? 0) + 1);
  }
  for (const standing of Object.values(state.standings)) {
    expect(standing.wins).toBeGreaterThanOrEqual(0);
    expect(standing.losses).toBeGreaterThanOrEqual(0);
    expect(standing.wins + standing.losses).toBeLessThanOrEqual(completedByTeam.get(standing.teamId) ?? 0);
    expect(standing.homeWins + standing.awayWins).toBe(standing.wins);
    expect(standing.homeLosses + standing.awayLosses).toBe(standing.losses);
    expect(standing.divisionWins).toBeLessThanOrEqual(standing.conferenceWins);
    expect(standing.divisionLosses).toBeLessThanOrEqual(standing.conferenceLosses);
  }
  expect(new Set(state.history.champions.map((entry) => entry.seasonId)).size).toBe(state.history.champions.length);
  if (state.rookieDraft) {
    const selected = state.rookieDraft.pickOrder.flatMap((pick) => pick.playerId ? [pick.playerId] : []);
    expect(new Set(state.rookieDraft.pickOrder.map((pick) => pick.pickNumber)).size).toBe(state.rookieDraft.pickOrder.length);
    expect(new Set(selected).size).toBe(selected.length);
    for (const playerId of selected) expect(state.players[playerId]?.teamId).not.toBe("FREE_AGENT");
  }
}

describe("cross-module state invariants", () => {
  it("holds at creation and after a simulated user game", () => {
    const initial = createCareer("invariant-baseline");
    expectStateInvariants(initial);
    const played = simulateNextGameDay(initial);
    expectStateInvariants(played);
    expect(played.calendar.currentDateIndex).toBeGreaterThan(initial.calendar.currentDateIndex);
    expect(played.calendar.currentDateIndex).toBeLessThanOrEqual(played.calendar.finalDateIndex);
  });

  it("cannot settle a final game twice when the same date is requested again", () => {
    const initial = createCareer("invariant-repeated-day");
    const first = simulateLeagueDay(initial, 0);
    const second = simulateLeagueDay(first, 0);
    expect(second.schedule.filter((game) => game.status === "FINAL")).toEqual(first.schedule.filter((game) => game.status === "FINAL"));
    expect(second.lightweightResults).toEqual(first.lightweightResults);
    expect(second.standings).toEqual(first.standings);
    expectStateInvariants(second);
  });
});
