import type { GameState } from "../game/state/types";
import { playerNameZh } from "./playerNameZh";
import { playerRatingStyle } from "./playerRatingColor";
import { positionPairLabel } from "./uiText";

export function SeasonOverallChanges({ state }: { state: GameState }) {
  const report = state.playerLifecycle;
  if (!report || report.processedSeasonId !== state.league.seasonId || !report.userTeamOverallChanges) return null;
  const rosterIds = new Set(state.teams[state.userTeamId].playerIds);
  const changes = report.userTeamOverallChanges
    .filter((entry) => rosterIds.has(entry.playerId) && state.players[entry.playerId])
    .sort((left, right) => right.after - left.after || left.playerId.localeCompare(right.playerId));
  if (!changes.length) return null;
  const improved = changes.filter((entry) => entry.after > entry.before).length;
  const declined = changes.filter((entry) => entry.after < entry.before).length;
  const changed = changes.filter((entry) => entry.after !== entry.before);

  return <section className="option-phase-overall-changes" aria-label="本队球员总评变化" data-testid="season-overall-changes">
    <header><div><h2>本队球员总评变化</h2><p>新赛季成长结算 · 当前在队球员</p></div><span>{changes.length} 人</span></header>
    <div className="option-phase-overall-summary"><span>提升 <b>{improved}</b></span><span>下降 <b>{declined}</b></span><span>持平 <b>{changes.length - improved - declined}</b></span></div>
    <div className="option-phase-overall-list">{changed.map((entry) => {
      const player = state.players[entry.playerId];
      const delta = entry.after - entry.before;
      return <div className="option-phase-overall-row" key={entry.playerId} data-player-id={entry.playerId}>
        <div><b>{playerNameZh(player.name, player.id)}</b><small>{positionPairLabel(player.position, player.secondaryPosition)}</small></div>
        <span className="option-phase-overall-values"><small>{entry.before}</small><i aria-hidden="true">→</i><strong className="player-rating-tone" style={playerRatingStyle(entry.after)}>{entry.after}</strong></span>
        <em className={delta > 0 ? "rise" : "fall"}>{delta > 0 ? `+${delta}` : String(delta)}</em>
      </div>;
    })}{changed.length === 0 && <p>本赛季暂无总评变化的球员。</p>}</div>
  </section>;
}
