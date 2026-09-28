import type { GameState, Player } from "../game/state/types";
import { calculatePlayerOverall } from "../game/player/PlayerRatingService";
import { PlayerPortrait } from "./PlayerPortrait";
import { playerNameZh } from "./playerNameZh";
import { playerRatingStyle } from "./playerRatingColor";
import { TRADE_ASSET_POSITIONS, tradeAssetPositionCounts, tradePickLabel, type TradeAssetPosition } from "./tradeView";
import { moneyLabel, positionPairLabel } from "./uiText";

interface TradeAssetPickerProps {
  state: GameState;
  roster: Player[];
  busy?: boolean;
  error?: string | null;
  selectedPlayerIds: string[];
  selectedPickIds: string[];
  positionFilter: TradeAssetPosition;
  onPositionFilter: (position: TradeAssetPosition) => void;
  onTogglePlayer: (id: string) => void;
  onTogglePick: (id: string) => void;
  onClose: () => void;
}

export function TradeAssetPicker({ state, roster, busy = false, error, selectedPlayerIds, selectedPickIds, positionFilter, onPositionFilter, onTogglePlayer, onTogglePick, onClose }: TradeAssetPickerProps) {
  const counts = tradeAssetPositionCounts(roster);
  const visiblePlayers = positionFilter === "ALL" ? roster : roster.filter((player) => player.position === positionFilter);
  const firstYear = state.league.currentPhase === "OFFSEASON_PRE_DRAFT" ? state.league.seasonYear : state.league.seasonYear + 1;
  const availablePicks = Object.values(state.draftPicks)
    .filter((pick) => pick.ownerTeamId === state.userTeamId && !pick.reservedByCommitmentId && pick.year >= firstYear && pick.year <= state.league.seasonYear + 7)
    .sort((left, right) => left.year - right.year || left.round - right.round || left.id.localeCompare(right.id));

  return <div className="trade-console-sheet-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="trade-console-sheet" role="dialog" aria-modal="true" aria-label="选择我方交易筹码">
      <header><div><b>选择我方筹码</b></div><button type="button" aria-label="关闭筹码选择" disabled={busy} onClick={onClose}>✕</button></header>
      <div className="trade-asset-roster-summary"><b>本队 {roster.length} 人</b><small>按主位置统计，每名球员只计入一个位置</small></div>
      <div className="trade-asset-position-tabs" role="group" aria-label="按主位置筛选交易筹码">{TRADE_ASSET_POSITIONS.map((position) => <button type="button" key={position} disabled={busy} aria-pressed={positionFilter === position} className={positionFilter === position ? "selected" : ""} onClick={() => onPositionFilter(position)}><b>{position === "ALL" ? "全部" : position}</b><small>{counts[position]}</small></button>)}</div>
      <div className="trade-asset-options">{visiblePlayers.map((player) => <button type="button" disabled={busy} aria-pressed={selectedPlayerIds.includes(player.id)} className={`trade-asset-option${selectedPlayerIds.includes(player.id) ? " active" : ""}`} key={player.id} onClick={() => onTogglePlayer(player.id)}><PlayerPortrait player={player} portraitPath={player.portraitPath} className="trade-avatar" /><span><b>{playerNameZh(player.name, player.id)} <em className="player-rating-tone" style={playerRatingStyle(calculatePlayerOverall(player))}>{calculatePlayerOverall(player).toFixed(0)} OVR</em></b><small>{positionPairLabel(player.position, player.secondaryPosition)} · {moneyLabel(player.contract.salary)} / 年</small></span>{selectedPlayerIds.includes(player.id) && <strong>✓ 已选</strong>}</button>)}{visiblePlayers.length === 0 && <p className="trade-console-empty">这个位置目前没有球员。</p>}</div>
      <div className="trade-pick-picker"><b>选秀权</b><small>可交易的未来七届选秀权</small><div className="trade-asset-options">{availablePicks.map((pick) => <button type="button" disabled={busy} aria-pressed={selectedPickIds.includes(pick.id)} className={`trade-asset-option${selectedPickIds.includes(pick.id) ? " active" : ""}`} key={pick.id} onClick={() => onTogglePick(pick.id)}><span className="trade-avatar">签</span><span><b>{tradePickLabel(state, pick.id)}</b><small>可用于交易报价</small></span>{selectedPickIds.includes(pick.id) && <strong>✓ 已选</strong>}</button>)}{availablePicks.length === 0 && <p className="trade-console-empty">暂无可交易选秀权。</p>}</div></div>
      {error && <p className="trade-asset-save-error" role="alert">{error}</p>}
      <button className="trade-inquiry-submit" type="button" disabled={busy} onClick={onClose}>{busy ? "正在保存筹码…" : "确认筹码"}</button>
    </section>
  </div>;
}
