import { useEffect, useState } from "react";
import { LEAGUE_FINANCE_CONFIG } from "../config/leagueFinance";
import { getCapSheet } from "../game/cap/CapSheetService";
import { getAvailableDraftProspects, getNextAiDraftProspect, type DraftCommand } from "../game/draft/DraftService";
import { getFreeAgents, type FreeAgencyCommand } from "../game/freeAgency/FreeAgencyService";
import type { TradeCommand } from "../game/trade/TradeService";
import type { RosterCommand } from "../game/roster/RosterService";
import type { GameState, TrainingFocus } from "../game/state/types";
import type { ContractLifecycleCommand } from "../game/contracts/ContractLifecycleService";
import { calculateTeamFitForPlayers } from "../game/team/TeamFitService";
import { calculatePlayerOverall } from "../game/player/PlayerRatingService";
import { GameChrome } from "./GameChrome";
import { contractStatusLabel, humanizeUiText, moneyLabel, phaseLabel, positionLabel, positionPairLabel, slotLabel } from "./uiText";
import { playerNameZh } from "./playerNameZh";
import { ReferencePlayerCard } from "./ReferencePlayerCard";

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
  activeSlot: 1 | 2 | 3;
  onSlotChange: (slot: 1 | 2 | 3) => void;
  onHome?: () => void;
  initialDrawerTab?: "save" | "load";
}

const money = moneyLabel;
const TRAINING_FOCUS_OPTIONS: Array<[TrainingFocus, string]> = [
  ["BALANCED", "综合"], ["SHOOTING", "投射"], ["PLAYMAKING", "组织"],
  ["DEFENSE", "防守"], ["INSIDE", "内线"], ["ATHLETICISM", "运动能力"],
];

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

export function Stage4Flow({ state, busy, status, onCommand, onContractCommand, onFreeAgencyCommand, onTradeCommand, onRosterCommand, onSave, onLoad, activeSlot, onSlotChange, onHome, initialDrawerTab }: Stage4FlowProps) {
  const phase = state.league.currentPhase;
  const spotlightPhase = ["ROOKIE_DRAFT_PENDING", "OFFSEASON_PRE_DRAFT", "DRAFT"].includes(phase);
  const rookieDraftScreen = ["ROOKIE_DRAFT_PENDING", "OFFSEASON_PRE_DRAFT", "DRAFT"].includes(phase);
  const offseasonTerminalScreen = ["OFFSEASON_POST_DRAFT", "PRESEASON"].includes(phase);
  return (
    <main className={`app-shell expansion-shell${spotlightPhase ? " scene-stage" : ""}${rookieDraftScreen ? " rookie-draft-shell" : ""}${offseasonTerminalScreen ? " stage4-terminal-shell" : ""}`}>
      <GameChrome phase={phase} onSave={onSave} onLoad={onLoad} activeSlot={activeSlot} onSlotChange={onSlotChange} onHome={onHome} initialDrawerTab={initialDrawerTab} />
      <header className="stage-header">
        <div><span className="section-kicker">扩军时代 · 第四阶段</span><h1>经理系统</h1></div>
        <span className="phase-pill">{phaseLabel(phase)}</span>
      </header>
      <section className="status-strip" aria-live="polite"><span className={busy ? "pulse-dot active" : "pulse-dot"} />{status}</section>
      {phase === "OPTION_PHASE" && <OptionPhase state={state} busy={busy} onContractCommand={onContractCommand} />}
      {["ROOKIE_DRAFT_PENDING", "OFFSEASON_PRE_DRAFT"].includes(phase) && <DraftIntroduction state={state} busy={busy} onCommand={onCommand} />}
      {phase === "DRAFT" && <DraftBoard state={state} busy={busy} onCommand={onCommand} />}
      {phase === "OFFSEASON_POST_DRAFT" && <PostDraftHub state={state} busy={busy} onFreeAgencyCommand={onFreeAgencyCommand} onTradeCommand={onTradeCommand} onRosterCommand={onRosterCommand} />}
      {phase === "PRESEASON" && <RosterLock state={state} busy={busy} onRosterCommand={onRosterCommand} />}
      <footer>
        <label className="slot-picker">存档<select value={activeSlot} onChange={(event) => onSlotChange(Number(event.target.value) as 1 | 2 | 3)}><option value={1}>{slotLabel(1)}</option><option value={2}>{slotLabel(2)}</option><option value={3}>{slotLabel(3)}</option></select></label>
        <button className="footer-action" onClick={() => void onSave()}>保存{slotLabel(activeSlot)}</button>
        <button className="footer-action" onClick={() => void onLoad()}>读取{slotLabel(activeSlot)}</button>
        <span>选秀选择、合同生成与电脑球队选秀均通过引擎指令原子提交</span>
      </footer>
    </main>
  );
}

function DraftIntroduction({ state, busy, onCommand }: Pick<Stage4FlowProps, "state" | "busy" | "onCommand">) {
  const firstDraft = state.league.seasonYear === 2026;
  const packageId = state.expansion?.rightsDraw.packageByTeam[state.userTeamId as "SEA" | "LVG"];
  const firstPick = packageId === "B" ? 5 : 6;
  const secondPick = packageId === "B" ? 37 : 38;
  return (
    <section className="flow-card draft-intro-card rookie-draft-prep-terminal">
      <header className="draft-prep-hero">
        <span className="draft-prep-tag">准备阶段</span>
        <span className="draft-prep-kicker">01 / {state.league.seasonYear} 年新秀选秀</span>
        <h2>{firstDraft ? "首届" : "新赛季"} 32 队新秀选秀</h2>
        <p>{firstDraft ? "载入真实 2026 选秀结果；扩军球队截胡后，其他球队会按剩余真实榜单顺延补位。" : `使用可复现的程序化 ${state.league.seasonYear} 年选秀班，完成两轮新秀选择。`}</p>
      </header>
      <SectionBar title="选秀概览" meta="两轮 · 32 支球队" />
      <div className="draft-prep-metrics">
        <span><b>80</b><small>选秀球员</small></span><span><b>64</b><small>总签位</small></span>
        {firstDraft ? <><span><b>#{firstPick}</b><small>你的首轮</small></span><span><b>#{secondPick}</b><small>你的次轮</small></span></> : <><span><b>4</b><small>乐透签位</small></span><span><b>16</b><small>乐透球队</small></span></>}
      </div>
      <div className="draft-terminal-info"><span>i</span><p><b>{firstDraft ? "真实结果与截胡规则" : "球探信息保护"}</b>{firstDraft ? "普通球队优先选择现实中的目标新秀；目标已被选走时，从仍可选的真实榜单中顺延，所有球员全联盟唯一归属。" : "界面只显示潜力评级与球探置信度，隐藏真实潜力。"}</p></div>
      <button className="draft-terminal-cta" disabled={busy} onClick={() => onCommand({ commandId: `prepare-rookie-draft-${state.league.seasonId}`, type: "PREPARE_ROOKIE_DRAFT", payload: {} })}>{firstDraft ? "载入真实选秀班并进入选秀大厅" : "生成选秀班并进入选秀大厅"}<span>▶</span></button>
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
    {lifecycle?.transactionLog.length ? <div className="transaction-feed"><b>合同动态</b>{lifecycle.transactionLog.slice(-6).reverse().map((entry, index) => <span key={`${index}-${entry}`}>{humanizeUiText(entry)}</span>)}</div> : null}
    <div className="prototype-sticky-action"><button data-testid="option-finalize" className="primary-cta" disabled={busy || pending.length > 0} onClick={() => onContractCommand({ commandId: `finalize-options-${state.league.seasonId}`, type: "FINALIZE_OPTION_PHASE", payload: {} })}>完成选项阶段并进入休赛期 →</button></div>
  </section>;
}

function DraftBoard({ state, busy, onCommand }: Pick<Stage4FlowProps, "state" | "busy" | "onCommand">) {
  const [simulationMode, setSimulationMode] = useState<"PAUSED" | "LIVE">("PAUSED");
  const [exitingPlayerId, setExitingPlayerId] = useState<string | null>(null);
  const draft = state.rookieDraft!;
  const pick = draft.pickOrder[draft.currentPickIndex]!;
  const prospects = getAvailableDraftProspects(state);
  const nextAiProspect = getNextAiDraftProspect(state);
  const myPicks = draft.pickOrder.filter((entry) => entry.ownerTeamId === state.userTeamId);
  const playerTurn = pick.ownerTeamId === state.userTeamId;
  const draftedCount = draft.currentPickIndex;
  const nextUserPick = myPicks.find((entry) => !entry.playerId && entry.pickNumber > pick.pickNumber);
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
  const simulationLabel = playerTurn
    ? "▶ 轮到你的选择"
    : simulationMode === "LIVE" ? "❚❚ 暂停模拟"
      : draftedCount === 0 ? "▶ 开始选秀模拟" : "▶ 继续自动模拟";
  const feedText = playerTurn
    ? `[ACTION REQUIRED] 第 #${pick.pickNumber} 顺位轮到 ${state.teams[state.userTeamId].fullName} 选择。`
    : exitingPlayerId && nextAiProspect
      ? `[PICK #${pick.pickNumber}] ${state.teams[pick.ownerTeamId].fullName} 选择了 ${playerNameZh(nextAiProspect.name, nextAiProspect.id)}`
      : simulationMode === "LIVE"
        ? `[PICK #${pick.pickNumber}] ${state.teams[pick.ownerTeamId].fullName} 正在提交选择…`
        : `[PAUSED] 第 #${pick.pickNumber} 顺位等待开始模拟。`;
  return (
    <section className="flow-card draft-card rookie-draft-terminal">
      <header className="draft-sim-bar">
        <span>DRAFT SIMULATOR · {state.league.seasonId}</span>
        <div className="draft-top-actions">
          {!playerTurn && <button data-testid="draft-fast-forward" className="draft-fast-forward-compact" disabled={busy} onClick={() => {
            setSimulationMode("PAUSED");
            setExitingPlayerId(null);
            void onCommand({
              commandId: `stage4-fast-forward-draft-${state.league.seasonId}-${pick.pickNumber}`,
              type: "FAST_FORWARD_ROOKIE_DRAFT",
              payload: { expectedPickNumber: pick.pickNumber },
            });
          }} title={nextUserPick ? `直接跳到我的第 #${nextUserPick.pickNumber} 顺位` : "直接完成选秀"}>{nextUserPick ? `» 我的 #${nextUserPick.pickNumber}` : "» 完成选秀"}</button>}
          <button data-testid="draft-simulation-toggle" className={playerTurn ? "action" : ""} disabled={busy || playerTurn} onClick={() => setSimulationMode((mode) => mode === "PAUSED" ? "LIVE" : "PAUSED")}>{simulationLabel}</button>
        </div>
      </header>
      <div className={`draft-status-banner${playerTurn ? " action" : ""}`} aria-live="polite">{feedText}</div>
      <div className="draft-dashboard-grid">
        <div><small>正在选秀</small><b>#{pick.pickNumber}</b><span>{state.teams[pick.ownerTeamId].fullName}</span></div>
        <div><small>你的签位</small><b>{myPicks.filter((entry) => entry.playerId).length}/{myPicks.length}</b><span>{myPicks.map((entry) => `#${entry.pickNumber}`).join(" · ")}</span></div>
      </div>
      {draft.source === "CURATED_2026" && <div className="draft-terminal-notice"><strong>2026 真实选秀重演：</strong>你选中的真实新秀会从原球队计划中移除；电脑球队随后按剩余真实榜单顺延。</div>}
      <div className="draft-terminal-section"><b>选秀榜单 · 实时推荐</b><span>{prospects.length} 人可选 · 已完成 {draftedCount}/64</span></div>
      <div className="player-pool rookie-pool draft-terminal-player-list">
        {prospects.slice(0, 24).map((player, index) => (
          <article className={`player-row rookie-row draft-terminal-player${player.id === exitingPlayerId ? " drafted-out" : ""}`} key={player.id}>
            <div className="draft-terminal-prospect-main"><span className="prospect-rank">{index + 1}</span><div><b>{playerNameZh(player.name, player.id)}</b><small><em>{positionPairLabel(player.position, player.secondaryPosition)}</em> · {player.age} 岁 · 即战力 {Math.round(calculatePlayerOverall(player))}</small></div></div>
            <div className="draft-terminal-prospect-action"><span className="scout-chip"><b>{player.scoutedPotentialGrade}</b><small>{player.scoutingConfidence}%</small></span><button className={playerTurn ? "active" : ""} disabled={busy || !playerTurn} onClick={() => onCommand({
              commandId: `stage4-draft-${pick.pickNumber}-${player.id}`,
              type: "DRAFT_PLAYER",
              payload: { playerId: player.id, expectedPickNumber: pick.pickNumber },
            })}>{playerTurn ? "选择" : "等待"}</button></div>
          </article>
        ))}
      </div>
    </section>
  );
}

function PostDraftHub({ state, busy, onFreeAgencyCommand, onTradeCommand, onRosterCommand }: Pick<Stage4FlowProps, "state" | "busy" | "onFreeAgencyCommand" | "onTradeCommand" | "onRosterCommand">) {
  if (state.freeAgency?.opened) return <section className="stage4-market-terminal"><FreeAgencyHub state={state} busy={busy} onFreeAgencyCommand={onFreeAgencyCommand} /><details className="terminal-secondary-panel"><summary><span>球员交易中心</span><b>展开</b></summary><TradeDesk state={state} busy={busy} onTradeCommand={onTradeCommand} closeMarketDisabled={Boolean(state.freeAgency.pendingUserRfaDecision)} onCloseMarket={() => onRosterCommand({ commandId: `close-free-agency-${state.league.seasonId}`, type: "CLOSE_FREE_AGENCY", payload: {} })} /></details><div className="terminal-sticky-action"><button className="terminal-primary-button" disabled={busy || Boolean(state.freeAgency.pendingUserRfaDecision)} onClick={() => onRosterCommand({ commandId: `close-free-agency-${state.league.seasonId}`, type: "CLOSE_FREE_AGENCY", payload: {} })}>结束自由市场并进入名单锁定 ➔</button></div></section>;
  const draft = state.rookieDraft;
  const team = state.teams[state.userTeamId];
  const sheet = getCapSheet(state, state.userTeamId);
  const myPicks = draft?.pickOrder.filter((pick) => pick.ownerTeamId === state.userTeamId && pick.playerId) ?? [];
  return (
    <section className="flow-card post-draft-terminal">
      <header className="terminal-top-bar"><span>选秀后休赛期</span><strong>DRAFT COMPLETED</strong></header>
      <div className="post-draft-success"><b>✓ 64 个签位已完成</b><span>新秀合同已自动生成，落选秀已进入完全自由球员池。</span></div>
      <div className="terminal-section-header"><b>本次选秀获得</b><span>{myPicks.length} 人</span></div>
      <div className="post-draft-rookie-list">
        {myPicks.map((pick) => {
          const player = state.players[pick.playerId as string];
          return <article key={pick.pickNumber}><div><span>#{pick.pickNumber}</span><b>{playerNameZh(player.name, player.id)}</b></div><small><em>{positionLabel(player.position)}</em>潜力 {player.scoutedPotentialGrade} · {money(player.contract.salary)}</small></article>;
        })}
      </div>
      <div className="terminal-section-header"><b>球队账目总览</b><span>休赛期名单上限 21 人</span></div>
      <div className="post-draft-cap-grid">
        <div><small>工资帽</small><b>{money(LEAGUE_FINANCE_CONFIG.salaryCap)}</b></div>
        <div><small>薪资表</small><b>{money(sheet.total)}</b></div>
        <div><small>可用空间</small><b className={sheet.availableCapSpace < 0 ? "negative" : ""}>{money(sheet.availableCapSpace)}</b></div>
        <div><small>休赛期名单</small><b>{team.playerIds.length} / 21</b></div>
      </div>
      <div className="terminal-notice"><span>i</span><p>下一阶段：开放常规交易、受限自由球员报价单与 3 日决策窗口。</p></div>
      <div className="terminal-sticky-action"><button className="terminal-primary-button" disabled={busy} onClick={() => onFreeAgencyCommand({ commandId: `enter-free-agency-${state.league.seasonId}`, type: "ENTER_FREE_AGENCY", payload: {} })}>进入自由市场 ➔</button></div>
    </section>
  );
}

type TradeDeskProps = Pick<Stage4FlowProps, "state" | "busy" | "onTradeCommand"> & {
  closeMarketDisabled?: boolean;
  onCloseMarket?: () => void;
};

export function TradeDesk({ state, busy, onTradeCommand, closeMarketDisabled = false, onCloseMarket }: TradeDeskProps) {
  const [positionFilter, setPositionFilter] = useState<"ALL" | "PG" | "SG" | "SF" | "PF" | "C">("ALL");
  const [sortMode, setSortMode] = useState<"FIT" | "SALARY" | "OVERALL">("FIT");
  const [salaryBand, setSalaryBand] = useState<"ANY" | "MID" | "HIGH">("ANY");
  const roster = state.teams[state.userTeamId].playerIds.map((id) => state.players[id]).sort((a, b) => b.contract.salary - a.contract.salary);
  const selected = state.tradeDesk.selectedPlayerId;
  const selectedAvailable = Boolean(selected && roster.some((player) => player.id === selected));
  const requestOffers = (playerId: string, refresh: boolean) => onTradeCommand({ commandId: `trade-query-${playerId}-${refresh ? (state.tradeDesk.offers[0]?.inquiryCount ?? 0) + 1 : 0}`, type: "GENERATE_TRADE_OFFERS", payload: { playerId, refresh } });
  const currentPlayers = state.teams[state.userTeamId].playerIds.map((id) => state.players[id]);
  const selectedPlayer = selectedAvailable && selected ? state.players[selected] : null;
  const offers = selectedAvailable ? state.tradeDesk.offers.flatMap((offer) => {
    const incoming = state.players[offer.userIncomingPlayerIds[0]];
    if (!incoming) return [];
    const outgoingIds = new Set(offer.userOutgoingPlayerIds);
    const before = calculateTeamFitForPlayers(currentPlayers);
    const after = calculateTeamFitForPlayers([...currentPlayers.filter((player) => !outgoingIds.has(player.id)), ...offer.userIncomingPlayerIds.map((id) => state.players[id])]);
    return [{ offer, incoming, before: before.score, after: after.score, delta: after.score - before.score, overallDelta: calculatePlayerOverall(incoming) - (selectedPlayer ? calculatePlayerOverall(selectedPlayer) : 0) }];
  }) : [];
  const visibleOffers = offers.filter(({ incoming }) => {
    const positionMatches = positionFilter === "ALL" || incoming.position === positionFilter || incoming.secondaryPosition === positionFilter;
    const salaryMatches = salaryBand === "ANY" || (salaryBand === "MID" ? incoming.contract.salary >= 5_000_000 && incoming.contract.salary < 15_000_000 : incoming.contract.salary >= 15_000_000 && incoming.contract.salary <= 30_000_000);
    return positionMatches && salaryMatches;
  }).sort((left, right) => sortMode === "SALARY" ? left.incoming.contract.salary - right.incoming.contract.salary : sortMode === "OVERALL" ? right.overallDelta - left.overallDelta : right.delta - left.delta);
  const closePanel = (target: HTMLElement) => target.closest("details")?.removeAttribute("open");
  return (
    <section className="prototype-trade-center trade-center-terminal">
      {onCloseMarket && <button data-testid="trade-center-close" className="trade-center-close" type="button" aria-label="关闭球员交易中心" onClick={(event) => closePanel(event.currentTarget)}>✕</button>}
      <header className="trade-center-header"><b>球员交易中心 · 询价控制台</b><span>选择筹码向全联盟发起询价，获取 3 个动态报价方案</span></header>
      <div className="trade-filter-section">
        <div className="trade-position-filters"><span>位置:</span>{(["ALL", "PG", "SG", "SF", "PF", "C"] as const).map((position) => <button data-testid={`trade-position-${position}`} className={positionFilter === position ? "active" : ""} type="button" onClick={() => setPositionFilter(position)} key={position}>{position}</button>)}</div>
        <div className="trade-filter-controls">
          <select data-testid="trade-sort" aria-label="交易报价排序" value={sortMode} onChange={(event) => setSortMode(event.target.value as typeof sortMode)}><option value="FIT">排序: 适配度最高</option><option value="SALARY">排序: 薪资从低到高</option><option value="OVERALL">排序: 综合能力下降最小</option></select>
          <select data-testid="trade-salary-filter" aria-label="交易报价薪资筛选" value={salaryBand} onChange={(event) => setSalaryBand(event.target.value as typeof salaryBand)}><option value="ANY">薪资: 不限区间</option><option value="MID">500万 - 1,500万</option><option value="HIGH">1,500万 - 3,000万</option></select>
        </div>
      </div>
      <div className="trade-inquire-bar">
        <select data-testid="trade-player-select" aria-label="选择要送出的球员" value={selectedAvailable ? selected ?? "" : ""} disabled={busy} onChange={(event) => { if (event.target.value) void requestOffers(event.target.value, false); }}><option value="">选择出价筹码...</option>{roster.slice(0, 16).map((player) => <option value={player.id} key={player.id}>筹码: {playerNameZh(player.name, player.id)} · {money(player.contract.salary)}</option>)}</select>
        <button data-testid="trade-refresh" type="button" disabled={busy || !selectedAvailable} onClick={() => selectedAvailable && selected && void requestOffers(selected, true)}>刷新市场报价</button>
      </div>
      <div className="trade-offer-heading"><span>已收到动态报价 ({visibleOffers.length}{visibleOffers.length !== offers.length ? `/${offers.length}` : ""})</span><b>实时更新中</b></div>
      <div className="trade-offers trade-offer-scroll-list">
        {visibleOffers.map(({ offer, incoming, before, after, delta }) => <article className="trade-terminal-offer" key={offer.offerId}>
          <span className="trade-offer-team">{state.teams[offer.counterpartyTeamId].name}</span>
          <div className="trade-offer-player"><div><b>{playerNameZh(incoming.name, incoming.id)}</b><em>{positionLabel(incoming.position)}</em></div><small>{money(incoming.contract.salary)}{offer.userIncomingPickIds.length ? " + 次轮签" : ""}</small></div>
          <div className="trade-offer-fit"><small>适配度</small><b>{before.toFixed(0)} ➔ {after.toFixed(0)} ({delta >= 0 ? "+" : ""}{delta.toFixed(1)})</b></div>
          <button data-testid="trade-accept" type="button" disabled={busy} onClick={() => onTradeCommand({ commandId: `accept-trade-${offer.offerId}`, type: "ACCEPT_TRADE_OFFER", payload: { offerId: offer.offerId } })}>接受报价</button>
        </article>)}
        {visibleOffers.length === 0 && <div className="trade-offer-empty">{offers.length ? "当前筛选条件下没有报价" : "选择本队球员并发起询价后，动态报价将在这里显示"}</div>}
      </div>
      {onCloseMarket && <footer className="trade-center-footer"><button data-testid="trade-end-market" type="button" disabled={busy || closeMarketDisabled} onClick={onCloseMarket}>结束自由市场并进入名单锁定 ➔</button></footer>}
    </section>
  );
}

function RosterLock({ state, busy, onRosterCommand }: Pick<Stage4FlowProps, "state" | "busy" | "onRosterCommand">) {
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [pendingWaivePlayerId, setPendingWaivePlayerId] = useState<string | null>(null);
  const roster = state.teams[state.userTeamId].playerIds.map((id) => state.players[id]).sort((a, b) => a.contract.salary - b.contract.salary);
  const assignments = state.trainingPlan?.seasonId === state.league.seasonId ? state.trainingPlan.assignments : {};
  const focusedCount = Object.keys(assignments).length;
  const selectedPlayer = selectedPlayerId ? state.players[selectedPlayerId] : undefined;
  const pendingWaivePlayer = pendingWaivePlayerId ? state.players[pendingWaivePlayerId] : undefined;
  useEffect(() => {
    if (!selectedPlayerId && !pendingWaivePlayerId) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setSelectedPlayerId(null);
      setPendingWaivePlayerId(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [pendingWaivePlayerId, selectedPlayerId]);
  return <section className="flow-card preseason-terminal"><header className="terminal-top-bar"><span>季前准备 · 阵容微调与指定训练</span><strong>PRE-SEASON</strong></header><div className="terminal-metrics-grid"><span><b>{focusedCount} / 2</b><small>重点培养</small></span><span><b>{roster.length}</b><small>标准名单</small></span><span><b className={roster.length > 15 ? "warning" : ""}>{Math.max(0, 15 - roster.length)}</b><small>{roster.length > 15 ? `需裁 ${roster.length - 15} 人` : "空余名额"}</small></span></div><div className="terminal-notice preseason-notice"><p><strong>培养说明：</strong>每赛季最多指定 2 人，训练改变成长权重与成功概率，不直接固定增加属性。点击球员可查看完整信息卡。</p></div><div className="terminal-section-header"><b>常规赛名单</b><span>需调整至 14～15 人</span></div><div className="preseason-roster-list">{roster.map((player) => {
    const focus = assignments[player.id];
    return <article className="preseason-roster-card" key={player.id}><button type="button" className="preseason-player-open" data-testid={`preseason-player-${player.id}`} onClick={() => setSelectedPlayerId(player.id)}><span className="preseason-position-mark">{positionLabel(player.position)}</span><span className="preseason-player-copy"><span className="preseason-player-name-row"><b>{playerNameZh(player.name, player.id)}</b><em>能力 {calculatePlayerOverall(player).toFixed(0)}</em></span><small>{money(player.contract.salary)} · {player.contract.yearsRemaining} 年 · {player.age} 岁</small></span></button><div className="preseason-player-actions"><select aria-label={`${playerNameZh(player.name, player.id)} 训练重点`} value={focus ?? ""} disabled={busy || (!focus && focusedCount >= 2)} onChange={(event) => {
      const nextFocus = event.target.value === "" ? null : event.target.value as TrainingFocus;
      void onRosterCommand({ commandId: `training-${state.league.seasonId}-${player.id}-${nextFocus ?? "none"}`, type: "SET_TRAINING_FOCUS", payload: { playerId: player.id, focus: nextFocus } });
    }}><option value="">不指定</option>{TRAINING_FOCUS_OPTIONS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><button type="button" data-testid={`preseason-waive-${player.id}`} disabled={busy || roster.length <= 14} onClick={() => setPendingWaivePlayerId(player.id)}>裁员</button></div></article>;
  })}</div><div className="terminal-sticky-action"><button className="terminal-primary-button" disabled={busy || roster.length > 15} onClick={() => onRosterCommand({ commandId: `lock-opening-roster-${state.league.seasonId}`, type: "LOCK_OPENING_ROSTER", payload: { confirmMinimumFill: true } })}>锁定名单并进入常规赛 ➔</button></div>
    {selectedPlayer && <div className="player-detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedPlayerId(null); }}><section className="reference-player-dialog" role="dialog" aria-modal="true" aria-label={`${playerNameZh(selectedPlayer.name, selectedPlayer.id)} 球员详情`}><button className="detail-close" type="button" onClick={() => setSelectedPlayerId(null)} aria-label="关闭">×</button><ReferencePlayerCard player={selectedPlayer} teamName={state.teams[selectedPlayer.teamId]?.fullName ?? "自由球员"} /></section></div>}
    {pendingWaivePlayer && <div className="player-detail-backdrop preseason-confirm-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setPendingWaivePlayerId(null); }}><section className="preseason-waive-dialog" data-testid="preseason-waive-dialog" role="alertdialog" aria-modal="true" aria-labelledby="preseason-waive-title" aria-describedby="preseason-waive-description"><span className="preseason-waive-icon" aria-hidden="true">!</span><div><small>ROSTER TRANSACTION</small><h2 id="preseason-waive-title">确认裁掉 {playerNameZh(pendingWaivePlayer.name, pendingWaivePlayer.id)}？</h2><p id="preseason-waive-description">该操作会立即移出球队名单；剩余保障金额 {money(pendingWaivePlayer.contract.guaranteedAmount)} 将按合同年份计入死钱。</p><div className="preseason-waive-summary"><span>裁员后名单 <b>{roster.length - 1} 人</b></span><span>球员状态 <b>完全自由球员</b></span></div><div className="preseason-waive-actions"><button type="button" data-testid="preseason-waive-cancel" disabled={busy} onClick={() => setPendingWaivePlayerId(null)}>取消</button><button type="button" className="danger" data-testid="preseason-waive-confirm" disabled={busy} onClick={() => void onRosterCommand({ commandId: `waive-${state.league.seasonId}-${pendingWaivePlayer.id}`, type: "WAIVE_PLAYER", payload: { playerId: pendingWaivePlayer.id } }).finally(() => setPendingWaivePlayerId(null))}>确认裁员</button></div></div></section></div>}
  </section>;
}

function FreeAgencyHub({ state, busy, onFreeAgencyCommand }: Pick<Stage4FlowProps, "state" | "busy" | "onFreeAgencyCommand">) {
  const freeAgency = state.freeAgency;
  if (!freeAgency) return null;
  const players = getFreeAgents(state);
  const sheet = getCapSheet(state, state.userTeamId);
  const pending = freeAgency.pendingUserRfaDecision;
  const activeUserOffers = Object.values(freeAgency.offers).filter((offer) => offer.teamId === state.userTeamId && offer.status === "ACTIVE");
  return (
    <section className="flow-card free-agency-terminal">
      <header className="terminal-top-bar"><span>03 / 自由市场 · 第 {freeAgency.currentDay} 天</span><strong className="orange">{players.length} 人可签</strong></header>
      <div className="terminal-metrics-grid"><span><b>{players.length}</b><small>可签球员</small></span><span><b>{activeUserOffers.length}</b><small>本队报价</small></span><span><b className={sheet.availableCapSpace < 0 ? "warning" : ""}>{money(sheet.availableCapSpace)}</b><small>可用空间</small></span></div>
      <div className="free-agency-settle-bar"><div><b>今日市场结算</b><span>{pending ? "请先处理受限自由球员报价单" : "推进一天并结算所有有效报价"}</span></div><button disabled={busy || Boolean(pending)} onClick={() => onFreeAgencyCommand({ commandId: `fa-day-${state.league.seasonId}-${freeAgency.currentDay}`, type: "ADVANCE_FA_DAY", payload: {} })}>结算今日 ➔</button></div>
      {pending && <div className="rfa-decision"><b>受限自由球员报价单待处理</b><span>{playerNameZh(state.players[pending.playerId].name, state.players[pending.playerId].id)} · 第 {pending.deadline} 天截止</span><div><button onClick={() => onFreeAgencyCommand({ commandId: `rfa-match-${pending.offerId}`, type: "RESOLVE_USER_RFA", payload: { decision: "MATCH" } })}>匹配报价</button><button className="decline" onClick={() => onFreeAgencyCommand({ commandId: `rfa-decline-${pending.offerId}`, type: "RESOLVE_USER_RFA", payload: { decision: "DECLINE" } })}>放弃匹配</button></div></div>}
      <div className="terminal-section-header"><b>自由球员池</b><span>按综合能力排序</span></div>
      <div className="free-agency-player-list">
        {players.slice(0, 24).map((player) => {
          const existing = activeUserOffers.find((offer) => offer.playerId === player.id);
          const ability = Math.round(calculatePlayerOverall(player));
          const salary = Math.max(1_300_000, Math.min(35_000_000, Math.round(Math.max(1, ability - 52) * 900_000 / 100_000) * 100_000));
          const market = freeAgency.markets[player.id];
          return (
            <article className="free-agency-player-card" key={player.id}>
              <div><div className="free-agent-name-row"><span>{contractStatusLabel(player.contract.status)}</span><b>{playerNameZh(player.name, player.id)}</b></div><small><em>{positionPairLabel(player.position, player.secondaryPosition)}</em>{player.age} 岁 · 能力 {ability} · {money(salary)}/年</small><small className="free-agent-window">{market?.marketWindowStatus === "OPEN" ? `第 ${market.decisionDeadline} 天截止` : "等待首份报价"}</small></div>
              {existing ? <button className="withdraw" disabled={busy} onClick={() => onFreeAgencyCommand({ commandId: `withdraw-${existing.offerId}`, type: "WITHDRAW_FA_OFFER", payload: { offerId: existing.offerId } })}>撤回 {existing.utility.toFixed(0)}</button>
                : <button disabled={busy || sheet.availableCapSpace < salary} onClick={() => onFreeAgencyCommand({ commandId: `offer-${state.league.seasonId}-${freeAgency.currentDay}-${player.id}`, type: "SUBMIT_FA_OFFER", payload: { playerId: player.id, years: player.age <= 27 ? 3 : 2, year1Salary: salary, guaranteedPercent: 0.9, rolePromised: ability >= 76 ? "STARTER" : "ROTATION" } })}>报价</button>}
            </article>
          );
        })}
      </div>
      {freeAgency.transactionLog.length > 0 && <div className="transaction-feed"><b>联盟动态</b>{freeAgency.transactionLog.slice(0, 5).map((entry, index) => <span key={`${index}-${entry}`}>{humanizeUiText(entry)}</span>)}</div>}
    </section>
  );
}
