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
    expect(draft.content).toContain("最新里程碑：队史首胜");
    expect(draft.content).toContain(state.teams[state.userTeamId].fullName);
  });

  it("opens the Hupu post editor only through its SDK and reports rejected responses", async () => {
    const draft = { title: "生涯战报", content: "3胜2负" };
    const openPostEditor = vi.fn().mockResolvedValueOnce({ code: 200, message: "OK" })
      .mockResolvedValueOnce({ code: 503, message: "服务暂不可用" });
    vi.stubGlobal("window", { ColorboxAI: { request: { bbs: { openPostEditor } } } });

    await expect(openCareerPostEditor(draft)).resolves.toBeUndefined();
    expect(openPostEditor).toHaveBeenCalledWith(draft);
    await expect(openCareerPostEditor(draft)).rejects.toThrow("服务暂不可用");
  });

  it("explains why posting is unavailable outside Hupu", async () => {
    vi.stubGlobal("window", {});
    await expect(openCareerPostEditor({ title: "生涯战报", content: "正文" })).rejects.toThrow("虎扑 App");
  });
});
