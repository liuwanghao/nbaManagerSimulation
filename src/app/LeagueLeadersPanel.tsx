import { useMemo } from "react";
import type { GameState, Player, PlayerSeasonStats } from "../game/state/types";
import { playerNameZh } from "./playerNameZh";

const LEADER_STATS = [
  { key: "pts", label: "得分" },
  { key: "reb", label: "篮板" },
  { key: "ast", label: "助攻" },
  { key: "stl", label: "抢断" },
  { key: "blk", label: "盖帽" },
] as const satisfies ReadonlyArray<{ key: keyof PlayerSeasonStats; label: string }>;

export type LeagueLeaderStat = (typeof LEADER_STATS)[number]["key"];

export function leagueStatLeaders(state: GameState, key: LeagueLeaderStat): Player[] {
  return Object.values(state.players)
    .filter((player) => player.seasonStats.games > 0 && Boolean(state.teams[player.teamId]))
    .sort((left, right) => {
      const leftStats = left.seasonStats;
      const rightStats = right.seasonStats;
      return rightStats[key] / rightStats.games - leftStats[key] / leftStats.games
        || rightStats[key] - leftStats[key]
        || rightStats.games - leftStats.games
        || left.id.localeCompare(right.id);
    })
    .slice(0, 5);
}

export function LeagueLeadersPanel({ state, onOpenPlayer }: { state: GameState; onOpenPlayer: (playerId: string) => void }) {
  const leaders = useMemo(() => LEADER_STATS.map((stat) => ({ ...stat, players: leagueStatLeaders(state, stat.key) })), [state]);

  return <div className="league-stat-grid">
    {leaders.map(({ key, label, players }) => <section key={key} className="league-stat-card" aria-label={`${label}榜`}>
      <header><h4>{label}榜</h4><span>TOP 5 · 场均</span></header>
      <div className="league-stat-columns"><span>#</span><span>球员 / 球队</span><span className="league-stat-column-labels">{LEADER_STATS.map((stat) => <span key={stat.key} className={stat.key === key ? "selected" : ""}>{stat.label}</span>)}</span></div>
      {players.length ? <ol>{players.map((player, index) => <li key={player.id}>
        <button type="button" onClick={() => onOpenPlayer(player.id)} aria-label={`查看${playerNameZh(player.name, player.id)}的球员详情`}>
          <span className="league-stat-rank">{String(index + 1).padStart(2, "0")}</span>
          <span className="league-stat-player"><b>{playerNameZh(player.name, player.id)}</b><small>{state.teams[player.teamId].name}</small></span>
          <span className="league-stat-metrics" aria-label="赛季场均数据">
            {LEADER_STATS.map((stat) => <span key={stat.key} className={stat.key === key ? "selected" : ""} title={stat.label}>
              <strong>{(player.seasonStats[stat.key] / player.seasonStats.games).toFixed(1)}</strong>
            </span>)}
          </span>
        </button>
      </li>)}</ol> : <p className="league-empty">赛季尚无比赛数据</p>}
    </section>)}
  </div>;
}
