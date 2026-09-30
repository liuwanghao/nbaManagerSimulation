import { afterEach, describe, expect, it, vi } from "vitest";
import { createCareer } from "../game/season/career";
import { buildDefaultRotationPlan } from "../game/roster/RotationPlanService";
import { openPosterPostEditor } from "./careerShare";
import { playerNameZh } from "./playerNameZh";
import { rosterPostDraft, validateRosterPost } from "./rosterShare";

afterEach(() => vi.unstubAllGlobals());

function mockBridge() {
  const getUserInfo = vi.fn<() => Promise<{ code: number; message?: string; data?: { islogin: number; puid?: string; authToken?: string } }>>()
    .mockResolvedValue({ code: 200, data: { islogin: 1, puid: "private-id", authToken: "private-token" } });
  const checkAudit = vi.fn<() => Promise<{ code: number; message?: string; data?: boolean | null }>>().mockResolvedValue({ code: 200, data: true });
  const uploadFile = vi.fn().mockResolvedValue({ downloadUrl: "https://cdn.example.test/roster.png" });
  const openPostEditor = vi.fn<() => Promise<{ code: number; message?: string } | undefined>>().mockResolvedValue({ code: 200 });
  vi.stubGlobal("window", { ColorboxAI: { auth: { getUserInfo }, security: { checkAudit }, oss: { uploadFile }, request: { bbs: { openPostEditor } } } });
  return { getUserInfo, checkAudit, uploadFile, openPostEditor };
}

describe("roster post sharing", () => {
  it("includes only the five starters in the current unsaved rotation draft", () => {
    const state = createCareer("roster-post");
    const team = state.teams[state.userTeamId];
    const players = team.playerIds.map((id) => state.players[id]);
    const plan = buildDefaultRotationPlan(players);
    const savedStarter = plan.starters.PG;
    const reserve = players.find((player) => !Object.values(plan.starters).includes(player.id))!;
    team.rotationPlan = structuredClone(plan);
    plan.starters.PG = reserve.id;
    const draft = rosterPostDraft({ team, players, plan, seasonId: state.league.seasonId });
    expect(draft.title).toBe(`${team.fullName}的首发五虎`);
    for (const id of Object.values(plan.starters)) {
      const player = players.find((candidate) => candidate.id === id)!;
      expect(draft.content).toContain(playerNameZh(player.name, player.id));
    }
    expect(draft.content).not.toContain(playerNameZh(players.find((player) => player.id === savedStarter)!.name, savedStarter));
    expect(draft.content).toContain(`PG ${playerNameZh(reserve.name, reserve.id)} · 能力`);
    expect(draft.content).toContain(state.league.seasonId);
    expect(draft.content).not.toContain("替补");
    expect(draft.content).not.toContain("分钟");
    expect(draft.content.split("\n\n")).toHaveLength(6);
  });

  it("checks login and custom team text before uploading, without exposing user credentials", async () => {
    const bridge = mockBridge();
    const draft = { title: "自定义球队首发五虎", content: "五名首发" };
    const poster = new Blob(["poster"], { type: "image/png" });
    await validateRosterPost(draft);
    expect(bridge.checkAudit).toHaveBeenCalledWith(`${draft.title}\n${draft.content}`);
    expect(bridge.uploadFile).not.toHaveBeenCalled();
    const stages: string[] = [];
    await openPosterPostEditor(draft, poster, "roster", (stage) => stages.push(stage));
    expect(stages).toEqual(["uploading", "opening"]);
    expect(bridge.uploadFile).toHaveBeenCalledWith({ file: poster, filename: expect.stringMatching(/^basketball-manager-roster-\d+\.png$/) });
    expect(bridge.openPostEditor).toHaveBeenCalledWith({ ...draft, imageUrl: "https://cdn.example.test/roster.png",
      topicId: "871", tagId: "157696", topicName: "AI工坊", tagName: "篮球经理：联盟扩军时代" });
    expect(JSON.stringify(bridge.openPostEditor.mock.calls)).not.toMatch(/private-id|private-token/);
  });

  it("blocks logged-out users and unsafe or failed audits", async () => {
    const bridge = mockBridge();
    const draft = { title: "阵容", content: "队名" };
    bridge.getUserInfo.mockResolvedValueOnce({ code: 200, data: { islogin: 0, puid: "", authToken: "" } });
    await expect(validateRosterPost(draft)).rejects.toThrow("请先登录");
    expect(bridge.checkAudit).not.toHaveBeenCalled();
    bridge.checkAudit.mockResolvedValueOnce({ code: 200, data: false });
    await expect(validateRosterPost(draft)).rejects.toThrow("未通过虎扑审核");
    bridge.checkAudit.mockResolvedValueOnce({ code: 503, data: true });
    await expect(validateRosterPost(draft)).rejects.toThrow("内容检查暂不可用");
    expect(bridge.uploadFile).not.toHaveBeenCalled();
    expect(bridge.openPostEditor).not.toHaveBeenCalled();
  });

  it.each([undefined, null])("distinguishes missing audit results from content rejection (%s)", async (data) => {
    const bridge = mockBridge();
    bridge.checkAudit.mockResolvedValueOnce({ code: 200, data });
    await expect(validateRosterPost({ title: "首发五虎", content: "五名首发" })).rejects.toThrow("未返回明确的审核结果");
    expect(bridge.uploadFile).not.toHaveBeenCalled();
    expect(bridge.openPostEditor).not.toHaveBeenCalled();
  });

  it("reports SDK absence and login service errors", async () => {
    const bridge = mockBridge();
    bridge.getUserInfo.mockResolvedValueOnce({ code: 429, message: "请求过于频繁" });
    await expect(validateRosterPost({ title: "阵容", content: "正文" })).rejects.toThrow("请求过于频繁");
    expect(bridge.checkAudit).not.toHaveBeenCalled();
    vi.stubGlobal("window", {});
    await expect(validateRosterPost({ title: "阵容", content: "正文" })).rejects.toThrow("虎扑 App");
  });

  it("stops after empty, oversized, missing or insecure images and upload errors", async () => {
    const bridge = mockBridge();
    const draft = { title: "阵容", content: "正文" };
    await expect(openPosterPostEditor(draft, new Blob(), "roster")).rejects.toThrow("海报生成失败");
    await expect(openPosterPostEditor(draft, new Blob([new Uint8Array(10 * 1024 * 1024 + 1)]), "roster")).rejects.toThrow("10MB");
    expect(bridge.uploadFile).not.toHaveBeenCalled();
    const poster = new Blob(["poster"]);
    for (const url of ["", "http://cdn.example.test/p.png", "javascript:alert(1)"]) {
      bridge.uploadFile.mockResolvedValueOnce({ downloadUrl: url });
      await expect(openPosterPostEditor(draft, poster, "roster")).rejects.toThrow("海报上传失败");
    }
    bridge.uploadFile.mockRejectedValueOnce(new Error("未登录或登录态失效"));
    await expect(openPosterPostEditor(draft, poster, "roster")).rejects.toThrow("未登录");
    expect(bridge.openPostEditor).not.toHaveBeenCalled();
  });

  it("reports a cancelled editor or empty response without automatic retry", async () => {
    const bridge = mockBridge();
    bridge.openPostEditor.mockResolvedValueOnce({ code: 499, message: "已取消发帖" });
    await expect(openPosterPostEditor({ title: "阵容", content: "正文" }, new Blob(["poster"]), "roster")).rejects.toThrow("已取消发帖");
    expect(bridge.uploadFile).toHaveBeenCalledTimes(1);
    expect(bridge.openPostEditor).toHaveBeenCalledTimes(1);
    bridge.openPostEditor.mockResolvedValueOnce(undefined);
    await expect(openPosterPostEditor({ title: "阵容", content: "正文" }, new Blob(["poster"]), "roster")).rejects.toThrow("发帖编辑器暂时无法打开");
  });

  it("can stop opening the editor if the overview was closed during upload", async () => {
    const bridge = mockBridge();
    await expect(openPosterPostEditor({ title: "阵容", content: "正文" }, new Blob(["poster"]), "roster", (stage) => {
      if (stage === "opening") throw new Error("阵容分享已取消。");
    })).rejects.toThrow("已取消");
    expect(bridge.uploadFile).toHaveBeenCalledTimes(1);
    expect(bridge.openPostEditor).not.toHaveBeenCalled();
  });
});
