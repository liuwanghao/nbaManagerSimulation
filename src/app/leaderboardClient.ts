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
type ProfileReader = () => Promise<{ code: number; message?: string; data?: UserProfile | null }>;
type RankCache = { mine: ManagerRank | null; fetchedAt: number; signature?: string };
type ClientCache = { generation: number; ranks: Map<string, RankCache>; syncing: Map<string, Promise<ManagerRank | null>>; reading: Map<string, Promise<ManagerRank | null>>; profile?: { auth: object; reader: ProfileReader; pending: Promise<UserProfile> }; list?: { data: unknown; fetchedAt: number }; listing?: Promise<unknown> };
const caches = new WeakMap<CloudRequest, Map<string, ClientCache>>();
const RANK_TTL = 30_000;
const LIST_TTL = 15_000;

function cloudConfig() {
  const host = window as Window & {
    ACTIVITY_API_BASE?: string;
    ACTIVITY_ENV_ID?: string;
    ColorboxAI?: { cloud?: { request?: CloudRequest }; auth?: { getUserInfo?: ProfileReader } };
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
  if (!cache) { cache = { generation: 0, ranks: new Map(), syncing: new Map(), reading: new Map() }; environments.set(key, cache); }
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

async function userProfile(client: Client): Promise<UserProfile> {
  const auth = client.auth;
  const reader = auth?.getUserInfo;
  if (!auth || !reader) throw new Error("虎扑资料接口暂不可用，请从虎扑 App 生涯页重试同步");
  const existing = client.cache.profile;
  if (existing?.auth === auth && existing.reader === reader) return existing.pending;
  // Only share an in-flight lookup: a later entry must verify the current account again.
  const pending = (async () => {
    const response = await reader.call(auth);
    if (response.code !== 200) throw new Error(response.message || "经理资料暂时无法读取");
    if (!response.data?.puid || response.data.islogin === 0) throw new Error("请先登录虎扑账号");
    if (!response.data.nickname?.trim()) throw new Error("虎扑昵称暂未读取，请重试同步");
    return response.data;
  })();
  client.cache.profile = { auth, reader, pending };
  try { return await pending; } finally { if (client.cache.profile?.pending === pending) client.cache.profile = undefined; }
}

function validRank(value: ManagerRank | null): ManagerRank | null {
  if (!value) return null;
  if (!Number.isSafeInteger(value.rank) || value.rank < 1 || !Number.isSafeInteger(value.score) || value.score < 0) throw new Error("排行榜数据格式不正确");
  return value;
}

async function readMine(client: Client, account: string, force = false): Promise<ManagerRank | null> {
  const cached = client.cache.ranks.get(account);
  if (!force && cached && Date.now() - cached.fetchedAt < RANK_TTL) return cached.mine;
  const existing = client.cache.reading.get(account);
  if (existing) return existing;
  const generation = client.cache.generation;
  const task = (async () => {
    const mine = validRank(await leaderboardRequest<ManagerRank | null>(client, "/leaderboard/me"));
    if (generation === client.cache.generation) {
      const previous = client.cache.ranks.get(account);
      client.cache.ranks.set(account, { mine, fetchedAt: Date.now(), ...(mine && previous?.signature ? { signature: previous.signature } : {}) });
    } else if (client.cache.ranks.has(account)) {
      return client.cache.ranks.get(account)!.mine;
    }
    return mine;
  })();
  client.cache.reading.set(account, task);
  try { return await task; } finally { if (client.cache.reading.get(account) === task) client.cache.reading.delete(account); }
}

function rankWithProfile(saved: ManagerRank | null, profile: UserProfile, proof: Partial<ReturnType<typeof createLeaderboardProof>> | undefined): ManagerRank | null {
  if (!saved) return saved;
  return {
    ...saved,
    displayName: profile.nickname || saved.displayName,
    avatarUrl: profile.avatar || profile.userHeadUrl || saved.avatarUrl || "",
    ...(typeof saved.teamName !== "string" || typeof saved.avatarUrl !== "string" ? {
      profileSynced: false as const,
      teamName: proof?.teamName || saved.teamName,
      teamLogo: proof?.teamLogo ?? saved.teamLogo,
      seasonId: proof?.seasonId || saved.seasonId,
      title: proof?.title || saved.title,
    } : {}),
  };
}

async function syncProof(client: Client, profile: UserProfile, submission: Record<string, unknown>, force = false): Promise<ManagerRank | null> {
  const account = profile.puid!;
  const enriched = { ...submission, displayName: profile.nickname || "虎扑经理", avatarUrl: profile.avatar || profile.userHeadUrl || "" };
  const proof = submission.proof as Partial<ReturnType<typeof createLeaderboardProof>> | undefined;
  const signature = JSON.stringify(enriched);
  const cached = client.cache.ranks.get(account);
  if (!force && cached?.signature === signature) return rankWithProfile(await readMine(client, account), profile, proof);
  const key = `${account}|${signature}`;
  const pending = client.cache.syncing.get(key);
  if (pending) return pending;
  const task = (async () => {
    const result = await leaderboardRequest<ManagerRank>(client, "/leaderboard/submit", enriched);
    // Supports the existing service while the new API is being deployed.
    const saved = result && Number.isSafeInteger(result.rank) ? validRank(result) : await readMine(client, account, true);
    const mine = rankWithProfile(saved, profile, proof);
    client.cache.ranks.set(account, { mine, fetchedAt: Date.now(), ...(mine ? { signature } : {}) });
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
    const mine = await readMine(client, profile.puid!, force);
    return mine ? { ...mine, displayName: profile.nickname || mine.displayName, avatarUrl: profile.avatar || profile.userHeadUrl || mine.avatarUrl || "" } : mine;
  }
  const { force: _force, ...payload } = submission as Record<string, unknown>;
  return syncProof(client, profile, payload, force);
}

export type CareerRankResult = { mine: ManagerRank | null; notice: string };

export async function loadCareerRank(state: GameState, options: { onCached?: (result: CareerRankResult) => void; force?: boolean } = {}): Promise<CareerRankResult> {
  const client = cloudConfig();
  const proof = createLeaderboardProof(state);
  let profile: UserProfile | null = null;
  try {
    profile = await userProfile(client);
    const cached = client.cache.ranks.get(profile.puid!);
    if (cached) options.onCached?.({ mine: cached.mine, notice: "正在更新排名…" });
    const mine = await syncProof(client, profile, { proof, displayName: "虎扑经理" }, options.force);
    return { mine, notice: mine?.profileSynced === false ? "成绩已同步；云端榜单资料尚未启用" : mine && mine.score > proof.score ? "展示该账号所有存档中的最高积分" : "王朝积分已同步" };
  } catch (error) {
    // A failed refresh should leave a verified account's last rank visible.
    const cached = profile?.puid ? client.cache.ranks.get(profile.puid) : undefined;
    const mine = cached ? cached.mine : profile?.puid
      ? await readMine(client, profile.puid)
      : validRank(await leaderboardRequest<ManagerRank | null>(client, "/leaderboard/me"));
    const message = error instanceof Error ? error.message : "请稍后重试";
    return { mine, notice: cached ? `更新未完成，显示上次排名：${message}` : `当前进度待同步：${message}` };
  }
}
