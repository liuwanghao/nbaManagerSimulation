import activity from "../../activity.json";

const FEEDBACK_API_BASE = "https://feedback-public-d8fnf79rd0e395c3-1252166086.ap-shanghai.app.tcloudbase.com/api";
const FEEDBACK_ENV_ID = "feedback-public-d8fnf79rd0e395c3";

interface UserInfoResponse {
  code: number;
  message?: string;
  data?: { islogin?: number; nickname?: string; avatar?: string; userHeadUrl?: string } | null;
}

interface AuditResponse { code: number; data?: boolean | null }
interface FeedbackResponse { statusCode: number; code?: number; message?: string }

interface FeedbackBridge {
  auth: { getUserInfo: () => Promise<UserInfoResponse> };
  security: { checkAudit: (content: string) => Promise<AuditResponse> };
  cloud: { request: (params: {
    url: string;
    method: "POST";
    envId: string;
    auth: true;
    data: { applicationId: string; content: string; nickname?: string; avatarUrl?: string };
  }) => Promise<FeedbackResponse> };
}

export const feedbackContentLength = (value: string): number => Array.from(value.trim()).length;

export async function submitUserFeedback(rawContent: string): Promise<void> {
  const content = rawContent.trim();
  const length = feedbackContentLength(content);
  if (length < 1 || length > 2000) throw new Error("请输入 1–2000 个字符的反馈内容");
  if (!/^app_[0-9a-f]{10}$/u.test(activity.activityId)) throw new Error("反馈服务尚未配置，请稍后再试");
  const bridge = (window as Window & { ColorboxAI?: Partial<FeedbackBridge> }).ColorboxAI;
  if (!bridge?.auth?.getUserInfo || !bridge.security?.checkAudit || !bridge.cloud?.request) {
    throw new Error("请在支持反馈功能的虎扑 App 内打开");
  }

  const userInfo = await bridge.auth.getUserInfo();
  if (userInfo.code !== 200) throw new Error(userInfo.message || "登录状态暂不可用，请稍后再试");
  if (userInfo.data?.islogin !== 1) throw new Error("请先登录后再提交反馈");

  const audit = await bridge.security.checkAudit(content);
  if (audit.code === 401) throw new Error("请先登录后再提交反馈");
  if (audit.code !== 200) throw new Error("内容安全检测暂不可用，请稍后再试");
  if (audit.data !== true) throw new Error("反馈内容包含不适宜提交的信息，请修改后再试");

  const data: { applicationId: string; content: string; nickname?: string; avatarUrl?: string } = {
    applicationId: activity.activityId,
    content,
  };
  const nickname = typeof userInfo.data.nickname === "string" ? userInfo.data.nickname.trim() : "";
  const avatar = typeof userInfo.data.avatar === "string" && userInfo.data.avatar.trim()
    || typeof userInfo.data.userHeadUrl === "string" && userInfo.data.userHeadUrl.trim() || "";
  if (nickname) data.nickname = nickname;
  if (avatar.startsWith("https://")) data.avatarUrl = avatar;

  let response: FeedbackResponse;
  try {
    response = await bridge.cloud.request({
      url: `${FEEDBACK_API_BASE}/feedback`, method: "POST", data, envId: FEEDBACK_ENV_ID, auth: true,
    });
  } catch {
    throw new Error("提交结果暂不确定，请稍后确认未成功后再试");
  }
  if (response.statusCode === 201 && response.code === 0) return;
  if (response.statusCode === 401) throw new Error("登录状态已失效，请重新登录后提交");
  if (response.statusCode === 413) throw new Error("反馈内容过长，请精简后提交");
  if (response.statusCode === 429) throw new Error("提交过于频繁，请稍后再试");
  if (response.statusCode === 400) throw new Error(response.message || "反馈内容不符合要求");
  throw new Error("提交结果暂不确定，请稍后确认未成功后再试");
}
