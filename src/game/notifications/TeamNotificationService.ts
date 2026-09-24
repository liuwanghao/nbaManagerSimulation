import { stableHash } from "../random/hash";
import type { GameState, TeamNotification } from "../state/types";

const MAX_NOTIFICATIONS = 80;

export interface TeamInboxItem extends TeamNotification {
  pending: boolean;
}

export type TeamNotificationCommand = {
  commandId: string;
  type: "MARK_TEAM_NOTIFICATIONS_READ";
  payload: { ids: readonly string[] };
};

export function addTeamNotification(state: GameState, notification: Omit<TeamNotification, "read">): void {
  state.teamNotifications ??= [];
  if (state.teamNotifications.some((entry) => entry.id === notification.id)) return;
  state.teamNotifications.unshift({ ...notification, read: false });
  state.teamNotifications.length = Math.min(state.teamNotifications.length, MAX_NOTIFICATIONS);
}

export function getTeamInboxItems(state: GameState): TeamInboxItem[] {
  const pending: TeamInboxItem[] = [];
  const rfa = state.freeAgency?.pendingUserRfaDecision;
  if (rfa) pending.push({
    id: `action-rfa-${rfa.offerId}`, category: "FREE_AGENCY", seasonId: state.league.seasonId,
    title: "受限自由球员报价单待处理", message: "请决定是否匹配报价，再继续结算自由市场。",
    playerId: rfa.playerId, playerName: state.players[rfa.playerId]?.name, read: false, pending: true,
  });
  const injury = state.injuryState.pendingUserMajorInjury;
  if (injury) pending.push({
    id: `action-injury-${injury.injuryId}`, category: "SEASON", seasonId: state.league.seasonId,
    title: "重大伤病待确认", message: "请在赛季页面确认伤病并调整阵容。",
    playerId: injury.playerId, playerName: state.players[injury.playerId]?.name, read: false, pending: true,
  });
  const emergency = state.injuryState.pendingEmergencyRoster;
  if (emergency?.teamId === state.userTeamId) pending.push({
    id: `action-emergency-${state.league.seasonId}-${state.calendar.currentDateIndex}`,
    category: "SEASON", seasonId: state.league.seasonId, title: "紧急名单待处理",
    message: `当前仅有 ${emergency.availableCount} 名可用球员，请在赛季页面补齐名单。`, read: false, pending: true,
  });
  for (const event of state.eventState.queue.filter((entry) => entry.status === "PENDING")) pending.push({
    id: `action-event-${event.eventInstanceId}`, category: "SEASON", seasonId: event.seasonId,
    title: event.title, message: event.description, read: false, pending: true,
  });
  return [...pending, ...(state.teamNotifications ?? []).map((entry) => ({ ...entry, pending: false }))];
}

export function executeTeamNotificationCommand(input: GameState, command: TeamNotificationCommand): GameState {
  const payloadHash = stableHash(command.type, command.payload);
  const receipt = input.commandReceipts[command.commandId];
  if (receipt) {
    if (receipt.payloadHash !== payloadHash) throw new Error("Command ID 已被不同 Payload 使用");
    return input;
  }
  const state = structuredClone(input);
  const ids = new Set(command.payload.ids);
  for (const notification of state.teamNotifications ?? []) {
    if (ids.has(notification.id)) notification.read = true;
  }
  state.commandReceipts[command.commandId] = { payloadHash };
  return state;
}
