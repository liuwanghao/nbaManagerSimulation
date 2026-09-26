import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { SaveSlotSummary } from "../storage/SaveService";
import type { TeamInboxItem } from "../game/notifications/TeamNotificationService";
import type { Player } from "../game/state/types";
import { localizePlayerNamesInText, playerNameZh } from "./playerNameZh";
import { humanizeUiText, phaseLabel } from "./uiText";
import { UserFeedbackDialog } from "./UserFeedbackDialog";

export type SeasonTab = "home" | "manage" | "market" | "league" | "career";

interface GameChromeProps {
  phase: string;
  busy?: boolean;
  dataLabel?: string;
  onSave?: (slot?: 1 | 2 | 3) => Promise<void>;
  onLoad?: (slot?: 1 | 2 | 3) => Promise<boolean>;
  onLoadLatest?: () => Promise<boolean>;
  activeSlot?: 1 | 2 | 3;
  saveSlots?: SaveSlotSummary[];
  onSlotChange?: (slot: 1 | 2 | 3) => void;
  onHome?: () => void;
  initialDrawerTab?: "save" | "load";
  hidePhaseLabel?: boolean;
  notifications?: TeamInboxItem[];
  players?: Player[];
  onMarkNotificationsRead?: (ids: string[]) => Promise<void>;
  onHandlePendingNotification?: (notification: TeamInboxItem) => void;
}

const NAV_ITEMS = [
  { id: "season-home", icon: "calendar", label: "赛季" },
  { id: "season-manage", icon: "users", label: "管理" },
  { id: "season-market", icon: "arrows", label: "市场" },
  { id: "season-league", icon: "trophy", label: "联盟" },
  { id: "season-career", icon: "flag", label: "生涯" },
] as const;

type IconName = "home" | "save" | "settings" | "bell" | "calendar" | "users" | "arrows" | "trophy" | "flag" | "chat";

export function UiIcon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    home: <><path d="M3 10.8 12 3l9 7.8"/><path d="M5.5 9.5V21h13V9.5"/><path d="M9.5 21v-6h5v6"/></>,
    save: <><path d="M5 3h12l4 4v14H3V3h2Z"/><path d="M7 3v6h9V3"/><path d="M7 21v-7h10v7"/></>,
    settings: <><path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="2" fill="currentColor" stroke="none"/><circle cx="10" cy="18" r="2" fill="currentColor" stroke="none"/></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z"/><path d="M10 21h4"/></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18"/></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,
    arrows: <><path d="M7 7h11l-3-3M18 7l-3 3M17 17H6l3 3M6 17l3-3"/></>,
    trophy: <><path d="M8 4h8v5a4 4 0 0 1-8 0V4Z"/><path d="M8 6H5v1a4 4 0 0 0 4 4M16 6h3v1a4 4 0 0 1-4 4M12 13v4M8 21h8M9 17h6"/></>,
    flag: <><path d="M5 21V4M5 5c4-3 6 3 11 0v9c-5 3-7-3-11 0"/></>,
    chat: <><path d="M20 11.5a8 8 0 0 1-8 8 8.8 8.8 0 0 1-3.5-.7L4 20l1.2-4.5A8 8 0 1 1 20 11.5Z"/><path d="M8 11.5h8"/></>,
  };
  return <svg className="ui-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

export function GameChrome({ phase, busy = false, dataLabel = "本地球员数据已载入", onSave, onLoad, onLoadLatest, activeSlot = 1, saveSlots = [], onSlotChange, onHome, initialDrawerTab, hidePhaseLabel = false, notifications = [], players = [], onMarkNotificationsRead, onHandlePendingNotification }: GameChromeProps) {
  const [drawerOpen, setDrawerOpen] = useState(Boolean(initialDrawerTab));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<"save" | "load">(initialDrawerTab ?? "save");
  useEffect(() => {
    if (!settingsOpen) return;
    const onEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setSettingsOpen(false); };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [settingsOpen]);
  const openDrawer = (tab: "save" | "load") => {
    setInboxOpen(false);
    setSettingsOpen(false);
    setDrawerTab(tab);
    setDrawerOpen(true);
  };
  const latestSave = [...saveSlots].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.revision - left.revision || right.slotId - left.slotId)[0];
  const summaryFor = (slot: 1 | 2 | 3) => saveSlots.find((summary) => summary.slotId === slot);
  const summaryText = (summary: SaveSlotSummary): string => `${summary.teamName} · ${summary.seasonId} · ${summary.currentDate} · ${summary.wins}胜${summary.losses}负`;
  const chromePhase = ["TEAM_CREATION", "EXPANSION_RIGHTS", "EXPANSION_TRADE", "EXPANSION_DRAFT"].includes(phase) ? "建队模式" : ["REGULAR_SEASON", "REGULAR_PRE_DEADLINE", "POSTSEASON"].includes(phase) ? "常规赛" : phaseLabel(phase);
  const attentionCount = notifications.filter((item) => item.pending || !item.read).length;
  const unreadIds = notifications.filter((item) => !item.pending && !item.read).map((item) => item.id);
  return (
    <>
      <header className="game-chrome">
        <div className="game-chrome-title">
          <button className="chrome-home" type="button" disabled={busy} onClick={onHome} aria-label="返回游戏首页"><UiIcon name="home" /></button>
          {!hidePhaseLabel && <span>{chromePhase}</span>}
        </div>
        <div className="chrome-actions" title={dataLabel}>
          {onMarkNotificationsRead && <button className="sync-chip team-inbox-trigger" type="button" aria-label={`球队通知，${attentionCount} 条未读或待处理`} aria-expanded={inboxOpen} aria-controls="team-inbox-panel" onClick={() => { setDrawerOpen(false); setInboxOpen((open) => !open); }}><UiIcon name="bell" /><span>通知</span>{attentionCount > 0 && <b>{attentionCount > 99 ? "99+" : attentionCount}</b>}</button>}
          <button className="sync-chip" type="button" disabled={busy} aria-expanded={settingsOpen} onClick={() => { setInboxOpen(false); setSettingsOpen((open) => !open); }}><UiIcon name="settings" />设置</button>
        </div>
      </header>
      {settingsOpen && createPortal(<div className="settings-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false); }}>
        <section className="settings-dialog" role="dialog" aria-modal="true" aria-label="游戏设置">
          <header><div><small>游戏菜单</small><h2>设置</h2></div><button type="button" autoFocus aria-label="关闭设置" onClick={() => setSettingsOpen(false)}>×</button></header>
          <div className="settings-options">
            <button type="button" onClick={() => openDrawer("save")}><UiIcon name="save" /><span><b>存/读档</b><small>保存进度或读取已有存档</small></span><em>›</em></button>
            <button type="button" onClick={() => { setSettingsOpen(false); setFeedbackOpen(true); }}><UiIcon name="chat" /><span><b>玩家反馈</b><small>反馈问题或提出建议</small></span><em>›</em></button>
          </div>
        </section>
      </div>, document.body)}
      {feedbackOpen && createPortal(<UserFeedbackDialog onClose={() => setFeedbackOpen(false)} />, document.body)}
      {inboxOpen && createPortal(<TeamInboxDrawer notifications={notifications} players={players} attentionCount={attentionCount} unreadIds={unreadIds} busy={busy} onClose={() => setInboxOpen(false)} onMarkRead={onMarkNotificationsRead} onHandlePending={(item) => { setInboxOpen(false); onHandlePendingNotification?.(item); }} />, document.body)}
      {drawerOpen && <div className="save-drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDrawerOpen(false); }}>
        <section className="save-drawer" role="dialog" aria-modal="true" aria-label="存档管理" aria-busy={busy}>
          <header>
            <div className="save-drawer-tabs">
              <button className={drawerTab === "save" ? "active" : ""} onClick={() => setDrawerTab("save")}>保存游戏</button>
              <button className={drawerTab === "load" ? "active" : ""} onClick={() => setDrawerTab("load")}>读取存档</button>
            </div>
            <button className="save-drawer-close" onClick={() => setDrawerOpen(false)} aria-label="关闭存档管理">×</button>
          </header>
          <div className="save-drawer-body">
            <article className="save-slot-card featured auto-save-card">
              <span className="save-slot-badge">最近存档</span>
              <b>{latestSave ? `槽位 0${latestSave.slotId} · ${latestSave.teamName}` : "还没有可读取的存档"}</b>
              <small>{latestSave ? `${summaryText(latestSave)} · ${phaseLabel(latestSave.phase)}` : "进行一次操作后会自动保存，或手动保存到槽位。"}</small>
              {drawerTab === "load" && latestSave && <button className="save-drawer-primary" disabled={busy} onClick={() => void onLoadLatest?.().then((loaded) => { if (loaded) setDrawerOpen(false); })}>继续最近进度</button>}
            </article>
            {([1, 2, 3] as const).map((slot) => {
              const summary = summaryFor(slot);
              return <article className={`save-slot-card ${slot === activeSlot ? "featured" : ""}`} key={slot}>
              <div className="save-slot-card-heading"><b>▮ 槽位 0{slot}</b>{slot === activeSlot && <span>当前槽位</span>}</div>
              <div className="save-slot-summary"><b>{summary?.teamName ?? "空存档"}</b><small>{summary ? `${summary.seasonId} · ${summary.currentDate} · ${summary.wins}胜${summary.losses}负 · ${phaseLabel(summary.phase)}` : "尚未保存，可将当前进度写入此位置"}</small></div>
              {drawerTab === "save"
                ? <button className="save-drawer-primary" disabled={busy} onClick={() => { onSlotChange?.(slot); void onSave?.(slot).then(() => setDrawerOpen(false)); }}>{slot === activeSlot ? "覆盖保存" : "存入此位置"}</button>
                : <button className="save-drawer-dark" disabled={busy} onClick={() => { onSlotChange?.(slot); void onLoad?.(slot).then((loaded) => { if (loaded) setDrawerOpen(false); }); }}>读取此存档</button>}
            </article>;
            })}
          </div>
        </section>
      </div>}
    </>
  );
}

function TeamInboxDrawer({ notifications, players, attentionCount, unreadIds, busy, onClose, onMarkRead, onHandlePending }: {
  notifications: TeamInboxItem[];
  players: Player[];
  attentionCount: number;
  unreadIds: string[];
  busy: boolean;
  onClose: () => void;
  onMarkRead?: (ids: string[]) => Promise<void>;
  onHandlePending: (item: TeamInboxItem) => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  return <div className="team-inbox-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="team-inbox-panel" id="team-inbox-panel" role="dialog" aria-label="球队通知">
      <header><div><h2>通知</h2><span>{attentionCount ? `${attentionCount} 条未读或待处理` : "暂无待处理消息"}</span></div><button type="button" autoFocus aria-label="关闭球队通知" onClick={onClose}>×</button></header>
      <div className="team-inbox-list">{notifications.length ? notifications.map((item) => <article className={`team-inbox-item${item.pending ? " pending" : item.read ? " read" : " unread"}`} key={item.id}>
        <div><small>{item.category === "FREE_AGENCY" ? "自由市场" : item.category === "SEASON" ? "赛季" : "球队"} · {item.date ? <time dateTime={item.date}>{item.date}</time> : "日期未记录"}</small><em>{item.pending ? "待处理" : item.read ? "已读" : "未读"}</em></div>
        <h3>{localizePlayerNamesInText(item.title, players)}</h3><p>{item.playerName && item.playerId ? `${playerNameZh(item.playerName, item.playerId)} · ` : ""}{localizePlayerNamesInText(humanizeUiText(item.message), players)}</p>
        {item.pending ? <button type="button" disabled={busy} onClick={() => onHandlePending(item)}>去处理</button> : !item.read && <button type="button" disabled={busy} onClick={() => void onMarkRead?.([item.id])}>标为已读</button>}
      </article>) : <p className="team-inbox-empty">暂无球队通知。自由市场报价结果和赛季待办会显示在这里。</p>}</div>
      {unreadIds.length > 0 && <footer><button type="button" disabled={busy} onClick={() => void onMarkRead?.(unreadIds)}>全部标为已读</button></footer>}
    </section>
  </div>;
}

export function SeasonNavigation({ activeTab, onChange, disabledTabs = [] }: { activeTab: SeasonTab; onChange: (tab: SeasonTab) => void; disabledTabs?: SeasonTab[] }) {
  return (
    <nav className="season-navigation" aria-label="赛季页面导航">
      {NAV_ITEMS.map((item) => {
        const tab = item.id.replace("season-", "") as SeasonTab;
        const disabled = disabledTabs.includes(tab);
        return <button id={`nav-${item.id}`} key={item.id} disabled={disabled} className={activeTab === tab ? "active" : ""} aria-current={activeTab === tab ? "page" : undefined} onClick={() => onChange(tab)}>
          <span aria-hidden="true"><UiIcon name={item.icon} /></span>
          <small>{item.label}</small>
        </button>;
      })}
    </nav>
  );
}
