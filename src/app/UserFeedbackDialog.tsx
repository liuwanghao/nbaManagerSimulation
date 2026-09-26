import { useEffect, useRef, useState } from "react";
import { feedbackContentLength, submitUserFeedback } from "./userFeedback";

export function UserFeedbackDialog({ onClose }: { onClose: () => void }) {
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<{ message: string; error: boolean } | null>(null);
  const submittingRef = useRef(false);
  const length = feedbackContentLength(content);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submittingRef.current) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const submit = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setNotice(null);
    try {
      await submitUserFeedback(content);
      setContent("");
      setNotice({ message: "反馈已提交，感谢你帮助改进游戏。", error: false });
    } catch (error) {
      setNotice({ message: error instanceof Error ? error.message : "反馈暂时无法提交，请稍后再试", error: true });
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return <div className="settings-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !submitting) onClose(); }}>
    <section className="settings-dialog feedback-dialog" role="dialog" aria-modal="true" aria-label="玩家反馈">
      <header><div><small>设置</small><h2>玩家反馈</h2></div><button type="button" disabled={submitting} aria-label="关闭玩家反馈" onClick={onClose}>×</button></header>
      <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <label htmlFor="game-feedback-content">告诉我们你遇到的问题或建议</label>
        <textarea id="game-feedback-content" autoFocus value={content} onChange={(event) => { setContent(event.target.value); if (notice) setNotice(null); }} placeholder="例如：交易、轮换或比赛模拟中遇到了什么问题？" rows={6} />
        <div className="feedback-dialog-meta"><span>通过虎扑账号提交</span><span className={length > 2000 ? "over-limit" : ""}>{length} / 2000 字</span></div>
        {notice && <p className={`feedback-dialog-notice${notice.error ? " error" : ""}`} role={notice.error ? "alert" : "status"} aria-live="polite">{notice.message}</p>}
        <button className="feedback-dialog-submit" type="submit" disabled={submitting || length < 1 || length > 2000}>{submitting ? "提交中…" : "提交反馈"}</button>
      </form>
    </section>
  </div>;
}
