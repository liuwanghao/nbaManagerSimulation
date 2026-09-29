import { describe, expect, it, vi } from "vitest";
import { createCareer } from "../game/season/career";
import { coachingFatigueRewardKey, coachingMoraleRewardKey, coachingPregameRewardKey, fatigueEventRewardKey, hasConfirmedCoachingReward, runCoachingWithReward } from "./coachingReward";

describe("rewarded morale intervention", () => {
  it("keeps fatigue and morale video receipts separate for the same review", () => {
    const state = createCareer("coaching-reward-key");
    const gameId = "five-game-review";
    expect(coachingFatigueRewardKey(state, gameId)).not.toBe(coachingMoraleRewardKey(state, gameId));
    expect(coachingPregameRewardKey(state, gameId)).not.toBe(coachingMoraleRewardKey(state, gameId));
    expect(fatigueEventRewardKey(state, gameId)).not.toBe(coachingFatigueRewardKey(state, gameId));
  });
  it("changes no morale when the video is not rewarded", async () => {
    const apply = vi.fn(async () => {});
    const result = await runCoachingWithReward("coaching-denied", {
      completeRewardVideo: async () => ({ code: 200, data: { rewarded: false } }),
    }, apply);
    expect(result.applied).toBe(false);
    expect(apply).not.toHaveBeenCalled();
    expect(hasConfirmedCoachingReward("coaching-denied")).toBe(false);
  });

  it("retains a confirmed video through save failure and retries without another video", async () => {
    const bridge = { completeRewardVideo: vi.fn(async () => ({ code: 200, data: { rewarded: true } })) };
    const key = "coaching-save-retry";
    const failed = await runCoachingWithReward(key, bridge, async () => { throw new Error("save failed"); });
    expect(failed).toMatchObject({ applied: false, rewardConfirmed: true });
    expect(hasConfirmedCoachingReward(key)).toBe(true);
    const applied = vi.fn(async () => {});
    expect(await runCoachingWithReward(key, bridge, applied)).toMatchObject({ applied: true, rewardConfirmed: true });
    expect(bridge.completeRewardVideo).toHaveBeenCalledTimes(1);
    expect(applied).toHaveBeenCalledTimes(1);
    expect(hasConfirmedCoachingReward(key)).toBe(false);
  });
});
