import { afterEach, describe, expect, it, vi } from "vitest";
import { createCareer } from "../game/season/career";
import { loadCareerRank } from "./leaderboardClient";

afterEach(() => vi.unstubAllGlobals());

describe("career leaderboard rank", () => {
  it("submits the current career before showing a new account rank", async () => {
    const calls: string[] = [];
    const request = vi.fn(async ({ url, method }: { url: string; method?: string }) => {
      calls.push(`${method || "GET"} ${url}`);
      if (url.endsWith("/leaderboard/me")) {
        const mine = calls.length > 1 ? { id: 8, rank: 23, score: 0, displayName: "海潮经理" } : null;
        return { statusCode: 200, code: 0, data: mine };
      }
      return { statusCode: 200, code: 0, data: { score: 0 } };
    });
    vi.stubGlobal("window", { ACTIVITY_API_BASE: "https://example.test/api", ACTIVITY_ENV_ID: "env", ColorboxAI: { cloud: { request } } });

    const result = await loadCareerRank(createCareer("career-rank-sync"));

    expect(calls).toEqual([
      "GET https://example.test/api/leaderboard/me",
      "POST https://example.test/api/leaderboard/submit",
      "GET https://example.test/api/leaderboard/me",
    ]);
    expect(result.mine?.rank).toBe(23);
  });

  it("keeps an existing rank visible when score sync is delayed", async () => {
    const request = vi.fn(async ({ url }: { url: string }) => {
      if (url.endsWith("/leaderboard/me")) return { statusCode: 200, code: 0, data: { id: 4, rank: 12, score: 0, displayName: "海潮经理" } };
      return { statusCode: 429, code: 429, message: "请一分钟后重试" };
    });
    vi.stubGlobal("window", { ACTIVITY_API_BASE: "https://example.test/api", ACTIVITY_ENV_ID: "env", ColorboxAI: { cloud: { request } } });
    const state = createCareer("career-rank-pending");
    state.gmCareer.dynastyScore = 1;

    const result = await loadCareerRank(state);

    expect(result.mine?.rank).toBe(12);
    expect(result.notice).toContain("请一分钟后重试");
  });
});
