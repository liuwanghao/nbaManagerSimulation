import { afterEach, describe, expect, it, vi } from "vitest";
import { createCareer } from "../game/season/career";
import { createLeaderboardProof } from "./leaderboardProof";
import { loadCareerRank, requestForLeaderboardFrame } from "./leaderboardClient";

const mine = { id: "8", rank: 23, score: 0, displayName: "虎扑玩家", avatarUrl: "https://example.test/avatar.png", teamName: "西雅图超音速", teamLogo: "./expansion-logos/seattle-default.png", seasonId: "2026-27", title: "新手经理" };
function setup(request: ReturnType<typeof vi.fn>, puid = "user-1") {
  const getUserInfo = vi.fn(async () => ({ code: 200, data: { puid, nickname: "虎扑玩家", avatar: mine.avatarUrl, islogin: 1 } }));
  vi.stubGlobal("window", { ACTIVITY_API_BASE: "https://example.test/api", ACTIVITY_ENV_ID: "env", ColorboxAI: { cloud: { request }, auth: { getUserInfo } } });
  return getUserInfo;
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("career leaderboard rank", () => {
  it("submits profile and proof once and uses the returned rank without a second GET", async () => {
    const request = vi.fn(async (_options: { url: string; data?: Record<string, unknown> }) => ({ statusCode: 200, code: 0, data: mine }));
    setup(request);
    const state = createCareer("career-rank-sync");
    expect((await loadCareerRank(state)).mine?.rank).toBe(23);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toMatchObject({ method: "POST", auth: true, data: { displayName: "虎扑玩家", avatarUrl: mine.avatarUrl, proof: { teamName: state.teams[state.userTeamId].fullName, teamLogo: state.teams[state.userTeamId].logoUrl ?? "", seasonId: state.league.seasonId, title: "新手经理" } } });
  });

  it("reuses the same progress across career and embedded page and merges concurrent submissions", async () => {
    const request = vi.fn(async (_options: { url: string; data?: Record<string, unknown> }) => ({ statusCode: 200, code: 0, data: mine }));
    setup(request);
    const state = createCareer("career-rank-cache");
    await Promise.all([loadCareerRank(state), loadCareerRank(state)]);
    await requestForLeaderboardFrame("submit", { proof: createLeaderboardProof(state), displayName: "虎扑经理" });
    expect(await requestForLeaderboardFrame("mine")).toEqual(mine);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("resyncs changed season data even when the score is unchanged", async () => {
    const request = vi.fn(async (_options: { url: string; data?: Record<string, unknown> }) => ({ statusCode: 200, code: 0, data: mine }));
    setup(request);
    const state = createCareer("career-rank-season");
    await loadCareerRank(state);
    state.league.seasonId = "2027-28";
    await loadCareerRank(state);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("expires rank cache and honors explicit refresh", async () => {
    vi.useFakeTimers();
    const request = vi.fn(async (_options: { url: string; data?: Record<string, unknown> }) => ({ statusCode: 200, code: 0, data: mine }));
    setup(request);
    const state = createCareer("career-rank-expiry");
    await loadCareerRank(state);
    await requestForLeaderboardFrame("mine", { force: true });
    await loadCareerRank(state);
    vi.advanceTimersByTime(30_001);
    await loadCareerRank(state);
    expect(request).toHaveBeenCalledTimes(4);
  });

  it("isolates personal results when the logged-in account changes", async () => {
    const request = vi.fn(async (_options: { url: string; data?: Record<string, unknown> }) => ({ statusCode: 200, code: 0, data: mine }));
    const getUserInfo = setup(request);
    const state = createCareer("career-rank-account");
    await loadCareerRank(state);
    getUserInfo.mockResolvedValue({ code: 200, data: { puid: "user-2", nickname: "另一个玩家", avatar: "", islogin: 1 } });
    await loadCareerRank(state);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1][0].data?.displayName).toBe("另一个玩家");
  });

  it("keeps the previous rank visible when score sync is delayed and retries next time", async () => {
    const request = vi.fn(async ({ url }: { url: string }) => url.endsWith("/leaderboard/me")
      ? { statusCode: 200, code: 0, data: mine }
      : { statusCode: 429, code: 429, message: "请一分钟后重试" });
    setup(request);
    const state = createCareer("career-rank-pending");
    state.gmCareer.dynastyScore = 1;
    const result = await loadCareerRank(state);
    expect(result.mine?.rank).toBe(23);
    expect(result.notice).toContain("请一分钟后重试");
    await loadCareerRank(state);
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("shows native player identity and local career fields with the old API while flagging unsaved profile", async () => {
    const oldMine = { id: "8", rank: 23, score: 0, displayName: "旧的球队经理" };
    const request = vi.fn(async ({ url }: { url: string }) => ({ statusCode: 200, code: 0, data: url.endsWith("/leaderboard/me") ? oldMine : { score: 0 } }));
    setup(request);
    const state = createCareer("old-api");
    const result = await loadCareerRank(state);
    expect(result.mine).toMatchObject({ ...oldMine, displayName: "虎扑玩家", avatarUrl: mine.avatarUrl, teamName: state.teams[state.userTeamId].fullName, title: "新手经理", profileSynced: false });
    expect(result.notice).toContain("云端榜单资料尚未启用");
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("never submits a placeholder identity when the native profile API is unavailable", async () => {
    const request = vi.fn(async (_options: { url: string; method?: string }) => ({ statusCode: 200, code: 0, data: mine }));
    vi.stubGlobal("window", { ACTIVITY_API_BASE: "https://example.test/api", ACTIVITY_ENV_ID: "env", ColorboxAI: { cloud: { request } } });
    const result = await loadCareerRank(createCareer("no-profile-sdk"));
    expect(result.mine?.rank).toBe(23);
    expect(result.notice).toContain("虎扑资料接口暂不可用");
    expect(request.mock.calls.every(([options]) => options.method === "GET")).toBe(true);
    await expect(requestForLeaderboardFrame("submit", { proof: { score: 0 } })).rejects.toThrow("虎扑资料接口暂不可用");
  });

  it("reports native errors and does not submit when profile lookup fails", async () => {
    const request = vi.fn(async (_options: { url: string; method?: string }) => ({ statusCode: 200, code: 0, data: mine }));
    vi.stubGlobal("window", { ACTIVITY_API_BASE: "https://example.test/api", ACTIVITY_ENV_ID: "env", ColorboxAI: { cloud: { request }, auth: { getUserInfo: async () => ({ code: 500, message: "宿主资料读取失败" }) } } });
    const result = await loadCareerRank(createCareer("profile-error"));
    expect(result.notice).toContain("宿主资料读取失败");
    expect(request.mock.calls.every(([options]) => options.method === "GET")).toBe(true);
  });

});

describe("embedded leaderboard requests", () => {
  it("deduplicates and caches the public top100 without login and supports refresh", async () => {
    const request = vi.fn(async (_options: { url: string; data?: Record<string, unknown> }) => ({ statusCode: 200, code: 0, data: [{ rank: 1, score: 50 }] }));
    const getUserInfo = setup(request);
    await Promise.all([requestForLeaderboardFrame("list"), requestForLeaderboardFrame("list")]);
    expect(await requestForLeaderboardFrame("list")).toEqual([{ rank: 1, score: 50 }]);
    expect(request).toHaveBeenCalledTimes(1);
    expect(getUserInfo).not.toHaveBeenCalled();
    expect(request.mock.calls[0][0]).toEqual({ url: "https://example.test/api/leaderboard", method: "GET", data: { limit: 100 } });
    await requestForLeaderboardFrame("list", { force: true });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("does not let a pre-submit list overwrite the refreshed cache", async () => {
    let finishOld!: (response: { statusCode: number; code: number; data: unknown }) => void;
    const old = new Promise<{ statusCode: number; code: number; data: unknown }>((resolve) => { finishOld = resolve; });
    const fresh = [{ id: "new", rank: 1, score: 50 }];
    let lists = 0;
    const request = vi.fn(async ({ url }: { url: string }) => {
      if (url.endsWith("/leaderboard")) return ++lists === 1 ? old : { statusCode: 200, code: 0, data: fresh };
      return { statusCode: 200, code: 0, data: mine };
    });
    setup(request);
    const pending = requestForLeaderboardFrame("list");
    await loadCareerRank(createCareer("career-list-race"));
    expect(await requestForLeaderboardFrame("list")).toEqual(fresh);
    finishOld({ statusCode: 200, code: 0, data: [] });
    await pending;
    expect(await requestForLeaderboardFrame("list")).toEqual(fresh);
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("does not cache public request errors", async () => {
    const request = vi.fn().mockResolvedValueOnce({ statusCode: 500, code: 500 }).mockResolvedValue({ statusCode: 200, code: 0, data: [] });
    setup(request);
    await expect(requestForLeaderboardFrame("list")).rejects.toThrow();
    expect(await requestForLeaderboardFrame("list")).toEqual([]);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("rejects unsupported actions and invalid submissions", async () => {
    const request = vi.fn();
    setup(request);
    await expect(requestForLeaderboardFrame("/other-api")).rejects.toThrow("不支持的排行榜请求");
    await expect(requestForLeaderboardFrame("submit", [])).rejects.toThrow("成绩数据格式不正确");
    expect(request).not.toHaveBeenCalled();
  });
});
