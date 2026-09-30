import { afterEach, describe, expect, it, vi } from "vitest";
import { openTeamNameContribution, teamNameContributionDraft } from "./teamNameContribution";

afterEach(() => vi.unstubAllGlobals());

function mockBridge() {
  const getUserInfo = vi.fn().mockResolvedValue({ code: 200, data: { puid: "player-id", islogin: 1, nickname: "Private nickname", authToken: "Private token" } });
  const openPostEditor = vi.fn().mockResolvedValue({ code: 200, message: "OK" });
  vi.stubGlobal("window", { ColorboxAI: { auth: { getUserInfo }, request: { bbs: { openPostEditor } } } });
  return { getUserInfo, openPostEditor };
}

describe("team name community contribution", () => {
  it.each([
    ["LVG", "拉斯维加斯", "闪电、幻影、毒蛇、皇家、霓虹、毒液"],
    ["SEA", "西雅图", "超音速、翡翠、领航者、虎鲸、登山者、大脚怪"],
  ] as const)("builds an editable draft for %s", (cityId, cityName, names) => {
    const draft = teamNameContributionDraft(cityId);
    expect(draft.title).toContain(cityName);
    expect(draft.content).toContain(names);
    expect(draft.content).toContain("我的建议队名：（请填写）");
    expect(draft.content).toContain("创意来源与寓意：（请填写）");
  });

  it("opens the configured community editor after login without private profile fields", async () => {
    const { getUserInfo, openPostEditor } = mockBridge();
    await expect(openTeamNameContribution("SEA")).resolves.toBeUndefined();
    expect(getUserInfo).toHaveBeenCalledOnce();
    expect(openPostEditor).toHaveBeenCalledExactlyOnceWith({
      topicId: "871", tagId: "157696", topicName: "AI工坊", tagName: "篮球经理：联盟扩军时代",
      ...teamNameContributionDraft("SEA"),
    });
    expect(JSON.stringify(openPostEditor.mock.calls)).not.toMatch(/player-id|Private nickname|Private token|imageUrl/);
  });

  it.each([null, { islogin: 0, puid: "guest" }, { islogin: 1 }])("requires a logged-in account", async (data) => {
    const { getUserInfo, openPostEditor } = mockBridge();
    getUserInfo.mockResolvedValue({ code: 200, data });
    await expect(openTeamNameContribution("LVG")).rejects.toThrow("请先登录虎扑账号");
    expect(openPostEditor).not.toHaveBeenCalled();
  });

  it("preserves a failed login check message and does not launch the editor", async () => {
    const { getUserInfo, openPostEditor } = mockBridge();
    getUserInfo.mockResolvedValue({ code: 503, message: "登录服务暂不可用" });
    await expect(openTeamNameContribution("SEA")).rejects.toThrow("登录服务暂不可用");
    expect(getUserInfo).toHaveBeenCalledOnce();
    expect(openPostEditor).not.toHaveBeenCalled();
  });

  it.each([408, 429, 503])("reports editor error %s without retrying", async (code) => {
    const { openPostEditor } = mockBridge();
    openPostEditor.mockResolvedValue({ code, message: "请稍后再试" });
    await expect(openTeamNameContribution("SEA")).rejects.toThrow("请稍后再试");
    expect(openPostEditor).toHaveBeenCalledOnce();
  });

  it("provides a fallback when the editor response has no message", async () => {
    const { openPostEditor } = mockBridge();
    openPostEditor.mockResolvedValue({ code: 500 });
    await expect(openTeamNameContribution("SEA")).rejects.toThrow("发帖编辑器暂时无法打开");
  });

  it("explains unavailable app capabilities", async () => {
    vi.stubGlobal("window", {});
    await expect(openTeamNameContribution("LVG")).rejects.toThrow("虎扑 App");
  });

  it("does not start a cancelled contribution", async () => {
    const { getUserInfo, openPostEditor } = mockBridge();
    const controller = new AbortController();
    controller.abort();
    await expect(openTeamNameContribution("SEA", controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(getUserInfo).not.toHaveBeenCalled();
    expect(openPostEditor).not.toHaveBeenCalled();
  });

  it("does not open the editor when the page leaves during login", async () => {
    const { getUserInfo, openPostEditor } = mockBridge();
    let resolveLogin!: (value: { code: number; data: { puid: string } }) => void;
    getUserInfo.mockImplementation(() => new Promise((resolve) => { resolveLogin = resolve; }));
    const controller = new AbortController();
    const pending = openTeamNameContribution("SEA", controller.signal);
    controller.abort();
    resolveLogin({ code: 200, data: { puid: "player-id" } });
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(openPostEditor).not.toHaveBeenCalled();
  });

  it("propagates SDK failures without opening the editor", async () => {
    const { getUserInfo, openPostEditor } = mockBridge();
    getUserInfo.mockRejectedValue(new Error("网络异常"));
    await expect(openTeamNameContribution("SEA")).rejects.toThrow("网络异常");
    expect(openPostEditor).not.toHaveBeenCalled();
  });
});
