import { useMemo, useRef, useState } from "react";
import { BALANCE_CONFIG } from "../config/balanceConfig";
import { ACHIEVEMENT_IDS } from "../game/career/AchievementService";
import {
  getCareerMilestones,
  getCareerOverview,
  getCareerSeasonSummaries,
  getFranchiseRecords,
} from "../game/career/CareerRecords";
import { getFranchiseLeaders } from "../game/career/FranchiseStats";
import type { AchievementId, GameResult, GameState } from "../game/state/types";
import { careerPostDraft, openCareerPostEditor } from "./careerShare";
import { localizePlayerNamesInText, playerNameZh } from "./playerNameZh";
import { awardLabel } from "./uiText";

export type CareerTab = "overview" | "achievements" | "history" | "milestones";

const ACHIEVEMENT_DESCRIPTIONS: Record<AchievementId, string> = {
  EXPANSION_COMPLETE: "完成扩军选秀，组建新球队",
  FIRST_WIN: "赢得球队第一场常规赛",
  TEN_WINS: "生涯常规赛累计赢得 10 场",
  TWENTY_FIVE_WINS: "生涯常规赛累计赢得 25 场",
  FIFTY_CAREER_WINS: "生涯常规赛累计赢得 50 场",
  HUNDRED_WINS: "生涯常规赛累计赢得 100 场",
  TWO_HUNDRED_WINS: "生涯常规赛累计赢得 200 场",
  FIRST_PLAY_IN: "第一次参加附加赛",
  FIRST_PLAYOFFS: "第一次进入季后赛",
  FIRST_SERIES_WIN: "赢得第一轮季后赛系列赛",
  TWO_SERIES_WINS: "单次季后赛赢得两轮系列赛",
  THREE_SERIES_WINS: "单次季后赛赢得三轮系列赛",
  CONFERENCE_FINALS: "第一次进入分区决赛",
  FINALS_APPEARANCE: "第一次进入总决赛",
  FIRST_CHAMPIONSHIP: "赢得球队第一座总冠军",
  SECOND_CHAMPIONSHIP: "生涯累计赢得两座总冠军",
  THIRD_CHAMPIONSHIP: "生涯累计赢得三座总冠军",
  THIRTY_WIN_SEASON: "单赛季常规赛赢得 30 场",
  FORTY_WIN_SEASON: "单赛季常规赛赢得 40 场",
  FIFTY_WIN_SEASON: "单赛季常规赛赢得 50 场",
  SIXTY_WIN_SEASON: "单赛季常规赛赢得 60 场",
  HOMEGROWN_ALL_STAR: "亲自选中的球员入选全明星",
  ROOKIE_OF_YEAR: "球队球员获得年度最佳新秀",
  MVP_WINNER: "球队球员获得常规赛 MVP",
  DPOY_WINNER: "球队球员获得年度最佳防守球员",
  MOST_IMPROVED_WINNER: "球队球员获得年度进步最快球员",
  SIXTH_MAN_WINNER: "球队球员获得年度最佳第六人",
  DYNASTY_TWO_OF_THREE: "三个赛季内赢得两次总冠军",
};

const ACHIEVEMENT_GROUPS: { label: string; ids: AchievementId[] }[] = [
  { label: "起步与战绩", ids: ["EXPANSION_COMPLETE", "FIRST_WIN", "TEN_WINS", "TWENTY_FIVE_WINS", "FIFTY_CAREER_WINS", "HUNDRED_WINS", "TWO_HUNDRED_WINS", "THIRTY_WIN_SEASON", "FORTY_WIN_SEASON", "FIFTY_WIN_SEASON", "SIXTY_WIN_SEASON"] },
  { label: "季后赛之路", ids: ["FIRST_PLAY_IN", "FIRST_PLAYOFFS", "FIRST_SERIES_WIN", "TWO_SERIES_WINS", "THREE_SERIES_WINS", "CONFERENCE_FINALS", "FINALS_APPEARANCE", "FIRST_CHAMPIONSHIP", "SECOND_CHAMPIONSHIP", "THIRD_CHAMPIONSHIP"] },
  { label: "球星与王朝", ids: ["HOMEGROWN_ALL_STAR", "ROOKIE_OF_YEAR", "MVP_WINNER", "DPOY_WINNER", "MOST_IMPROVED_WINNER", "SIXTH_MAN_WINNER", "DYNASTY_TWO_OF_THREE"] },
];

const POSTSEASON_LABELS = {
  champion: "总冠军",
  finals: "总决赛",
  "conference-finals": "分区决赛",
  playoffs: "季后赛",
  "play-in": "附加赛",
  "regular-season": "常规赛",
  "in-progress": "进行中",
} as const;

function achievementProgress(id: AchievementId, state: GameState, careerWins: number, bestSeasonWins: number): { current: number; target: number; unit: string } {
  const unlocked = Boolean(state.achievements[id]?.unlocked);
  const trigger = BALANCE_CONFIG.achievements[id].trigger;
  let current = unlocked ? 1 : 0;
  let target = 1;
  let unit = "次";
  if (trigger.type === "CAREER_WINS") {
    current = careerWins;
    target = trigger.value;
    unit = "胜";
  } else if (trigger.type === "SEASON_WINS") {
    current = bestSeasonWins;
    target = trigger.value;
    unit = "胜";
  } else if (trigger.type === "SERIES_WINS") {
    current = Math.max(0, ...state.history.seasons.map((season) => season.userPostseason.seriesWins));
    target = trigger.value;
    unit = "轮";
  } else if (trigger.type === "CHAMPIONSHIPS") {
    current = state.history.champions.filter((entry) => entry.teamId === state.userTeamId).length;
    target = trigger.value;
    unit = "冠";
  } else if (id === "DYNASTY_TWO_OF_THREE") {
    const years = state.history.champions.filter((entry) => entry.teamId === state.userTeamId)
      .map((entry) => Number(entry.seasonId.slice(0, 4))).filter(Number.isFinite);
    current = years.reduce((best, year) => Math.max(best, years.filter((other) => other >= year && other < year + 3).length), 0);
    target = 2;
    unit = "冠 / 3季";
  }
  return { current: Math.min(target, Math.max(current, unlocked ? target : 0)), target, unit };
}

function CareerHeading({ kicker, title, description, aside }: { kicker: string; title: string; description: string; aside: string }) {
  return <header className="league-page-heading"><div><small>{kicker}</small><h2>{title}</h2><p>{description}</p></div><strong>{aside}</strong></header>;
}

function SectionHeading({ eyebrow, title, count }: { eyebrow: string; title: string; count?: string }) {
  return <div className="league-section-heading"><div><small>{eyebrow}</small><h3>{title}</h3></div>{count && <span>{count}</span>}</div>;
}

function AwardWinner({ state, playerId, onOpenPlayer }: { state: GameState; playerId: string; onOpenPlayer: (id: string) => void }) {
  const player = state.players[playerId];
  return player
    ? <button type="button" className="career-text-button" onClick={() => onOpenPlayer(playerId)}>{playerNameZh(player.name, player.id)}</button>
    : <span>{playerId}</span>;
}

function SeasonGameButton({ game, state, label, onOpenGame }: { game: GameResult; state: GameState; label: string; onOpenGame: (game: GameResult) => void }) {
  const opponentId = game.homeTeamId === state.userTeamId ? game.awayTeamId : game.homeTeamId;
  const won = game.winnerTeamId === state.userTeamId;
  return <button className="career-game-row" type="button" onClick={() => onOpenGame(game)}>
    <span><small>{label} · {game.date}</small><b>对 {state.teams[opponentId]?.name ?? opponentId}</b></span>
    <strong className={won ? "won" : "lost"}>{won ? "胜" : "负"} {game.homeTeamId === state.userTeamId ? `${game.homeScore}-${game.awayScore}` : `${game.awayScore}-${game.homeScore}`}</strong>
  </button>;
}

export function CareerPages({ state, activeTab, onOpenPlayer, onOpenGame }: {
  state: GameState;
  activeTab: CareerTab;
  onOpenPlayer: (id: string) => void;
  onOpenGame: (game: GameResult) => void;
}) {
  const [achievementFilter, setAchievementFilter] = useState<"all" | "unlocked" | "locked">("all");
  const [shareStatus, setShareStatus] = useState("");
  const [isOpeningPost, setIsOpeningPost] = useState(false);
  const openingPostRef = useRef(false);
  const overview = useMemo(() => getCareerOverview(state), [state]);
  const seasons = useMemo(() => getCareerSeasonSummaries(state), [state]);
  const milestones = useMemo(() => getCareerMilestones(state), [state]);
  const latestMilestone = milestones[0];
  const records = useMemo(() => getFranchiseRecords(state), [state]);
  const playerLeaders = useMemo(() => getFranchiseLeaders(state), [state]);
  const unlockedCount = ACHIEVEMENT_IDS.filter((id) => state.achievements[id]?.unlocked).length;
  const latestOwnTitle = [...state.history.champions].reverse().find((champion) => champion.teamId === state.userTeamId);
  const visibleAchievements = ACHIEVEMENT_IDS.filter((id) => achievementFilter === "all" || Boolean(state.achievements[id]?.unlocked) === (achievementFilter === "unlocked"));
  const awardSeasons = [...state.history.seasonAwards].reverse().filter((entry) => Object.keys(entry.winners).length > 0);
  const bestSeasonWins = Math.max(0, ...seasons.map((season) => season.wins));

  async function handleShareCareer() {
    if (openingPostRef.current) return;
    openingPostRef.current = true;
    setIsOpeningPost(true);
    setShareStatus("正在打开虎扑发帖编辑器…");
    try {
      await openCareerPostEditor(careerPostDraft(state, overview, records, latestMilestone?.label));
      setShareStatus("发帖编辑器已打开，请确认内容后发布。");
    } catch (error) {
      setShareStatus(error instanceof Error ? error.message : "发帖编辑器暂时无法打开，请稍后重试。");
    } finally {
      openingPostRef.current = false;
      setIsOpeningPost(false);
    }
  }

  return <div id="season-career" className="career-hub">
    <section id="career-panel-overview" role="tabpanel" aria-labelledby="career-tab-overview" className="career-page" hidden={activeTab !== "overview"} data-testid="gm-career-card">
      <div className="career-overview-lead league-section-card">
        <div className="career-overview-lead-top"><span>生涯总览</span><span>{state.league.seasonId} 赛季</span></div>
        <div className="career-overview-lead-main">
          <div><small>{state.teams[state.userTeamId].fullName} · 总经理生涯</small><h2>{overview.level}</h2><p>从扩军建队到王朝之路，每一季都值得记录。</p></div>
          <div className="career-overview-dynasty"><small>王朝积分</small><strong>{overview.dynastyScore}</strong></div>
        </div>
        <div className="career-overview-primary" aria-label="生涯关键数据">
          <div><small>常规赛战绩</small><strong>{overview.regularSeasonWins}<i>–</i>{overview.regularSeasonLosses}</strong><span>含当前赛季</span></div>
          <div><small>总冠军</small><strong>{overview.championships}<i> 座</i></strong><span>球队荣誉</span></div>
          <div><small>完整赛季</small><strong>{overview.seasons}<i> 季</i></strong><span>持续书写中</span></div>
        </div>
      </div>
      <div className="career-share-strip league-section-card">
        <div><small>生涯战报</small><b>把这段执教故事分享给 JRs</b><span>自动带上王朝积分 {overview.dynastyScore}、战绩与荣誉，发帖前可编辑</span></div>
        <button type="button" onClick={handleShareCareer} disabled={isOpeningPost}>{isOpeningPost ? "正在打开…" : "一键发帖分享 ↗"}</button>
        {shareStatus && <p className="career-share-status" role="status" aria-live="polite">{shareStatus}</p>}
      </div>
      <div className="career-overview-secondary league-section-card" aria-label="生涯经营数据">
        {([
          ["附加赛 / 季后赛胜场", overview.playoffWins],
          ["分区冠军", overview.conferenceTitles],
          ["选秀球员", overview.draftCount],
          ["完成交易", overview.tradeCount],
        ] as const).map(([label, value]) => <div key={label}><small>{label}</small><strong>{value}</strong></div>)}
      </div>
      <section className="league-section-card"><SectionHeading eyebrow="球队纪录" title="队史高光" />
        <div className="career-record-list">
          <div><small>最佳赛季战绩</small><b>{records.bestSeason ? `${records.bestSeason.seasonId} · ${records.bestSeason.wins}-${records.bestSeason.losses}${records.bestSeason.isCurrent ? "（进行中）" : ""}` : "等待首场比赛"}</b></div>
          <div><small>最长连胜</small><b>{records.longestWinningStreak ? `${records.longestWinningStreak.wins} 连胜 · ${records.longestWinningStreak.seasonId}` : "尚无连胜"}</b></div>
          <div><small>最近一次夺冠</small><b>{latestOwnTitle?.seasonId ?? "等待第一座奖杯"}</b></div>
        </div>
      </section>
    </section>

    <section id="career-panel-achievements" role="tabpanel" aria-labelledby="career-tab-achievements" className="career-page" hidden={activeTab !== "achievements"}>
      <CareerHeading kicker="生涯挑战" title="成就系统" description="完成目标，记录球队从新军到冠军的每一步" aside={`${unlockedCount} / ${ACHIEVEMENT_IDS.length} 已解锁`} />
      <div className="league-section-card"><SectionHeading eyebrow="成就进度" title="收集记录" count={`${Math.round(unlockedCount / ACHIEVEMENT_IDS.length * 100)}%`} />
        <div className="career-progress" role="progressbar" aria-label="成就解锁进度" aria-valuenow={unlockedCount} aria-valuemin={0} aria-valuemax={ACHIEVEMENT_IDS.length}><span style={{ width: `${unlockedCount / ACHIEVEMENT_IDS.length * 100}%` }} /></div>
        <div className="career-achievement-summary" aria-label="分类成就进度">{ACHIEVEMENT_GROUPS.map((group) => {
          const groupUnlocked = group.ids.filter((id) => state.achievements[id]?.unlocked).length;
          return <div key={group.label}><span><b>{group.label}</b><strong>{groupUnlocked}<i> / {group.ids.length}</i></strong></span><div role="progressbar" aria-label={`${group.label}进度`} aria-valuenow={groupUnlocked} aria-valuemin={0} aria-valuemax={group.ids.length}><u style={{ width: `${groupUnlocked / group.ids.length * 100}%` }} /></div></div>;
        })}</div>
        <div className="career-filter" role="group" aria-label="筛选成就">
          {(["all", "unlocked", "locked"] as const).map((filter) => <button key={filter} type="button" className={achievementFilter === filter ? "selected" : ""} aria-pressed={achievementFilter === filter} onClick={() => setAchievementFilter(filter)}>{({ all: "全部", unlocked: "已解锁", locked: "未解锁" })[filter]}</button>)}
        </div>
        <div className="career-achievement-grid">{visibleAchievements.map((id) => {
          const achievement = state.achievements[id];
          const unlocked = Boolean(achievement?.unlocked);
          const progress = achievementProgress(id, state, overview.regularSeasonWins, bestSeasonWins);
          return <article key={id} className={unlocked ? "unlocked" : "locked"}>
            <span className="career-achievement-index">{String(ACHIEVEMENT_IDS.indexOf(id) + 1).padStart(2, "0")}</span>
            <div><b>{BALANCE_CONFIG.achievements[id].label}</b><p>{ACHIEVEMENT_DESCRIPTIONS[id]}</p>
              <div className="career-achievement-meta"><small>{unlocked ? `${achievement.seasonId ?? "生涯"} 解锁` : "未解锁"} · +{BALANCE_CONFIG.achievements[id].reward.dynastyScore} 积分</small><span>{progress.current} / {progress.target} {progress.unit}</span></div>
              <div className="career-achievement-progress"><i role="progressbar" aria-label={`${BALANCE_CONFIG.achievements[id].label}进度`} aria-valuemin={0} aria-valuemax={progress.target} aria-valuenow={progress.current}><u style={{ width: `${progress.current / progress.target * 100}%` }} /></i></div>
            </div>
            <strong>{unlocked ? "✓" : "◇"}</strong>
          </article>;
        })}</div>
        {!visibleAchievements.length && <p className="career-empty">当前筛选下没有成就。</p>}
      </div>
    </section>

    <section id="career-panel-history" role="tabpanel" aria-labelledby="career-tab-history" className="career-page" hidden={activeTab !== "history"}>
      <CareerHeading kicker="球队档案" title="球队历史" description="按赛季回顾战绩、季后赛成绩、奖项和关键比赛" aside={`${seasons.length} 个赛季`} />
      <div className="career-record-grid league-section-card" aria-label="球队历史纪录">
        <div><small>队史首胜</small><b>{records.firstWin ? records.firstWin.date : "尚未取得"}</b><span>{records.firstWin ? `对 ${state.teams[records.firstWin.opponentTeamId]?.name ?? records.firstWin.opponentTeamId}` : "等待第一场胜利"}</span></div>
        <div><small>最佳赛季战绩</small><b>{records.bestSeason ? `${records.bestSeason.wins}-${records.bestSeason.losses}` : "—"}</b><span>{records.bestSeason ? `${records.bestSeason.seasonId}${records.bestSeason.isCurrent ? " · 进行中" : ""}` : "等待首场比赛"}</span></div>
        <div><small>最长连胜</small><b>{records.longestWinningStreak ? `${records.longestWinningStreak.wins} 场` : "—"}</b><span>{records.longestWinningStreak?.seasonId ?? "等待连续获胜"}</span></div>
      </div>
      <section className="league-section-card"><SectionHeading eyebrow="球员纪录" title="队史数据领袖" count="常规赛累计" />
        {playerLeaders.coverage.status === "PARTIAL" && <p className="career-history-note">旧存档的部分比赛详情已压缩，榜单仅统计留存的 {playerLeaders.coverage.countedGames} 场球队比赛。</p>}
        <div className="career-player-leaders">{([
          ["points", "得分"], ["rebounds", "篮板"], ["assists", "助攻"],
        ] as const).map(([key, title]) => <div key={key}><h4>{title}榜</h4>
          {playerLeaders[key].length ? <ol>{playerLeaders[key].slice(0, 3).map((entry, index) => <li key={entry.playerId}><span>{index + 1}</span>{state.players[entry.playerId] ? <button type="button" onClick={() => onOpenPlayer(entry.playerId)}>{playerNameZh(entry.playerName, entry.playerId)}</button> : <b>{playerNameZh(entry.playerName, entry.playerId)}</b>}<strong>{entry[key].toLocaleString()}</strong></li>)}</ol> : <p className="career-empty">暂无比赛数据</p>}
        </div>)}</div>
      </section>
      <div className="career-season-list">{seasons.map((season) => {
        const archive = state.history.seasons.find((entry) => entry.seasonId === season.seasonId);
        const drafts = state.gmCareer.draftHistory.filter((entry) => entry.seasonId === season.seasonId);
        const trades = state.gmCareer.tradeHistory.filter((entry) => entry.seasonId === season.seasonId);
        const seasonFirstWinId = archive?.regularSeasonResults
          .filter((game) => game.winnerTeamId === state.userTeamId && (game.homeTeamId === state.userTeamId || game.awayTeamId === state.userTeamId))
          .sort((left, right) => left.date.localeCompare(right.date) || left.gameId.localeCompare(right.gameId))[0]?.gameId;
        const seasonFirstWin = seasonFirstWinId ? archive?.userRegularGameDetails[seasonFirstWinId] : undefined;
        const postseasonGames = archive ? Object.values(archive.postseasonGameDetails)
          .filter((game) => game.homeTeamId === state.userTeamId || game.awayTeamId === state.userTeamId)
          .sort((left, right) => Number.parseInt(left.date.replace("POST-", ""), 10) - Number.parseInt(right.date.replace("POST-", ""), 10) || left.gameId.localeCompare(right.gameId)) : [];
        const lastPostseasonGame = postseasonGames.at(-1);
        const keyGames = [seasonFirstWin && { game: seasonFirstWin, label: "赛季首胜" }, lastPostseasonGame && { game: lastPostseasonGame, label: "淘汰赛末战" }].filter((entry): entry is { game: GameResult; label: string } => Boolean(entry));
        return <details className="career-season-card league-section-card" key={season.seasonId}>
          <summary><span className="career-season-badge">{season.isCurrent ? "NOW" : season.seasonId.slice(0, 4)}</span><span className="career-season-title"><b>{season.seasonId} 赛季</b><small>{POSTSEASON_LABELS[season.postseason]} · {season.isCurrent ? "实时战绩" : "最终战绩"}</small></span><strong>{season.wins}-{season.losses}</strong><span className="career-season-chevron" aria-hidden="true">⌄</span></summary>
          <div className="career-season-detail">
            <div className="career-season-facts"><span><small>赛季结果</small><b>{POSTSEASON_LABELS[season.postseason]}</b></span><span><small>选秀 / 交易</small><b>{season.draftCount} / {season.tradeCount}</b></span><span><small>联盟冠军</small><b>{season.championTeamId ? state.teams[season.championTeamId]?.name ?? season.championTeamId : "待决出"}</b></span></div>
            {Object.entries(season.awards).length > 0 && <div className="career-season-awards"><small>联盟赛季奖项</small><div>{Object.entries(season.awards).map(([award, playerId]) => playerId && <span key={award}><b>{awardLabel(award)}</b><AwardWinner state={state} playerId={playerId} onOpenPlayer={onOpenPlayer} /></span>)}</div></div>}
            {(drafts.length > 0 || trades.length > 0) && <div className="career-season-moves"><small>我的经营记录</small><div>
              {drafts.map((draft) => <span key={`${draft.pickNumber}-${draft.playerId}`}><b>选秀 · 第 {draft.pickNumber} 顺位</b><AwardWinner state={state} playerId={draft.playerId} onOpenPlayer={onOpenPlayer} /></span>)}
              {trades.map((trade) => <span key={trade.offerId}><b>交易</b><em>{localizePlayerNamesInText(trade.summary, Object.values(state.players))}</em></span>)}
            </div></div>}
            {keyGames.length > 0 && <div className="career-season-games"><small>关键比赛</small>{keyGames.map(({ game, label }) => <SeasonGameButton key={game.gameId} game={game} state={state} label={label} onOpenGame={onOpenGame} />)}</div>}
            {season.isCurrent && <p className="career-empty">本赛季尚在进行；赛季结束后会写入奖项和季后赛档案。</p>}
          </div>
        </details>;
      })}</div>
    </section>

    <section id="career-panel-milestones" role="tabpanel" aria-labelledby="career-tab-milestones" className="career-page" hidden={activeTab !== "milestones"}>
      <CareerHeading kicker="高光时刻" title="里程碑" description="按达成时间回看球队的重要节点和历季获奖者" aside={`${milestones.length} 个节点`} />
      <section className="league-section-card"><SectionHeading eyebrow="球队节点" title="成就时间线" count="最新在前" />
        {milestones.length ? <ol className="career-timeline">{milestones.map((entry) => <li key={entry.id}><span className="career-timeline-dot" aria-hidden="true" /><div><small>{entry.seasonId ?? "生涯"}{entry.dayIndex === null ? "" : ` · 第 ${entry.dayIndex + 1} 比赛日`}</small><b>{entry.label}</b><p>{ACHIEVEMENT_DESCRIPTIONS[entry.id]}</p></div></li>)}</ol> : <p className="career-empty">完成首项成就后，里程碑会按时间出现在这里。</p>}
      </section>
      <section className="league-section-card"><SectionHeading eyebrow="联盟荣誉" title="历季获奖者" count={`${awardSeasons.length} 季`} />
        {awardSeasons.length ? <div className="career-award-seasons">{awardSeasons.map((season) => <div key={season.seasonId}><h4>{season.seasonId}</h4><div>{Object.entries(season.winners).map(([award, playerId]) => playerId && <span key={award}><small>{awardLabel(award)}</small><AwardWinner state={state} playerId={playerId} onOpenPlayer={onOpenPlayer} /></span>)}</div></div>)}</div> : <p className="career-empty">首个赛季结束后会公布获奖者。</p>}
      </section>
    </section>
  </div>;
}
