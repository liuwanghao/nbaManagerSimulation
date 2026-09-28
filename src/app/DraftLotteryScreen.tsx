import { useEffect, useState } from "react";
import { getDraftLotteryPreview, type DraftCommand } from "../game/draft/DraftService";
import type { GameState, RookieDraftPick } from "../game/state/types";

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
  const [revealedCount, setRevealedCount] = useState(0);
  const complete = entries.length > 0 && revealedCount >= entries.length;
  const latest = entries[revealedCount - 1];

  useEffect(() => {
    if (complete || entries.length === 0) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      const instant = window.setTimeout(() => setRevealedCount(entries.length), 0);
      return () => window.clearTimeout(instant);
    }
    const timer = window.setTimeout(() => setRevealedCount((count) => count + 1), revealedCount === 0 ? 750 : 540);
    return () => window.clearTimeout(timer);
  }, [complete, entries.length, revealedCount]);

  return <section className="flow-card draft-lottery-screen" aria-label="新秀选秀乐透抽签">
    <header className="draft-lottery-heading">
      <span>{state.league.seasonYear} NBA DRAFT LOTTERY</span>
      <h2>乐透抽签揭晓</h2>
      <p>顺位由赛季战绩、抽签球数和固定种子确定，已交易的签位归当前持有球队。</p>
    </header>
    <div className="draft-lottery-stage" aria-live="polite" aria-atomic="true">
      <div className={`draft-lottery-ball${complete ? " is-complete" : ""}`} aria-hidden="true">{complete ? "#1" : `#${entries[revealedCount]?.pickNumber ?? 1}`}</div>
      <div className="draft-lottery-spotlight">
        <small>{complete ? "状元签归属" : latest ? `第 ${latest.pickNumber} 顺位揭晓` : "正在准备抽签结果"}</small>
        <strong>{complete ? state.teams[entries.at(-1)?.ownerTeamId ?? ""]?.fullName : latest ? state.teams[latest.ownerTeamId]?.fullName : "即将开始"}</strong>
        <span>{complete ? `${state.teams[entries.at(-1)?.originalTeamId ?? ""]?.fullName} 原签` : latest ? `${state.teams[latest.originalTeamId]?.fullName} 原签` : "从末位开始依次公布"}</span>
      </div>
    </div>
    <div className="draft-lottery-progress"><span>已公布 {revealedCount} / {entries.length}</span><div role="progressbar" aria-label="乐透抽签公布进度" aria-valuemin={0} aria-valuemax={entries.length} aria-valuenow={revealedCount}><i style={{ width: `${entries.length ? revealedCount / entries.length * 100 : 0}%` }} /></div></div>
    <div className="draft-lottery-results" aria-label="乐透选秀顺位">
      {entries.map((pick, index) => {
        const shown = index < revealedCount;
        const owner = state.teams[pick.ownerTeamId];
        const original = state.teams[pick.originalTeamId];
        return <article key={pick.pickNumber} className={`draft-lottery-result${shown ? " is-revealed" : ""}${shown && pick.pickNumber === latest?.pickNumber ? " is-latest" : ""}${pick.pickNumber <= 3 ? " is-top-three" : ""}${shown && pick.ownerTeamId === state.userTeamId ? " is-my-pick" : ""}`}>
          <span className="draft-lottery-number">#{pick.pickNumber}</span>
          {shown ? <><strong>{owner?.fullName ?? pick.ownerTeamId}</strong><small>{original?.fullName ?? pick.originalTeamId} 原签{pick.ownerTeamId === state.userTeamId ? " · 本队持签" : ""}</small></> : <><strong>等待揭晓</strong><small>　</small></>}
        </article>;
      })}
    </div>
    <div className="draft-lottery-actions">
      {complete ? <button type="button" className="draft-lottery-secondary" onClick={() => setRevealedCount(0)}>重播抽签</button> : <button type="button" className="draft-lottery-secondary" onClick={() => setRevealedCount(entries.length)}>公布全部</button>}
      <button type="button" className="draft-terminal-cta" disabled={busy || !complete} onClick={() => void onCommand({ commandId: `acknowledge-draft-lottery-${state.league.seasonId}`, type: "ACKNOWLEDGE_DRAFT_LOTTERY", payload: {} })}>进入选秀大厅 <span aria-hidden="true">▶</span></button>
    </div>
  </section>;
}
