import { useEffect, useMemo, useRef, useState } from "react";
import { BALANCE_CONFIG } from "../config/balanceConfig";
import { calculatePlayerOverall } from "../game/player/PlayerRatingService";
import { SIMULATION_CONFIG } from "../game/simulation/config";
import { injuryDaysRemaining } from "../game/simulation/injuries";
import {
  LINEUP_POSITIONS,
  buildDefaultRotationPlan,
  normalizeRotationPlan,
  positionCompatibilityLabel,
  positionMismatchPenalty,
  projectedRotationBench,
  validateRotationPlan,
} from "../game/roster/RotationPlanService";
import type { Player, Team, TeamRotationPlan } from "../game/state/types";
import { playerNameZh } from "./playerNameZh";
import { playerRatingStyle } from "./playerRatingColor";
import { PlayerPortrait } from "./PlayerPortrait";
import { positionPairLabel } from "./uiText";
import { openPosterPostEditor } from "./careerShare";
import { renderRosterPoster } from "./rosterPoster";
import { rosterPostDraft, validateRosterPost } from "./rosterShare";

interface RotationEditorProps {
  players: Player[];
  plan?: TeamRotationPlan;
  postseason: boolean;
  busy: boolean;
  onSave: (plan: TeamRotationPlan) => void;
  shareContext?: { team: Pick<Team, "fullName">; seasonId: string };
}

const errorLabel = (message: string): string => ({
  ROTATION_STARTERS_MUST_BE_UNIQUE: "五个首发位置不能使用同一名球员",
  ROTATION_STARTER_UNAVAILABLE: "伤病或不可出战球员不能设为首发",
  ROTATION_MINUTES_MUST_TOTAL_240: "全队目标分钟必须正好为 240",
  ROTATION_ACTIVE_PLAYER_COUNT_INVALID: "必须安排 5–12 名球员进入轮换",
  ROTATION_STARTER_REQUIRES_MINUTES: "每名首发都必须获得出场时间",
  ROTATION_UNAVAILABLE_PLAYER_HAS_MINUTES: "伤病或不可出战球员的目标分钟必须为 0",
  ROTATION_MINUTES_OUT_OF_RANGE: "常规赛单人最多 40 分钟，季后赛最多 42 分钟",
}[message] ?? message);

export function swapRotationPositions(plan: TeamRotationPlan, firstPlayerId: string, secondPlayerId: string): TeamRotationPlan | null {
  const firstSlot = LINEUP_POSITIONS.find((slot) => plan.starters[slot] === firstPlayerId);
  const secondSlot = LINEUP_POSITIONS.find((slot) => plan.starters[slot] === secondPlayerId);
  const starterIds = new Set(Object.values(plan.starters));
  const benchIds = Object.keys(plan.targetMinutes).filter((id) => !starterIds.has(id));
  const benchOrder = [...new Set((plan.benchOrder ?? []).filter((id) => benchIds.includes(id))),
    ...benchIds.filter((id) => !plan.benchOrder?.includes(id))
      .sort((left, right) => plan.targetMinutes[right] - plan.targetMinutes[left] || left.localeCompare(right))];
  if (!firstSlot && !secondSlot) {
    const firstIndex = benchOrder.indexOf(firstPlayerId);
    const secondIndex = benchOrder.indexOf(secondPlayerId);
    if (firstIndex < 0 || secondIndex < 0) return null;
    [benchOrder[firstIndex], benchOrder[secondIndex]] = [benchOrder[secondIndex], benchOrder[firstIndex]];
    const firstMinutes = plan.targetMinutes[firstPlayerId] ?? 0;
    const secondMinutes = plan.targetMinutes[secondPlayerId] ?? 0;
    const targetMinutes = (firstMinutes > 0) !== (secondMinutes > 0)
      ? { ...plan.targetMinutes, [firstPlayerId]: secondMinutes, [secondPlayerId]: firstMinutes }
      : plan.targetMinutes;
    return { ...plan, benchOrder, targetMinutes, selectionMode: "MANUAL" };
  }
  const starters = { ...plan.starters };
  if (firstSlot) starters[firstSlot] = secondPlayerId;
  if (secondSlot) starters[secondSlot] = firstPlayerId;
  if (!firstSlot || !secondSlot) {
    const promotedId = firstSlot ? secondPlayerId : firstPlayerId;
    const demotedId = firstSlot ? firstPlayerId : secondPlayerId;
    const promotedIndex = benchOrder.indexOf(promotedId);
    if (promotedIndex >= 0) benchOrder.splice(promotedIndex, 1);
    benchOrder.splice(promotedIndex < 0 ? benchOrder.length : promotedIndex, 0, demotedId);
  }
  return { ...plan, starters, benchOrder, selectionMode: "MANUAL" };
}

export function limitedRotationMinutes(currentMinutes: number, totalMinutes: number, requestedMinutes: number, playerMaximum: number): number {
  const remainingForPlayer = Math.max(0, BALANCE_CONFIG.rotationPlan.regulationMinutes - (totalMinutes - currentMinutes));
  const requested = Number.isFinite(requestedMinutes) ? Math.round(requestedMinutes) : 0;
  return Math.max(0, Math.min(playerMaximum, remainingForPlayer, requested));
}

export function RotationEditor({ players, plan, postseason, busy, onSave, shareContext }: RotationEditorProps) {
  const fallback = useMemo(() => buildDefaultRotationPlan(players), [players]);
  const normalized = useMemo(() => normalizeRotationPlan(players, plan ?? fallback), [players, plan, fallback]);
  const [draft, setDraft] = useState<TeamRotationPlan>(normalized);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [swapMessage, setSwapMessage] = useState("");
  const [isSharing, setIsSharing] = useState(false);
  const [shareStatus, setShareStatus] = useState("");
  const [shareError, setShareError] = useState(false);
  const [posterPreview, setPosterPreview] = useState("");
  const sharingRef = useRef(false);
  const mountedRef = useRef(true);
  const previewUrlRef = useRef("");
  const interactionBusy = busy || isSharing;
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);
  useEffect(() => { setDraft(normalized); setSelectedPlayerId(null); setSwapMessage(""); }, [normalized]);
  useEffect(() => { setShareStatus(""); setShareError(false); }, [draft]);
  const total = players.reduce((sum, player) => sum + (draft.targetMinutes[player.id] ?? 0), 0);
  const teamMinuteLimit = BALANCE_CONFIG.rotationPlan.regulationMinutes;
  const playerMinuteLimit = postseason ? BALANCE_CONFIG.rotationPlan.postseasonMaximumMinutes : BALANCE_CONFIG.rotationPlan.regularSeasonMaximumMinutes;
  const activeCount = players.filter((player) => (draft.targetMinutes[player.id] ?? 0) > 0).length;
  const starters = LINEUP_POSITIONS.flatMap((slot) => {
    const player = players.find((candidate) => candidate.id === draft.starters[slot]);
    return player ? [player] : [];
  });
  const starterIds = new Set(starters.map((player) => player.id));
  const canShareStarters = starters.length === 5 && starterIds.size === 5 && starters.every((player) => player.available && !player.injury);
  const activeBench = projectedRotationBench(players, draft, starterIds);
  const activeBenchIds = new Set(activeBench.map((player) => player.id));
  const benchRanks = new Map(activeBench.map((player, index) => [player.id, index + 6]));
  const benchOrderRanks = new Map(draft.benchOrder?.map((id, index) => [id, index]));
  const bench = [...activeBench, ...players.filter((player) => !starterIds.has(player.id) && !activeBenchIds.has(player.id)).sort((left, right) => {
    const availabilityRank = (player: Player) => player.injury ? 2 : player.available ? 0 : 1;
    return availabilityRank(left) - availabilityRank(right)
      || (benchOrderRanks.get(left.id) ?? Infinity) - (benchOrderRanks.get(right.id) ?? Infinity)
      || (draft.targetMinutes[right.id] ?? 0) - (draft.targetMinutes[left.id] ?? 0)
      || calculatePlayerOverall(right) - calculatePlayerOverall(left);
  })];
  let validationError = "";
  try { validateRotationPlan(players, draft, postseason); } catch (error) { validationError = errorLabel(error instanceof Error ? error.message : "轮换方案无效"); }
  const requiredAvailablePlayers = Math.ceil(teamMinuteLimit / playerMinuteLimit);
  if (players.filter((player) => player.available && !player.injury).length < requiredAvailablePlayers) {
    validationError = `至少需要 ${requiredAvailablePlayers} 名可出战球员才能分配 ${teamMinuteLimit} 分钟`;
  }

  async function shareStartingFive() {
    if (!shareContext || busy || sharingRef.current) return;
    sharingRef.current = true;
    setIsSharing(true);
    setShareError(false);
    setShareStatus("正在检查登录状态和发帖内容…");
    try {
      const data = { ...shareContext, players, plan: draft };
      const post = rosterPostDraft(data);
      await validateRosterPost(post);
      if (!mountedRef.current) return;
      setShareStatus("正在生成首发五虎图片…");
      const poster = await renderRosterPoster(data);
      if (!mountedRef.current) return;
      const preview = URL.createObjectURL(poster);
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = preview;
      setPosterPreview(preview);
      await openPosterPostEditor(post, poster, "roster", (stage) => {
        if (!mountedRef.current) throw new Error("首发分享已取消。");
        setShareStatus(stage === "uploading" ? "正在上传首发图片…" : "正在打开虎扑发帖编辑器…");
      });
      if (mountedRef.current) setShareStatus("已打开虎扑发帖编辑器，请确认后发布。");
    } catch (error) {
      if (mountedRef.current) {
        setShareError(true);
        setShareStatus(error instanceof Error ? error.message : "首发分享失败，请稍后重试。");
      }
    } finally {
      sharingRef.current = false;
      if (mountedRef.current) setIsSharing(false);
    }
  }

  const selectPlayer = (playerId: string) => {
    if (!selectedPlayerId) {
      setSelectedPlayerId(playerId);
      setSwapMessage(`已选中 ${playerNameZh(players.find((player) => player.id === playerId)?.name ?? "", playerId)}，再点一名球员互换位置`);
      return;
    }
    if (selectedPlayerId === playerId) {
      setSelectedPlayerId(null);
      setSwapMessage("");
      return;
    }
    const swapped = swapRotationPositions(draft, selectedPlayerId, playerId);
    if (!swapped) {
      setSwapMessage("这两名球员无法互换，请重新选择");
      return;
    }
    const benchSwap = !Object.values(draft.starters).includes(selectedPlayerId) && !Object.values(draft.starters).includes(playerId);
    const activatesReserve = benchSwap && ((draft.targetMinutes[selectedPlayerId] ?? 0) > 0) !== ((draft.targetMinutes[playerId] ?? 0) > 0);
    setDraft(swapped);
    setSelectedPlayerId(null);
    setSwapMessage(activatesReserve ? "替补顺位与目标时间已互换" : benchSwap ? "替补顺位已互换，出场时间不变" : "首发位置已互换，出场时间不变");
  };
  const setMinutes = (playerId: string, value: number) => setDraft((current) => {
    const currentMinutes = current.targetMinutes[playerId] ?? 0;
    const currentTotal = players.reduce((sum, player) => sum + (current.targetMinutes[player.id] ?? 0), 0);
    return {
      ...current,
      targetMinutes: { ...current.targetMinutes, [playerId]: limitedRotationMinutes(currentMinutes, currentTotal, value, playerMinuteLimit) },
      selectionMode: "MANUAL",
    };
  });
  const renderPlayer = (player: Player) => {
    const starterSlot = LINEUP_POSITIONS.find((slot) => draft.starters[slot] === player.id);
    const benchRank = benchRanks.get(player.id);
    const mismatchPenalty = starterSlot ? positionMismatchPenalty(player, starterSlot) : 0;
    const minutes = draft.targetMinutes[player.id] ?? 0;
    const maximumForPlayer = Math.min(playerMinuteLimit, minutes + Math.max(0, teamMinuteLimit - total));
    const unavailable = !player.available || Boolean(player.injury);
    const name = playerNameZh(player.name, player.id);
    const overall = calculatePlayerOverall(player);
    const fatigue = Math.ceil(player.fatigue ?? 0);
    const morale = Math.floor(player.morale ?? SIMULATION_CONFIG.defaultMorale);
    const fatigued = (player.fatigue ?? 0) > SIMULATION_CONFIG.fatigue.noPenaltyThreshold;
    const lowMorale = (player.morale ?? SIMULATION_CONFIG.defaultMorale) < SIMULATION_CONFIG.moraleNoPenaltyThreshold;
    return <article key={player.id} data-player-id={player.id} className={`rotation-player-card${starterSlot ? " starter" : ""}${selectedPlayerId === player.id ? " selected" : ""}${unavailable ? " unavailable" : ""}${player.injury ? " injured" : ""}`}>
      <button type="button" className="rotation-player-pick" aria-label={`选择 ${name}${starterSlot ? `，首发 ${starterSlot}` : benchRank ? `，替补第 ${benchRank} 顺位` : "，轮换外"}，与另一名球员互换位置或顺位`} aria-pressed={selectedPlayerId === player.id} disabled={interactionBusy || unavailable} onClick={() => selectPlayer(player.id)}>
        <PlayerPortrait player={player} portraitPath={player.portraitPath} className="rotation-player-avatar" />
        <span className="rotation-player-copy">
          <span className="rotation-player-name-row">{starterSlot ? <span className={`rotation-assigned-slot${mismatchPenalty > 0 ? " mismatch" : ""}`} title={`${positionCompatibilityLabel(player, starterSlot)}${mismatchPenalty > 0 ? `，表现 -${mismatchPenalty}` : ""}`}>{starterSlot}</span> : benchRank ? <span className="rotation-assigned-slot bench" title={`替补第 ${benchRank} 顺位`}>{benchRank}</span> : null}<b title={name}>{name}</b>{player.injury ? <span className="rotation-injury-tag" title={`伤停约 ${injuryDaysRemaining(player)} 天`}>伤停<span className="rotation-injury-detail">约 {injuryDaysRemaining(player)} 天</span></span> : !player.available ? <span className="rotation-injury-tag">不可出战</span> : !minutes && !starterSlot ? <span className="rotation-outside-tag">轮换外</span> : null}</span>
          <span className="rotation-player-meta"><span className="rotation-position-badge">{positionPairLabel(player.position, player.secondaryPosition)}</span><span className={`rotation-player-condition${fatigued ? " fatigued" : ""}`} title={`疲劳 ${fatigue}${fatigued ? "，偏高" : ""}`}>疲劳 {fatigue}</span><span className={`rotation-player-condition${lowMorale ? " low-morale" : ""}`} title={`士气 ${morale}${lowMorale ? "，偏低" : ""}`}>士气 {morale}</span></span>
        </span>
        <span className="rotation-player-overall" aria-label={`能力值 ${overall.toFixed(0)}`}><small>OVR</small><strong className="player-rating-tone" style={playerRatingStyle(overall)}>{overall.toFixed(0)}</strong></span>
      </button>
      <div className="rotation-minute-stepper">
        <button type="button" aria-label={`${name}减少一分钟`} disabled={interactionBusy || minutes <= 0 || unavailable} onClick={() => setMinutes(player.id, minutes - 1)}>−</button>
        <label className="rotation-minute-value"><input aria-label={`${name}目标分钟`} disabled={interactionBusy || unavailable} type="number" min={0} max={maximumForPlayer} value={minutes} onChange={(event) => setMinutes(player.id, Number(event.target.value))} /><small>分钟</small></label>
        <button type="button" aria-label={`${name}增加一分钟`} disabled={interactionBusy || minutes >= maximumForPlayer || unavailable} onClick={() => setMinutes(player.id, minutes + 1)}>＋</button>
      </div>
    </article>;
  };

  return <section className="rotation-editor" aria-label="首发与轮换管理">
    <header className="rotation-editor-heading">
      <div><h2>阵容轮换</h2><p>点两名球员互换；非首发设为 0 分钟可轮休并恢复体能</p></div>
      <button type="button" className="rotation-auto" data-testid="auto-save-rotation-plan" disabled={interactionBusy} onClick={() => { setSelectedPlayerId(null); setSwapMessage(""); onSave(buildDefaultRotationPlan(players)); }}>一键自动匹配</button>
    </header>

    <div className="rotation-minute-summary">
      <span className={total === teamMinuteLimit ? "valid" : "invalid"}><small>已分配</small><b>{total} / {teamMinuteLimit}</b></span>
      <span><small>轮换人数</small><b>{activeCount} / {BALANCE_CONFIG.rotationPlan.maximumActivePlayers}</b></span>
      <span><small>单人上限</small><b>{playerMinuteLimit} 分钟</b></span>
    </div>
    <p className="rotation-swap-status" role="status">{swapMessage || "点击球员卡可调整首发位置或替补顺位"}{total >= teamMinuteLimit ? "；时间已分配完，先减少再增加" : ""}</p>

    <div className="rotation-groups">
      <section className="rotation-group" aria-label="首发阵容"><h3>首发阵容</h3><div className="rotation-minute-list">{starters.map(renderPlayer)}</div></section>
      <section className="rotation-group" aria-label="主要替补"><h3>主要替补</h3>{bench.length > 0 ? <div className="rotation-minute-list">{bench.map(renderPlayer)}</div> : <p className="rotation-group-empty">暂无替补球员</p>}</section>
    </div>
    {posterPreview && <div className="rotation-starter-poster"><img src={posterPreview} alt="首发五虎，包含五名球员的位置、头像、能力值和应用 Logo" /></div>}
    <footer className={`rotation-save-bar${shareContext ? " has-share-action" : ""}`}>
      <p className={shareError || (!shareStatus && validationError) ? "invalid" : "valid"} role="status" aria-live="polite">{shareStatus || validationError || "首发与 240 分钟轮换已就绪"}</p>
      {shareContext && <button type="button" className="rotation-share-button" disabled={interactionBusy || !canShareStarters} aria-busy={isSharing} onClick={() => void shareStartingFive()}>晒出首发五虎 ↗</button>}
      <button type="button" data-testid="save-rotation-plan" disabled={interactionBusy || Boolean(validationError)} onClick={() => onSave(draft)}>保存轮换方案</button>
    </footer>
  </section>;
}
