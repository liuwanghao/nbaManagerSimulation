import { useState } from "react";
import { LEAGUE_FINANCE_CONFIG } from "../config/leagueFinance";
import {
  getCurrentFreeAgentAsk, getFreeAgentCustomOfferPreview, getFreeAgents, getProjectedMarketSalary, getRecommendedFreeAgentOffer,
  type FreeAgencyCommand, type FreeAgentOfferDraft,
} from "../game/freeAgency/FreeAgencyService";
import { calculatePlayerOverall } from "../game/player/PlayerRatingService";
import type { GameState, Player, Position } from "../game/state/types";
import { FreeAgentOfferDialog } from "./FreeAgentOfferDialog";
import { PlayerPortrait } from "./PlayerPortrait";
import { playerNameZh } from "./playerNameZh";
import { playerRatingStyle } from "./playerRatingColor";
import { adaptiveMoneyLabel, positionPairLabel } from "./uiText";

type PositionFilter = "ALL" | Position;
type SortMode = "overall" | "age" | "salary";
type MarketView = "available" | "upcoming";
const positions: PositionFilter[] = ["ALL", "PG", "SG", "SF", "PF", "C"];

export function getUpcomingFreeAgents(state: GameState): Player[] {
  return Object.values(state.players).filter((player) => {
    if (!state.teams[player.teamId] || player.contract.status !== "STANDARD") return false;
    const salaryYears = player.contract.salaryByYear;
    return salaryYears?.length && player.contract.currentYearIndex !== undefined
      ? player.contract.currentYearIndex + 1 >= salaryYears.length
      : player.contract.yearsRemaining === 1;
  });
}

function projectedFreeAgentStatus(player: Player): "UFA" | "RFA" {
  const contract = player.contract;
  const originalYears = contract.salaryByYear?.length ?? (contract.startSeason !== undefined && contract.endSeason !== undefined
    ? contract.endSeason - contract.startSeason + 1 : contract.yearsRemaining);
  return contract.contractType === "ROOKIE_FIRST" && originalYears >= 4 ? "RFA" : "UFA";
}

export function RegularSeasonFreeAgents({ state, onOpenPlayer, onCommand, busy = false }: {
  state: GameState;
  onOpenPlayer: (playerId: string) => void;
  onCommand?: (command: FreeAgencyCommand) => Promise<void>;
  busy?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState<PositionFilter>("ALL");
  const [sort, setSort] = useState<SortMode>("overall");
  const [view, setView] = useState<MarketView>("available");
  const [offerEditor, setOfferEditor] = useState<{ playerId: string; draft: FreeAgentOfferDraft } | null>(null);
  const players = getFreeAgents(state);
  const upcoming = getUpcomingFreeAgents(state);
  const activePlayers = view === "available" ? players : upcoming;
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visible = activePlayers.filter((player) =>
    (position === "ALL" || player.position === position || player.secondaryPosition === position)
      && (!normalizedQuery || `${player.name} ${playerNameZh(player.name, player.id)}`.toLocaleLowerCase().includes(normalizedQuery)))
    .sort((left, right) => sort === "age" ? left.age - right.age || calculatePlayerOverall(right) - calculatePlayerOverall(left)
      : sort === "salary" ? getCurrentFreeAgentAsk(state, right) - getCurrentFreeAgentAsk(state, left)
        : calculatePlayerOverall(right) - calculatePlayerOverall(left));
  const selectedPlayer = offerEditor ? state.players[offerEditor.playerId] : undefined;
  const preview = offerEditor ? getFreeAgentCustomOfferPreview(state, offerEditor.playerId, offerEditor.draft) : undefined;
  const rosterFull = state.teams[state.userTeamId].playerIds.length >= LEAGUE_FINANCE_CONFIG.rosterLimits.regularSeasonMaximum;
  const updateDraft = (patch: Partial<FreeAgentOfferDraft>) => setOfferEditor((current) => current ? { ...current, draft: { ...current.draft, ...patch } } : null);
  const submitOffer = async () => {
    if (!offerEditor || !onCommand || !preview?.valid || busy) return;
    await onCommand({ commandId: `regular-fa-${state.league.seasonId}-${offerEditor.playerId}-${Object.keys(state.commandReceipts).length}`, type: "SUBMIT_FA_OFFER", payload: { playerId: offerEditor.playerId, ...offerEditor.draft } });
    setOfferEditor(null);
  };

  return <section className="regular-free-agents" aria-label="球员市场自由球员名单">
    <header><div><h2>{view === "available" ? "自由球员" : "休赛期即将成为自由球员"}</h2><p>{view === "available" ? "赛季中可浏览未签约球员；UFA 可提交报价，下一日历日结算（包括休息日）。RFA 报价仅在休赛期开放。" : "仅展示本季合同确定到期者，不含下一年待决定选项；休赛期结算前无法报价。"}</p></div><strong>{activePlayers.length} 人</strong></header>
    <div className="regular-free-agent-view-tabs" role="group" aria-label="自由球员市场视图">
      <button type="button" aria-pressed={view === "available"} className={view === "available" ? "selected" : ""} onClick={() => { setOfferEditor(null); setView("available"); }}>当前自由球员 <span>{players.length}</span></button>
      <button type="button" aria-pressed={view === "upcoming"} className={view === "upcoming" ? "selected" : ""} onClick={() => { setOfferEditor(null); setView("upcoming"); }}>休赛期到期 <span>{upcoming.length}</span></button>
    </div>
    <div className="regular-free-agent-tools">
      <input type="search" aria-label="搜索自由球员" placeholder="搜索球员姓名" value={query} onChange={(event) => setQuery(event.target.value)} />
      <select aria-label="自由球员排序" value={sort} onChange={(event) => setSort(event.target.value as SortMode)}><option value="overall">按 OVR</option><option value="age">按年龄</option><option value="salary">按当前要价</option></select>
    </div>
    <div className="regular-free-agent-positions" role="group" aria-label="自由球员位置筛选">{positions.map((value) => <button type="button" key={value} aria-pressed={position === value} className={position === value ? "selected" : ""} onClick={() => setPosition(value)}>{value === "ALL" ? "全部" : value}</button>)}</div>
    <p className="regular-free-agent-count">显示 {visible.length} / {activePlayers.length} 人 · {view === "available" ? "参考估值由能力与年龄计算；当前要价随无合格报价天数调整" : "名单按当前合同预测，赛季结束后才会正式进入自由市场"}</p>
    <div className="regular-free-agent-list">{visible.map((player) => {
      const overall = calculatePlayerOverall(player);
      const activeOffer = view === "available" ? Object.values(state.freeAgency?.offers ?? {}).find((offer) => offer.teamId === state.userTeamId && offer.playerId === player.id && offer.status === "ACTIVE") : undefined;
      const canOffer = Boolean(onCommand) && player.contract.status === "UFA" && !rosterFull;
      return <article key={player.id} className="regular-free-agent-row"><button type="button" className="regular-free-agent-detail" data-player-id={view === "available" ? player.id : undefined} data-expiring-player-id={view === "upcoming" ? player.id : undefined} onClick={() => onOpenPlayer(player.id)}><PlayerPortrait player={player} portraitPath={player.portraitPath} className="regular-free-agent-avatar" /><span className="regular-free-agent-info"><b>{playerNameZh(player.name, player.id)}</b><small>{positionPairLabel(player.position, player.secondaryPosition)} · {player.age} 岁 · {view === "available" ? player.contract.status : `预计 ${projectedFreeAgentStatus(player)}`}</small><small>{view === "available" ? `当前要价 ${adaptiveMoneyLabel(getCurrentFreeAgentAsk(state, player))}` : `${state.teams[player.teamId].name} · 参考估值 ${adaptiveMoneyLabel(getProjectedMarketSalary(player, state.league.seasonYear))}`}</small>{view === "available" && <small>参考估值 {adaptiveMoneyLabel(getProjectedMarketSalary(player, state.league.seasonYear))}</small>}</span><span className="regular-free-agent-ovr" aria-label={`OVR ${overall.toFixed(0)}`}><small>OVR</small><strong className="player-rating-tone" style={playerRatingStyle(overall)}>{overall.toFixed(0)}</strong></span></button>{view === "available" && onCommand && <button type="button" className={`regular-free-agent-offer${activeOffer ? " withdraw" : ""}`} disabled={busy || (!activeOffer && !canOffer)} onClick={() => activeOffer ? void onCommand({ commandId: `regular-fa-withdraw-${activeOffer.offerId}`, type: "WITHDRAW_FA_OFFER", payload: { offerId: activeOffer.offerId } }) : setOfferEditor({ playerId: player.id, draft: getRecommendedFreeAgentOffer(state, player.id) })}>{activeOffer ? "撤回报价" : player.contract.status === "RFA" ? "休赛期报价" : rosterFull ? "名单已满" : "发起报价"}</button>}</article>;
    })}{visible.length === 0 && <p className="regular-free-agent-empty">{activePlayers.length ? "没有符合筛选条件的球员。" : view === "available" ? "当前没有未签约自由球员。" : "当前没有本赛季结束后合同到期的球员。"}</p>}</div>
    {offerEditor && selectedPlayer && <FreeAgentOfferDialog
      state={state}
      playerId={selectedPlayer.id}
      draft={offerEditor.draft}
      busy={busy}
      onChange={updateDraft}
      onClose={() => setOfferEditor(null)}
      onSubmit={() => void submitOffer()}
    />}
  </section>;
}
