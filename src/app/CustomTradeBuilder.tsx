import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { tradeDraftPickValue } from "../game/ai/AIValueService";
import type { GameState, Player } from "../game/state/types";
import { calculatePlayerOverall } from "../game/player/PlayerRatingService";
import { playerTradeWaitingReason } from "../game/trade/TradeTimingPolicy";
import { tradePlayerValue } from "../game/trade/TradePlayerValue";
import type { TradeCommand, TradePackage } from "../game/trade/TradeService";
import { playerNameZh } from "./playerNameZh";
import { playerRatingStyle } from "./playerRatingColor";
import { moneyLabel, positionPairLabel } from "./uiText";
import { tradePickLabel } from "./tradeView";
import { TradeTargetFilter } from "./TradeTargetFilter";
import { PlayerPortrait } from "./PlayerPortrait";
import { getCapSheet } from "../game/cap/CapSheetService";

type Side = "left" | "right";

export function CustomTradeBuilder({ state, busy, onTradeCommand }: { state: GameState; busy: boolean; onTradeCommand: (command: TradeCommand) => Promise<void> }) {
  const opponents = Object.values(state.teams).filter((team) => team.id !== state.userTeamId).sort((a, b) => a.fullName.localeCompare(b.fullName, "zh-CN"));
  const [rightTeamId, setRightTeamId] = useState(opponents[0]?.id ?? "");
  const [leftPlayers, setLeftPlayers] = useState<string[]>([]);
  const [leftPicks, setLeftPicks] = useState<string[]>([]);
  const [rightPlayers, setRightPlayers] = useState<string[]>([]);
  const [rightPicks, setRightPicks] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const rightTeam = state.teams[rightTeamId];
  const firstYear = ["ROOKIE_DRAFT_PENDING", "OFFSEASON_PRE_DRAFT"].includes(state.league.currentPhase) ? state.league.seasonYear : state.league.seasonYear + 1;
  const tradeable = (players: Player[]) => players.filter((player) => player.contract.status === "STANDARD" && player.contract.yearsRemaining > 0 && !playerTradeWaitingReason(state, player));
  const roster = (teamId: string) => tradeable((state.teams[teamId]?.playerIds ?? []).map((id) => state.players[id]).filter(Boolean) as Player[]);
  const picks = (teamId: string) => Object.values(state.draftPicks).filter((pick) => pick.ownerTeamId === teamId && !pick.reservedByCommitmentId && pick.year >= firstYear && pick.year <= state.league.seasonYear + 7).sort((a, b) => a.year - b.year || a.round - b.round || a.id.localeCompare(b.id));
  const toggle = (set: Dispatch<SetStateAction<string[]>>, id: string) => set((ids) => ids.includes(id) ? ids.filter((entry) => entry !== id) : [...ids, id]);
  const packageDraft: TradePackage = useMemo(() => ({ leftTeamId: state.userTeamId, rightTeamId, leftPlayerIds: leftPlayers, rightPlayerIds: rightPlayers, leftPickIds: leftPicks, rightPickIds: rightPicks }), [leftPicks, leftPlayers, rightPicks, rightPlayers, rightTeamId, state.userTeamId]);
  const submit = async () => {
    setError(null);
    try { await onTradeCommand({ commandId: `custom-trade-${state.league.seasonId}-${Date.now()}`, type: "EXECUTE_CUSTOM_TRADE", payload: packageDraft }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "自定义交易未通过校验"); }
  };
  const renderPlayers = (side: Side, players: Player[], selected: string[], setSelected: Dispatch<SetStateAction<string[]>>) => <div className="custom-trade-choice-grid" aria-label={side === "left" ? "我方球员" : "对方球员"}>{players.map((player) => {
    const overall = calculatePlayerOverall(player);
    const isSelected = selected.includes(player.id);
    return <button type="button" key={player.id} disabled={busy} aria-pressed={isSelected} className={`trade-detail-asset-item player custom-trade-player${isSelected ? " selected" : ""}`} onClick={() => toggle(setSelected, player.id)}>
      <div className="trade-detail-asset-primary"><PlayerPortrait player={player} portraitPath={player.portraitPath} className="trade-avatar" /><div className="trade-detail-asset-identity"><b>{playerNameZh(player.name, player.id)}</b><small>{positionPairLabel(player.position, player.secondaryPosition)} · {player.age} 岁</small></div><strong className="trade-detail-asset-overall"><small>OVR</small><b className="player-rating-tone" style={playerRatingStyle(overall)}>{overall.toFixed(0)}</b></strong></div>
      <div className="trade-detail-asset-meta"><small>年薪 {moneyLabel(player.contract.salary)}</small><span className="trade-detail-asset-value">估值 <b>{tradePlayerValue(player).toFixed(1)}</b></span></div>
    </button>;
  })}</div>;
  const renderPicks = (side: Side, teamId: string, selected: string[], setSelected: Dispatch<SetStateAction<string[]>>) => <div className="custom-trade-choice-grid" aria-label={side === "left" ? "我方选秀权" : "对方选秀权"}>{picks(teamId).map((pick) => {
    const isSelected = selected.includes(pick.id);
    return <button type="button" key={pick.id} disabled={busy} aria-pressed={isSelected} className={`trade-detail-asset-item pick custom-trade-pick${isSelected ? " selected" : ""}`} onClick={() => toggle(setSelected, pick.id)}>
      <div className="trade-detail-asset-primary"><span aria-hidden="true">签</span><div className="trade-detail-asset-identity"><b>{tradePickLabel(state, pick.id)}</b><small>{pick.originalTeamId === teamId ? "原签" : "交易所得"}</small></div></div>
      <div className="trade-detail-asset-meta"><span className="trade-detail-asset-value">估值 <b>{tradeDraftPickValue(state, pick).toFixed(1)}</b></span><span className="custom-trade-check" aria-hidden="true">{isSelected ? "✓" : "＋"}</span></div>
    </button>;
  })}</div>;
  const side = (sideName: Side, teamId: string, playerIds: string[], setPlayers: Dispatch<SetStateAction<string[]>>, pickIds: string[], setPicks: Dispatch<SetStateAction<string[]>>) => <section className={`custom-trade-side trade-detail-asset-column${sideName === "right" ? " incoming" : ""}`}><header><b>{sideName === "left" ? "我方球队 · 送出" : "对方球队 · 送出"}</b><small>{state.teams[teamId]?.fullName ?? "球队"}</small><span className="custom-trade-side-count">{playerIds.length + pickIds.length} 项资产</span></header><div className="trade-detail-asset-items"><div className="custom-trade-group"><div className="custom-trade-group-heading"><h4>球员</h4><small>点击选择</small></div>{renderPlayers(sideName, roster(teamId), playerIds, setPlayers)}</div><div className="custom-trade-group"><div className="custom-trade-group-heading"><h4>选秀权</h4><small>点击选择</small></div>{renderPicks(sideName, teamId, pickIds, setPicks)}</div></div></section>;
  return <section className="trade-console-demo trade-center-terminal custom-trade-terminal"><header className="trade-console-header"><div className="trade-console-title"><i /><div><div><b>自定义交易</b><span>交易窗口开放</span></div><small>{state.teams[state.userTeamId].fullName} · {state.league.seasonId} 赛季</small></div></div><div className="trade-console-space"><small>帽下空间</small><b>{moneyLabel(getCapSheet(state, state.userTeamId).availableCapSpace)}</b></div></header><div className="trade-console-scroll"><div className="custom-trade-builder"><header className="custom-trade-heading"><div><span className="section-kicker">自由组合交易筹码</span><h2>选择交易资产</h2><p>左侧为我方送出，右侧为对方送出；点击资产即可加入交易方案。</p></div><div className="custom-trade-count"><b>{leftPlayers.length + leftPicks.length + rightPlayers.length + rightPicks.length}</b><small>已选资产</small></div></header><div className="custom-trade-team-filter"><TradeTargetFilter label="对手球队" ariaLabel="选择交易对手球队" value={rightTeamId} options={opponents.map((team) => ({ value: team.id, label: team.fullName }))} onChange={(teamId) => { setRightTeamId(teamId); setRightPlayers([]); setRightPicks([]); }} disabled={busy} /></div><div className="custom-trade-columns trade-detail-asset-columns">{side("left", state.userTeamId, leftPlayers, setLeftPlayers, leftPicks, setLeftPicks)}{rightTeam && side("right", rightTeam.id, rightPlayers, setRightPlayers, rightPicks, setRightPicks)}</div>{error && <p role="alert" className="trade-inquiry-message">{error}</p>}<footer className="custom-trade-footer"><small>双方至少各选择一项资产 · 薪资、名单和选秀权规则会在提交时校验</small><button type="button" className="trade-inquiry-submit custom-trade-submit" disabled={busy || !rightTeamId || (!leftPlayers.length && !leftPicks.length) || (!rightPlayers.length && !rightPicks.length)} onClick={() => void submit()}>提交交易</button></footer></div></div></section>;
}
