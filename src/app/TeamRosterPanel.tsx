import { useState, type ReactNode } from "react";
import type { Player, Position } from "../game/state/types";
import { calculatePlayerOverall } from "../game/player/PlayerRatingService";
import { LINEUP_POSITIONS } from "../game/roster/RotationPlanService";
import { EXPANSION_POSITION_FILTERS, getCurrentRosterPositionCounts, matchesExpansionPosition, sortExpansionPlayersByOverall, type ExpansionPositionFilter } from "./expansionDraftView";
import { PlayerPortrait } from "./PlayerPortrait";
import { playerNameZh } from "./playerNameZh";
import { playerRatingStyle } from "./playerRatingColor";
import { moneyLabel, positionPairLabel, rotationRoleLabel } from "./uiText";

type PreviewRosterFilter = "ALL" | "STARTER" | "ROTATION" | "INACTIVE";

const PREVIEW_FILTERS: Array<{ id: PreviewRosterFilter; label: string }> = [
  { id: "ALL", label: "全部" },
  { id: "STARTER", label: "首发" },
  { id: "ROTATION", label: "轮换" },
  { id: "INACTIVE", label: "未激活" },
];

interface PreviewRotation {
  starterIds: ReadonlySet<string>;
  starterPositions?: ReadonlyMap<string, Position>;
  reserveIds: ReadonlySet<string>;
  targetMinutes?: Readonly<Record<string, number>>;
}

interface TeamRosterPanelProps {
  players: Player[];
  variant: "preseason" | "season" | "preview";
  onOpenPlayer: (playerId: string) => void;
  renderActions?: (player: Player) => ReactNode;
  previewRotation?: PreviewRotation;
}

function previewRank(playerId: string, rotation?: PreviewRotation): number {
  return rotation?.starterIds.has(playerId) ? 0 : rotation?.reserveIds.has(playerId) ? 1 : 2;
}

export function filterPreviewRosterPlayers(players: Player[], filter: PreviewRosterFilter, rotation?: PreviewRotation): Player[] {
  const selectedRank = filter === "STARTER" ? 0 : filter === "ROTATION" ? 1 : filter === "INACTIVE" ? 2 : null;
  return sortExpansionPlayersByOverall(players.filter((player) => selectedRank === null || previewRank(player.id, rotation) === selectedRank))
    .sort((left, right) => {
      const rank = previewRank(left.id, rotation) - previewRank(right.id, rotation);
      if (rank) return rank;
      if (previewRank(left.id, rotation) !== 0) return 0;
      const leftSlot = rotation?.starterPositions?.get(left.id);
      const rightSlot = rotation?.starterPositions?.get(right.id);
      return (leftSlot ? LINEUP_POSITIONS.indexOf(leftSlot) : LINEUP_POSITIONS.length)
        - (rightSlot ? LINEUP_POSITIONS.indexOf(rightSlot) : LINEUP_POSITIONS.length);
    });
}

export function TeamRosterPanel({ players, variant, onOpenPlayer, renderActions, previewRotation }: TeamRosterPanelProps) {
  const [positionFilter, setPositionFilter] = useState<ExpansionPositionFilter>("ALL");
  const [previewFilter, setPreviewFilter] = useState<PreviewRosterFilter>("ALL");
  const counts = getCurrentRosterPositionCounts(players);
  const visiblePlayers = variant === "preview"
    ? filterPreviewRosterPlayers(players, previewFilter, previewRotation)
    : sortExpansionPlayersByOverall(players.filter((player) => matchesExpansionPosition(player, positionFilter)));
  const previewCounts = [0, 0, 0];
  if (variant === "preview") players.forEach((player) => { previewCounts[previewRank(player.id, previewRotation)] += 1; });

  return <div className={`team-roster-panel team-roster-panel-${variant}`}>
    {variant === "preview" ? <div className="draft-current-roster-filter team-roster-filter" role="group" aria-label="按上场状态筛选球队阵容">
      {PREVIEW_FILTERS.map(({ id, label }) => <button type="button" key={id} className={previewFilter === id ? "active" : ""} aria-pressed={previewFilter === id} onClick={() => setPreviewFilter(id)}><b>{label}</b><small>{id === "ALL" ? players.length : previewCounts[id === "STARTER" ? 0 : id === "ROTATION" ? 1 : 2]}</small></button>)}
    </div> : <div className="draft-current-roster-filter team-roster-filter" role="group" aria-label="按主位置筛选球队阵容">
      {EXPANSION_POSITION_FILTERS.map((position) => {
        const count = position === "ALL" ? players.length : counts.find((entry) => entry.position === position)?.count ?? 0;
        return <button type="button" key={position} className={positionFilter === position ? "active" : ""} aria-pressed={positionFilter === position} onClick={() => setPositionFilter(position)}><b>{position === "ALL" ? "全部" : position}</b><small>{count}</small></button>;
      })}
    </div>}
    <div className="team-roster-list">
      {visiblePlayers.map((player) => {
        const rank = previewRank(player.id, previewRotation);
        const injuryLabel = player.injury ? "伤病" : !player.available ? "缺阵" : null;
        const plannedMinutes = previewRotation?.targetMinutes?.[player.id];
        return <article className={`preseason-roster-card${variant === "preview" && rank === 2 ? " roster-preview-out" : ""}`} key={player.id} data-player-id={player.id} onClick={(event) => {
          if (event.target instanceof Element && event.target.closest(".preseason-player-open, .preseason-player-actions")) return;
          onOpenPlayer(player.id);
        }}>
          <button type="button" className="preseason-player-open" data-testid={`${variant}-player-${player.id}`} onClick={() => onOpenPlayer(player.id)}>
            <PlayerPortrait player={player} portraitPath={player.portraitPath} className="preseason-player-portrait" />
            <span className="preseason-player-copy">
              <span className="preseason-player-name-row"><b>{playerNameZh(player.name, player.id)}</b>{injuryLabel && <em className="team-roster-injury">{injuryLabel}</em>}<span className="preseason-position-mark">{positionPairLabel(player.position, player.secondaryPosition)}</span></span>
              {variant === "preview"
                ? <small className="roster-preview-meta"><em className={`roster-preview-status status-${rank}`}>{["首发", "轮换", "未激活"][rank]}{rank === 0 && previewRotation?.starterPositions?.get(player.id) && <b className="roster-preview-slot">{previewRotation.starterPositions.get(player.id)}</b>}</em>{rank < 2 && plannedMinutes ? ` · 目标 ${plannedMinutes} 分钟` : ""}</small>
                : <small>{moneyLabel(player.contract.salary)} · {player.contract.yearsRemaining} 年 · {player.age} 岁{variant === "season" ? ` · ${rotationRoleLabel(player.rotationRole)}` : ""}</small>}
            </span>
          </button>
          <span className="preseason-player-overall">OVR <b className="player-rating-tone" style={playerRatingStyle(calculatePlayerOverall(player))}>{calculatePlayerOverall(player).toFixed(0)}</b></span>
          {renderActions && <div className="preseason-player-actions">{renderActions(player)}</div>}
        </article>;
      })}
      {visiblePlayers.length === 0 && <div className="team-roster-empty">{players.length ? (variant === "preview" ? "该状态暂无球员。" : "该位置暂无球员，请选择其他位置。") : "当前球队暂无球员。"}</div>}
    </div>
  </div>;
}
