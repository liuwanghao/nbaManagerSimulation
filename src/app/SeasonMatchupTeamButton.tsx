import { useState } from "react";
import type { Team } from "../game/state/types";
import { conferenceLabel } from "./uiText";
import { playerRatingStyle } from "./playerRatingColor";

export function TeamLogo({ team, variant = "large" }: { team: Team; variant?: "large" | "compact" }) {
  const [imageFailed, setImageFailed] = useState(false);
  const className = `${variant === "compact" ? "mini-logo" : "logo-disc"}${team.id === "SEA" || team.id === "LVG" ? " expansion-team-logo" : ""}`;
  const background = `linear-gradient(145deg, ${team.primaryColor}, ${team.secondaryColor})`;
  return <span className={className} style={{ background }} aria-label={`${team.fullName} 队徽`}>
    {team.logoUrl && !imageFailed ? <img src={team.logoUrl} alt="" referrerPolicy="no-referrer" onError={() => setImageFailed(true)} />
      : <span className="logo-fallback" aria-hidden="true">{team.name.slice(0, 2)}</span>}
  </span>;
}

export function SeasonMatchupTeamButton({ team, venue, meta, overall, onOpen, seriesWins }: {
  team: Team;
  venue: "away" | "home";
  meta: string;
  overall: number;
  onOpen: () => void;
  seriesWins?: number;
}) {
  return <button type="button" data-venue={venue} data-team-id={team.id} onClick={onOpen} aria-label={`查看${team.fullName}阵容`}>
    <TeamLogo team={team} /><b>{team.name}</b><small>{meta}</small>{seriesWins !== undefined && <small className="postseason-team-series-score">系列赛胜场 {seriesWins}</small>}<strong className="player-rating-tone" style={playerRatingStyle(overall)}>{overall}</strong>
  </button>;
}

export function regularMatchupMeta(team: Team, record: { wins: number; losses: number }, rank: number): string {
  return `${record.wins}-${record.losses} · ${conferenceLabel(team.conference)}第${rank}`;
}
