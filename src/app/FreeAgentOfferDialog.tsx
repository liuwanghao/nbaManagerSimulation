import { createPortal } from "react-dom";
import { getSeasonFinanceConfig, LEAGUE_FINANCE_CONFIG } from "../config/leagueFinance";
import {
  getCurrentFreeAgentAsk, getFreeAgentContractTerms, getFreeAgentCustomOfferPreview, getFreeAgentOfferPreview, getProjectedMarketSalary,
  type FreeAgentOfferDraft,
} from "../game/freeAgency/FreeAgencyService";
import { calculatePlayerOverall } from "../game/player/PlayerRatingService";
import type { ContractYearOption, GameState, PromisedRole } from "../game/state/types";
import { TradeTargetFilter } from "./TradeTargetFilter";
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
          <section className="fa-offer-expectation"><div><b>球员期望合同</b><span>系统估算</span></div><p>当前要价 {adaptiveMoneyLabel(getCurrentFreeAgentAsk(state, player))} · 参考估值 {adaptiveMoneyLabel(getProjectedMarketSalary(player, state.league.seasonYear))}</p><p>只需填写首年薪资并选择涨幅，后续年度由系统自动计算。选项仅作用于最后一年：球队选项由球队决定且该年不计入保障金额，球员选项由球员决定。</p>{regularSeason && <p>报价会预留首年薪资；球员将在下一日历日（包括休息日）决定是否接受。</p>}</section>
          <div className="fa-offer-controls">
            <TradeTargetFilter label="合同年限" ariaLabel="合同年限" testId="fa-offer-years" constrainToScrollContainer disabled={busy} value={String(draft.years)} options={yearOptions.map((years) => ({ value: String(years), label: `${years} 年` }))} onChange={(value) => onChange({ years: Number(value), finalYearOption: Number(value) < 2 ? "NONE" : draft.finalYearOption })} />
            <label><span>首年薪资</span><div className="fa-offer-money-input"><input data-testid="fa-offer-salary-1" aria-label="第一年报价，单位万美元" type="number" inputMode="numeric" min={Math.ceil(getSeasonFinanceConfig(state.league.seasonYear).minimumSalary / 10_000)} step={10} disabled={busy} value={draft.year1Salary === 0 ? "" : Math.round(draft.year1Salary / 10_000)} onChange={(event) => onChange({ year1Salary: Math.max(0, Math.round(Number(event.target.value) * 10_000)) })} /><b>万美元</b></div></label>
            <TradeTargetFilter label="每年涨幅" ariaLabel="每年涨幅" testId="fa-offer-raise" constrainToScrollContainer disabled={busy} value={String(draft.annualRaiseRate ?? maxRaise)} options={raiseOptions.map((rate) => ({ value: String(rate), label: `${Math.round(rate * 100)}%` }))} onChange={(value) => onChange({ annualRaiseRate: Number(value) })} />
            <label><span>保障比例</span><div className="fa-offer-percent"><input data-testid="fa-offer-guarantee" type="number" inputMode="numeric" min={0} max={100} step={5} disabled={busy} value={Math.round(draft.guaranteedPercent * 100)} onChange={(event) => onChange({ guaranteedPercent: Math.max(0, Math.min(1, Number(event.target.value) / 100)) })} /><b>%</b></div></label>
            <TradeTargetFilter label="末年选项" ariaLabel="末年选项" testId="fa-offer-option" constrainToScrollContainer disabled={busy || draft.years < 2} value={draft.finalYearOption ?? "NONE"} options={[{ value: "NONE", label: "无选项" }, { value: "TEAM_OPTION", label: "球队选项" }, { value: "PLAYER_OPTION", label: "球员选项" }]} onChange={(value) => onChange({ finalYearOption: value as ContractYearOption })} />
            <TradeTargetFilter label="承诺角色" ariaLabel="承诺角色" testId="fa-offer-role" constrainToScrollContainer disabled={busy} value={draft.rolePromised} options={roleOptions} onChange={(value) => onChange({ rolePromised: value as PromisedRole })} />
          </div>
          <section className="fa-offer-salary-editor" aria-label="逐年薪资预览"><header><b>逐年薪资预览</b><span>系统自动计算</span></header>{preview.salaryByYear.map((salary, index) => { const option = preview.optionByYear[index]; return <div className="fa-offer-salary-row" key={index}><span><b>第 {index + 1} 年{option !== "NONE" && <em className={`fa-contract-option ${option === "TEAM_OPTION" ? "team" : "player"}`}>{option === "TEAM_OPTION" ? "球队选项" : "球员选项"}</em>}</b><small>期望 {adaptiveMoneyLabel(expectedTerms.salaryByYear[index])}</small></span><strong>{adaptiveMoneyLabel(salary)}</strong></div>; })}</section>
          <div className="fa-offer-totals"><span><small>合同总额</small><b>{adaptiveMoneyLabel(preview.totalValue)}</b></span><span><small>保障金额</small><b>{adaptiveMoneyLabel(preview.guaranteedValue)}</b></span><span><small>首年占用空间</small><b>{adaptiveMoneyLabel(draft.year1Salary)}</b></span></div>
          {!preview.valid && <p className="fa-offer-error" role="alert">{preview.reason}</p>}
        </div>
        <footer><button type="button" disabled={busy} onClick={onClose}>取消</button><button type="button" className="primary" data-testid="submit-fa-offer" disabled={busy || !preview.valid} onClick={onSubmit}>{busy ? "提交中…" : "提交报价"}</button></footer>
      </section>;
}
