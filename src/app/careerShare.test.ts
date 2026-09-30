import { afterEach, describe, expect, it, vi } from "vitest";
import { getCareerOverview, getFranchiseRecords } from "../game/career/CareerRecords";
import { createCareer } from "../game/season/career";
import { careerPostDraft, openCareerPostEditor } from "./careerShare";

afterEach(() => vi.unstubAllGlobals());

describe("career post sharing", () => {
  it("builds an editable post from the current career record", () => {
    const state = createCareer("career-page-progress");
    state.standings[state.userTeamId].wins = 3;
    state.standings[state.userTeamId].losses = 2;
    state.gmCareer.dynastyScore = 1234;
    const draft = careerPostDraft(state, getCareerOverview(state), getFranchiseRecords(state), "队史首胜");

    expect(draft.title).toContain("3胜2负");
    expect(draft.title).toContain(`王朝积分${state.gmCareer.dynastyScore}`);
    expect(draft.content).toContain(`王朝积分${state.gmCareer.dynastyScore}`);
    expect(draft.content).toContain("《篮球经理：联盟扩军时代》");
    expect(draft.content).toContain("最新里程碑：队史首胜");
    expect(draft.content).toContain(state.teams[state.userTeamId].fullName);
  });

  it("opens the Hupu post editor only through its SDK and reports rejected responses", async () => {
    const draft = { title: "生涯战报", content: "3胜2负" };
    const poster = new Blob(["poster"], { type: "image/png" });
    const uploadFile = vi.fn().mockResolvedValue({ downloadUrl: "https://cdn.example.test/poster.png" });
    const openPostEditor = vi.fn().mockResolvedValueOnce({ code: 200, message: "OK" })
      .mockResolvedValueOnce({ code: 503, message: "服务暂不可用" });
    vi.stubGlobal("window", { ColorboxAI: { request: { bbs: { openPostEditor } }, oss: { uploadFile } } });

    await expect(openCareerPostEditor(draft, poster)).resolves.toBeUndefined();
    expect(uploadFile).toHaveBeenCalledWith({ file: poster, filename: expect.stringMatching(/^basketball-manager-career-\d+\.png$/) });
    expect(openPostEditor).toHaveBeenCalledWith({
      ...draft,
      imageUrl: "https://cdn.example.test/poster.png",
      topicId: "871",
      tagId: "157696",
      topicName: "AI工坊",
      tagName: "篮球经理：联盟扩军时代",
    });
    await expect(openCareerPostEditor(draft, poster)).rejects.toThrow("服务暂不可用");
  });

  it("never opens the editor when upload fails or returns an unsafe URL", async () => {
    const poster = new Blob(["poster"], { type: "image/png" });
    const openPostEditor = vi.fn();
    const uploadFile = vi.fn().mockResolvedValueOnce({ downloadUrl: "javascript:alert(1)" })
      .mockRejectedValueOnce(new Error("未登录或登录态失效"));
    vi.stubGlobal("window", { ColorboxAI: { request: { bbs: { openPostEditor } }, oss: { uploadFile } } });
    await expect(openCareerPostEditor({ title: "战报", content: "正文" }, poster)).rejects.toThrow("海报上传失败");
    await expect(openCareerPostEditor({ title: "战报", content: "正文" }, poster)).rejects.toThrow("未登录");
    expect(openPostEditor).not.toHaveBeenCalled();
  });

  it("explains why posting is unavailable outside Hupu", async () => {
    vi.stubGlobal("window", {});
    await expect(openCareerPostEditor({ title: "生涯战报", content: "正文" }, new Blob())).rejects.toThrow("虎扑 App");
  });
});
