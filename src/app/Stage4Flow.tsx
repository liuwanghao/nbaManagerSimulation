import { LEAGUE_FINANCE_CONFIG } from "../config/leagueFinance";
import { getCapSheet } from "../game/cap/CapSheetService";
import { getAvailableDraftProspects, type DraftCommand } from "../game/draft/DraftService";
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
  onLoad: (slot?: 1 | 2 | 3) => Promise<void>;
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
  return (
    <main className={`app-shell expansion-shell${spotlightPhase ? " scene-stage" : ""}${rookieDraftScreen ? " rookie-draft-shell" : ""}`}>
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
  const draft = state.rookieDraft;
  if (!draft) return null;
  const pick = draft.pickOrder[draft.currentPickIndex];
  const prospects = getAvailableDraftProspects(state);
  const myPicks = draft.pickOrder.filter((entry) => entry.ownerTeamId === state.userTeamId);
  const playerTurn = pick.ownerTeamId === state.userTeamId;
  const draftedCount = draft.currentPickIndex;
  return (
    <section className="flow-card draft-card rookie-draft-terminal">
      <header className="draft-sim-bar"><span>DRAFT SIMULATOR · {state.league.seasonId}</span><b className={playerTurn ? "action" : ""}>{playerTurn ? "▶ 轮到你的选择" : "电脑球队选秀中"}</b></header>
      <div className={`draft-live-feed${playerTurn ? " action" : ""}`}><span>LIVE</span><p>{playerTurn ? `[ACTION REQUIRED] 第 #${pick.pickNumber} 顺位轮到 ${state.teams[state.userTeamId].fullName} 选择。` : `[PICK #${pick.pickNumber}] ${state.teams[pick.ownerTeamId].fullName} 正在提交选择…`}</p></div>
      <div className="draft-dashboard-grid">
        <div><small>正在选秀</small><b>#{pick.pickNumber}</b><span>{state.teams[pick.ownerTeamId].fullName}</span></div>
        <div><small>你的签位</small><b>{myPicks.filter((entry) => entry.playerId).length}/{myPicks.length}</b><span>{myPicks.map((entry) => `#${entry.pickNumber}`).join(" · ")}</span></div>
      </div>
      {draft.source === "CURATED_2026" && <div className="draft-terminal-info compact"><span>i</span><p><b>2026 真实选秀重演</b>你选中的真实新秀会从原球队计划中移除；电脑球队随后按剩余真实榜单顺延。</p></div>}
      <div className="draft-terminal-section"><b>选秀榜单 · 实时推荐</b><span>{prospects.length} 人可选 · 已完成 {draftedCount}/64</span></div>
      <div className="player-pool rookie-pool draft-terminal-player-list">
        {prospects.slice(0, 24).map((player, index) => (
          <article className="player-row rookie-row draft-terminal-player" key={player.id}>
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
  if (state.freeAgency?.opened) return <section className="prototype-market-workspace"><FreeAgencyHub state={state} busy={busy} onFreeAgencyCommand={onFreeAgencyCommand} /><details className="prototype-secondary-panel"><summary><span>球员交易中心</span><b>展开</b></summary><TradeDesk state={state} busy={busy} onTradeCommand={onTradeCommand} /></details><div className="prototype-sticky-action"><button className="primary-cta" disabled={busy || Boolean(state.freeAgency.pendingUserRfaDecision)} onClick={() => onRosterCommand({ commandId: `close-free-agency-${state.league.seasonId}`, type: "CLOSE_FREE_AGENCY", payload: {} })}>结束自由市场并进入名单锁定 →</button></div></section>;
  const draft = state.rookieDraft;
  const team = state.teams[state.userTeamId];
  const sheet = getCapSheet(state, state.userTeamId);
  const myPicks = draft?.pickOrder.filter((pick) => pick.ownerTeamId === state.userTeamId && pick.playerId) ?? [];
  return (
    <section className="flow-card complete-card prototype-extended-flow prototype-complete-screen">
      <FlowHeading step="新秀选秀完成" title="64 个签位已完成" description="新秀合同已自动生成，落选秀已进入完全自由球员池。" badge="选秀完成" icon="✓" />
      <SectionBar title="本队新秀" meta={`${myPicks.length} 人`} />
      <div className="rookie-result-list">
        {myPicks.map((pick) => {
          const player = state.players[pick.playerId as string];
          return <div key={pick.pickNumber}><span>#{pick.pickNumber}</span><b>{playerNameZh(player.name, player.id)}</b><small>{positionLabel(player.position)} · 潜力评级 {player.scoutedPotentialGrade} · {money(player.contract.salary)}</small></div>;
        })}
      </div>
      <SectionBar title="球队资源" meta="休赛期名单上限 21 人" />
      <div className="cap-card">
        <div><span>工资帽</span><b>{money(LEAGUE_FINANCE_CONFIG.salaryCap)}</b></div>
        <div><span>薪资表</span><b>{money(sheet.total)}</b></div>
        <div><span>可用空间</span><b className={sheet.availableCapSpace < 0 ? "negative" : ""}>{money(sheet.availableCapSpace)}</b></div>
        <div><span>休赛期名单</span><b>{team.playerIds.length} / 21</b></div>
      </div>
      <div className="prototype-info-note"><span>i</span><p><b>下一阶段</b>开放常规交易、受限自由球员报价单与 3 日决策窗口。</p></div>
      <div className="prototype-sticky-action"><button className="primary-cta" disabled={busy} onClick={() => onFreeAgencyCommand({ commandId: `enter-free-agency-${state.league.seasonId}`, type: "ENTER_FREE_AGENCY", payload: {} })}>进入自由市场 →</button></div>
    </section>
  );
}

export function TradeDesk({ state, busy, onTradeCommand }: Pick<Stage4FlowProps, "state" | "busy" | "onTradeCommand">) {
  const roster = state.teams[state.userTeamId].playerIds.map((id) => state.players[id]).sort((a, b) => b.contract.salary - a.contract.salary);
  const selected = state.tradeDesk.selectedPlayerId;
  const requestOffers = (playerId: string, refresh: boolean) => onTradeCommand({ commandId: `trade-query-${playerId}-${refresh ? (state.tradeDesk.offers[0]?.inquiryCount ?? 0) + 1 : 0}`, type: "GENERATE_TRADE_OFFERS", payload: { playerId, refresh } });
  return <section className="prototype-trade-center"><b>发起询价（获取 3 个动态报价）</b><select aria-label="选择要送出的球员" value={selected ?? ""} disabled={busy} onChange={(event) => { if (event.target.value) void requestOffers(event.target.value, false); }}><option value="">选择要送出的球员...</option>{roster.slice(0, 16).map((player) => <option value={player.id} key={player.id}>{playerNameZh(player.name, player.id)} · {money(player.contract.salary)}</option>)}</select><button className="prototype-refresh-offers" disabled={busy || !selected} onClick={() => selected && void requestOffers(selected, true)}>刷新市场报价</button>{state.tradeDesk.offers.length > 0 && <div className="trade-offers">{state.tradeDesk.offers.map((offer) => { const incoming = state.players[offer.userIncomingPlayerIds[0]]; const outgoingIds = new Set(offer.userOutgoingPlayerIds); const currentPlayers = state.teams[state.userTeamId].playerIds.map((id) => state.players[id]); const before = calculateTeamFitForPlayers(currentPlayers); const after = calculateTeamFitForPlayers([...currentPlayers.filter((player) => !outgoingIds.has(player.id)), ...offer.userIncomingPlayerIds.map((id) => state.players[id])]); const delta = after.score - before.score; return <article key={offer.offerId}><span>{state.teams[offer.counterpartyTeamId].name}</span><b>{playerNameZh(incoming.name, incoming.id)} · {positionLabel(incoming.position)}</b><small>{money(incoming.contract.salary)}{offer.userIncomingPickIds.length ? " + 次轮签" : ""}</small><small className="trade-fit">适配度 {before.score.toFixed(0)} → {after.score.toFixed(0)} · {delta >= 0 ? "+" : ""}{delta.toFixed(1)}</small><button onClick={() => onTradeCommand({ commandId: `accept-trade-${offer.offerId}`, type: "ACCEPT_TRADE_OFFER", payload: { offerId: offer.offerId } })}>接受报价</button></article>; })}</div>}</section>;
}

function RosterLock({ state, busy, onRosterCommand }: Pick<Stage4FlowProps, "state" | "busy" | "onRosterCommand">) {
  const roster = state.teams[state.userTeamId].playerIds.map((id) => state.players[id]).sort((a, b) => a.contract.salary - b.contract.salary);
  const assignments = state.trainingPlan?.seasonId === state.league.seasonId ? state.trainingPlan.assignments : {};
  const focusedCount = Object.keys(assignments).length;
  return <section className="flow-card prototype-extended-flow roster-lock-screen"><FlowHeading step="04 / 开季名单锁定" title={`开季名单 · ${roster.length}/15`} description="确定重点培养计划，并将名单调整到常规赛标准。" badge={roster.length > 15 ? `需裁 ${roster.length - 15} 人` : "人数合规"} icon="▤" /><div className="metrics-row"><span><b>{focusedCount} / 2</b>重点培养</span><span><b>{roster.length}</b>标准名单</span><span><b>{Math.max(0, 15 - roster.length)}</b>空余名额</span></div><div className="prototype-info-note"><span>i</span><p><b>训练规则</b>每赛季最多指定 2 人；训练改变成长权重与成功概率，不直接固定增加属性。</p></div><SectionBar title="球员与训练计划" meta="常规赛名单 14～15 人" /><div className="player-pool prototype-training-list">{roster.map((player) => {
    const focus = assignments[player.id];
    return <article className="player-row training-row" key={player.id}><span className="source-mark">{positionLabel(player.position)}</span><div><b>{playerNameZh(player.name, player.id)}</b><small>{money(player.contract.salary)} · {player.contract.yearsRemaining} 年</small></div><select aria-label={`${playerNameZh(player.name, player.id)} 训练重点`} value={focus ?? ""} disabled={busy || (!focus && focusedCount >= 2)} onChange={(event) => {
      const nextFocus = event.target.value === "" ? null : event.target.value as TrainingFocus;
      void onRosterCommand({ commandId: `training-${state.league.seasonId}-${player.id}-${nextFocus ?? "none"}`, type: "SET_TRAINING_FOCUS", payload: { playerId: player.id, focus: nextFocus } });
    }}><option value="">不指定</option>{TRAINING_FOCUS_OPTIONS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><button disabled={busy || roster.length <= 14} onClick={() => onRosterCommand({ commandId: `waive-${state.league.seasonId}-${player.id}`, type: "WAIVE_PLAYER", payload: { playerId: player.id } })}>裁员</button></article>;
  })}</div><div className="prototype-sticky-action"><button className="primary-cta" disabled={busy || roster.length > 15} onClick={() => onRosterCommand({ commandId: `lock-opening-roster-${state.league.seasonId}`, type: "LOCK_OPENING_ROSTER", payload: { confirmMinimumFill: true } })}>锁定名单并进入常规赛 →</button></div></section>;
}

function FreeAgencyHub({ state, busy, onFreeAgencyCommand }: Pick<Stage4FlowProps, "state" | "busy" | "onFreeAgencyCommand">) {
  const freeAgency = state.freeAgency;
  if (!freeAgency) return null;
  const players = getFreeAgents(state);
  const sheet = getCapSheet(state, state.userTeamId);
  const pending = freeAgency.pendingUserRfaDecision;
  const activeUserOffers = Object.values(freeAgency.offers).filter((offer) => offer.teamId === state.userTeamId && offer.status === "ACTIVE");
  return (
    <section className="flow-card free-agency-card prototype-extended-flow">
      <FlowHeading step="03 / 自由市场" title={`自由市场 · 第 ${freeAgency.currentDay} 天`} description="首份合法报价开启固定 3 日决策窗口，后续报价不延长截止日。" badge={`${players.length} 人可签`} icon="$" />
      <div className="metrics-row"><span><b>{players.length}</b>可签球员</span><span><b>{activeUserOffers.length}</b>本队报价</span><span><b>{money(sheet.availableCapSpace)}</b>可用空间</span></div>
      <div className="prototype-market-control"><div><b>今日市场结算</b><span>{pending ? "请先处理受限自由球员报价单" : "推进一天并结算所有有效报价"}</span></div><button disabled={busy || Boolean(pending)} onClick={() => onFreeAgencyCommand({ commandId: `fa-day-${state.league.seasonId}-${freeAgency.currentDay}`, type: "ADVANCE_FA_DAY", payload: {} })}>结算今日</button></div>
      {pending && <div className="rfa-decision"><b>受限自由球员报价单待处理</b><span>{playerNameZh(state.players[pending.playerId].name, state.players[pending.playerId].id)} · 第 {pending.deadline} 天截止</span><div><button onClick={() => onFreeAgencyCommand({ commandId: `rfa-match-${pending.offerId}`, type: "RESOLVE_USER_RFA", payload: { decision: "MATCH" } })}>匹配报价</button><button className="decline" onClick={() => onFreeAgencyCommand({ commandId: `rfa-decline-${pending.offerId}`, type: "RESOLVE_USER_RFA", payload: { decision: "DECLINE" } })}>放弃匹配</button></div></div>}
      <SectionBar title="自由球员榜单" meta="按综合能力排序" />
      <div className="player-pool fa-pool">
        {players.slice(0, 24).map((player) => {
          const existing = activeUserOffers.find((offer) => offer.playerId === player.id);
          const ability = Math.round(calculatePlayerOverall(player));
          const salary = Math.max(1_300_000, Math.min(35_000_000, Math.round(Math.max(1, ability - 52) * 900_000 / 100_000) * 100_000));
          const market = freeAgency.markets[player.id];
          return (
            <article className="fa-row" key={player.id}>
              <span className={`fa-status ${player.contract.status.toLowerCase()}`}>{contractStatusLabel(player.contract.status)}</span>
              <div><b>{playerNameZh(player.name, player.id)}</b><small>{positionPairLabel(player.position, player.secondaryPosition)} · {player.age} 岁 · 能力 {ability} · {money(salary)} 起</small></div>
              <span className="window-label">{market?.marketWindowStatus === "OPEN" ? `第 ${market.decisionDeadline} 天截止` : "等待首份报价"}</span>
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
