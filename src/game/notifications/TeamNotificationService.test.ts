import { describe, expect, it } from "vitest";
import { enqueueEvent, executeEventCommand } from "../events/EventService";
import { createCareer } from "../season/career";
import { addTeamNotification, executeTeamNotificationCommand, getTeamInboxItems } from "./TeamNotificationService";

describe("team notifications", () => {
  it("keeps offer feedback across phases and persists read state through a command", () => {
    const state = createCareer("team-inbox-read");
    addTeamNotification(state, {
      id: "offer-result-1", category: "FREE_AGENCY", seasonId: state.league.seasonId,
      title: "自由球员签约成功", message: "合同已生效。",
    });
    addTeamNotification(state, {
      id: "offer-result-1", category: "FREE_AGENCY", seasonId: state.league.seasonId,
      title: "自由球员签约成功", message: "合同已生效。",
    });
    expect(getTeamInboxItems(state)).toHaveLength(1);
    const command = { commandId: "read-offer-result-1", type: "MARK_TEAM_NOTIFICATIONS_READ", payload: { ids: ["offer-result-1"] } } as const;
    const read = executeTeamNotificationCommand(state, command);
    expect(state.teamNotifications?.[0].read).toBe(false);
    expect(read.teamNotifications?.[0].read).toBe(true);
    expect(executeTeamNotificationCommand(read, command)).toBe(read);
    read.league.currentPhase = "REGULAR_PRE_DEADLINE";
    expect(getTeamInboxItems(structuredClone(read))[0]).toMatchObject({ id: "offer-result-1", read: true, pending: false });
  });

  it("shows regular-season events as actionable until resolved", () => {
    const state = createCareer("team-inbox-event");
    const event = enqueueEvent(state, "playoffs_champion_001", {}, "2026-27:D20");
    if (!event) throw new Error("event was not enqueued");
    expect(getTeamInboxItems(state)).toContainEqual(expect.objectContaining({ id: `action-event-${event.eventInstanceId}`, pending: true }));
    const resolved = executeEventCommand(state, { commandId: "resolve-inbox-event", type: "RESOLVE_EVENT", payload: { eventInstanceId: event.eventInstanceId, choiceId: "acknowledge" } });
    expect(getTeamInboxItems(resolved).some((item) => item.id === `action-event-${event.eventInstanceId}`)).toBe(false);
  });

  it("keeps a pending RFA matching decision above informational messages", () => {
    const state = createCareer("team-inbox-rfa");
    const playerId = state.teams[state.userTeamId].playerIds[0];
    addTeamNotification(state, { id: "older-result", category: "FREE_AGENCY", seasonId: state.league.seasonId, title: "旧报价结果", message: "已结算。" });
    state.freeAgency = {
      opened: true, currentDay: 3, offers: {}, markets: {}, settledPlayerDay: {}, transactionLog: [],
      pendingUserRfaDecision: { playerId, offerId: "offer-sheet-1", originalTeamId: state.userTeamId, deadline: 4 },
    };
    expect(getTeamInboxItems(state).map((item) => [item.id, item.pending])).toEqual([
      ["action-rfa-offer-sheet-1", true], ["older-result", false],
    ]);
  });
});
