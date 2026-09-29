import { afterEach, describe, expect, it, vi } from "vitest";
import { hasConfirmedLotteryReward, runLotteryRerollWithReward } from "./lotteryReward";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

afterEach(() => {
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

describe("rewarded lottery reroll", () => {
  it("keeps a confirmed video reward across a page reload when saving the reroll fails", async () => {
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, "window", { configurable: true, value: {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => { values.set(key, value); },
        removeItem: (key: string) => { values.delete(key); },
      },
    } });
    const key = "lottery-reward-reload-test";
    const bridge = { completeRewardVideo: vi.fn(async () => ({ code: 200, data: { rewarded: true } })) };
    const failed = await runLotteryRerollWithReward(key, bridge, async () => { throw new Error("保存失败"); });
    expect(failed).toMatchObject({ rerolled: false, rewardConfirmed: true });
    expect(values.get(key)).toBe("confirmed");

    vi.resetModules();
    const reloaded = await import("./lotteryReward");
    expect(reloaded.hasConfirmedLotteryReward(key)).toBe(true);
    const action = vi.fn(async () => undefined);
    expect(await reloaded.runLotteryRerollWithReward(key, bridge, action)).toMatchObject({ rerolled: true, rewardConfirmed: true });
    expect(bridge.completeRewardVideo).toHaveBeenCalledTimes(1);
    expect(action).toHaveBeenCalledOnce();
    expect(values.has(key)).toBe(false);
  });

  it("does not reroll or bank a reward when the video was not rewarded", async () => {
    const action = vi.fn(async () => undefined);
    const result = await runLotteryRerollWithReward("lottery-reward-denied-test", {
      completeRewardVideo: async () => ({ code: 200, data: { rewarded: false } }),
    }, action);
    expect(result).toMatchObject({ rerolled: false, rewardConfirmed: false });
    expect(action).not.toHaveBeenCalled();
    expect(hasConfirmedLotteryReward("lottery-reward-denied-test")).toBe(false);
  });
});
