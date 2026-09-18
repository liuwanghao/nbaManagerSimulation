export interface HupuRosterPlayer {
  playerId?: string;
  player_name?: string;
  player_name_en?: string;
  en_name?: string;
  number?: string;
  position?: string;
  salary?: string;
  salary_str?: string;
  is_injured?: number;
  game_played_start?: string;
  min?: string;
  pts?: string;
  reb?: string;
  asts?: string;
  fgp?: string;
  tpp?: string;
  ftp?: string;
  oreb?: string;
  dreb?: string;
  stl?: string;
  to?: string;
  blk?: string;
  pf?: string;
}

export interface HupuTeamPlayerListResponse {
  code: number;
  message: string;
  data?: {
    info?: { teamId?: string; name?: string; full_name?: string; salary_title?: string };
    list?: HupuRosterPlayer[];
  };
}

export interface HupuSalaryPlayer {
  playerName?: string;
  playerId?: string;
  age?: string;
  seasonSalaryInfos?: Array<{
    restrictedType?: string | null;
    salaryOption?: string | null;
    seasonSalary?: string;
  }>;
}

export interface HupuTeamSalaryInfoResponse {
  code: number;
  message: string;
  data?: {
    version?: string;
    salaryPlayerTable?: {
      seasonSalaryHeads?: string[];
      items?: HupuSalaryPlayer[];
    };
    lastModifyDate?: string;
    lastUpdateDate?: string;
  };
}

export interface HupuPlayerProfile {
  playerId?: string;
  name?: string;
  eng_name?: string;
  age?: string;
  country?: string;
  position?: string;
  birth_date?: string;
  height?: number;
  weight?: number;
}

export interface HupuPlayerInfoResponse {
  code: number;
  message: string;
  data?: { player?: HupuPlayerProfile };
}

interface NbaManagerHupuSdk {
  teamPlayers(teamId: string): Promise<HupuTeamPlayerListResponse>;
  teamSalaryInfo(teamId: string): Promise<HupuTeamSalaryInfoResponse>;
  playerInfo(playerId: string): Promise<HupuPlayerInfoResponse>;
}

export interface HupuColorboxRuntime {
  request?: {
    basketball?: {
      teamPlayerList?: (params: { teamId: string; leagueType: "nba" | "cba" }) => Promise<HupuTeamPlayerListResponse>;
      teamSalaryInfo?: (params: { teamId: string; leagueType: "nba" | "cba" }) => Promise<HupuTeamSalaryInfoResponse>;
      playerInfo?: (params: { playerId: string; leagueType: "nba" | "cba" }) => Promise<HupuPlayerInfoResponse>;
    };
  };
  storage?: {
    getValue: (key?: string) => Promise<unknown>;
    setValue: (data: Record<string, unknown>) => Promise<{ ok: boolean; key?: string; keys?: string[]; size?: number }>;
  };
}

declare global {
  interface Window {
    ColorboxAI?: HupuColorboxRuntime;
    __NBA_MANAGER_HUPU_SDK__?: NbaManagerHupuSdk;
  }
}

export function isHupuBasketballAvailable(): boolean {
  return Boolean(
    window.ColorboxAI?.request?.basketball?.teamPlayerList
    && window.ColorboxAI.request.basketball.teamSalaryInfo
    && window.__NBA_MANAGER_HUPU_SDK__?.teamPlayers
    && window.__NBA_MANAGER_HUPU_SDK__.teamSalaryInfo,
  );
}

export async function requestTeamPlayers(teamId: string): Promise<HupuTeamPlayerListResponse["data"]> {
  const request = window.__NBA_MANAGER_HUPU_SDK__?.teamPlayers;
  if (!request) throw new Error("虎扑球队阵容能力不可用");
  const response = await request(teamId);
  if (response.code !== 200 || !response.data?.list) throw new Error(response.message || "球队阵容加载失败");
  return response.data;
}

export async function requestTeamSalaryInfo(teamId: string): Promise<HupuTeamSalaryInfoResponse["data"]> {
  const request = window.__NBA_MANAGER_HUPU_SDK__?.teamSalaryInfo;
  if (!request) throw new Error("虎扑球队薪资能力不可用");
  const response = await request(teamId);
  if (response.code !== 200 || !response.data) throw new Error(response.message || "球队薪资加载失败");
  return response.data;
}

const playerProfileRequests = new Map<string, Promise<HupuPlayerProfile>>();

export function requestPlayerInfo(playerId: string): Promise<HupuPlayerProfile> {
  const cached = playerProfileRequests.get(playerId);
  if (cached) return cached;
  const request = window.__NBA_MANAGER_HUPU_SDK__?.playerInfo;
  if (!request) return Promise.reject(new Error("虎扑球员详情能力不可用"));
  const pending = request(playerId).then((response) => {
    if (response.code !== 200 || !response.data?.player) throw new Error(response.message || "球员详情加载失败");
    return response.data.player;
  }).catch((error) => {
    playerProfileRequests.delete(playerId);
    throw error;
  });
  playerProfileRequests.set(playerId, pending);
  return pending;
}
