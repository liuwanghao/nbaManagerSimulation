import { useEffect, useState } from "react";
import { LEAGUE_FINANCE_CONFIG } from "../config/leagueFinance";
import { getCapSheet } from "../game/cap/CapSheetService";
import { getAvailableDraftProspects, getNextAiDraftProspect, type DraftCommand } from "../game/draft/DraftService";
import { getFreeAgents, getFreeAgentOfferPreview, type FreeAgencyCommand } from "../game/freeAgency/FreeAgencyService";
import { evaluateTradeOffer, type TradeCommand } from "../game/trade/TradeService";
import type { RosterCommand } from "../game/roster/RosterService";
import type { GameState, Player, TrainingFocus } from "../game/state/types";
import type { ContractLifecycleCommand } from "../game/contracts/ContractLifecycleService";
import { calculatePlayerOverall } from "../game/player/PlayerRatingService";
import { BALANCE_CONFIG } from "../config/balanceConfig";
import { GameChrome } from "./GameChrome";
import { getTeamInboxItems } from "../game/notifications/TeamNotificationService";
import { contractStatusLabel, humanizeUiText, measurementLabel, moneyLabel, phaseLabel, positionLabel, positionPairLabel, slotLabel } from "./uiText";
import { playerNameZh } from "./playerNameZh";
import { ReferencePlayerCard } from "./ReferencePlayerCard";
import { portraitSpriteMeta } from "./portraitSprite";
import type { SaveSlotSummary } from "../storage/SaveService";
import { EXPANSION_POSITION_FILTERS, getCurrentRosterPositionCounts, getCurrentRosterPositionSummary, getCurrentTeamId, getCurrentTeamRoster, getExpansionDraftRecap, matchesExpansionPosition, type ExpansionPositionFilter } from "./expansionDraftView";

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

export function Stage4Flow({ state, busy, status, onCommand, onContractCommand, onFreeAgencyCommand, onTradeCommand, onRosterCommand, onSave, onLoad, onLoadLatest, saveSlots, activeSlot, onSlotChange, onHome, onMarkNotificationsRead, initialDrawerTab }: Stage4FlowProps) {
  const phase = state.league.currentPhase;
  const spotlightPhase = ["ROOKIE_DRAFT_PENDING", "OFFSEASON_PRE_DRAFT", "DRAFT"].includes(phase);
  const rookieDraftScreen = ["ROOKIE_DRAFT_PENDING", "OFFSEASON_PRE_DRAFT", "DRAFT"].includes(phase);
  const offseasonTerminalScreen = ["OFFSEASON_POST_DRAFT", "PRESEASON"].includes(phase);
  return (
    <main className={`app-shell expansion-shell${spotlightPhase ? " scene-stage" : ""}${rookieDraftScreen ? " rookie-draft-shell" : ""}${offseasonTerminalScreen ? " stage4-terminal-shell" : ""}`}>
      <GameChrome phase={phase} busy={busy} onSave={onSave} onLoad={onLoad} onLoadLatest={onLoadLatest} activeSlot={activeSlot} saveSlots={saveSlots} onSlotChange={onSlotChange} onHome={onHome} initialDrawerTab={initialDrawerTab} notifications={getTeamInboxItems(state)} onMarkNotificationsRead={onMarkNotificationsRead} onHandlePendingNotification={(item) => { if (item.id.startsWith("action-rfa-")) document.querySelector(".fa-settle-footer")?.scrollIntoView({ behavior: "smooth", block: "center" }); }} />
      <header className="stage-header">
        <div><span className="section-kicker">扩军时代 · 第四阶段</span><h1>经理系统</h1></div>
        <span className="phase-pill">{phaseLabel(phase)}</span>
      </header>
      <section className="status-strip" aria-live="polite"><span className={busy ? "pulse-dot active" : "pulse-dot"} />{status}</section>
      {phase === "OPTION_PHASE" && <OptionPhase state={state} busy={busy} onContractCommand={onContractCommand} />}
      {phase === "ROOKIE_DRAFT_PENDING" && state.expansion?.finalized && <ExpansionDraftRecap state={state} />}
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
  return <section className="expansion-draft-recap" aria-labelledby="expansion-recap-title">
    <header><span>扩军选秀完成</span><h2 id="expansion-recap-title">两支扩军球队选人名单</h2><p>按实际选秀顺位排列 · 共 {teams.reduce((total, team) => total + team.picks.length, 0)} 次选择</p></header>
    <div className="expansion-recap-teams">
      {teams.map(({ teamId, picks }) => {
        const team = state.teams[teamId];
        return <section className="expansion-recap-team" aria-label={`${team.fullName}选人名单`} key={teamId}>
          <h3><span className="expansion-recap-logo">{team.logoUrl ? <img src={team.logoUrl} alt="" /> : team.abbreviation.slice(0, 2)}</span><span>{team.fullName}<small>{picks.length} 名球员</small></span></h3>
          <ol>{picks.map((pick) => {
            const player = state.players[pick.playerId];
            return <li key={pick.pickNumber}>
              <span className="expansion-recap-pick">#{pick.pickNumber}</span>
              <span className="expansion-recap-player"><b>{playerNameZh(player.name, player.id)}</b><small>来自{state.teams[pick.sourceTeamId].fullName} · {positionPairLabel(player.position, player.secondaryPosition)}</small></span>
              <span className="expansion-recap-overall"><small>OVR</small>{calculatePlayerOverall(player).toFixed(0)}</span>
            </li>;
          })}</ol>
        </section>;
      })}
    </div>
  </section>;
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

function DraftProspectAvatar({ player, portraitPath }: { player: Pick<Player, "id" | "name" | "position">; portraitPath?: string | null }) {
  const portrait = portraitSpriteMeta(player.id, portraitPath);
  const [loadedSource, setLoadedSource] = useState<string | null>(null);
  useEffect(() => {
    if (!portrait) {
      setLoadedSource(null);
      return;
    }
    let cancelled = false;
    const image = new Image();
    image.onload = () => { if (!cancelled) setLoadedSource(portrait.source); };
    image.onerror = () => { if (!cancelled) setLoadedSource(null); };
    image.src = portrait.source;
    return () => { cancelled = true; };
  }, [portrait?.source]);
  const showPortrait = portrait && loadedSource === portrait.source;
  return <div className={`gemini-prospect-avatar${showPortrait ? " has-portrait" : " portrait-fallback"}`} style={showPortrait ? portrait.style : undefined} role="img" aria-label={`${playerNameZh(player.name, player.id)}${showPortrait ? "头像" : "默认头像"}`} />;
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
    <section className="gemini-ticker"><div><b>选秀顺位总览（{draft.pickOrder.length} 签）</b><small>已完成 {draftedCount} / {draft.pickOrder.length}</small></div><div className="gemini-ticker-scroll">{draft.pickOrder.map((entry) => { const owner = state.teams[entry.ownerTeamId]; const selected = entry.playerId ? state.players[entry.playerId] : undefined; return <span key={entry.pickNumber} className={`${entry.pickNumber === pick.pickNumber ? "current" : ""} ${entry.playerId ? "done" : ""}`} title={selected ? `${owner.fullName} · ${playerNameZh(selected.name, selected.id)}` : owner.fullName}>{owner.logoUrl ? <img src={owner.logoUrl} alt="" /> : <i>{owner.abbreviation}</i>}<b>#{entry.pickNumber}</b><small>{selected ? playerNameZh(selected.name, selected.id).split(" ")[0] : owner.abbreviation}</small></span>; })}</div></section>
    <div className={`gemini-alert${playerTurn ? " action" : ""}`} aria-live="polite">{feedText}</div>
    <main className="gemini-draft-main"><div className="gemini-filter"><div className="gemini-list-heading"><b>候选新秀（{filteredProspects.length} 人）</b><span>按预测顺位排序</span></div><div className="gemini-tabs">{(["ALL", "PG", "SG", "SF", "PF", "C"] as const).map((filter) => <button key={filter} className={positionFilter === filter ? "active" : ""} onClick={() => setPositionFilter(filter)}>{filter === "ALL" ? "全部" : filter}</button>)}</div></div><div className="gemini-prospect-list">{filteredProspects.map((player) => { const rank = prospects.findIndex((candidate) => candidate.id === player.id) + 1; return <article key={player.id} className={`gemini-prospect-card${player.id === exitingPlayerId ? " drafted-out" : ""}`} onClick={() => setSelectedProspectId(player.id)} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setSelectedProspectId(player.id); }}><div className="gemini-prospect-rank">#{rank}</div><DraftProspectAvatar player={player} portraitPath={state.players[player.id]?.portraitPath} /><div className="gemini-prospect-copy"><b>{playerNameZh(player.name, player.id)}</b><small>{positionPairLabel(player.position, player.secondaryPosition)} · {player.age} 岁 · {measurementLabel(player.heightCm, "cm")}</small><div className="gemini-scout-bar"><span style={{ width: `${Math.min(100, (player.scoutingConfidence ?? 0))}%` }} /><em>球探置信度 {player.scoutingConfidence ?? "—"}%</em></div></div><div className="gemini-prospect-grade"><b>{player.scoutedPotentialGrade ?? "—"}</b><small>潜力</small></div><button className={playerTurn ? "active" : ""} disabled={busy || !playerTurn} onClick={(event) => { event.stopPropagation(); void commitPick(player.id); }}>{playerTurn ? "选中球员" : "等待"}</button></article>; })}</div></main>
    <footer className="gemini-bottom-bar"><button disabled={busy || playerTurn} onClick={() => setSimulationMode((mode) => mode === "PAUSED" ? "LIVE" : "PAUSED")}>{simulationMode === "LIVE" ? "暂停模拟" : draftedCount === 0 ? "开始自动模拟" : "继续自动模拟"}</button><button className="primary" disabled={busy || playerTurn} onClick={() => void onCommand({ commandId: `stage4-fast-forward-draft-${state.league.seasonId}-${pick.pickNumber}`, type: "FAST_FORWARD_ROOKIE_DRAFT", payload: { expectedPickNumber: pick.pickNumber } })}>{nextUserPick ? `模拟至我方 #${nextUserPick.pickNumber}` : "完成选秀"}</button></footer>
    {selectedProspectId && state.players[selectedProspectId] && <DraftProspectDetail player={state.players[selectedProspectId]} revealed={revealedProspectIds.has(selectedProspectId)} onReveal={() => void onCommand({ commandId: `reveal-draft-prospect-${state.league.seasonId}-${selectedProspectId}`, type: "REVEAL_DRAFT_PROSPECT", payload: { playerId: selectedProspectId } })} onClose={() => setSelectedProspectId(null)} />}
  </section>;
}

type RewardVideoResponse = {
  code?: number;
  message?: string;
  data?: { rewarded?: boolean; reason?: string };
};

type VataskBridge = {
  completeRewardVideo?: () => Promise<RewardVideoResponse>;
  getActivityTaskState?: () => Promise<unknown>;
};

function DraftProspectDetail({ player, revealed, onReveal, onClose }: { player: Player; revealed: boolean; onReveal: () => void; onClose: () => void }) {
  const [rewardBusy, setRewardBusy] = useState(false);
  const [rewardMessage, setRewardMessage] = useState<string | null>(null);
  const revealAbility = async () => {
    if (rewardBusy) return;
    setRewardBusy(true);
    setRewardMessage(null);
    try {
      const vatask = (window as Window & { ColorboxAI?: { vatask?: VataskBridge } }).ColorboxAI?.vatask;
      if (!vatask?.completeRewardVideo) {
        setRewardMessage("请在虎扑 App 内观看激励视频后解锁能力。");
        return;
      }
      const result = await vatask.completeRewardVideo();
      if (result.code !== 200 || result.data?.rewarded !== true) {
        setRewardMessage(result.message ?? "激励视频未完成，暂未解锁能力。");
        return;
      }
      onReveal();
      const taskStateRefresh = vatask.getActivityTaskState?.();
      if (taskStateRefresh) void taskStateRefresh.catch(() => undefined);
    } catch {
      setRewardMessage("激励视频暂时不可用，请稍后再试。");
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
        <span className={revealed ? "revealed" : "masked"}><b>{revealed ? Math.round(calculatePlayerOverall(player)) : "?"}</b><small>能力</small></span>
      </div>
      <p className="draft-prospect-note">选秀阶段默认只公开潜力评级；能力值需要通过激励视频解锁。</p>
      {revealed
        ? <div className="draft-prospect-revealed">已解锁球员能力：<b>{Math.round(calculatePlayerOverall(player))}</b></div>
        : <button className="draft-prospect-reward" type="button" disabled={rewardBusy} onClick={() => void revealAbility()}>{rewardBusy ? "激励视频播放中…" : "查看激励视频 · 解锁能力"}</button>}
      {rewardMessage && <p className="draft-prospect-reward-message" role="status">{rewardMessage}</p>}
      <div className="cyber-scout-footer"><span>数据源：本地选秀数据库</span><span>能力解锁受激励视频保护</span></div>
    </section>
  </div>;
}

function PostDraftHub({ state, busy, onFreeAgencyCommand, onRosterCommand }: Pick<Stage4FlowProps, "state" | "busy" | "onFreeAgencyCommand" | "onRosterCommand">) {
  const [resultsOpen, setResultsOpen] = useState(false);
  if (state.freeAgency?.opened) {
    const pendingUserOffers = Object.values(state.freeAgency.offers).filter((offer) => offer.teamId === state.userTeamId && offer.status === "ACTIVE").length;
    return <section className="stage4-market-terminal"><FreeAgencyHub state={state} busy={busy} onFreeAgencyCommand={onFreeAgencyCommand} /><div className="terminal-sticky-action"><button className="terminal-primary-button" disabled={busy || Boolean(state.freeAgency.pendingUserRfaDecision)} onClick={() => onRosterCommand({ commandId: `close-free-agency-${state.league.seasonId}`, type: "CLOSE_FREE_AGENCY", payload: {} })}>{pendingUserOffers ? `结束市场并撤回 ${pendingUserOffers} 份待定报价` : "结束市场，进入季前调整"} ➔</button></div></section>;
  }
  const draft = state.rookieDraft;
  const team = state.teams[state.userTeamId];
  const sheet = getCapSheet(state, state.userTeamId);
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
      <div className="terminal-notice"><span>i</span><p>下一阶段：开放常规交易、受限自由球员报价单与 {BALANCE_CONFIG.freeAgency.decisionWindowDays} 日决策窗口。</p></div>
      <div className="terminal-sticky-action"><button className="terminal-primary-button" disabled={busy} onClick={() => onFreeAgencyCommand({ commandId: `enter-free-agency-${state.league.seasonId}`, type: "ENTER_FREE_AGENCY", payload: {} })}>进入自由市场 ➔</button></div>
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
  const [positionFilter, setPositionFilter] = useState<"ALL" | "PG" | "SG" | "SF" | "PF" | "C">("ALL");
  const [sortMode, setSortMode] = useState<"FIT" | "OVR" | "SALARY_ASC" | "SALARY_DESC">("FIT");
  const [salaryCap, setSalaryCap] = useState(25_000_000);
  const [assetDrawerOpen, setAssetDrawerOpen] = useState(false);
  const [sortDrawerOpen, setSortDrawerOpen] = useState(false);
  const [detailOfferId, setDetailOfferId] = useState<string | null>(null);
  const roster = state.teams[state.userTeamId].playerIds.map((id) => state.players[id]).filter(Boolean).sort((a, b) => b.contract.salary - a.contract.salary);
  const selected = state.tradeDesk.selectedPlayerId;
  const selectedAvailable = Boolean(selected && roster.some((player) => player.id === selected));
  const selectedPlayer = selectedAvailable && selected ? state.players[selected] : null;
  const requestOffers = (playerId: string, refresh: boolean) => onTradeCommand({ commandId: `trade-query-${playerId}-${refresh ? (state.tradeDesk.offers[0]?.inquiryCount ?? 0) + 1 : 0}`, type: "GENERATE_TRADE_OFFERS", payload: { playerId, refresh } });
  const offers = selectedAvailable ? state.tradeDesk.offers.flatMap((offer) => {
    const incoming = state.players[offer.userIncomingPlayerIds[0]];
    if (!incoming) return [];
    const evaluation = evaluateTradeOffer(state, offer.offerId);
    return [{ offer, incoming, evaluation, overallDelta: calculatePlayerOverall(incoming) - (selectedPlayer ? calculatePlayerOverall(selectedPlayer) : 0) }];
  }) : [];
  const visibleOffers = offers.filter(({ incoming }) => positionFilter === "ALL" || incoming.position === positionFilter || incoming.secondaryPosition === positionFilter)
    .filter(({ incoming }) => incoming.contract.salary <= salaryCap)
    .sort((left, right) => sortMode === "OVR" ? calculatePlayerOverall(right.incoming) - calculatePlayerOverall(left.incoming)
      : sortMode === "SALARY_ASC" ? left.incoming.contract.salary - right.incoming.contract.salary
        : sortMode === "SALARY_DESC" ? right.incoming.contract.salary - left.incoming.contract.salary : right.evaluation.userFitDelta - left.evaluation.userFitDelta);
  const detail = offers.find(({ offer }) => offer.offerId === detailOfferId) ?? null;
  const sortLabel = sortMode === "OVR" ? "排序: 球员能力值高→低" : sortMode === "SALARY_ASC" ? "排序: 薪资包低→高" : sortMode === "SALARY_DESC" ? "排序: 薪资包高→低" : "排序: 战术匹配度最高";
  const closePanel = (target: HTMLElement) => target.closest("details")?.removeAttribute("open");
  const resetFilters = () => { setPositionFilter("ALL"); setSortMode("FIT"); setSalaryCap(25_000_000); };
  return <section className="trade-console-demo trade-center-terminal">
    {onCloseMarket && <button data-testid="trade-center-close" className="trade-console-close" type="button" aria-label="关闭球员交易中心" onClick={(event) => closePanel(event.currentTarget)}>✕</button>}
    <header className="trade-console-header">
      <div className="trade-console-title"><i /><div><div><b>交易控制台</b><span>H5 MOBILE</span></div><small>{state.teams[state.userTeamId].fullName} · {state.league.seasonId} 赛季</small></div></div>
      <div className="trade-console-space"><small>空间限额</small><b>{money(getCapSheet(state, state.userTeamId).availableCapSpace)}</b></div>
    </header>
    <div className="trade-console-scroll">
      <section className="trade-console-card trade-asset-card"><div className="trade-console-card-heading"><b>🤝 我方提供筹码 <small>(Outgoing Asset)</small></b><span>{selectedPlayer ? "1 个筹码" : "未选择"}</span></div>
        <button className="trade-asset-trigger" type="button" disabled={busy} onClick={() => setAssetDrawerOpen(true)}><span className="trade-avatar">{selectedPlayer ? playerNameZh(selectedPlayer.name, selectedPlayer.id).slice(0, 1) : "?"}</span><span className="trade-asset-copy">{selectedPlayer ? <><b>{playerNameZh(selectedPlayer.name, selectedPlayer.id)} <em>{calculatePlayerOverall(selectedPlayer).toFixed(0)} OVR</em></b><small>{positionPairLabel(selectedPlayer.position, selectedPlayer.secondaryPosition)} · 合同剩余 {selectedPlayer.contract.yearsRemaining} 年</small><strong>{money(selectedPlayer.contract.salary)} / 年</strong></> : <b>选择我方交易筹码</b>}</span><strong className="trade-asset-change">更换筹码　›</strong></button>
      </section>
      <section className="trade-console-card"><div className="trade-console-card-heading"><b>☷ 目标需求筛选</b><button type="button" onClick={resetFilters}>↶ 重置</button></div>
        <div className="trade-position-tabs">{(["ALL", "PG", "SG", "SF", "PF", "C"] as const).map((position) => <button data-testid={`trade-position-${position}`} className={positionFilter === position ? "active" : ""} type="button" onClick={() => setPositionFilter(position)} key={position}>{position}</button>)}</div>
        <div className="trade-console-controls"><button type="button" onClick={() => setSortDrawerOpen(true)}>{sortLabel}<span>⌄</span></button><label><span>薪资上限 <b>{money(salaryCap)}</b></span><input type="range" min="5_000_000" max="35_000_000" step="1_000_000" value={salaryCap} onChange={(event) => setSalaryCap(Number(event.target.value))} /></label></div>
      </section>
      <section className="trade-console-offers"><div className="trade-console-offer-heading"><b>全联盟响应报价 <span>{visibleOffers.length} 个回应</span></b><button data-testid="trade-refresh" type="button" disabled={busy || !selectedAvailable} onClick={() => selected && void requestOffers(selected, true)}>⟳ 刷新报价</button></div>
        <div className="trade-console-offer-list">{visibleOffers.map(({ offer, incoming, evaluation }) => <button type="button" className="trade-console-offer-card" key={offer.offerId} onClick={() => setDetailOfferId(offer.offerId)}><span className="trade-avatar">{playerNameZh(incoming.name, incoming.id).slice(0, 1)}</span><span className="trade-offer-copy"><b>{playerNameZh(incoming.name, incoming.id)} <em>{positionLabel(incoming.position)}</em></b><small><strong>{calculatePlayerOverall(incoming).toFixed(0)} OVR</strong> · {money(incoming.contract.salary)}</small><small>{state.teams[offer.counterpartyTeamId].fullName}</small></span><span className="trade-offer-fit"><b>Fit {evaluation.userFitAfter.toFixed(0)}</b><small>详情 ›</small></span></button>)}{visibleOffers.length === 0 && <div className="trade-console-empty">{offers.length ? "暂无匹配的交易报价，请提高薪资上限或重置筛选" : "选择本队球员并发起询价后，动态报价将在这里显示"}</div>}</div>
      </section>
    </div>
    {assetDrawerOpen && <div className="trade-console-sheet-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setAssetDrawerOpen(false)}><section className="trade-console-sheet" role="dialog" aria-modal="true"><div className="trade-sheet-grabber" /><header><b>选择我方交易筹码</b><button type="button" onClick={() => setAssetDrawerOpen(false)}>✕</button></header>{roster.map((player) => <button type="button" className={`trade-asset-option${player.id === selected ? " active" : ""}`} key={player.id} onClick={() => { setAssetDrawerOpen(false); void requestOffers(player.id, false); }}><span className="trade-avatar">{playerNameZh(player.name, player.id).slice(0, 1)}</span><span><b>{playerNameZh(player.name, player.id)} <em>{calculatePlayerOverall(player).toFixed(0)} OVR</em></b><small>{positionPairLabel(player.position, player.secondaryPosition)} · {money(player.contract.salary)} / 年</small></span>{player.id === selected && <strong>✓ 已选</strong>}</button>)}</section></div>}
    {sortDrawerOpen && <div className="trade-console-sheet-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setSortDrawerOpen(false)}><section className="trade-console-sheet trade-sort-sheet" role="dialog" aria-modal="true"><div className="trade-sheet-grabber" /><header><b>选择排序维度</b><button type="button" onClick={() => setSortDrawerOpen(false)}>✕</button></header>{([ ["FIT", "战术匹配度最高"], ["OVR", "球员能力值高→低"], ["SALARY_ASC", "薪资包低→高"], ["SALARY_DESC", "薪资包高→低"] ] as const).map(([value, label]) => <button type="button" className="trade-sort-option" key={value} onClick={() => { setSortMode(value); setSortDrawerOpen(false); }}><span>{label}</span>{sortMode === value && <b>✓</b>}</button>)}</section></div>}
    {detail && selectedPlayer && <div className="trade-detail-screen" role="dialog" aria-modal="true"><header><button type="button" onClick={() => setDetailOfferId(null)}>‹ 返回方案列表</button><b>NBA 交易评估细则</b><span /></header><div className="trade-detail-scroll"><section className="trade-detail-card"><div className="trade-detail-subhead"><b>{state.teams[state.userTeamId].fullName}</b><span>{state.teams[detail.offer.counterpartyTeamId].fullName}</span></div><div className="trade-detail-versus"><div><small>↑ 我方送出</small><span className="trade-avatar">{playerNameZh(selectedPlayer.name, selectedPlayer.id).slice(0, 1)}</span><b>{playerNameZh(selectedPlayer.name, selectedPlayer.id)}</b><em>{calculatePlayerOverall(selectedPlayer).toFixed(0)} OVR · {money(selectedPlayer.contract.salary)}</em></div><strong>VS</strong><div><small>↓ 对方送出</small><span className="trade-avatar incoming">{playerNameZh(detail.incoming.name, detail.incoming.id).slice(0, 1)}</span><b>{playerNameZh(detail.incoming.name, detail.incoming.id)}</b><em>{calculatePlayerOverall(detail.incoming).toFixed(0)} OVR · {money(detail.incoming.contract.salary)}</em></div></div></section><section className="trade-detail-card"><div className="trade-console-card-heading"><b>NBA 薪资配平规则校验</b><span className={detail.evaluation.legal ? "trade-pass" : "trade-fail"}>{detail.evaluation.legal ? "✓ 配平通过" : "✕ 不符合交易规则"}</span></div><div className="trade-salary-line"><span>送出 <b>{money(detail.evaluation.outgoingSalary)}</b></span><span>接收 <b>{money(detail.evaluation.incomingSalary)}</b></span></div><div className="trade-salary-bar"><i style={{ width: `${Math.round(detail.evaluation.outgoingSalary / Math.max(1, detail.evaluation.outgoingSalary + detail.evaluation.incomingSalary) * 100)}%` }} /><i /></div><small>薪资差额：{money(Math.abs(detail.evaluation.salaryDifference))}{detail.evaluation.reason ? ` · ${detail.evaluation.reason}` : " · 符合 NBA 劳资协议规定"}</small></section><section className="trade-detail-card"><h4>战术评级与对方 GM 态度</h4><div className="trade-detail-score-grid"><span><small>战术 Fit 评分</small><b>{detail.evaluation.userFitAfter.toFixed(0)} ({detail.evaluation.userFitDelta >= 0 ? "+" : ""}{detail.evaluation.userFitDelta.toFixed(1)})</b></span><span><small>对方 GM 意愿</small><b>{detail.evaluation.gmWillingness}</b></span></div><p>{detail.evaluation.legal ? "这份方案符合双方当前的阵容规划与薪资要求。" : detail.evaluation.reason ?? "这份方案暂不满足交易规则。"}</p></section></div><footer><button type="button" onClick={() => setDetailOfferId(null)}>放弃</button><button data-testid="trade-accept" type="button" disabled={busy || !detail.evaluation.legal} onClick={() => { void onTradeCommand({ commandId: `accept-trade-${detail.offer.offerId}`, type: "ACCEPT_TRADE_OFFER", payload: { offerId: detail.offer.offerId } }).then(() => setDetailOfferId(null)); }}>✎ 达成交易协议</button></footer></div>}
    {onCloseMarket && <footer className="trade-center-footer"><button data-testid="trade-end-market" type="button" disabled={busy || closeMarketDisabled} onClick={onCloseMarket}>结束自由市场并进入名单锁定 ➔</button></footer>}
  </section>;
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
  return <section className="flow-card preseason-terminal"><header className="terminal-top-bar"><span>季前准备 · 阵容微调与指定训练</span><strong>PRE-SEASON</strong></header><div className="terminal-metrics-grid"><span><b>{focusedCount} / {BALANCE_CONFIG.training.maxFocusedPlayers}</b><small>重点培养</small></span><span><b>{roster.length}</b><small>标准名单</small></span><span><b className={roster.length > LEAGUE_FINANCE_CONFIG.rosterLimits.regularSeasonMaximum ? "warning" : ""}>{Math.max(0, LEAGUE_FINANCE_CONFIG.rosterLimits.regularSeasonMaximum - roster.length)}</b><small>{roster.length > LEAGUE_FINANCE_CONFIG.rosterLimits.regularSeasonMaximum ? `需裁 ${roster.length - LEAGUE_FINANCE_CONFIG.rosterLimits.regularSeasonMaximum} 人` : "空余名额"}</small></span></div><div className="terminal-notice preseason-notice"><p><strong>培养说明：</strong>每赛季最多指定 {BALANCE_CONFIG.training.maxFocusedPlayers} 人，训练改变成长权重与成功概率，不直接固定增加属性。点击球员可查看完整信息卡。</p></div><div className="terminal-section-header"><b>常规赛名单</b><span>需调整至 {LEAGUE_FINANCE_CONFIG.rosterLimits.regularSeasonMinimum}～{LEAGUE_FINANCE_CONFIG.rosterLimits.regularSeasonMaximum} 人</span></div><div className="preseason-roster-list">{roster.map((player) => {
    const focus = assignments[player.id];
    return <article className="preseason-roster-card" key={player.id}><button type="button" className="preseason-player-open" data-testid={`preseason-player-${player.id}`} onClick={() => setSelectedPlayerId(player.id)}><span className="preseason-position-mark">{positionLabel(player.position)}</span><span className="preseason-player-copy"><span className="preseason-player-name-row"><b>{playerNameZh(player.name, player.id)}</b><em>能力 {calculatePlayerOverall(player).toFixed(0)}</em></span><small>{money(player.contract.salary)} · {player.contract.yearsRemaining} 年 · {player.age} 岁</small></span></button><div className="preseason-player-actions"><select aria-label={`${playerNameZh(player.name, player.id)} 训练重点`} value={focus ?? ""} disabled={busy || (!focus && focusedCount >= BALANCE_CONFIG.training.maxFocusedPlayers)} onChange={(event) => {
      const nextFocus = event.target.value === "" ? null : event.target.value as TrainingFocus;
      void onRosterCommand({ commandId: `training-${state.league.seasonId}-${player.id}-${nextFocus ?? "none"}`, type: "SET_TRAINING_FOCUS", payload: { playerId: player.id, focus: nextFocus } });
    }}><option value="">不指定</option>{TRAINING_FOCUS_OPTIONS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><button type="button" data-testid={`preseason-waive-${player.id}`} disabled={busy || roster.length <= LEAGUE_FINANCE_CONFIG.rosterLimits.regularSeasonMinimum} onClick={() => setPendingWaivePlayerId(player.id)}>裁员</button></div></article>;
  })}</div><div className="terminal-sticky-action"><button className="terminal-primary-button" disabled={busy || roster.length > LEAGUE_FINANCE_CONFIG.rosterLimits.regularSeasonMaximum} onClick={() => onRosterCommand({ commandId: `lock-opening-roster-${state.league.seasonId}`, type: "LOCK_OPENING_ROSTER", payload: { confirmMinimumFill: true } })}>锁定名单并进入常规赛 ➔</button></div>
    {selectedPlayer && <div className="player-detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedPlayerId(null); }}><section className="reference-player-dialog" role="dialog" aria-modal="true" aria-label={`${playerNameZh(selectedPlayer.name, selectedPlayer.id)} 球员详情`}><button className="detail-close" type="button" onClick={() => setSelectedPlayerId(null)} aria-label="关闭">×</button><ReferencePlayerCard player={selectedPlayer} teamName={state.teams[selectedPlayer.teamId]?.fullName ?? "自由球员"} /></section></div>}
    {pendingWaivePlayer && <div className="player-detail-backdrop preseason-confirm-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setPendingWaivePlayerId(null); }}><section className="preseason-waive-dialog" data-testid="preseason-waive-dialog" role="alertdialog" aria-modal="true" aria-labelledby="preseason-waive-title" aria-describedby="preseason-waive-description"><span className="preseason-waive-icon" aria-hidden="true">!</span><div><small>ROSTER TRANSACTION</small><h2 id="preseason-waive-title">确认裁掉 {playerNameZh(pendingWaivePlayer.name, pendingWaivePlayer.id)}？</h2><p id="preseason-waive-description">该操作会立即移出球队名单；剩余保障金额 {money(pendingWaivePlayer.contract.guaranteedAmount)} 将按合同年份计入死钱。</p><div className="preseason-waive-summary"><span>裁员后名单 <b>{roster.length - 1} 人</b></span><span>球员状态 <b>完全自由球员</b></span></div><div className="preseason-waive-actions"><button type="button" data-testid="preseason-waive-cancel" disabled={busy} onClick={() => setPendingWaivePlayerId(null)}>取消</button><button type="button" className="danger" data-testid="preseason-waive-confirm" disabled={busy} onClick={() => void onRosterCommand({ commandId: `waive-${state.league.seasonId}-${pendingWaivePlayer.id}`, type: "WAIVE_PLAYER", payload: { playerId: pendingWaivePlayer.id } }).finally(() => setPendingWaivePlayerId(null))}>确认裁员</button></div></div></section></div>}
  </section>;
}

function FreeAgencyHub({ state, busy, onFreeAgencyCommand }: Pick<Stage4FlowProps, "state" | "busy" | "onFreeAgencyCommand">) {
  const freeAgency = state.freeAgency;
  const [positionFilter, setPositionFilter] = useState<ExpansionPositionFilter>("ALL");
  const [rosterPositionFilter, setRosterPositionFilter] = useState<ExpansionPositionFilter>("ALL");
  const [rosterOpen, setRosterOpen] = useState(true);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  useEffect(() => {
    if (!selectedPlayerId) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedPlayerId(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [selectedPlayerId]);
  if (!freeAgency) return null;
  const players = getFreeAgents(state);
  const currentTeamId = getCurrentTeamId(state);
  const currentTeam = state.teams[currentTeamId];
  const sheet = getCapSheet(state, currentTeamId);
  const pending = freeAgency.pendingUserRfaDecision;
  const activeUserOffers = Object.values(freeAgency.offers).filter((offer) => offer.teamId === currentTeamId && offer.status === "ACTIVE");
  const roster = getCurrentTeamRoster(state);
  const filteredRoster = roster.filter((player) => matchesExpansionPosition(player, rosterPositionFilter));
  const rosterPositionCounts = getCurrentRosterPositionCounts(roster);
  const rosterPositionSummary = getCurrentRosterPositionSummary(roster);
  const selectedPlayer = selectedPlayerId ? state.players[selectedPlayerId] : undefined;
  const selectedPlayerTeamName = selectedPlayer && roster.some((player) => player.id === selectedPlayer.id)
    ? currentTeam.fullName
    : "自由球员";
  const visiblePlayers = players.filter((player) => positionFilter === "ALL" || player.position === positionFilter || player.secondaryPosition === positionFilter);
  const positionCounts = (position: ExpansionPositionFilter) => position === "ALL" ? players.length : players.filter((player) => player.position === position || player.secondaryPosition === position).length;
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
      <details className="draft-current-roster-panel" open={rosterOpen} onToggle={(event) => setRosterOpen(event.currentTarget.open)} data-testid="free-agency-current-roster"><summary><span><span className="draft-team-mark">{currentTeam.logoUrl ? <img src={currentTeam.logoUrl} alt="" /> : currentTeam.abbreviation}</span><span><b>当前球队阵容</b><small>{roster.length} / {LEAGUE_FINANCE_CONFIG.rosterLimits.offseasonMaximum} 人 · {rosterOpen ? "报价后实时更新" : rosterPositionSummary}</small></span></span><em>{rosterOpen ? "收起阵容" : "展开阵容"}</em></summary><div className="draft-current-roster-body"><div className="draft-current-roster-filter" role="group" aria-label="按第一位置筛选当前阵容">{EXPANSION_POSITION_FILTERS.map((position) => { const count = position === "ALL" ? roster.length : rosterPositionCounts.find((entry) => entry.position === position)?.count ?? 0; return <button type="button" key={position} className={rosterPositionFilter === position ? "active" : ""} aria-pressed={rosterPositionFilter === position} onClick={() => setRosterPositionFilter(position)}><b>{position === "ALL" ? "全部" : position}</b><small>{count}</small></button>; })}</div>{roster.length > 0 ? <div className="draft-current-roster-grid">{filteredRoster.map((player) => <button type="button" data-testid={`free-agency-roster-player-${player.id}`} key={player.id} onClick={() => setSelectedPlayerId(player.id)}><span><b>{playerNameZh(player.name, player.id)}</b><small>{positionPairLabel(player.position, player.secondaryPosition)} · 年薪 {money(player.contract.salary)}</small></span><em><small>OVR</small>{calculatePlayerOverall(player).toFixed(0)}</em></button>)}{filteredRoster.length === 0 && <div className="draft-current-roster-empty"><b>该位置暂无球员</b><span>请选择其他第一位置查看阵容。</span></div>}</div> : <div className="draft-current-roster-empty"><b>当前阵容暂无球员</b><span>完成签约后，球员会显示在这里。</span></div>}</div></details>
      <div className="fa-notice"><b>名单规则</b><span>休赛期 {roster.length}/{LEAGUE_FINANCE_CONFIG.rosterLimits.offseasonMaximum} · 开季上限 {LEAGUE_FINANCE_CONFIG.rosterLimits.regularSeasonMaximum}{roster.length > LEAGUE_FINANCE_CONFIG.rosterLimits.regularSeasonMaximum ? ` · 需调整 ${roster.length - LEAGUE_FINANCE_CONFIG.rosterLimits.regularSeasonMaximum} 人` : ""}</span></div>
      <div className="fa-market-heading"><div><b>自由球员列表</b><small>({players.length} 人)</small></div></div>
      <div className="fa-position-tabs">{(["ALL", "PG", "SG", "SF", "PF", "C"] as const).map((position) => <button key={position} className={positionFilter === position ? "active" : ""} onClick={() => setPositionFilter(position)}><b>{position === "ALL" ? "全部" : position}</b><small>{positionCounts(position)}</small></button>)}</div>
      <div className="free-agency-player-list fa-reference-player-list">{visiblePlayers.length === 0 ? <div className="fa-empty">该位置暂无可用自由球员</div> : visiblePlayers.map((player) => {
        const existing = activeUserOffers.find((offer) => offer.playerId === player.id);
        const ability = Math.round(calculatePlayerOverall(player));
        const preview = getFreeAgentOfferPreview(state, player.id);
        const offer = preview.draft;
        const market = freeAgency.markets[player.id];
        return <article className="fa-reference-player-card" key={player.id} role="button" tabIndex={0} aria-label={`查看${playerNameZh(player.name, player.id)}球员详情`} onClick={(event) => { if ((event.target as HTMLElement).closest("button")) return; setSelectedPlayerId(player.id); }} onKeyDown={(event) => { if (event.key !== "Enter" && event.key !== " ") return; event.preventDefault(); setSelectedPlayerId(player.id); }}><div className="fa-player-copy"><div><b>{playerNameZh(player.name, player.id)}</b><em>{positionPairLabel(player.position, player.secondaryPosition)}</em></div><small>球队 <strong>自由球员</strong>　|　综合 <strong className="rating">{ability}</strong>　|　年龄 <strong>{player.age}岁</strong></small><small>{existing ? "已报价年薪" : "建议年薪"} <strong className="cyan">{money(existing?.year1Salary ?? offer.year1Salary)}</strong>　|　签约 <strong>{existing?.years ?? offer.years} 年</strong></small><small className={`deadline${!existing && preview.reason ? " blocked" : ""}`}>{existing ? "报价等待中" : preview.reason ?? (market?.marketWindowStatus === "OPEN" ? `第 ${market.decisionDeadline} 天截止` : "等待首份报价")}</small></div>{existing ? <button className="withdraw" disabled={busy} onClick={() => onFreeAgencyCommand({ commandId: `withdraw-${existing.offerId}`, type: "WITHDRAW_FA_OFFER", payload: { offerId: existing.offerId } })}>撤回</button> : <button className="fa-offer-button" title={preview.reason} disabled={busy || !preview.valid} onClick={() => onFreeAgencyCommand({ commandId: `offer-${state.league.seasonId}-${freeAgency.currentDay}-${player.id}`, type: "SUBMIT_FA_OFFER", payload: { playerId: player.id, ...offer } })}>{preview.valid ? "发起报价" : preview.reason === "可用薪资空间不足" ? "空间不足" : preview.reason === "球队名单已满" ? "名单已满" : "暂不可报价"}</button>}</article>;
      })}</div>
      {freeAgency.transactionLog.length > 0 && <div className="transaction-feed"><b>联盟动态</b>{freeAgency.transactionLog.slice(0, 5).map((entry, index) => <span key={`${index}-${entry}`}>{humanizeUiText(entry)}</span>)}</div>}
      {selectedPlayer && <div className="player-detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedPlayerId(null); }}><section className="reference-player-dialog" role="dialog" aria-modal="true" aria-label={`${playerNameZh(selectedPlayer.name, selectedPlayer.id)} 球员详情`}><button className="detail-close" type="button" onClick={() => setSelectedPlayerId(null)} aria-label="关闭球员详情">×</button><ReferencePlayerCard player={selectedPlayer} teamName={selectedPlayerTeamName} /></section></div>}
      </div>
      <div className="fa-settle-footer"><div><b>第 {freeAgency.currentDay} 天市场结算</b><small>{pending ? `${playerNameZh(state.players[pending.playerId].name, state.players[pending.playerId].id)} 的报价单待决定` : "推进一天并结算所有有效报价"}</small></div>{pending ? <div className="fa-settle-actions"><button disabled={busy} onClick={() => onFreeAgencyCommand({ commandId: `rfa-match-${pending.offerId}`, type: "RESOLVE_USER_RFA", payload: { decision: "MATCH" } })}>匹配</button><button className="decline" disabled={busy} onClick={() => onFreeAgencyCommand({ commandId: `rfa-decline-${pending.offerId}`, type: "RESOLVE_USER_RFA", payload: { decision: "DECLINE" } })}>放弃</button></div> : <button disabled={busy} onClick={() => onFreeAgencyCommand({ commandId: `fa-day-${state.league.seasonId}-${freeAgency.currentDay}`, type: "ADVANCE_FA_DAY", payload: {} })}>{busy ? "结算中…" : "结算今日 ➜"}</button>}</div>
    </section>
  );
}
