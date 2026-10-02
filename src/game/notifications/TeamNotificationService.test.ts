import { describe, expect, it } from "vitest";
import { enqueueEvent, executeEventCommand } from "../events/EventService";
import { createCareer } from "../season/career";
import { addTeamNotification, ensureExpansionWelcomeNotification, executeTeamNotificationCommand, getTeamInboxItems, repairCareerMilestoneNotifications } from "./TeamNotificationService";

describe("team notifications", () => {
  it("preserves a read duplicate and ignores unrelated notices with the same title during milestone repair", () => {
    const state = createCareer("legacy-read-milestone-duplicate");
    enqueueEvent(state, "playoffs_appearance_001");
    const original = state.teamNotifications![0];
    state.teamNotifications!.unshift({ ...original, id: "event-read-repeat", read: true,
      message: `${original.message} · 球迷支持 +1` });
    addTeamNotification(state, { ...original, id: "custom-same-title", message: "另一条独立消息。" });
    repairCareerMilestoneNotifications(state);
    expect(state.teamNotifications).toHaveLength(2);
    expect(state.teamNotifications).toContainEqual({ ...original, read: true });
    expect(state.teamNotifications).toContainEqual(expect.objectContaining({ id: "custom-same-title", read: false }));
    const repaired = structuredClone(state);
    repairCareerMilestoneNotifications(state);
    expect(state).toEqual(repaired);
  });

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

  it("hides numeric effect suffixes in new and previously saved notices", () => {
    const state = createCareer("notice-effect-copy");
    addTeamNotification(state, {
      id: "new-streak", category: "TEAM", seasonId: state.league.seasonId,
      title: "三连败", message: "球队需要尽快终止连败。 球迷支持 -1",
    });
    expect(state.teamNotifications?.[0].message).toBe("球队需要尽快终止连败。");
    state.teamNotifications?.push({
      id: "saved-event", category: "SEASON", seasonId: state.league.seasonId,
      title: "球队动态", message: "球员调整完成。 球员士气 +6 · 竞技状态 -0.4",
      date: state.calendar.openingDate, read: false,
    });
    state.teamNotifications?.push({
      id: "injury", category: "SEASON", seasonId: state.league.seasonId,
      title: "核心球员受伤", message: "预计缺阵 3 场。",
      date: state.calendar.openingDate, read: false,
    });
    expect(getTeamInboxItems(state).map((item) => item.message)).toEqual([
      "球队需要尽快终止连败。", "球员调整完成。", "预计缺阵 3 场。",
    ]);
  });

  it("shows current duration and scheduled missed games for an active injury in an older save", () => {
    const state = createCareer("legacy-injury-notice");
    const player = state.players[state.teams[state.userTeamId].playerIds[0]];
    player.injury = {
      injuryId: "legacy-injury", severity: "SEASON_ENDING", daysRemaining: 130, gamesRemaining: 61,
      occurredSeasonId: state.league.seasonId, occurredGameId: "legacy-game", previousRotationRole: player.rotationRole,
    };
    state.schedule = state.schedule
      .filter((game) => game.homeTeamId === state.userTeamId || game.awayTeamId === state.userTeamId)
      .slice(0, 18)
      .map((game, index) => ({ ...game, dateIndex: index + 1, status: "SCHEDULED" }));
    addTeamNotification(state, {
      id: "legacy-injury-notice", category: "SEASON", seasonId: state.league.seasonId,
      title: "核心球员受伤", message: `${player.name}受伤，预计缺阵 61 场。已自动调整轮换。`,
    });
    expect(getTeamInboxItems(state)[0].message).toBe(`${player.name}受伤，赛季报销，预计缺席 18 场。已自动调整轮换。`);
    expect(state.teamNotifications?.[0].message).toContain("61 场");
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

  it("replaces the old expansion event notice with the regular-season welcome", () => {
    const state = createCareer("legacy-expansion-notice");
    state.league.currentPhase = "PRESEASON";
    state.expansion = { finalized: true } as NonNullable<typeof state.expansion>;
    state.teamNotifications = [{
      id: "event-old-expansion", category: "SEASON", seasonId: state.league.seasonId,
      title: "新球队诞生", message: "扩军选秀完成，一支新球队正式加入联盟。 球迷支持 +1",
      date: state.calendar.openingDate, read: false,
    }];
    ensureExpansionWelcomeNotification(state);
    expect(getTeamInboxItems(state).map((item) => item.id)).toEqual([]);
    state.league.currentPhase = "REGULAR_PRE_DEADLINE";
    ensureExpansionWelcomeNotification(state);
    ensureExpansionWelcomeNotification(state);
    expect(getTeamInboxItems(state).map((item) => item.id)).toEqual([`expansion-welcome-${state.league.seasonId}`]);
    expect(state.teamNotifications?.[0].message).not.toContain("球迷支持 +1");
  });

  it("never shows or resends the old expansion notice during the draft", () => {
    const state = createCareer("draft-expansion-notice");
    state.league.currentPhase = "ROOKIE_DRAFT_PENDING";
    const obsolete = {
      id: "event-old-expansion", category: "SEASON" as const, seasonId: state.league.seasonId,
      title: "新球队诞生", message: "扩军选秀完成，一支新球队正式加入联盟。 球迷支持 +1",
      date: state.calendar.openingDate, read: false,
    };
    state.teamNotifications = [obsolete];
    expect(getTeamInboxItems(state)).toEqual([]);
    state.teamNotifications = [];
    addTeamNotification(state, obsolete);
    expect(state.teamNotifications).toEqual([]);
  });
});
