import { stableHash } from "../game/random/hash";
import type { GameState } from "../game/state/types";
import { watchRewardVideo, type RewardVideoBridge } from "./rewardVideo";

const confirmedInMemory = new Set<string>();

function storage(): Storage | undefined {
  try { return typeof window === "undefined" ? undefined : window.localStorage; }
  catch { return undefined; }
}

export function coachingMoraleRewardKey(state: GameState, afterGameId: string): string {
  return `nba-coaching-morale:${stableHash(state.seeds.careerSeed, state.league.seasonId, afterGameId)}`;
}

export function coachingFatigueRewardKey(state: GameState, afterGameId: string): string {
  return `nba-coaching-fatigue:${stableHash(state.seeds.careerSeed, state.league.seasonId, afterGameId)}`;
}

export function coachingPregameRewardKey(state: GameState, gameId: string): string {
  return `nba-coaching-pregame:${stableHash(state.seeds.careerSeed, state.league.seasonId, gameId)}`;
}

export function fatigueEventRewardKey(state: GameState, eventInstanceId: string): string {
  return `nba-fatigue-event:${stableHash(state.seeds.careerSeed, state.league.seasonId, eventInstanceId)}`;
}

export function hasConfirmedCoachingReward(key: string): boolean {
  if (confirmedInMemory.has(key)) return true;
  try { return storage()?.getItem(key) === "confirmed"; }
  catch { return false; }
}

function markConfirmed(key: string): void {
  confirmedInMemory.add(key);
  try { storage()?.setItem(key, "confirmed"); }
  catch { /* Keep a confirmed video reward available for retry in this session. */ }
}

function clearConfirmed(key: string): void {
  confirmedInMemory.delete(key);
  try { storage()?.removeItem(key); }
  catch { /* A completed coaching action must not fail on local storage. */ }
}

export async function runCoachingWithReward(
  key: string,
  bridge: RewardVideoBridge | undefined,
  apply: () => Promise<void>,
): Promise<{ applied: boolean; rewardConfirmed: boolean; message?: string }> {
  if (!hasConfirmedCoachingReward(key)) {
    const reward = await watchRewardVideo(bridge);
    if (!reward.rewarded) return { applied: false, rewardConfirmed: false, message: reward.message };
    markConfirmed(key);
  }
  try {
    await apply();
    clearConfirmed(key);
    return { applied: true, rewardConfirmed: true };
  } catch (error) {
    const expired = error instanceof Error && error.message.startsWith("COACHING_");
    return {
      applied: false,
      rewardConfirmed: true,
      message: expired ? "本次教练组机会已失效，球员状态未改变。" : "保存失败。视频奖励已确认，可直接重试。",
    };
  }
}
