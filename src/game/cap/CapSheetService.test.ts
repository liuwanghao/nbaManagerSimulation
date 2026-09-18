import { describe, expect, it } from "vitest";
import { LEAGUE_FINANCE_CONFIG } from "../../config/leagueFinance";
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
});
