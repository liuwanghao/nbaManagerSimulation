import { stableHash } from "../game/random/hash";
import type { GameState } from "../game/state/types";
import { watchRewardVideo, type RewardVideoBridge } from "./rewardVideo";

const pendingRewards = new Set<string>();

function rewardStorage(): Storage | undefined {
  try { return typeof window === "undefined" ? undefined : window.localStorage; }
  catch { return undefined; }
}

export function lotteryRerollRewardKey(state: GameState): string {
  return `nba-lottery-reroll:${stableHash(state.seeds.careerSeed, state.league.seasonId, state.rookieDraft?.draftSeed ?? "", state.rookieDraft?.lotteryRerollCount ?? 0)}`;
}

export function hasConfirmedLotteryReward(key: string): boolean {
  if (pendingRewards.has(key)) return true;
  try { return rewardStorage()?.getItem(key) === "confirmed"; }
  catch { return false; }
}

function markConfirmedLotteryReward(key: string): void {
  pendingRewards.add(key);
  try { rewardStorage()?.setItem(key, "confirmed"); }
  catch { /* Keep the confirmed reward in memory when browser storage is unavailable. */ }
}

function clearConfirmedLotteryReward(key: string): void {
  pendingRewards.delete(key);
  try { rewardStorage()?.removeItem(key); }
  catch { /* A completed reroll must not fail because browser storage is unavailable. */ }
}

export async function runLotteryRerollWithReward(
  key: string,
  bridge: RewardVideoBridge | undefined,
  reroll: () => Promise<void>,
): Promise<{ rerolled: boolean; rewardConfirmed: boolean; message?: string }> {
  if (!hasConfirmedLotteryReward(key)) {
    const reward = await watchRewardVideo(bridge);
    if (!reward.rewarded) return { rerolled: false, rewardConfirmed: false, message: reward.message };
    markConfirmedLotteryReward(key);
  }
  try {
    await reroll();
    clearConfirmedLotteryReward(key);
    return { rerolled: true, rewardConfirmed: true };
  } catch (error) {
    return {
      rerolled: false,
      rewardConfirmed: true,
      message: `${error instanceof Error ? error.message : "重新抽签失败，原结果已保留。"} 视频奖励已确认，可直接重试。`,
    };
  }
}
