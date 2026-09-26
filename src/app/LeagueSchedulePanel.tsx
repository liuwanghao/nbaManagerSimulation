import { useMemo, useState } from "react";
import type { GameState, Team } from "../game/state/types";

export function nearestScheduleDate(dates: string[], preferred: string): string {
  return dates.find((date) => date >= preferred) ?? dates.at(-1) ?? "";
}

function ScheduleLogo({ team }: { team: Team }) {
  const [imageFailed, setImageFailed] = useState(false);
  return <span className="league-schedule-logo" style={{ background: `linear-gradient(145deg, ${team.primaryColor}, ${team.secondaryColor})` }} aria-hidden="true">
    {team.logoUrl && !imageFailed ? <img src={team.logoUrl} alt="" referrerPolicy="no-referrer" onError={() => setImageFailed(true)} /> : team.name.slice(0, 2)}
  </span>;
}

function dateLabel(date: string): string {
  const weekday = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][new Date(`${date}T00:00:00Z`).getUTCDay()];
  return `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日 · ${weekday}`;
}

export function LeagueSchedulePanel({ state, currentDate }: {
  state: GameState;
  currentDate: string;
}) {
  const [selectedDate, setSelectedDate] = useState(currentDate);
  const dates = useMemo(() => [...new Set(state.schedule.map((game) => game.date))].sort(), [state.schedule]);
  const date = dates.includes(selectedDate) ? selectedDate : nearestScheduleDate(dates, selectedDate);
  const dateIndex = dates.indexOf(date);
  const games = state.schedule.filter((game) => game.date === date)
    .sort((left, right) => {
      const leftMine = left.homeTeamId === state.userTeamId || left.awayTeamId === state.userTeamId;
      const rightMine = right.homeTeamId === state.userTeamId || right.awayTeamId === state.userTeamId;
      return Number(rightMine) - Number(leftMine) || state.teams[left.awayTeamId].name.localeCompare(state.teams[right.awayTeamId].name, "zh-CN");
    });
  const finishedCount = games.filter((game) => game.status === "FINAL").length;

  return <div className="league-schedule">
    {date ? <>
      <div className="league-schedule-datebar">
        <button type="button" aria-label="上个比赛日" disabled={dateIndex <= 0} onClick={() => setSelectedDate(dates[dateIndex - 1])}>‹</button>
        <div><small>{date}</small><strong>{dateLabel(date)}</strong><span>{games.length} 场比赛 · {finishedCount} 场已结束</span></div>
        <button type="button" aria-label="下个比赛日" disabled={dateIndex >= dates.length - 1} onClick={() => setSelectedDate(dates[dateIndex + 1])}>›</button>
        <button type="button" className="league-schedule-today" onClick={() => setSelectedDate(currentDate)}>当前</button>
      </div>

      <ol className="league-schedule-games" aria-label={`${date}赛程赛果`}>{games.map((game) => {
        const away = state.teams[game.awayTeamId];
        const home = state.teams[game.homeTeamId];
        const isMine = game.awayTeamId === state.userTeamId || game.homeTeamId === state.userTeamId;
        return <li key={game.id} className={isMine ? "mine" : ""}>
          <div className="league-schedule-matchup">
            <span className="league-schedule-team away"><ScheduleLogo team={away} /><span><b>{away.name}</b><small>客队</small></span></span>
            <span className="league-schedule-result">{game.status === "FINAL"
              ? <><strong className={game.winnerTeamId === away.id ? "winner" : ""}>{game.awayScore}</strong><i>:</i><strong className={game.winnerTeamId === home.id ? "winner" : ""}>{game.homeScore}</strong></>
              : <b>VS</b>}<small>{game.status === "FINAL" ? "已结束" : "未开赛"}</small></span>
            <span className="league-schedule-team home"><ScheduleLogo team={home} /><span><b>{home.name}</b><small>主队</small></span></span>
          </div>
        </li>;
      })}</ol>
    </> : <p className="league-empty">当前没有可查看的赛程。</p>}
  </div>;
}
