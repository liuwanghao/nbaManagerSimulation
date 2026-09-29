import { useEffect, useState } from "react";
import {
  fiveGameReviewView, regularCoachingView,
  type CoachingCommand, type RegularPregameSelection,
} from "../game/coaching/CoachingService";
import type { CoachingFocus, GameState } from "../game/state/types";
import { SIMULATION_CONFIG } from "../game/simulation/config";
import { playerNameZh } from "./playerNameZh";

type ApplyCoaching = (command: CoachingCommand) => Promise<void>;
function PlayerChoices({ state, ids, selected, onChange, stat, disabled = false }: {
  state: GameState;
  ids: string[];
  selected: string[];
  onChange: (ids: string[]) => void;
  stat: "fatigue" | "morale";
  disabled?: boolean;
}) {
  return <div className="coaching-player-choices" role="group" aria-label={stat === "fatigue" ? "选择恢复体能的球员" : "选择鼓舞士气的球员"}>
    {ids.map((id) => <label key={id}><input type="checkbox" disabled={disabled} checked={selected.includes(id)} onChange={() => onChange(selected.includes(id) ? selected.filter((entry) => entry !== id) : selected.length < 2 ? [...selected, id] : selected)} /><span>{playerNameZh(state.players[id].name, id)}</span><b>{stat === "fatigue" ? "疲劳" : "士气"} {Math.round(state.players[id][stat])}</b></label>)}
  </div>;
}

function FocusChoice({ value, onChange, onClear, disabled = false }: { value: CoachingFocus | null; onChange: (value: CoachingFocus) => void; onClear?: () => void; disabled?: boolean }) {
  return <div className={`coaching-focus-options${onClear ? " with-skip" : ""}`} role="group" aria-label={onClear ? "选择下一场备战方式" : "选择攻防准备方向"}>
    {onClear && <button type="button" disabled={disabled} aria-pressed={value === null} className={value === null ? "selected" : ""} onClick={onClear}>不备战</button>}
    <button type="button" disabled={disabled} aria-pressed={value === "OFFENSE"} className={value === "OFFENSE" ? "selected" : ""} onClick={() => onChange("OFFENSE")}>进攻准备</button>
    <button type="button" disabled={disabled} aria-pressed={value === "DEFENSE"} className={value === "DEFENSE" ? "selected" : ""} onClick={() => onChange("DEFENSE")}>防守准备</button>
  </div>;
}

export function RegularCoachingPanel({ state, busy, selection, onSelectionChange, onUnlockVideo, rewardConfirmed, message }: {
  state: GameState;
  busy: boolean;
  selection: RegularPregameSelection | null;
  onSelectionChange: (selection: RegularPregameSelection) => void;
  onUnlockVideo: (gameId: string) => Promise<void>;
  rewardConfirmed?: boolean;
  message?: string | null;
}) {
  const view = regularCoachingView(state);
  if (!view) return null;
  const draft = selection?.gameId === view.gameId ? selection : null;
  const choice = draft?.choice === "NONE" ? null : draft?.choice ?? view.selected?.focus ?? null;
  const batchLabel = state.league.currentPhase === "PLAY_IN" || state.league.currentPhase === "PLAYOFFS" ? "模拟整轮" : "连续模拟 5 场";
  return <article className="coaching-panel" aria-label="逐场专项备战">
    <header><div><small>赛前专项备战</small><h3>为下一场做一次准备</h3></div><span>开赛时锁定</span></header>
    <FocusChoice value={choice} disabled={busy} onChange={(focus) => onSelectionChange({ gameId: view.gameId, choice: focus })} onClear={() => onSelectionChange({ gameId: view.gameId, choice: "NONE" })} />
    <p className={view.videoUnlocked ? "coaching-selected" : choice ? "coaching-pending-video" : undefined}>{view.videoUnlocked
      ? choice ? `视频已确认 · 下一场${choice === "OFFENSE" ? "进攻" : "防守"}效率提升 ${state.league.currentPhase === "PLAY_IN" || state.league.currentPhase === "PLAYOFFS" ? SIMULATION_CONFIG.coaching.playoffEfficiencyPoints : SIMULATION_CONFIG.coaching.regularEfficiencyPoints}；${batchLabel}仅首场生效。` : "视频已确认 · 选择进攻或防守后生效；不备战则按普通比赛模拟。"
      : choice ? "尚未观看视频 · 点击模拟会按普通比赛进行；看完视频后下一场备战才生效。" : "不备战可直接模拟；选择进攻或防守并看完视频后才获得加成。"}</p>
    {!view.videoUnlocked && choice && <button className="coaching-confirm" type="button" disabled={busy} onClick={() => void onUnlockVideo(view.gameId)}>{busy ? "处理中…" : rewardConfirmed ? "视频已确认 · 保存下一场备战" : "观看激励视频 · 解锁下一场备战"}</button>}
    {message && <p className="coaching-message" role="status">{message}</p>}
  </article>;
}

export function FiveGameReviewPanel({ state, busy, onApply, message, moraleRewardConfirmed, fatigueRewardConfirmed }: {
  state: GameState;
  busy: boolean;
  onApply: ApplyCoaching;
  message?: string | null;
  moraleRewardConfirmed?: boolean;
  fatigueRewardConfirmed?: boolean;
}) {
  const view = fiveGameReviewView(state);
  const [choice, setChoice] = useState<"FATIGUE" | "TEAM_FATIGUE" | "MORALE_TWO" | "MORALE" | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  useEffect(() => { setChoice(null); setSelected([]); }, [view?.afterGameId]);
  if (!view) return null;
  const twoPlayerNames = view.moraleTwoTargets.map((id) => playerNameZh(state.players[id].name, id)).join("、");
  return <article className="coaching-panel coaching-review-panel" aria-label="五场赛后教练组干预">
    <header><div><small>近 5 场赛后复盘</small><h3>教练组干预</h3></div><span>每 5 场限一次</span></header>
    <p>近五场 {view.wins} 胜 {view.losses} 负。本次可选择一次干预；开始下一场后机会失效。逐场模拟和连续模拟均可触发。</p>
    <div className="coaching-focus-options" role="group" aria-label="选择复盘干预方向">
      {view.fatigueCandidates.length > 0 && <button type="button" className={choice === "FATIGUE" ? "selected" : ""} onClick={() => { setChoice("FATIGUE"); setSelected(view.fatigueCandidates.slice(0, 2)); }}><span>恢复高疲劳</span><small>所选球员疲劳各 −{SIMULATION_CONFIG.coaching.reviewFatigueRecovery}</small></button>}
      {view.fatigueCandidates.length > 0 && <button type="button" className={choice === "TEAM_FATIGUE" ? "selected" : ""} onClick={() => { setChoice("TEAM_FATIGUE"); setSelected([]); }}><span>减轻全队疲劳</span><small>激励视频 · 每人疲劳 −{SIMULATION_CONFIG.coaching.reviewTeamFatigueRecovery}</small></button>}
      {view.moraleTwoTargets.length === 2 && <button type="button" className={choice === "MORALE_TWO" ? "selected" : ""} onClick={() => { setChoice("MORALE_TWO"); setSelected([]); }}><span>随机鼓舞两人</span><small>无需视频 · 两人士气各 +{SIMULATION_CONFIG.coaching.reviewTwoPlayerMoraleBoost}</small></button>}
      {view.moraleCandidates.length > 0 && <button type="button" className={`${choice === "MORALE" ? "selected" : ""}${view.moraleTwoTargets.length < 2 ? " review-full-width" : ""}`} onClick={() => { setChoice("MORALE"); setSelected([]); }}><span>鼓舞全队</span><small>激励视频 · 每人士气 +{SIMULATION_CONFIG.coaching.reviewTeamMoraleBoost}</small></button>}
    </div>
    {choice && <>{choice === "FATIGUE" && <PlayerChoices state={state} ids={view.fatigueCandidates} selected={selected} onChange={setSelected} stat="fatigue" />}
      <p>{choice === "MORALE" ? `视频完播确认后，全队球员士气各提升 ${SIMULATION_CONFIG.coaching.reviewTeamMoraleBoost}。` : choice === "MORALE_TWO" ? `无需视频。本次随机抽中 ${twoPlayerNames}，两人士气各提升 ${SIMULATION_CONFIG.coaching.reviewTwoPlayerMoraleBoost}。` : choice === "TEAM_FATIGUE" ? `视频完播确认后，全队球员疲劳各降低 ${SIMULATION_CONFIG.coaching.reviewTeamFatigueRecovery}。` : `所选球员疲劳各降低 ${SIMULATION_CONFIG.coaching.reviewFatigueRecovery}。`}</p>
      <button className="coaching-confirm" type="button" disabled={busy || choice === "FATIGUE" && selected.length === 0} onClick={() => void onApply(choice === "MORALE" ? { type: "USE_FIVE_GAME_REVIEW", afterGameId: view.afterGameId, benefit: "MORALE" } : choice === "MORALE_TWO" ? { type: "USE_FIVE_GAME_REVIEW", afterGameId: view.afterGameId, benefit: "MORALE_TWO" } : choice === "TEAM_FATIGUE" ? { type: "USE_FIVE_GAME_REVIEW", afterGameId: view.afterGameId, benefit: "TEAM_FATIGUE" } : { type: "USE_FIVE_GAME_REVIEW", afterGameId: view.afterGameId, benefit: "FATIGUE", playerIds: selected })}>{busy ? "处理中…" : choice === "MORALE" ? moraleRewardConfirmed ? "视频已确认 · 完成鼓舞" : "观看激励视频 · 鼓舞全队" : choice === "MORALE_TWO" ? "确认鼓舞两人" : choice === "TEAM_FATIGUE" ? fatigueRewardConfirmed ? "视频已确认 · 完成体能恢复" : "观看激励视频 · 减轻全队疲劳" : "确认体能恢复"}</button>
    </>}
    {message && <p className="coaching-message" role="status">{message}</p>}
  </article>;
}
