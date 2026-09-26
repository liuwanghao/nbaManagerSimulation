import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LEAGUE_FINANCE_CONFIG } from "../config/leagueFinance";
import { getCapSheet } from "../game/cap/CapSheetService";
import { getAvailableDraftProspects, getNextAiDraftProspect, type DraftCommand } from "../game/draft/DraftService";
import { getFreeAgents, getFreeAgentOfferPreview, getPendingUserQualifyingOfferPlayers, type FreeAgencyCommand } from "../game/freeAgency/FreeAgencyService";
import { getQualifyingOfferAmount } from "../game/contracts/ContractRules";
import { evaluateTradeOffer, type TradeCommand } from "../game/trade/TradeService";
import type { RosterCommand } from "../game/roster/RosterService";
import type { ContractYearOption, GameState, Player, PromisedRole, TrainingFocus } from "../game/state/types";
import type { ContractLifecycleCommand } from "../game/contracts/ContractLifecycleService";
import { calculatePlayerOverall } from "../game/player/PlayerRatingService";
import { BALANCE_CONFIG } from "../config/balanceConfig";
import { GameChrome } from "./GameChrome";
import { getTeamInboxItems } from "../game/notifications/TeamNotificationService";
import { contractStatusLabel, humanizeUiText, measurementLabel, moneyLabel, phaseLabel, positionLabel, positionPairLabel, slotLabel } from "./uiText";
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
import { TRADE_ASSET_POSITIONS, tradeAssetPositionCounts, tradeInquiryCommandId, tradePickLabel, type TradeAssetPosition } from "./tradeView";
import { getRewardVideoBridge, runRewardedAction, watchRewardVideo } from "./rewardVideo";
import { FreeAgentOfferDialog } from "./FreeAgentOfferDialog";

interface Stage4FlowProps {
  state: GameState;
  busy: boolean;
  status: string;
  onCommand: (command: DraftCommand) => Promise<void>;
  onContractCommand: (command: ContractLifecycleCommand) => Promise<void>;
  onFreeAgencyCommand: (command: FreeAgencyCommand) => Promise<void>;
  onTradeCommand: (command: TradeCommand) => Promise<void>;
  onRosterCommand: (command: RosterCommand) => Promise<void>;
  onSave: (slot?: 1 | 2 | 3) => Promise<void>;
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
  { value: "SALARY_DESC", label: "建议年薪", direction: "高→低" },
  { value: "SALARY_ASC", label: "建议年薪", direction: "低→高" },
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
    <main className={`app-shell expansion-shell${spotlightPhase ? " scene-stage" : ""}${rookieDraftScreen ? " rookie-draft-shell" : ""}${offseasonTerminalScreen ? " stage4-terminal-shell" : ""}`}>
      <GameChrome phase={phase} busy={busy} onSave={onSave} onLoad={onLoad} onLoadLatest={onLoadLatest} activeSlot={activeSlot} saveSlots={saveSlots} onSlotChange={onSlotChange} onHome={onHome} initialDrawerTab={initialDrawerTab} notifications={getTeamInboxItems(state)} players={Object.values(state.players)} onMarkNotificationsRead={onMarkNotificationsRead} onHandlePendingNotification={(item) => { if (item.id.startsWith("action-rfa-")) document.querySelector(".fa-settle-footer")?.scrollIntoView({ behavior: "smooth", block: "center" }); }} />
      <header className="stage-header">
        <div><span className="section-kicker">扩军时代 · 第四阶段</span><h1>经理系统</h1></div>
        <span className="phase-pill">{phaseLabel(phase)}</span>
      </header>
      <section className="status-strip" aria-live="polite"><span className={busy ? "pulse-dot active" : "pulse-dot"} />{localizePlayerNamesInText(status, Object.values(state.players))}</section>
      {phase === "OPTION_PHASE" && <OptionPhase state={state} busy={busy} onContractCommand={onContractCommand} />}
      {["ROOKIE_DRAFT_PENDING", "OFFSEASON_PRE_DRAFT"].includes(phase) && <DraftIntroduction state={state} busy={busy} onCommand={onCommand} />}
      {phase === "DRAFT" && <DraftBoard state={state} busy={busy} onCommand={onCommand} />}
      {phase === "OFFSEASON_POST_DRAFT" && <PostDraftHub state={state} busy={busy} onFreeAgencyCommand={onFreeAgencyCommand} onRosterCommand={onRosterCommand} />}
      {phase === "PRESEASON" && <RosterLock state={state} busy={busy} onRosterCommand={onRosterCommand} />}
      <footer>
        <label className="slot-picker">存档<select disabled={busy} value={activeSlot} onChange={(event) => onSlotChange(Number(event.target.value) as 1 | 2 | 3)}><option value={1}>{slotLabel(1)}</option><option value={2}>{slotLabel(2)}</option><option value={3}>{slotLabel(3)}</option></select></label>
        <button className="footer-action" disabled={busy} onClick={() => void onSave()}>保存{slotLabel(activeSlot)}</button>
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

function DraftIntroduction({ state, busy, onCommand }: Pick<Stage4FlowProps, "state" | "busy" | "onCommand">) {
  const firstDraft = state.league.seasonYear === 2026;
  const packageId = state.expansion?.rightsDraw.packageByTeam[state.userTeamId as "SEA" | "LVG"];
  const packageConfig = packageId ? BALANCE_CONFIG.expansion.package[packageId] : undefined;
  const firstPick = packageConfig?.rookieDraftPick;
  const secondPick = firstPick ? firstPick + Object.keys(state.teams).length : undefined;
  const pickCount = Object.keys(state.teams).length * BALANCE_CONFIG.draft.rounds;
  return (
    <section className="flow-card draft-intro-card rookie-draft-prep-terminal">
      {state.league.currentPhase === "ROOKIE_DRAFT_PENDING" && state.expansion?.finalized && <ExpansionDraftRecap state={state} />}
      <header className="draft-prep-hero">
        <span className="draft-prep-tag">准备阶段</span>
        <span className="draft-prep-kicker">01 / {state.league.seasonYear} 年新秀选秀</span>
        <h2>{firstDraft ? "首届" : "新赛季"} {Object.keys(state.teams).length} 队新秀选秀</h2>
        <p>{firstDraft ? "载入真实 2026 选秀结果；扩军球队截胡后，其他球队会按剩余真实榜单顺延补位。" : `使用可复现的程序化 ${state.league.seasonYear} 年选秀班，完成两轮新秀选择。`}</p>
      </header>
      <SectionBar title="选秀概览" meta={`${BALANCE_CONFIG.draft.rounds} 轮 · ${Object.keys(state.teams).length} 支球队`} />
      <div className="draft-prep-metrics">
        <span><b>{BALANCE_CONFIG.draft.classSize}</b><small>选秀球员</small></span><span><b>{pickCount}</b><small>总签位</small></span>
        {firstDraft ? <><span><b>#{firstPick ?? "—"}</b><small>你的首轮</small></span><span><b>#{secondPick ?? "—"}</b><small>你的次轮</small></span></> : <><span><b>{BALANCE_CONFIG.draft.lotteryDrawCount}</b><small>乐透签位</small></span><span><b>{Math.min(Object.keys(state.teams).length, BALANCE_CONFIG.draft.lotteryWeights.length)}</b><small>乐透球队</small></span></>}
      </div>
      <div className="draft-terminal-info"><span>i</span><p><b>{firstDraft ? "真实结果与截胡规则" : "球探信息保护"}</b>{firstDraft ? "普通球队优先选择现实中的目标新秀；目标已被选走时，从仍可选的真实榜单中顺延，所有球员全联盟唯一归属。" : "界面只显示潜力评级与球探置信度，隐藏真实潜力。"}</p></div>
      <button className="draft-terminal-cta" disabled={busy} onClick={() => onCommand({ commandId: `prepare-rookie-draft-${state.league.seasonId}`, type: "PREPARE_ROOKIE_DRAFT", payload: {} })}>{firstDraft ? "确认名单并进入新秀选秀大厅" : "生成选秀班并进入选秀大厅"}<span>▶</span></button>
    </section>
  );
}

function OptionPhase({ state, busy, onContractCommand }: Pick<Stage4FlowProps, "state" | "busy" | "onContractCommand">) {
  const lifecycle = state.contractLifecycle;
  const playerLifecycle = state.playerLifecycle;
  const pending = lifecycle?.pendingUserTeamOptionPlayerIds.map((id) => state.players[id]) ?? [];
  return <section className="flow-card prototype-extended-flow option-phase-screen">
    <FlowHeading step="00 / 联盟年度结算" title={`${state.league.seasonId} 合同选项`} description="球员选项与电脑球队选项已结算，请处理本队球队选项。" badge={`${pending.length} 项待处理`} icon="✓" />
    <SectionBar title="年度球员变化" meta="联盟结算完成" />
    {playerLifecycle && <div className="metrics-row"><span><b>{playerLifecycle.developedPlayerIds.length}</b>成长</span><span><b>{playerLifecycle.regressedPlayerIds.length}</b>衰退</span><span><b>{playerLifecycle.trainedPlayerIds.length}</b>重点培养</span><span><b>{playerLifecycle.retirementOutflow}</b>退役</span><span><b>{playerLifecycle.averageOverallBefore.toFixed(1)} → {playerLifecycle.averageOverallAfter.toFixed(1)}</b>联盟均值</span></div>}
    <SectionBar title="球队选项" meta={pending.length ? `还需决定 ${pending.length} 人` : "已全部处理"} />
    <div className="player-pool prototype-decision-list">{pending.map((player) => <article className="player-row" key={player.id}>
      <span className="source-mark">队选</span><div><b>{playerNameZh(player.name, player.id)}</b><small>{positionLabel(player.position)} · {money(player.contract.salary)} · {player.contract.yearsRemaining} 年</small></div>
      <span className="offer-actions"><button data-testid="option-pickup" disabled={busy} onClick={() => onContractCommand({ commandId: `team-option-pick-${state.league.seasonId}-${player.id}`, type: "RESOLVE_TEAM_OPTION", payload: { playerId: player.id, decision: "PICK_UP" } })}>执行</button><button className="decline" disabled={busy} onClick={() => onContractCommand({ commandId: `team-option-decline-${state.league.seasonId}-${player.id}`, type: "RESOLVE_TEAM_OPTION", payload: { playerId: player.id, decision: "DECLINE" } })}>放弃</button></span>
    </article>)}</div>
    {pending.length === 0 && <div className="prototype-info-note success"><span>✓</span><p><b>所有决定已完成</b>可以进入选秀前休赛期。</p></div>}
    {lifecycle?.transactionLog.length ? <div className="transaction-feed"><b>合同动态</b>{lifecycle.transactionLog.slice(-6).reverse().map((entry, index) => <span key={`${index}-${entry}`}>{localizePlayerNamesInText(humanizeUiText(entry), Object.values(state.players))}</span>)}</div> : null}
    <div className="prototype-sticky-action"><button data-testid="option-finalize" className="primary-cta" disabled={busy || pending.length > 0} onClick={() => onContractCommand({ commandId: `finalize-options-${state.league.seasonId}`, type: "FINALIZE_OPTION_PHASE", payload: {} })}>完成选项阶段并进入休赛期 →</button></div>
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
    <main className="gemini-draft-main"><div className="gemini-filter"><div className="gemini-list-heading"><b>候选新秀（{filteredProspects.length} 人）</b><span>按预测顺位排序</span></div><div className="gemini-tabs">{(["ALL", "PG", "SG", "SF", "PF", "C"] as const).map((filter) => <button key={filter} className={positionFilter === filter ? "active" : ""} onClick={() => setPositionFilter(filter)}>{filter === "ALL" ? "全部" : filter}</button>)}</div></div><div className="gemini-prospect-list">{filteredProspects.map((player) => { const rank = prospects.findIndex((candidate) => candidate.id === player.id) + 1; return <article key={player.id} className={`gemini-prospect-card${player.id === exitingPlayerId ? " drafted-out" : ""}`} onClick={() => setSelectedProspectId(player.id)} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setSelectedProspectId(player.id); }}><div className="gemini-prospect-rank">#{rank}</div><PlayerPortrait player={player} portraitPath={state.players[player.id]?.portraitPath} /><div className="gemini-prospect-copy"><b>{playerNameZh(player.name, player.id)}</b><small>{positionPairLabel(player.position, player.secondaryPosition)} · {player.age} 岁 · {measurementLabel(player.heightCm, "cm")}</small><div className="gemini-scout-bar"><span style={{ width: `${Math.min(100, (player.scoutingConfidence ?? 0))}%` }} /><em>球探置信度 {player.scoutingConfidence ?? "—"}%</em></div></div><div className="gemini-prospect-grade"><b>{player.scoutedPotentialGrade ?? "—"}</b><small>潜力</small></div><button className={playerTurn ? "active" : ""} disabled={busy || !playerTurn} onClick={(event) => { event.stopPropagation(); void commitPick(player.id); }}>{playerTurn ? "选中球员" : "等待"}</button></article>; })}</div></main>
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
        <button type="button" className="fa-market-settle-button" disabled={busy || hasPendingRfaDecision} onClick={() => onFreeAgencyCommand({ commandId: `fa-day-${state.league.seasonId}-${freeAgency.currentDay}`, type: "ADVANCE_FA_DAY", payload: {} })}><small>{hasPendingRfaDecision ? "请先处理 RFA" : `第 ${freeAgency.currentDay} 天`}</small><strong>{busy ? "结算中…" : "结算今日"}</strong></button>
        <button type="button" className="terminal-primary-button" disabled={busy || hasPendingRfaDecision} onClick={() => onRosterCommand({ commandId: `close-free-agency-${state.league.seasonId}`, type: "CLOSE_FREE_AGENCY", payload: {} })}>{pendingUserOffers ? `结束市场并撤回 ${pendingUserOffers} 份待定报价` : "结束市场，进入季前调整"} ➔</button>
      </div>
    </section>;
  }
  const draft = state.rookieDraft;
  const team = state.teams[state.userTeamId];
  const sheet = getCapSheet(state, state.userTeamId);
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
        <div><small>工资帽</small><b>{money(LEAGUE_FINANCE_CONFIG.salaryCap)}</b></div>
        <div><small>薪资表</small><b>{money(sheet.total)}</b></div>
        <div><small>可用空间</small><b className={sheet.availableCapSpace < 0 ? "negative" : ""}>{money(sheet.availableCapSpace)}</b></div>
        <div><small>休赛期名单</small><b>{team.playerIds.length} / {LEAGUE_FINANCE_CONFIG.rosterLimits.offseasonMaximum}</b></div>
      </div>
      {pendingQualifyingOffers.length > 0 && <section className="qualifying-offer-panel" aria-labelledby="qualifying-offer-title">
        <header><div><small>RFA RIGHTS</small><h3 id="qualifying-offer-title">资质报价决策</h3></div><b>{pendingQualifyingOffers.length} 人待处理</b></header>
        <p>提交资质报价可保留匹配权；不提交则球员转为 UFA，但已有 Bird Rights 与对应 Cap Hold 仍保留。</p>
        <div>{pendingQualifyingOffers.map((player) => <article key={player.id}>
          <span><b>{playerNameZh(player.name, player.id)}</b><small>{positionPairLabel(player.position, player.secondaryPosition)} · OVR {calculatePlayerOverall(player).toFixed(0)} · QO {money(getQualifyingOfferAmount(player))}</small></span>
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
  const [assetDrawerOpen, setAssetDrawerOpen] = useState(false);
  const [assetPositionFilter, setAssetPositionFilter] = useState<TradeAssetPosition>("ALL");
  const [inquiryPlayerId, setInquiryPlayerId] = useState<string | null>(null);
  const [inquiryMessage, setInquiryMessage] = useState<string | null>(null);
  const inquiryInProgress = useRef(false);
  const [detailOfferId, setDetailOfferId] = useState<string | null>(null);
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);
  const refreshInProgress = useRef(false);
  const roster = state.teams[state.userTeamId].playerIds.map((id) => state.players[id]).filter(Boolean).sort((a, b) => b.contract.salary - a.contract.salary);
  const assetPositionCounts = tradeAssetPositionCounts(roster);
  const visibleAssets = assetPositionFilter === "ALL" ? roster : roster.filter((player) => player.position === assetPositionFilter);
  const selected = state.tradeDesk.selectedPlayerId;
  const selectedAvailable = Boolean(selected && roster.some((player) => player.id === selected));
  const selectedPlayer = selectedAvailable && selected ? state.players[selected] : null;
  const displayedPlayer = inquiryPlayerId ? state.players[inquiryPlayerId] : selectedPlayer;
  const requestOffers = (playerId: string, refresh: boolean) => onTradeCommand({ commandId: tradeInquiryCommandId(state, playerId), type: "GENERATE_TRADE_OFFERS", payload: { playerId, refresh } });
  const selectAsset = async (playerId: string) => {
    if (inquiryInProgress.current || busy) return;
    inquiryInProgress.current = true;
    setAssetDrawerOpen(false);
    setInquiryPlayerId(playerId);
    setInquiryMessage(null);
    try {
      await requestOffers(playerId, false);
    } catch {
      setInquiryMessage("询价失败，请重新选择球员。");
    } finally {
      inquiryInProgress.current = false;
      setInquiryPlayerId(null);
    }
  };
  const offers = selectedAvailable ? state.tradeDesk.offers.flatMap((offer) => {
    const incoming = state.players[offer.userIncomingPlayerIds[0]];
    if (!incoming) return [];
    const evaluation = evaluateTradeOffer(state, offer.offerId);
    return [{ offer, incoming, evaluation }];
  }) : [];
  const detail = offers.find(({ offer }) => offer.offerId === detailOfferId) ?? null;
  const closePanel = (target: HTMLElement) => target.closest("details")?.removeAttribute("open");
  const refreshOffers = async () => {
    if (refreshInProgress.current || busy || !selectedAvailable || !selected) return;
    refreshInProgress.current = true;
    setRefreshBusy(true);
    setRefreshMessage(null);
    try {
      const reward = await runRewardedAction(getRewardVideoBridge(), () => requestOffers(selected, true));
      if (!reward.rewarded) {
        setRefreshMessage(reward.message ?? "激励视频未完成，报价保持不变。");
      }
    } catch {
      setRefreshMessage("报价刷新失败，请稍后再试。");
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
      <section className="trade-console-card trade-asset-card"><div className="trade-console-card-heading"><b><em className="trade-step">01</em> 选择我方筹码</b><span>{inquiryPlayerId ? "询价中" : selectedPlayer ? "1 个筹码" : "未选择"}</span></div>
        <button className="trade-asset-trigger" type="button" disabled={busy || Boolean(inquiryPlayerId)} onClick={() => setAssetDrawerOpen(true)}>{displayedPlayer ? <PlayerPortrait player={displayedPlayer} portraitPath={displayedPlayer.portraitPath} className="trade-avatar" /> : <span className="trade-avatar">?</span>}<span className="trade-asset-copy">{displayedPlayer ? <><b>{playerNameZh(displayedPlayer.name, displayedPlayer.id)} <em className="player-rating-tone" style={playerRatingStyle(calculatePlayerOverall(displayedPlayer))}>{calculatePlayerOverall(displayedPlayer).toFixed(0)} OVR</em></b><small>{positionPairLabel(displayedPlayer.position, displayedPlayer.secondaryPosition)} · 合同剩余 {displayedPlayer.contract.yearsRemaining} 年</small><strong>{money(displayedPlayer.contract.salary)} / 年</strong></> : <b>选择我方交易筹码</b>}</span><strong className="trade-asset-change">{inquiryPlayerId ? "询价中…" : "更换筹码　›"}</strong></button>
      </section>
      <section className="trade-console-offers"><div className="trade-console-offer-heading"><b><em className="trade-step">02</em> 系统询价回应 <span>{inquiryPlayerId ? "匹配中" : `${offers.length} 个方案`}</span></b></div>
        {inquiryPlayerId ? <div className="trade-console-loading" role="status" aria-live="polite"><b>正在向联盟球队询价…</b><small>核对筹码价值、薪资规则与球队需求，寻找可行报价。</small>{[0, 1, 2].map((index) => <div className="trade-console-loading-card" key={index} aria-hidden="true"><i /><span><i /><i /></span><i /></div>)}</div> : <div className="trade-console-offer-list">{offers.map(({ offer, incoming, evaluation }) => <button type="button" className="trade-console-offer-card" key={offer.offerId} onClick={() => setDetailOfferId(offer.offerId)}><PlayerPortrait player={incoming} portraitPath={incoming.portraitPath} className="trade-avatar" /><span className="trade-offer-copy"><b>{playerNameZh(incoming.name, incoming.id)} <em>{positionLabel(incoming.position)}</em></b><small><strong className="player-rating-tone" style={playerRatingStyle(calculatePlayerOverall(incoming))}>{calculatePlayerOverall(incoming).toFixed(0)} OVR</strong> · {money(incoming.contract.salary)}</small><small>{state.teams[offer.counterpartyTeamId].fullName}</small>{offer.userIncomingPickIds.length > 0 && <small className="trade-offer-picks">附带 {offer.userIncomingPickIds.map((id) => tradePickLabel(state, id)).join("、")}</small>}</span><span className="trade-offer-fit"><b className={evaluation.userFitDelta >= 0 ? "positive" : "negative"}>适配 {evaluation.userFitDelta >= 0 ? "+" : ""}{evaluation.userFitDelta.toFixed(1)}</b><small>{evaluation.legal ? "查看方案 ›" : "方案失效 ›"}</small></span></button>)}{offers.length === 0 && <div className="trade-console-empty">选择本队球员并发起询价后，系统方案将在这里显示</div>}</div>}
        {inquiryMessage && <p className="trade-inquiry-message" role="alert">{inquiryMessage}</p>}
        <div className="trade-refresh-action"><button data-testid="trade-refresh" type="button" disabled={busy || refreshBusy || Boolean(inquiryPlayerId) || !selectedAvailable} onClick={() => void refreshOffers()}><span>刷新报价</span><small>{refreshBusy ? "激励视频播放中…" : "观看激励视频"}</small></button><p role="status" aria-live="polite">{refreshMessage ?? "完播后才会生成新的报价；当前方案会保留至刷新成功。"}</p></div>
      </section>
    </div>
    {assetDrawerOpen && <div className="trade-console-sheet-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setAssetDrawerOpen(false)}>
      <section className="trade-console-sheet" role="dialog" aria-modal="true" aria-label="选择我方交易筹码">
        <header><div><b>选择我方筹码</b></div><button type="button" aria-label="关闭筹码选择" onClick={() => setAssetDrawerOpen(false)}>✕</button></header>
        <div className="trade-asset-roster-summary"><b>本队 {roster.length} 人</b><small>按主位置统计，每名球员只计入一个位置</small></div>
        <div className="trade-asset-position-tabs" role="group" aria-label="按主位置筛选交易筹码">{TRADE_ASSET_POSITIONS.map((position) => <button type="button" key={position} aria-pressed={assetPositionFilter === position} className={assetPositionFilter === position ? "selected" : ""} onClick={() => setAssetPositionFilter(position)}><b>{position === "ALL" ? "全部" : position}</b><small>{assetPositionCounts[position]}</small></button>)}</div>
        <div className="trade-asset-options">{visibleAssets.map((player) => <button type="button" className={`trade-asset-option${player.id === selected ? " active" : ""}`} key={player.id} onClick={() => void selectAsset(player.id)}><PlayerPortrait player={player} portraitPath={player.portraitPath} className="trade-avatar" /><span><b>{playerNameZh(player.name, player.id)} <em className="player-rating-tone" style={playerRatingStyle(calculatePlayerOverall(player))}>{calculatePlayerOverall(player).toFixed(0)} OVR</em></b><small>{positionPairLabel(player.position, player.secondaryPosition)} · {money(player.contract.salary)} / 年</small></span>{player.id === selected && <strong>✓ 已选</strong>}</button>)}{visibleAssets.length === 0 && <p className="trade-console-empty">这个位置目前没有球员。</p>}</div>
      </section>
    </div>}
    {detail && selectedPlayer && <TradeOfferDetail
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
  const assignments = state.trainingPlan?.seasonId === state.league.seasonId ? state.trainingPlan.assignments : {};
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
      return <button type="button" role="menuitemradio" aria-checked={selected} key={value ?? "none"} className={selected ? "selected" : ""} disabled={busy || (value !== null && (focusPickerPlayer.age + 1 >= 30 || (!assignments[focusPickerPlayer.id] && focusedCount >= BALANCE_CONFIG.training.maxFocusedPlayers)))} onClick={() => { closeFocusPicker(); if (selected) return; void onRosterCommand({ commandId: `training-${state.league.seasonId}-${focusPickerPlayer.id}-${value ?? "none"}`, type: "SET_TRAINING_FOCUS", payload: { playerId: focusPickerPlayer.id, focus: value } }); }}><span><b>{label}</b><small>{value !== null && focusPickerPlayer.age + 1 >= 30 ? "预计结算时已满 30 岁，此方向不会提供加成" : description}</small></span>{selected && <strong>✓</strong>}</button>;
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
  const capScaleMax = LEAGUE_FINANCE_CONFIG.secondApron;
  const capUsagePercent = Math.min(100, (sheet.total / capScaleMax) * 100);
  const capStatus = sheet.total >= LEAGUE_FINANCE_CONFIG.secondApron ? "第二土豪线以上" : sheet.total >= LEAGUE_FINANCE_CONFIG.firstApron ? "第一土豪线以上" : sheet.total >= LEAGUE_FINANCE_CONFIG.luxuryTaxLine ? "奢侈税线以上" : sheet.total >= LEAGUE_FINANCE_CONFIG.salaryCap ? "工资帽以上" : "工资帽以下";
  const capThresholds = [
    { key: "cap", label: "工资帽", value: LEAGUE_FINANCE_CONFIG.salaryCap },
    { key: "tax", label: "奢侈税线", value: LEAGUE_FINANCE_CONFIG.luxuryTaxLine },
    { key: "first", label: "第一土豪线", value: LEAGUE_FINANCE_CONFIG.firstApron },
    { key: "second", label: "第二土豪线", value: LEAGUE_FINANCE_CONFIG.secondApron },
  ];
  return (
    <section className="flow-card free-agency-terminal fa-reference-market reference-expansion-draft">
      <div className="fa-reference-scroll">
      <section className="fa-title-card"><div><h2>自由球员签约 <span>{state.league.seasonYear} 赛季</span></h2><p>可选择报价，也可直接进入季前调整</p></div><strong><small>休赛期名单</small>{roster.length} / {LEAGUE_FINANCE_CONFIG.rosterLimits.offseasonMaximum}</strong></section>
      {pending && <div className="rfa-decision"><b>请先处理受限自由球员报价单</b><span>{playerNameZh(state.players[pending.playerId].name, state.players[pending.playerId].id)} · 第 {pending.deadline} 天截止</span></div>}
      <section className="draft-cap-dashboard" aria-label={`${currentTeam.fullName}薪资情况`}><header><span><span className="draft-team-mark">{currentTeam.logoUrl ? <img src={currentTeam.logoUrl} alt="" /> : currentTeam.abbreviation}</span><b>{currentTeam.fullName}</b></span><em>实时校验</em></header><div className="draft-cap-meter"><div className="draft-cap-meter-heading"><span>薪资进度</span><span>帽下空间 <b className={sheet.availableCapSpace < 0 ? "negative" : ""}>{money(sheet.availableCapSpace)}</b></span></div><div className="draft-cap-meter-track" role="progressbar" aria-label="球队工资帽占用" aria-valuemin={0} aria-valuemax={capScaleMax} aria-valuenow={Math.min(sheet.total, capScaleMax)}><span className="draft-cap-meter-fill" style={{ width: `${capUsagePercent}%` }} />{capThresholds.map((threshold) => <i key={threshold.key} className={`threshold-${threshold.key}`} style={{ left: `${(threshold.value / capScaleMax) * 100}%` }} aria-hidden="true" />)}</div><div className="draft-cap-meter-legend">{capThresholds.map((threshold) => <span className={`threshold-${threshold.key}`} key={threshold.key}><small>{threshold.label}</small><b>{money(threshold.value)}</b></span>)}</div><small className="draft-cap-status">{capStatus} · {sheet.availableCapSpace < LEAGUE_FINANCE_CONFIG.minimumSalary ? "帽下空间不足，普通自由球员报价不可提交" : "报价需同时满足名单名额与薪资空间"}</small></div></section>
      <details className="draft-current-roster-panel" open={rosterOpen} onToggle={(event) => setRosterOpen(event.currentTarget.open)} data-testid="free-agency-current-roster"><summary><span><span className="draft-team-mark">{currentTeam.logoUrl ? <img src={currentTeam.logoUrl} alt="" /> : currentTeam.abbreviation}</span><span><b>当前球队阵容</b><small>{roster.length} / {LEAGUE_FINANCE_CONFIG.rosterLimits.offseasonMaximum} 人 · {rosterOpen ? "报价后实时更新" : rosterPositionSummary}</small></span></span><em>{rosterOpen ? "收起阵容" : "展开阵容"}</em></summary><div className="draft-current-roster-body"><div className="draft-current-roster-filter" role="group" aria-label="按第一位置筛选当前阵容">{EXPANSION_POSITION_FILTERS.map((position) => { const count = position === "ALL" ? roster.length : rosterPositionCounts.find((entry) => entry.position === position)?.count ?? 0; return <button type="button" key={position} className={rosterPositionFilter === position ? "active" : ""} aria-pressed={rosterPositionFilter === position} onClick={() => setRosterPositionFilter(position)}><b>{position === "ALL" ? "全部" : position}</b><small>{count}</small></button>; })}</div>{roster.length > 0 ? <div className="draft-current-roster-grid">{filteredRoster.map((player) => <button type="button" data-testid={`free-agency-roster-player-${player.id}`} key={player.id} onClick={() => setSelectedPlayerId(player.id)}><span><b>{playerNameZh(player.name, player.id)}</b><small>{positionPairLabel(player.position, player.secondaryPosition)} · 年薪 {money(player.contract.salary)}</small></span><em className="player-rating-tone" style={playerRatingStyle(calculatePlayerOverall(player))}><small>OVR</small>{calculatePlayerOverall(player).toFixed(0)}</em></button>)}{filteredRoster.length === 0 && <div className="draft-current-roster-empty"><b>该位置暂无球员</b><span>请选择其他第一位置查看阵容。</span></div>}</div> : <div className="draft-current-roster-empty"><b>当前阵容暂无球员</b><span>完成签约后，球员会显示在这里。</span></div>}</div></details>
      <div className="fa-notice"><b>名单规则</b><span>休赛期 {roster.length}/{LEAGUE_FINANCE_CONFIG.rosterLimits.offseasonMaximum} · 开季上限 {LEAGUE_FINANCE_CONFIG.rosterLimits.regularSeasonMaximum}{roster.length > LEAGUE_FINANCE_CONFIG.rosterLimits.regularSeasonMaximum ? ` · 需调整 ${roster.length - LEAGUE_FINANCE_CONFIG.rosterLimits.regularSeasonMaximum} 人` : ""}</span></div>
      {freeAgency.transactionLog.length > 0 && <div className="transaction-feed"><b>联盟动态</b>{freeAgency.transactionLog.slice(0, 5).map((entry, index) => <span key={`${index}-${entry}`}>{localizePlayerNamesInText(humanizeUiText(entry), Object.values(state.players))}</span>)}</div>}
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
        const structurallyBlocked = ["球队名单已满", "球员已不在自由市场", "RFA 正在等待原球队匹配", "原球队不能提交 RFA 报价单", "自由市场尚未开启"].includes(preview.reason ?? "");
        const waitingForFirstOffer = !existing && !preview.reason && market?.marketWindowStatus !== "OPEN";
        const resolvedOfferStatus = submittedOffer?.status === "REJECTED"
          ? "报价已被拒绝"
          : submittedOffer?.status === "EXPIRED" ? "报价已到期" : undefined;
        const statusText = existing
          ? `等待决定 · 签约意愿 ${existing.utility.toFixed(0)}/100 · 第 ${market?.decisionDeadline ?? existing.expiresDay} 天截止`
          : resolvedOfferStatus
            ? `${resolvedOfferStatus} · 第 ${market?.decisionDeadline ?? submittedOffer?.expiresDay} 天截止`
            : preview.reason ?? (market?.marketWindowStatus === "OPEN" ? `第 ${market.decisionDeadline} 天截止` : "等待首份报价");
        return <article className="fa-reference-player-card" key={player.id} role="button" tabIndex={0} aria-label={`查看${playerNameZh(player.name, player.id)}球员详情`} onClick={(event) => { if ((event.target as HTMLElement).closest("button")) return; setSelectedPlayerId(player.id); }} onKeyDown={(event) => { if (event.key !== "Enter" && event.key !== " ") return; event.preventDefault(); setSelectedPlayerId(player.id); }}>
          <div className="fa-player-copy">
            <div className="fa-player-name"><b>{playerNameZh(player.name, player.id)}</b><em>{positionPairLabel(player.position, player.secondaryPosition)}</em></div>
            <small className="fa-player-meta-line"><span className={`fa-status-badge ${player.contract.status.toLowerCase()}`} title={player.contract.status === "RFA" ? "受限制自由球员：原球队拥有报价匹配权" : "完全自由球员：签约不受原球队匹配限制"}><strong>{player.contract.status}</strong></span><i>·</i><span><strong>{player.age}岁</strong></span><i>·</i><span className="fa-player-contract-summary" title={`${submittedOffer ? "报价首年" : "建议年薪"} ${money(submittedOffer?.year1Salary ?? offer.year1Salary)} · ${submittedOffer?.years ?? offer.years} 年`}>{submittedOffer ? "报价首年" : "建议年薪"} <strong className="cyan">{money(submittedOffer?.year1Salary ?? offer.year1Salary)}</strong> · {submittedOffer?.years ?? offer.years} 年</span></small>
            <small className={`fa-player-status-line deadline${waitingForFirstOffer ? " waiting-first-offer" : ""}${!existing && preview.reason ? " blocked" : ""}`} title={statusText}>{statusText}</small>
          </div>
          <span className="fa-player-ovr" aria-label={`OVR ${ability}`}><small>OVR</small><strong className="player-rating-tone" style={playerRatingStyle(ability)}>{ability}</strong></span>
          {existing
            ? <button className="withdraw" disabled={busy} onClick={() => onFreeAgencyCommand({ commandId: `withdraw-${existing.offerId}`, type: "WITHDRAW_FA_OFFER", payload: { offerId: existing.offerId } })}>撤回</button>
            : submittedOffer
              ? <button className="withdraw" disabled>{submittedOffer.status === "EXPIRED" ? "已到期" : "已拒绝"}</button>
              : <button className="fa-offer-button" data-testid={`open-fa-offer-${player.id}`} title={structurallyBlocked ? preview.reason : "查看并编辑合同报价"} disabled={busy || structurallyBlocked} onClick={() => openOfferEditor(player.id)}>{structurallyBlocked ? preview.reason === "球队名单已满" ? "名单已满" : "暂不可报价" : "发起报价"}</button>}
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
        onSubmit={() => { void onFreeAgencyCommand({ commandId: `offer-${state.league.seasonId}-${freeAgency.currentDay}-${offerPlayer.id}`, type: "SUBMIT_FA_OFFER", payload: { playerId: offerPlayer.id, ...offerDraft } }).then(() => setOfferEditor(null)); }}
      />}
      </div>
      {pending && <div className="fa-settle-footer"><div><b>受限自由球员待决定</b><small>{playerNameZh(state.players[pending.playerId].name, state.players[pending.playerId].id)} · 第 {pending.deadline} 天截止</small></div><div className="fa-settle-actions"><button disabled={busy} onClick={() => onFreeAgencyCommand({ commandId: `rfa-match-${pending.offerId}`, type: "RESOLVE_USER_RFA", payload: { decision: "MATCH" } })}>匹配</button><button className="decline" disabled={busy} onClick={() => onFreeAgencyCommand({ commandId: `rfa-decline-${pending.offerId}`, type: "RESOLVE_USER_RFA", payload: { decision: "DECLINE" } })}>放弃</button></div></div>}
    </section>
  );
}
