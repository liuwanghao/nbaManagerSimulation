import { stableHash } from "../random/hash";
import { CAREER_MILESTONE_EVENTS, EVENT_DEFINITION_BY_ID } from "../../data/events";
import type { GameState, TeamNotification } from "../state/types";
import { estimatedInjuryMissedGames, injuryDaysRemaining, injuryDurationLabel } from "../simulation/injuryEstimate";

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

function isSupersededExpansionNotice(notification: Pick<TeamNotification, "title" | "message">): boolean {
  return notification.title === "新球队诞生"
    && notification.message.startsWith("扩军选秀完成，一支新球队正式加入联盟。");
}

function notificationMessage(message: string): string {
  const effectSuffix = /(?:\s*·)?\s*(?:球迷支持|球队声望|球员士气|竞技状态)\s*[+-]\d+(?:\.\d+)?\s*$/u;
  let visible = message;
  while (effectSuffix.test(visible)) visible = visible.replace(effectSuffix, "");
  return visible;
}

function legacyInjuryNoticeMessage(state: GameState, notification: TeamNotification): string {
  if (notification.category !== "SEASON" || !["核心球员受伤", "轮换球员受伤"].includes(notification.title)
    || !/预计缺阵 \d+ 场。/u.test(notification.message)) return notification.message;
  const player = state.teams[state.userTeamId].playerIds
    .map((id) => state.players[id])
    .find((candidate) => candidate?.injury && notification.message.startsWith(`${candidate.name}受伤，`));
  if (!player?.injury) return notification.message;
  const days = injuryDaysRemaining(player);
  const games = estimatedInjuryMissedGames(state, player);
  if (days === null || games === null) return notification.message;
  return notification.message.replace(/预计缺阵 \d+ 场。/u,
    `${injuryDurationLabel(player.injury.severity, days)}，预计缺席 ${games} 场。`);
}

export function addTeamNotification(state: GameState, notification: Omit<TeamNotification, "read">): void {
  if (isSupersededExpansionNotice(notification)) return;
  state.teamNotifications ??= [];
  if (state.teamNotifications.some((entry) => entry.id === notification.id)) return;
  state.teamNotifications.unshift({ ...notification, message: notificationMessage(notification.message), date: notification.date ?? notificationDate(state), read: false });
  state.teamNotifications.length = Math.min(state.teamNotifications.length, MAX_NOTIFICATIONS);
}

export function ensureExpansionWelcomeNotification(state: GameState): void {
  // Older saves may already contain the draft-completion notice. Its +1 effect remains in
  // the saved team state; only the superseded inbox copy is removed.
  if (state.teamNotifications?.some(isSupersededExpansionNotice)) {
    state.teamNotifications = state.teamNotifications.filter((entry) => !isSupersededExpansionNotice(entry));
  }
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

/** Keeps the original milestone notice without replaying effects from legacy duplicates. */
export function repairCareerMilestoneNotifications(state: GameState): void {
  for (const definitionId of Object.values(CAREER_MILESTONE_EVENTS)) {
    const definition = EVENT_DEFINITION_BY_ID[definitionId];
    const notices = (state.teamNotifications ?? []).filter((notice) => notice.id.startsWith("event-")
      && notice.category === "SEASON" && notice.title === definition.content.title
      && notificationMessage(notice.message) === definition.content.description);
    // The inbox stores newest first, so the last match is the original occurrence.
    const original = notices.at(-1);
    if (!original) continue;
    state.eventState.lastOccurrenceByDefinition[definitionId] ??= {
      seasonId: original.seasonId, careerGame: 0,
    };
    if (notices.length <= 1) continue;
    original.read = notices.some((notice) => notice.read);
    const duplicateIds = new Set(notices.slice(0, -1).map((notice) => notice.id));
    state.teamNotifications = state.teamNotifications?.filter((notice) => !duplicateIds.has(notice.id));
  }
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
  return [...pending, ...(state.teamNotifications ?? []).filter((entry) => !isSupersededExpansionNotice(entry)).map((entry) => ({ ...entry, message: notificationMessage(legacyInjuryNoticeMessage(state, entry)), pending: false }))];
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
