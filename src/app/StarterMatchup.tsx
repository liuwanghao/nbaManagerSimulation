import { useEffect } from "react";
import { calculatePlayerOverall } from "../game/player/PlayerRatingService";
import { LINEUP_POSITIONS, effectiveStarterAssignments, positionCompatibilityLabel, positionMismatchPenalty } from "../game/roster/RotationPlanService";
import type { Player, Position, Team } from "../game/state/types";
import { playerNameZh } from "./playerNameZh";
import { playerRatingStyle } from "./playerRatingColor";
import { positionPairLabel } from "./uiText";

export function starterMatchupRows(team: Team, players: Record<string, Player>): Array<{ position: Position; player?: Player }> {
  const roster = team.playerIds.map((id) => players[id]).filter((player): player is Player => Boolean(player));
  const available = roster.filter((player) => player.available && !player.injury);
  if (available.length < LINEUP_POSITIONS.length) return LINEUP_POSITIONS.map((position) => ({ position }));
  const starters = effectiveStarterAssignments(roster, team.rotationPlan);
  return LINEUP_POSITIONS.map((position) => ({ position, player: players[starters[position]] }));
}

function StarterCell({ player, position, align }: { player?: Player; position: Position; align: "away" | "home" }) {
  if (!player) return <div className={`starter-matchup-player ${align} empty`}><b>待补齐</b><small>可用球员不足</small></div>;
  const overall = calculatePlayerOverall(player);
  const mismatch = positionMismatchPenalty(player, position);
  const rating = <div className="starter-matchup-rating"><small>OVR</small><strong className="player-rating-tone" style={playerRatingStyle(overall)}>{Math.round(overall)}</strong></div>;
  return <div className={`starter-matchup-player ${align}${mismatch > 0 ? " mismatch" : ""}`} title={`${position} 首发 · ${positionCompatibilityLabel(player, position)}`}>
    {align === "home" && rating}
    <div className="starter-matchup-identity"><b title={playerNameZh(player.name, player.id)}>{playerNameZh(player.name, player.id)}</b><small>{positionPairLabel(player.position, player.secondaryPosition)}{mismatch > 0 && <em>{positionCompatibilityLabel(player, position)}</em>}</small></div>
    {align === "away" && rating}
  </div>;
}

export function StarterMatchupModal({ awayTeam, homeTeam, players, onClose }: { awayTeam: Team; homeTeam: Team; players: Record<string, Player>; onClose: () => void }) {
  const away = starterMatchupRows(awayTeam, players);
  const home = starterMatchupRows(homeTeam, players);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return <div className="starter-matchup-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="starter-matchup-modal" role="dialog" aria-modal="true" aria-label="首发对位">
      <header><div><small>下一场对阵 · 预计首发</small><h2>首发对位</h2></div><button type="button" autoFocus aria-label="关闭首发对位" onClick={onClose}>×</button></header>
      <div className="starter-matchup-teams"><div><small>客场</small><b>{awayTeam.fullName}</b></div><span>位置</span><div><small>主场</small><b>{homeTeam.fullName}</b></div></div>
      <div className="starter-matchup-rows">
        {LINEUP_POSITIONS.map((position, index) => <div className="starter-matchup-row" key={position}>
          <StarterCell player={away[index].player} position={position} align="away" />
          <span className="starter-matchup-position">{position}</span>
          <StarterCell player={home[index].player} position={position} align="home" />
        </div>)}
      </div>
      <p>按当前可用阵容展示；副位置可正常出战，错位首发会影响比赛表现。</p>
    </section>
  </div>;
}
