import { useState } from "react";
import { LEAGUE_FINANCE_CONFIG } from "../config/leagueFinance";
import {
  getFreeAgentCustomOfferPreview, getFreeAgents, getProjectedMarketSalary, getRecommendedFreeAgentOffer,
  type FreeAgencyCommand, type FreeAgentOfferDraft,
} from "../game/freeAgency/FreeAgencyService";
import { calculatePlayerOverall } from "../game/player/PlayerRatingService";
import type { GameState, Position } from "../game/state/types";
import { FreeAgentOfferDialog } from "./FreeAgentOfferDialog";
import { PlayerPortrait } from "./PlayerPortrait";
import { playerNameZh } from "./playerNameZh";
import { adaptiveMoneyLabel, positionPairLabel } from "./uiText";

type PositionFilter = "ALL" | Position;
type SortMode = "overall" | "age" | "salary";
const positions: PositionFilter[] = ["ALL", "PG", "SG", "SF", "PF", "C"];

export function RegularSeasonFreeAgents({ state, onOpenPlayer, onCommand, busy = false }: {
  state: GameState;
  onOpenPlayer: (playerId: string) => void;
  onCommand?: (command: FreeAgencyCommand) => Promise<void>;
  busy?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState<PositionFilter>("ALL");
  const [sort, setSort] = useState<SortMode>("overall");
  const [offerEditor, setOfferEditor] = useState<{ playerId: string; draft: FreeAgentOfferDraft } | null>(null);
  const players = getFreeAgents(state);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visible = players.filter((player) =>
    (position === "ALL" || player.position === position || player.secondaryPosition === position)
      && (!normalizedQuery || `${player.name} ${playerNameZh(player.name, player.id)}`.toLocaleLowerCase().includes(normalizedQuery)))
    .sort((left, right) => sort === "age" ? left.age - right.age || calculatePlayerOverall(right) - calculatePlayerOverall(left)
      : sort === "salary" ? getProjectedMarketSalary(right) - getProjectedMarketSalary(left)
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

  return <section className="regular-free-agents" aria-label="赛季自由球员名单">
    <header><div><h2>自由球员</h2><p>赛季中可浏览未签约球员；UFA 可提交报价，下一比赛日结算。RFA 报价仅在休赛期开放。</p></div><strong>{players.length} 人</strong></header>
    <div className="regular-free-agent-tools">
      <input type="search" aria-label="搜索自由球员" placeholder="搜索球员姓名" value={query} onChange={(event) => setQuery(event.target.value)} />
      <select aria-label="自由球员排序" value={sort} onChange={(event) => setSort(event.target.value as SortMode)}><option value="overall">按 OVR</option><option value="age">按年龄</option><option value="salary">按预计年薪</option></select>
    </div>
    <div className="regular-free-agent-positions" role="group" aria-label="自由球员位置筛选">{positions.map((value) => <button type="button" key={value} aria-pressed={position === value} className={position === value ? "selected" : ""} onClick={() => setPosition(value)}>{value === "ALL" ? "全部" : value}</button>)}</div>
    <p className="regular-free-agent-count">显示 {visible.length} / {players.length} 人 · 包含未签约、合同到期与被裁球员；年薪为引擎估算</p>
    <div className="regular-free-agent-list">{visible.map((player) => {
      const overall = calculatePlayerOverall(player).toFixed(0);
      const activeOffer = Object.values(state.freeAgency?.offers ?? {}).find((offer) => offer.teamId === state.userTeamId && offer.playerId === player.id && offer.status === "ACTIVE");
      const canOffer = Boolean(onCommand) && player.contract.status === "UFA" && !rosterFull;
      return <article key={player.id} className="regular-free-agent-row"><button type="button" className="regular-free-agent-detail" data-player-id={player.id} onClick={() => onOpenPlayer(player.id)}><PlayerPortrait player={player} portraitPath={player.portraitPath} className="regular-free-agent-avatar" /><span className="regular-free-agent-info"><b>{playerNameZh(player.name, player.id)}</b><small>{positionPairLabel(player.position, player.secondaryPosition)} · {player.age} 岁 · {player.contract.status}</small><small>预计年薪 {adaptiveMoneyLabel(getProjectedMarketSalary(player))}</small></span><span className="regular-free-agent-ovr" aria-label={`OVR ${overall}`}><small>OVR</small><strong>{overall}</strong></span></button>{onCommand && <button type="button" className="regular-free-agent-offer" disabled={busy || (!activeOffer && !canOffer)} onClick={() => activeOffer ? void onCommand({ commandId: `regular-fa-withdraw-${activeOffer.offerId}`, type: "WITHDRAW_FA_OFFER", payload: { offerId: activeOffer.offerId } }) : setOfferEditor({ playerId: player.id, draft: getRecommendedFreeAgentOffer(state, player.id) })}>{activeOffer ? "撤回报价" : player.contract.status === "RFA" ? "休赛期报价" : rosterFull ? "名单已满" : "发起报价"}</button>}</article>;
    })}{visible.length === 0 && <p className="regular-free-agent-empty">{players.length ? "没有符合筛选条件的球员。" : "当前没有未签约自由球员。"}</p>}</div>
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
