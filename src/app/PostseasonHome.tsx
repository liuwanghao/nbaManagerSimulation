import type { GameState, ScheduleGame } from "../game/state/types";
import { conferenceLabel } from "./uiText";
import { postseasonBracket, type PostseasonSeriesView } from "./seasonResultsView";

const roundName = { PLAY_IN: "附加赛", R1: "首轮", SF: "分区半决赛", CF: "分区决赛", FINALS: "总决赛" } as const;

function SeriesCard({ state, series }: { state: GameState; series: PostseasonSeriesView }) {
  const line = (teamId: string | undefined, placeholder: string | undefined, wins: number | undefined) =>
    <span className={teamId && series.winner === teamId ? "winner" : undefined}>
      <b>{teamId ? state.teams[teamId]?.name ?? teamId : placeholder ?? "待定"}</b>
      {wins !== undefined && <strong>{wins}</strong>}
    </span>;
  return <div className="postseason-bracket-series">{line(series.teamA, series.placeholderA, series.winsA)}{line(series.teamB, series.placeholderB, series.winsB)}</div>;
}

function gameRound(state: GameState, game: ScheduleGame): string {
  const series = state.postseason?.series.find((entry) =>
    [entry.teamAId, entry.teamBId].includes(game.homeTeamId)
    && [entry.teamAId, entry.teamBId].includes(game.awayTeamId));
  return series ? roundName[series.round] : "季后赛";
}

export function PostseasonHome({ state, busy, onAdvance, onAdvanceFive, onSettle, onOpenGame }: {
  state: GameState;
  busy: boolean;
  onAdvance: () => void;
  onAdvanceFive: () => void;
  onSettle: () => void;
  onOpenGame: (gameId: string) => void;
}) {
  const postseason = state.postseason;
  if (!postseason) return null;
  const games = [...postseason.schedule].sort((left, right) => left.dateIndex - right.dateIndex || left.id.localeCompare(right.id));
  const upcoming = games.filter((game) => game.status === "SCHEDULED");
  const visibleGames = [...upcoming, ...games.filter((game) => game.status === "FINAL").reverse()];
  const nextUserGame = upcoming.find((game) => game.homeTeamId === state.userTeamId || game.awayTeamId === state.userTeamId);
  const nextGame = nextUserGame ?? upcoming[0];
  const bracket = postseasonBracket(state);
  const played = games.filter((game) => game.status === "FINAL").length;
  const userPlayed = games.filter((game) => game.status === "FINAL" && (game.homeTeamId === state.userTeamId || game.awayTeamId === state.userTeamId));
  const userWins = userPlayed.filter((game) => game.winnerTeamId === state.userTeamId).length;
  const userEliminated = postseason.series.some((series) =>
    series.winnerTeamId && series.winnerTeamId !== state.userTeamId
    && (series.teamAId === state.userTeamId || series.teamBId === state.userTeamId)
    && series.id !== `${state.teams[state.userTeamId].conference}-PLAYIN-A`);
  const nextOpponentId = nextGame && (nextGame.homeTeamId === state.userTeamId || nextGame.awayTeamId === state.userTeamId)
    ? nextGame.homeTeamId === state.userTeamId ? nextGame.awayTeamId : nextGame.homeTeamId
    : undefined;

  return <section className="postseason-home" aria-label="季后赛赛季中心">
    <article className="season-command-summary">
      <div><small>{state.league.currentPhase === "PLAY_IN" ? "附加赛" : "季后赛"} · {state.league.seasonId}</small><b>{state.teams[state.userTeamId].fullName}</b><span>本队季后赛 {userWins} 胜 {userPlayed.length - userWins} 负 · 联盟已完成 {played} 场</span></div>
    </article>

    <article className="season-command-matchup postseason-next-game">
      <header><div><small>下一场对阵</small><b>{nextGame ? `${gameRound(state, nextGame)} · ${nextGame.date}` : "等待下一轮赛程"}</b></div><span>{state.league.currentPhase === "PLAY_IN" ? "PLAY-IN" : "PLAYOFFS"}</span></header>
      {nextGame ? <>
        <div className="postseason-next-matchup"><span>{state.teams[nextGame.awayTeamId]?.fullName}</span><strong>VS</strong><span>{state.teams[nextGame.homeTeamId]?.fullName}</span></div>
        <p>{nextOpponentId ? `本队对阵 ${state.teams[nextOpponentId]?.fullName} · ${nextGame.homeTeamId === state.userTeamId ? "主场" : "客场"}` : userEliminated ? "本队已结束季后赛征程，可继续观看其余比赛。" : "先推进其他球队的比赛，确定本队下一场对手。"}</p>
        <button type="button" className="season-command-primary" data-testid="simulate-postseason-next" disabled={busy} onClick={onAdvance}>{userEliminated ? "推进下一场比赛" : "模拟下一场比赛"}</button>
        <div className="season-command-secondary-actions"><button type="button" disabled={busy} onClick={onAdvanceFive}>连续模拟 5 场</button></div>
      </> : <div className="season-command-complete"><b>本轮赛程已完成</b><p>继续推进可确定下一轮对阵。</p><button type="button" disabled={busy} onClick={onAdvance}>生成下一轮赛程</button></div>}
      {userEliminated && <button type="button" className="postseason-settle-action" disabled={busy} onClick={onSettle}>结算剩余季后赛</button>}
    </article>

    <section className="postseason-schedule" aria-label="季后赛对阵赛程">
      <header><div><small>PLAYOFF SCHEDULE</small><h2>季后赛对阵赛程</h2></div><span>{played} / {games.length} 场</span></header>
      <ol>{visibleGames.map((game) => {
        const mine = game.homeTeamId === state.userTeamId || game.awayTeamId === state.userTeamId;
        return <li key={game.id} className={mine ? "mine" : undefined}>
          <div><small>{gameRound(state, game)} · {game.date}</small><b>{state.teams[game.awayTeamId]?.name} <i>vs</i> {state.teams[game.homeTeamId]?.name}</b></div>
          {game.status === "FINAL" ? <><strong>{game.awayScore} : {game.homeScore}</strong>{mine && <button type="button" onClick={() => onOpenGame(game.id)}>查看详情</button>}</> : <span>未开赛</span>}
        </li>;
      })}</ol>
    </section>

    <section className="postseason-bracket" aria-label="季后赛对阵图">
      <header><div><small>PLAYOFF BRACKET</small><h2>季后赛对阵图</h2></div><span>实时更新</span></header>
      {bracket.conferences.map((conference) => <div className="postseason-bracket-conference" key={conference.conference}>
        <h3>{conferenceLabel(conference.conference)}</h3>
        <div className="postseason-bracket-rounds">{([
          ["附加赛", conference.playIn], ["首轮", conference.firstRound], ["半决赛", conference.semifinals], ["分区决赛", conference.final],
        ] as const).map(([label, series]) => <div key={label}><h4>{label}</h4>{series.map((entry, index) => <SeriesCard key={index} state={state} series={entry} />)}</div>)}</div>
      </div>)}
      <div className="postseason-bracket-finals"><h3>总决赛</h3><SeriesCard state={state} series={bracket.finals[0] ?? { placeholderA: "东部冠军", placeholderB: "西部冠军" }} /></div>
    </section>
  </section>;
}
