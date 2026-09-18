import { useState } from "react";
import { EXPANSION_BRAND_PRESETS, EXPANSION_CITY_NAMES, SAFE_TEAM_COLORS } from "../data/expansionBrands";
import { LEAGUE_FINANCE_CONFIG } from "../config/leagueFinance";
import { getCapSheet } from "../game/cap/CapSheetService";
import { getSelectableExpansionPlayers, normalizeAndValidateTeamName, type ExpansionCommand } from "../game/expansion/ExpansionService";
import type { ExpansionCityId, ExpansionPackage, GameState, Player } from "../game/state/types";
import { calculatePlayerOverall } from "../game/player/PlayerRatingService";
import { GameChrome } from "./GameChrome";
import { localizePlayerNamesInText, playerNameZh } from "./playerNameZh";
import { humanizeUiText, moneyLabel, phaseLabel, positionPairLabel, slotLabel } from "./uiText";
import { ReferencePlayerCard } from "./ReferencePlayerCard";

interface ExpansionFlowProps {
  state: GameState;
  busy: boolean;
  status: string;
  onCommand: (command: ExpansionCommand) => Promise<void>;
  onSave: (slot?: 1 | 2 | 3) => Promise<void>;
  onLoad: (slot?: 1 | 2 | 3) => Promise<boolean>;
  onRestoreCheckpoint: () => Promise<void>;
  activeSlot: 1 | 2 | 3;
  onSlotChange: (slot: 1 | 2 | 3) => void;
  onHome?: () => void;
  initialDrawerTab?: "save" | "load";
}

const money = moneyLabel;
const packageLabel = (packageId?: ExpansionPackage): string => packageId === "A" ? "权益方案甲" : packageId === "B" ? "权益方案乙" : "尚未选择";
const CITY_PRESENTATION: Record<ExpansionCityId, { eyebrow: string; description: string; className: string }> = {
  SEA: { eyebrow: "太平洋西北", description: "雨城天际、常青群山与坚定的篮球热情。", className: "seattle" },
  LVG: { eyebrow: "沙漠霓虹", description: "不眠之城、聚光灯与全新的王朝可能。", className: "las-vegas" },
};

export function ExpansionFlow({ state, busy, status, onCommand, onSave, onLoad, onRestoreCheckpoint, activeSlot, onSlotChange, onHome, initialDrawerTab }: ExpansionFlowProps) {
  const phase = state.league.currentPhase;
  const spotlightPhase = ["EXPANSION_RIGHTS", "EXPANSION_DRAFT"].includes(phase);
  return (
    <main className={`app-shell expansion-shell${spotlightPhase ? " scene-stage" : ""}`}>
      <GameChrome phase={phase} onSave={onSave} onLoad={onLoad} activeSlot={activeSlot} onSlotChange={onSlotChange} onHome={onHome} initialDrawerTab={initialDrawerTab} />
      <header className="stage-header">
        <div><span className="section-kicker">扩军时代 · 第三阶段</span><h1>扩军开局</h1></div>
        <span className="phase-pill">{phaseLabel(phase)}</span>
      </header>
      <section className="status-strip" aria-live="polite"><span className={busy ? "pulse-dot active" : "pulse-dot"} />{phase === "TEAM_CREATION" ? "开始创建新加盟球队" : status}</section>

      {phase === "TEAM_CREATION" && <TeamCreation state={state} busy={busy} onCommand={onCommand} />}
      {phase === "EXPANSION_RIGHTS" && <RightsDraw state={state} busy={busy} onCommand={onCommand} />}
      {phase === "OPTION_PHASE" && <OptionPhase state={state} busy={busy} onCommand={onCommand} />}
      {phase === "EXPANSION_TRADE" && <TradeDesk state={state} busy={busy} onCommand={onCommand} />}
      {phase === "EXPANSION_DRAFT" && <ExpansionDraft state={state} busy={busy} onCommand={onCommand} />}
      {phase === "ROOKIE_DRAFT_PENDING" && <StageSummary state={state} onRestoreCheckpoint={onRestoreCheckpoint} />}

      <footer>
        <label className="slot-picker">存档<select value={activeSlot} onChange={(event) => onSlotChange(Number(event.target.value) as 1 | 2 | 3)}><option value={1}>{slotLabel(1)}</option><option value={2}>{slotLabel(2)}</option><option value={3}>{slotLabel(3)}</option></select></label>
        <button className="footer-action" onClick={() => void onSave()}>保存{slotLabel(activeSlot)}</button>
        <button className="footer-action" onClick={() => void onLoad()}>读取{slotLabel(activeSlot)}</button>
        <span>所有关键操作均通过指令提交并自动保存</span>
      </footer>
    </main>
  );
}

function TeamCreation({ state, busy, onCommand }: Pick<ExpansionFlowProps, "state" | "busy" | "onCommand">) {
  const [cityId, setCityId] = useState<ExpansionCityId>("SEA");
  const [teamName, setTeamName] = useState("");
  const [primaryColor, setPrimaryColor] = useState(EXPANSION_BRAND_PRESETS.SEA[0].primaryColor);
  const [secondaryColor, setSecondaryColor] = useState(EXPANSION_BRAND_PRESETS.SEA[0].secondaryColor);
  const selectedBrand = EXPANSION_BRAND_PRESETS[cityId][0];
  const normalizedName = teamName.trim();
  let teamNameError = "";
  if (normalizedName) {
    try {
      normalizeAndValidateTeamName(teamName, state, cityId);
    } catch (error) {
      teamNameError = error instanceof Error ? error.message : "球队名称不可用";
    }
  }
  const teamNameValid = Boolean(normalizedName) && !teamNameError;

  const chooseCity = (nextCity: ExpansionCityId) => {
    const preset = EXPANSION_BRAND_PRESETS[nextCity][0];
    setCityId(nextCity);
    setPrimaryColor(preset.primaryColor);
    setSecondaryColor(preset.secondaryColor);
  };

  return (
    <section className="flow-card team-creation-card">
      <header className="city-choice-heading">
        <div className="step-label">步骤 01/06 · 建立球队</div>
        <h2>选择扩军城市</h2>
        <p className="flow-intro">选择你的主场和固定队徽，球队名称由你亲自决定。</p>
      </header>

      <div className="city-showcase" role="group" aria-label="选择扩军城市">
        {(["SEA", "LVG"] as const).map((id) => {
          const brand = EXPANSION_BRAND_PRESETS[id][0];
          const presentation = CITY_PRESENTATION[id];
          const selected = cityId === id;
          return <button type="button" key={id} className={`city-choice-card ${presentation.className}${selected ? " selected" : ""}`} aria-pressed={selected} onClick={() => chooseCity(id)}>
            <span className="city-card-copy">
              <small>{presentation.eyebrow}</small>
              <b>{EXPANSION_CITY_NAMES[id]}</b>
              <span>{presentation.description}</span>
            </span>
            <span className="city-card-logo"><img src={brand.logoUrl} alt={`${EXPANSION_CITY_NAMES[id]}默认队徽`} draggable={false} /></span>
            <span className="city-card-status">{selected ? "✓ 已选择" : "选择此城市"}</span>
          </button>;
        })}
      </div>

      <label className="field-label" htmlFor="team-name">02 为球队命名</label>
      <input id="team-name" className="team-name-input" value={teamName} maxLength={20} placeholder="输入球队名称，例如：翡翠潮" autoComplete="off" aria-invalid={Boolean(teamNameError)} aria-describedby="team-name-guidance" onChange={(event) => setTeamName(event.target.value)} />
      <div id="team-name-guidance" className={`team-name-guidance${teamNameError ? " error" : teamNameValid ? " valid" : ""}`} aria-live="polite">
        {teamNameError ? <><b>名称不可用</b><span>{teamNameError}</span></> : teamNameValid ? <><b>✓ 名称可用</b><span>创建后仍可在球队管理中查看。</span></> : <><b>命名规则</b><span>2～20 个字符，可用中文、英文字母、数字、空格、- 或 '，但不能只输入数字。</span></>}
      </div>

      <button className="primary-cta" disabled={busy || !teamNameValid} onClick={() => onCommand({
        commandId: "stage3-create-team",
        type: "CREATE_EXPANSION_TEAM",
        payload: { cityId, presetId: selectedBrand.presetId, teamName, primaryColor, secondaryColor },
      })}>创建球队并进入联盟 →</button>
      <details className="advanced-color-controls">
        <summary>高级配色</summary>
        <p className="field-help">队徽保持固定；主辅色可从安全色板中调整。球队名称支持 2～20 个中英文、数字、空格、连字符或撇号。</p>
        <div className="color-row">
          <label>主色<select value={primaryColor} onChange={(event) => setPrimaryColor(event.target.value)}>{SAFE_TEAM_COLORS.map((color) => <option key={color} value={color}>{color}</option>)}</select><i style={{ background: primaryColor }} /></label>
          <label>辅色<select value={secondaryColor} onChange={(event) => setSecondaryColor(event.target.value)}>{SAFE_TEAM_COLORS.map((color) => <option key={color} value={color}>{color}</option>)}</select><i style={{ background: secondaryColor }} /></label>
        </div>
      </details>
    </section>
  );
}

function RightsDraw({ state, busy, onCommand }: Pick<ExpansionFlowProps, "state" | "busy" | "onCommand">) {
  const expansion = state.expansion;
  const assignedPackage = expansion?.rightsDraw.packageByTeam[expansion.playerTeamId];
  const [selectedPackage, setSelectedPackage] = useState<ExpansionPackage | undefined>(assignedPackage);
  if (!expansion) return null;
  const draw = expansion.rightsDraw;
  const playerTeam = state.teams[expansion.playerTeamId];
  const confirmed = draw.resolved && Boolean(assignedPackage);

  const enterDraftPrep = () => onCommand({
    commandId: `stage3-enter-draft-prep-${selectedPackage ?? assignedPackage}`,
    type: "ENTER_EXPANSION_DRAFT_PREP",
    payload: { packageId: confirmed ? undefined : selectedPackage },
  });

  return (
    <section className="flow-card rights-card rights-draw-screen">
      <div className="prototype-flow-heading rights-draw-heading">
        <div className="step-label">步骤 02/04 · 扩军权益选择</div>
        <h2>选择扩军权益</h2>
        <p>两份方案各有侧重。你的球队选择一份，另一份自动归属电脑球队。</p>
      </div>

      <div className="rights-own-team">
        <TeamLogoMark team={playerTeam} />
        <span><small>当前操作球队</small><b>{playerTeam.fullName}</b></span>
        <em>{selectedPackage ? `已选${packageLabel(selectedPackage)}` : "等待选择"}</em>
      </div>

      <div className="rights-package-lottery rights-package-choice" aria-label="选择扩军权益方案">
        {(["A", "B"] as ExpansionPackage[]).map((packageId) => {
          const selected = (selectedPackage ?? assignedPackage) === packageId;
          return <button type="button" data-testid={`rights-package-${packageId}`} key={packageId} className={selected ? "selected" : ""} aria-pressed={selected} disabled={busy || confirmed} onClick={() => setSelectedPackage(packageId)}>
            <span>方案 {packageId} · {packageId === "A" ? "阵容优先" : "新秀优先"}</span>
            <b>{packageId === "A" ? "先手挑选即战力" : "提升新秀选秀顺位"}</b>
            <small><strong>扩军选秀</strong> 第 {packageId === "A" ? 1 : 2} 顺位</small>
            <small><strong>新秀首轮</strong> 第 {packageId === "A" ? 6 : 5} 顺位</small>
            <small><strong>新秀次轮</strong> 第 {packageId === "A" ? 38 : 37} 顺位</small>
            <p>{packageId === "A" ? "优先从未保护名单中挑走核心球员，适合希望快速形成竞争力的球队。" : "扩军选秀后手一位，换取首届新秀选秀两轮各提升一个顺位，适合长期建队。"}</p>
            <em>{selected ? "✓ 已选择" : "点击选择此方案"}</em>
          </button>;
        })}
        <div className="rights-package-versus">二选一</div>
      </div>

      <div className="rights-draw-action rights-choice-action">
        <p>{selectedPackage || assignedPackage
          ? `确认后，${state.teams[expansion.aiTeamId].fullName}将获得另一份方案；合同选项会在后台结算。`
          : "请先比较两份方案的三个顺位，再选择适合你的建队方向。"}</p>
        <button data-testid="confirm-rights-package" className="primary-cta" disabled={busy || (!selectedPackage && !assignedPackage)} onClick={() => void enterDraftPrep()}>{confirmed ? "使用已确认方案继续 →" : "确认选择并进入扩军选秀准备 →"}</button>
      </div>
    </section>
  );
}

function OptionPhase({ state, busy, onCommand }: Pick<ExpansionFlowProps, "state" | "busy" | "onCommand">) {
  const contracts = Object.values(state.players).map((player) => player.contract);
  const exercised = contracts.filter((contract) => contract.optionDecision === "EXERCISED").length;
  const declined = contracts.filter((contract) => contract.optionDecision === "DECLINED").length;
  const excluded = contracts.filter((contract) => contract.status === "UFA" || contract.status === "RFA").length;
  return (
    <section className="flow-card rights-card prototype-extended-flow option-phase-screen">
      <header className="prototype-flow-heading"><span className="prototype-flow-icon" aria-hidden="true">✓</span><div><span className="step-label">03 / 强制合同选项阶段</span><h2>合同选项已经结算</h2><p>固定随机种子已完成球队选项与球员选项判定。</p></div><b className="prototype-flow-badge">结算完成</b></header>
      <div className="prototype-section-bar"><b>结算摘要</b><span>仅有效合同进入扩军池</span></div>
      <div className="metrics-row"><span><b>{exercised}</b>执行选项</span><span><b>{declined}</b>拒绝选项</span><span><b>{excluded}</b>自由球员排除</span></div>
      <div className="prototype-info-note success"><span>✓</span><p><b>合同池已校验</b>{humanizeUiText(state.expansion?.lastNotice)}</p></div>
      <div className="prototype-sticky-action"><button className="primary-cta" disabled={busy} onClick={() => onCommand({ commandId: "stage3-freeze-pool", type: "PREPARE_EXPANSION_TRADE", payload: {} })}>冻结保护名单并查看报价 →</button></div>
    </section>
  );
}

function TradeDesk({ state, busy, onCommand }: Pick<ExpansionFlowProps, "state" | "busy" | "onCommand">) {
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"ALL" | "SELECT_PLAYER" | "PROTECT_PLAYER">("ALL");
  const expansion = state.expansion;
  if (!expansion) return null;
  const offers = expansion.tradeOffers.filter((offer) => offer.targetExpansionTeamId === expansion.playerTeamId && offer.status === "AVAILABLE");
  const visibleOffers = filter === "ALL" ? offers : offers.filter((offer) => offer.type === filter);
  const accepted = expansion.commitments.filter((entry) => entry.expansionTeamId === expansion.playerTeamId && entry.status === "ACTIVE");
  return (
    <section className="flow-card prototype-trade-flow reference-trade-desk">
      <div className="prototype-trade-heading reference-trade-header"><div><span className="step-label">步骤 03/04 · 扩军选秀准备</span><h2>扩军交易桌</h2><p>接受协议会锁定球员或保护承诺，确认前请检查合同成本。</p></div><span>已接受 {accepted.length}/5</span></div>
      <div className="trade-prep-summary reference-trade-stats">
        <span><small>合同池</small><b>已自动校验</b></span><span><small>保护名单</small><b>30 队已冻结</b></span><span><small>可用报价</small><b>{offers.length} 份</b></span>
      </div>
      <div className="trade-rule-note reference-trade-info"><span>!</span><p><b>合同选项已在后台结算</b>只有下赛季仍有有效合同的球员进入扩军池；无需再单独确认。</p></div>
      <div className="trade-offer-filters reference-trade-tabs" role="group" aria-label="筛选扩军交易报价">
        {(["ALL", "SELECT_PLAYER", "PROTECT_PLAYER"] as const).map((value) => <button key={value} className={filter === value ? "selected" : ""} onClick={() => setFilter(value)}>{value === "ALL" ? "全部报价" : value === "SELECT_PLAYER" ? "指定选择" : "保护球员"}</button>)}
      </div>
      <div className="offer-list reference-deal-list">
        {visibleOffers.slice(0, 12).map((offer) => {
          const player = state.players[offer.targetPlayerId];
          const asset = state.draftPicks[offer.compensationAssetIds[0]];
          const team = state.teams[offer.sourceTeamId];
          const chineseName = playerNameZh(player.name, player.id);
          return (
            <article key={offer.id} className="offer-card prototype-offer-card reference-deal-card">
              <header><span><TeamLogoMark team={team} /><b style={{ color: team.primaryColor }}>{team.fullName}</b></span><em className={offer.type === "SELECT_PLAYER" ? "designated" : "protected"}>{offer.type === "SELECT_PLAYER" ? "下一签自动选择" : "承诺不选择"}</em></header>
              <div className="offer-player-line reference-player-head"><div><b>{chineseName}</b><span>{positionPairLabel(player.position, player.secondaryPosition)} · {player.age} 岁</span></div><span className="trade-overall-badge" data-testid={`trade-player-overall-${player.id}`}><small>综合</small><strong>{calculatePlayerOverall(player).toFixed(0)}</strong></span></div>
              <div className="offer-contract-grid">
                <span><small>本季年薪</small><b>{money(player.contract.salary)}</b></span><span><small>剩余合同</small><b>{player.contract.yearsRemaining} 年</b></span><span><small>补偿资产</small><b>{asset.year} {asset.round === 1 ? "首轮签" : "次轮签"}</b></span>
              </div>
              <p className="offer-impact">{offer.type === "SELECT_PLAYER" ? "接受后将占用下一次可用扩军签位，并锁定该队唯一损失名额。" : "接受后本队不能选择该球员；扩军选秀完成后获得补偿签。"}</p>
              <div className="offer-actions"><button className="detail-button btn-secondary" onClick={() => setSelectedPlayerId(player.id)}>查看球员</button><button className="btn-primary" disabled={busy || accepted.length >= 5} onClick={() => onCommand({ commandId: `stage3-accept-${offer.id}`, type: "ACCEPT_EXPANSION_TRADE", payload: { offerId: offer.id } })}>接受这份协议</button></div>
            </article>
          );
        })}
        {visibleOffers.length === 0 && <div className="trade-empty-state">当前筛选条件下没有可接受报价。</div>}
      </div>
      <div className="trade-desk-final-action reference-footer-submit"><p>不接受报价也可以继续。进入选秀后，本轮交易承诺不可普通撤销。</p><button data-testid="start-expansion-draft" className="primary-cta" disabled={busy} onClick={() => onCommand({ commandId: "stage3-start-draft", type: "START_EXPANSION_DRAFT", payload: {} })}>锁定协议并进入扩军选秀 ➔</button></div>
      {selectedPlayerId && <PlayerDetail state={state} player={state.players[selectedPlayerId]} onClose={() => setSelectedPlayerId(null)} />}
    </section>
  );
}

function ExpansionDraft({ state, busy, onCommand }: Pick<ExpansionFlowProps, "state" | "busy" | "onCommand">) {
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState("BOS");
  const [teamSelectorOpen, setTeamSelectorOpen] = useState(false);
  const [currentRosterOpen, setCurrentRosterOpen] = useState(true);
  const expansion = state.expansion;
  if (!expansion) return null;
  const players = getSelectableExpansionPlayers(state);
  const originalTeamIds = Object.keys(state.teams)
    .filter((teamId) => teamId !== "SEA" && teamId !== "LVG")
    .sort((left, right) => state.teams[left].conference === state.teams[right].conference
      ? left.localeCompare(right)
      : state.teams[left].conference === "EAST" ? -1 : 1);
  const visibleTeamId = originalTeamIds.includes(selectedTeamId) ? selectedTeamId : originalTeamIds[0];
  const visibleTeam = state.teams[visibleTeamId];
  const availablePlayers = players.filter((player) => player.teamId === visibleTeamId);
  const protectedPlayers = (expansion.protectionLists[visibleTeamId]?.protectedPlayerIds ?? []).map((id) => state.players[id]).filter(Boolean);
  const availableCountByTeam = players.reduce<Record<string, number>>((counts, player) => ({ ...counts, [player.teamId]: (counts[player.teamId] ?? 0) + 1 }), {});
  const playerTeam = state.teams[expansion.playerTeamId];
  const currentRoster = playerTeam.playerIds
    .map((playerId) => state.players[playerId])
    .filter(Boolean)
    .sort((left, right) => calculatePlayerOverall(right) - calculatePlayerOverall(left) || left.id.localeCompare(right.id));
  const rosterPositionCounts = (["PG", "SG", "SF", "PF", "C"] as const).map((position) => ({
    position,
    count: currentRoster.filter((player) => player.position === position).length,
  }));
  const rosterPositionSummary = rosterPositionCounts.map(({ position, count }) => `${position} ${count}`).join(" · ");
  const capSheet = getCapSheet(state, expansion.playerTeamId);
  const pickNumber = expansion.currentPickIndex + 1;
  const closeTeamSelector = () => setTeamSelectorOpen(false);
  const openTeamSelector = () => setTeamSelectorOpen(true);
  const chooseVisibleTeam = (teamId: string) => {
    setSelectedTeamId(teamId);
    closeTeamSelector();
  };
  const selectPlayerAndAdvance = async (playerId: string) => {
    const currentIndex = originalTeamIds.indexOf(visibleTeamId);
    const nextTeamId = originalTeamIds
      .map((_, offset) => originalTeamIds[(currentIndex + offset + 1) % originalTeamIds.length])
      .find((teamId) => teamId !== visibleTeamId && (availableCountByTeam[teamId] ?? 0) > 0);
    await onCommand({
      commandId: `stage3-pick-${pickNumber}-${playerId}`,
      type: "SELECT_EXPANSION_PLAYER",
      payload: { playerId, expectedPickNumber: pickNumber },
    });
    if (nextTeamId) setSelectedTeamId(nextTeamId);
  };
  return (
    <section className="flow-card draft-card prototype-expansion-draft reference-expansion-draft">
      <div className="prototype-draft-heading reference-draft-header"><div><h2>扩军选秀大会</h2><p>从其他球队未保护名单中挑选球员</p></div><span><small>已选中人数</small><b>{currentRoster.length} / 14</b></span></div>
      <section className="draft-cap-dashboard" aria-label={`${playerTeam.fullName}薪资情况`}>
        <header><span><TeamLogoMark team={playerTeam} /><b>{playerTeam.fullName}</b></span><em>实时校验</em></header>
        <div>
          <span><small>保障工资</small><b>{money(capSheet.activeContractSalary)}</b></span>
          <span><small>工资帽占用</small><b>{money(capSheet.total)}</b></span>
          <span><small>帽下空间</small><b className={capSheet.availableCapSpace < 0 ? "negative" : ""}>{money(capSheet.availableCapSpace)}</b></span>
          <span><small>联盟工资帽</small><b>{money(LEAGUE_FINANCE_CONFIG.salaryCap)}</b></span>
        </div>
      </section>
      <details className="draft-current-roster-panel" open={currentRosterOpen} onToggle={(event) => setCurrentRosterOpen(event.currentTarget.open)} data-testid="expansion-current-roster">
        <summary>
          <span><TeamLogoMark team={playerTeam} /><span><b>当前球队阵容</b><small>{currentRosterOpen ? `${currentRoster.length} / 14 人 · 选择后实时加入` : rosterPositionSummary}</small></span></span>
          <em>{currentRosterOpen ? "收起阵容" : "展开阵容"}</em>
        </summary>
        <div className="draft-current-roster-body">
          <div className="draft-current-roster-balance" aria-label="当前阵容位置人数">
            {rosterPositionCounts.map(({ position, count }) => <span className={count === 0 ? "empty" : ""} key={position}><small>{position}</small><b>{count}</b></span>)}
          </div>
          {currentRoster.length > 0 ? <div className="draft-current-roster-grid">
            {currentRoster.map((player) => <button type="button" data-testid={`current-roster-player-${player.id}`} key={player.id} onClick={() => setSelectedPlayerId(player.id)}>
              <span><b>{playerNameZh(player.name, player.id)}</b><small>{positionPairLabel(player.position, player.secondaryPosition)} · 年薪 {money(player.contract.salary)}</small></span>
              <em><small>OVR</small>{calculatePlayerOverall(player).toFixed(0)}</em>
            </button>)}
          </div> : <div className="draft-current-roster-empty"><b>阵容席位等待填充</b><span>从下方未保护名单选中球员后，会立即显示在这里。</span></div>}
        </div>
      </details>
      <div className="inline-notice draft-event-log">[ACTION REQUIRED] <strong>{visibleTeam.fullName}</strong> · {expansion.lastNotice ? localizePlayerNamesInText(humanizeUiText(expansion.lastNotice), Object.values(state.players)) : `当前有 ${availablePlayers.length} 名未保护球员可供挑选。`}</div>
      <button className="draft-team-selector-button reference-team-switcher" onClick={openTeamSelector}><span><TeamLogoMark team={visibleTeam} /><b>{visibleTeam.fullName}</b></span><small>30 支球队 · 点击切换⌄</small></button>
      <div className="draft-roster-scroll">
        <details className="draft-protected-panel" open>
          <summary><span>🔒 球队被保护球员（{protectedPlayers.length} 人）</span><small>点击展开 / 收起</small></summary>
          <div className="protected-player-grid">{protectedPlayers.map((player) => <article key={player.id}><div><b>{playerNameZh(player.name, player.id)}</b><small>{positionPairLabel(player.position, player.secondaryPosition)} ｜ 综合 {calculatePlayerOverall(player).toFixed(0)}</small></div><span>🔒</span></article>)}</div>
        </details>
        <section className="draft-available-player-panel" aria-label="选秀池可用球员">
          <div className="draft-section-label available">🌐 选秀池可用球员（{availablePlayers.length} 人）</div>
          <div className="player-pool">
          {availablePlayers.map((player) => (
            <article className="player-row prototype-draft-player" key={player.id} onClick={() => setSelectedPlayerId(player.id)}>
              <div className="draft-player-copy"><div className="draft-player-title"><em>{positionPairLabel(player.position, player.secondaryPosition)}</em><b>{playerNameZh(player.name, player.id)}</b></div><div className="draft-player-stats"><span>综合 <strong>{calculatePlayerOverall(player).toFixed(0)}</strong></span><i>｜</i><span>年龄 <strong>{player.age} 岁</strong></span><i>｜</i><span>年薪 <strong>{money(player.contract.salary)}</strong></span><i>｜</i><span>剩余 <strong>{player.contract.yearsRemaining} 年</strong></span></div></div>
              <span className="player-actions"><button data-testid={`draft-player-select-${player.id}`} disabled={busy} onClick={(event) => { event.stopPropagation(); void selectPlayerAndAdvance(player.id); }}>选中球员</button></span>
            </article>
          ))}
          {availablePlayers.length === 0 && <div className="draft-team-empty"><b>该队当前没有可选球员</b><span>可能已经损失一名球员，或球员被交易协议锁定。你仍可查看该队保护名单。</span></div>}
          </div>
        </section>
      </div>
      {teamSelectorOpen && <div className="team-selector-backdrop cyber-team-selector-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeTeamSelector(); }}><section className="team-selector-drawer cyber-team-selector" role="dialog" aria-modal="true" aria-label="选择联盟球队"><header><div className="cyber-team-selector-title"><span>SYS</span><b>选择联盟球队 <em>（30）</em></b></div><button className="cyber-team-selector-close" onClick={closeTeamSelector} aria-label="关闭球队选择">✕</button></header><div className="team-selector-body cyber-team-selector-body">{(["EAST", "WEST"] as const).map((conference) => <div className="cyber-conference-column" key={conference}><h3>{conference}_CONF / {conference === "EAST" ? "东部联盟" : "西部联盟"}</h3><div>{originalTeamIds.filter((id) => state.teams[id].conference === conference).map((id) => {
        const availableCount = availableCountByTeam[id] ?? 0;
        const disabled = availableCount === 0;
        return <button data-testid={`draft-team-${id}`} className={`${id === visibleTeamId ? "active" : ""}${disabled ? " disabled" : ""}`} disabled={disabled} key={id} onClick={() => chooseVisibleTeam(id)}><span className="cyber-team-node-info"><TeamLogoMark team={state.teams[id]} /><span><b>{state.teams[id].name}</b><small><i className={disabled ? "none" : ""} />{disabled ? "暂无可选球员" : `可选 ${availableCount} 人`}</small></span></span><em>▶</em></button>;
      })}</div></div>)}</div></section></div>}
      {selectedPlayerId && <PlayerDetail state={state} player={state.players[selectedPlayerId]} onClose={() => setSelectedPlayerId(null)} />}
    </section>
  );
}

function TeamLogoMark({ team }: { team: GameState["teams"][string] }) {
  return <span className="draft-team-mark">{team.logoUrl ? <img src={team.logoUrl} alt="" /> : team.abbreviation.slice(0, 2)}</span>;
}

function PlayerDetail({ state, player, onClose }: { state: GameState; player: Player; onClose: () => void }) {
  const displayName = playerNameZh(player.name, player.id);
  return (
    <div className="player-detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="reference-player-dialog" role="dialog" aria-modal="true" aria-label={`${displayName} 球员详情`}>
        <button className="detail-close" onClick={onClose} aria-label="关闭球员详情">×</button>
        <ReferencePlayerCard player={player} teamName={state.teams[player.teamId].fullName} />
      </section>
    </div>
  );
}

function StageSummary({ state, onRestoreCheckpoint }: Pick<ExpansionFlowProps, "state" | "onRestoreCheckpoint">) {
  const expansion = state.expansion;
  if (!expansion) return null;
  return (
    <section className="flow-card complete-card prototype-extended-flow prototype-complete-screen">
      <header className="prototype-flow-heading"><span className="prototype-flow-icon" aria-hidden="true">✓</span><div><span className="step-label">第三阶段完成</span><h2>扩军选秀完成</h2><p>28 名球员完成唯一归属，补偿资产已全部结算。</p></div><b className="prototype-flow-badge">名单完成</b></header>
      <div className="prototype-section-bar"><b>两支扩军球队</b><span>下一阶段：新秀选秀</span></div>
      <div className="roster-summary">
        {(["SEA", "LVG"] as const).map((teamId) => <div key={teamId}><TeamLogo state={state} teamId={teamId} /><span><b>{state.teams[teamId].fullName}</b><small>{state.teams[teamId].playerIds.length} 名球员 · {expansion.picks.filter((pick) => pick.teamId === teamId).length} 次选择</small><details><summary>查看完整名单</summary><ol>{state.teams[teamId].playerIds.map((playerId) => <li key={playerId}>{playerNameZh(state.players[playerId].name, state.players[playerId].id)} · {positionPairLabel(state.players[playerId].position, state.players[playerId].secondaryPosition)}</li>)}</ol></details></span></div>)}
      </div>
      <div className="prototype-info-note"><span>i</span><p><b>阶段检查点</b>如需重新选择，可恢复到扩军选秀开始前。</p></div>
      <div className="prototype-sticky-action"><button className="secondary-cta" onClick={onRestoreCheckpoint}>恢复扩军选秀前检查点</button></div>
    </section>
  );
}

function TeamLogo({ state, teamId }: { state: GameState; teamId: ExpansionCityId }) {
  const team = state.teams[teamId];
  return <span className="summary-logo" style={{ background: `linear-gradient(145deg, ${team.primaryColor}, ${team.secondaryColor})` }}>{team.logoUrl ? <img src={team.logoUrl} alt="" /> : teamId}</span>;
}
