import { useEffect, useRef, useState } from "react";
import { getSeasonFinanceConfig } from "../config/leagueFinance";
import { getCapSheet, getTeamCapHolds } from "../game/cap/CapSheetService";
import type { FreeAgencyCommand } from "../game/freeAgency/FreeAgencyService";
import type { GameState, Player } from "../game/state/types";
import { moneyLabel, positionPairLabel } from "./uiText";
import { PlayerPortrait } from "./PlayerPortrait";
import { calculatePlayerOverall } from "../game/player/PlayerRatingService";
import { playerRatingStyle } from "./playerRatingColor";
import { playerNameZh } from "./playerNameZh";

export function FreeAgencyCapBreakdown({ state, busy, onCommand, onSign }: {
  state: GameState;
  busy: boolean;
  onCommand: (command: FreeAgencyCommand) => Promise<void>;
  onSign: (playerId: string) => void;
}) {
  const [pendingPlayerId, setPendingPlayerId] = useState<string | null>(null);
  const sheet = getCapSheet(state, state.userTeamId);
  const holds = getTeamCapHolds(state, state.userTeamId);
  const pendingHold = holds.find((hold) => hold.playerId === pendingPlayerId);
  const pendingPlayer = pendingHold ? state.players[pendingHold.playerId] : undefined;
  const charges: Array<[string, number]> = [
    ["球员合同", sheet.activeContractSalary], ["死钱", sheet.deadMoney],
    ["薪资占位", sheet.capHolds], ["报价预留", sheet.activeOfferReservations],
    ["未满员费用", sheet.incompleteRosterCharges], ["最低工资差额", sheet.salaryFloorShortfall],
  ];
  useEffect(() => {
    if (!pendingPlayerId) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) setPendingPlayerId(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [pendingPlayerId, busy]);

  return <section className="fa-cap-accounting" aria-label="工资帽占用构成" data-testid="fa-cap-accounting">
    <header><b>工资帽占用构成</b><span>总占用 {moneyLabel(sheet.total)}</span></header>
    <div className="fa-cap-charge-grid">{charges.map(([label, amount]) => <span key={label}><small>{label}</small><b>{moneyLabel(amount)}</b></span>)}</div>
    <p className="fa-cap-equation">工资帽 {moneyLabel(getSeasonFinanceConfig(state.league.seasonYear).salaryCap)} − 总占用 {moneyLabel(sheet.total)} = 帽下空间 <b>{moneyLabel(sheet.availableCapSpace)}</b></p>
    <p className="fa-cap-accounting-note">帽下空间扣除全部占用，显示金额按万美元四舍五入。到期球员的签约权仍会产生薪资占位；报价预留只计入超出该球员占位的部分。</p>
    {holds.length > 0 && <details className="fa-cap-rights">
      <summary>保留签约权的球员 · {holds.length} 人 · {moneyLabel(sheet.capHolds)}</summary>
      <p>保留权利可用于签回球员。放弃后释放该球员占位，并失去 Bird 超帽续约权及 RFA 匹配权。</p>
      {holds.map((hold) => {
        const player = state.players[hold.playerId];
        const matching = state.freeAgency?.markets[player.id]?.marketWindowStatus === "RFA_MATCHING"
          || state.freeAgency?.pendingUserRfaDecision?.playerId === player.id;
        const offered = Object.values(state.freeAgency?.offers ?? {}).some((offer) => offer.playerId === player.id
          && offer.teamId === state.userTeamId && offer.status === "ACTIVE");
        const reason = matching ? "请先处理 RFA 匹配决定" : offered ? "请先撤回本队有效报价" : undefined;
        return <div className="fa-cap-rights-row" key={player.id}>
          <FreeAgencyRightsPlayer player={player} />
          <div className="fa-cap-rights-meta"><span>{hold.type === "RFA" ? "RFA 签约权" : "Bird 签约权"}</span><b>{moneyLabel(hold.amount)}</b></div>
          {reason && <p className="fa-cap-accounting-note">{reason}</p>}
          <div className="fa-cap-rights-actions">
            <button type="button" className="btn-primary" data-testid={`sign-fa-rights-${player.id}`} disabled={busy || !!reason} title={reason ?? "查看并编辑合同报价"} onClick={() => onSign(player.id)}>签合约</button>
            <button type="button" className="btn-secondary" data-testid={`renounce-fa-rights-${player.id}`} disabled={busy || !!reason} title={reason} onClick={() => setPendingPlayerId(player.id)}>放弃签约权</button>
          </div>
        </div>;
      })}
    </details>}
    {pendingPlayer && pendingHold && <div className="player-detail-backdrop preseason-confirm-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setPendingPlayerId(null); }}>
      <FreeAgencyRightsDialog player={pendingPlayer} amount={pendingHold.amount} busy={busy}
        onCancel={() => setPendingPlayerId(null)}
        onConfirm={() => void onCommand({ commandId: `renounce-${state.league.seasonId}-${pendingPlayer.id}-${Object.keys(state.commandReceipts).length}`, type: "RENOUNCE_FA_RIGHTS", payload: { playerId: pendingPlayer.id } }).finally(() => setPendingPlayerId(null))} />
    </div>}
  </section>;
}

function FreeAgencyRightsPlayer({ player }: { player: Player }) {
  const overall = calculatePlayerOverall(player);
  return <div className="fa-rights-player">
    <PlayerPortrait player={player} portraitPath={player.portraitPath} className="regular-free-agent-avatar" />
    <span><b>{playerNameZh(player.name, player.id)}</b><small>{positionPairLabel(player.position, player.secondaryPosition)} · {player.age} 岁</small></span>
    <span className="regular-free-agent-ovr" aria-label={`OVR ${overall.toFixed(0)}`}><small>OVR</small><strong className="player-rating-tone" style={playerRatingStyle(overall)}>{overall.toFixed(0)}</strong></span>
  </div>;
}

export function FreeAgencyRightsDialog({ player, amount, busy, onCancel, onConfirm }: {
  player: Player;
  amount: number;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement;
    cancelRef.current?.focus();
    return () => { if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus(); };
  }, []);
  return <section className="fa-renounce-dialog" role="alertdialog" aria-modal="true" aria-labelledby="renounce-rights-title" aria-describedby="renounce-rights-description">
    <header><div><small>签约权管理</small><h2 id="renounce-rights-title">放弃签约权？</h2></div><button type="button" className="btn-secondary" disabled={busy} onClick={onCancel} aria-label="关闭放弃签约权确认框">×</button></header>
    <div className="fa-renounce-body">
      <FreeAgencyRightsPlayer player={player} />
      <div className="fa-renounce-amount"><span>移除薪资占位</span><strong>{moneyLabel(amount)}</strong></div>
      <div id="renounce-rights-description" className="fa-renounce-consequences">
        <b>放弃后将发生</b>
        <ul><li>本队失去该球员的 Bird 超帽续约权。</li>{player.contract.status === "RFA" && <li>球员转为完全自由球员，本队失去报价匹配权。</li>}<li>之后仍可按普通自由球员规则向他报价。</li></ul>
      </div>
      <p className="fa-cap-accounting-note">未满员费用会重新计算，实际释放空间以更新后的总占用为准。</p>
    </div>
    <footer><button ref={cancelRef} type="button" className="btn-secondary" disabled={busy} onClick={onCancel}>保留签约权</button><button type="button" className="fa-renounce-confirm" disabled={busy} onClick={onConfirm}>确认放弃</button></footer>
  </section>;
}
