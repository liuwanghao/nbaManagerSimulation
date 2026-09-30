import { rosterPosterRows, type RosterPosterData } from "./rosterPoster";

export function rosterPostDraft(data: RosterPosterData) {
  const rows = rosterPosterRows(data);
  return {
    title: `${data.team.fullName}的首发五虎`,
    content: [
      `《篮球经理：联盟扩军时代》 · ${data.seasonId}赛季 · ${data.team.fullName}`,
      ...rows.map((row) => `${row.position} ${row.name} · 能力 ${row.overall.toFixed(0)}`),
    ].join("\n\n"),
  };
}

export async function validateRosterPost(draft: ReturnType<typeof rosterPostDraft>): Promise<void> {
  const sdk = (window as Window & { ColorboxAI?: {
    auth?: { getUserInfo?: () => Promise<{ code: number; message?: string; data?: { islogin?: number } | null }> };
    security?: { checkAudit?: (content: string) => Promise<{ code: number; message?: string; data?: boolean | null }> };
    oss?: { uploadFile?: unknown };
    request?: { bbs?: { openPostEditor?: unknown } };
  } }).ColorboxAI;
  if (typeof sdk?.auth?.getUserInfo !== "function" || typeof sdk.security?.checkAudit !== "function" || typeof sdk.oss?.uploadFile !== "function" || typeof sdk.request?.bbs?.openPostEditor !== "function") {
    throw new Error("请在支持发帖功能的虎扑 App 内打开游戏后晒出首发五虎。");
  }
  const user = await sdk.auth.getUserInfo();
  if (user?.code !== 200) throw new Error(user?.message || "登录状态暂不可用，请稍后再试。");
  if (user.data?.islogin !== 1) throw new Error("请先登录虎扑，再分享阵容。");
  const audit = await sdk.security.checkAudit(`${draft.title}\n${draft.content}`);
  if (audit?.code === 401) throw new Error(audit.message || "请先登录虎扑，再分享阵容。");
  if (audit?.code !== 200) throw new Error(audit?.message || "内容检查暂不可用，请稍后再试。");
  if (audit.data === false) throw new Error("发帖内容未通过虎扑审核，暂时无法分享。");
  if (audit.data !== true) throw new Error("虎扑未返回明确的审核结果，请稍后重试。");
}
