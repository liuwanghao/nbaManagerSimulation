import { describe, expect, it } from "vitest";
import { EVENT_DEFINITIONS } from "../../data/events";
import { createCareer } from "../season/career";
import { stableHash } from "../random/hash";
import { emptyPlayerSeasonStats, type GameResult, type GameState } from "../state/types";
import { freeAgentAttraction } from "../team/TeamSystemService";
import { blockingEvent, enqueueAfterUserGameEvents, enqueueEvent, executeEventCommand, recentRookieBreakoutContext, settleInformationalEvents } from "./EventService";

function recentRookieGames(state: GameState, rookieId: string, rookiePoints: number[]): GameResult[] {
  const rivalId = Object.keys(state.teams).find((id) => id !== state.userTeamId) as string;
  const veteranId = state.teams[state.userTeamId].playerIds.find((id) => id !== rookieId) as string;
  state.players[veteranId].serviceYears = 1;
  return rookiePoints.map((points, index) => {
    const game: GameResult = {
      gameId: `rookie-game-${index}`, date: `2026-11-${String(index + 1).padStart(2, "0")}`,
      homeTeamId: state.userTeamId, awayTeamId: rivalId,
      homeScore: 100, awayScore: 90, winnerTeamId: state.userTeamId, overtimePeriods: 0,
      homeBoxScore: {
        teamId: state.userTeamId, score: 100,
        playerStats: [
          { ...emptyPlayerSeasonStats(), games: 1, seconds: 1_800, playerId: rookieId, pts: points, reb: 7, ast: 5 },
          { ...emptyPlayerSeasonStats(), games: 1, seconds: 1_800, playerId: veteranId, pts: 35 },
        ],
        totals: { ...emptyPlayerSeasonStats(), pts: points + 35, reb: 7, ast: 5 },
      },
    };
    state.userGameDetails[game.gameId] = game;
    return game;
  });
}

describe("data-driven event engine", () => {
  it("names the actual rookie and snapshots recent box-score numbers in a breakout notice", () => {
    const state = createCareer("rookie-breakout-stats");
    const rookie = state.players[state.teams[state.userTeamId].playerIds[0]];
    rookie.serviceYears = 0;
    const games = recentRookieGames(state, rookie.id, [4, 8, 16, 18, 20, 22]);
    state.lightweightResults = games.map(({ homeBoxScore: _homeBoxScore, ...game }) => game);
    const context = recentRookieBreakoutContext(state, state.lightweightResults);
    expect(context).toEqual({
      player_id: rookie.id, player_name: rookie.name,
      recent_summary: "近 3 场场均 20 分、7 篮板、5 助攻；上一场 22 分、7 篮板、5 助攻。",
    });
    const event = enqueueEvent(state, "breakout_rookie_001", context);
    expect(state.teamNotifications?.[0]).toMatchObject({
      title: `新秀爆发：${rookie.name}`,
      message: `${rookie.name} 近 3 场场均 20 分、7 篮板、5 助攻；上一场 22 分、7 篮板、5 助攻。`,
    });
    expect(state.teamNotifications?.[0].id).toBe(`event-${event?.eventInstanceId}`);
    expect(recentRookieBreakoutContext(state, state.lightweightResults)).toEqual(context);
  });

  it("does not label a veteran or an isolated rookie game as a rookie breakout", () => {
    const state = createCareer("rookie-breakout-eligibility");
    const rookie = state.players[state.teams[state.userTeamId].playerIds[0]];
    rookie.serviceYears = 0;
    const games = recentRookieGames(state, rookie.id, [4, 8, 5, 6, 7, 30]);
    state.lightweightResults = games.map(({ homeBoxScore: _homeBoxScore, ...game }) => game);
    expect(recentRookieBreakoutContext(state, state.lightweightResults)).toBeUndefined();
    rookie.serviceYears = 1;
    games[3].homeBoxScore!.playerStats[0].pts = 20;
    games[4].homeBoxScore!.playerStats[0].pts = 20;
    expect(recentRookieBreakoutContext(state, state.lightweightResults)).toBeUndefined();
  });

  it("uses the eligible rookie instead of the veteran game scorer when the random event fires", () => {
    const state = createCareer("rookie-breakout-selection");
    const rookie = state.players[state.teams[state.userTeamId].playerIds[0]];
    rookie.serviceYears = 0;
    const games = recentRookieGames(state, rookie.id, [4, 8, 16, 18, 20, 22]);
    state.lightweightResults = games.map(({ homeBoxScore: _homeBoxScore, ...game }) => game);
    const veteranId = games[5].homeBoxScore!.playerStats[1].playerId;
    const selectedSeed = Array.from({ length: 100 }, (_, index) => `rookie-selection-${index}`).find((seed) => {
      const roll = Number.parseInt(stableHash(seed, "dynamic-event", 6, veteranId).slice(8, 16), 16) / 0xffffffff;
      return roll >= 0.5 && roll < 0.75;
    });
    expect(selectedSeed).toBeDefined();
    state.seeds.seasonSeed = selectedSeed as string;
    enqueueAfterUserGameEvents(state);
    expect(state.teamNotifications?.some((notice) => notice.title === `新秀爆发：${rookie.name}`
      && notice.message.includes("近 3 场场均 20 分"))).toBe(true);
  });
  it("ships at least fifty unique valid V1 definitions", () => {
    expect(EVENT_DEFINITIONS.length).toBeGreaterThanOrEqual(50);
    expect(new Set(EVENT_DEFINITIONS.map((event) => event.id)).size).toBe(EVENT_DEFINITIONS.length);
    for (const event of EVENT_DEFINITIONS) {
      expect(event.version).toBeGreaterThan(0);
      expect(event.content.title).toBeTruthy();
      expect(event.choices.length).toBeGreaterThan(0);
      expect(event.conditions).toBeTypeOf("object");
      expect(event.aiChoice.strategy).toBeTruthy();
      expect(event.priority).toBeGreaterThanOrEqual(0);
    }
  });

  it("sorts the serializable queue, pauses only eligible scopes, and resolves idempotently", () => {
    const state = createCareer("event-queue");
    const player = state.players[state.teams[state.userTeamId].playerIds[0]];
    const context = { player_id: player.id, player_name: player.name };
    enqueueEvent(state, "role_starter_claim_001", context, "2026-27:D20");
    enqueueEvent(state, "morale_role_unhappy_001", context, "2026-27:D20");
    expect(state.eventState.queue[0].definitionId).toBe("morale_role_unhappy_001");
    const pending = blockingEvent(state);
    expect(pending?.effectivePause).toBe(true);
    const command = { commandId: "resolve-event-once", type: "RESOLVE_EVENT", payload: { eventInstanceId: pending?.eventInstanceId as string, choiceId: "maintain_plan" } } as const;
    const moraleBefore = player.morale;
    const resolved = executeEventCommand(state, command);
    expect(resolved.eventState.resolvedInstanceIds).toContain(pending?.eventInstanceId);
    expect(resolved.eventState.executedEffectIds).toContain(`${pending?.eventInstanceId}:morale_role_down`);
    expect(resolved.players[player.id].morale).toBe(moraleBefore - 8);
    expect(executeEventCommand(resolved, command)).toBe(resolved);
  });

  it("settles expansion at completion and keeps the season opening pending until entered", () => {
    const state = createCareer("season-opening-event");
    const supportBefore = state.teams[state.userTeamId].fanSupport;
    const attractionBefore = freeAgentAttraction(state, state.teams[state.userTeamId]);
    const expansion = enqueueEvent(state, "expansion_complete_001");
    expect(expansion?.status).toBe("RESOLVED");
    expect(state.teams[state.userTeamId].fanSupport).toBe(supportBefore + 1);
    expect(freeAgentAttraction(state, state.teams[state.userTeamId])).toBe(attractionBefore + 0.25);
    expect(state.teamNotifications).toEqual([]);
    expect(blockingEvent(state)).toBeUndefined();
    expect(enqueueEvent(state, "expansion_complete_001")).toBeUndefined();

    const opening = enqueueEvent(state, "franchise_season_opening_001");
    expect(opening?.status).toBe("PENDING");
    expect(blockingEvent(state)?.eventInstanceId).toBe(opening?.eventInstanceId);
    const resolved = executeEventCommand(state, {
      commandId: "enter-season-once", type: "RESOLVE_EVENT",
      payload: { eventInstanceId: opening?.eventInstanceId as string, choiceId: "acknowledge" },
    });
    expect(blockingEvent(resolved)).toBeUndefined();
    expect(resolved.teams[resolved.userTeamId].fanSupport).toBe(supportBefore + 1);
    expect(enqueueEvent(resolved, "franchise_season_opening_001")).toBeUndefined();
  });

  it("applies a snapshotted player effect once when a choice resolves", () => {
    const state = createCareer("event-player-effect");
    const player = state.players[state.teams[state.userTeamId].playerIds[0]];
    const event = enqueueEvent(state, "morale_role_unhappy_001", { player_id: player.id, player_name: player.name });
    const before = player.morale;
    const resolved = executeEventCommand(state, { commandId: "resolve-morale", type: "RESOLVE_EVENT", payload: { eventInstanceId: event?.eventInstanceId as string, choiceId: "increase_role" } });
    expect(resolved.players[player.id].morale).toBe(before + 12);
    expect(resolved.eventState.executedEffectIds).toContain(`${event?.eventInstanceId}:morale_role_up`);
  });

  it("gives player morale and role events a consequential manager choice", () => {
    const state = createCareer("event-manager-choice");
    const player = state.players[state.teams[state.userTeamId].playerIds[0]];
    const event = enqueueEvent(state, "morale_minutes_001", { player_id: player.id, player_name: player.name });
    expect(event?.choices.map((choice) => choice.id)).toEqual(["increase_role", "maintain_plan"]);
    const promoted = executeEventCommand(state, { commandId: "resolve-manager-up", type: "RESOLVE_EVENT", payload: { eventInstanceId: event?.eventInstanceId as string, choiceId: "increase_role" } });
    expect(promoted.players[player.id].morale).toBe(player.morale + 12);

    const declinedState = createCareer("event-manager-choice-decline");
    const declinedPlayer = declinedState.players[declinedState.teams[declinedState.userTeamId].playerIds[0]];
    const declinedEvent = enqueueEvent(declinedState, "morale_minutes_001", { player_id: declinedPlayer.id, player_name: declinedPlayer.name });
    const declined = executeEventCommand(declinedState, { commandId: "resolve-manager-down", type: "RESOLVE_EVENT", payload: { eventInstanceId: declinedEvent?.eventInstanceId as string, choiceId: "maintain_plan" } });
    expect(declined.players[declinedPlayer.id].morale).toBe(declinedPlayer.morale - 8);
  });

  it("upgrades an already-saved acknowledgement-only morale event when resolving it", () => {
    const state = createCareer("event-legacy-choice");
    const player = state.players[state.teams[state.userTeamId].playerIds[0]];
    const event = enqueueEvent(state, "morale_minutes_001", { player_id: player.id, player_name: player.name });
    if (event) event.choices = [{ id: "acknowledge", label: "确认", effects: [{ effectId: "legacy", type: "PLAYER_MORALE", target: player.id, value: 6, executionPhase: "ON_CHOICE" }] }];
    const resolved = executeEventCommand(state, { commandId: "resolve-legacy-choice", type: "RESOLVE_EVENT", payload: { eventInstanceId: event?.eventInstanceId as string, choiceId: "maintain_plan" } });
    expect(resolved.players[player.id].morale).toBe(player.morale - 8);
  });

  it("safely skips unknown definitions", () => {
    const state = createCareer("event-unknown");
    expect(enqueueEvent(state, "future_event_v99")).toBeUndefined();
    expect(state.eventState.leagueLog[0]).toMatch(/安全跳过/);
  });

  it("pauses on an injury until a rotation choice is made", () => {
    const state = createCareer("informational-injury");
    const player = state.players[state.teams[state.userTeamId].playerIds[0]];
    const event = enqueueEvent(state, "injury_depth_test_001", { player_id: player.id, player_name: "测试球员", games_out: "3" });
    expect(event?.status).toBe("PENDING");
    expect(blockingEvent(state)?.eventInstanceId).toBe(event?.eventInstanceId);
    expect(event?.choices.map((choice) => choice.id)).toEqual(["auto_adjust", "manual_adjust"]);
    expect(state.teamNotifications).not.toContainEqual(expect.objectContaining({ id: `event-${event?.eventInstanceId}` }));
    const resolved = executeEventCommand(state, { commandId: "injury-choice", type: "RESOLVE_EVENT", payload: { eventInstanceId: event!.eventInstanceId, choiceId: "auto_adjust" } });
    expect(resolved.eventState.queue).toEqual([]);
    expect(resolved.eventState.resolvedInstanceIds).toContain(event?.eventInstanceId);
    expect(resolved.teamNotifications).toContainEqual(expect.objectContaining({
      id: `event-${event?.eventInstanceId}`,
      category: "SEASON",
      title: "轮换球员受伤",
      message: "测试球员受伤，预计缺阵 3 场。已自动调整轮换。",
      read: false,
    }));
  });

  it("delivers winning and losing streak milestones as team notices and applies their effects once", () => {
    const state = createCareer("streak-notifications");
    for (const [definitionId, title, delta] of [
      ["streak_winning_003", "三连胜", 1], ["streak_winning_005", "五连胜", 1], ["streak_winning_010", "十连胜", 1],
      ["streak_losing_003", "三连败", -1], ["streak_losing_005", "五连败", -1], ["streak_losing_010", "十连败", -1],
    ] as const) {
      const supportBefore = state.teams[state.userTeamId].fanSupport;
      const event = enqueueEvent(state, definitionId);
      expect(event?.status).toBe("RESOLVED");
      expect(event?.effectivePause).toBe(false);
      expect(state.teams[state.userTeamId].fanSupport).toBe(supportBefore + delta);
      expect(state.teamNotifications?.[0]).toMatchObject({ id: `event-${event?.eventInstanceId}`, category: "TEAM", title, read: false });
      expect(state.eventState.queue).toEqual([]);
      expect(blockingEvent(state)).toBeUndefined();
      expect(enqueueEvent(state, definitionId)).toBeUndefined();
      expect(state.teams[state.userTeamId].fanSupport).toBe(supportBefore + delta);
    }
  });

  it("applies a one-choice franchise milestone without showing a numeric effect in notifications", () => {
    const state = createCareer("ten-win-notification");
    const supportBefore = state.teams[state.userTeamId].fanSupport;
    const event = enqueueEvent(state, "franchise_ten_wins_001");
    expect(event?.status).toBe("RESOLVED");
    expect(state.eventState.queue).toEqual([]);
    expect(blockingEvent(state)).toBeUndefined();
    expect(state.teams[state.userTeamId].fanSupport).toBe(supportBefore + 1);
    expect(state.teamNotifications).toContainEqual(expect.objectContaining({
      id: `event-${event?.eventInstanceId}`,
      title: "初具竞争力",
      message: "球队取得生涯第十场胜利。",
      read: false,
    }));
    expect(enqueueEvent(state, "franchise_ten_wins_001")).toBeUndefined();
    expect(state.teams[state.userTeamId].fanSupport).toBe(supportBefore + 1);
  });

  it("routes visible acknowledgement-only events to notices and background events to the log", () => {
    const state = createCareer("all-acknowledgements");
    const player = state.players[state.teams[state.userTeamId].playerIds[0]];
    const definitions = EVENT_DEFINITIONS.filter((definition) => definition.choices.length === 1
      && definition.choices[0].id === "acknowledge" && definition.id !== "franchise_season_opening_001");
    expect(definitions.length).toBeGreaterThan(40);
    for (const definition of definitions) {
      const event = enqueueEvent(state, definition.id, { player_id: player.id, player_name: player.name, games_out: "3" }, `${state.league.seasonId}:${definition.id}`);
      expect(event?.status, definition.id).toBe("RESOLVED");
      expect(state.eventState.queue, definition.id).toEqual([]);
      expect(state.teamNotifications?.some((item) => item.id === `event-${event?.eventInstanceId}`), definition.id)
        .toBe(definition.visibility === "PLAYER_VISIBLE");
    }
    expect(blockingEvent(state)).toBeUndefined();
  });

  it("moves a pending streak from an older save into notifications without losing its effect", () => {
    const source = createCareer("saved-streak-notification");
    const event = enqueueEvent(source, "streak_losing_003");
    if (!event) throw new Error("Expected streak event");
    const restored = createCareer("saved-streak-notification");
    const supportBefore = restored.teams[restored.userTeamId].fanSupport;
    restored.eventState.queue = [{ ...event, status: "PENDING", selectedChoiceId: undefined }];
    settleInformationalEvents(restored);
    settleInformationalEvents(restored);
    expect(restored.teams[restored.userTeamId].fanSupport).toBe(supportBefore - 1);
    expect(restored.eventState.queue).toEqual([]);
    expect(restored.teamNotifications).toHaveLength(1);
    expect(restored.eventState.executedEffectIds).toContain(`${event.eventInstanceId}:fan_response`);
  });

  it("dismisses an old later-season opening event when loading a save", () => {
    const state = createCareer("legacy-later-season-opening");
    state.expansion = { finalized: true } as NonNullable<typeof state.expansion>;
    const opening = enqueueEvent(state, "franchise_season_opening_001");
    expect(opening?.status).toBe("PENDING");
    state.league.seasonYear = 2027;
    state.league.seasonId = "2027-28";
    settleInformationalEvents(state);
    settleInformationalEvents(state);
    expect(state.eventState.queue).toEqual([]);
    expect(state.eventState.resolvedInstanceIds).toContain(opening?.eventInstanceId);
    expect(state.teamNotifications).toEqual([]);
  });

  it("migrates a paused one-choice event but keeps legacy player conversations actionable", () => {
    const source = createCareer("saved-event-routing");
    const milestone = enqueueEvent(source, "playoffs_champion_001");
    if (!milestone) throw new Error("Expected championship event");
    const restored = createCareer("saved-event-routing");
    const player = restored.players[restored.teams[restored.userTeamId].playerIds[0]];
    const conversation = enqueueEvent(restored, "morale_minutes_001", { player_id: player.id, player_name: player.name });
    if (!conversation) throw new Error("Expected player conversation");
    conversation.choices = [{ id: "acknowledge", label: "确认", effects: [{ effectId: "legacy", type: "PLAYER_MORALE", target: player.id, value: 6, executionPhase: "ON_CHOICE" }] }];
    restored.eventState.queue.push({ ...milestone, status: "PENDING", effectivePause: true, selectedChoiceId: undefined });
    const supportBefore = restored.teams[restored.userTeamId].fanSupport;
    settleInformationalEvents(restored);
    settleInformationalEvents(restored);
    expect(restored.teams[restored.userTeamId].fanSupport).toBe(supportBefore + 1);
    expect(restored.teamNotifications?.filter((item) => item.id === `event-${milestone.eventInstanceId}`)).toHaveLength(1);
    expect(restored.eventState.queue.map((event) => event.eventInstanceId)).toEqual([conversation.eventInstanceId]);
    expect(blockingEvent(restored)?.eventInstanceId).toBe(conversation.eventInstanceId);
  });

  it("sends league-wide acknowledgement events to the inbox", () => {
    const state = createCareer("league-informational-event");
    const event = enqueueEvent(state, "trade_ai_completed_001");
    expect(event?.status).toBe("RESOLVED");
    expect(state.teamNotifications).toContainEqual(expect.objectContaining({ id: `event-${event?.eventInstanceId}`, title: "联盟交易" }));
    expect(state.eventState.leagueLog.filter((entry) => entry.includes("联盟交易"))).toHaveLength(0);
  });

  it("queues separate injury decisions for two players on the same game day", () => {
    const state = createCareer("two-injury-notices");
    const first = enqueueEvent(state, "injury_depth_test_001", { player_id: "first", player_name: "甲", games_out: "2" }, "2026-27:D20");
    const second = enqueueEvent(state, "injury_depth_test_001", { player_id: "second", player_name: "乙", games_out: "5" }, "2026-27:D20");
    expect(first?.eventInstanceId).not.toBe(second?.eventInstanceId);
    expect(state.eventState.queue.map((item) => item.eventInstanceId).sort()).toEqual([first!.eventInstanceId, second!.eventInstanceId].sort());
    const firstResolved = executeEventCommand(state, { commandId: "injury-first", type: "RESOLVE_EVENT", payload: { eventInstanceId: first!.eventInstanceId, choiceId: "auto_adjust" } });
    const bothResolved = executeEventCommand(firstResolved, { commandId: "injury-second", type: "RESOLVE_EVENT", payload: { eventInstanceId: second!.eventInstanceId, choiceId: "auto_adjust" } });
    expect(bothResolved.teamNotifications?.map((item) => item.message)).toEqual([
      "乙受伤，预计缺阵 5 场。已自动调整轮换。",
      "甲受伤，预计缺阵 2 场。已自动调整轮换。",
    ]);
    expect(enqueueEvent(state, "injury_depth_test_001", { player_id: "first", player_name: "甲", games_out: "2" }, "2026-27:D20")).toBeUndefined();
  });

  it("changes the rotation when the manager accepts a starter request", () => {
    const state = createCareer("starter-request-effect");
    const team = state.teams[state.userTeamId];
    const player = team.playerIds.map((id) => state.players[id]).find((candidate) => candidate.available && candidate.rotationRole !== "STARTER");
    if (!player || !team.rotationPlan) throw new Error("Expected a reserve and rotation plan");
    const before = team.rotationPlan.targetMinutes[player.id] ?? 0;
    const event = enqueueEvent(state, "role_starter_claim_001", { player_id: player.id, player_name: player.name });
    if (!event) throw new Error("Expected role request");
    const accepted = executeEventCommand(state, { commandId: "accept-starter-request", type: "RESOLVE_EVENT", payload: { eventInstanceId: event.eventInstanceId, choiceId: "increase_role" } });
    expect(accepted.teams[accepted.userTeamId].rotationPlan?.targetMinutes[player.id]).toBeGreaterThan(before);
    expect(accepted.players[player.id].rotationRole).toBe("STARTER");
    expect(Object.values(accepted.teams[accepted.userTeamId].rotationPlan?.targetMinutes ?? {}).reduce((sum, minutes) => sum + minutes, 0)).toBe(240);
    const declined = executeEventCommand(state, { commandId: "decline-starter-request", type: "RESOLVE_EVENT", payload: { eventInstanceId: event.eventInstanceId, choiceId: "maintain_plan" } });
    expect(declined.teams[declined.userTeamId].rotationPlan).toEqual(team.rotationPlan);
  });

  it("adds a rotation consequence to a role conversation saved before this update", () => {
    const state = createCareer("saved-role-dialogue");
    const team = state.teams[state.userTeamId];
    const player = team.playerIds.map((id) => state.players[id]).find((candidate) => candidate.available && candidate.rotationRole !== "STARTER");
    if (!player || !team.rotationPlan) throw new Error("Expected healthy reserve");
    const before = team.rotationPlan.targetMinutes[player.id] ?? 0;
    const event = enqueueEvent(state, "role_rookie_growth_001", { player_id: player.id, player_name: player.name });
    if (!event) throw new Error("Expected role event");
    event.choices[0].effects = event.choices[0].effects.filter((effect) => effect.type !== "PLAYER_ROTATION");
    const resolved = executeEventCommand(state, { commandId: "legacy-role-response", type: "RESOLVE_EVENT", payload: { eventInstanceId: event.eventInstanceId, choiceId: "increase_role" } });
    expect(resolved.teams[resolved.userTeamId].rotationPlan?.targetMinutes[player.id]).toBeGreaterThan(before);
  });
});
