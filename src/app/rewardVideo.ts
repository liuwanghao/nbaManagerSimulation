export type RewardVideoBridge = {
  completeRewardVideo?: () => Promise<{ code?: number; message?: string; data?: { rewarded?: boolean; reason?: string } }>;
  getActivityTaskState?: () => Promise<unknown>;
};

let videoInProgress = false;

export function getRewardVideoBridge(): RewardVideoBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as Window & { ColorboxAI?: { vatask?: RewardVideoBridge } }).ColorboxAI?.vatask;
}

export async function watchRewardVideo(bridge: RewardVideoBridge | undefined): Promise<{ rewarded: boolean; message?: string }> {
  if (!bridge?.completeRewardVideo) return { rewarded: false, message: "请在虎扑 App 内观看激励视频。" };
  if (videoInProgress) return { rewarded: false, message: "激励视频正在播放中，请稍候。" };
  videoInProgress = true;
  try {
    const result = await bridge.completeRewardVideo();
    if (result.code !== 200 || result.data?.rewarded !== true) {
      return { rewarded: false, message: result.message ?? "激励视频未完成。" };
    }
    try {
      const taskStateRefresh = bridge.getActivityTaskState?.();
      if (taskStateRefresh) void taskStateRefresh.catch(() => undefined);
    } catch { /* The video reward is already confirmed; a status refresh cannot revoke it. */ }
    return { rewarded: true };
  } catch {
    return { rewarded: false, message: "激励视频暂时不可用，请稍后再试。" };
  } finally {
    videoInProgress = false;
  }
}

export async function runRewardedAction(bridge: RewardVideoBridge | undefined, action: () => Promise<void>): Promise<{ rewarded: boolean; message?: string }> {
  const result = await watchRewardVideo(bridge);
  if (result.rewarded) await action();
  return result;
}
