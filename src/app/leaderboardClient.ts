import type { GameState } from "../game/state/types";
import { createLeaderboardProof } from "./leaderboardProof";

export interface ManagerRank {
  id: string;
  rank: number;
  score: number;
  displayName: string;
  avatarUrl?: string;
  teamName?: string;
  teamLogo?: string;
  seasonId?: string;
  title?: string;
  profileSynced?: false;
}

type CloudResponse<T> = { statusCode: number; code?: number; message?: string; data?: T };
type CloudRequest = (options: { url: string; method?: "GET" | "POST"; data?: unknown; auth?: true; envId?: string }) => Promise<CloudResponse<unknown>>;
type UserProfile = { puid?: string; nickname?: string; avatar?: string; userHeadUrl?: string; islogin?: number };
type RankCache = { mine: ManagerRank | null; fetchedAt: number; signature?: string };
type ClientCache = { generation: number; ranks: Map<string, RankCache>; syncing: Map<string, Promise<ManagerRank | null>>; list?: { data: unknown; fetchedAt: number }; listing?: Promise<unknown> };
const caches = new WeakMap<CloudRequest, Map<string, ClientCache>>();
const RANK_TTL = 30_000;
const LIST_TTL = 15_000;

function cloudConfig() {
  const host = window as Window & {
    ACTIVITY_API_BASE?: string;
    ACTIVITY_ENV_ID?: string;
    ColorboxAI?: { cloud?: { request?: CloudRequest }; auth?: { getUserInfo?: () => Promise<{ code: number; message?: string; data?: UserProfile | null }> } };
  };
  const base = host.ACTIVITY_API_BASE?.trim();
  const envId = host.ACTIVITY_ENV_ID?.trim();
  const request = host.ColorboxAI?.cloud?.request;
  if (!base || !envId) throw new Error("排行榜配置缺失，请稍后再试");
  if (!request) throw new Error("请在虎扑 App 内打开排行榜");
  let environments = caches.get(request);
  if (!environments) { environments = new Map(); caches.set(request, environments); }
  const key = `${base}|${envId}`;
  let cache = environments.get(key);
  if (!cache) { cache = { generation: 0, ranks: new Map(), syncing: new Map() }; environments.set(key, cache); }
  return { base, envId, request: request.bind(host.ColorboxAI?.cloud), auth: host.ColorboxAI?.auth, cache };
}

type Client = ReturnType<typeof cloudConfig>;

function responseData<T>(response: CloudResponse<T>): T {
  if (response.statusCode !== 200 || (response.code !== 0 && response.code !== 200)) throw new Error(response.message || "排行榜暂时无法加载");
  return response.data as T;
}

async function leaderboardRequest<T>(client: Client, path: string, data?: unknown): Promise<T> {
  return responseData(await client.request({ url: client.base + path, method: data ? "POST" : "GET", ...(data ? { data } : {}), auth: true, envId: client.envId }) as CloudResponse<T>);
}

async function userProfile(client: Client): Promise<UserProfile | null> {
  if (!client.auth?.getUserInfo) throw new Error("虎扑资料接口暂不可用，请从虎扑 App 生涯页重试同步");
  const response = await client.auth.getUserInfo();
  if (response.code !== 200) throw new Error(response.message || "经理资料暂时无法读取");
  if (!response.data?.puid || response.data.islogin === 0) throw new Error("请先登录虎扑账号");
  if (!response.data.nickname?.trim()) throw new Error("虎扑昵称暂未读取，请重试同步");
  return response.data;
}

function validRank(value: ManagerRank | null): ManagerRank | null {
  if (!value) return null;
  if (!Number.isSafeInteger(value.rank) || value.rank < 1 || !Number.isSafeInteger(value.score) || value.score < 0) throw new Error("排行榜数据格式不正确");
  return value;
}

async function readMine(client: Client, account: string, force = false): Promise<ManagerRank | null> {
  const cached = client.cache.ranks.get(account);
  if (!force && cached && Date.now() - cached.fetchedAt < RANK_TTL) return cached.mine;
  const mine = validRank(await leaderboardRequest<ManagerRank | null>(client, "/leaderboard/me"));
  client.cache.ranks.set(account, { mine, fetchedAt: Date.now() });
  return mine;
}

async function syncProof(client: Client, profile: UserProfile | null, submission: Record<string, unknown>): Promise<ManagerRank | null> {
  const account = profile?.puid || "legacy";
  const enriched = { ...submission, ...(profile ? { displayName: profile.nickname || "虎扑经理", avatarUrl: profile.avatar || profile.userHeadUrl || "" } : {}) };
  const signature = JSON.stringify(enriched);
  const cached = client.cache.ranks.get(account);
  if (cached?.signature === signature && Date.now() - cached.fetchedAt < RANK_TTL) return cached.mine;
  const key = `${account}|${signature}`;
  const pending = client.cache.syncing.get(key);
  if (pending) return pending;
  const task = (async () => {
    const result = await leaderboardRequest<ManagerRank>(client, "/leaderboard/submit", enriched);
    // Supports the existing service while the new API is being deployed.
    const saved = result && Number.isSafeInteger(result.rank) ? validRank(result) : await readMine(client, account, true);
    const proof = submission.proof as Partial<ReturnType<typeof createLeaderboardProof>> | undefined;
    const mine = saved && profile ? {
      ...saved,
      displayName: profile.nickname || saved.displayName,
      avatarUrl: profile.avatar || profile.userHeadUrl || saved.avatarUrl || "",
      ...(typeof saved.teamName !== "string" || typeof saved.avatarUrl !== "string" ? {
        profileSynced: false as const,
        teamName: proof?.teamName || saved.teamName,
        teamLogo: proof?.teamLogo || saved.teamLogo,
        seasonId: proof?.seasonId || saved.seasonId,
        title: proof?.title || saved.title,
      } : {}),
    } : saved;
    client.cache.ranks.set(account, { mine, fetchedAt: Date.now(), signature });
    client.cache.generation++;
    client.cache.listing = undefined;
    const entries = client.cache.list?.data;
    if (mine && Array.isArray(entries)) {
      const index = entries.findIndex((entry: ManagerRank) => String(entry.id) === String(mine.id));
      if (index >= 0 && entries[index].score === mine.score && entries[index].rank === mine.rank) entries[index] = mine;
      else if (mine.rank <= 100 || index >= 0) client.cache.list = undefined;
    }
    return mine;
  })();
  client.cache.syncing.set(key, task);
  try { return await task; } finally { client.cache.syncing.delete(key); }
}

async function loadList(client: Client, force: boolean): Promise<unknown> {
  if (!force && client.cache.list && Date.now() - client.cache.list.fetchedAt < LIST_TTL) return client.cache.list.data;
  if (client.cache.listing) return client.cache.listing;
  const generation = client.cache.generation;
  const task = client.request({ url: client.base + "/leaderboard", method: "GET", data: { limit: 100 } }).then((response) => {
    const data = responseData(response);
    if (generation === client.cache.generation) client.cache.list = { data, fetchedAt: Date.now() };
    return data;
  });
  client.cache.listing = task;
  try { return await task; } finally { if (client.cache.listing === task) client.cache.listing = undefined; }
}

export async function requestForLeaderboardFrame(action: unknown, submission?: unknown): Promise<unknown> {
  const client = cloudConfig();
  const force = Boolean(submission && typeof submission === "object" && "force" in submission && submission.force === true);
  if (action === "list") return loadList(client, force);
  if (action !== "mine" && action !== "submit") throw new Error("不支持的排行榜请求");
  if (action === "submit" && (!submission || typeof submission !== "object" || Array.isArray(submission))) throw new Error("成绩数据格式不正确");
  const profile = await userProfile(client);
  if (action === "mine") {
    const mine = await readMine(client, profile?.puid || "legacy", force);
    return mine && profile ? { ...mine, displayName: profile.nickname || mine.displayName, avatarUrl: profile.avatar || profile.userHeadUrl || mine.avatarUrl || "" } : mine;
  }
  return syncProof(client, profile, submission as Record<string, unknown>);
}

export async function loadCareerRank(state: GameState): Promise<{ mine: ManagerRank | null; notice: string }> {
  const client = cloudConfig();
  const proof = createLeaderboardProof(state);
  let profile: UserProfile | null = null;
  try {
    profile = await userProfile(client);
    const mine = await syncProof(client, profile, { proof, displayName: "虎扑经理" });
    return { mine, notice: mine?.profileSynced === false ? "成绩已同步；云端榜单资料尚未启用" : mine && mine.score > proof.score ? "展示该账号所有存档中的最高积分" : "王朝积分已同步" };
  } catch (error) {
    const mine = await readMine(client, profile?.puid || "legacy");
    return { mine, notice: error instanceof Error ? `当前进度待同步：${error.message}` : "当前进度待同步" };
  }
}
