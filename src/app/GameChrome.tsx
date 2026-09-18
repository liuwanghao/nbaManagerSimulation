import type { ReactNode } from "react";
import { useState } from "react";
import { phaseLabel } from "./uiText";

export type SeasonTab = "home" | "roster" | "manage" | "league" | "career";

interface GameChromeProps {
  phase: string;
  dataLabel?: string;
  onSave?: (slot?: 1 | 2 | 3) => Promise<void>;
  onLoad?: (slot?: 1 | 2 | 3) => Promise<void>;
  activeSlot?: 1 | 2 | 3;
  onSlotChange?: (slot: 1 | 2 | 3) => void;
  onHome?: () => void;
  initialDrawerTab?: "save" | "load";
}

const NAV_ITEMS = [
  { id: "season-home", icon: "calendar", label: "赛程" },
  { id: "season-roster", icon: "users", label: "阵容" },
  { id: "season-manage", icon: "briefcase", label: "管理" },
  { id: "season-league", icon: "basketball", label: "联盟" },
  { id: "season-career", icon: "award", label: "生涯" },
] as const;

type IconName = "home" | "save" | "rotate" | "calendar" | "users" | "briefcase" | "basketball" | "award";

export function UiIcon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    home: <><path d="M3 10.8 12 3l9 7.8"/><path d="M5.5 9.5V21h13V9.5"/><path d="M9.5 21v-6h5v6"/></>,
    save: <><path d="M5 3h12l4 4v14H3V3h2Z"/><path d="M7 3v6h9V3"/><path d="M7 21v-7h10v7"/></>,
    rotate: <><path d="M20 7h-6V1"/><path d="M20 7a9 9 0 1 0 1 8"/></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18"/></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,
    briefcase: <><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V4h8v3M3 12h18M10 12v2h4v-2"/></>,
    basketball: <><circle cx="12" cy="12" r="9"/><path d="M3.5 9.5c5 1 8.5 4.5 11 10M20.5 14.5c-5-1-8.5-4.5-11-10M12 3c2.5 5.4 2.5 12.6 0 18M3 12h18"/></>,
    award: <><circle cx="12" cy="8" r="5"/><path d="m8.5 12-1 9 4.5-2 4.5 2-1-9"/></>,
  };
  return <svg className="ui-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

export function GameChrome({ phase, dataLabel = "本地球员数据已载入", onSave, onLoad, activeSlot = 1, onSlotChange, onHome, initialDrawerTab }: GameChromeProps) {
  const [drawerOpen, setDrawerOpen] = useState(Boolean(initialDrawerTab));
  const [drawerTab, setDrawerTab] = useState<"save" | "load">(initialDrawerTab ?? "save");
  const openDrawer = (tab: "save" | "load") => {
    setDrawerTab(tab);
    setDrawerOpen(true);
  };
  const chromePhase = ["TEAM_CREATION", "EXPANSION_RIGHTS", "EXPANSION_TRADE", "EXPANSION_DRAFT"].includes(phase) ? "建队模式" : ["REGULAR_SEASON", "REGULAR_PRE_DEADLINE", "POSTSEASON"].includes(phase) ? "常规赛" : phaseLabel(phase);
  return (
    <>
      <header className="game-chrome">
        <div className="game-chrome-title">
          <button className="chrome-home" type="button" onClick={onHome} aria-label="返回游戏首页"><UiIcon name="home" /></button>
          <span>{chromePhase}</span>
        </div>
        <div className="chrome-actions" title={dataLabel}>
          <button className="sync-chip" type="button" onClick={() => openDrawer("save")}><UiIcon name="save" />存/读档</button>
          <span className="sync-chip"><UiIcon name="rotate" />模式</span>
        </div>
      </header>
      {drawerOpen && <div className="save-drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDrawerOpen(false); }}>
        <section className="save-drawer" role="dialog" aria-modal="true" aria-label="存档管理">
          <header>
            <div className="save-drawer-tabs">
              <button className={drawerTab === "save" ? "active" : ""} onClick={() => setDrawerTab("save")}>保存游戏</button>
              <button className={drawerTab === "load" ? "active" : ""} onClick={() => setDrawerTab("load")}>读取存档</button>
            </div>
            <button className="save-drawer-close" onClick={() => setDrawerOpen(false)} aria-label="关闭存档管理">×</button>
          </header>
          <div className="save-drawer-body">
            <article className="save-slot-card featured auto-save-card">
              <span className="save-slot-badge">自动存档</span>
              <b>当前进度</b>
              <small>{phaseLabel(phase)} · {dataLabel}</small>
              {drawerTab === "load" && <button className="save-drawer-primary" onClick={() => void onLoad?.(activeSlot).then(() => setDrawerOpen(false))}>加载当前自动存档</button>}
            </article>
            {([1, 2, 3] as const).map((slot) => <article className={`save-slot-card ${slot === activeSlot ? "featured" : ""}`} key={slot}>
              <div className="save-slot-card-heading"><b>▮ 槽位 0{slot}</b>{slot === activeSlot && <span>当前槽位</span>}</div>
              <div className="save-slot-summary"><b>{slot === activeSlot ? phaseLabel(phase) : "可保存进度"}</b><small>{slot === activeSlot ? dataLabel : "点击按钮写入或读取该槽位"}</small></div>
              {drawerTab === "save"
                ? <button className="save-drawer-primary" onClick={() => { onSlotChange?.(slot); void onSave?.(slot).then(() => setDrawerOpen(false)); }}>{slot === activeSlot ? "覆盖保存" : "存入此位置"}</button>
                : <button className="save-drawer-dark" onClick={() => { onSlotChange?.(slot); void onLoad?.(slot).then(() => setDrawerOpen(false)); }}>读取此存档</button>}
            </article>)}
          </div>
        </section>
      </div>}
    </>
  );
}

export function SeasonNavigation({ activeTab, onChange }: { activeTab: SeasonTab; onChange: (tab: SeasonTab) => void }) {
  return (
    <nav className="season-navigation" aria-label="赛季页面导航">
      {NAV_ITEMS.map((item) => {
        const tab = item.id.replace("season-", "") as SeasonTab;
        return <button key={item.id} className={activeTab === tab ? "active" : ""} aria-current={activeTab === tab ? "page" : undefined} onClick={() => onChange(tab)}>
          <span aria-hidden="true"><UiIcon name={item.icon} /></span>
          <small>{item.label}</small>
        </button>;
      })}
    </nav>
  );
}
