import type { GameState } from "../game/state/types";
import { createLeaderboardProof } from "./leaderboardProof";

export interface ManagerRank {
  id: number;
  rank: number;
  score: number;
  displayName: string;
}

type CloudResponse<T> = { statusCode: number; code?: number; message?: string; data?: T };
type CloudRequest = (options: {
  url: string;
  method?: "GET" | "POST";
  data?: unknown;
  auth: true;
  envId: string;
}) => Promise<CloudResponse<unknown>>;

function cloudConfig(): { base: string; envId: string; request: CloudRequest } {
  const host = window as Window & {
    ACTIVITY_API_BASE?: string;
    ACTIVITY_ENV_ID?: string;
    ColorboxAI?: { cloud?: { request?: CloudRequest } };
  };
  const base = host.ACTIVITY_API_BASE?.trim();
  const envId = host.ACTIVITY_ENV_ID?.trim();
  const request = host.ColorboxAI?.cloud?.request;
  if (!base || !envId || !request) throw new Error("排行榜服务暂未开放");
  return { base, envId, request: request.bind(host.ColorboxAI?.cloud) };
}

async function leaderboardRequest<T>(path: string, data?: unknown): Promise<T> {
  const { base, envId, request } = cloudConfig();
  const response = await request({
    url: base + path,
    method: data ? "POST" : "GET",
    ...(data ? { data } : {}),
    auth: true,
    envId,
  }) as CloudResponse<T>;
  if (response.statusCode !== 200 || (response.code !== 0 && response.code !== 200)) {
    throw new Error(response.message || "排行榜暂时无法加载");
  }
  return response.data as T;
}

function validRank(value: ManagerRank | null): ManagerRank | null {
  if (!value) return null;
  if (!Number.isSafeInteger(value.rank) || value.rank < 1 || !Number.isSafeInteger(value.score) || value.score < 0) {
    throw new Error("排行榜数据格式不正确");
  }
  return value;
}

export async function loadCareerRank(state: GameState): Promise<{ mine: ManagerRank | null; notice: string }> {
  let mine = validRank(await leaderboardRequest<ManagerRank | null>("/leaderboard/me"));
  const proof = createLeaderboardProof(state);
  if (!mine || proof.score > mine.score) {
    try {
      await leaderboardRequest("/leaderboard/submit", { proof, displayName: proof.displayName });
      mine = validRank(await leaderboardRequest<ManagerRank | null>("/leaderboard/me"));
    } catch (error) {
      return { mine, notice: error instanceof Error ? `当前进度待同步：${error.message}` : "当前进度待同步" };
    }
  }
  return { mine, notice: mine && mine.score > proof.score ? "展示该账号所有存档中的最高积分" : "王朝积分已同步" };
}
