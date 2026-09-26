import { useMemo } from "react";
import { getAwardRace } from "../game/awards/AwardsService";
import type { AwardType, Conference, GameState, PlayerSeasonStats, StandingRecord } from "../game/state/types";
import { playerNameZh } from "./playerNameZh";
import { awardLabel, conferenceLabel } from "./uiText";

const AWARDS = [
  { type: "MVP", code: "MVP" },
  { type: "DPOY", code: "DPOY" },
  { type: "ROY", code: "ROY" },
  { type: "SIXTH_MAN", code: "6MOY" },
  { type: "MIP", code: "MIP" },
] as const satisfies ReadonlyArray<{ type: AwardType; code: string }>;

const STATS = [
  { key: "pts", label: "得分" },
  { key: "reb", label: "篮板" },
  { key: "ast", label: "助攻" },
  { key: "stl", label: "抢断" },
  { key: "blk", label: "盖帽" },
] as const satisfies ReadonlyArray<{ key: keyof PlayerSeasonStats; label: string }>;

export function LeagueAwardsPanel({ state, conferenceStandings, onOpenPlayer }: {
  state: GameState;
  conferenceStandings: Record<Conference, StandingRecord[]>;
  onOpenPlayer: (playerId: string) => void;
}) {
  const races = useMemo(() => AWARDS.map((award) => ({ ...award, players: getAwardRace(state, award.type, 5) })), [state]);

  return <div className="league-award-boards">
    {races.map(({ type, code, players }) => <section key={type} className="league-award-board" aria-label={`${code} ${awardLabel(type)}候选榜`}>
      <header><span className="league-award-code">{code}</span><h3>{awardLabel(type)}</h3><small>候选前五</small></header>
      <div className="league-award-columns"><span>#</span><span>球员 / 球队</span><span className="league-award-column-labels">{STATS.map(({ key, label }) => <span key={key}>{label}</span>)}</span></div>
      {players.length ? <ol>{players.map((player, index) => {
        const team = state.teams[player.teamId];
        const record = state.standings[team.id];
        const conferenceRank = conferenceStandings[team.conference].findIndex((entry) => entry.teamId === team.id) + 1;
        return <li key={player.id}><button type="button" onClick={() => onOpenPlayer(player.id)} aria-label={`查看${playerNameZh(player.name, player.id)}的球员详情`}>
          <span className="league-award-rank">{String(index + 1).padStart(2, "0")}</span>
          <span className="league-award-player"><b>{playerNameZh(player.name, player.id)}</b><small>{team.name} · {conferenceLabel(team.conference)}第{conferenceRank} · {record.wins}-{record.losses}</small></span>
          <span className="league-award-stats" aria-label="赛季场均数据">{STATS.map(({ key, label }) => <span key={key} title={label}><strong>{(player.seasonStats[key] / player.seasonStats.games).toFixed(1)}</strong></span>)}</span>
        </button></li>;
      })}</ol> : <p className="league-empty">赛季开始后将显示候选球员。</p>}
    </section>)}
  </div>;
}
