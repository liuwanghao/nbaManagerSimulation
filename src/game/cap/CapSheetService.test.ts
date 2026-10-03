import { describe, expect, it } from "vitest";
import { getSeasonFinanceConfig, LEAGUE_FINANCE_CONFIG } from "../../config/leagueFinance";
import { createCareer } from "../season/career";
import { getCapSheet } from "./CapSheetService";
import { waivePlayer } from "../roster/RosterService";

describe("CapSheetService", () => {
  it("is the single total for contracts, holds, dead money, reservations and incomplete roster charges", () => {
    const state = createCareer("cap-sheet");
    const teamId = "SEA";
    const heldPlayerId = state.teams[teamId].playerIds[8];
    state.players[heldPlayerId].teamId = "FREE_AGENT";
    state.players[heldPlayerId].contract.status = "UFA";
    state.players[heldPlayerId].birdTeamId = teamId;
    state.teams[teamId].playerIds = state.teams[teamId].playerIds.slice(0, 8);
    state.capState.capHolds.push({ teamId, playerId: heldPlayerId, amount: 5_000_000, type: "BIRD_UFA" });
    state.capState.offerReservations.push({ teamId, playerId: heldPlayerId, offerId: "offer-1", amount: 7_000_000 });
    state.capState.deadMoney.push({ id: "dead-1", teamId, salaryBySeason: { [state.league.seasonId]: 3_000_000 } });
    const sheet = getCapSheet(state, teamId);
    expect(sheet.deadMoney).toBe(3_000_000);
    expect(sheet.capHolds).toBe(5_000_000);
    expect(sheet.activeOfferReservations).toBe(2_000_000);
    expect(sheet.incompleteRosterCharges).toBe(3 * LEAGUE_FINANCE_CONFIG.rookieMinimumSalary);
    expect(sheet.availableCapSpace).toBe(LEAGUE_FINANCE_CONFIG.salaryCap - sheet.total);
  });

  it("ignores stale holds for signed, retired and missing players without changing the save", () => {
    const state = createCareer("stale-cap-holds");
    const teamId = state.userTeamId;
    const ids = state.teams[teamId].playerIds;
    const valid = ids[8];
    state.players[valid].teamId = "FREE_AGENT";
    state.players[valid].contract.status = "RFA";
    state.players[valid].birdTeamId = teamId;
    state.players[ids[9]].teamId = "RETIRED";
    state.teams[teamId].playerIds = ids.slice(0, 8);
    state.capState.capHolds = [ids[0], ids[9], "missing-player", valid].map((playerId) => ({
      teamId, playerId, amount: 5_000_000, type: "RFA" as const,
    }));
    const saved = JSON.stringify(state);
    const sheet = getCapSheet(state, teamId);
    expect(sheet.capHolds).toBe(5_000_000);
    expect(sheet.incompleteRosterCharges).toBe(3 * LEAGUE_FINANCE_CONFIG.rookieMinimumSalary);
    expect(JSON.stringify(state)).toBe(saved);
  });

  it("does not revive a legacy signed-player hold after the player is waived", () => {
    const state = createCareer("stale-hold-waiver");
    state.league.currentPhase = "PRESEASON";
    const playerId = state.teams[state.userTeamId].playerIds[0];
    state.capState.capHolds.push({ playerId, teamId: state.userTeamId, amount: 5_000_000, type: "BIRD_UFA" });
    expect(getCapSheet(state, state.userTeamId).capHolds).toBe(0);
    const next = waivePlayer(state, playerId);
    expect(next.players[playerId].birdTeamId).toBeNull();
    expect(getCapSheet(next, next.userTeamId).capHolds).toBe(0);
  });

  it("uses the current season's cap and includes the recorded opening salary-floor shortfall", () => {
    const state = createCareer("cap-season-floor");
    state.league.seasonYear = 2027;
    state.league.seasonId = "2027-28";
    state.capState.salaryFloorShortfalls = [{ teamId: "SEA", seasonId: "2027-28", amount: 3_000_000 }];
    const sheet = getCapSheet(state, "SEA");
    expect(sheet.salaryFloorShortfall).toBe(3_000_000);
    expect(sheet.total).toBe(sheet.activeContractSalary + sheet.deadMoney + sheet.capHolds + sheet.activeOfferReservations + sheet.incompleteRosterCharges + sheet.salaryFloorShortfall);
    expect(sheet.availableCapSpace).toBe(getSeasonFinanceConfig(2027).salaryCap - sheet.total);
  });
});
