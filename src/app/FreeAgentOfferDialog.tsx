import { createPortal } from "react-dom";
import { LEAGUE_FINANCE_CONFIG } from "../config/leagueFinance";
import {
  getFreeAgentContractTerms, getFreeAgentCustomOfferPreview, getFreeAgentOfferPreview,
  type FreeAgentOfferDraft,
} from "../game/freeAgency/FreeAgencyService";
import { calculatePlayerOverall } from "../game/player/PlayerRatingService";
import type { ContractYearOption, GameState, PromisedRole } from "../game/state/types";
import { playerNameZh } from "./playerNameZh";
import { adaptiveMoneyLabel, positionPairLabel } from "./uiText";

const roleOptions: Array<{ value: PromisedRole; label: string }> = [
  { value: "STARTER", label: "首发" },
  { value: "SIXTH_MAN", label: "第六人" },
  { value: "ROTATION", label: "轮换" },
  { value: "BENCH", label: "替补" },
];

interface FreeAgentOfferDialogProps {
  state: GameState;
  playerId: string;
  draft: FreeAgentOfferDraft;
  busy: boolean;
  onChange: (patch: Partial<FreeAgentOfferDraft>) => void;
  onClose: () => void;
  onSubmit: () => void;
}

export function FreeAgentOfferDialog(props: FreeAgentOfferDialogProps) {
  const regularSeason = ["REGULAR_SEASON", "REGULAR_PRE_DEADLINE", "REGULAR_POST_DEADLINE"].includes(props.state.league.currentPhase);
  return createPortal(
    <div className={`player-detail-backdrop fa-offer-backdrop${regularSeason ? " regular-fa-offer-backdrop" : ""}`} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !props.busy) props.onClose(); }}>
      <FreeAgentOfferDialogContent {...props} />
    </div>, document.body);
}

export function FreeAgentOfferDialogContent({ state, playerId, draft, busy, onChange, onClose, onSubmit }: FreeAgentOfferDialogProps) {
  const player = state.players[playerId];
  if (!player) return null;
  const preview = getFreeAgentCustomOfferPreview(state, playerId, draft);
  const expectedDraft = getFreeAgentOfferPreview(state, playerId).draft;
  const expectedTerms = getFreeAgentContractTerms(state, playerId, { ...expectedDraft, years: draft.years });
  const ownTeamRights = state.freeAgency?.markets[playerId]?.originalTeamId === state.userTeamId;
  const maxYears = ownTeamRights ? LEAGUE_FINANCE_CONFIG.contractYears.ownTeamMaximum : LEAGUE_FINANCE_CONFIG.contractYears.otherTeamMaximum;
  const maxRaise = ownTeamRights ? LEAGUE_FINANCE_CONFIG.annualRaisePercentages.ownTeam : LEAGUE_FINANCE_CONFIG.annualRaisePercentages.otherTeam;
  const yearOptions = Array.from({ length: maxYears - LEAGUE_FINANCE_CONFIG.contractYears.minimum + 1 }, (_, index) => index + LEAGUE_FINANCE_CONFIG.contractYears.minimum);
  const raiseOptions = Array.from({ length: Math.round(maxRaise * 100) + 1 }, (_, index) => index / 100);
  const regularSeason = ["REGULAR_SEASON", "REGULAR_PRE_DEADLINE", "REGULAR_POST_DEADLINE"].includes(state.league.currentPhase);

  return <section className="fa-offer-dialog" role="dialog" aria-modal="true" aria-labelledby="fa-offer-dialog-title" aria-describedby="fa-offer-dialog-description" data-testid="fa-offer-dialog">
        <header><div><small>CONTRACT OFFER</small><h2 id="fa-offer-dialog-title">向 {playerNameZh(player.name, player.id)} 发起报价</h2><p id="fa-offer-dialog-description">{positionPairLabel(player.position, player.secondaryPosition)} · OVR {calculatePlayerOverall(player).toFixed(0)} · {player.age} 岁</p></div><button type="button" aria-label="关闭报价弹窗" disabled={busy} onClick={onClose}>×</button></header>
        <div className="fa-offer-dialog-scroll">
          <section className="fa-offer-expectation"><div><b>球员期望合同</b><span>系统估算</span></div><p>只需填写首年薪资并选择涨幅，后续年度由系统自动计算。选项仅作用于最后一年：球队选项由球队决定且该年不计入保障金额，球员选项由球员决定。</p>{regularSeason && <p>报价会预留首年薪资；球员将在后续比赛日决定是否接受。</p>}</section>
          <div className="fa-offer-controls">
            <label><span>合同年限</span><select data-testid="fa-offer-years" disabled={busy} value={draft.years} onChange={(event) => onChange({ years: Number(event.target.value), finalYearOption: Number(event.target.value) < 2 ? "NONE" : draft.finalYearOption })}>{yearOptions.map((years) => <option key={years} value={years}>{years} 年</option>)}</select></label>
            <label><span>首年薪资</span><div className="fa-offer-money-input"><input data-testid="fa-offer-salary-1" aria-label="第一年报价，单位万美元" type="number" inputMode="numeric" min={Math.round(LEAGUE_FINANCE_CONFIG.minimumSalary / 10_000)} step={10} disabled={busy} value={Math.round(draft.year1Salary / 10_000)} onChange={(event) => onChange({ year1Salary: Math.max(0, Math.round(Number(event.target.value) * 10_000)) })} /><b>万美元</b></div></label>
            <label><span>每年涨幅</span><select data-testid="fa-offer-raise" disabled={busy} value={draft.annualRaiseRate ?? maxRaise} onChange={(event) => onChange({ annualRaiseRate: Number(event.target.value) })}>{raiseOptions.map((rate) => <option key={rate} value={rate}>{Math.round(rate * 100)}%</option>)}</select></label>
            <label><span>保障比例</span><div className="fa-offer-percent"><input data-testid="fa-offer-guarantee" type="number" inputMode="numeric" min={0} max={100} step={5} disabled={busy} value={Math.round(draft.guaranteedPercent * 100)} onChange={(event) => onChange({ guaranteedPercent: Math.max(0, Math.min(1, Number(event.target.value) / 100)) })} /><b>%</b></div></label>
            <label><span>末年选项</span><select data-testid="fa-offer-option" disabled={busy || draft.years < 2} value={draft.finalYearOption ?? "NONE"} onChange={(event) => onChange({ finalYearOption: event.target.value as ContractYearOption })}><option value="NONE">无选项</option><option value="TEAM_OPTION">球队选项</option><option value="PLAYER_OPTION">球员选项</option></select></label>
            <label><span>承诺角色</span><select data-testid="fa-offer-role" disabled={busy} value={draft.rolePromised} onChange={(event) => onChange({ rolePromised: event.target.value as PromisedRole })}>{roleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          </div>
          <section className="fa-offer-salary-editor" aria-label="逐年薪资预览"><header><b>逐年薪资预览</b><span>系统自动计算</span></header>{preview.salaryByYear.map((salary, index) => { const option = preview.optionByYear[index]; return <div className="fa-offer-salary-row" key={index}><span><b>第 {index + 1} 年{option !== "NONE" && <em className={`fa-contract-option ${option === "TEAM_OPTION" ? "team" : "player"}`}>{option === "TEAM_OPTION" ? "球队选项" : "球员选项"}</em>}</b><small>期望 {adaptiveMoneyLabel(expectedTerms.salaryByYear[index])}</small></span><strong>{adaptiveMoneyLabel(salary)}</strong></div>; })}</section>
          <div className="fa-offer-totals"><span><small>合同总额</small><b>{adaptiveMoneyLabel(preview.totalValue)}</b></span><span><small>保障金额</small><b>{adaptiveMoneyLabel(preview.guaranteedValue)}</b></span><span><small>首年占用空间</small><b>{adaptiveMoneyLabel(draft.year1Salary)}</b></span></div>
          {!preview.valid && <p className="fa-offer-error" role="alert">{preview.reason}</p>}
        </div>
        <footer><button type="button" disabled={busy} onClick={onClose}>取消</button><button type="button" className="primary" data-testid="submit-fa-offer" disabled={busy || !preview.valid} onClick={onSubmit}>{busy ? "提交中…" : "提交报价"}</button></footer>
      </section>;
}
