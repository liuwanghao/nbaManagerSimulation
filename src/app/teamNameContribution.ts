import { EXPANSION_CITY_NAMES, EXPANSION_TEAM_NAME_OPTIONS } from "../data/expansionBrands";
import type { ExpansionCityId } from "../game/state/types";
import { CAREER_POST_DESTINATION } from "./careerShare";

type ContributionBridge = {
  auth?: { getUserInfo?: () => Promise<{ code: number; message?: string; data?: { puid?: string; islogin?: number } | null }> };
  request?: { bbs?: { openPostEditor?: (params: {
    topicId: string;
    tagId: string;
    topicName: string;
    tagName: string;
    title: string;
    content: string;
  }) => Promise<{ code: number; message?: string }> } };
};

export function teamNameContributionDraft(cityId: ExpansionCityId): { title: string; content: string } {
  const cityName = EXPANSION_CITY_NAMES[cityId];
  return {
    title: `为${cityName}扩军球队起个名字｜篮球经理队名投稿`,
    content: [
      `我来为《篮球经理：联盟扩军时代》的${cityName}扩军球队投稿队名！`,
      `目前候选队名：${EXPANSION_TEAM_NAME_OPTIONS[cityId].join("、")}。`,
      "我的建议队名：（请填写）",
      "创意来源与寓意：（请填写）",
      "如果你有更好、更有创意的名字，欢迎在话题下面一起讨论。",
    ].join("\n\n"),
  };
}

function checkCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("已取消队名投稿", "AbortError");
}

export async function openTeamNameContribution(cityId: ExpansionCityId, signal?: AbortSignal): Promise<void> {
  checkCancelled(signal);
  const sdk = (window as Window & { ColorboxAI?: ContributionBridge }).ColorboxAI;
  const auth = sdk?.auth;
  const bbs = sdk?.request?.bbs;
  if (!auth?.getUserInfo || !bbs?.openPostEditor) throw new Error("请在虎扑 App 内打开游戏后投稿队名。");

  try {
    const response = await auth.getUserInfo();
    checkCancelled(signal);
    if (response?.code !== 200) throw new Error(response?.message || "登录状态获取失败，请稍后重试。");
    if (!response.data?.puid || response.data.islogin === 0) throw new Error("请先登录虎扑账号，再投稿队名。");

    const draft = teamNameContributionDraft(cityId);
    checkCancelled(signal);
    const opened = await bbs.openPostEditor({ ...CAREER_POST_DESTINATION, ...draft });
    checkCancelled(signal);
    if (opened?.code !== 200) throw new Error(opened?.message || "发帖编辑器暂时无法打开，请稍后重试。");
  } catch (error) {
    checkCancelled(signal);
    throw error;
  }
}
