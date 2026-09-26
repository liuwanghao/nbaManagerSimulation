import { useEffect, useRef, useState } from "react";
import { publicPlayerValue, tradeDraftPickValue } from "../game/ai/AIValueService";
import { calculatePlayerOverall } from "../game/player/PlayerRatingService";
import { LINEUP_POSITIONS } from "../game/roster/RotationPlanService";
import type { GameState, TradeOffer } from "../game/state/types";
import type { TeamFitBreakdown } from "../game/team/TeamFitService";
import { previewTradeImpact } from "../game/trade/TradeImpactPreview";
import type { TradeOfferEvaluation } from "../game/trade/TradeService";
import { PlayerPortrait } from "./PlayerPortrait";
import { ReferencePlayerCard } from "./ReferencePlayerCard";
import { playerNameZh } from "./playerNameZh";
import { playerRatingStyle } from "./playerRatingColor";
import { tradePickLabel } from "./tradeView";
import { moneyLabel, positionPairLabel } from "./uiText";

const fitAreas: Array<{ key: keyof TeamFitBreakdown; label: string }> = [
  { key: "creation", label: "组织" },
  { key: "spacing", label: "空间" },
  { key: "perimeterDefense", label: "外线防守" },
  { key: "rimProtection", label: "护框" },
  { key: "rebounding", label: "篮板" },
  { key: "sizeBalance", label: "位置覆盖" },
  { key: "benchDepth", label: "板凳深度" },
  { key: "usageConflict", label: "球权分配" },
];

const signed = (value: number, digits = 1): string => `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;
const trend = (value: number): string => value > 0.05 ? "positive" : value < -0.05 ? "negative" : "neutral";

function AssetColumn({ state, playerIds, pickIds, title, teamName, incoming, onOpenPlayer }: {
  state: GameState;
  playerIds: string[];
  pickIds: string[];
  title: string;
  teamName: string;
  incoming: boolean;
  onOpenPlayer: (id: string, trigger: HTMLButtonElement) => void;
}) {
  return <div className={`trade-detail-asset-column${incoming ? " incoming" : ""}`} data-testid={incoming ? "trade-assets-incoming" : "trade-assets-outgoing"}>
    <header><b>{title}</b><small>{teamName}</small></header>
    <div className="trade-detail-asset-items">
      {playerIds.map((id) => {
        const player = state.players[id];
        if (!player) return null;
        const overall = calculatePlayerOverall(player);
        return <button className="trade-detail-asset-item player" type="button" key={`player-${id}`} aria-label={`查看${playerNameZh(player.name, player.id)}球员资料`} onClick={(event) => onOpenPlayer(id, event.currentTarget)}>
          <div className="trade-detail-asset-primary">
            <PlayerPortrait player={player} portraitPath={player.portraitPath} className="trade-avatar" />
            <div className="trade-detail-asset-identity"><b>{playerNameZh(player.name, player.id)}</b><small>{positionPairLabel(player.position, player.secondaryPosition)}</small></div>
            <strong className="trade-detail-asset-overall"><small>OVR</small><b className="player-rating-tone" style={playerRatingStyle(overall)}>{overall.toFixed(0)}</b></strong>
          </div>
          <div className="trade-detail-asset-meta"><small>年薪 {moneyLabel(player.contract.salary)}</small><span className="trade-detail-asset-value">估值 <b>{publicPlayerValue(player).toFixed(1)}</b></span></div>
        </button>;
      })}
      {pickIds.map((id) => <article className="trade-detail-asset-item pick" key={`pick-${id}`}>
        <div className="trade-detail-asset-primary"><span aria-hidden="true">签</span><div className="trade-detail-asset-identity"><b>{tradePickLabel(state, id)}</b><small>选秀权</small></div></div>
        <div className="trade-detail-asset-meta"><span className="trade-detail-asset-value">估值 <b>{state.draftPicks[id] ? tradeDraftPickValue(state, state.draftPicks[id]).toFixed(1) : "—"}</b></span></div>
      </article>)}
      {playerIds.length + pickIds.length === 0 && <p className="trade-detail-asset-empty">无资产</p>}
    </div>
  </div>;
}

export function TradeOfferDetail({ state, offer, evaluation, busy, onBack, onAccept }: {
  state: GameState;
  offer: TradeOffer;
  evaluation: TradeOfferEvaluation;
  busy: boolean;
  onBack: () => void;
  onAccept: () => void;
}) {
  const backButtonRef = useRef<HTMLButtonElement>(null);
  const playerCloseButtonRef = useRef<HTMLButtonElement>(null);
  const playerTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const selectedPlayer = selectedPlayerId ? state.players[selectedPlayerId] : null;
  const closePlayer = () => {
    setSelectedPlayerId(null);
    playerTriggerRef.current?.focus();
  };
  useEffect(() => {
    if (!selectedPlayerId) return;
    playerCloseButtonRef.current?.focus();
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        closePlayer();
      }
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [selectedPlayerId]);
  const openPlayer = (id: string, trigger: HTMLButtonElement) => {
    playerTriggerRef.current = trigger;
    setSelectedPlayerId(id);
  };
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    backButtonRef.current?.focus();
    return () => { if (previousFocus?.isConnected) previousFocus.focus(); };
  }, []);
  const preview = previewTradeImpact(state, offer.offerId);
  const teamName = state.teams[state.userTeamId]?.fullName ?? "我方";
  const otherName = state.teams[offer.counterpartyTeamId]?.fullName ?? "对方";
  const fitChanges = preview ? fitAreas.map(({ key, label }) => ({ label, before: preview.fitBefore[key], after: preview.fitAfter[key] }))
    .map((entry) => ({ ...entry, delta: entry.after - entry.before }))
    .filter((entry) => Math.abs(entry.delta) >= 0.05)
    .sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta)).slice(0, 2) : [];
  const starterChanges = preview ? LINEUP_POSITIONS.filter((slot) => preview.startersBefore[slot] !== preview.startersAfter[slot]) : [];
  const retainedMinuteChanges = preview ? state.teams[state.userTeamId].playerIds
    .filter((id) => !offer.userOutgoingPlayerIds.includes(id))
    .map((id) => ({ id, before: preview.minutesBefore[id] ?? 0, after: preview.minutesAfter[id] ?? 0 }))
    .filter(({ before, after }) => Math.abs(after - before) >= 2)
    .sort((left, right) => Math.abs(right.after - right.before) - Math.abs(left.after - left.before)).slice(0, 2) : [];

  return <div className="trade-detail-screen" role="dialog" aria-modal="true" aria-label="交易方案详情">
    <header><button ref={backButtonRef} type="button" onClick={onBack}>‹ 返回报价</button><b>交易方案详情</b><span className={evaluation.legal ? "trade-detail-status legal" : "trade-detail-status invalid"}>{evaluation.legal ? "可成交" : "方案失效"}</span></header>
    <div className="trade-detail-scroll">
      <section className="trade-detail-card trade-detail-assets"><div className="manage-section-heading"><div><h3>交易资产</h3></div></div>
        <div className="trade-detail-asset-columns">
          <AssetColumn state={state} playerIds={offer.userOutgoingPlayerIds} pickIds={offer.userOutgoingPickIds} title="我方送出" teamName={teamName} incoming={false} onOpenPlayer={openPlayer} />
          <AssetColumn state={state} playerIds={offer.userIncomingPlayerIds} pickIds={offer.userIncomingPickIds} title="我方得到" teamName={otherName} incoming onOpenPlayer={openPlayer} />
        </div>
        <div className="trade-detail-value-summary"><span>资产价值差 <small>收到 − 送出</small></span><b className={trend(evaluation.userValueDelta)}>{signed(evaluation.userValueDelta)}</b></div>
        <p className="trade-detail-value-note">估值参考球员能力层级、年龄、可见成长预期、合同及选秀权原球队强弱；不等同于球队实力。</p>
      </section>
      <section className="trade-detail-card trade-detail-salary"><div className="manage-section-heading"><div><h3>薪资与交易规则</h3></div><span className={evaluation.legal ? "trade-pass" : "trade-fail"}>{evaluation.legal ? "校验通过" : "无法成交"}</span></div>
        <div className="trade-detail-salary-grid"><span><small>我方送出年薪</small><b>{moneyLabel(evaluation.outgoingSalary)}</b></span><span><small>我方接收年薪</small><b>{moneyLabel(evaluation.incomingSalary)}</b></span></div>
        {preview && <p className="trade-detail-cap-space">本赛季工资帽空间 <b>{moneyLabel(preview.capSpaceBefore)} → {moneyLabel(preview.capSpaceAfter)}</b></p>}
        <p className="trade-detail-rule-note">{evaluation.reason ?? "已通过薪资配平、选秀权归属与名单人数校验。"}</p>
      </section>
      <section className="trade-detail-impact-section" aria-label="球队影响">
        <section className="trade-detail-intro"><h2>这笔交易会怎样改变球队？</h2><p>轮换与球队评分按成交后的阵容预览；实际比赛仍受状态和对手影响。</p></section>
        {preview ? <>
          <section className="trade-impact-overview" aria-label="交易后球队评分">
            <div><small>球队综合评分</small><strong>{preview.overallBefore.overall} <i>→</i> {preview.overallAfter.overall}</strong><em className={trend(preview.overallAfter.overall - preview.overallBefore.overall)}>{signed(preview.overallAfter.overall - preview.overallBefore.overall, 0)}</em></div>
            <div><small>战术适配</small><strong>{preview.fitBefore.score.toFixed(1)} <i>→</i> {preview.fitAfter.score.toFixed(1)}</strong><em className={trend(preview.fitAfter.score - preview.fitBefore.score)}>{signed(preview.fitAfter.score - preview.fitBefore.score)}</em></div>
          </section>
          <section className="trade-detail-card trade-impact-rotation"><div className="manage-section-heading"><div><h3>首发与轮换</h3></div><span>成交后自动调整</span></div>
            {starterChanges.length ? <div className="trade-impact-starters">{starterChanges.map((slot) => <p key={slot}><b>{slot}</b><span>{playerNameZh(state.players[preview.startersBefore[slot]]?.name ?? "", preview.startersBefore[slot])}</span><i>→</i><strong>{playerNameZh(state.players[preview.startersAfter[slot]]?.name ?? "", preview.startersAfter[slot])}</strong></p>)}</div> : <p className="trade-impact-muted">首发位置保持不变。</p>}
            <div className="trade-impact-minutes">
              {offer.userIncomingPlayerIds.map((id) => state.players[id] && <p key={`in-${id}`}><span>新援 {playerNameZh(state.players[id].name, id)}</span><b>预计 {preview.minutesAfter[id] ?? 0} 分钟</b></p>)}
              {offer.userOutgoingPlayerIds.map((id) => state.players[id] && <p key={`out-${id}`}><span>离队 {playerNameZh(state.players[id].name, id)}</span><b>原 {preview.minutesBefore[id] ?? 0} 分钟</b></p>)}
              {retainedMinuteChanges.map(({ id, before, after }) => <p key={`keep-${id}`}><span>{playerNameZh(state.players[id].name, id)}</span><b>{before} → {after} 分钟</b></p>)}
            </div>
          </section>
          <section className="trade-detail-card trade-impact-areas"><div className="manage-section-heading"><div><h3>阵容优劣变化</h3></div></div>
            {fitChanges.length ? <div className="trade-impact-area-list">{fitChanges.map(({ label, before, after, delta }) => <p key={label}><span>{label}</span><b>{before.toFixed(0)} → {after.toFixed(0)}</b><em className={trend(delta)}>{signed(delta)}</em></p>)}</div> : <p className="trade-impact-muted">主要阵容能力没有明显变化。</p>}
          </section>
        </> : <section className="trade-detail-card"><p className="trade-impact-muted">{evaluation.reason ?? "当前方案无法生成可靠的轮换预览。"}</p></section>}
      </section>
    </div>
    <footer><button data-testid="trade-accept" type="button" disabled={busy || !evaluation.legal} onClick={onAccept}>{busy ? "交易处理中…" : "确认达成交易"}</button></footer>
    {selectedPlayer && <div className="player-detail-backdrop trade-player-detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closePlayer(); }}><section className="reference-player-dialog" role="dialog" aria-modal="true" aria-label={`${playerNameZh(selectedPlayer.name, selectedPlayer.id)} 球员详情`}><button ref={playerCloseButtonRef} className="detail-close" type="button" onClick={closePlayer} aria-label="关闭球员详情">×</button><ReferencePlayerCard player={selectedPlayer} teamName={state.teams[selectedPlayer.teamId]?.fullName ?? "自由球员"} /></section></div>}
  </div>;
}
