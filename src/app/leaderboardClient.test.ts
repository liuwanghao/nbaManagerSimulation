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
    const getUserInfo = setup(request);
    const state = createCareer("career-rank-cache");
    await Promise.all([loadCareerRank(state), loadCareerRank(state)]);
    expect(getUserInfo).toHaveBeenCalledTimes(1);
    await requestForLeaderboardFrame("submit", { proof: createLeaderboardProof(state), displayName: "虎扑经理" });
    expect(await requestForLeaderboardFrame("mine")).toEqual(mine);
    expect(request).toHaveBeenCalledTimes(1);
    expect(getUserInfo).toHaveBeenCalledTimes(3);
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

  it("refreshes expired ranks with GET and preserves the submitted proof after manual refresh", async () => {
    vi.useFakeTimers();
    const request = vi.fn(async (_options: { url: string; data?: Record<string, unknown> }) => ({ statusCode: 200, code: 0, data: mine }));
    setup(request);
    const state = createCareer("career-rank-expiry");
    await loadCareerRank(state);
    await requestForLeaderboardFrame("mine", { force: true });
    await loadCareerRank(state);
    vi.advanceTimersByTime(30_001);
    await loadCareerRank(state);
    expect(request.mock.calls.map(([options]) => options)).toMatchObject([
      { method: "POST", url: "https://example.test/api/leaderboard/submit" },
      { method: "GET", url: "https://example.test/api/leaderboard/me" },
      { method: "GET", url: "https://example.test/api/leaderboard/me" },
    ]);
  });

  it("forces a submission even when the same proof was recently synced", async () => {
    const request = vi.fn(async (_options: { url: string; method?: string }) => ({ statusCode: 200, code: 0, data: mine }));
    setup(request);
    const state = createCareer("career-rank-force");
    await loadCareerRank(state);
    await loadCareerRank(state, { force: true });
    expect(request.mock.calls.map(([options]) => options.method)).toEqual(["POST", "POST"]);
  });

  it("resubmits immediately when the verified profile changes on the same account", async () => {
    const request = vi.fn(async (_options: { url: string; data?: Record<string, unknown> }) => ({ statusCode: 200, code: 0, data: mine }));
    const getUserInfo = setup(request);
    const state = createCareer("career-rank-profile");
    await loadCareerRank(state);
    getUserInfo.mockResolvedValue({ code: 200, data: { puid: "user-1", nickname: "新昵称", avatar: "https://example.test/new-avatar.png", islogin: 1 } });
    await loadCareerRank(state);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1][0]).toMatchObject({ method: "POST", data: { displayName: "新昵称", avatarUrl: "https://example.test/new-avatar.png" } });
  });

  it("offers cached rank only after verifying the current account", async () => {
    const request = vi.fn(async (_options: { url: string }) => ({ statusCode: 200, code: 0, data: mine }));
    const getUserInfo = setup(request);
    const state = createCareer("career-rank-verified-cache");
    await loadCareerRank(state);
    let finishProfile!: (profile: Awaited<ReturnType<typeof getUserInfo>>) => void;
    getUserInfo.mockImplementationOnce(() => new Promise((resolve) => { finishProfile = resolve; }));
    const onCached = vi.fn();
    const pending = loadCareerRank(state, { onCached });
    expect(onCached).not.toHaveBeenCalled();
    finishProfile({ code: 200, data: { puid: "user-1", nickname: "虎扑玩家", avatar: mine.avatarUrl, islogin: 1 } });
    await pending;
    expect(onCached).toHaveBeenCalledTimes(1);
    expect(onCached.mock.calls[0][0].mine).toEqual(mine);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("shows stale rank before background GET completes and then returns the updated rank", async () => {
    vi.useFakeTimers();
    let finishRead!: (response: { statusCode: number; code: number; data: typeof mine }) => void;
    const read = new Promise<{ statusCode: number; code: number; data: typeof mine }>((resolve) => { finishRead = resolve; });
    const onCached = vi.fn();
    const request = vi.fn(async ({ url }: { url: string }) => {
      if (url.endsWith("/leaderboard/me")) {
        expect(onCached).toHaveBeenCalledTimes(1);
        expect(onCached.mock.calls[0][0].mine).toEqual(mine);
        return read;
      }
      return { statusCode: 200, code: 0, data: mine };
    });
    setup(request);
    const state = createCareer("career-rank-stale");
    await loadCareerRank(state);
    vi.advanceTimersByTime(30_001);
    const pending = loadCareerRank(state, { onCached });
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    finishRead({ statusCode: 200, code: 0, data: { ...mine, rank: 24 } });
    expect((await pending).mine?.rank).toBe(24);
    expect(request.mock.calls[1][0].url).toBe("https://example.test/api/leaderboard/me");
  });

  it("retains the old rank when background refresh fails and retries GET next time", async () => {
    vi.useFakeTimers();
    const request = vi.fn(async (_options: { url: string; method?: string }) => ({ statusCode: 200, code: 0, data: mine }));
    setup(request);
    const state = createCareer("career-rank-refresh-error");
    await loadCareerRank(state);
    vi.advanceTimersByTime(30_001);
    request.mockResolvedValueOnce({ statusCode: 503, code: 503, data: mine });
    const result = await loadCareerRank(state);
    expect(result.mine).toEqual(mine);
    expect(result.notice).toContain("排行榜暂时无法加载");
    expect(request).toHaveBeenCalledTimes(2);
    await loadCareerRank(state);
    expect(request.mock.calls.map(([options]) => options.method)).toEqual(["POST", "GET", "GET"]);
  });

  it("merges expired career reads and forced embedded personal reads into one GET", async () => {
    vi.useFakeTimers();
    let finishRead!: (response: { statusCode: number; code: number; data: typeof mine }) => void;
    const read = new Promise<{ statusCode: number; code: number; data: typeof mine }>((resolve) => { finishRead = resolve; });
    const request = vi.fn(async ({ url }: { url: string }) => url.endsWith("/leaderboard/me")
      ? read
      : { statusCode: 200, code: 0, data: mine });
    const getUserInfo = setup(request);
    const state = createCareer("career-rank-read-merge");
    await loadCareerRank(state);
    vi.advanceTimersByTime(30_001);
    const careerRead = loadCareerRank(state);
    const embeddedRead = requestForLeaderboardFrame("mine", { force: true });
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    finishRead({ statusCode: 200, code: 0, data: { ...mine, rank: 24 } });
    expect((await careerRead).mine?.rank).toBe(24);
    expect(await embeddedRead).toMatchObject({ rank: 24 });
    expect(request).toHaveBeenCalledTimes(2);
    expect(getUserInfo).toHaveBeenCalledTimes(2);
    await loadCareerRank(state);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("returns the newer submitted rank when an older personal GET finishes afterward", async () => {
    vi.useFakeTimers();
    let finishRead!: (response: { statusCode: number; code: number; data: typeof mine }) => void;
    const read = new Promise<{ statusCode: number; code: number; data: typeof mine }>((resolve) => { finishRead = resolve; });
    const newer = { ...mine, score: 1, rank: 7 };
    let submissions = 0;
    const request = vi.fn(async ({ url }: { url: string }) => {
      if (url.endsWith("/leaderboard/me")) return read;
      return { statusCode: 200, code: 0, data: ++submissions === 1 ? mine : newer };
    });
    setup(request);
    const state = createCareer("career-rank-read-submit-race");
    await loadCareerRank(state);
    vi.advanceTimersByTime(30_001);
    const oldRead = loadCareerRank(state);
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    state.gmCareer.dynastyScore = 1;
    expect((await loadCareerRank(state)).mine).toEqual(newer);
    finishRead({ statusCode: 200, code: 0, data: mine });
    expect((await oldRead).mine).toEqual(newer);
    expect((await loadCareerRank(state)).mine).toEqual(newer);
    expect(request.mock.calls.map(([options]) => options.url)).toEqual([
      "https://example.test/api/leaderboard/submit",
      "https://example.test/api/leaderboard/me",
      "https://example.test/api/leaderboard/submit",
    ]);
  });

  it("resubmits unchanged progress after a personal read reports that the cloud row is absent", async () => {
    vi.useFakeTimers();
    const request = vi.fn(async ({ url }: { url: string; method?: string }) => ({
      statusCode: 200, code: 0, data: url.endsWith("/leaderboard/me") ? null : mine,
    }));
    setup(request);
    const state = createCareer("career-rank-row-missing");
    await loadCareerRank(state);
    vi.advanceTimersByTime(30_001);
    expect((await loadCareerRank(state)).mine).toBeNull();
    expect((await loadCareerRank(state)).mine).toEqual(mine);
    expect(request.mock.calls.map(([options]) => options.method)).toEqual(["POST", "GET", "POST"]);
  });

  it("isolates personal results when the logged-in account changes", async () => {
    const request = vi.fn(async (_options: { url: string; data?: Record<string, unknown> }) => ({ statusCode: 200, code: 0, data: mine }));
    const getUserInfo = setup(request);
    const state = createCareer("career-rank-account");
    await loadCareerRank(state);
    getUserInfo.mockResolvedValue({ code: 200, data: { puid: "user-2", nickname: "另一个玩家", avatar: "", islogin: 1 } });
    const onCached = vi.fn();
    await loadCareerRank(state, { onCached });
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1][0].data?.displayName).toBe("另一个玩家");
    expect(onCached).not.toHaveBeenCalled();
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

  it("preserves native identity and local career fields when refreshing a rank from the old API", async () => {
    vi.useFakeTimers();
    const oldMine = { id: "8", rank: 23, score: 0, displayName: "旧的球队经理" };
    let reads = 0;
    const request = vi.fn(async ({ url }: { url: string; method?: string }) => ({
      statusCode: 200,
      code: 0,
      data: url.endsWith("/leaderboard/me") ? { ...oldMine, rank: ++reads === 1 ? 23 : 24 } : { score: 0 },
    }));
    setup(request);
    const state = createCareer("old-api-refresh");
    state.teams[state.userTeamId].logoUrl = "./expansion-logos/seattle-default.png";
    await loadCareerRank(state);
    vi.advanceTimersByTime(30_001);
    const result = await loadCareerRank(state);
    expect(result.mine).toMatchObject({
      ...oldMine,
      rank: 24,
      displayName: "虎扑玩家",
      avatarUrl: mine.avatarUrl,
      teamName: state.teams[state.userTeamId].fullName,
      teamLogo: state.teams[state.userTeamId].logoUrl ?? "",
      seasonId: state.league.seasonId,
      title: "新手经理",
      profileSynced: false,
    });
    expect(result.notice).toContain("云端榜单资料尚未启用");
    expect(request.mock.calls.map(([options]) => options.method)).toEqual(["POST", "GET", "GET"]);
  });

  it("never submits a placeholder identity when the native profile API is unavailable", async () => {
    const request = vi.fn(async (_options: { url: string; method?: string }) => ({ statusCode: 200, code: 0, data: mine }));
    vi.stubGlobal("window", { ACTIVITY_API_BASE: "https://example.test/api", ACTIVITY_ENV_ID: "env", ColorboxAI: { cloud: { request } } });
    const result = await loadCareerRank(createCareer("no-profile-sdk"));
    expect(result.mine?.rank).toBe(23);
    expect(result.notice).toContain("虎扑资料接口暂不可用");
    expect(request.mock.calls.every(([options]) => options.method === "GET")).toBe(true);
    const onCached = vi.fn();
    await loadCareerRank(createCareer("no-profile-sdk"), { onCached });
    expect(request).toHaveBeenCalledTimes(2);
    expect(onCached).not.toHaveBeenCalled();
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
