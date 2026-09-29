import { useRef, useState } from "react";
import { submitUserFeedback } from "./userFeedback";

export function GameIssueFeedbackAction({ content }: { content: string }) {
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const submittingRef = useRef(false);

  const submit = async () => {
    if (submittingRef.current || sent) return;
    submittingRef.current = true;
    setSubmitting(true);
    setNotice(null);
    try {
      await submitUserFeedback(content);
      setSent(true);
      setNotice("问题已反馈，感谢你帮助定位故障。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "反馈暂时无法提交，请稍后再试");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return <div className="game-issue-feedback">
    <button type="button" disabled={submitting || sent} onClick={() => void submit()}>{submitting ? "正在反馈…" : sent ? "已反馈" : "一键反馈此问题"}</button>
    {notice && <p role={sent ? "status" : "alert"} aria-live="polite">{notice}</p>}
  </div>;
}
