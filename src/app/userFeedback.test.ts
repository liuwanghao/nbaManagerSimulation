import { afterEach, describe, expect, it, vi } from "vitest";
import { feedbackContentLength, submitUserFeedback } from "./userFeedback";

afterEach(() => vi.unstubAllGlobals());

function mockBridge(options: { loggedIn?: boolean; auditSafe?: boolean; statusCode?: number; code?: number } = {}) {
  const getUserInfo = vi.fn().mockResolvedValue({
    code: 200,
    data: options.loggedIn === false ? { islogin: 0 } : {
      islogin: 1, nickname: "测试经理", avatar: "https://example.com/avatar.png", puid: "must-not-submit",
    },
  });
  const checkAudit = vi.fn().mockResolvedValue({ code: 200, data: options.auditSafe !== false });
  const request = vi.fn().mockResolvedValue({ statusCode: options.statusCode ?? 201, code: options.code ?? 0 });
  vi.stubGlobal("window", { ColorboxAI: { auth: { getUserInfo }, security: { checkAudit }, cloud: { request } } });
  return { getUserInfo, checkAudit, request };
}

describe("user feedback", () => {
  it("counts trimmed Unicode characters and enforces the 2000 character limit", async () => {
    expect(feedbackContentLength("  🏀好  ")).toBe(2);
    expect(feedbackContentLength("🏀".repeat(2000))).toBe(2000);
    await expect(submitUserFeedback("   ")).rejects.toThrow("1–2000");
    await expect(submitUserFeedback("🏀".repeat(2001))).rejects.toThrow("1–2000");
  });

  it("checks login and content safety before sending only approved fields", async () => {
    const bridge = mockBridge();
    await submitUserFeedback("  轮换建议  ");
    expect(bridge.checkAudit).toHaveBeenCalledWith("轮换建议");
    expect(bridge.request).toHaveBeenCalledWith({
      url: "https://feedback-public-d8fnf79rd0e395c3-1252166086.ap-shanghai.app.tcloudbase.com/api/feedback",
      method: "POST", envId: "feedback-public-d8fnf79rd0e395c3", auth: true,
      data: { applicationId: "app_2eeb0a1013", content: "轮换建议", nickname: "测试经理", avatarUrl: "https://example.com/avatar.png" },
    });
  });

  it("blocks unauthenticated and unsafe feedback before the request", async () => {
    const loggedOut = mockBridge({ loggedIn: false });
    await expect(submitUserFeedback("问题反馈")).rejects.toThrow("请先登录");
    expect(loggedOut.request).not.toHaveBeenCalled();
    const unsafe = mockBridge({ auditSafe: false });
    await expect(submitUserFeedback("问题反馈")).rejects.toThrow("不适宜提交");
    expect(unsafe.request).not.toHaveBeenCalled();
  });

  it("does not claim success for rate limits or unavailable Hupu runtime", async () => {
    mockBridge({ statusCode: 429 });
    await expect(submitUserFeedback("问题反馈")).rejects.toThrow("提交过于频繁");
    vi.stubGlobal("window", {});
    await expect(submitUserFeedback("问题反馈")).rejects.toThrow("虎扑 App");
  });
});
