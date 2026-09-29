import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { getDraftLotteryPreview, type DraftCommand } from "../game/draft/DraftService";
import type { GameState, RookieDraftPick } from "../game/state/types";
import { getRewardVideoBridge } from "./rewardVideo";
import { hasConfirmedLotteryReward, lotteryRerollRewardKey, runLotteryRerollWithReward } from "./lotteryReward";

interface DraftLotteryScreenProps {
  state: GameState;
  busy: boolean;
  onCommand: (command: DraftCommand) => Promise<void>;
}

export function lotteryRevealOrder(state: GameState): RookieDraftPick[] {
  const entrantCount = getDraftLotteryPreview(state).length;
  return (state.rookieDraft?.pickOrder.filter((pick) => pick.round === 1 && pick.pickNumber <= entrantCount) ?? []).reverse();
}

export function DraftLotteryScreen({ state, busy, onCommand }: DraftLotteryScreenProps) {
  const entries = lotteryRevealOrder(state);
  const rerollCount = state.rookieDraft?.lotteryRerollCount ?? 0;
  const rewardKey = lotteryRerollRewardKey(state);
  const previousRerollCount = useRef(rerollCount);
  const rerollingRef = useRef(false);
  const revealSaved = state.rookieDraft?.lotteryRevealComplete === true;
  const [started, setStarted] = useState(revealSaved);
  const [revealedCount, setRevealedCount] = useState(revealSaved ? entries.length : 0);
  const [rerolling, setRerolling] = useState(false);
  const [rewardMessage, setRewardMessage] = useState<string | null>(null);
  const [rewardConfirmed, setRewardConfirmed] = useState(() => hasConfirmedLotteryReward(rewardKey));
  const complete = started && entries.length > 0 && revealedCount >= entries.length;
  const latest = entries[revealedCount - 1];
  const finishReveal = useCallback(() => {
    setRevealedCount(entries.length);
    if (!revealSaved) {
      void onCommand({ commandId: `complete-draft-lottery-reveal-${state.league.seasonId}-${rerollCount}`, type: "COMPLETE_DRAFT_LOTTERY_REVEAL", payload: {} });
    }
  }, [entries.length, revealSaved, onCommand, state.league.seasonId, rerollCount]);

  useLayoutEffect(() => {
    if (previousRerollCount.current === rerollCount) return;
    previousRerollCount.current = rerollCount;
    setRevealedCount(0);
    setStarted(true);
    setRewardMessage("新顺位已生成，正在重新揭晓。");
  }, [rerollCount]);

  useEffect(() => { setRewardConfirmed(hasConfirmedLotteryReward(rewardKey)); }, [rewardKey]);

  useEffect(() => {
    if (!started || complete || entries.length === 0) return;
    const revealNext = () => {
      const nextCount = Math.min(entries.length, revealedCount + 1);
      if (nextCount === entries.length) finishReveal();
      else setRevealedCount(nextCount);
    };
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      const instant = window.setTimeout(finishReveal, 0);
      return () => window.clearTimeout(instant);
    }
    const timer = window.setTimeout(revealNext, revealedCount === 0 ? 1100 : 850);
    return () => window.clearTimeout(timer);
  }, [started, complete, entries.length, revealedCount, finishReveal]);

  const reroll = async () => {
    if (rerollingRef.current || busy || !complete) return;
    rerollingRef.current = true;
    setRerolling(true);
    setRewardMessage(null);
    try {
      const result = await runLotteryRerollWithReward(rewardKey, getRewardVideoBridge(), () => onCommand({
        commandId: `reroll-draft-lottery-${state.league.seasonId}-${rerollCount + 1}`, type: "REROLL_DRAFT_LOTTERY", payload: {},
      }));
      setRewardConfirmed(hasConfirmedLotteryReward(rewardKey));
      if (!result.rerolled) setRewardMessage(result.message ?? "激励视频未完成，抽签结果保持不变。");
    } finally {
      rerollingRef.current = false;
      setRerolling(false);
    }
  };

  return <section className="flow-card draft-lottery-screen" aria-label="新秀选秀乐透抽签">
    <header className="draft-lottery-heading">
      <span>{state.league.seasonYear} NBA DRAFT LOTTERY</span>
      <h2>乐透抽签揭晓</h2>
      <p>顺位由赛季战绩、抽签球数和抽签种子确定，已交易的签位归当前持有球队。</p>
    </header>
    <div className="draft-lottery-stage" aria-live="polite" aria-atomic="true">
      <div className={`draft-lottery-ball${complete ? " is-complete" : ""}`} aria-hidden="true">{complete ? "#1" : `#${entries[revealedCount]?.pickNumber ?? 1}`}</div>
      <div className="draft-lottery-spotlight">
        <small>{complete ? "状元签归属" : latest ? `第 ${latest.pickNumber} 顺位揭晓` : started ? "正在揭晓抽签结果" : "等待开始抽签"}</small>
        <strong>{complete ? state.teams[entries.at(-1)?.ownerTeamId ?? ""]?.fullName : latest ? state.teams[latest.ownerTeamId]?.fullName : "即将开始"}</strong>
        <span>{complete ? `${state.teams[entries.at(-1)?.originalTeamId ?? ""]?.fullName} 原签` : latest ? `${state.teams[latest.originalTeamId]?.fullName} 原签` : "点击下方按钮后，从末位开始依次公布"}</span>
      </div>
    </div>
    <div className="draft-lottery-progress"><span>已公布 {revealedCount} / {entries.length}</span><div role="progressbar" aria-label="乐透抽签公布进度" aria-valuemin={0} aria-valuemax={entries.length} aria-valuenow={revealedCount}><i style={{ width: `${entries.length ? revealedCount / entries.length * 100 : 0}%` }} /></div></div>
    <div className="draft-lottery-results" aria-label="乐透选秀顺位">
      {entries.map((pick, index) => {
        const shown = index < revealedCount;
        const owner = state.teams[pick.ownerTeamId];
        const original = state.teams[pick.originalTeamId];
        return <article key={pick.pickNumber} className={`draft-lottery-result${shown ? " is-revealed" : ""}${shown && pick.pickNumber === latest?.pickNumber ? " is-latest" : ""}${shown && pick.pickNumber <= 3 ? ` is-rank-${pick.pickNumber}` : ""}${shown && pick.ownerTeamId === state.userTeamId ? " is-my-pick" : ""}`}>
          <span className="draft-lottery-number">#{pick.pickNumber}</span>
          {shown && pick.ownerTeamId === state.userTeamId && <span className="draft-lottery-my-badge">本队持签</span>}
          {shown ? <><strong>{owner?.fullName ?? pick.ownerTeamId}</strong><small>{original?.fullName ?? pick.originalTeamId} 原签</small></> : <><strong>等待揭晓</strong><small>　</small></>}
        </article>;
      })}
    </div>
    <div className="draft-lottery-actions">
      {rewardMessage && <p className="draft-lottery-reward-message" role="status" aria-live="polite">{rewardMessage}</p>}
      {started && <div className="draft-lottery-tools">
        {complete ? <><button type="button" className="draft-lottery-secondary" disabled={busy || rerolling} onClick={() => { setRevealedCount(0); setRewardMessage(null); }}>重播揭晓</button><button type="button" className="draft-lottery-secondary reward" disabled={busy || rerolling || !revealSaved} onClick={() => void reroll()}>{rerolling ? "正在重新抽签…" : rewardConfirmed ? "重试抽签（免视频）" : "看视频重新抽签"}</button></> : <button type="button" className="draft-lottery-secondary" disabled={busy || rerolling} onClick={finishReveal}>公布全部</button>}
      </div>}
      {!started ? <button type="button" className="draft-terminal-cta" disabled={busy || entries.length === 0} onClick={() => setStarted(true)}>开始抽签 <span aria-hidden="true">▶</span></button> : <button type="button" className="draft-terminal-cta" disabled={busy || rerolling || !complete} onClick={() => revealSaved ? void onCommand({ commandId: `acknowledge-draft-lottery-${state.league.seasonId}`, type: "ACKNOWLEDGE_DRAFT_LOTTERY", payload: {} }) : finishReveal()}>{complete && !revealSaved ? "保存抽签结果" : "进入选秀大厅"} <span aria-hidden="true">▶</span></button>}
    </div>
  </section>;
}
