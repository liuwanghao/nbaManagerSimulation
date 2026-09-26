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

export function notificationDate(state: GameState): string {
  const date = new Date(`${state.calendar.openingDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + state.calendar.currentDateIndex);
  return date.toISOString().slice(0, 10);
}

export function addTeamNotification(state: GameState, notification: Omit<TeamNotification, "read">): void {
  state.teamNotifications ??= [];
  if (state.teamNotifications.some((entry) => entry.id === notification.id)) return;
  state.teamNotifications.unshift({ ...notification, date: notification.date ?? notificationDate(state), read: false });
  state.teamNotifications.length = Math.min(state.teamNotifications.length, MAX_NOTIFICATIONS);
}

export function ensureExpansionWelcomeNotification(state: GameState): void {
  if (!state.expansion?.finalized || state.history.seasons.length > 0
    || !["REGULAR_SEASON", "REGULAR_PRE_DEADLINE", "REGULAR_POST_DEADLINE"].includes(state.league.currentPhase)) return;
  const team = state.teams[state.userTeamId];
  if (!team) return;
  addTeamNotification(state, {
    id: `expansion-welcome-${state.league.seasonId}`, category: "TEAM", seasonId: state.league.seasonId,
    date: state.calendar.openingDate,
    title: `新球队诞生：${team.fullName}`,
    message: "扩军组队完成，新的赛季正式开始。赛季页可模拟比赛、查看赛程；管理页调整阵容与合同；市场页询价、交易及签约；联盟页查看排名与数据，生涯页记录球队荣誉。",
  });
}

export function getTeamInboxItems(state: GameState): TeamInboxItem[] {
  const pending: TeamInboxItem[] = [];
  const rfa = state.freeAgency?.pendingUserRfaDecision;
  if (rfa) pending.push({
    id: `action-rfa-${rfa.offerId}`, category: "FREE_AGENCY", seasonId: state.league.seasonId,
    title: "受限自由球员报价单待处理", message: "请决定是否匹配报价，再继续结算自由市场。",
    playerId: rfa.playerId, playerName: state.players[rfa.playerId]?.name, date: notificationDate(state), read: false, pending: true,
  });
  const emergency = state.injuryState.pendingEmergencyRoster;
  if (emergency?.teamId === state.userTeamId) pending.push({
    id: `action-emergency-${state.league.seasonId}-${state.calendar.currentDateIndex}`,
    category: "SEASON", seasonId: state.league.seasonId, title: "紧急名单待处理",
    message: `当前仅有 ${emergency.availableCount} 名可用球员，请在赛季页面补齐名单。`, date: notificationDate(state), read: false, pending: true,
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
