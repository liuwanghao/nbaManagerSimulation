import { describe, expect, it } from "vitest";
import { createExpansionCareerFromBundledDataset } from "../../data/hupuRoster";
import { simulateLeagueDay } from "../season/career";
import { executeFreeAgencyCommand, getFreeAgentOfferPreview, getFreeAgents } from "./FreeAgencyService";

describe("regular-season UFA offers", () => {
  it("accepts a legal UFA offer, settles it on league days, and records the contract", () => {
    let state = createExpansionCareerFromBundledDataset("regular-fa-test");
    state.league.currentPhase = "REGULAR_PRE_DEADLINE";
    const player = getFreeAgents(state).find((entry) => entry.contract.status === "UFA")!;
    const draft = getFreeAgentOfferPreview(state, player.id);
    expect(draft.valid).toBe(true);
    state = executeFreeAgencyCommand(state, { commandId: "regular-offer", type: "SUBMIT_FA_OFFER", payload: { playerId: player.id, ...draft.draft } });
    expect(Object.values(state.freeAgency!.offers)).toContainEqual(expect.objectContaining({ playerId: player.id, teamId: state.userTeamId, status: "ACTIVE" }));
    expect(state.capState.offerReservations).toHaveLength(1);
    for (let day = 0; day < 5 && state.players[player.id].teamId === "FREE_AGENT"; day += 1) state = simulateLeagueDay(state, day);
    expect(state.players[player.id].teamId).toBe(state.userTeamId);
    expect(state.players[player.id].contract.status).toBe("STANDARD");
    expect(state.capState.offerReservations).toHaveLength(0);
    expect((state.teamNotifications ?? []).some((item) => item.title === "自由球员签约成功")).toBe(true);
  });

  it("allows UFA offers after the trade deadline but keeps RFA offers in the offseason", () => {
    const state = createExpansionCareerFromBundledDataset("regular-fa-phases");
    const player = getFreeAgents(state).find((entry) => entry.contract.status === "UFA")!;
    state.league.currentPhase = "REGULAR_POST_DEADLINE";
    const draft = getFreeAgentOfferPreview(state, player.id);
    expect(draft.valid).toBe(true);
    expect(executeFreeAgencyCommand(state, { commandId: "post-deadline-ufa", type: "SUBMIT_FA_OFFER", payload: { playerId: player.id, ...draft.draft } }).freeAgency?.opened).toBe(true);
    player.contract.status = "RFA";
    expect(getFreeAgentOfferPreview(state, player.id)).toMatchObject({ valid: false, reason: "常规赛仅可向 UFA 报价" });
    expect(() => executeFreeAgencyCommand(state, { commandId: "regular-rfa", type: "SUBMIT_FA_OFFER", payload: { playerId: player.id, ...draft.draft } })).toThrow(/RFA offers/);
    state.league.currentPhase = "POSTSEASON";
    expect(() => executeFreeAgencyCommand(state, { commandId: "postseason-ufa", type: "SUBMIT_FA_OFFER", payload: { playerId: player.id, ...draft.draft } })).toThrow(/not allowed/);
  });
});
