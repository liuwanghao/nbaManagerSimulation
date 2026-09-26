import { describe, expect, it } from "vitest";
import { enqueueEvent, executeEventCommand } from "../events/EventService";
import { createCareer } from "../season/career";
import { addTeamNotification, ensureExpansionWelcomeNotification, executeTeamNotificationCommand, getTeamInboxItems } from "./TeamNotificationService";

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
    expect(getTeamInboxItems(state)[0].date).toBe(state.calendar.openingDate);
    const command = { commandId: "read-offer-result-1", type: "MARK_TEAM_NOTIFICATIONS_READ", payload: { ids: ["offer-result-1"] } } as const;
    const read = executeTeamNotificationCommand(state, command);
    expect(state.teamNotifications?.[0].read).toBe(false);
    expect(read.teamNotifications?.[0].read).toBe(true);
    expect(executeTeamNotificationCommand(read, command)).toBe(read);
    read.league.currentPhase = "REGULAR_PRE_DEADLINE";
    expect(getTeamInboxItems(structuredClone(read))[0]).toMatchObject({ id: "offer-result-1", read: true, pending: false });
  });

  it("keeps event decisions in the event queue rather than the team inbox", () => {
    const state = createCareer("team-inbox-event");
    const player = state.players[state.teams[state.userTeamId].playerIds[0]];
    const event = enqueueEvent(state, "morale_role_unhappy_001", { player_id: player.id, player_name: player.name }, "2026-27:D20");
    if (!event) throw new Error("event was not enqueued");
    expect(state.eventState.queue).toContainEqual(expect.objectContaining({ eventInstanceId: event.eventInstanceId, status: "PENDING" }));
    expect(getTeamInboxItems(state)).toEqual([]);
    const resolved = executeEventCommand(state, { commandId: "resolve-inbox-event", type: "RESOLVE_EVENT", payload: { eventInstanceId: event.eventInstanceId, choiceId: "maintain_plan" } });
    expect(resolved.eventState.queue).toEqual([]);
    expect(getTeamInboxItems(resolved)).toEqual([]);
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
    expect(getTeamInboxItems(state)[0].date).toBe(state.calendar.openingDate);
  });

  it("records the in-game date when a notification is created", () => {
    const state = createCareer("dated-notification");
    state.calendar.currentDateIndex = 14;
    addTeamNotification(state, { id: "day-14", category: "TEAM", seasonId: state.league.seasonId, title: "球队动态", message: "已记录。" });
    expect(state.teamNotifications?.[0].date).toBe("2026-11-03");
  });

  it("backfills the first-season expansion welcome only once with the opening date", () => {
    const state = createCareer("old-expansion-save");
    state.league.currentPhase = "REGULAR_PRE_DEADLINE";
    state.calendar.currentDateIndex = 14;
    state.expansion = { finalized: true } as NonNullable<typeof state.expansion>;
    ensureExpansionWelcomeNotification(state);
    ensureExpansionWelcomeNotification(state);
    expect(state.teamNotifications).toHaveLength(1);
    expect(state.teamNotifications?.[0]).toMatchObject({
      id: `expansion-welcome-${state.league.seasonId}`, date: state.calendar.openingDate,
    });
  });
});
