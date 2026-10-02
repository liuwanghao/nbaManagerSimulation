import { useEffect, useRef, useState } from "react";
import type { GameState, ScheduleGame } from "../game/state/types";
import { isUserPostseasonEliminated } from "../game/season/career";
import { calculateTeamOverall } from "../game/team/TeamRatingService";
import { nextPlayoffUserGame, regularCoachingView, type RegularPregameSelection } from "../game/coaching/CoachingService";
import { RegularCoachingPanel } from "./CoachingPanels";
import { coachingPregameRewardKey, hasConfirmedCoachingReward } from "./coachingReward";
import { PostseasonBracketView } from "./SeasonResultsPanel";
import { SeasonMatchupTeamButton, TeamLogo } from "./SeasonMatchupTeamButton";

const roundName = { PLAY_IN: "附加赛", R1: "首轮", SF: "分区半决赛", CF: "分区决赛", FINALS: "总决赛" } as const;

function gameRound(state: GameState, game: ScheduleGame): string {
  const series = state.postseason?.series.find((entry) => entry.gameIds.includes(game.id));
  return series ? roundName[series.round] : "季后赛";
}

function seriesWinsForTeam(state: GameState, seriesId: string | undefined, teamId: string): number | null {
  const series = seriesId ? state.postseason?.series.find((entry) => entry.id === seriesId) : undefined;
  if (!series || series.bestOf !== 7) return null;
  if (series.teamAId === teamId) return series.winsA;
  if (series.teamBId === teamId) return series.winsB;
  return null;
}

export function PostseasonHome({ state, busy, onAdvance, onAdvanceRound, onSettle, onOpenGame, onOpenTeam, onOpenStarters, onUnlockVideo, coachingMessage }: {
  state: GameState;
  busy: boolean;
  onAdvance: (selection: RegularPregameSelection | null) => void;
  onAdvanceRound: (selection: RegularPregameSelection | null) => void;
  onSettle: () => void;
  onOpenGame: (gameId: string) => void;
  onOpenTeam: (teamId: string) => void;
  onOpenStarters: () => void;
  onUnlockVideo: (gameId: string) => Promise<void>;
  coachingMessage?: string | null;
}) {
  const [pregameSelection, setPregameSelection] = useState<RegularPregameSelection | null>(null);
  const attemptedAdvance = useRef<GameState | null>(null);
  const postseason = state.postseason;
  const nextUserGameInfo = nextPlayoffUserGame(state);
  const nextUserGame = nextUserGameInfo?.game;
  const userEliminated = isUserPostseasonEliminated(state);
  useEffect(() => {
    if (!postseason || nextUserGame || userEliminated || busy || attemptedAdvance.current === state) return;
    attemptedAdvance.current = state;
    onAdvance(null);
  }, [state, postseason, nextUserGame, userEliminated, busy, onAdvance]);
  if (!postseason) return null;
  const completed = [...postseason.schedule]
    .filter((game) => game.status === "FINAL")
    .sort((left, right) => right.dateIndex - left.dateIndex || right.id.localeCompare(left.id));
  const userPlayed = completed.filter((game) => game.homeTeamId === state.userTeamId || game.awayTeamId === state.userTeamId);
  const userWins = userPlayed.filter((game) => game.winnerTeamId === state.userTeamId).length;
  const pregameView = regularCoachingView(state);
  const currentSelection = pregameSelection?.gameId === nextUserGame?.id ? pregameSelection : null;
  const awaySeriesWins = nextUserGameInfo ? seriesWinsForTeam(state, nextUserGameInfo.seriesId, nextUserGameInfo.game.awayTeamId) : null;
  const homeSeriesWins = nextUserGameInfo ? seriesWinsForTeam(state, nextUserGameInfo.seriesId, nextUserGameInfo.game.homeTeamId) : null;
  const pregameFocus = currentSelection?.choice === "NONE" ? null : currentSelection?.choice ?? pregameView?.selected?.focus ?? null;
  const pregameNeedsVideo = Boolean(nextUserGame && pregameFocus && !pregameView?.videoUnlocked);
  const pregameSummary = currentSelection?.choice === "NONE" ? "不备战 · 普通模拟"
    : pregameFocus ? `${pregameFocus === "OFFENSE" ? "进攻" : "防守"}${pregameNeedsVideo ? "未解锁 · 普通模拟" : "已解锁 · 开赛生效"}`
    : pregameView?.videoUnlocked ? "视频已解锁 · 可选方向" : "攻防备战 · 点击展开";
  const rewardKey = nextUserGame ? coachingPregameRewardKey(state, nextUserGame.id) : null;
  const postseasonRecord = (teamId: string) => {
    const played = completed.filter((game) => game.homeTeamId === teamId || game.awayTeamId === teamId);
    const wins = played.filter((game) => game.winnerTeamId === teamId).length;
    return `季后赛 ${wins}胜${played.length - wins}负`;
  };

  return <section className="postseason-home" aria-label="季后赛赛季中心">
    <article className="season-command-summary">
      <div><small>{state.league.seasonId} · {state.league.currentPhase === "PLAY_IN" ? "附加赛" : "季后赛"}</small><b>{state.teams[state.userTeamId].fullName}</b><span>季后赛战况</span></div>
      <div className="postseason-record"><strong>{userWins}<i>胜</i> {userPlayed.length - userWins}<i>负</i></strong><small>联盟已赛 {completed.length} 场</small></div>
    </article>

    <article className="season-command-matchup postseason-next-game">
      <header><div><small>{nextUserGame ? "本队下一场对阵" : userEliminated ? "本队季后赛" : "赛程推进中"}</small><b>{nextUserGame ? `${gameRound(state, nextUserGame)} · ${nextUserGame.date} · ${nextUserGame.homeTeamId === state.userTeamId ? "主场" : "客场"}` : userEliminated ? "本队赛程结束" : "正在安排本队赛程"}</b></div><span>{state.league.currentPhase === "PLAY_IN" ? "PLAY-IN" : "PLAYOFFS"}</span></header>
      {nextUserGame ? <>
        <div className="season-command-versus">
          <SeasonMatchupTeamButton team={state.teams[nextUserGame.awayTeamId]} venue="away" meta={postseasonRecord(nextUserGame.awayTeamId)} seriesWins={awaySeriesWins ?? undefined} overall={calculateTeamOverall(state, nextUserGame.awayTeamId).overall} onOpen={() => onOpenTeam(nextUserGame.awayTeamId)} />
          <div className="postseason-matchup-center"><strong>VS</strong><small>客场 · 主场</small><button type="button" className="season-command-starters-trigger" onClick={onOpenStarters}>首发对位</button></div>
          <SeasonMatchupTeamButton team={state.teams[nextUserGame.homeTeamId]} venue="home" meta={postseasonRecord(nextUserGame.homeTeamId)} seriesWins={homeSeriesWins ?? undefined} overall={calculateTeamOverall(state, nextUserGame.homeTeamId).overall} onOpen={() => onOpenTeam(nextUserGame.homeTeamId)} />
        </div>
        <p>本队下一场比赛 · 备战仅对这一场生效。</p>
        <details className="season-command-pregame postseason-preparation" key={nextUserGame.id}>
          <summary><span>赛前专项备战</span><small>{pregameSummary}</small><b aria-hidden="true">⌄</b></summary>
          <RegularCoachingPanel state={state} busy={busy} selection={currentSelection} onSelectionChange={setPregameSelection} onUnlockVideo={onUnlockVideo} rewardConfirmed={rewardKey ? hasConfirmedCoachingReward(rewardKey) : false} message={coachingMessage} />
        </details>
        <button type="button" className="season-command-primary" data-testid="simulate-postseason-next" disabled={busy} onClick={() => onAdvance(currentSelection)}>{pregameNeedsVideo ? "普通模拟下一场比赛" : "模拟下一场比赛"}</button>
        <div className="season-command-secondary-actions"><button type="button" disabled={busy} onClick={() => onAdvanceRound(currentSelection)}>模拟整轮比赛</button></div>
      </> : userEliminated ? <div className="postseason-finished-team"><TeamLogo team={state.teams[state.userTeamId]} /><div><b>{state.teams[state.userTeamId].fullName}</b><small>本队季后赛 {userWins} 胜 {userPlayed.length - userWins} 负 · 已结束</small></div></div>
        : <div className="postseason-seeking-next" role="status"><span className="pulse-dot active" /><div><b>正在推进其他球队比赛</b><small>排出本队下一场后即可逐场备战</small></div></div>}
      {userEliminated && <button type="button" className="postseason-settle-action" disabled={busy} onClick={onSettle}>结算剩余季后赛</button>}
    </article>

    <section className="postseason-results" aria-label="本队季后赛比赛结果">
      <header><div><small>MY RESULTS</small><h2>本队比赛结果</h2></div><span>已赛 {userPlayed.length} 场</span></header>
      {userPlayed.length > 0 ? <ol>{userPlayed.map((game) =>
        <li key={game.id}>
          <div className="postseason-results-game"><small>{gameRound(state, game)} · {game.date}</small><b>{state.teams[game.awayTeamId]?.name} <i>vs</i> {state.teams[game.homeTeamId]?.name}</b></div>
          <strong className={game.winnerTeamId === state.userTeamId ? "win" : "loss"}>{game.winnerTeamId === state.userTeamId ? "胜" : "负"} · {game.awayScore} : {game.homeScore}</strong>
          <button type="button" onClick={() => onOpenGame(game.id)}>查看详情</button>
        </li>
      )}</ol> : <p className="postseason-results-empty">本队尚无比赛结果</p>}
    </section>

    <details className="postseason-bracket-disclosure">
      <summary><span><small>PLAYOFF BRACKET</small><b>季后赛对阵图</b></span><em>展开查看</em><i aria-hidden="true">⌄</i></summary>
      <PostseasonBracketView state={state} />
    </details>
  </section>;
}
