import { describe, expect, it } from "vitest";
import { EVENT_DEFINITIONS } from "../../data/events";
import { createCareer } from "../season/career";
import { blockingEvent, enqueueEvent, executeEventCommand } from "./EventService";

describe("data-driven event engine", () => {
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
    enqueueEvent(state, "streak_winning_005", {}, "2026-27:D20");
    enqueueEvent(state, "playoffs_champion_001", {}, "2026-27:D20");
    expect(state.eventState.queue[0].definitionId).toBe("playoffs_champion_001");
    const pending = blockingEvent(state);
    expect(pending?.effectivePause).toBe(true);
    const command = { commandId: "resolve-event-once", type: "RESOLVE_EVENT", payload: { eventInstanceId: pending?.eventInstanceId as string, choiceId: "acknowledge" } } as const;
    const supportBefore = state.teams[state.userTeamId].fanSupport;
    const resolved = executeEventCommand(state, command);
    expect(resolved.eventState.resolvedInstanceIds).toContain(pending?.eventInstanceId);
    expect(resolved.eventState.executedEffectIds).toContain(`${pending?.eventInstanceId}:fan_response`);
    expect(resolved.teams[resolved.userTeamId].fanSupport).toBe(supportBefore + 1);
    expect(executeEventCommand(resolved, command)).toBe(resolved);
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
});
