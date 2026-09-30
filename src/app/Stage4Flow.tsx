import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getSeasonFinanceConfig, LEAGUE_FINANCE_CONFIG } from "../config/leagueFinance";
import { getCapSheet } from "../game/cap/CapSheetService";
import { getAvailableDraftProspects, getDraftLotteryPreview, getNextAiDraftProspect, type DraftCommand } from "../game/draft/DraftService";
import { getCurrentFreeAgentAsk, getFreeAgents, getFreeAgentOfferPreview, getPendingUserQualifyingOfferPlayers, getProjectedMarketSalary, type FreeAgencyCommand } from "../game/freeAgency/FreeAgencyService";
import { getQualifyingOfferAmount } from "../game/contracts/ContractRules";
import { evaluateTradeOffer, type TradeCommand } from "../game/trade/TradeService";
import { isUntouchable, untouchablePlayerIds } from "../game/trade/TradeAvailabilityService";
import type { RosterCommand } from "../game/roster/RosterService";
import { getRosterTrainingAssignments } from "../game/roster/TrainingPlanService";
import type { ContractYearOption, GameState, Player, PromisedRole, TrainingFocus } from "../game/state/types";
import type { ContractLifecycleCommand } from "../game/contracts/ContractLifecycleService";
import { calculatePlayerOverall } from "../game/player/PlayerRatingService";
import { BALANCE_CONFIG } from "../config/balanceConfig";
import { GameChrome, type SaveActionOptions, type SaveActionResult } from "./GameChrome";
import { getTeamInboxItems } from "../game/notifications/TeamNotificationService";
import { contractStatusLabel, freeAgencyTransactionLabel, humanizeUiText, measurementLabel, moneyLabel, phaseLabel, positionLabel, positionPairLabel, slotLabel } from "./uiText";
import { localizePlayerNamesInText, playerNameZh, playerSurnameZh } from "./playerNameZh";
import { playerRatingStyle } from "./playerRatingColor";
import { compareFreeAgentCandidates, type FreeAgentSortOption } from "./freeAgencySort";
import { ReferencePlayerCard } from "./ReferencePlayerCard";
import { PlayerPortrait } from "./PlayerPortrait";
import { TradeOfferDetail } from "./TradeOfferDetail";
import { TeamRosterPanel } from "./TeamRosterPanel";
import type { SaveSlotSummary } from "../storage/SaveService";
import { EXPANSION_POSITION_FILTERS, getCurrentRosterPositionCounts, getCurrentRosterPositionSummary, getCurrentTeamId, getCurrentTeamRoster, getExpansionDraftRecap, matchesExpansionPosition, type ExpansionPositionFilter } from "./expansionDraftView";
import { PlayerListFilters, type PlayerFilterSortOption } from "./PlayerListFilters";
import { TRADE_ASSET_POSITIONS, targetedTradeInquiryCommandId, tradeInquiryCommandId, tradeOfferPortraitPlayer, tradePickLabel, tradeSelectionCommandId, type TradeAssetPosition } from "./tradeView";
import { TradeAssetPicker } from "./TradeAssetPicker";
import { TradeTargetFilter } from "./TradeTargetFilter";
import { getRewardVideoBridge, runRewardedAction, watchRewardVideo } from "./rewardVideo";
import { FreeAgentOfferDialog } from "./FreeAgentOfferDialog";
import { DraftLotteryScreen } from "./DraftLotteryScreen";
import { SeasonOverallChanges } from "./SeasonOverallChanges";

interface Stage4FlowProps {
  state: GameState;
  busy: boolean;
  status: string;
  onCommand: (command: DraftCommand) => Promise<void>;
  onContractCommand: (command: ContractLifecycleCommand) => Promise<void>;
  onFreeAgencyCommand: (command: FreeAgencyCommand) => Promise<void>;
  onTradeCommand: (command: TradeCommand) => Promise<void>;
  onRosterCommand: (command: RosterCommand) => Promise<void>;
  onSave: (slot?: 1 | 2 | 3, options?: SaveActionOptions) => Promise<SaveActionResult | void>;
  onLoad: (slot?: 1 | 2 | 3) => Promise<boolean>;
  onLoadLatest: () => Promise<boolean>;
  saveSlots: SaveSlotSummary[];
  activeSlot: 1 | 2 | 3;
  onSlotChange: (slot: 1 | 2 | 3) => void;
  onHome?: () => void;
  onMarkNotificationsRead: (ids: string[]) => Promise<void>;
  initialDrawerTab?: "save" | "load";
}

const money = moneyLabel;

export function trainingFocusCommandId(state: GameState, playerId: string): string {
  const intentId = crypto.getRandomValues(new Uint32Array(4)).join("-");
  return `training-${state.league.seasonId}-${playerId}-${intentId}`;
}

export function freeAgencyOfferCommandId(state: GameState, playerId: string): string {
  const market = state.freeAgency;
  if (!market) throw new Error("自由市场尚未开放");
  const attempt = Object.values(market.offers).filter((offer) => offer.teamId === state.userTeamId && offer.playerId === playerId).length;
  return `offer-${state.league.seasonId}-${market.currentDay}-${playerId}-${attempt}`;
}
const TRAINING_FOCUS_OPTIONS: Array<{ value: TrainingFocus; label: string; description: string }> = [
  { value: "BALANCED", label: "综合", description: "所有属性成长权重小幅提升，最稳妥" },
  { value: "SHOOTING", label: "投射", description: "大幅强化投射，其他属性成长略降" },
  { value: "PLAYMAKING", label: "组织", description: "大幅强化组织并兼顾球商，其他属性略降" },
  { value: "DEFENSE", label: "防守", description: "强化内外线防守，非防守属性成长降低" },
  { value: "INSIDE", label: "内线", description: "强化终结、内防和篮板，外围属性成长降低" },
  { value: "ATHLETICISM", label: "运动能力", description: "大幅强化运动能力并兼顾终结，其他属性降低" },
];

const FREE_AGENT_SORT_OPTIONS: Array<PlayerFilterSortOption<FreeAgentSortOption>> = [
  { value: "ABILITY_DESC", label: "OVR", direction: "高→低" },
  { value: "SALARY_DESC", label: "当前要价", direction: "高→低" },
  { value: "SALARY_ASC", label: "当前要价", direction: "低→高" },
  { value: "AGE_ASC", label: "年龄", direction: "小→大" },
];

interface FreeAgentOfferEditorState {
  playerId: string;
  years: number;
  year1Salary: number;
  annualRaiseRate: number;
  finalYearOption: ContractYearOption;
  guaranteedPercent: number;
  rolePromised: PromisedRole;
}

function FlowHeading({ step, title, description, badge, icon }: { step: string; title: string; description: string; badge?: string; icon: string }) {
  return <header className="prototype-flow-heading">
    <span className="prototype-flow-icon" aria-hidden="true">{icon}</span>
    <div><span className="step-label">{step}</span><h2>{title}</h2><p>{description}</p></div>
    {badge && <b className="prototype-flow-badge">{badge}</b>}
  </header>;
}

function SectionBar({ title, meta }: { title: string; meta: string }) {
  return <div className="prototype-section-bar"><b>{title}</b><span>{meta}</span></div>;
}

export function Stage4Flow({ state, busy, status, onCommand, onContractCommand, onFreeAgencyCommand, onTradeCommand, onRosterCommand, onSave, onLoad, onLoadLatest, saveSlots, activeSlot, onSlotChange, onHome, onMarkNotificationsRead, initialDrawerTab }: Stage4FlowProps) {
  const phase = state.league.currentPhase;
  const spotlightPhase = ["ROOKIE_DRAFT_PENDING", "OFFSEASON_PRE_DRAFT", "DRAFT"].includes(phase);
  const rookieDraftScreen = ["ROOKIE_DRAFT_PENDING", "OFFSEASON_PRE_DRAFT", "DRAFT"].includes(phase);
  const offseasonTerminalScreen = ["OFFSEASON_POST_DRAFT", "PRESEASON"].includes(phase);
  return (
    <main className={`app-shell expansion-shell${spotlightPhase ? " scene-stage" : ""}${rookieDraftScreen ? " rookie-draft-shell" : ""}${offseasonTerminalScreen ? " stage4-terminal-shell" : ""}${phase === "OPTION_PHASE" ? " option-phase-shell" : ""}`}>
      <GameChrome phase={phase} busy={busy} onSave={onSave} onLoad={onLoad} onLoadLatest={onLoadLatest} activeSlot={activeSlot} saveSlots={saveSlots} onSlotChange={onSlotChange} onHome={onHome} initialDrawerTab={initialDrawerTab} hidePhaseLabel={phase === "OPTION_PHASE"} notifications={getTeamInboxItems(state)} players={Object.values(state.players)} onMarkNotificationsRead={onMarkNotificationsRead} onHandlePendingNotification={(item) => { if (item.id.startsWith("action-rfa-")) document.querySelector(".fa-settle-footer")?.scrollIntoView({ behavior: "smooth", block: "center" }); }} />
      <header className="stage-header">
        <div><span className="section-kicker">扩军时代 · 第四阶段</span><h1>经理系统</h1></div>
        <span className="phase-pill">{phaseLabel(phase)}</span>
      </header>
      <section className="status-strip" aria-live="polite"><span className={busy ? "pulse-dot active" : "pulse-dot"} />{localizePlayerNamesInText(status, Object.values(state.players))}</section>
      {phase === "OPTION_PHASE" && <OptionPhase state={state} busy={busy} onContractCommand={onContractCommand} />}
      {["ROOKIE_DRAFT_PENDING", "OFFSEASON_PRE_DRAFT"].includes(phase) && <DraftIntroduction state={state} busy={busy} onCommand={onCommand} onTradeCommand={onTradeCommand} />}
      {phase === "DRAFT" && (state.league.seasonYear > 2026 && state.rookieDraft?.currentPickIndex === 0 && !state.rookieDraft.lotteryPresented
        ? <DraftLotteryScreen state={state} busy={busy} onCommand={onCommand} />
        : <DraftBoard state={state} busy={busy} onCommand={onCommand} />)}
      {phase === "OFFSEASON_POST_DRAFT" && <PostDraftHub state={state} busy={busy} onFreeAgencyCommand={onFreeAgencyCommand} onRosterCommand={onRosterCommand} />}
      {phase === "PRESEASON" && <RosterLock state={state} busy={busy} onRosterCommand={onRosterCommand} />}
      <footer>
        <label className="slot-picker">存档<select disabled={busy} value={activeSlot} onChange={(event) => onSlotChange(Number(event.target.value) as 1 | 2 | 3)}><option value={1}>{slotLabel(1)}</option><option value={2}>{slotLabel(2)}</option><option value={3}>{slotLabel(3)}</option></select></label>
        <button className="footer-action" disabled={busy} onClick={() => void onSave().catch(() => undefined)}>保存{slotLabel(activeSlot)}</button>
        <button className="footer-action" disabled={busy} onClick={() => void onLoad()}>读取{slotLabel(activeSlot)}</button>
        <span>选秀选择、合同生成与电脑球队选秀均通过引擎指令原子提交</span>
      </footer>
    </main>
  );
}

function ExpansionDraftRecap({ state }: { state: GameState }) {
  const teams = getExpansionDraftRecap(state);
  const [selectedTeamId, setSelectedTeamId] = useState(state.userTeamId);
  const selected = teams.find(({ teamId }) => teamId === selectedTeamId) ?? teams[0];
  if (!selected) return null;
  const team = state.teams[selected.teamId];
  return <details className="expansion-draft-recap" open>
    <summary><span><small>扩军选秀完成</small><h2>扩军选秀名单</h2><em>两支球队 · 共 {teams.reduce((total, entry) => total + entry.picks.length, 0)} 次选择</em></span><span className="expansion-recap-toggle" aria-hidden="true"><b>⌄</b></span></summary>
    <div className="expansion-recap-content">
      <div className="expansion-recap-tabs" role="tablist" aria-label="选择扩军球队">
        {teams.map(({ teamId, picks }) => {
          const tabTeam = state.teams[teamId];
          return <button key={teamId} type="button" id={`expansion-recap-tab-${teamId}`} role="tab" aria-selected={selected.teamId === teamId} aria-controls="expansion-recap-panel" tabIndex={selected.teamId === teamId ? 0 : -1} onClick={() => setSelectedTeamId(teamId)} onKeyDown={(event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault();
            const next = teams.find((entry) => entry.teamId !== teamId);
            if (next) {
              setSelectedTeamId(next.teamId);
              document.getElementById(`expansion-recap-tab-${next.teamId}`)?.focus();
            }
          }}>
            <span className="expansion-recap-logo">{tabTeam.logoUrl ? <img src={tabTeam.logoUrl} alt="" /> : tabTeam.abbreviation.slice(0, 2)}</span>
            <span>{tabTeam.fullName}<small>{picks.length} 名球员</small></span>
          </button>;
        })}
      </div>
      <div className="expansion-recap-team" id="expansion-recap-panel" role="tabpanel" aria-labelledby={`expansion-recap-tab-${selected.teamId}`} aria-label={`${team.fullName}选人名单`} tabIndex={0}>
        <ol key={selected.teamId}>{selected.picks.map((pick) => {
          const player = state.players[pick.playerId];
          return <li key={pick.pickNumber}>
            <span className="expansion-recap-pick">#{pick.pickNumber}</span>
            <span className="expansion-recap-player"><b>{playerNameZh(player.name, player.id)}</b><small>来自{state.teams[pick.sourceTeamId].fullName} · {positionPairLabel(player.position, player.secondaryPosition)}</small></span>
            <span className="expansion-recap-overall player-rating-tone" style={playerRatingStyle(calculatePlayerOverall(player))}><small>OVR</small>{calculatePlayerOverall(player).toFixed(0)}</span>
          </li>;
        })}</ol>
      </div>
    </div>
  </details>;
}

function DraftIntroduction({ state, busy, onCommand, onTradeCommand }: Pick<Stage4FlowProps, "state" | "busy" | "onCommand" | "onTradeCommand">) {
  const firstDraft = state.league.seasonYear === 2026;
  const [tradeOpen, setTradeOpen] = useState(false);
  const tradeTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!tradeOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setTradeOpen(false); };
    window.addEventListener("keydown", closeOnEscape);
    return () => { window.removeEventListener("keydown", closeOnEscape); tradeTrigger.current?.focus(); };
  }, [tradeOpen]);
  const packageId = state.expansion?.rightsDraw.packageByTeam[state.userTeamId as "SEA" | "LVG"];
  const packageConfig = packageId ? BALANCE_CONFIG.expansion.package[packageId] : undefined;
  const firstPick = packageConfig?.rookieDraftPick;
  const secondPick = firstPick ? firstPick + Object.keys(state.teams).length : undefined;
  const pickCount = Object.keys(state.teams).length * BALANCE_CONFIG.draft.rounds;
  const ownedPicks = Object.values(state.draftPicks).filter((pick) => pick.year === state.league.seasonYear && pick.ownerTeamId === state.userTeamId)
    .sort((left, right) => left.round - right.round || left.originalTeamId.localeCompare(right.originalTeamId));
  const lottery = firstDraft ? [] : getDraftLotteryPreview(state);
  const lotteryByTeam = new Map(lottery.map((entry) => [entry.teamId, entry]));
  return (
    <section className="flow-card draft-intro-card rookie-draft-prep-terminal">
      {state.league.currentPhase === "ROOKIE_DRAFT_PENDING" && state.expansion?.finalized && <ExpansionDraftRecap state={state} />}
      <header className="draft-prep-hero">
        <span className="draft-prep-tag">选秀前</span>
        <span className="draft-prep-kicker">{state.league.seasonYear} 年新秀选秀 · 选秀前准备</span>
        <h2>{firstDraft ? "首届新秀选秀" : `${state.league.seasonYear} 年新秀选秀`}</h2>
        <p>{firstDraft ? "本届采用 2026 年真实选秀名单。进入大厅后，你可以在自己的签位选择新秀。" : "赛季战绩已锁定。先查看本队选秀权和乐透权重，再抽签确定顺位、公布本届新秀。"}</p>
      </header>
      <SectionBar title="选秀概览" meta={`${BALANCE_CONFIG.draft.rounds} 轮 · ${Object.keys(state.teams).length} 支球队`} />
      <div className="draft-prep-metrics">
        <span><b>{BALANCE_CONFIG.draft.classSize}</b><small>选秀球员</small></span><span><b>{pickCount}</b><small>总签位</small></span>
        {firstDraft ? <><span><b>#{firstPick ?? "—"}</b><small>你的首轮</small></span><span><b>#{secondPick ?? "—"}</b><small>你的次轮</small></span></> : <><span><b>3-2-1</b><small>抽签球数</small></span><span><b>{lottery.length}</b><small>参抽球队</small></span></>}
      </div>
      {!firstDraft && <>
        <section className="draft-prep-assets" aria-label="本队选秀权">
          <header><h3>本队持有的选秀权</h3><span>{ownedPicks.length} 枚</span></header>
          <p>签位顺序将在抽签后确定；已交易的选秀权归当前持有球队使用。</p>
          <div className="draft-prep-pick-list">{ownedPicks.length ? ownedPicks.map((pick) => {
            const lotteryEntry = pick.round === 1 ? lotteryByTeam.get(pick.originalTeamId) : undefined;
            return <div key={pick.id} className="draft-prep-pick"><strong>{pick.round === 1 ? "首轮" : "次轮"}</strong><span>{state.teams[pick.originalTeamId]?.fullName ?? pick.originalTeamId} 原签</span>{lotteryEntry && <small>状元概率 {lotteryEntry.firstPickWeight.toFixed(2)}%</small>}</div>;
          }) : <p>本届暂无选秀权，可在选秀前尝试交易获得。</p>}</div>
          <button type="button" ref={tradeTrigger} disabled={busy} onClick={() => setTradeOpen(true)}>交易球员或选秀权 <span aria-hidden="true">↗</span></button>
        </section>
        <details className="draft-prep-lottery"><summary>查看乐透抽签概率 <span>{lottery.length} 队 · 全部顺位抽签</span></summary><p>按 NBA 2027 年 3-2-1 规则适配 32 队联盟。战绩最差三队只有 2 球，其余未进附加赛球队有 3 球，所以战绩稍好的球队反而可能有更高的状元概率；最差三队的原签仍不会低于第 12 顺位。附加赛第 9/10 名各有 2 球，7/8 名首场负者各有 1 球。连续高顺位限制也已计入。</p><ol>{lottery.map((entry, index) => <li key={entry.teamId}><div className="draft-prep-lottery-identity"><span><b>#{index + 1} {state.teams[entry.teamId].fullName}</b>{ownedPicks.some((pick) => pick.round === 1 && pick.originalTeamId === entry.teamId) && <em>本队持签</em>}</span><small>{entry.wins}胜 {entry.losses}负 · {entry.lotteryBalls} 球{entry.draftRelegated ? " · 最差三队降档" : ""}</small></div><strong>{entry.firstPickWeight.toFixed(2)}%</strong></li>)}</ol></details>
      </>}
      <div className="draft-terminal-info"><span>i</span><p><b>{firstDraft ? "本届选秀规则" : "进入大厅后"}</b>{firstDraft ? "其他球队按真实选秀目标选择；目标被抢先选走时，会从剩余球员中补位。" : "可查看新秀的年龄、位置、能力、潜力评级和球探可信度。真实潜力不会公开。"}</p></div>
      <button className="draft-terminal-cta" disabled={busy} onClick={() => onCommand({ commandId: `prepare-rookie-draft-${state.league.seasonId}`, type: "PREPARE_ROOKIE_DRAFT", payload: {} })}>{firstDraft ? "进入新秀选秀大厅" : "开始乐透抽签"}<span>▶</span></button>
      {tradeOpen && createPortal(<div className="draft-prep-trade-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setTradeOpen(false); }}><div className="draft-prep-trade-dialog market-hub" role="dialog" aria-modal="true" aria-label="选秀前交易中心"><button type="button" className="draft-prep-trade-close" aria-label="关闭交易中心" onClick={() => setTradeOpen(false)}>×</button><TradeDesk state={state} busy={busy} onTradeCommand={onTradeCommand} /></div></div>, document.body)}
    </section>
  );
}

function OptionPhase({ state, busy, onContractCommand }: Pick<Stage4FlowProps, "state" | "busy" | "onContractCommand">) {
  const lifecycle = state.contractLifecycle;
  const pending = lifecycle?.pendingUserTeamOptionPlayerIds.map((id) => state.players[id]) ?? [];
  const retired = state.playerLifecycle?.retiredPlayerIds.map((id) => state.players[id]).filter(Boolean) ?? [];
  return <section className="flow-card option-phase-screen">
    <header className="option-phase-hero"><div className="option-phase-hero-content"><small>{state.league.seasonId} · 新联盟年度</small><h1>合同选项</h1><p>球员选项与其他球队的选项已结算，请处理本队球队选项。</p></div></header>
    <SeasonOverallChanges state={state} />
    <section className="option-phase-decisions"><header><div><h2>本队球队选项</h2><p>执行选项保留球员；放弃后球员进入自由市场。</p></div><span>{pending.length ? `${pending.length} 人待处理` : "全部完成"}</span></header>
      {pending.length ? <div className="option-phase-list">{pending.map((player) => <article className="option-phase-player" key={player.id}>
        <PlayerPortrait player={player} portraitPath={player.portraitPath} className="option-phase-avatar" />
        <div className="option-phase-player-info"><span>球队选项 · {positionLabel(player.position)}</span><b>{playerNameZh(player.name, player.id)}</b><small>选项年薪 <strong>{money(player.contract.salary)}</strong> · 剩余 {player.contract.yearsRemaining} 年</small></div>
        <span className="option-phase-ovr player-rating-tone" style={playerRatingStyle(calculatePlayerOverall(player))}><small>OVR</small>{calculatePlayerOverall(player).toFixed(0)}</span>
        <div className="option-phase-actions"><button type="button" data-testid="option-pickup" disabled={busy} onClick={() => onContractCommand({ commandId: `team-option-pick-${state.league.seasonId}-${player.id}`, type: "RESOLVE_TEAM_OPTION", payload: { playerId: player.id, decision: "PICK_UP" } })}>执行选项</button><button type="button" className="decline" disabled={busy} onClick={() => onContractCommand({ commandId: `team-option-decline-${state.league.seasonId}-${player.id}`, type: "RESOLVE_TEAM_OPTION", payload: { playerId: player.id, decision: "DECLINE" } })}>放弃</button></div>
      </article>)}</div> : <div className="option-phase-empty"><span aria-hidden="true">✓</span><div><b>所有球队选项已处理</b><small>可以进入选秀前休赛期。</small></div></div>}
    </section>
    {retired.length > 0 && <section className="option-phase-retirements" aria-label="本年度退役球员"><header><div><h2>本年度退役球员</h2></div><span>{retired.length} 人</span></header><p className="option-phase-retirement-note">由游戏根据年龄、竞技状态等因素模拟，并非现实退役消息。</p><div className="option-phase-retired-list">{retired.map((player) => <div key={player.id}><b>{playerNameZh(player.name, player.id)}</b><small>{player.age} 岁 · {positionLabel(player.position)}</small></div>)}</div></section>}
    {lifecycle && lifecycle.transactionLog.length > 0 && <OptionPhaseContractLog entries={lifecycle.transactionLog} players={Object.values(state.players)} />}
    <div className="option-phase-footer">{pending.length > 0 && <span>还需处理 {pending.length} 项球队选项</span>}<button type="button" data-testid="option-finalize" disabled={busy || pending.length > 0} onClick={() => onContractCommand({ commandId: `finalize-options-${state.league.seasonId}`, type: "FINALIZE_OPTION_PHASE", payload: {} })}>进入选秀前休赛期 <i aria-hidden="true">→</i></button></div>
  </section>;
}

function OptionPhaseContractLog({ entries, players }: { entries: string[]; players: Player[] }) {
  const [category, setCategory] = useState<"OPTIONS" | "EXPIRED">(() => entries.some((entry) => !entry.includes("CONTRACT_EXPIRED")) ? "OPTIONS" : "EXPIRED");
  const [query, setQuery] = useState("");
  const rows = useMemo(() => entries.map((entry, index) => ({
    key: `${index}-${entry}`,
    category: entry.includes("CONTRACT_EXPIRED") ? "EXPIRED" as const : "OPTIONS" as const,
    text: localizePlayerNamesInText(humanizeUiText(entry), players),
  })).reverse(), [entries, players]);
  const optionCount = rows.filter((row) => row.category === "OPTIONS").length;
  const expiredCount = rows.length - optionCount;
  const filtered = rows.filter((row) => row.category === category && row.text.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <section className="option-phase-log" aria-label="合同动态">
    <header><h2>合同动态</h2><span>选项 {optionCount} · 到期 {expiredCount}</span></header>
    <div className="option-phase-log-body">
      <div className="option-phase-log-filters" role="group" aria-label="合同动态分类">
        <button type="button" aria-pressed={category === "OPTIONS"} onClick={() => setCategory("OPTIONS")}>选项决定 <b>{optionCount}</b></button>
        <button type="button" aria-pressed={category === "EXPIRED"} onClick={() => setCategory("EXPIRED")}>合同到期 <b>{expiredCount}</b></button>
      </div>
      <input className="option-phase-log-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索球员或动态" aria-label="搜索合同动态" />
      <div className="option-phase-log-list" key={`${category}-${query}`} tabIndex={0} aria-label="合同动态记录">{filtered.length ? filtered.map((row) => <p key={row.key}>{row.text}</p>) : <p className="option-phase-log-empty">没有匹配的记录</p>}</div>
    </div>
  </section>;
}

function DraftBoard({ state, busy, onCommand }: Pick<Stage4FlowProps, "state" | "busy" | "onCommand">) {
  const [simulationMode, setSimulationMode] = useState<"PAUSED" | "LIVE">("PAUSED");
  const [exitingPlayerId, setExitingPlayerId] = useState<string | null>(null);
  const [selectedProspectId, setSelectedProspectId] = useState<string | null>(null);
  const [positionFilter, setPositionFilter] = useState<"ALL" | "PG" | "SG" | "SF" | "PF" | "C">("ALL");
  const draft = state.rookieDraft!;
  const pick = draft.pickOrder[draft.currentPickIndex]!;
  const leagueTeamCount = Object.keys(state.teams).length;
  const currentRound = Math.min(BALANCE_CONFIG.draft.rounds, Math.floor((pick.pickNumber - 1) / leagueTeamCount) + 1);
  const nextAiProspect = getNextAiDraftProspect(state);
  const previewReplacement = Boolean(pick.scriptedPlayerId && state.players[pick.scriptedPlayerId]?.teamId !== "FREE_AGENT" && nextAiProspect);
  const prospects = getAvailableDraftProspects(state).map((player) =>
    previewReplacement && nextAiProspect && player.id === nextAiProspect.id ? nextAiProspect : player);
  const filteredProspects = positionFilter === "ALL" ? prospects : prospects.filter((player) => player.position === positionFilter || player.secondaryPosition === positionFilter);
  const myPicks = draft.pickOrder.filter((entry) => entry.ownerTeamId === state.userTeamId);
  const playerTurn = pick.ownerTeamId === state.userTeamId;
  const draftedCount = draft.currentPickIndex;
  const nextUserPick = myPicks.find((entry) => !entry.playerId && entry.pickNumber > pick.pickNumber);
  const revealedProspectIds = new Set(draft.revealedProspectIds ?? []);
  useEffect(() => {
    if (playerTurn) {
      setSimulationMode("PAUSED");
      setExitingPlayerId(null);
    }
  }, [pick.pickNumber, playerTurn]);
  useEffect(() => {
    if (simulationMode === "PAUSED" || playerTurn || busy || !nextAiProspect) return;
    let commitTimer: number | undefined;
    const exitTimer = window.setTimeout(() => {
      setExitingPlayerId(nextAiProspect.id);
      commitTimer = window.setTimeout(() => {
        void onCommand({
          commandId: `stage4-ai-draft-${state.league.seasonId}-${pick.pickNumber}`,
          type: "ADVANCE_ROOKIE_DRAFT_AI_PICK",
          payload: { expectedPickNumber: pick.pickNumber },
        }).finally(() => setExitingPlayerId(null));
      }, 400);
    }, 1_800);
    return () => {
      window.clearTimeout(exitTimer);
      if (commitTimer !== undefined) window.clearTimeout(commitTimer);
    };
  }, [busy, nextAiProspect?.id, onCommand, pick.pickNumber, playerTurn, simulationMode, state.league.seasonId]);
  const feedText = playerTurn
    ? `第 ${pick.pickNumber} 顺位轮到 ${state.teams[state.userTeamId].fullName} 选择。`
    : exitingPlayerId && nextAiProspect
      ? `第 ${pick.pickNumber} 顺位 · ${state.teams[pick.ownerTeamId].fullName} 选择了 ${playerNameZh(nextAiProspect.name, nextAiProspect.id)}`
      : simulationMode === "LIVE"
        ? `第 ${pick.pickNumber} 顺位 · ${state.teams[pick.ownerTeamId].fullName} 正在选择…`
        : `第 ${pick.pickNumber} 顺位等待开始模拟。`;
  const commitPick = (playerId: string) => onCommand({ commandId: `stage4-draft-${pick.pickNumber}-${playerId}`, type: "DRAFT_PLAYER", payload: { playerId, expectedPickNumber: pick.pickNumber } });
  return <section className="flow-card draft-card rookie-draft-terminal gemini-draft-demo reference-rookie-draft">
    <header className="gemini-draft-header reference-draft-header"><div><h2>{state.league.seasonYear} NBA 选秀大会</h2><p>第 {currentRound} 轮 · 从候选新秀中挑选球员</p></div><span className="gemini-my-picks"><small>我的顺位</small><b>{myPicks.map((entry) => `#${entry.pickNumber}`).join(" · ")}</b></span></header>
    <div className="gemini-current-pick"><div className="gemini-team-logo">{state.teams[pick.ownerTeamId].logoUrl ? <img src={state.teams[pick.ownerTeamId].logoUrl} alt={`${state.teams[pick.ownerTeamId].fullName}队徽`} /> : state.teams[pick.ownerTeamId].abbreviation ?? pick.ownerTeamId.slice(0, 3)}</div><div><small>当前顺位 · 第 {pick.pickNumber} 顺位</small><b>{state.teams[pick.ownerTeamId].fullName}</b></div><em>{playerTurn ? "准备选人" : simulationMode === "LIVE" ? "模拟进行中" : "等待模拟"}</em></div>
    <section className="gemini-ticker"><div><b>选秀顺位总览（{draft.pickOrder.length} 签）</b><small>已完成 {draftedCount} / {draft.pickOrder.length}</small></div><div className="gemini-ticker-scroll">{draft.pickOrder.map((entry) => {
      const owner = state.teams[entry.ownerTeamId];
      const selected = entry.playerId ? state.players[entry.playerId] : undefined;
      const surname = selected ? playerSurnameZh(selected.name, selected.id) : owner.abbreviation;
      const fullLabel = selected ? `${owner.fullName} · ${playerNameZh(selected.name, selected.id)}` : owner.fullName;
      return <span key={entry.pickNumber} className={`${entry.pickNumber === pick.pickNumber ? "current" : ""} ${entry.playerId ? "done" : ""}`} title={fullLabel} aria-label={`第 ${entry.pickNumber} 顺位 · ${fullLabel}`}>
        {owner.logoUrl ? <img src={owner.logoUrl} alt="" /> : <i>{owner.abbreviation}</i>}
        <small className={surname.length > 5 ? "long" : ""}>{surname}</small>
        <b>#{entry.pickNumber}</b>
      </span>;
    })}</div></section>
    <div className={`gemini-alert${playerTurn ? " action" : ""}`} aria-live="polite">{feedText}</div>
    <main className="gemini-draft-main"><div className="gemini-filter"><div className="gemini-list-heading"><b>候选新秀（{filteredProspects.length} 人）</b></div><div className="gemini-tabs">{(["ALL", "PG", "SG", "SF", "PF", "C"] as const).map((filter) => <button key={filter} className={positionFilter === filter ? "active" : ""} onClick={() => setPositionFilter(filter)}>{filter === "ALL" ? "全部" : filter}</button>)}</div></div><div className="gemini-prospect-list">{filteredProspects.map((player) => { const rank = prospects.findIndex((candidate) => candidate.id === player.id) + 1; return <article key={player.id} className={`gemini-prospect-card${player.id === exitingPlayerId ? " drafted-out" : ""}`} onClick={() => setSelectedProspectId(player.id)} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setSelectedProspectId(player.id); }}><div className="gemini-prospect-rank">#{rank}</div><PlayerPortrait player={player} portraitPath={state.players[player.id]?.portraitPath} /><div className="gemini-prospect-copy"><b>{playerNameZh(player.name, player.id)}</b><small>{positionPairLabel(player.position, player.secondaryPosition)} · {player.age} 岁 · {measurementLabel(player.heightCm, "cm")}</small><div className="gemini-scout-bar"><span style={{ width: `${Math.min(100, (player.scoutingConfidence ?? 0))}%` }} /><em>球探置信度 {player.scoutingConfidence ?? "—"}%</em></div></div><div className="gemini-prospect-grade"><b>{player.scoutedPotentialGrade ?? "—"}</b><small>潜力</small></div><button className={playerTurn ? "active" : ""} disabled={busy || !playerTurn} onClick={(event) => { event.stopPropagation(); void commitPick(player.id); }}>{playerTurn ? "选中球员" : "等待"}</button></article>; })}</div></main>
    <footer className="gemini-bottom-bar"><button disabled={busy || playerTurn} onClick={() => setSimulationMode((mode) => mode === "PAUSED" ? "LIVE" : "PAUSED")}>{simulationMode === "LIVE" ? "暂停模拟" : draftedCount === 0 ? "开始自动模拟" : "继续自动模拟"}</button><button className="primary" disabled={busy || playerTurn} onClick={() => void onCommand({ commandId: `stage4-fast-forward-draft-${state.league.seasonId}-${pick.pickNumber}`, type: "FAST_FORWARD_ROOKIE_DRAFT", payload: { expectedPickNumber: pick.pickNumber } })}>{nextUserPick ? `模拟至我方 #${nextUserPick.pickNumber}` : "完成选秀"}</button></footer>
    {selectedProspectId && state.players[selectedProspectId] && <DraftProspectDetail player={state.players[selectedProspectId]} revealed={revealedProspectIds.has(selectedProspectId)} onReveal={() => void onCommand({ commandId: `reveal-draft-prospect-${state.league.seasonId}-${selectedProspectId}`, type: "REVEAL_DRAFT_PROSPECT", payload: { playerId: selectedProspectId } })} onClose={() => setSelectedProspectId(null)} />}
  </section>;
}

function DraftProspectDetail({ player, revealed, onReveal, onClose }: { player: Player; revealed: boolean; onReveal: () => void; onClose: () => void }) {
  const [rewardBusy, setRewardBusy] = useState(false);
  const [rewardMessage, setRewardMessage] = useState<string | null>(null);
  const revealAbility = async () => {
    if (rewardBusy) return;
    setRewardBusy(true);
    setRewardMessage(null);
    try {
      const result = await watchRewardVideo(getRewardVideoBridge());
      if (result.rewarded) onReveal();
      else setRewardMessage(result.message ?? "激励视频未完成，暂未解锁 OVR。");
    } catch {
      setRewardMessage("解锁失败，请稍后再试。");
    } finally {
      setRewardBusy(false);
    }
  };
  return <div className="player-detail-backdrop draft-prospect-backdrop" role="presentation" onMouseDown={(event) => { if (!rewardBusy && event.target === event.currentTarget) onClose(); }}>
    <section className="draft-prospect-dialog cyber-scout-dialog" role="dialog" aria-modal="true" aria-busy={rewardBusy} aria-label={`${playerNameZh(player.name, player.id)} 新秀信息`}>
      <button className="detail-close" type="button" disabled={rewardBusy} onClick={onClose} aria-label="关闭球员信息">×</button>
      <header className="cyber-scout-header">
        <PlayerPortrait player={player} portraitPath={player.portraitPath} className="draft-detail-avatar" />
        <span className="draft-prospect-dialog-rank">球探分析系统 · 选秀候选</span>
        <h2>{playerNameZh(player.name, player.id)}</h2>
        <p>{positionPairLabel(player.position, player.secondaryPosition)} · {player.age} 岁 · {measurementLabel(player.heightCm, "cm")}</p>
      </header>
      <div className="draft-prospect-metrics">
        <span><b>{player.scoutedPotentialGrade ?? "—"}</b><small>潜力</small></span>
        <span><b>{player.scoutingConfidence ?? "—"}%</b><small>球探置信度</small></span>
        <span className={revealed ? "revealed" : "masked"}><b className={revealed ? "player-rating-tone" : undefined} style={revealed ? playerRatingStyle(calculatePlayerOverall(player)) : undefined}>{revealed ? Math.round(calculatePlayerOverall(player)) : "?"}</b><small>OVR</small></span>
      </div>
      <p className="draft-prospect-note">选秀阶段默认只公开潜力评级；OVR 需要通过激励视频解锁。</p>
      {revealed
        ? <div className="draft-prospect-revealed">已解锁球员 OVR：<b className="player-rating-tone" style={playerRatingStyle(calculatePlayerOverall(player))}>{Math.round(calculatePlayerOverall(player))}</b></div>
        : <button className="draft-prospect-reward" type="button" disabled={rewardBusy} onClick={() => void revealAbility()}>{rewardBusy ? "激励视频播放中…" : "查看激励视频 · 解锁 OVR"}</button>}
      {rewardMessage && <p className="draft-prospect-reward-message" role="status">{rewardMessage}</p>}
      <div className="cyber-scout-footer"><span>数据源：本地选秀数据库</span><span>OVR 解锁受激励视频保护</span></div>
    </section>
  </div>;
}

function PostDraftHub({ state, busy, onFreeAgencyCommand, onRosterCommand }: Pick<Stage4FlowProps, "state" | "busy" | "onFreeAgencyCommand" | "onRosterCommand">) {
  const [resultsOpen, setResultsOpen] = useState(false);
  if (state.freeAgency?.opened) {
    const freeAgency = state.freeAgency;
    const hasPendingRfaDecision = Boolean(freeAgency.pendingUserRfaDecision);
    const pendingUserOffers = Object.values(freeAgency.offers).filter((offer) => offer.teamId === state.userTeamId && offer.status === "ACTIVE").length;
    return <section className="stage4-market-terminal">
      <FreeAgencyHub state={state} busy={busy} onFreeAgencyCommand={onFreeAgencyCommand} />
      <div className="terminal-sticky-action fa-market-bottom-actions">
        <button type="button" className="fa-market-settle-button" disabled={busy || hasPendingRfaDecision} onClick={() => onFreeAgencyCommand({ commandId: `fa-day-${state.league.seasonId}-${freeAgency.currentDay}`, type: "ADVANCE_FA_DAY", payload: {} })}><small>{hasPendingRfaDecision ? "请先处理 RFA" : `第 ${freeAgency.currentDay} / 120 天`}</small><strong>{busy ? "结算中…" : "结算今日"}</strong></button>
        <button type="button" className="terminal-primary-button" disabled={busy || hasPendingRfaDecision} onClick={() => onRosterCommand({ commandId: `close-free-agency-${state.league.seasonId}`, type: "CLOSE_FREE_AGENCY", payload: {} })}>{pendingUserOffers ? `结算今日并结束市场 · 剩余报价将撤回` : "结算今日并结束市场，进入季前调整"} ➔</button>
      </div>
    </section>;
  }
  const draft = state.rookieDraft;
  const team = state.teams[state.userTeamId];
  const sheet = getCapSheet(state, state.userTeamId);
  const finance = getSeasonFinanceConfig(state.league.seasonYear);
  const pendingQualifyingOffers = getPendingUserQualifyingOfferPlayers(state);
  const myPicks = draft?.pickOrder.filter((pick) => pick.ownerTeamId === state.userTeamId && pick.playerId) ?? [];
  const draftResults = (draft?.pickOrder ?? [])
    .filter((pick) => pick.playerId)
    .slice()
    .sort((left, right) => left.pickNumber - right.pickNumber);
  return (
    <section className="flow-card post-draft-terminal">
      <header className="terminal-top-bar"><span>选秀后休赛期</span><strong>DRAFT COMPLETED</strong></header>
      <div className="post-draft-success"><b>✓ {draft?.pickOrder.filter((pick) => pick.playerId).length ?? 0} 个签位已完成</b><span>新秀合同已自动生成，落选秀已进入完全自由球员池。</span></div>
      <button type="button" className="post-draft-results-button" onClick={() => setResultsOpen(true)}>查看完整选秀结果 <span>{Object.keys(state.teams).length} 支球队 · {draft?.pickOrder.filter((pick) => pick.playerId).length ?? 0} 个签位 →</span></button>
      <div className="terminal-section-header"><b>本次选秀获得</b><span>{myPicks.length} 人</span></div>
      <div className="post-draft-rookie-list">
        {myPicks.map((pick) => {
          const player = state.players[pick.playerId as string];
          return <article key={pick.pickNumber}><div><span>#{pick.pickNumber}</span><b>{playerNameZh(player.name, player.id)}</b></div><small><em>{positionLabel(player.position)}</em>潜力 {player.scoutedPotentialGrade} · {money(player.contract.salary)}</small></article>;
        })}
      </div>
      <div className="terminal-section-header"><b>球队账目总览</b><span>休赛期名单上限 {LEAGUE_FINANCE_CONFIG.rosterLimits.offseasonMaximum} 人</span></div>
      <div className="post-draft-cap-grid">
        <div><small>工资帽</small><b>{money(finance.salaryCap)}</b></div>
        <div><small>薪资表</small><b>{money(sheet.total)}</b></div>
        <div><small>可用空间</small><b className={sheet.availableCapSpace < 0 ? "negative" : ""}>{money(sheet.availableCapSpace)}</b></div>
        <div><small>休赛期名单</small><b>{team.playerIds.length} / {LEAGUE_FINANCE_CONFIG.rosterLimits.offseasonMaximum}</b></div>
      </div>
      {pendingQualifyingOffers.length > 0 && <section className="qualifying-offer-panel" aria-labelledby="qualifying-offer-title">
        <header><div><small>RFA RIGHTS</small><h3 id="qualifying-offer-title">资质报价决策</h3></div><b>{pendingQualifyingOffers.length} 人待处理</b></header>
        <p>提交资质报价可保留匹配权；不提交则球员转为 UFA，但已有 Bird Rights 与对应 Cap Hold 仍保留。</p>
        <div>{pendingQualifyingOffers.map((player) => <article key={player.id}>
          <span><b>{playerNameZh(player.name, player.id)}</b><small>{positionPairLabel(player.position, player.secondaryPosition)} · OVR {calculatePlayerOverall(player).toFixed(0)} · QO {money(getQualifyingOfferAmount(player, state.league.seasonYear))}</small></span>
          <span><button type="button" disabled={busy} onClick={() => onFreeAgencyCommand({ commandId: `qo-tender-${state.league.seasonId}-${player.id}`, type: "RESOLVE_QUALIFYING_OFFER", payload: { playerId: player.id, decision: "TENDER" } })}>提交 QO</button><button type="button" className="decline" disabled={busy} onClick={() => onFreeAgencyCommand({ commandId: `qo-decline-${state.league.seasonId}-${player.id}`, type: "RESOLVE_QUALIFYING_OFFER", payload: { playerId: player.id, decision: "DECLINE" } })}>不提交</button></span>
        </article>)}</div>
      </section>}
      <div className="terminal-notice"><span>i</span><p>下一阶段：开放常规交易、受限自由球员报价单与 {BALANCE_CONFIG.freeAgency.decisionWindowDays} 日决策窗口。</p></div>
      <div className="terminal-sticky-action"><button className="terminal-primary-button" disabled={busy || pendingQualifyingOffers.length > 0} onClick={() => onFreeAgencyCommand({ commandId: `enter-free-agency-${state.league.seasonId}`, type: "ENTER_FREE_AGENCY", payload: {} })}>{pendingQualifyingOffers.length > 0 ? `请先处理 ${pendingQualifyingOffers.length} 份资质报价` : "进入自由市场 ➔"}</button></div>
      {resultsOpen && <div className="draft-results-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setResultsOpen(false); }}><section className="draft-results-dialog" role="dialog" aria-modal="true" aria-label="完整选秀结果"><header><div><span>全联盟选秀档案</span><h2>{state.league.seasonYear} 选秀结果</h2><small>按选秀顺位排列 · {draftResults.length} 个完成签位</small></div><button type="button" onClick={() => setResultsOpen(false)} aria-label="关闭">×</button></header><div className="draft-results-list"><ol className="draft-result-pick-list">{draftResults.map((entry) => {
        const player = state.players[entry.playerId as string];
        const owner = state.teams[entry.ownerTeamId];
        const podiumLabel = entry.pickNumber === 1 ? "状元" : entry.pickNumber === 2 ? "榜眼" : entry.pickNumber === 3 ? "探花" : null;
        return <li data-testid={`draft-result-pick-${entry.pickNumber}`} key={entry.pickNumber} className={`${entry.ownerTeamId === state.userTeamId ? "user-team" : ""}${podiumLabel ? " podium-pick" : ""}`}><div className="draft-result-order"><em>#{entry.pickNumber}</em>{podiumLabel && <strong>{podiumLabel}</strong>}</div><span className="draft-result-team-logo">{owner.logoUrl ? <img src={owner.logoUrl} alt="" /> : owner.abbreviation}</span><div className="draft-result-player"><b>{player ? playerNameZh(player.name, player.id) : "—"}</b><small>{player ? `${positionLabel(player.position)} · 潜力 ${player.scoutedPotentialGrade ?? "—"}` : "球员信息缺失"}</small></div><div className="draft-result-owner"><b>{owner.abbreviation}</b><small>{owner.fullName}</small></div></li>;
      })}</ol></div></section></div>}
    </section>
  );
}

type TradeDeskProps = Pick<Stage4FlowProps, "state" | "busy" | "onTradeCommand"> & {
  closeMarketDisabled?: boolean;
  onCloseMarket?: () => void;
};

export function TradeDesk({ state, busy, onTradeCommand, closeMarketDisabled = false, onCloseMarket }: TradeDeskProps) {
  const [tradeMode, setTradeMode] = useState<"ASSET" | "TARGET">("ASSET");
  const [assetDrawerOpen, setAssetDrawerOpen] = useState(false);
  const [assetPositionFilter, setAssetPositionFilter] = useState<TradeAssetPosition>("ALL");
  const [targetTeamFilter, setTargetTeamFilter] = useState(() => {
    const savedTargetId = state.tradeDesk.targetPlayerIds?.[0];
    return savedTargetId ? state.players[savedTargetId]?.teamId ?? "ALL" : "ALL";
  });
  const [targetPositionFilter, setTargetPositionFilter] = useState<TradeAssetPosition>("ALL");
  const [targetNameFilter, setTargetNameFilter] = useState("");
  const [draftTargetIds, setDraftTargetIds] = useState<string[]>(() => state.tradeDesk.targetPlayerIds ?? []);
  const targetFiltersBeforeSelection = useRef<{ team: string; position: TradeAssetPosition; name: string } | null>(null);
  const [inquiryPlayerId, setInquiryPlayerId] = useState<string | null>(null);
  const [inquiryMessage, setInquiryMessage] = useState<string | null>(null);
  const inquiryInProgress = useRef(false);
  const offersRef = useRef<HTMLElement>(null);
  const scrollToOffersAfterInquiry = useRef(false);
  const [detailOfferId, setDetailOfferId] = useState<string | null>(null);
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);
  const refreshInProgress = useRef(false);
  const assetSaveInProgress = useRef(false);
  const [assetSaving, setAssetSaving] = useState(false);
  const [assetSaveError, setAssetSaveError] = useState<string | null>(null);
  const [draftPlayerIds, setDraftPlayerIds] = useState<string[]>(() => state.tradeDesk.selectedPlayerIds ?? (state.tradeDesk.selectedPlayerId ? [state.tradeDesk.selectedPlayerId] : []));
  const [draftPickIds, setDraftPickIds] = useState<string[]>(() => state.tradeDesk.selectedPickIds ?? []);
  const acceptedOfferId = state.tradeDesk.offers.find((offer) => offer.status === "ACCEPTED")?.offerId;
  useEffect(() => {
    if (!acceptedOfferId) return;
    setDraftTargetIds([]);
    setDraftPlayerIds([]);
    setDraftPickIds([]);
    setTargetTeamFilter("ALL");
    setTargetPositionFilter("ALL");
    setTargetNameFilter("");
    targetFiltersBeforeSelection.current = null;
    setAssetDrawerOpen(false);
    setDetailOfferId(null);
    setInquiryMessage(null);
    setRefreshMessage(null);
  }, [acceptedOfferId]);
  useEffect(() => {
    const team = state.teams[state.userTeamId];
    setDraftPlayerIds((ids) => ids.every((id) => team.playerIds.includes(id)) ? ids : ids.filter((id) => team.playerIds.includes(id)));
    setDraftPickIds((ids) => ids.every((id) => state.draftPicks[id]?.ownerTeamId === team.id) ? ids : ids.filter((id) => state.draftPicks[id]?.ownerTeamId === team.id));
  }, [state.teams, state.draftPicks, state.userTeamId]);
  useEffect(() => {
    if (!scrollToOffersAfterInquiry.current || inquiryPlayerId) return;
    scrollToOffersAfterInquiry.current = false;
    offersRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [inquiryPlayerId, state.tradeDesk.offers]);
  const roster = state.teams[state.userTeamId].playerIds.map((id) => state.players[id]).filter(Boolean).sort((a, b) => b.contract.salary - a.contract.salary);
  const otherTeams = Object.values(state.teams).filter((team) => team.id !== state.userTeamId).sort((a, b) => a.fullName.localeCompare(b.fullName, "zh-CN"));
  const chosenTargetTeamId = draftTargetIds.length ? state.players[draftTargetIds[0]]?.teamId : undefined;
  const targetNameQuery = targetNameFilter.trim().toLocaleLowerCase();
  const targetPlayers = otherTeams.flatMap((team) => team.playerIds.map((id) => state.players[id]).filter((player): player is Player => Boolean(player)))
    .filter((player) => (targetTeamFilter === "ALL" || player.teamId === targetTeamFilter)
      && (targetPositionFilter === "ALL" || player.position === targetPositionFilter || player.secondaryPosition === targetPositionFilter)
      && (!targetNameQuery || player.name.toLocaleLowerCase().includes(targetNameQuery) || playerNameZh(player.name, player.id).toLocaleLowerCase().includes(targetNameQuery)))
    .sort((a, b) => calculatePlayerOverall(b) - calculatePlayerOverall(a) || a.name.localeCompare(b.name));
  const visibleTargetPlayers = targetPlayers.slice(0, 60);
  const visibleUntouchableIds = new Set([...new Set(visibleTargetPlayers.map((player) => player.teamId))]
    .flatMap((teamId) => untouchablePlayerIds(state, teamId)));
  const selectedPlayerIds = state.tradeDesk.selectedPlayerIds ?? (state.tradeDesk.selectedPlayerId ? [state.tradeDesk.selectedPlayerId] : []);
  const selectedPickIds = state.tradeDesk.selectedPickIds ?? [];
  const selectedAvailable = selectedPlayerIds.some((id) => roster.some((player) => player.id === id)) || selectedPickIds.some((id) => state.draftPicks[id]?.ownerTeamId === state.userTeamId);
  const savedTargetIds = state.tradeDesk.targetPlayerIds ?? [];
  const targetSelectionChanged = [...draftTargetIds].sort().join("|") !== [...savedTargetIds].sort().join("|");
  const targetAvailable = draftTargetIds.length > 0 && chosenTargetTeamId !== state.userTeamId
    && draftTargetIds.every((id) => state.players[id]?.teamId === chosenTargetTeamId && state.teams[chosenTargetTeamId ?? ""]?.playerIds.includes(id) && !isUntouchable(state, id));
  const displayedPlayer = inquiryPlayerId ? state.players[inquiryPlayerId] : state.players[draftPlayerIds[0]];
  const selectionChanged = [...draftPlayerIds].sort().join("|") !== [...selectedPlayerIds].sort().join("|") || [...draftPickIds].sort().join("|") !== [...selectedPickIds].sort().join("|");
  const clearTargetSelection = () => {
    setDraftTargetIds([]);
    setTargetTeamFilter(targetFiltersBeforeSelection.current?.team ?? "ALL");
    setTargetPositionFilter(targetFiltersBeforeSelection.current?.position ?? "ALL");
    setTargetNameFilter(targetFiltersBeforeSelection.current?.name ?? "");
    targetFiltersBeforeSelection.current = null;
    setInquiryMessage(null);
  };
  const toggleTargetPlayer = (player: Player) => {
    if (draftTargetIds.includes(player.id)) {
      const remaining = draftTargetIds.filter((id) => id !== player.id);
      if (!remaining.length) clearTargetSelection();
      else { setDraftTargetIds(remaining); setInquiryMessage(null); }
      return;
    }
    if (!draftTargetIds.length) targetFiltersBeforeSelection.current = { team: targetTeamFilter, position: targetPositionFilter, name: targetNameFilter };
    setDraftTargetIds([...draftTargetIds, player.id]);
    setTargetTeamFilter(player.teamId);
    setTargetPositionFilter("ALL");
    setTargetNameFilter("");
    setInquiryMessage(null);
  };
  const closeAssetPicker = async () => {
    if (assetSaveInProgress.current || busy) return;
    if (selectionChanged) {
      assetSaveInProgress.current = true;
      setAssetSaving(true);
      setAssetSaveError(null);
      try {
        await onTradeCommand({ commandId: tradeSelectionCommandId(state, draftPlayerIds, draftPickIds), type: "SET_TRADE_ASSETS", payload: { playerIds: draftPlayerIds, pickIds: draftPickIds } });
      } catch (error) {
        setAssetSaveError(error instanceof Error ? humanizeUiText(error.message) : "交易筹码保存失败，请重试。");
        return;
      } finally {
        assetSaveInProgress.current = false;
        setAssetSaving(false);
      }
    }
    setAssetDrawerOpen(false);
  };
  const requestOffers = (playerIds: string[], pickIds: string[], refresh: boolean) => onTradeCommand({ commandId: tradeInquiryCommandId(state, playerIds, pickIds), type: "GENERATE_TRADE_OFFERS", payload: { playerIds, pickIds, refresh } });
  const requestTargetedOffers = (targetPlayerIds: string[], refresh: boolean) => onTradeCommand({ commandId: targetedTradeInquiryCommandId(state, targetPlayerIds), type: "GENERATE_TARGETED_TRADE_OFFERS", payload: { targetPlayerIds, refresh } });
  const selectAssets = async () => {
    if (inquiryInProgress.current || busy) return;
    inquiryInProgress.current = true;
    setAssetDrawerOpen(false);
    setInquiryPlayerId(draftPlayerIds[0] ?? "pick-only");
    setInquiryMessage(null);
    try {
      await requestOffers(draftPlayerIds, draftPickIds, false);
    } catch (error) {
      setInquiryMessage(error instanceof Error ? humanizeUiText(error.message) : "询价失败，请调整球员或选秀权组合。");
    } finally {
      inquiryInProgress.current = false;
      setInquiryPlayerId(null);
    }
  };
  const selectTargets = async () => {
    if (inquiryInProgress.current || busy || !targetAvailable) return;
    inquiryInProgress.current = true;
    setInquiryPlayerId(draftTargetIds[0]);
    setInquiryMessage(null);
    try {
      await requestTargetedOffers(draftTargetIds, false);
      scrollToOffersAfterInquiry.current = true;
    } catch (error) {
      scrollToOffersAfterInquiry.current = false;
      setInquiryMessage(error instanceof Error ? humanizeUiText(error.message) : "目标询价失败，请调整目标球员。");
    } finally {
      inquiryInProgress.current = false;
      setInquiryPlayerId(null);
    }
  };
  const activeQuote = tradeMode === "TARGET"
    ? state.tradeDesk.inquiryMode === "TARGET" && targetAvailable && !targetSelectionChanged
    : state.tradeDesk.inquiryMode !== "TARGET" && selectedAvailable && !selectionChanged;
  const offers = activeQuote ? state.tradeDesk.offers.filter((offer) => offer.status === "AVAILABLE").map((offer) => {
    const incoming = state.players[offer.userIncomingPlayerIds[0]];
    const portraitPlayer = tradeOfferPortraitPlayer(state, offer, tradeMode);
    const evaluation = evaluateTradeOffer(state, offer.offerId);
    return { offer, incoming, portraitPlayer, evaluation };
  }) : [];
  const detail = offers.find(({ offer }) => offer.offerId === detailOfferId) ?? null;
  const closePanel = (target: HTMLElement) => target.closest("details")?.removeAttribute("open");
  const refreshOffers = async () => {
    if (refreshInProgress.current || busy || !activeQuote) return;
    refreshInProgress.current = true;
    setRefreshBusy(true);
    setRefreshMessage(null);
    try {
      const reward = await runRewardedAction(getRewardVideoBridge(), () => tradeMode === "TARGET" ? requestTargetedOffers(draftTargetIds, true) : requestOffers(selectedPlayerIds, selectedPickIds, true));
      if (!reward.rewarded) {
        setRefreshMessage(reward.message ?? "激励视频未完成，报价保持不变。");
      }
    } catch (error) {
      setRefreshMessage(error instanceof Error ? humanizeUiText(error.message) : "报价刷新失败，请稍后再试。");
    } finally {
      refreshInProgress.current = false;
      setRefreshBusy(false);
    }
  };
  return <section className="trade-console-demo trade-center-terminal">
    {onCloseMarket && <button data-testid="trade-center-close" className="trade-console-close" type="button" aria-label="关闭球员交易中心" onClick={(event) => closePanel(event.currentTarget)}>✕</button>}
    <header className="trade-console-header">
      <div className="trade-console-title"><i /><div><div><b>交易控制台</b><span>交易窗口开放</span></div><small>{state.teams[state.userTeamId].fullName} · {state.league.seasonId} 赛季</small></div></div>
      <div className="trade-console-space"><small>帽下空间</small><b>{money(getCapSheet(state, state.userTeamId).availableCapSpace)}</b></div>
    </header>
    <div className="trade-console-scroll">
      <div className="trade-mode-tabs" role="group" aria-label="交易询价方式"><button type="button" className={tradeMode === "ASSET" ? "selected" : ""} aria-pressed={tradeMode === "ASSET"} onClick={() => { setTradeMode("ASSET"); setInquiryMessage(null); }}>我方筹码询价</button><button type="button" className={tradeMode === "TARGET" ? "selected" : ""} aria-pressed={tradeMode === "TARGET"} onClick={() => { setTradeMode("TARGET"); setInquiryMessage(null); }}>搜索目标球员</button></div>
      {tradeMode === "ASSET" ? <>
      <section className="trade-console-card trade-asset-card"><div className="trade-console-card-heading"><b><em className="trade-step">01</em> 选择我方筹码</b><span>{inquiryPlayerId ? "询价中" : draftPlayerIds.length + draftPickIds.length ? `${draftPlayerIds.length} 名球员 · ${draftPickIds.length} 枚签` : "未选择"}</span></div>
        <button className="trade-asset-trigger" type="button" disabled={busy || Boolean(inquiryPlayerId)} onClick={() => setAssetDrawerOpen(true)}>{displayedPlayer ? <PlayerPortrait player={displayedPlayer} portraitPath={displayedPlayer.portraitPath} className="trade-avatar" /> : <span className="trade-avatar">签</span>}<span className="trade-asset-copy">{draftPlayerIds.length + draftPickIds.length ? <><b>{draftPlayerIds.map((id) => playerNameZh(state.players[id]?.name ?? id, id)).join("、") || "选秀权"}</b><small>{draftPickIds.length ? draftPickIds.map((id) => tradePickLabel(state, id)).join("、") : "未加入选秀权"}</small><strong>{draftPlayerIds.length} 名球员 · {draftPickIds.length} 枚签</strong></> : <b>选择我方交易筹码</b>}</span><strong className="trade-asset-change">{inquiryPlayerId ? "询价中…" : "编辑筹码　›"}</strong></button>
        <button className="trade-inquiry-submit" type="button" disabled={busy || Boolean(inquiryPlayerId) || draftPlayerIds.length + draftPickIds.length === 0 || (!selectionChanged && selectedAvailable && offers.length > 0)} onClick={() => void selectAssets()}>{inquiryPlayerId ? "正在获取报价…" : "获取报价"}</button>
      </section></> : <section className="trade-console-card trade-target-card"><div className="trade-console-card-heading"><b><em className="trade-step">01</em> 搜索想要的球员</b><span>{draftTargetIds.length} / 3 已选</span></div><div className="trade-target-filters">
        <TradeTargetFilter label="球队" value={targetTeamFilter} options={[{ value: "ALL", label: "全部球队" }, ...otherTeams.map((team) => ({ value: team.id, label: team.fullName }))]} onChange={setTargetTeamFilter} />
        <TradeTargetFilter label="位置" value={targetPositionFilter} options={TRADE_ASSET_POSITIONS.map((position) => ({ value: position, label: position === "ALL" ? "全部位置" : position }))} onChange={setTargetPositionFilter} />
        <label className="trade-target-name"><span>姓名</span><input aria-label="按姓名搜索目标球员" value={targetNameFilter} onChange={(event) => setTargetNameFilter(event.target.value)} placeholder="输入中文或英文姓名" /></label>
      </div><p className="trade-target-hint">一次可选同一支球队的最多 3 名球员。对方会提出要求的筹码；高能力球员通常需要更有价值的报价；非卖品无法询价或成交。</p>{draftTargetIds.length > 0 && <div className="trade-target-selected"><b>已选：{draftTargetIds.map((id) => playerNameZh(state.players[id]?.name ?? id, id)).join("、")}</b><button type="button" onClick={clearTargetSelection}>清空</button></div>}<div className="trade-target-results" role="group" aria-label="目标球员搜索结果">{visibleTargetPlayers.map((player) => { const selected = draftTargetIds.includes(player.id); const otherTeam = state.teams[player.teamId]; const untouchable = visibleUntouchableIds.has(player.id); const locked = !selected && ((chosenTargetTeamId && chosenTargetTeamId !== player.teamId) || draftTargetIds.length >= 3 || untouchable); return <button type="button" key={player.id} className={`trade-target-player${selected ? " selected" : ""}${untouchable ? " untouchable" : ""}`} disabled={busy || Boolean(inquiryPlayerId) || Boolean(locked)} aria-pressed={selected} onClick={() => toggleTargetPlayer(player)}><PlayerPortrait player={player} portraitPath={player.portraitPath} className="trade-avatar" /><span><b>{playerNameZh(player.name, player.id)}</b><small>{otherTeam?.abbreviation} · {positionLabel(player.position)} · {player.age} 岁 · {money(player.contract.salary)}</small>{untouchable ? <em>非卖品</em> : player.teamRole === "FRANCHISE_CORE" && <em>球队核心</em>}</span><span className="trade-target-overall player-rating-tone" style={playerRatingStyle(calculatePlayerOverall(player))}>{calculatePlayerOverall(player).toFixed(0)}<small>OVR</small></span><strong>{selected ? "✓ 已选" : untouchable ? "无法询价" : locked ? "同队选择" : "＋ 添加"}</strong></button>; })}{targetPlayers.length === 0 && <p className="trade-console-empty">没有符合筛选条件的球员。</p>}{targetPlayers.length > 60 && <small className="trade-target-more">显示前 60 人，请继续缩小筛选范围。</small>}</div><div className="trade-target-submit">{inquiryMessage && <p className="trade-inquiry-message" role="alert">{inquiryMessage}</p>}<button className="trade-inquiry-submit" type="button" disabled={busy || Boolean(inquiryPlayerId) || !targetAvailable || (!targetSelectionChanged && state.tradeDesk.inquiryMode === "TARGET" && offers.length > 0)} onClick={() => void selectTargets()}>{inquiryPlayerId ? "正在请求对方报价…" : "请对方提出报价"}</button></div></section>}
      <section className="trade-console-offers" ref={offersRef}><div className="trade-console-offer-heading"><b><em className="trade-step">02</em> 系统询价回应 <span>{inquiryPlayerId ? "匹配中" : `${offers.length} 个方案`}</span></b></div>
        {inquiryPlayerId ? <div className="trade-console-loading" role="status" aria-live="polite"><b>正在向联盟球队询价…</b><small>核对筹码价值、薪资规则与球队需求，寻找可行报价。</small>{[0, 1, 2].map((index) => <div className="trade-console-loading-card" key={index} aria-hidden="true"><i /><span><i /><i /></span><i /></div>)}</div> : <div className="trade-console-offer-list">{offers.map(({ offer, incoming, portraitPlayer, evaluation }) => {
          const portrait = portraitPlayer
            ? <PlayerPortrait player={portraitPlayer} portraitPath={portraitPlayer.portraitPath} className="trade-avatar" />
            : <span className="trade-avatar">签</span>;
          const fit = <span className="trade-offer-fit"><b className={evaluation.userFitDelta >= 0 ? "positive" : "negative"}>适配 {evaluation.userFitDelta >= 0 ? "+" : ""}{evaluation.userFitDelta.toFixed(1)}</b><small>{evaluation.legal ? "查看方案 ›" : "方案失效 ›"}</small></span>;
          const additionalOutgoing = tradeMode === "TARGET"
            ? offer.userOutgoingPlayerIds.filter((id) => id !== portraitPlayer?.id).map((id) => {
                const player = state.players[id];
                return `${playerNameZh(player?.name ?? id, id)}${player ? `（${positionLabel(player.position)}）` : ""}`;
              })
              .concat(offer.userOutgoingPickIds.map((id) => tradePickLabel(state, id)))
            : [];
          const incomingAssets = tradeMode === "TARGET"
            ? offer.userIncomingPlayerIds.map((id) => {
                const player = state.players[id];
                return `${playerNameZh(player?.name ?? id, id)}${player ? `（${positionLabel(player.position)} · ${calculatePlayerOverall(player).toFixed(0)} OVR）` : ""}`;
              }).concat(offer.userIncomingPickIds.map((id) => tradePickLabel(state, id)))
            : [];
          return <button type="button" className={`trade-console-offer-card${tradeMode === "TARGET" ? " trade-target-offer-card" : ""}`} key={offer.offerId} onClick={() => setDetailOfferId(offer.offerId)}>
            {tradeMode === "TARGET" ? <>
              <span className="trade-target-offer-primary">{portrait}<span className="trade-offer-copy"><small className="trade-offer-side-label">我方主筹码</small><b>{portraitPlayer ? playerNameZh(portraitPlayer.name, portraitPlayer.id) : "选秀权筹码"} {portraitPlayer && <em>{positionLabel(portraitPlayer.position)}</em>}</b>{portraitPlayer && <small><strong className="player-rating-tone" style={playerRatingStyle(calculatePlayerOverall(portraitPlayer))}>{calculatePlayerOverall(portraitPlayer).toFixed(0)} OVR</strong> · {money(portraitPlayer.contract.salary)}</small>}</span>{fit}</span>
              <span className="trade-target-offer-package">{additionalOutgoing.length > 0 && <small><strong>另需付出</strong><span>{additionalOutgoing.join("、")}</span></small>}<small className="trade-target-offer-incoming"><strong>我方获得</strong><span>{incomingAssets.join("、") || "无"}</span></small><small className="trade-target-offer-team">来自 {state.teams[offer.counterpartyTeamId].fullName}</small></span>
            </> : <>{portrait}<span className="trade-offer-copy"><b>{offer.userIncomingPlayerIds.map((id) => playerNameZh(state.players[id]?.name ?? id, id)).join("、") || "选秀权报价"} {incoming && <em>{positionLabel(incoming.position)}</em>}</b>{incoming && <small><strong className="player-rating-tone" style={playerRatingStyle(calculatePlayerOverall(incoming))}>{calculatePlayerOverall(incoming).toFixed(0)} OVR</strong> · {money(incoming.contract.salary)}</small>}<small>{state.teams[offer.counterpartyTeamId].fullName}</small>{offer.userIncomingPickIds.length > 0 && <small className="trade-offer-picks">附带 {offer.userIncomingPickIds.map((id) => tradePickLabel(state, id)).join("、")}</small>}</span>{fit}</>}
          </button>;
        })}{offers.length === 0 && <div className="trade-console-empty">{tradeMode === "TARGET" ? "筛选目标球员并请求报价后，对方方案将在这里显示" : "选择筹码并获取报价后，系统方案将在这里显示"}</div>}</div>}
        {tradeMode === "ASSET" && inquiryMessage && <p className="trade-inquiry-message" role="alert">{inquiryMessage}</p>}
        <div className="trade-refresh-action"><button data-testid="trade-refresh" type="button" disabled={busy || refreshBusy || Boolean(inquiryPlayerId) || !activeQuote} onClick={() => void refreshOffers()}><span>刷新报价</span><small>{refreshBusy ? "激励视频播放中…" : "观看激励视频"}</small></button><p role="status" aria-live="polite">{refreshMessage ?? "完播后才会生成新的报价；当前方案会保留至刷新成功。"}</p></div>
      </section>
    </div>
    {assetDrawerOpen && <TradeAssetPicker
      state={state} roster={roster} selectedPlayerIds={draftPlayerIds} selectedPickIds={draftPickIds}
      busy={assetSaving} error={assetSaveError}
      positionFilter={assetPositionFilter} onPositionFilter={setAssetPositionFilter}
      onTogglePlayer={(id) => setDraftPlayerIds((ids) => ids.includes(id) ? ids.filter((entry) => entry !== id) : [...ids, id])}
      onTogglePick={(id) => setDraftPickIds((ids) => ids.includes(id) ? ids.filter((entry) => entry !== id) : [...ids, id])}
      onClose={() => void closeAssetPicker()}
    />}
    {detail && <TradeOfferDetail
      state={state} offer={detail.offer} evaluation={detail.evaluation} busy={busy}
      onBack={() => setDetailOfferId(null)}
      onAccept={() => { void onTradeCommand({ commandId: `accept-trade-${detail.offer.offerId}`, type: "ACCEPT_TRADE_OFFER", payload: { offerId: detail.offer.offerId } }).then(() => setDetailOfferId(null)); }}
    />}
    {onCloseMarket && <footer className="trade-center-footer"><button data-testid="trade-end-market" type="button" disabled={busy || closeMarketDisabled} onClick={onCloseMarket}>结束自由市场并进入名单锁定 ➔</button></footer>}
  </section>;
}

function RosterLock({ state, busy, onRosterCommand }: Pick<Stage4FlowProps, "state" | "busy" | "onRosterCommand">) {
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [pendingWaivePlayerId, setPendingWaivePlayerId] = useState<string | null>(null);
  const [focusPickerPlayerId, setFocusPickerPlayerId] = useState<string | null>(null);
  const [focusPickerAnchor, setFocusPickerAnchor] = useState<{ left: number; top: number; width: number } | null>(null);
  const roster = state.teams[state.userTeamId].playerIds.map((id) => state.players[id]);
  const requiredWaives = Math.max(0, roster.length - LEAGUE_FINANCE_CONFIG.rosterLimits.regularSeasonMaximum);
  const assignments = state.trainingPlan?.seasonId === state.league.seasonId ? getRosterTrainingAssignments(state) : {};
  const focusedCount = Object.keys(assignments).length;
  const selectedPlayer = selectedPlayerId ? state.players[selectedPlayerId] : undefined;
  const pendingWaivePlayer = pendingWaivePlayerId ? state.players[pendingWaivePlayerId] : undefined;
  const focusPickerPlayer = focusPickerPlayerId ? state.players[focusPickerPlayerId] : undefined;
  useEffect(() => {
    if (!selectedPlayerId && !pendingWaivePlayerId && !focusPickerPlayerId) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setSelectedPlayerId(null);
      setPendingWaivePlayerId(null);
      setFocusPickerPlayerId(null);
      setFocusPickerAnchor(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [focusPickerPlayerId, pendingWaivePlayerId, selectedPlayerId]);
  useEffect(() => {
    if (!focusPickerPlayerId) return;
    const closeOnScroll = () => { setFocusPickerPlayerId(null); setFocusPickerAnchor(null); };
    window.addEventListener("scroll", closeOnScroll, true);
    window.addEventListener("resize", closeOnScroll);
    return () => { window.removeEventListener("scroll", closeOnScroll, true); window.removeEventListener("resize", closeOnScroll); };
  }, [focusPickerPlayerId]);
  const closeFocusPicker = () => { setFocusPickerPlayerId(null); setFocusPickerAnchor(null); };
  return <section className="flow-card preseason-terminal"><header className="terminal-top-bar"><span>季前准备 · 阵容微调与指定训练</span><strong>PRE-SEASON</strong></header><div className="terminal-metrics-grid"><span><b>{focusedCount} / {BALANCE_CONFIG.training.maxFocusedPlayers}</b><small>重点培养</small></span><span><b>{roster.length}</b><small>当前人数</small></span><span><b className={requiredWaives > 0 ? "warning" : ""}>{requiredWaives}</b><small>需裁人数</small></span></div><section className="training-guide" aria-labelledby="training-guide-title"><header><b id="training-guide-title">重点培养怎么生效</b><span>赛季结束统一结算</span></header><p>每赛季最多指定 {BALANCE_CONFIG.training.maxFocusedPlayers} 人。它会调整球员年度成长的属性权重，不会立刻或固定增加 OVR；出场时间、球队角色、健康、潜力等仍会共同影响结果。</p><div className="training-age-grid"><span><b>结算时 ≤ 25 岁</b><small>成长空间大，优先培养</small></span><span><b>结算时 26～29 岁</b><small>基础成长低，效果可能不明显</small></span><span><b>结算时 ≥ 30 岁</b><small>进入衰退分支，培养不提供加成</small></span></div><p className="training-guide-warning"><strong>选择建议：</strong>“综合”对所有属性小幅加成、最稳；专项会明显强化目标属性，同时压低非重点属性的成长权重。结算前球员会先增长一岁。</p></section><div className="terminal-section-header"><b>常规赛名单</b><span>需调整至 {LEAGUE_FINANCE_CONFIG.rosterLimits.regularSeasonMinimum}～{LEAGUE_FINANCE_CONFIG.rosterLimits.regularSeasonMaximum} 人</span></div><TeamRosterPanel players={roster} variant="preseason" onOpenPlayer={setSelectedPlayerId} renderActions={(player) => {
    const focus = assignments[player.id];
    const focusLabel = TRAINING_FOCUS_OPTIONS.find((option) => option.value === focus)?.label ?? "不指定";
    return <><button type="button" className="preseason-focus-trigger" data-testid={`preseason-focus-${player.id}`} aria-label={`${playerNameZh(player.name, player.id)} 训练重点：${focusLabel}`} aria-haspopup="menu" aria-expanded={focusPickerPlayerId === player.id} disabled={busy || (!focus && focusedCount >= BALANCE_CONFIG.training.maxFocusedPlayers)} onClick={(event) => {
      if (focusPickerPlayerId === player.id) { closeFocusPicker(); return; }
      const rect = event.currentTarget.getBoundingClientRect();
      const menuHeight = Math.min(430, window.innerHeight - 16);
      const width = Math.min(300, window.innerWidth - 16);
      const top = rect.bottom + menuHeight + 8 <= window.innerHeight ? rect.bottom + 4 : Math.max(8, rect.top - menuHeight - 4);
      setFocusPickerAnchor({ left: Math.min(Math.max(8, rect.left), window.innerWidth - width - 8), top, width });
      setFocusPickerPlayerId(player.id);
    }}><span>{focusLabel}</span><span aria-hidden="true">⌄</span></button><button type="button" className="preseason-waive-button" data-testid={`preseason-waive-${player.id}`} disabled={busy || roster.length <= LEAGUE_FINANCE_CONFIG.rosterLimits.regularSeasonMinimum} onClick={() => setPendingWaivePlayerId(player.id)}>裁员</button></>;
  }} /><div className="terminal-sticky-action"><button className="terminal-primary-button" disabled={busy || roster.length > LEAGUE_FINANCE_CONFIG.rosterLimits.regularSeasonMaximum} onClick={() => onRosterCommand({ commandId: `lock-opening-roster-${state.league.seasonId}`, type: "LOCK_OPENING_ROSTER", payload: { confirmMinimumFill: true } })}>锁定名单并进入常规赛 ➔</button></div>
    {focusPickerPlayer && focusPickerAnchor && createPortal(<div className="preseason-focus-dismiss" role="presentation" onMouseDown={closeFocusPicker}><div className="preseason-focus-dropdown" role="menu" aria-label={`${playerNameZh(focusPickerPlayer.name, focusPickerPlayer.id)} 训练重点`} style={focusPickerAnchor} onMouseDown={(event) => event.stopPropagation()}><header><b>{playerNameZh(focusPickerPlayer.name, focusPickerPlayer.id)}</b><small className={focusPickerPlayer.age + 1 >= 30 ? "training-age-warning" : ""}>当前 {focusPickerPlayer.age} 岁 · 预计结算 {focusPickerPlayer.age + 1} 岁{focusPickerPlayer.age + 1 >= 30 ? " · 无培养加成" : ` · 名额 ${focusedCount}/${BALANCE_CONFIG.training.maxFocusedPlayers}`}</small></header>{([{ value: null, label: "不指定", description: "取消重点培养，不占用培养名额" }, ...TRAINING_FOCUS_OPTIONS] as Array<{ value: TrainingFocus | null; label: string; description: string }>).map(({ value, label, description }) => {
      const selected = (assignments[focusPickerPlayer.id] ?? null) === value;
      return <button type="button" role="menuitemradio" aria-checked={selected} key={value ?? "none"} className={selected ? "selected" : ""} disabled={busy || (value !== null && (focusPickerPlayer.age + 1 >= 30 || (!assignments[focusPickerPlayer.id] && focusedCount >= BALANCE_CONFIG.training.maxFocusedPlayers)))} onClick={() => { closeFocusPicker(); if (selected) return; void onRosterCommand({ commandId: trainingFocusCommandId(state, focusPickerPlayer.id), type: "SET_TRAINING_FOCUS", payload: { playerId: focusPickerPlayer.id, focus: value } }); }}><span><b>{label}</b><small>{value !== null && focusPickerPlayer.age + 1 >= 30 ? "预计结算时已满 30 岁，此方向不会提供加成" : description}</small></span>{selected && <strong>✓</strong>}</button>;
    })}</div></div>, document.body)}
    {selectedPlayer && <div className="player-detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedPlayerId(null); }}><section className="reference-player-dialog" role="dialog" aria-modal="true" aria-label={`${playerNameZh(selectedPlayer.name, selectedPlayer.id)} 球员详情`}><button className="detail-close" type="button" onClick={() => setSelectedPlayerId(null)} aria-label="关闭">×</button><ReferencePlayerCard player={selectedPlayer} teamName={state.teams[selectedPlayer.teamId]?.fullName ?? "自由球员"} /></section></div>}
    {pendingWaivePlayer && <div className="player-detail-backdrop preseason-confirm-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setPendingWaivePlayerId(null); }}><section className="preseason-waive-dialog" data-testid="preseason-waive-dialog" role="alertdialog" aria-modal="true" aria-labelledby="preseason-waive-title" aria-describedby="preseason-waive-description"><span className="preseason-waive-icon" aria-hidden="true">!</span><div><small>ROSTER TRANSACTION</small><h2 id="preseason-waive-title">确认裁掉 {playerNameZh(pendingWaivePlayer.name, pendingWaivePlayer.id)}？</h2><p id="preseason-waive-description">该操作会立即移出球队名单；剩余保障金额 {money(pendingWaivePlayer.contract.guaranteedAmount)} 将按合同年份计入死钱。</p><div className="preseason-waive-summary"><span>裁员后名单 <b>{roster.length - 1} 人</b></span><span>球员状态 <b>完全自由球员</b></span></div><div className="preseason-waive-actions"><button type="button" data-testid="preseason-waive-cancel" disabled={busy} onClick={() => setPendingWaivePlayerId(null)}>取消</button><button type="button" className="danger" data-testid="preseason-waive-confirm" disabled={busy} onClick={() => void onRosterCommand({ commandId: `waive-${state.league.seasonId}-${pendingWaivePlayer.id}`, type: "WAIVE_PLAYER", payload: { playerId: pendingWaivePlayer.id } }).finally(() => setPendingWaivePlayerId(null))}>确认裁员</button></div></div></section></div>}
  </section>;
}

function FreeAgencyHub({ state, busy, onFreeAgencyCommand }: Pick<Stage4FlowProps, "state" | "busy" | "onFreeAgencyCommand">) {
  const freeAgency = state.freeAgency;
  const [positionFilter, setPositionFilter] = useState<ExpansionPositionFilter>("ALL");
  const [sortOption, setSortOption] = useState<FreeAgentSortOption>("ABILITY_DESC");
  const [searchQuery, setSearchQuery] = useState("");
  const [rosterPositionFilter, setRosterPositionFilter] = useState<ExpansionPositionFilter>("ALL");
  const [rosterOpen, setRosterOpen] = useState(true);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [offerEditor, setOfferEditor] = useState<FreeAgentOfferEditorState | null>(null);
  useEffect(() => {
    if (!selectedPlayerId && !offerEditor) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (offerEditor) setOfferEditor(null);
      else setSelectedPlayerId(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [offerEditor, selectedPlayerId]);
  if (!freeAgency) return null;
  const players = getFreeAgents(state);
  const currentTeamId = getCurrentTeamId(state);
  const currentTeam = state.teams[currentTeamId];
  const sheet = getCapSheet(state, currentTeamId);
  const pending = freeAgency.pendingUserRfaDecision;
  const userOffers = Object.values(freeAgency.offers).filter((offer) => offer.teamId === currentTeamId);
  const roster = getCurrentTeamRoster(state);
  const filteredRoster = roster.filter((player) => matchesExpansionPosition(player, rosterPositionFilter));
  const rosterPositionCounts = getCurrentRosterPositionCounts(roster);
  const rosterPositionSummary = getCurrentRosterPositionSummary(roster);
  const selectedPlayer = selectedPlayerId ? state.players[selectedPlayerId] : undefined;
  const selectedPlayerTeamName = selectedPlayer && roster.some((player) => player.id === selectedPlayer.id)
    ? currentTeam.fullName
    : "自由球员";
  const offerPlayer = offerEditor ? state.players[offerEditor.playerId] : undefined;
  const offerDraft = offerEditor ? {
    years: offerEditor.years,
    year1Salary: offerEditor.year1Salary,
    annualRaiseRate: offerEditor.annualRaiseRate,
    finalYearOption: offerEditor.finalYearOption,
    guaranteedPercent: offerEditor.guaranteedPercent,
    rolePromised: offerEditor.rolePromised,
  } : undefined;
  const openOfferEditor = (playerId: string) => {
    const preview = getFreeAgentOfferPreview(state, playerId, currentTeamId);
    setOfferEditor({
      playerId,
      years: preview.draft.years,
      year1Salary: preview.draft.year1Salary,
      annualRaiseRate: preview.annualRaiseRate,
      finalYearOption: preview.finalYearOption,
      guaranteedPercent: preview.draft.guaranteedPercent,
      rolePromised: preview.draft.rolePromised,
    });
  };
  const normalizedSearch = searchQuery.trim().toLocaleLowerCase();
  const visiblePlayers = players
    .filter((player) => !normalizedSearch || `${player.name} ${playerNameZh(player.name, player.id)}`.toLocaleLowerCase().includes(normalizedSearch))
    .filter((player) => positionFilter === "ALL" || player.position === positionFilter || player.secondaryPosition === positionFilter)
    .map((player) => {
      const ability = Math.round(calculatePlayerOverall(player));
      const preview = getFreeAgentOfferPreview(state, player.id, currentTeamId);
      return { player, ability, preview, offer: preview.draft, id: player.id, age: player.age, suggestedSalary: preview.draft.year1Salary };
    })
    .sort((left, right) => compareFreeAgentCandidates(left, right, sortOption));
  const freeAgentPositionCounts = Object.fromEntries(EXPANSION_POSITION_FILTERS.map((position) => [
    position,
    players.filter((player) => position === "ALL" || player.position === position || player.secondaryPosition === position).length,
  ])) as Record<ExpansionPositionFilter, number>;
  const finance = getSeasonFinanceConfig(state.league.seasonYear);
  const capScaleMax = finance.secondApron;
  const capUsagePercent = Math.min(100, (sheet.total / capScaleMax) * 100);
  const capStatus = sheet.total >= finance.secondApron ? "第二土豪线以上" : sheet.total >= finance.firstApron ? "第一土豪线以上" : sheet.total >= finance.luxuryTaxLine ? "奢侈税线以上" : sheet.total >= finance.salaryCap ? "工资帽以上" : "工资帽以下";
  const capThresholds = [
    { key: "cap", label: "工资帽", value: finance.salaryCap },
    { key: "tax", label: "奢侈税线", value: finance.luxuryTaxLine },
    { key: "first", label: "第一土豪线", value: finance.firstApron },
    { key: "second", label: "第二土豪线", value: finance.secondApron },
  ];
  return (
    <section className="flow-card free-agency-terminal fa-reference-market reference-expansion-draft">
      <div className="fa-reference-scroll">
      <section className="fa-title-card"><div><h2>自由球员签约 <span>{state.league.seasonYear} 赛季</span></h2><p>可选择报价，也可直接进入季前调整</p></div><strong><small>休赛期名单</small>{roster.length} / {LEAGUE_FINANCE_CONFIG.rosterLimits.offseasonMaximum}</strong></section>
      {pending && <div className="rfa-decision"><b>请先处理受限自由球员报价单</b><span>{playerNameZh(state.players[pending.playerId].name, state.players[pending.playerId].id)} · 匹配截止：自由市场第 {pending.deadline} 天。继续推进市场前必须完成决定。</span></div>}
      <section className="draft-cap-dashboard" aria-label={`${currentTeam.fullName}薪资情况`}><header><span><span className="draft-team-mark">{currentTeam.logoUrl ? <img src={currentTeam.logoUrl} alt="" /> : currentTeam.abbreviation}</span><b>{currentTeam.fullName}</b></span><em>实时校验</em></header><div className="draft-cap-meter"><div className="draft-cap-meter-heading"><span>薪资进度</span><span>帽下空间 <b className={sheet.availableCapSpace < 0 ? "negative" : ""}>{money(sheet.availableCapSpace)}</b></span></div><div className="draft-cap-meter-track" role="progressbar" aria-label="球队工资帽占用" aria-valuemin={0} aria-valuemax={capScaleMax} aria-valuenow={Math.min(sheet.total, capScaleMax)}><span className="draft-cap-meter-fill" style={{ width: `${capUsagePercent}%` }} />{capThresholds.map((threshold) => <i key={threshold.key} className={`threshold-${threshold.key}`} style={{ left: `${(threshold.value / capScaleMax) * 100}%` }} aria-hidden="true" />)}</div><div className="draft-cap-meter-legend">{capThresholds.map((threshold) => <span className={`threshold-${threshold.key}`} key={threshold.key}><small>{threshold.label}</small><b>{money(threshold.value)}</b></span>)}</div><small className="draft-cap-status">{capStatus} · {sheet.availableCapSpace < finance.minimumSalary ? "帽下空间不足，普通自由球员报价不可提交" : "报价需同时满足名单名额与薪资空间"}</small></div></section>
      <details className="draft-current-roster-panel" open={rosterOpen} onToggle={(event) => setRosterOpen(event.currentTarget.open)} data-testid="free-agency-current-roster"><summary><span><span className="draft-team-mark">{currentTeam.logoUrl ? <img src={currentTeam.logoUrl} alt="" /> : currentTeam.abbreviation}</span><span><b>当前球队阵容</b><small>{roster.length} / {LEAGUE_FINANCE_CONFIG.rosterLimits.offseasonMaximum} 人 · {rosterOpen ? "报价后实时更新" : rosterPositionSummary}</small></span></span><em>{rosterOpen ? "收起阵容" : "展开阵容"}</em></summary><div className="draft-current-roster-body"><div className="draft-current-roster-filter" role="group" aria-label="按第一位置筛选当前阵容">{EXPANSION_POSITION_FILTERS.map((position) => { const count = position === "ALL" ? roster.length : rosterPositionCounts.find((entry) => entry.position === position)?.count ?? 0; return <button type="button" key={position} className={rosterPositionFilter === position ? "active" : ""} aria-pressed={rosterPositionFilter === position} onClick={() => setRosterPositionFilter(position)}><b>{position === "ALL" ? "全部" : position}</b><small>{count}</small></button>; })}</div>{roster.length > 0 ? <div className="draft-current-roster-grid">{filteredRoster.map((player) => <button type="button" data-testid={`free-agency-roster-player-${player.id}`} key={player.id} onClick={() => setSelectedPlayerId(player.id)}><span><b>{playerNameZh(player.name, player.id)}</b><small>{positionPairLabel(player.position, player.secondaryPosition)} · 年薪 {money(player.contract.salary)}</small></span><em className="player-rating-tone" style={playerRatingStyle(calculatePlayerOverall(player))}><small>OVR</small>{calculatePlayerOverall(player).toFixed(0)}</em></button>)}{filteredRoster.length === 0 && <div className="draft-current-roster-empty"><b>该位置暂无球员</b><span>请选择其他第一位置查看阵容。</span></div>}</div> : <div className="draft-current-roster-empty"><b>当前阵容暂无球员</b><span>完成签约后，球员会显示在这里。</span></div>}</div></details>
      <div className="fa-notice"><b>名单规则</b><span>休赛期 {roster.length}/{LEAGUE_FINANCE_CONFIG.rosterLimits.offseasonMaximum} · 开季上限 {LEAGUE_FINANCE_CONFIG.rosterLimits.regularSeasonMaximum}{roster.length > LEAGUE_FINANCE_CONFIG.rosterLimits.regularSeasonMaximum ? ` · 需调整 ${roster.length - LEAGUE_FINANCE_CONFIG.rosterLimits.regularSeasonMaximum} 人` : ""}</span></div>
      {freeAgency.transactionLog.length > 0 && <div className="transaction-feed"><b>联盟动态</b>{freeAgency.transactionLog.slice(0, 5).map((entry, index) => <span key={`${index}-${entry}`}>{localizePlayerNamesInText(freeAgencyTransactionLabel(entry), Object.values(state.players))}</span>)}</div>}
      <div className="fa-market-heading"><div><b>自由球员列表</b><small>({visiblePlayers.length}/{players.length} 人)</small></div></div>
      <PlayerListFilters ariaLabel="筛选自由球员" searchValue={searchQuery} onSearchChange={setSearchQuery} sortValue={sortOption} onSortChange={setSortOption} sortOptions={FREE_AGENT_SORT_OPTIONS} positionValue={positionFilter} onPositionChange={setPositionFilter} positionCounts={freeAgentPositionCounts} testIdPrefix="free-agent" />
      <div className="free-agency-player-list fa-reference-player-list">{visiblePlayers.length === 0 ? <div className="fa-empty">当前筛选条件下暂无可用自由球员</div> : visiblePlayers.map(({ player, ability, preview, offer }) => {
        const market = freeAgency.markets[player.id];
        const submittedOffer = market?.marketWindowStatus === "OPEN"
          ? userOffers.filter((offer) => offer.playerId === player.id
            && offer.createdDay >= market.marketWindowStartDay
            && offer.status !== "WITHDRAWN")
            .sort((left, right) => right.createdDay - left.createdDay || right.offerId.localeCompare(left.offerId))[0]
          : undefined;
        const existing = submittedOffer?.status === "ACTIVE" ? submittedOffer : undefined;
        const previouslyRejected = !submittedOffer && market?.marketWindowStatus === "CLOSED_NO_SIGNING"
          && userOffers.some((offer) => offer.playerId === player.id && offer.status === "REJECTED");
        const structurallyBlocked = ["球队名单已满", "球员已不在自由市场", "RFA 正在等待原球队匹配", "原球队不能提交 RFA 报价单", "自由市场尚未开启"].includes(preview.reason ?? "");
        const waitingForFirstOffer = !existing && !preview.reason && market?.marketWindowStatus !== "OPEN";
        const resolvedOfferStatus = submittedOffer?.status === "REJECTED"
          ? "报价已被拒绝"
          : submittedOffer?.status === "EXPIRED" ? "报价已到期" : undefined;
        const statusText = existing
          ? `等待决定 · 签约意愿 ${existing.utility.toFixed(0)}/100 · 第 ${market?.decisionDeadline ?? existing.expiresDay} 天截止`
          : resolvedOfferStatus
            ? `${resolvedOfferStatus} · 第 ${market?.decisionDeadline ?? submittedOffer?.expiresDay} 天截止`
            : preview.reason ?? (previouslyRejected ? "此前报价被拒绝，可调整条件重新报价" : market?.marketWindowStatus === "OPEN" ? `第 ${market.decisionDeadline} 天截止` : "等待首份报价");
        return <article className="fa-reference-player-card" key={player.id} role="button" tabIndex={0} aria-label={`查看${playerNameZh(player.name, player.id)}球员详情`} onClick={(event) => { if ((event.target as HTMLElement).closest("button")) return; setSelectedPlayerId(player.id); }} onKeyDown={(event) => { if (event.key !== "Enter" && event.key !== " ") return; event.preventDefault(); setSelectedPlayerId(player.id); }}>
          <div className="fa-player-copy">
            <div className="fa-player-name"><b>{playerNameZh(player.name, player.id)}</b><em>{positionPairLabel(player.position, player.secondaryPosition)}</em></div>
            <small className="fa-player-meta-line"><span className={`fa-status-badge ${player.contract.status.toLowerCase()}`} title={player.contract.status === "RFA" ? "受限制自由球员：原球队拥有报价匹配权" : "完全自由球员：签约不受原球队匹配限制"}><strong>{player.contract.status}</strong></span><i>·</i><span><strong>{player.age}岁</strong></span><i>·</i><span className="fa-player-contract-summary" title={`${submittedOffer ? "报价首年" : "当前要价"} ${money(submittedOffer?.year1Salary ?? offer.year1Salary)} · ${submittedOffer?.years ?? offer.years} 年`}>{submittedOffer ? "报价首年" : "当前要价"} <strong className="cyan">{money(submittedOffer?.year1Salary ?? offer.year1Salary)}</strong> · {submittedOffer?.years ?? offer.years} 年</span></small>
            <small className="fa-player-value-line">参考估值 {money(getProjectedMarketSalary(player, state.league.seasonYear))}{submittedOffer && ` · 当前要价 ${money(getCurrentFreeAgentAsk(state, player))}`}</small>
            <small className={`fa-player-status-line deadline${waitingForFirstOffer ? " waiting-first-offer" : ""}${!existing && preview.reason ? " blocked" : ""}`} title={statusText}>{statusText}</small>
          </div>
          <span className="fa-player-ovr" aria-label={`OVR ${ability}`}><small>OVR</small><strong className="player-rating-tone" style={playerRatingStyle(ability)}>{ability}</strong></span>
          {existing
            ? <button className="withdraw" disabled={busy} onClick={() => onFreeAgencyCommand({ commandId: `withdraw-${existing.offerId}`, type: "WITHDRAW_FA_OFFER", payload: { offerId: existing.offerId } })}>撤回</button>
            : submittedOffer
              ? <button className="withdraw" disabled>{submittedOffer.status === "EXPIRED" ? "已到期" : "已拒绝"}</button>
              : <button className="fa-offer-button" data-testid={`open-fa-offer-${player.id}`} title={structurallyBlocked ? preview.reason : "查看并编辑合同报价"} disabled={busy || structurallyBlocked} onClick={() => openOfferEditor(player.id)}>{structurallyBlocked ? preview.reason === "球队名单已满" ? "名单已满" : "暂不可报价" : previouslyRejected ? "重新报价" : "发起报价"}</button>}
        </article>;
      })}</div>
      {selectedPlayer && <div className="player-detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedPlayerId(null); }}><section className="reference-player-dialog" role="dialog" aria-modal="true" aria-label={`${playerNameZh(selectedPlayer.name, selectedPlayer.id)} 球员详情`}><button className="detail-close" type="button" onClick={() => setSelectedPlayerId(null)} aria-label="关闭球员详情">×</button><ReferencePlayerCard player={selectedPlayer} teamName={selectedPlayerTeamName} /></section></div>}
      {offerEditor && offerPlayer && offerDraft && <FreeAgentOfferDialog
        state={state}
        playerId={offerPlayer.id}
        draft={offerDraft}
        busy={busy}
        onChange={(patch) => setOfferEditor((current) => current ? { ...current, ...patch } : current)}
        onClose={() => setOfferEditor(null)}
        onSubmit={() => { void onFreeAgencyCommand({ commandId: freeAgencyOfferCommandId(state, offerPlayer.id), type: "SUBMIT_FA_OFFER", payload: { playerId: offerPlayer.id, ...offerDraft } }).then(() => setOfferEditor(null)); }}
      />}
      </div>
      {pending && <div className="fa-settle-footer"><div><b>受限自由球员待决定</b><small>{playerNameZh(state.players[pending.playerId].name, state.players[pending.playerId].id)} · 匹配截止：自由市场第 {pending.deadline} 天。继续推进市场前必须完成决定。</small></div><div className="fa-settle-actions"><button disabled={busy} onClick={() => onFreeAgencyCommand({ commandId: `rfa-match-${pending.offerId}`, type: "RESOLVE_USER_RFA", payload: { decision: "MATCH" } })}>匹配</button><button className="decline" disabled={busy} onClick={() => onFreeAgencyCommand({ commandId: `rfa-decline-${pending.offerId}`, type: "RESOLVE_USER_RFA", payload: { decision: "DECLINE" } })}>放弃</button></div></div>}
    </section>
  );
}
