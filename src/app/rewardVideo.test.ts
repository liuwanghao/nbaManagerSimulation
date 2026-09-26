import { describe, expect, it, vi } from "vitest";
import { runRewardedAction, watchRewardVideo } from "./rewardVideo";

describe("reward video gate", () => {
  it("releases the action only after the bridge confirms a completed reward", async () => {
    const refreshState = vi.fn(async () => undefined);
    const confirmed = await watchRewardVideo({
      completeRewardVideo: async () => ({ code: 200, data: { rewarded: true } }),
      getActivityTaskState: refreshState,
    });
    expect(confirmed.rewarded).toBe(true);
    expect(refreshState).toHaveBeenCalledOnce();
    expect((await watchRewardVideo({ completeRewardVideo: async () => ({ code: 200, data: { rewarded: false } }) })).rewarded).toBe(false);
    expect((await watchRewardVideo(undefined)).rewarded).toBe(false);
  });

  it("allows only one video flow at a time and releases the lock after failure", async () => {
    let finish!: (value: { code: number; data: { rewarded: boolean } }) => void;
    const first = watchRewardVideo({ completeRewardVideo: () => new Promise((resolve) => { finish = resolve; }) });
    expect((await watchRewardVideo({ completeRewardVideo: async () => ({ code: 200, data: { rewarded: true } }) })).rewarded).toBe(false);
    finish({ code: 403, data: { rewarded: false } });
    expect((await first).rewarded).toBe(false);
    expect((await watchRewardVideo({ completeRewardVideo: async () => ({ code: 200, data: { rewarded: true } }) })).rewarded).toBe(true);
  });

  it("runs the trade refresh only after confirmed completion", async () => {
    const refreshTrade = vi.fn(async () => undefined);
    await runRewardedAction({ completeRewardVideo: async () => ({ code: 200, data: { rewarded: false } }) }, refreshTrade);
    await runRewardedAction(undefined, refreshTrade);
    expect(refreshTrade).not.toHaveBeenCalled();
    await runRewardedAction({ completeRewardVideo: async () => ({ code: 200, data: { rewarded: true } }) }, refreshTrade);
    expect(refreshTrade).toHaveBeenCalledOnce();
  });
});
