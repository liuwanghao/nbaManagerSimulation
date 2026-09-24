import { useState, type ReactNode } from "react";
import type { Player } from "../game/state/types";
import { calculatePlayerOverall } from "../game/player/PlayerRatingService";
import { EXPANSION_POSITION_FILTERS, getCurrentRosterPositionCounts, matchesExpansionPosition, sortExpansionPlayersByOverall, type ExpansionPositionFilter } from "./expansionDraftView";
import { PlayerPortrait } from "./PlayerPortrait";
import { playerNameZh } from "./playerNameZh";
import { playerRatingStyle } from "./playerRatingColor";
import { moneyLabel, positionPairLabel, rotationRoleLabel } from "./uiText";

interface TeamRosterPanelProps {
  players: Player[];
  variant: "preseason" | "season";
  onOpenPlayer: (playerId: string) => void;
  renderActions?: (player: Player) => ReactNode;
}

export function TeamRosterPanel({ players, variant, onOpenPlayer, renderActions }: TeamRosterPanelProps) {
  const [positionFilter, setPositionFilter] = useState<ExpansionPositionFilter>("ALL");
  const counts = getCurrentRosterPositionCounts(players);
  const visiblePlayers = sortExpansionPlayersByOverall(players.filter((player) => matchesExpansionPosition(player, positionFilter)));

  return <div className={`team-roster-panel team-roster-panel-${variant}`}>
    <div className="draft-current-roster-filter team-roster-filter" role="group" aria-label="按主位置筛选球队阵容">
      {EXPANSION_POSITION_FILTERS.map((position) => {
        const count = position === "ALL" ? players.length : counts.find((entry) => entry.position === position)?.count ?? 0;
        return <button type="button" key={position} className={positionFilter === position ? "active" : ""} aria-pressed={positionFilter === position} onClick={() => setPositionFilter(position)}><b>{position === "ALL" ? "全部" : position}</b><small>{count}</small></button>;
      })}
    </div>
    <div className="team-roster-list">
      {visiblePlayers.map((player) => <article className="preseason-roster-card" key={player.id} data-player-id={player.id} onClick={(event) => {
        if (event.target instanceof Element && event.target.closest(".preseason-player-open, .preseason-player-actions")) return;
        onOpenPlayer(player.id);
      }}>
        <button type="button" className="preseason-player-open" data-testid={`${variant}-player-${player.id}`} onClick={() => onOpenPlayer(player.id)}>
          <PlayerPortrait player={player} portraitPath={player.portraitPath} className="preseason-player-portrait" />
          <span className="preseason-player-copy"><span className="preseason-player-name-row"><b>{playerNameZh(player.name, player.id)}{!player.available && <em className="team-roster-injury">伤病</em>}</b><span className="preseason-position-mark">{positionPairLabel(player.position, player.secondaryPosition)}</span></span><small>{moneyLabel(player.contract.salary)} · {player.contract.yearsRemaining} 年 · {player.age} 岁{variant === "season" ? ` · ${rotationRoleLabel(player.rotationRole)}` : ""}</small></span>
        </button>
        <span className="preseason-player-overall">OVR <b className="player-rating-tone" style={playerRatingStyle(calculatePlayerOverall(player))}>{calculatePlayerOverall(player).toFixed(0)}</b></span>
        {renderActions && <div className="preseason-player-actions">{renderActions(player)}</div>}
      </article>)}
      {visiblePlayers.length === 0 && <div className="team-roster-empty">{players.length ? "该位置暂无球员，请选择其他位置。" : "当前球队暂无球员。"}</div>}
    </div>
  </div>;
}
