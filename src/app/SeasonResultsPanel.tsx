import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AwardType, GameState } from "../game/state/types";
import { finalizeRegularSeasonAwards } from "../game/awards/AwardsService";
import { hasOpeningMipBaselines } from "../game/awards/OpeningMipBaseline";
import { standingsForConference } from "../game/season/career";
import { playerNameZh } from "./playerNameZh";
import { PlayerPortrait } from "./PlayerPortrait";
import { awardLabel, conferenceLabel } from "./uiText";
import { postseasonBracket, type PostseasonSeriesView } from "./seasonResultsView";

const REGULAR_AWARDS: AwardType[] = ["MVP", "DPOY", "ROY", "MIP", "SIXTH_MAN"];
const AWARD_WATERMARK: Partial<Record<AwardType, string>> = { MVP: "MVP", DPOY: "DPOY", ROY: "ROY", MIP: "MIP", SIXTH_MAN: "6MOY" };
const BRACKET_TABS = [{ id: "EAST", label: "东部" }, { id: "WEST", label: "西部" }, { id: "FINALS", label: "总决赛" }] as const;
type BracketTab = typeof BRACKET_TABS[number]["id"];

function AwardCard({ state, type, playerId, onOpen, emptyLabel }: {
  state: GameState; type: AwardType; playerId?: string; onOpen: (playerId: string) => void; emptyLabel: string;
}) {
  const player = playerId ? state.players[playerId] : undefined;
  const team = player ? state.teams[player.teamId] : undefined;
  const featured = type === "MVP";
  return <button type="button" className={`season-award-card${featured ? " featured" : ""}`} disabled={!player} onClick={() => player && onOpen(player.id)}>
    {player ? <PlayerPortrait player={player} portraitPath={player.portraitPath} className="season-award-avatar" /> : <span className="season-award-avatar-empty" aria-hidden="true">★</span>}
    <span className="season-award-copy"><small>{featured && <span aria-hidden="true">🏆 </span>}{awardLabel(type)}{featured ? " (MVP)" : ""}</small><strong>{player ? playerNameZh(player.name, player.id) : emptyLabel}</strong><em>{team?.fullName ?? ""}</em></span>
    {AWARD_WATERMARK[type] && <span className="season-award-watermark" aria-hidden="true">{AWARD_WATERMARK[type]}</span>}
  </button>;
}

function Series({ state, series, seedRanks, note }: { state: GameState; series: PostseasonSeriesView; seedRanks: Record<string, number>; note?: string }) {
  const teamLine = (teamId: string | undefined, placeholder: string | undefined, wins: number | undefined) => {
    const team = teamId ? state.teams[teamId] : undefined;
    const seed = teamId ? seedRanks[teamId] : undefined;
    return <span className={series.winner === teamId && teamId ? "winner" : undefined}>
      <span className="season-series-team">{seed && <small className="season-series-seed" title={`常规赛分区第 ${seed} 名`}>#{seed}</small>}<b>{team?.name ?? placeholder ?? "待定"}</b></span>
      {wins !== undefined && <strong>{wins}</strong>}
    </span>;
  };
  return <div className="season-series">
    {note && <small className="season-series-note">{note}</small>}
    {teamLine(series.teamA, series.placeholderA, series.winsA)}
    {teamLine(series.teamB, series.placeholderB, series.winsB)}
  </div>;
}

export function PostseasonBracketView({ state }: { state: GameState }) {
  const [bracketTab, setBracketTab] = useState<BracketTab>("EAST");
  const bracket = postseasonBracket(state);
  const selectedConference = bracket.conferences.find((conference) => conference.conference === bracketTab);
  const seedRanks = useMemo(() => {
    const ranks: Record<string, number> = {};
    for (const conference of ["EAST", "WEST"] as const) {
      standingsForConference(state, conference).forEach((record, index) => { ranks[record.teamId] = index + 1; });
    }
    return ranks;
  }, [state]);

  return <section className="season-results-bracket" aria-label="季后赛对阵图">
    <header><h3>{bracket.settled ? "季后赛最终结果" : "季后赛对阵席位"}</h3><small>{bracket.settled ? "系列赛比分" : bracketTab === "FINALS" ? "东西部冠军产生后确定对阵" : "附加赛胜者产生后确定最终首轮对阵"}</small></header>
    <div className="season-bracket-tabs" role="tablist" aria-label="筛选季后赛对阵" onKeyDown={(event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const current = BRACKET_TABS.findIndex((tab) => tab.id === bracketTab);
      const next = event.key === "Home" ? 0 : event.key === "End" ? BRACKET_TABS.length - 1
        : (current + (event.key === "ArrowRight" ? 1 : -1) + BRACKET_TABS.length) % BRACKET_TABS.length;
      setBracketTab(BRACKET_TABS[next].id);
      (event.currentTarget.querySelectorAll<HTMLButtonElement>("[role=tab]")[next])?.focus();
    }}>{BRACKET_TABS.map((tab) => <button type="button" key={tab.id} role="tab" id={`season-bracket-tab-${tab.id}`} aria-controls="season-bracket-tab-panel" aria-selected={bracketTab === tab.id} tabIndex={bracketTab === tab.id ? 0 : -1} onClick={() => setBracketTab(tab.id)}>{tab.label}</button>)}</div>
    {selectedConference ? <div className="season-bracket-conferences" role="tabpanel" id="season-bracket-tab-panel" aria-labelledby={`season-bracket-tab-${bracketTab}`}><div className="season-bracket-conference">
      <h4>{conferenceLabel(selectedConference.conference)}</h4>
      <div className="season-bracket-rounds">
        {([
          ["play-in", "附加赛", selectedConference.playIn],
          ["first-round", "首轮", selectedConference.firstRound],
          ["semifinals", "半决赛", selectedConference.semifinals],
          ["conference-final", `${conferenceLabel(selectedConference.conference)}决赛`, selectedConference.final],
        ] as const).map(([round, label, series]) => <div className="season-bracket-round" data-round={round} key={round}><h5>{label}</h5><div>{series.map((item, index) => <Series key={index} state={state} series={item} seedRanks={seedRanks} note={round === "play-in" ? ["第 8 席决胜", "9/10 淘汰赛", "第 7 席争夺"][index] : undefined} />)}</div></div>)}
      </div>
    </div></div> : <div className="season-bracket-finals" role="tabpanel" id="season-bracket-tab-panel" aria-labelledby="season-bracket-tab-FINALS"><h4>总决赛</h4><Series state={state} series={bracket.finals[0] ?? { placeholderA: "东部冠军", placeholderB: "西部冠军" }} seedRanks={seedRanks} /></div>}
  </section>;
}

export function SeasonResultsPanel({ state, onOpenPlayer }: { state: GameState; onOpenPlayer: (playerId: string) => void }) {
  const [showBracket, setShowBracket] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const storedAwardRecord = state.history.seasonAwards.find((entry) => entry.seasonId === state.league.seasonId);
  const awardRecord = useMemo(() => {
    return storedAwardRecord?.winners.MVP ? storedAwardRecord
      : finalizeRegularSeasonAwards(state).history.seasonAwards.find((entry) => entry.seasonId === state.league.seasonId);
  }, [state, storedAwardRecord]);
  const settledAwards = Boolean(storedAwardRecord?.winners.MVP);
  const bracket = postseasonBracket(state);
  useEffect(() => {
    if (!showBracket) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.querySelector<HTMLButtonElement>(".season-results-dialog-close")?.focus();
    return () => previousFocus?.focus();
  }, [showBracket]);

  return <section className="season-results" aria-label="赛季结果">
    <section className="season-results-home-awards" aria-label="常规赛奖项速览">
      <header><div><small>SEASON HONORS</small><h3>常规赛奖项</h3></div></header>
      {!settledAwards && <p className="season-awards-preview-note">根据当前赛季数据预览</p>}
      <div className="season-results-home-award-list">{REGULAR_AWARDS.map((type) => <AwardCard key={type} state={state} type={type} playerId={awardRecord?.winners[type]} emptyLabel={type === "MIP" ? hasOpeningMipBaselines(state) ? "模拟基线候选待评选" : state.history.seasons.length === 0 ? "首季缺少历史数据" : "暂无合格候选" : "待评选"} onOpen={onOpenPlayer} />)}</div>
    </section>
    <div className="season-results-actions" aria-label="查看赛季详情">
      <button type="button" onClick={() => setShowBracket(true)}><span><small>{bracket.settled ? "最终赛果" : "对阵席位"}</small><b>查看季后赛对阵图</b></span><i aria-hidden="true">→</i></button>
    </div>
    {showBracket && typeof document !== "undefined" && createPortal(<div className="season-results-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowBracket(false); }}>
      <section ref={dialogRef} className="season-results-dialog" role="dialog" aria-modal="true" aria-labelledby="season-results-dialog-title" onKeyDown={(event) => {
        if (event.key === "Escape") setShowBracket(false);
        if (event.key !== "Tab") return;
        const buttons = [...(dialogRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
        if (!buttons.length) return;
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (event.shiftKey && index <= 0) { event.preventDefault(); buttons.at(-1)?.focus(); }
        else if (!event.shiftKey && index === buttons.length - 1) { event.preventDefault(); buttons[0]?.focus(); }
      }}>
        <header className="season-results-dialog-heading"><div><span className="section-kicker">{state.league.seasonId} · SEASON REVIEW</span><h2 id="season-results-dialog-title">季后赛对阵图</h2></div><button type="button" className="season-results-dialog-close" aria-label="关闭赛季详情" onClick={() => setShowBracket(false)}>×</button></header>
        <PostseasonBracketView state={state} />
      </section>
    </div>, document.body)}
  </section>;
}
