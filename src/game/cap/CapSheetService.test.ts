import { describe, expect, it } from "vitest";
import { getSeasonFinanceConfig, LEAGUE_FINANCE_CONFIG } from "../../config/leagueFinance";
import { createCareer } from "../season/career";
import { getCapSheet } from "./CapSheetService";

describe("CapSheetService", () => {
  it("is the single total for contracts, holds, dead money, reservations and incomplete roster charges", () => {
    const state = createCareer("cap-sheet");
    const teamId = "SEA";
    state.teams[teamId].playerIds = state.teams[teamId].playerIds.slice(0, 8);
    const heldPlayerId = state.teams[teamId].playerIds[0];
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
