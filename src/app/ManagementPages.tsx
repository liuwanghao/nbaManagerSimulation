import { useState } from "react";
import { LEAGUE_FINANCE_CONFIG } from "../config/leagueFinance";
import type { CapSheet } from "../game/cap/CapSheetService";
import { calculatePlayerOverall } from "../game/player/PlayerRatingService";
import type { DraftPickAsset, Player, StandingRecord, Team } from "../game/state/types";
import { fitGrade, type TeamFitBreakdown } from "../game/team/TeamFitService";
import { PlayerPortrait } from "./PlayerPortrait";
import { playerNameZh } from "./playerNameZh";
import { adaptiveMoneyLabel as moneyLabel, conferenceLabel, contractStatusLabel, positionPairLabel } from "./uiText";

type PlayerSort = "minutes" | "points" | "overall";

export function playerPerGame(total: number, games: number, divisor = 1): string {
  return games > 0 ? (total / divisor / games).toFixed(1) : "—";
}

function percentage(made: number, attempted: number): string {
  return attempted > 0 ? `${(made / attempted * 100).toFixed(1)}%` : "—";
}

function TeamMark({ team }: { team: Team }) {
  return <span className="manage-team-mark">{team.logoUrl ? <img src={team.logoUrl} alt="" /> : team.abbreviation}</span>;
}

export function ManagementOverview({ team, players, record, rank, seasonId, overall, fit, onOpenPlayer }: {
  team: Team;
  players: Player[];
  record: StandingRecord;
  rank: number;
  seasonId: string;
  overall: number;
  fit: TeamFitBreakdown;
  onOpenPlayer: (playerId: string) => void;
}) {
  const [sort, setSort] = useState<PlayerSort>("minutes");
  const games = record.wins + record.losses;
  const sortedPlayers = [...players].sort((left, right) => {
    const value = (player: Player) => sort === "overall" ? calculatePlayerOverall(player)
      : sort === "points" ? player.seasonStats.pts / Math.max(1, player.seasonStats.games)
        : player.seasonStats.seconds / Math.max(1, player.seasonStats.games);
    return value(right) - value(left) || calculatePlayerOverall(right) - calculatePlayerOverall(left) || left.id.localeCompare(right.id);
  });
  const abilities = [
    ["进攻能力", fit.offense], ["防守能力", fit.defense], ["阵容适配", fit.score], ["替补深度", fit.depth],
  ] as const;

  return <div className="manage-page-content manage-overview">
    <header className="manage-team-hero">
      <TeamMark team={team} />
      <div><small>{seasonId} · 球队信息</small><h2>{team.fullName}</h2><p>{conferenceLabel(team.conference)}第 {rank} · {record.wins}胜 {record.losses}负</p></div>
      <span className="manage-team-ovr"><b>{overall}</b><small>总评</small></span>
    </header>
    <div className="manage-overview-numbers">
      <span><small>球队战绩</small><b>{record.wins}-{record.losses}</b></span>
      <span><small>场均得分</small><b>{playerPerGame(record.pointsFor, games)}</b></span>
      <span><small>场均失分</small><b>{playerPerGame(record.pointsAgainst, games)}</b></span>
      <span><small>场均净胜</small><b>{games ? `${(record.pointsFor - record.pointsAgainst >= 0 ? "+" : "")}${playerPerGame(record.pointsFor - record.pointsAgainst, games)}` : "—"}</b></span>
    </div>
    <section className="manage-section-card" aria-label="球队阵容能力">
      <div className="manage-section-heading"><div><h3>球队阵容能力</h3></div><span>适配 {fitGrade(fit.score)}</span></div>
      <div className="manage-ability-grid">{abilities.map(([label, value]) => <span key={label}><small>{label}</small><b>{value.toFixed(0)}</b><i><u style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></i></span>)}</div>
    </section>
    <section className="manage-section-card manage-player-section" aria-label="球员赛季数据">
      <div className="manage-section-heading"><div><h3>球员赛季概览</h3></div><label>排序 <select aria-label="球员数据排序" value={sort} onChange={(event) => setSort(event.target.value as PlayerSort)}><option value="minutes">出场时间</option><option value="points">场均得分</option><option value="overall">能力值</option></select></label></div>
      <p className="manage-section-note">场均数据随比赛更新；点击球员可查看详细资料。左右滑动查看完整数据。</p>
      <div className="manage-table-scroll"><table className="manage-player-table"><thead><tr><th scope="col">球员</th><th scope="col">总评</th><th scope="col">场次</th><th scope="col">分钟</th><th scope="col">得分</th><th scope="col">篮板</th><th scope="col">助攻</th><th scope="col">抢断</th><th scope="col">盖帽</th><th scope="col">投篮</th><th scope="col">三分</th></tr></thead><tbody>{sortedPlayers.map((player) => {
        const stats = player.seasonStats;
        return <tr key={player.id} data-player-id={player.id}><th scope="row"><button type="button" onClick={() => onOpenPlayer(player.id)}><PlayerPortrait player={player} portraitPath={player.portraitPath} className="manage-player-avatar" /><span><b>{playerNameZh(player.name, player.id)}</b><small>{positionPairLabel(player.position, player.secondaryPosition)}{player.injury ? " · 伤停" : ""}</small></span></button></th><td className="manage-overall-cell">{calculatePlayerOverall(player).toFixed(0)}</td><td>{stats.games}</td><td>{playerPerGame(stats.seconds, stats.games, 60)}</td><td>{playerPerGame(stats.pts, stats.games)}</td><td>{playerPerGame(stats.reb, stats.games)}</td><td>{playerPerGame(stats.ast, stats.games)}</td><td>{playerPerGame(stats.stl, stats.games)}</td><td>{playerPerGame(stats.blk, stats.games)}</td><td>{percentage(stats.fgm, stats.fga)}</td><td>{percentage(stats.threePm, stats.threePa)}</td></tr>;
      })}</tbody></table></div>
    </section>
  </div>;
}

const capLines = (sheet: CapSheet): Array<[string, number]> => [
  ["球员合同", sheet.activeContractSalary],
  ["死钱", sheet.deadMoney],
  ["薪资占位", sheet.capHolds],
  ["报价预留", sheet.activeOfferReservations],
  ["未满员费用", sheet.incompleteRosterCharges],
];

function contractOptionLabel(player: Player): string {
  if (player.contract.optionType === "TEAM") return "球队选项";
  if (player.contract.optionType === "PLAYER") return "球员选项";
  if (player.contract.contractType === "EMERGENCY") return "临时合同";
  return contractStatusLabel(player.contract.status);
}

export function ManagementContracts({ players, sheet, onOpenPlayer, onWaive, busy = false }: {
  players: Player[];
  sheet: CapSheet;
  onOpenPlayer: (playerId: string) => void;
  onWaive?: (playerId: string) => Promise<void>;
  busy?: boolean;
}) {
  const [pendingWaiveId, setPendingWaiveId] = useState<string | null>(null);
  const pendingWaive = pendingWaiveId ? players.find((player) => player.id === pendingWaiveId) : undefined;
  const thresholds = [
    { key: "cap", label: "工资帽", value: LEAGUE_FINANCE_CONFIG.salaryCap },
    { key: "tax", label: "奢侈税线", value: LEAGUE_FINANCE_CONFIG.luxuryTaxLine },
    { key: "first", label: "第一土豪线", value: LEAGUE_FINANCE_CONFIG.firstApron },
    { key: "second", label: "第二土豪线", value: LEAGUE_FINANCE_CONFIG.secondApron },
  ] as const;
  const capStatus = [...thresholds].reverse().find(({ value }) => sheet.total >= value)?.label ?? "工资帽以下";
  const meterMaximum = LEAGUE_FINANCE_CONFIG.secondApron;
  const usagePercent = Math.max(0, Math.min(100, sheet.total / meterMaximum * 100));
  const contracts = [...players].sort((left, right) => right.contract.salary - left.contract.salary || left.id.localeCompare(right.id));
  return <div className="manage-page-content manage-contracts">
    <header className="manage-page-heading"><div><h2>合同与薪资</h2><p>本赛季工资帽占用与球员合同</p></div><span>{sheet.activeStandardContracts} 份合同</span></header>
    <section className="manage-section-card manage-cap-card" aria-label="薪资总览">
      <div className="draft-cap-meter">
        <div className="draft-cap-meter-heading"><span>薪资进度 <b>{moneyLabel(sheet.total)}</b></span><span>帽下空间 <b className={sheet.availableCapSpace < 0 ? "negative" : ""}>{moneyLabel(sheet.availableCapSpace)}</b></span></div>
        <div className="draft-cap-meter-track" role="progressbar" aria-label="球队工资帽占用" aria-valuemin={0} aria-valuemax={meterMaximum} aria-valuenow={Math.max(0, Math.min(sheet.total, meterMaximum))} aria-valuetext={moneyLabel(sheet.total)}><span className="draft-cap-meter-fill" style={{ width: "100%", clipPath: `inset(0 ${100 - usagePercent}% 0 0)` }} />{thresholds.map((threshold) => <i key={threshold.key} className={`threshold-${threshold.key}`} style={{ left: `${threshold.value / meterMaximum * 100}%` }} aria-hidden="true" />)}</div>
        <div className="draft-cap-meter-legend">{thresholds.map((threshold) => <span className={`threshold-${threshold.key}`} key={threshold.key}><small>{threshold.label}</small><b>{moneyLabel(threshold.value)}</b></span>)}</div>
        <small className="draft-cap-status">当前：{capStatus}</small>
      </div>
    </section>
    <section className="manage-section-card" aria-label="薪资构成"><div className="manage-section-heading"><div><h3>占用构成</h3></div><span>合计 {moneyLabel(sheet.total)}</span></div><div className="manage-cap-breakdown">{capLines(sheet).map(([label, amount]) => <span key={label}><small>{label}</small><b>{moneyLabel(amount)}</b></span>)}</div></section>
    <section className="manage-section-card" aria-label="球员合同"><div className="manage-section-heading"><div><h3>球员合同</h3></div><span>按本年薪资排序</span></div><div className="manage-contract-list">{contracts.map((player) => <article key={player.id} className="manage-contract-row"><button type="button" className="manage-contract-detail" onClick={() => onOpenPlayer(player.id)}><PlayerPortrait player={player} portraitPath={player.portraitPath} className="manage-player-avatar" /><span className="manage-contract-player"><b>{playerNameZh(player.name, player.id)}</b><small>{positionPairLabel(player.position, player.secondaryPosition)} · {contractOptionLabel(player)}</small></span><span className="manage-contract-value"><b>{moneyLabel(player.contract.salary)}</b><small>剩余 {player.contract.yearsRemaining} 年</small></span></button>{onWaive && <button type="button" className="manage-contract-waive" disabled={busy || players.length <= LEAGUE_FINANCE_CONFIG.rosterLimits.emergencyTarget} onClick={() => setPendingWaiveId(player.id)}>裁员</button>}</article>)}</div></section>
    {pendingWaive && onWaive && <div className="manage-waive-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setPendingWaiveId(null); }}><section className="manage-waive-dialog" role="alertdialog" aria-modal="true" aria-labelledby="manage-waive-title" aria-describedby="manage-waive-description"><h2 id="manage-waive-title">裁掉 {playerNameZh(pendingWaive.name, pendingWaive.id)}？</h2><p id="manage-waive-description">裁员后球员会进入自由球员池，合同剩余保障金额仍按原合同年份计入死钱，不能立即释放全部薪资。</p><div><span>剩余保障金额 <b>{moneyLabel(pendingWaive.contract.guaranteedAmount)}</b></span><span>裁员后名单 <b>{players.length - 1} 人</b></span></div><footer><button type="button" disabled={busy} onClick={() => setPendingWaiveId(null)}>取消</button><button type="button" className="danger" disabled={busy} onClick={() => void onWaive(pendingWaive.id).finally(() => setPendingWaiveId(null))}>{busy ? "处理中…" : "确认裁员"}</button></footer></section></div>}
  </div>;
}

export function ManagementDraftPicks({ picks, teams, userTeamId }: {
  picks: DraftPickAsset[];
  teams: Record<string, Team>;
  userTeamId: string;
}) {
  const owned = picks.filter((pick) => pick.ownerTeamId === userTeamId).sort((left, right) => left.year - right.year || left.round - right.round || left.originalTeamId.localeCompare(right.originalTeamId));
  const years = [...new Set(owned.map((pick) => pick.year))];
  return <div className="manage-page-content manage-assets">
    <header className="manage-page-heading"><div><h2>选秀权</h2><p>按年份查看球队当前持有的选秀权</p></div><span>{owned.length} 枚</span></header>
    <div className="manage-pick-summary"><span><small>首轮签</small><b>{owned.filter((pick) => pick.round === 1).length}</b></span><span><small>次轮签</small><b>{owned.filter((pick) => pick.round === 2).length}</b></span><span><small>已承诺</small><b>{owned.filter((pick) => pick.reservedByCommitmentId).length}</b></span></div>
    {years.length ? years.map((year) => <section className="manage-section-card manage-pick-year" key={year} aria-label={`${year} 年选秀权`}><div className="manage-section-heading"><div><h3>{year} 年</h3></div><span>{owned.filter((pick) => pick.year === year).length} 枚</span></div><div className="manage-pick-list">{owned.filter((pick) => pick.year === year).map((pick) => <article key={pick.id}><span className={`manage-pick-round round-${pick.round}`}>{pick.round === 1 ? "首轮" : "次轮"}</span><span><b>第 {pick.round} 轮 · {teams[pick.originalTeamId]?.fullName ?? pick.originalTeamId}</b><small>{pick.originalTeamId === userTeamId ? "本队原有" : "来自其他球队"}</small></span><em className={pick.reservedByCommitmentId ? "reserved" : ""}>{pick.reservedByCommitmentId ? "已承诺" : "持有"}</em></article>)}</div></section>) : <section className="manage-section-card manage-empty">当前没有持有的未来选秀权。</section>}
    <p className="manage-section-note manage-pick-note">这里只展示已记录的资产与承诺状态；交易操作请前往市场。</p>
  </div>;
}
